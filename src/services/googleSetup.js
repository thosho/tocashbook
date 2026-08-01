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

  // 1. Create the Spreadsheet
  console.log('Creating Spreadsheet...');
  let sheetRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Open Cashbook Database (Automated)',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    }),
  });
  if (!sheetRes.ok) throw new Error('Failed to create Google Sheet');
  const sheetData = await sheetRes.json();
  const spreadsheetId = sheetData.id;

  // 2. Create the Apps Script Project bound to the Spreadsheet
  console.log('Creating Apps Script Project...');
  let scriptRes = await fetch('https://script.googleapis.com/v1/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Open Cashbook Backend',
      parentId: spreadsheetId,
    }),
  });
  
  if (!scriptRes.ok) {
    // If bound script fails (sometimes due to API quirks), fallback to standalone
    console.warn('Bound script creation failed, trying standalone...');
    scriptRes = await fetch('https://script.googleapis.com/v1/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Open Cashbook Backend' }),
    });
    if (!scriptRes.ok) throw new Error('Failed to create Apps Script Project');
  }
  const scriptData = await scriptRes.json();
  const scriptId = scriptData.scriptId;

  // 3. Generate a secure API Secret and inject it + the Spreadsheet ID into Code.gs
  const generatedSecret = 'tcb_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Inject the secret directly into the code
  let modifiedCode = codeGsRaw.replace(
    /function getSecretKey\(\) \{[\s\S]*?\}/,
    `function getSecretKey() {\n  return '${generatedSecret}';\n}`
  );
  
  // If it's a standalone script, it needs the active spreadsheet ID injected because it's not bound
  // The current Code.gs uses SpreadsheetApp.getActiveSpreadsheet(), which only works if bound.
  // We'll replace it to open by ID.
  modifiedCode = modifiedCode.replace(
    /SpreadsheetApp\.getActiveSpreadsheet\(\)/g,
    `SpreadsheetApp.openById('${spreadsheetId}')`
  );

  const manifest = {
    timeZone: 'Asia/Kolkata',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    runtimeVersion: 'V8',
    webapp: {
      executeAs: 'USER_DEPLOYING',
      access: 'ANYONE_ANONYMOUS',
    },
  };

  // 4. Update the Script Content
  console.log('Pushing code to Apps Script...');
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
     const errorTxt = await contentRes.text();
     throw new Error('Failed to push code to Apps Script: ' + errorTxt);
  }

  // 5. Create a Version
  console.log('Creating version...');
  const versionRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/versions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ description: 'Initial Automated Setup' }),
  });
  if (!versionRes.ok) throw new Error('Failed to create script version');
  const versionData = await versionRes.json();
  const versionNumber = versionData.versionNumber;

  // 6. Deploy as Web App
  console.log('Deploying Web App...');
  const deployRes = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/deployments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      versionNumber: versionNumber,
      manifestFileName: 'appsscript',
      description: 'Production Deployment',
    }),
  });
  if (!deployRes.ok) {
     const errorTxt = await deployRes.text();
     throw new Error('Failed to deploy Web App: ' + errorTxt);
  }
  const deployData = await deployRes.json();
  
  // The entryPoint object contains the Web App URL
  let webAppUrl = '';
  if (deployData.entryPoints && deployData.entryPoints.length > 0) {
    webAppUrl = deployData.entryPoints[0].entryPointConfig.webapp.url;
  } else {
    throw new Error('Deployment successful, but no Web App URL returned by API.');
  }

  return { webAppUrl, apiSecret: generatedSecret };
}
