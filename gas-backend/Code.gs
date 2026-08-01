// Code.gs - Google Apps Script Backend for ToCashBook
// ─────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS SETUP (using ntfy.sh — free, no account needed):
//   1. In App Settings → Notifications, set a Topic Name (e.g. "myshop-2024")
//   2. Save Settings → NtfyTopic gets stored here automatically
//   3. Boss taps "Enable on This Device" on their phone
//   4. Every new staff entry sends a notification via ntfy.sh
// ─────────────────────────────────────────────────────────────────────────────

let NTFY_TOPIC = ''; // Auto-loaded from Settings sheet

// ─── C2 FIX: Secret Key Authentication ───────────────────────────────────────
// Store your secret key in Apps Script: File → Project Properties → Script Properties
// Key: APP_SECRET  Value: (any long random string you choose, e.g. "myshop_secret_2024")
// This prevents anyone else from reading or modifying your data even if they find the URL.
function getSecretKey() {
  return PropertiesService.getScriptProperties().getProperty('APP_SECRET') || '';
}

function isAuthorized(requestSecret) {
  const secret = getSecretKey();
  // If no secret has been configured yet, allow access (backward compatibility for first setup)
  if (!secret) return true;
  return requestSecret === secret;
}

// ─── Sheet Setup ─────────────────────────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let usersSheet = ss.getSheetByName('Users');
  if (!usersSheet) {
    usersSheet = ss.insertSheet('Users');
    usersSheet.appendRow(['Name', 'Phone', 'PIN', 'Role', 'IsActive', 'AllowedBooks']);
    usersSheet.appendRow(['Admin', 'boss', '1234', 'Admin', 'TRUE', 'ALL']);
  } else {
    // Add AllowedBooks column if missing
    let headers = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('AllowedBooks') === -1) {
      usersSheet.getRange(1, headers.length + 1).setValue('AllowedBooks');
    }
  }

  let transSheet = ss.getSheetByName('Transactions');
  if (!transSheet) {
    transSheet = ss.insertSheet('Transactions');
    transSheet.appendRow(['ID','Timestamp','Date','Type','Category','PartyName','PartyPhone','Amount','PaymentMode','Reference','Remarks','User','ImageUrl','EditHistory','BossNotes','Recurring','BookID']);
  } else {
    // Add BookID column if missing
    let headers = transSheet.getRange(1, 1, 1, transSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('BookID') === -1) {
      transSheet.getRange(1, headers.length + 1).setValue('BookID');
    }
  }

  let booksSheet = ss.getSheetByName('Books');
  if (!booksSheet) {
    booksSheet = ss.insertSheet('Books');
    booksSheet.appendRow(['ID', 'Name', 'Description', 'CreatedAt']);
    booksSheet.appendRow(['book_main', 'Main Book', 'Default business ledger', new Date().toISOString()]);
  }

  let catSheet = ss.getSheetByName('Categories');
  if (!catSheet) {
    catSheet = ss.insertSheet('Categories');
    catSheet.appendRow(['ID', 'Name', 'Type']);
    catSheet.appendRow(['cat_1', 'Salary', 'Income']);
    catSheet.appendRow(['cat_2', 'Sales', 'Income']);
    catSheet.appendRow(['cat_3', 'Food', 'Expense']);
    catSheet.appendRow(['cat_4', 'Transport', 'Expense']);
  }

  let setSheet = ss.getSheetByName('Settings');
  if (!setSheet) {
    setSheet = ss.insertSheet('Settings');
    setSheet.appendRow(['Key', 'Value']);
    setSheet.appendRow(['BrandName', 'My Business']);
    setSheet.appendRow(['Address', '']);
    setSheet.appendRow(['Phone', '']);
    setSheet.appendRow(['Email', '']);
    setSheet.appendRow(['Website', '']);
    setSheet.appendRow(['SocialMedia', '']);
    setSheet.appendRow(['Tagline', '']);
    setSheet.appendRow(['UpiId', '']);
    setSheet.appendRow(['NtfyTopic', '']);
    setSheet.appendRow(['OpeningBalance', '0']);
    setSheet.appendRow(['SessionTimeout', '30']);
    setSheet.appendRow(['DateFormat', 'DD/MM/YYYY']);
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────
function doGet(e) {
  const action = e.parameter.action;
  const secret = e.parameter.secret || '';

  // C2 FIX: Verify secret key on all requests
  if (!isAuthorized(secret)) {
    return json({ status: 'error', error: 'Unauthorized' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Auto-initialize the database if this is a fresh automated setup
  if (!ss.getSheetByName('Users')) {
    initializeDatabase();
  }

  if (action === 'get_all_data') {
    return json({
      status: 'success',
      users: getSheetDataAsJson(ss.getSheetByName('Users')),
      transactions: getSheetDataAsJson(ss.getSheetByName('Transactions')),
      categories: getSheetDataAsJson(ss.getSheetByName('Categories')),
      settings: getSheetDataAsJson(ss.getSheetByName('Settings')),
      books: getSheetDataAsJson(ss.getSheetByName('Books'))
    });
  }
  return json({ error: 'Invalid action' });
}

// ─── POST ────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // C2 FIX: Verify secret key on all POST requests
    if (!isAuthorized(data.secret || '')) {
      return json({ status: 'error', error: 'Unauthorized' });
    }

    if (data.action === 'add_transaction') {
      const sheet = ss.getSheetByName('Transactions');
      const t = data.transaction;
      let imageUrl = '';
      if (t.imageFile && t.imageFilename) imageUrl = saveImageToDrive(t.imageFile, t.imageFilename);
      sheet.appendRow([t.id, new Date().toISOString(), t.date, t.type, t.category,
        t.partyName||'', t.partyPhone||'', t.amount, t.paymentMode||'', t.reference||'',
        t.remarks||'', t.user, imageUrl, '[]', t.bossNotes||'', t.recurring||'none', t.bookId||'book_main']);
      sendPushNotification(ss, t);
      return json({ status: 'success', message: 'Transaction added' });
    }

    if (data.action === 'edit_transaction') {
      const sheet = ss.getSheetByName('Transactions');
      if (sheet.getMaxColumns() < 18) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), 18 - sheet.getMaxColumns());
      }
      const t = data.transaction;
      const rows = sheet.getDataRange().getValues();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) { if (rows[i][0] === t.id) { rowIndex = i+1; break; } }
      if (rowIndex === -1) return json({ error: 'Transaction not found' });
      let imageUrl = rows[rowIndex-1][12];
      if (t.imageFile && t.imageFilename) imageUrl = saveImageToDrive(t.imageFile, t.imageFilename);
      let hist = [];
      try { hist = JSON.parse(rows[rowIndex-1][13]||'[]'); } catch(_) {}
      hist.push(data.editMetadata);
      sheet.getRange(rowIndex, 1, 1, 18).setValues([[
        t.id, rows[rowIndex-1][1], t.date, t.type, t.category,
        t.partyName||'', t.partyPhone||'', t.amount, t.paymentMode||'', t.reference||'',
        t.remarks||'', rows[rowIndex-1][11], imageUrl, JSON.stringify(hist),
        t.bossNotes||rows[rowIndex-1][14]||'', t.recurring||rows[rowIndex-1][15]||'none',
        t.bookId||rows[rowIndex-1][16]||'book_main', t.upiApp||rows[rowIndex-1][17]||''
      ]]);
      return json({ status: 'success', message: 'Transaction updated' });
    }

    if (data.action === 'sync_transactions') {
      const sheet = ss.getSheetByName('Transactions');
      if (sheet.getMaxColumns() < 18) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), 18 - sheet.getMaxColumns());
      }
      // BUG-04 FIX: Check for existing IDs before appending to prevent duplicates
      const existingRows = sheet.getDataRange().getValues();
      const existingIds = new Set(existingRows.slice(1).map(r => String(r[0])));
      let addedCount = 0;
      data.transactions.forEach(t => {
        if (existingIds.has(String(t.id))) return; // Skip duplicate
        let imageUrl = '';
        if (t.imageFile && t.imageFilename) imageUrl = saveImageToDrive(t.imageFile, t.imageFilename);
        sheet.appendRow([t.id, new Date().toISOString(), t.date, t.type, t.category,
          t.partyName||'', t.partyPhone||'', t.amount, t.paymentMode||'', t.reference||'',
          t.remarks||'', t.user, imageUrl, '[]', t.bossNotes||'', t.recurring||'none', t.bookId||'book_main', t.upiApp||'']);
        existingIds.add(String(t.id)); // Track newly added
        addedCount++;
      });
      return json({ status: 'success', count: addedCount });
    }

    if (data.action === 'delete_transaction') {
      const sheet = ss.getSheetByName('Transactions');
      const rows = sheet.getDataRange().getValues();
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.txId)) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return json({ status: 'success', message: 'Already removed or not found' });
      sheet.deleteRow(rowIndex);
      // Log deletion in a DeletedLog sheet
      let logSheet = ss.getSheetByName('DeletedLog');
      if (!logSheet) {
        logSheet = ss.insertSheet('DeletedLog');
        logSheet.appendRow(['TxID','DeletedBy','Reason','DeletedAt']);
      }
      logSheet.appendRow([data.txId, data.deletedBy||'', data.reason||'', new Date().toISOString()]);
      return json({ status: 'success', message: 'Transaction deleted' });
    }

    if (data.action === 'update_users') {
      const sheet = ss.getSheetByName('Users');
      sheet.clearContents();
      sheet.appendRow(['Name','Phone','PIN','Role','IsActive','AllowedBooks']);
      data.users.forEach(u => sheet.appendRow([u.Name || u.Username, u.Phone || u.Username, u.PIN, u.Role, u.IsActive, u.AllowedBooks || '']));
      return json({ status: 'success' });
    }

    if (data.action === 'update_books') {
      const sheet = ss.getSheetByName('Books');
      sheet.clearContents();
      sheet.appendRow(['ID','Name','Description','CreatedAt']);
      data.books.forEach(b => sheet.appendRow([b.ID, b.Name, b.Description, b.CreatedAt]));
      return json({ status: 'success' });
    }

    if (data.action === 'update_categories') {
      const sheet = ss.getSheetByName('Categories');
      sheet.clearContents();
      sheet.appendRow(['ID','Name','Type']);
      data.categories.forEach(c => sheet.appendRow([c.ID, c.Name, c.Type]));
      return json({ status: 'success' });
    }

    if (data.action === 'update_settings') {
      const sheet = ss.getSheetByName('Settings');
      sheet.clearContents();
      sheet.appendRow(['Key','Value']);
      data.settings.forEach(s => {
        sheet.appendRow([s.Key, s.Value]);
        if (s.Key === 'NtfyTopic' && s.Value) NTFY_TOPIC = s.Value;
      });
      return json({ status: 'success' });
    }

    return json({ error: 'Invalid action' });
  } catch (err) {
    return json({ status: 'error', error: err.message });
  }
}

// ─── Push via ntfy.sh ────────────────────────────────────────────────────────
function sendPushNotification(ss, t) {
  try {
    if (!NTFY_TOPIC) {
      const rows = ss.getSheetByName('Settings')?.getDataRange().getValues() || [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'NtfyTopic' && rows[i][1]) { NTFY_TOPIC = rows[i][1]; break; }
      }
    }
    if (!NTFY_TOPIC) return;
    const emoji = t.type === 'Income' ? '✅' : '🔴';
    const title = emoji + ' New ' + t.type + ' Entry';
    const body = (t.type === 'Income' ? '+' : '-') + '₹' + t.amount + ' · ' + t.category
      + (t.partyName ? ' · ' + t.partyName : '') + ' (by ' + t.user + ')';
    UrlFetchApp.fetch('https://ntfy.sh/' + NTFY_TOPIC, {
      method: 'post',
      headers: {
        'Title': title,
        'Priority': t.type === 'Expense' ? '3' : '2',
        'Tags': t.type === 'Income' ? 'white_check_mark,moneybag' : 'red_circle,money_with_wings',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      payload: body,
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('ntfy error: ' + err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetDataAsJson(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
}

function saveImageToDrive(base64Data, filename) {
  try {
    let folder;
    const folders = DriveApp.getFoldersByName('OpenCashbook_Receipts');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('OpenCashbook_Receipts');
    const contentType = base64Data.substring(5, base64Data.indexOf(';'));
    const base64Str = base64Data.substring(base64Data.indexOf(',') + 1);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Str), contentType, filename);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    console.error('Image save error: ' + e.message);
    return '';
  }
}
