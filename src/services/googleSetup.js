/**
 * googleSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the "Automated Setup (Sign in with Google)" flow.
 *
 * Architecture: Direct Google Sheets API — NO Apps Script.
 *
 * Flow:
 *   1. Search Google Drive for an existing "Open Cashbook Database" spreadsheet.
 *   2. If found → reuse it. One Google account = one database, always.
 *   3. If not found → create a new spreadsheet.
 *   4. Ensure all required sheets (tabs) exist.
 *   5. If any sheet is missing data → seed it with defaults.
 *   6. Return { spreadsheetId, accessToken } — that's it. No Apps Script needed.
 *
 * Multi-device: Boss signs in on any device → finds the same spreadsheet → connected.
 * Data safety: Existing data is NEVER overwritten. Only missing structure is added.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SPREADSHEET_NAME = 'Open Cashbook Database';

/**
 * Find-or-Create Google Spreadsheet, then ensure all sheets are initialized.
 * @param {string} accessToken - Google OAuth access token
 * @returns {Promise<{ spreadsheetId: string, accessToken: string }>}
 */
export async function setupGoogleBackend(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // ── STEP 1: Search for an existing spreadsheet ──────────────────────────────
  // One Gmail account = one spreadsheet, always. Never create duplicates.
  console.log('[Setup] Step 1: Searching for existing spreadsheet...');
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(`name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`)}` +
    `&fields=files(id,name,createdTime)&orderBy=createdTime asc`,
    { headers }
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error('Could not search Google Drive: ' + errText);
  }

  const searchData = await searchRes.json();
  let spreadsheetId = null;
  let isExisting = false;

  if (searchData.files && searchData.files.length > 0) {
    // ✅ Found existing spreadsheet — reuse it. Data is safe.
    spreadsheetId = searchData.files[0].id;
    isExisting = true;
    console.log('[Setup] Found existing spreadsheet:', spreadsheetId, '— reusing it.');
  } else {
    // 🆕 No spreadsheet found — create one for the first time.
    console.log('[Setup] No existing spreadsheet found. Creating new one...');
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: { title: SPREADSHEET_NAME },
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error('Failed to create Google Spreadsheet: ' + errText);
    }
    const createData = await createRes.json();
    spreadsheetId = createData.spreadsheetId;
    console.log('[Setup] New spreadsheet created:', spreadsheetId);
  }

  // ── STEP 2: Ensure all required sheets (tabs) exist ────────────────────────
  // Non-destructive: only adds missing sheets, never deletes existing ones.
  await ensureSheets(spreadsheetId, headers);

  // ── STEP 3: Seed default data if sheets are empty ──────────────────────────
  // Checks for data before writing — never overwrites existing entries.
  await seedDefaultData(spreadsheetId, headers);

  return { spreadsheetId, accessToken, isExisting };
}

/**
 * Ensure all required sheet tabs exist in the spreadsheet.
 * Only creates sheets that are missing — never touches existing ones.
 */
async function ensureSheets(spreadsheetId, headers) {
  const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const infoRes = await fetch(sheetsBase, { headers });
  if (!infoRes.ok) throw new Error('Could not read spreadsheet structure.');
  const info = await infoRes.json();
  const existingSheets = (info.sheets || []).map(s => s.properties.title);

  const needed = ['Users', 'Transactions', 'Categories', 'Settings', 'Books'];
  const missing = needed.filter(name => !existingSheets.includes(name));

  if (missing.length === 0) {
    console.log('[Setup] All sheets already exist.');
    return;
  }

  console.log('[Setup] Creating missing sheets:', missing);
  const requests = missing.map(title => ({ addSheet: { properties: { title } } }));
  await fetch(`${sheetsBase}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests }),
  });
}

/**
 * Seed default data into sheets that have no data yet.
 * Checks existing content first — NEVER overwrites data that already exists.
 */
async function seedDefaultData(spreadsheetId, headers) {
  const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

  const appendRows = async (range, values) => {
    await fetch(
      `${sheetsBase}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers, body: JSON.stringify({ values }) }
    );
  };

  const readRange = async (range) => {
    const res = await fetch(`${sheetsBase}/values/${encodeURIComponent(range)}`, { headers });
    const data = await res.json();
    return data.values || [];
  };

  // Users sheet: only seed if completely empty (no boss account)
  const users = await readRange('Users!A:A');
  if (users.length < 2) {
    console.log('[Setup] Seeding Users sheet...');
    await appendRows('Users!A1', [
      ['Name', 'Phone', 'PIN', 'Role', 'IsActive', 'AllowedBooks'],
      ['Admin', 'boss', '1234', 'Admin', 'TRUE', 'ALL'],
    ]);
  }

  // Transactions: only add header row if sheet is empty
  const tx = await readRange('Transactions!A1:A1');
  if (tx.length === 0) {
    console.log('[Setup] Seeding Transactions header...');
    await appendRows('Transactions!A1', [
      ['ID', 'Timestamp', 'Date', 'Type', 'Category', 'PartyName', 'PartyPhone',
       'Amount', 'PaymentMode', 'Reference', 'Remarks', 'User', 'ImageUrl',
       'EditHistory', 'BossNotes', 'Recurring', 'BookID', 'UpiApp'],
    ]);
  }

  // Books: only seed if empty
  const books = await readRange('Books!A:A');
  if (books.length < 2) {
    console.log('[Setup] Seeding Books sheet...');
    await appendRows('Books!A1', [
      ['ID', 'Name', 'Description', 'CreatedAt'],
      ['book_main', 'Main Book', 'Default business ledger', new Date().toISOString()],
    ]);
  }

  // Categories: only seed if empty
  const cats = await readRange('Categories!A:A');
  if (cats.length < 2) {
    console.log('[Setup] Seeding Categories sheet...');
    await appendRows('Categories!A1', [
      ['ID', 'Name', 'Type'],
      ['cat_1', 'Salary', 'Income'],
      ['cat_2', 'Sales', 'Income'],
      ['cat_3', 'Food', 'Expense'],
      ['cat_4', 'Transport', 'Expense'],
    ]);
  }

  // Settings: only seed if empty
  const settings = await readRange('Settings!A:A');
  if (settings.length < 2) {
    console.log('[Setup] Seeding Settings sheet...');
    await appendRows('Settings!A1', [
      ['Key', 'Value'],
      ['BrandName', 'My Business'],
      ['Address', ''],
      ['Phone', ''],
      ['SessionTimeout', '30'],
      ['DateFormat', 'DD/MM/YYYY'],
      ['OpeningBalance', '0'],
    ]);
  }

  console.log('[Setup] Spreadsheet ready.');
}

// Keep initSpreadsheetData as an alias for backward compatibility
export { seedDefaultData as initSpreadsheetData };
