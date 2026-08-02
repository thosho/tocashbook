import { 
  getApiLink, getPendingSync, clearPendingSync, saveUsers, saveCategories, saveBooks,
  saveTransactions, setSettings, getTransactions, getPendingEdits, 
  clearPendingEdits, removePendingEdit, getPendingDeletes, removePendingDelete
} from './localDb';
import localforage from 'localforage';

// ─── C2 FIX: Retrieve stored secret key for authenticated requests ────────────
const getSecret = async () => {
  return (await localforage.getItem('apiSecret')) || '';
};
export const setSecret = async (secret) => {
  await localforage.setItem('apiSecret', secret);
};

// ─── C5 FIX: Fetch with 15-second timeout ────────────────────────────────────
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Google server took too long to respond.');
    }
    throw err;
  }
};

// ─── Sheets API Direct Write Helpers ─────────────────────────────────────────
// These bypass Apps Script entirely using the stored OAuth token from setup.
const getSheetsToken = async () => localforage.getItem('googleAccessToken');
const getSheetsId = async () => localforage.getItem('spreadsheetId');

const sheetsAuthHeaders = async () => {
  const token = await getSheetsToken();
  if (!token) throw new Error('No Google token stored. Please run Automated Setup again.');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
};

// Find which spreadsheet row a transaction ID is in (returns 1-based row number)
const findTxRowIndex = async (txId, sheetsBase, hdrs) => {
  const res = await fetch(`${sheetsBase}/values/Transactions!A:A`, { headers: hdrs });
  const data = await res.json();
  const vals = data.values || [];
  for (let i = 1; i < vals.length; i++) { // skip row 1 (header)
    if (vals[i][0] === txId) return i + 1; // 1-based
  }
  return -1;
};

// Get the numeric sheetId for the Transactions sheet (needed for row deletion)
const getTxSheetId = async (sheetsBase, hdrs) => {
  const res = await fetch(`${sheetsBase}?fields=sheets.properties`, { headers: hdrs });
  const info = await res.json();
  const sheet = (info.sheets || []).find(s => s.properties.title === 'Transactions');
  return sheet ? sheet.properties.sheetId : 0;
};

// ─── Fetch All Data from Google Sheets ───────────────────────────────────────
export const fetchAllData = async () => {
  if (!navigator.onLine) {
    throw new Error("No Internet Connection! Please check your network and try again.");
  }
  
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  
  let response;
  try {
    const secret = await getSecret();
    response = await fetchWithTimeout(`${apiLink}?action=get_all_data&secret=${encodeURIComponent(secret)}`);
  } catch (error) {
    throw new Error("Could not connect to Google Spreadsheet: " + error.message);
  }
  
  if (!response.ok) {
    throw new Error(`Server responded with status ${response.status}. Check your App Script link.`);
  }
  
  const data = await response.json();
  
  if (data.status === 'success') {
    if (data.users) await saveUsers(data.users);
    if (data.categories) {
      // Deduplicate by ID to prevent React key conflicts
      const catMap = new Map();
      data.categories.forEach(c => catMap.set(String(c.ID), c));
      await saveCategories(Array.from(catMap.values()));
    }
    if (data.books) {
      const bookMap = new Map();
      data.books.forEach(b => bookMap.set(String(b.ID), b));
      await saveBooks(Array.from(bookMap.values()));
    }
    
    // Save settings mapping to localforage
    if (data.settings) {
      // Preserve local-only settings (DarkMode) when syncing
      const existingSettings = await localforage.getItem('settings') || {};
      let settingsObj = { ...existingSettings };
      data.settings.forEach(s => {
        settingsObj[s.Key] = s.Value;
      });
      await setSettings(settingsObj);
    }
    
    // Merge server data with pending offline entries
    // so that offline entries are NOT wiped when syncing
    if (data.transactions) {
      const serverTx = data.transactions.map(t => ({
        id: t.ID,
        date: t.Date,
        type: t.Type,
        category: t.Category,
        partyName: t.PartyName || '',
        partyPhone: t.PartyPhone || '',
        amount: parseFloat(t.Amount) || 0,
        paymentMode: t.PaymentMode || 'Cash',
        reference: t.Reference || '',
        remarks: t.Remarks,
        user: t.User,
        imageUrl: t.ImageUrl,
        bossNotes: t.BossNotes || '',
        recurring: t.Recurring || 'none',
        bookId: t.BookID || 'book_main',
        editHistory: (() => {
          try { return JSON.parse(t.EditHistory || '[]'); } catch { return []; }
        })(),
        synced: true
      }));
      
      // Preserve ALL local-only unsynced entries (not just from pendingSync queue)
      const serverIds = new Set(serverTx.map(t => t.id));
      const allLocal = await getTransactions();
      const localOnly = allLocal.filter(t => !t.synced && !serverIds.has(t.id));
      
      const merged = [...serverTx, ...localOnly];
      await localforage.setItem('transactions', merged);
    }
  } else {
    throw new Error(data.error || "Failed to fetch data from Google Spreadsheet.");
  }
};

// ─── Edit Transaction on Server ───────────────────────────────────────────────
export const editTransactionAPI = async (transaction, editMetadata) => {
  if (!navigator.onLine) throw new Error("No Internet Connection! Cannot edit offline.");
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  
  let response;
  try {
    const secret = await getSecret();
    response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({
        action: 'edit_transaction',
        secret,
        transaction,
        editMetadata
      })
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error(result.error || "Server failed to update the transaction.");
    }
  } catch (error) {
    throw new Error("Could not complete edit on Google Spreadsheet: " + error.message);
  }
};

// ─── H2 FIX: Sync Pending New Transactions via Sheets API directly ───────────
// Writes new transaction rows to Google Sheets using the stored OAuth token,
// completely bypassing the Apps Script authorization requirement.
export const syncOfflineTransactions = async () => {
  if (!navigator.onLine) return;
  const pending = await getPendingSync();
  if (pending.length === 0) return;

  // Prefer Sheets API (works immediately after setup, no auth step needed)
  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { /* fall through to Apps Script */ }
    
    if (hdrs) {
      const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
      const allTx = await getTransactions();
      const successIds = new Set();

      for (const t of pending) {
        try {
          const row = [
            t.id, new Date().toISOString(), t.date, t.type, t.category || '',
            t.partyName || '', t.partyPhone || '', t.amount, t.paymentMode || 'Cash',
            t.reference || '', t.remarks || '', t.user || '', t.imageUrl || '',
            '', t.bossNotes || '', t.recurring || 'none', t.bookId || 'book_main', t.upiApp || ''
          ];
          const res = await fetch(
            `${sheetsBase}/values/Transactions!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', headers: hdrs, body: JSON.stringify({ values: [row] }) }
          );
          if (res.ok) {
            successIds.add(t.id);
          } else if (res.status === 401) {
            // Token expired — stop, entries remain pending until user refreshes
            console.warn('[Sync] Google token expired. Entries will sync after app refresh.');
            break;
          }
        } catch (err) {
          console.error('[Sync] Error syncing tx via Sheets API:', t.id, err.message);
          break;
        }
      }

      if (successIds.size > 0) {
        const remaining = pending.filter(t => !successIds.has(t.id));
        await localforage.setItem('pendingSync', remaining);
        const updated = allTx.map(t => successIds.has(t.id) ? { ...t, synced: true } : t);
        await localforage.setItem('transactions', updated);
      }
      return; // Done via Sheets API
    }
  }

  // Fallback: Apps Script (only runs if Sheets API token not available)
  const apiLink = await getApiLink();
  if (!apiLink) return;
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
    } catch (error) {
      console.error('[Sync] Apps Script fallback failed:', t.id, error.message);
      break;
    }
  }
  if (successIds.size > 0) {
    const remaining = pending.filter(t => !successIds.has(t.id));
    await localforage.setItem('pendingSync', remaining);
    const updated = allTx.map(t => successIds.has(t.id) ? { ...t, synced: true } : t);
    await localforage.setItem('transactions', updated);
  }
};

// ─── Sync Pending Edits via Sheets API directly ───────────────────────────────
export const syncPendingEdits = async () => {
  if (!navigator.onLine) return;
  const pendingEdits = await getPendingEdits();
  if (pendingEdits.length === 0) return;

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { /* fall through */ }

    if (hdrs) {
      const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
      for (const editEntry of pendingEdits) {
        try {
          const t = editEntry.transaction;
          const rowIndex = await findTxRowIndex(t.id, sheetsBase, hdrs);
          if (rowIndex < 0) { await removePendingEdit(t.id); continue; }

          const row = [
            t.id, new Date().toISOString(), t.date, t.type, t.category || '',
            t.partyName || '', t.partyPhone || '', t.amount, t.paymentMode || 'Cash',
            t.reference || '', t.remarks || '', t.user || '', t.imageUrl || '',
            JSON.stringify(t.editHistory || []), t.bossNotes || '',
            t.recurring || 'none', t.bookId || 'book_main', t.upiApp || ''
          ];
          const res = await fetch(
            `${sheetsBase}/values/Transactions!A${rowIndex}:R${rowIndex}?valueInputOption=RAW`,
            { method: 'PUT', headers: hdrs, body: JSON.stringify({ values: [row] }) }
          );
          if (res.ok) {
            await removePendingEdit(t.id);
          } else if (res.status === 401) {
            break; // token expired
          }
        } catch (err) {
          console.error('[Sync] Edit sync error:', err.message);
          break;
        }
      }
      return;
    }
  }

  // Fallback: Apps Script
  const apiLink = await getApiLink();
  if (!apiLink) return;
  for (const editEntry of pendingEdits) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({
          action: 'edit_transaction', secret,
          transaction: editEntry.transaction,
          editMetadata: editEntry.editMetadata
        })
      });
      const result = await response.json();
      if (result.status === 'success') await removePendingEdit(editEntry.transaction.id);
    } catch (error) {
      console.error('[Sync] Apps Script edit fallback failed:', error.message);
      break;
    }
  }
};

// ─── H6 FIX: Sync Pending Deletes via Sheets API directly ────────────────────
export const syncPendingDeletes = async () => {
  if (!navigator.onLine) return;
  const pendingDeletes = await getPendingDeletes();
  if (pendingDeletes.length === 0) return;

  const spreadsheetId = await getSheetsId();
  if (spreadsheetId) {
    let hdrs;
    try { hdrs = await sheetsAuthHeaders(); } catch { /* fall through */ }

    if (hdrs) {
      const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
      const txSheetId = await getTxSheetId(sheetsBase, hdrs);

      // Process in reverse order so row indexes don't shift during deletion
      const sorted = [...pendingDeletes].reverse();
      for (const del of sorted) {
        try {
          const rowIndex = await findTxRowIndex(del.txId, sheetsBase, hdrs);
          if (rowIndex < 0) { await removePendingDelete(del.txId); continue; }

          const res = await fetch(`${sheetsBase}:batchUpdate`, {
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
            break; // token expired
          }
        } catch (err) {
          console.error('[Sync] Delete sync error:', err.message);
          break;
        }
      }
      return;
    }
  }

  // Fallback: Apps Script
  const apiLink = await getApiLink();
  if (!apiLink) return;
  for (const del of pendingDeletes) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_transaction', secret,
          txId: del.txId, deletedBy: del.deletedBy, reason: del.reason
        })
      });
      const result = await response.json();
      if (result.status === 'success') await removePendingDelete(del.txId);
    } catch (error) {
      console.error('[Sync] Apps Script delete fallback failed:', error.message);
      break;
    }
  }
};

// ─── Delete Transaction on Server ────────────────────────────────────────────
export const deleteTransactionAPI = async (txId, deletedBy, reason) => {
  if (!navigator.onLine) throw new Error('No Internet Connection!');
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error('API Link not configured.');
  try {
    const secret = await getSecret();
    const response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_transaction', secret, txId, deletedBy, reason })
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.error || 'Server failed to delete the transaction.');
  } catch (error) {
    throw new Error('Could not delete transaction on server: ' + error.message);
  }
};

// ─── H5 FIX: All push functions now check server response ────────────────────
export const pushUsers = async (users) => {
  if (!navigator.onLine) throw new Error("No Internet Connection!");
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  try {
    const secret = await getSecret();
    const response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({ action: 'update_users', secret, users })
    });
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.error || 'Server failed to update users.');
  } catch (e) {
    throw new Error("Could not update users: " + e.message);
  }
};

export const pushCategories = async (categories) => {
  if (!navigator.onLine) throw new Error("No Internet Connection!");
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  try {
    const secret = await getSecret();
    const response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({ action: 'update_categories', secret, categories })
    });
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.error || 'Server failed to update categories.');
  } catch (e) {
    throw new Error("Could not update categories: " + e.message);
  }
};

export const pushSettings = async (settingsArray) => {
  if (!navigator.onLine) throw new Error("No Internet Connection!");
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  try {
    const secret = await getSecret();
    const response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({ action: 'update_settings', secret, settings: settingsArray })
    });
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.error || 'Server failed to update settings.');
  } catch (e) {
    throw new Error("Could not update settings: " + e.message);
  }
};

export const pushBooks = async (books) => {
  if (!navigator.onLine) throw new Error("No Internet Connection!");
  const apiLink = await getApiLink();
  if (!apiLink) throw new Error("API Link not configured.");
  try {
    const secret = await getSecret();
    const response = await fetchWithTimeout(apiLink, {
      method: 'POST',
      body: JSON.stringify({ action: 'update_books', secret, books })
    });
    const result = await response.json();
    if (result.status !== 'success') throw new Error(result.error || 'Server failed to update books.');
  } catch (e) {
    throw new Error("Could not update books: " + e.message);
  }
};
