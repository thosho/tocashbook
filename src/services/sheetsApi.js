/**
 * sheetsApi.js — Google Sheets API sync layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture: Direct Google Sheets API v4.
 * All reads/writes go straight to the boss's spreadsheet using their OAuth
 * token. No Apps Script involved. Legacy Apps Script fallback is preserved
 * for old users who haven't re-run Automated Setup.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  getApiLink, saveUsers, saveCategories, saveBooks,
  setSettings, getTransactions, getPendingEdits,
  removePendingEdit, getPendingDeletes, removePendingDelete
} from './localDb';
import localforage from 'localforage';

// ─── Secret key (legacy Apps Script auth) ────────────────────────────────────
const getSecret = async () => (await localforage.getItem('apiSecret')) || '';
export const setSecret = async (s) => localforage.setItem('apiSecret', s);

// ─── Fetch with 15-second timeout ────────────────────────────────────────────
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Request timed out.');
    throw err;
  }
};

// ─── Sheets API Helpers ───────────────────────────────────────────────────────
const getSheetsId   = async () => localforage.getItem('spreadsheetId');
const getSheetsToken = async () => localforage.getItem('googleAccessToken');

const sheetsAuthHeaders = async () => {
  const token = await getSheetsToken();
  if (!token) throw new Error('No Google token. Please run Automated Setup again.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

const SHEETS_BASE = (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

/** Convert valueRange rows (array of arrays) to array of objects using row 0 as headers */
const rowsToObjects = (valueRange) => {
  const values = valueRange?.values || [];
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== undefined))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
};

/** Find 1-based row number of a transaction by ID in column A */
const findTxRowIndex = async (txId, base, hdrs) => {
  const res = await fetch(`${base}/values/${encodeURIComponent('Transactions!A:A')}`, { headers: hdrs });
  const data = await res.json();
  const vals = data.values || [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === txId) return i + 1; // 1-based
  }
  return -1;
};

/** Get the numeric sheetId for the Transactions tab */
const getTxSheetId = async (base, hdrs) => {
  const res = await fetch(`${base}?fields=sheets.properties`, { headers: hdrs });
  const info = await res.json();
  const sheet = (info.sheets || []).find(s => s.properties.title === 'Transactions');
  return sheet ? sheet.properties.sheetId : 0;
};

/** Safely overwrite an entire sheet: clear first, then write header + rows */
const overwriteSheet = async (sheetName, headerRow, dataRows, hdrs, base) => {
  await fetch(`${base}/values/${encodeURIComponent(sheetName)}:clear`,
    { method: 'POST', headers: hdrs });
  const values = [headerRow, ...dataRows];
  const res = await fetch(
    `${base}/values/${encodeURIComponent(sheetName + '!A1')}?valueInputOption=RAW`,
    { method: 'PUT', headers: hdrs, body: JSON.stringify({ values }) }
  );
  if (!res.ok) throw new Error(`Failed to update ${sheetName}: HTTP ${res.status}`);
};

/** Build a transaction row array for Sheets API writes */
const txToRow = (t, ts = new Date().toISOString()) => [
  t.id, ts, t.date || '', t.type || '', t.category || '',
  t.partyName || '', t.partyPhone || '', t.amount ?? 0, t.paymentMode || 'Cash',
  t.reference || '', t.remarks || '', t.user || '', t.imageUrl || '',
  JSON.stringify(t.editHistory || []), t.bossNotes || '',
  t.recurring || 'none', t.bookId || 'book_main', t.upiApp || ''
];

// ─── Fetch All Data ───────────────────────────────────────────────────────────
export const fetchAllData = async () => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();

  // ── Direct Sheets API (new architecture) ─────────────────────────────────
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch (e) {
      throw new Error('Google session expired. Open the app again to auto-refresh.');
    }

    const base = SHEETS_BASE(spreadsheetId);
    const ranges = ['Users!A:F', 'Transactions!A:S', 'Categories!A:C', 'Books!A:D', 'Settings!A:B'];
    const q = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');

    const res = await fetchWithTimeout(`${base}/values:batchGet?${q}`, { headers: hdrs });
    if (!res.ok) {
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('google-token-expired'));
        throw new Error('Google token expired. Auto-refreshing your session...');
      }
      throw new Error(`Could not read spreadsheet: HTTP ${res.status}`);
    }

    const batchData = await res.json();
    const [usersR, txR, catsR, booksR, settingsR] = batchData.valueRanges || [];

    const users       = rowsToObjects(usersR);
    const categories  = rowsToObjects(catsR);
    const books       = rowsToObjects(booksR);
    const settingsArr = rowsToObjects(settingsR);
    const rawTx       = rowsToObjects(txR);

    if (users.length > 0) await saveUsers(users);

    if (categories.length > 0) {
      const catMap = new Map();
      categories.forEach(c => catMap.set(String(c.ID), c));
      await saveCategories(Array.from(catMap.values()));
    }

    if (books.length > 0) {
      const bookMap = new Map();
      books.forEach(b => bookMap.set(String(b.ID), b));
      await saveBooks(Array.from(bookMap.values()));
    }

    if (settingsArr.length > 0) {
      const existing = (await localforage.getItem('settings')) || {};
      const merged = { ...existing };
      settingsArr.forEach(s => { merged[s.Key] = s.Value; });
      await setSettings(merged);
    }

    // Map raw rows → internal transaction objects
    const serverTx = rawTx
      .filter(t => t.ID)  // skip blank rows
      .map(t => ({
        id:          t.ID,
        date:        t.Date        || '',
        type:        t.Type        || '',
        category:    t.Category    || '',
        partyName:   t.PartyName   || '',
        partyPhone:  t.PartyPhone  || '',
        amount:      parseFloat(t.Amount) || 0,
        paymentMode: t.PaymentMode || 'Cash',
        reference:   t.Reference   || '',
        remarks:     t.Remarks     || '',
        user:        t.User        || '',
        imageUrl:    t.ImageUrl    || '',
        bossNotes:   t.BossNotes   || '',
        recurring:   t.Recurring   || 'none',
        bookId:      t.BookID      || 'book_main',
        upiApp:      t.UpiApp      || '',
        editHistory: (() => { try { return JSON.parse(t.EditHistory || '[]'); } catch { return []; } })(),
        synced: true,
      }));

    // Preserve local pending (unsynced) entries — never discard offline work
    const serverIds = new Set(serverTx.map(t => t.id));
    const allLocal  = await getTransactions();
    const localOnly = allLocal.filter(t => !t.synced && !serverIds.has(t.id));
    await localforage.setItem('transactions', [...serverTx, ...localOnly]);
    return;
  }

  // ── Legacy fallback: Apps Script URL (for old users) ─────────────────────
  const apiLink = await getApiLink();
  if (!apiLink || !apiLink.startsWith('http')) {
    throw new Error('Not connected. Please run Automated Setup (Sign in with Google).');
  }

  let response;
  try {
    const secret = await getSecret();
    response = await fetchWithTimeout(`${apiLink}?action=get_all_data&secret=${encodeURIComponent(secret)}`);
  } catch (err) {
    throw new Error('Could not connect to Google Spreadsheet: ' + err.message);
  }
  if (!response.ok) throw new Error(`Server responded with status ${response.status}.`);

  const legacyData = await response.json();
  if (legacyData.status !== 'success') throw new Error(legacyData.error || 'Failed to fetch data.');

  if (legacyData.users) await saveUsers(legacyData.users);
  if (legacyData.categories) {
    const catMap = new Map();
    legacyData.categories.forEach(c => catMap.set(String(c.ID), c));
    await saveCategories(Array.from(catMap.values()));
  }
  if (legacyData.books) {
    const bookMap = new Map();
    legacyData.books.forEach(b => bookMap.set(String(b.ID), b));
    await saveBooks(Array.from(bookMap.values()));
  }
  if (legacyData.settings) {
    const existing = (await localforage.getItem('settings')) || {};
    const merged = { ...existing };
    legacyData.settings.forEach(s => { merged[s.Key] = s.Value; });
    await setSettings(merged);
  }
  if (legacyData.transactions) {
    const serverTx = legacyData.transactions.map(t => ({
      id: t.ID, date: t.Date, type: t.Type, category: t.Category,
      partyName: t.PartyName || '', partyPhone: t.PartyPhone || '',
      amount: parseFloat(t.Amount) || 0, paymentMode: t.PaymentMode || 'Cash',
      reference: t.Reference || '', remarks: t.Remarks || '', user: t.User || '',
      imageUrl: t.ImageUrl || '', bossNotes: t.BossNotes || '',
      recurring: t.Recurring || 'none', bookId: t.BookID || 'book_main',
      editHistory: (() => { try { return JSON.parse(t.EditHistory || '[]'); } catch { return []; } })(),
      synced: true,
    }));
    const serverIds = new Set(serverTx.map(t => t.id));
    const allLocal  = await getTransactions();
    const localOnly = allLocal.filter(t => !t.synced && !serverIds.has(t.id));
    await localforage.setItem('transactions', [...serverTx, ...localOnly]);
  }
};

// ─── Edit Transaction (immediate, online) ────────────────────────────────────
export const editTransactionAPI = async (transaction, editMetadata) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    const rowIndex = await findTxRowIndex(transaction.id, base, hdrs);
    if (rowIndex < 0) throw new Error('Transaction not found in spreadsheet.');
    const res = await fetch(
      `${base}/values/${encodeURIComponent(`Transactions!A${rowIndex}:R${rowIndex}`)}?valueInputOption=RAW`,
      { method: 'PUT', headers: hdrs, body: JSON.stringify({ values: [txToRow(transaction)] }) }
    );
    if (!res.ok) throw new Error(`Could not update transaction: HTTP ${res.status}`);
    return;
  }

  // Legacy
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST',
    body: JSON.stringify({ action: 'edit_transaction', secret, transaction, editMetadata })
  });
  if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Server failed to update.');
};

// ─── Delete Transaction (immediate, online) ───────────────────────────────────
export const deleteTransactionAPI = async (txId, deletedBy, reason) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    const rowIndex = await findTxRowIndex(txId, base, hdrs);
    if (rowIndex < 0) throw new Error('Transaction not found in spreadsheet.');
    const txSheetId = await getTxSheetId(base, hdrs);
    const res = await fetch(`${base}:batchUpdate`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({
        requests: [{ deleteDimension: { range: {
          sheetId: txSheetId, dimension: 'ROWS',
          startIndex: rowIndex - 1, endIndex: rowIndex
        }}}]
      })
    });
    if (!res.ok) throw new Error(`Could not delete transaction: HTTP ${res.status}`);
    return;
  }

  // Legacy
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_transaction', secret, txId, deletedBy, reason })
  });
  if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Server failed to delete.');
};

// ─── Sync Pending New Transactions ───────────────────────────────────────────
// Writes new entries directly to the Transactions sheet.
const getPendingSync = async () => (await localforage.getItem('pendingSync')) || [];

export const syncOfflineTransactions = async () => {
  if (!navigator.onLine) return;
  const pending = await getPendingSync();
  if (pending.length === 0) return;

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { return; }

    const base = SHEETS_BASE(spreadsheetId);
    const allTx = await getTransactions();
    const successIds = new Set();

    for (const t of pending) {
      try {
        const res = await fetch(
          `${base}/values/${encodeURIComponent('Transactions!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: 'POST', headers: hdrs, body: JSON.stringify({ values: [txToRow(t)] }) }
        );
        if (res.ok) {
          successIds.add(t.id);
        } else if (res.status === 401) {
          window.dispatchEvent(new CustomEvent('google-token-expired'));
          break;
        }
      } catch (err) {
        console.error('[Sync] Error syncing tx:', t.id, err.message);
        break;
      }
    }

    if (successIds.size > 0) {
      await localforage.setItem('pendingSync', pending.filter(t => !successIds.has(t.id)));
      await localforage.setItem('transactions', allTx.map(t => successIds.has(t.id) ? { ...t, synced: true } : t));
    }
    return;
  }

  // Legacy fallback
  const apiLink = await getApiLink();
  if (!apiLink || !apiLink.startsWith('http')) return;
  const allTx = await getTransactions();
  const successIds = new Set();
  for (const t of pending) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({ action: 'sync_transactions', secret, transactions: [t] })
      });
      const result = await response.json();
      if (result.status === 'success') successIds.add(t.id);
    } catch (err) {
      break;
    }
  }
  if (successIds.size > 0) {
    await localforage.setItem('pendingSync', pending.filter(t => !successIds.has(t.id)));
    await localforage.setItem('transactions', allTx.map(t => successIds.has(t.id) ? { ...t, synced: true } : t));
  }
};

// ─── Sync Pending Edits ───────────────────────────────────────────────────────
export const syncPendingEdits = async () => {
  if (!navigator.onLine) return;
  const pendingEdits = await getPendingEdits();
  if (pendingEdits.length === 0) return;

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { return; }
    const base = SHEETS_BASE(spreadsheetId);

    for (const editEntry of pendingEdits) {
      try {
        const t = editEntry.transaction;
        const rowIndex = await findTxRowIndex(t.id, base, hdrs);
        if (rowIndex < 0) { await removePendingEdit(t.id); continue; }
        const res = await fetch(
          `${base}/values/${encodeURIComponent(`Transactions!A${rowIndex}:R${rowIndex}`)}?valueInputOption=RAW`,
          { method: 'PUT', headers: hdrs, body: JSON.stringify({ values: [txToRow(t)] }) }
        );
        if (res.ok) {
          await removePendingEdit(t.id);
        } else if (res.status === 401) {
          window.dispatchEvent(new CustomEvent('google-token-expired'));
          break;
        }
      } catch (err) {
        console.error('[Sync] Edit error:', err.message);
        break;
      }
    }
    return;
  }

  // Legacy fallback
  const apiLink = await getApiLink();
  if (!apiLink || !apiLink.startsWith('http')) return;
  for (const editEntry of pendingEdits) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({ action: 'edit_transaction', secret, transaction: editEntry.transaction, editMetadata: editEntry.editMetadata })
      });
      const result = await response.json();
      if (result.status === 'success') await removePendingEdit(editEntry.transaction.id);
    } catch { break; }
  }
};

// ─── Sync Pending Deletes ─────────────────────────────────────────────────────
export const syncPendingDeletes = async () => {
  if (!navigator.onLine) return;
  const pendingDeletes = await getPendingDeletes();
  if (pendingDeletes.length === 0) return;

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { return; }
    const base = SHEETS_BASE(spreadsheetId);
    const txSheetId = await getTxSheetId(base, hdrs);

    // Reverse order so row indexes remain valid after each deletion
    for (const del of [...pendingDeletes].reverse()) {
      try {
        const rowIndex = await findTxRowIndex(del.txId, base, hdrs);
        if (rowIndex < 0) { await removePendingDelete(del.txId); continue; }
        const res = await fetch(`${base}:batchUpdate`, {
          method: 'POST', headers: hdrs,
          body: JSON.stringify({
            requests: [{ deleteDimension: { range: {
              sheetId: txSheetId, dimension: 'ROWS',
              startIndex: rowIndex - 1, endIndex: rowIndex
            }}}]
          })
        });
        if (res.ok) {
          await removePendingDelete(del.txId);
        } else if (res.status === 401) {
          window.dispatchEvent(new CustomEvent('google-token-expired'));
          break;
        }
      } catch (err) {
        console.error('[Sync] Delete error:', err.message);
        break;
      }
    }
    return;
  }

  // Legacy fallback
  const apiLink = await getApiLink();
  if (!apiLink || !apiLink.startsWith('http')) return;
  for (const del of pendingDeletes) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_transaction', secret, txId: del.txId, deletedBy: del.deletedBy, reason: del.reason })
      });
      const result = await response.json();
      if (result.status === 'success') await removePendingDelete(del.txId);
    } catch { break; }
  }
};

// ─── Push Users (overwrite Users sheet) ──────────────────────────────────────
export const pushUsers = async (users) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    await overwriteSheet(
      'Users',
      ['Name', 'Phone', 'PIN', 'Role', 'IsActive', 'AllowedBooks'],
      users.map(u => [u.Name || '', u.Phone || '', u.PIN || '', u.Role || 'Staff', u.IsActive ?? 'TRUE', u.AllowedBooks || 'ALL']),
      hdrs, base
    );
    return;
  }

  // Legacy
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST', body: JSON.stringify({ action: 'update_users', secret, users })
  });
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Failed to update users.');
};

// ─── Push Categories ──────────────────────────────────────────────────────────
export const pushCategories = async (categories) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    await overwriteSheet(
      'Categories',
      ['ID', 'Name', 'Type'],
      categories.map(c => [c.ID || '', c.Name || '', c.Type || '']),
      hdrs, base
    );
    return;
  }

  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST', body: JSON.stringify({ action: 'update_categories', secret, categories })
  });
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Failed to update categories.');
};

// ─── Push Books ───────────────────────────────────────────────────────────────
export const pushBooks = async (books) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    await overwriteSheet(
      'Books',
      ['ID', 'Name', 'Description', 'CreatedAt'],
      books.map(b => [b.ID || '', b.Name || '', b.Description || '', b.CreatedAt || new Date().toISOString()]),
      hdrs, base
    );
    return;
  }

  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST', body: JSON.stringify({ action: 'update_books', secret, books })
  });
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Failed to update books.');
};

// ─── Push Settings ────────────────────────────────────────────────────────────
export const pushSettings = async (settingsArray) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    const hdrs = await sheetsAuthHeaders();
    const base = SHEETS_BASE(spreadsheetId);
    await overwriteSheet(
      'Settings',
      ['Key', 'Value'],
      settingsArray.map(s => [s.Key || '', s.Value ?? '']),
      hdrs, base
    );
    return;
  }

  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  const secret = await getSecret();
  const response = await fetchWithTimeout(apiLink, {
    method: 'POST', body: JSON.stringify({ action: 'update_settings', secret, settings: settingsArray })
  });
  const result = await response.json();
  if (result.status !== 'success') throw new Error(result.error || 'Failed to update settings.');
};
