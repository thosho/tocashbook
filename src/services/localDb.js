import localforage from 'localforage';

localforage.config({
  name: 'ToCashbook',
  storeName: 'ledgerData'
});

// ─── H1 FIX: Collision-safe ID generator ─────────────────────────────────────
// Date.now() alone has ms precision — two entries at the same millisecond collide.
// Adding a 5-char random suffix makes collision probability negligible.
export const generateTxId = () =>
  'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

export const initDb = async () => {
  const users = await localforage.getItem('users');
  if (!users) {
    await localforage.setItem('users', []);
  }
  const transactions = await localforage.getItem('transactions');
  if (!transactions) {
    await localforage.setItem('transactions', []);
  }
  const categories = await localforage.getItem('categories');
  if (!categories) {
    await localforage.setItem('categories', [
      { ID: 'cat_1', Name: 'Salary', Type: 'Income' },
      { ID: 'cat_2', Name: 'Sales', Type: 'Income' },
      { ID: 'cat_3', Name: 'Food', Type: 'Expense' },
      { ID: 'cat_4', Name: 'Transport', Type: 'Expense' }
    ]);
  }
  const books = await localforage.getItem('books');
  if (!books) {
    await localforage.setItem('books', [
      { ID: 'book_main', Name: 'Main Book', Description: 'Default business ledger', CreatedAt: new Date().toISOString() }
    ]);
  }
  const pendingSync = await localforage.getItem('pendingSync');
  if (!pendingSync) {
    await localforage.setItem('pendingSync', []);
  }
  const pendingEdits = await localforage.getItem('pendingEdits');
  if (!pendingEdits) {
    await localforage.setItem('pendingEdits', []);
  }
  // H6 FIX: Init pending deletes queue
  const pendingDeletes = await localforage.getItem('pendingDeletes');
  if (!pendingDeletes) {
    await localforage.setItem('pendingDeletes', []);
  }
};

// --- Transactions ---
export const getTransactions = async () => {
  return (await localforage.getItem('transactions')) || [];
};

export const saveTransactions = async (transactions) => {
  await localforage.setItem('transactions', transactions);
};

export const addTransaction = async (transaction) => {
  // H3 FIX: Always mark new transactions as synced: false explicitly
  const txWithFlag = { ...transaction, synced: false };
  const transactions = await getTransactions();
  transactions.push(txWithFlag);
  await localforage.setItem('transactions', transactions);
  
  // Strip large imageFile before queuing for sync (prevents storage bloat)
  const { imageFile, imageFilename, ...syncSafe } = txWithFlag;
  const pendingSync = (await localforage.getItem('pendingSync')) || [];
  pendingSync.push(syncSafe);
  await localforage.setItem('pendingSync', pendingSync);
};

export const updateTransactionLocally = async (transaction, editMetadata) => {
  const transactions = await getTransactions();
  const index = transactions.findIndex(t => t.id === transaction.id);
  if (index !== -1) {
    if (!transaction.editHistory) transaction.editHistory = [];
    transaction.editHistory.push(editMetadata);
    transactions[index] = transaction;
    await localforage.setItem('transactions', transactions);
  }
};

// --- Pending Sync Queue (New Transactions) ---
export const getPendingSync = async () => {
  return (await localforage.getItem('pendingSync')) || [];
};

export const clearPendingSync = async () => {
  await localforage.setItem('pendingSync', []);
};

// --- Pending Edits Queue (Offline Edits) ---
export const addPendingEdit = async (transaction, editMetadata) => {
  const pendingEdits = (await localforage.getItem('pendingEdits')) || [];
  // Replace existing edit for same transaction ID if present
  const existingIdx = pendingEdits.findIndex(e => e.transaction.id === transaction.id);
  const editEntry = { transaction, editMetadata };
  if (existingIdx !== -1) {
    pendingEdits[existingIdx] = editEntry;
  } else {
    pendingEdits.push(editEntry);
  }
  await localforage.setItem('pendingEdits', pendingEdits);
};

export const getPendingEdits = async () => {
  return (await localforage.getItem('pendingEdits')) || [];
};

export const clearPendingEdits = async () => {
  await localforage.setItem('pendingEdits', []);
};

export const removePendingEdit = async (txId) => {
  const pendingEdits = await getPendingEdits();
  await localforage.setItem('pendingEdits', pendingEdits.filter(e => e.transaction.id !== txId));
};

// ─── H6 FIX: Pending Deletes Queue (Offline Deletions) ───────────────────────
export const addPendingDelete = async (txId, deletedBy, reason) => {
  const pendingDeletes = (await localforage.getItem('pendingDeletes')) || [];
  // Avoid duplicate queuing for same txId
  if (!pendingDeletes.find(d => d.txId === txId)) {
    pendingDeletes.push({ txId, deletedBy, reason, queuedAt: new Date().toISOString() });
    await localforage.setItem('pendingDeletes', pendingDeletes);
  }
};

export const getPendingDeletes = async () => {
  return (await localforage.getItem('pendingDeletes')) || [];
};

export const removePendingDelete = async (txId) => {
  const pendingDeletes = await getPendingDeletes();
  await localforage.setItem('pendingDeletes', pendingDeletes.filter(d => d.txId !== txId));
};

// --- Delete Transaction ---
export const deleteTransaction = async (txId) => {
  const transactions = await getTransactions();
  const updated = transactions.filter(t => t.id !== txId);
  await localforage.setItem('transactions', updated);
  // Also remove from pendingSync if it exists there
  const pendingSync = (await localforage.getItem('pendingSync')) || [];
  await localforage.setItem('pendingSync', pendingSync.filter(t => t.id !== txId));
  // Also remove from pendingEdits
  await removePendingEdit(txId);
};

// --- Users ---
export const getUsers = async () => {
  return (await localforage.getItem('users')) || [];
};

export const saveUsers = async (users) => {
  await localforage.setItem('users', users);
};

// --- Categories ---
export const getCategories = async () => {
  return (await localforage.getItem('categories')) || [];
};

export const saveCategories = async (categories) => {
  await localforage.setItem('categories', categories);
};

export const addCategory = async (category) => {
  const categories = await getCategories();
  categories.push(category);
  await localforage.setItem('categories', categories);
};

// --- Books ---
export const getBooks = async () => {
  return (await localforage.getItem('books')) || [];
};

export const saveBooks = async (books) => {
  await localforage.setItem('books', books);
};

// --- API Link ---
export const getApiLink = async () => {
  return await localforage.getItem('apiLink');
};

export const setApiLink = async (link) => {
  await localforage.setItem('apiLink', link);
};

// --- API Secret Key ---
export const getApiSecret = async () => {
  return await localforage.getItem('apiSecret');
};

export const setApiSecret = async (secret) => {
  await localforage.setItem('apiSecret', secret);
};

// --- Database Export / Import ---
export const exportDatabase = async () => {
  const data = {
    users: await getUsers(),
    transactions: await getTransactions(),
    categories: await getCategories(),
    books: await getBooks(),
    apiLink: await getApiLink(),
    apiSecret: await getApiSecret()
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  const dateStr = new Date().toISOString().split('T')[0];
  downloadAnchorNode.setAttribute("download", `tocashbook_backup_${dateStr}.json`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};

// ─── H4 FIX: Validate backup file schema before importing ────────────────────
export const importDatabase = async (jsonData) => {
  let data;
  try {
    data = JSON.parse(jsonData);
  } catch (_) {
    throw new Error('Invalid backup file: not valid JSON.');
  }

  // Ensure the backup has the expected structure
  if (!data || typeof data !== 'object') throw new Error('Invalid backup file: empty or wrong format.');
  if (!Array.isArray(data.transactions)) throw new Error('Invalid backup file: missing transactions array.');
  if (!Array.isArray(data.users)) throw new Error('Invalid backup file: missing users array.');

  if (data.users) await saveUsers(data.users);
  if (data.transactions) await localforage.setItem('transactions', data.transactions);
  if (data.categories) await saveCategories(data.categories);
  if (data.books) await saveBooks(data.books);
  if (data.apiLink) await setApiLink(data.apiLink);
  if (data.apiSecret !== undefined) await setApiSecret(data.apiSecret);
  // Clear pending queues to avoid re-syncing already-imported data
  await localforage.setItem('pendingSync', []);
  await localforage.setItem('pendingEdits', []);
  await localforage.setItem('pendingDeletes', []);
};

// ─── Settings ─────────────────────────────────────────────────────────────────
// M3 FIX: Default settings use empty strings instead of fake hardcoded values
// so new users don't accidentally see "123 Main St" or "9876543210" on receipts.
export const getSettings = async () => {
  return await localforage.getItem('settings') || {
    BrandName: '',
    Address: '',
    Phone: '',
    DateFormat: 'DD/MM/YYYY',
    DarkMode: 'auto',
    OpeningBalance: '0',
    SessionTimeout: '30'
  };
};

export const setSettings = async (settings) => {
  await localforage.setItem('settings', settings);
};

// --- Pending Sync Count (for badge) ---
export const getPendingCount = async () => {
  const sync = await getPendingSync();
  const edits = await getPendingEdits();
  const deletes = await getPendingDeletes();
  return sync.length + edits.length + deletes.length;
};
