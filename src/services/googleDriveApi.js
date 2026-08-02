/**
 * googleDriveApi.js
 * Handles direct uploading of receipt images to Google Drive.
 */

const FOLDER_NAME = 'OpenCashbook_Receipts';

/**
 * Ensures that the OpenCashbook_Receipts folder exists and returns its ID.
 */
async function getOrCreateReceiptsFolder(token) {
  const headers = { Authorization: `Bearer ${token}` };
  
  // Search for the folder
  const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers });
  
  if (!searchRes.ok) throw new Error('Failed to search Google Drive');
  
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }
  
  // Create if missing
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  
  if (!createRes.ok) throw new Error('Failed to create Receipts folder');
  const createData = await createRes.json();
  return createData.id;
}

/**
 * Uploads a base64 encoded image to Google Drive inside the Receipts folder.
 * Returns the webViewLink of the uploaded file.
 */
export async function uploadImageToDrive(base64Data, filename, token) {
  try {
    const folderId = await getOrCreateReceiptsFolder(token);
    
    // Parse the base64 string
    // Format: "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
    let mimeType = 'image/jpeg';
    let base64Str = base64Data;
    
    const match = base64Data.match(/^data:(image\/[a-zA-Z0-9]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Str = match[2];
    }
    
    // Decode base64 to binary
    const byteString = atob(base64Str);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    
    // Construct Multipart Request
    const metadata = {
      name: filename || `Receipt_${Date.now()}.jpg`,
      parents: [folderId]
    };
    
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', blob);
    
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }, // FormData automatically sets the boundary Content-Type
      body: formData
    });
    
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Upload failed: ${err}`);
    }
    
    const fileData = await uploadRes.json();
    const fileId = fileData.id;
    
    // Update Permissions to Anyone with link (Reader)
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' })
    });
    
    return fileData.webViewLink;
  } catch (error) {
    console.error('Error uploading to Drive:', error);
    throw error;
  }
}

/**
 * Moves the connected Google Spreadsheet and Receipts folder to the Trash.
 */
export async function deleteAppCloudData(token, spreadsheetId) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  // 1. Trash the Spreadsheet
  if (spreadsheetId) {
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ trashed: true })
      });
    } catch (e) {
      console.warn('Failed to trash spreadsheet', e);
    }
  }

  // 2. Trash the Receipts Folder
  try {
    const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const folderId = searchData.files[0].id;
        await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ trashed: true })
        });
      }
    }
  } catch (e) {
    console.warn('Failed to trash receipts folder', e);
  }
}
