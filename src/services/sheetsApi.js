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
// Prevents the app from hanging forever if Google's servers are slow.
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

// ─── H2 FIX: Sync Pending New Transactions — one by one to handle partial failures
// Previously sent all as a batch; if server failed midway, ALL would be retried
// causing duplicates. Now each succeeds or fails independently.
export const syncOfflineTransactions = async () => {
  if (!navigator.onLine) return;
  const apiLink = await getApiLink();
  if (!apiLink) return;
  
  const pending = await getPendingSync();
  if (pending.length === 0) return;

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
      if (result.status === 'success') {
        successIds.add(t.id);
      }
    } catch (error) {
      // Network error — stop syncing but keep remaining in queue
      console.error("Failed to sync tx:", t.id, error.message);
      break;
    }
  }

  if (successIds.size > 0) {
    // Remove only successfully synced ones from the pending queue
    const remaining = pending.filter(t => !successIds.has(t.id));
    await localforage.setItem('pendingSync', remaining);

    // Mark them as synced in local db
    const updated = allTx.map(t => successIds.has(t.id) ? { ...t, synced: true } : t);
    await localforage.setItem('transactions', updated);
  }
};

// ─── Sync Pending Edits (offline edits queue) ─────────────────────────────────
export const syncPendingEdits = async () => {
  if (!navigator.onLine) return;
  const apiLink = await getApiLink();
  if (!apiLink) return;
  
  const pendingEdits = await getPendingEdits();
  if (pendingEdits.length === 0) return;
  
  for (const editEntry of pendingEdits) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({
          action: 'edit_transaction',
          secret,
          transaction: editEntry.transaction,
          editMetadata: editEntry.editMetadata
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        await removePendingEdit(editEntry.transaction.id);
      }
    } catch (error) {
      console.error("Failed to sync edit for tx:", editEntry.transaction.id, error.message);
      break; // Stop syncing edits if connection fails
    }
  }
};

// ─── H6 FIX: Sync Pending Deletes (offline deletions) ────────────────────────
export const syncPendingDeletes = async () => {
  if (!navigator.onLine) return;
  const apiLink = await getApiLink();
  if (!apiLink) return;

  const pendingDeletes = await getPendingDeletes();
  if (pendingDeletes.length === 0) return;

  for (const del of pendingDeletes) {
    try {
      const secret = await getSecret();
      const response = await fetchWithTimeout(apiLink, {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_transaction',
          secret,
          txId: del.txId,
          deletedBy: del.deletedBy,
          reason: del.reason
        })
      });
      const result = await response.json();
      if (result.status === 'success') {
        await removePendingDelete(del.txId);
      }
    } catch (error) {
      console.error("Failed to sync delete for tx:", del.txId, error.message);
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
