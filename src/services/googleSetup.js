import codeGsRaw from '../../gas-backend/Code.gs?raw';

/**
 * Automates the creation of the Google Sheet and Apps Script backend.
 * @param {string} accessToken - Google OAuth access token
 * @returns {Promise<{ webAppUrl: string, apiSecret: string }>}
 */
export async function setupGoogleBackend(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // ── STEP 1: Create the Spreadsheet ─────────────────────────────────────────
  console.log('[Setup] Step 1: Creating Spreadsheet...');
  const sheetRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Open Cashbook Database',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    }),
  });
  if (!sheetRes.ok) {
    const errText = await sheetRes.text();
    throw new Error('Failed to create Google Sheet: ' + errText);
  }
  const sheetData = await sheetRes.json();
  const spreadsheetId = sheetData.id;
  console.log('[Setup] Spreadsheet created:', spreadsheetId);

  // ── STEP 2: Create the Apps Script Project ─────────────────────────────────
  console.log('[Setup] Step 2: Creating Apps Script Project...');
  const scriptRes = await fetch('https://script.googleapis.com/v1/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Open Cashbook Backend',
      parentId: spreadsheetId,
    }),
  });
  if (!scriptRes.ok) {
    const errText = await scriptRes.text();
    throw new Error('Failed to create Apps Script Project: ' + errText);
  }
  const scriptData = await scriptRes.json();
  const scriptId = scriptData.scriptId;
  console.log('[Setup] Script created:', scriptId);

  // ── STEP 3: Generate secret & patch Code.gs ────────────────────────────────
  const generatedSecret = 'tcb_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  // Replace getActiveSpreadsheet() with openById() so standalone script works
  const modifiedCode = codeGsRaw
    .replace(/SpreadsheetApp\.getActiveSpreadsheet\(\)/g, `SpreadsheetApp.openById('${spreadsheetId}')`)
    .replace(
      /return PropertiesService\.getScriptProperties\(\)\.getProperty\('APP_SECRET'\) \|\| '';/g,
      `return '${generatedSecret}';`
    );

  // ── STEP 4: Push Code + Manifest ───────────────────────────────────────────
  console.log('[Setup] Step 4: Pushing code...');
  const manifest = {
    timeZone: 'Asia/Kolkata',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8',
    oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/script.external_request',
    ],
    webapp: {
      executeAs: 'USER_DEPLOYING',
      access: 'ANYONE_ANONYMOUS',
    },
  };

  const contentRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      files: [
        { name: 'Code', type: 'SERVER_JS', source: modifiedCode },
        { name: 'appsscript', type: 'JSON', source: JSON.stringify(manifest, null, 2) },
      ],
    }),
  });
  if (!contentRes.ok) {
    const errText = await contentRes.text();
    throw new Error('Failed to push code to Apps Script: ' + errText);
  }

  // ── STEP 5: Create a Version ────────────────────────────────────────────────
  console.log('[Setup] Step 5: Creating version...');
  const versionRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/versions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'v1 – Automated Setup' }),
  });
  if (!versionRes.ok) {
    const errText = await versionRes.text();
    throw new Error('Failed to create version: ' + errText);
  }
  const versionData = await versionRes.json();
  const versionNumber = versionData.versionNumber;

  // ── STEP 6: Deploy as Web App ───────────────────────────────────────────────
  console.log('[Setup] Step 6: Deploying Web App...');
  const deployRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/deployments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      versionNumber,
      manifestFileName: 'appsscript',
      description: 'Open Cashbook Web App',
    }),
  });
  if (!deployRes.ok) {
    const errText = await deployRes.text();
    throw new Error('Failed to deploy Web App: ' + errText);
  }
  const deployData = await deployRes.json();
  console.log('[Setup] Deploy response:', JSON.stringify(deployData));

  // ── STEP 7: Extract the Web App URL ────────────────────────────────────────
  // The Apps Script API returns the URL inside entryPoints[0].webApp.url
  let webAppUrl = '';
  const entries = deployData.entryPoints || [];
  for (const ep of entries) {
    if (ep.webApp && ep.webApp.url) {
      webAppUrl = ep.webApp.url;
      break;
    }
    if (ep.entryPointConfig && ep.entryPointConfig.webapp && ep.entryPointConfig.webapp.url) {
      webAppUrl = ep.entryPointConfig.webapp.url;
      break;
    }
  }

  if (!webAppUrl) {
    // Sometimes the URL is at the top level of the deployment object
    webAppUrl = deployData.webAppUrl || '';
  }

  if (!webAppUrl) {
    throw new Error('Setup complete but Web App URL missing. API said: ' + JSON.stringify(deployData));
  }

  console.log('[Setup] Web App URL:', webAppUrl);
  return { webAppUrl, apiSecret: generatedSecret, spreadsheetId, accessToken };
}

/**
 * Initialize the Google Spreadsheet with all required sheets and default data
 * using the Sheets API directly (bypasses Apps Script authorization requirement).
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} accessToken - Google OAuth access token
 */
export async function initSpreadsheetData(spreadsheetId, accessToken) {
  const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Get existing sheets
  const infoRes = await fetch(sheetsBase, { headers });
  const info = await infoRes.json();
  const existingSheets = (info.sheets || []).map(s => s.properties.title);

  const requests = [];

  // Add sheets that don't exist yet
  const needed = ['Users', 'Transactions', 'Categories', 'Settings', 'Books'];
  for (const title of needed) {
    if (!existingSheets.includes(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  }

  if (requests.length > 0) {
    await fetch(`${sheetsBase}:batchUpdate`, {
      method: 'POST', headers,
      body: JSON.stringify({ requests }),
    });
  }

  // Helper to write rows to a sheet
  const writeRows = async (range, values) => {
    await fetch(`${sheetsBase}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers,
      body: JSON.stringify({ values }),
    });
  };

  // Read Users to check if already initialized
  const usersCheck = await fetch(`${sheetsBase}/values/Users!A1:A2`, { headers });
  const usersData = await usersCheck.json();
  if (!usersData.values || usersData.values.length < 2) {
    // Initialize all sheets with default data
    await writeRows('Users!A1', [['Name','Phone','PIN','Role','IsActive','AllowedBooks'],['Admin','boss','1234','Admin','TRUE','ALL']]);
    await writeRows('Transactions!A1', [['ID','Timestamp','Date','Type','Category','PartyName','PartyPhone','Amount','PaymentMode','Reference','Remarks','User','ImageUrl','EditHistory','BossNotes','Recurring','BookID','UpiApp']]);
    await writeRows('Books!A1', [['ID','Name','Description','CreatedAt'],['book_main','Main Book','Default business ledger',new Date().toISOString()]]);
    await writeRows('Categories!A1', [['ID','Name','Type'],['cat_1','Salary','Income'],['cat_2','Sales','Income'],['cat_3','Food','Expense'],['cat_4','Transport','Expense']]);
    await writeRows('Settings!A1', [['Key','Value'],['BrandName','My Business'],['Address',''],['Phone',''],['SessionTimeout','30'],['DateFormat','DD/MM/YYYY'],['OpeningBalance','0']]);
  }
}
