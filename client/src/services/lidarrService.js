import { secureApiCall } from '../services/apiService.js';

function createNotificationDiv(title, message, isError = false) {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    background: ${isError ? '#fee' : '#efe'}; 
    border: 2px solid ${isError ? '#fcc' : '#cfc'}; 
    border-radius: 8px;
    padding: 16px; max-width: 400px; font-family: ${isError ? 'monospace' : 'sans-serif'};
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  `;
  const heading = document.createElement('h4');
  heading.style.cssText = `margin: 0 0 8px 0; color: ${isError ? '#c00' : '#060'};`;
  heading.textContent = title;

  const body = document.createElement('p');
  body.style.cssText = 'margin: 4px 0; white-space: pre-wrap;';
  body.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.style.cssText = `margin-top: 8px; padding: 4px 8px; background: ${isError ? '#c00' : '#060'}; color: white; border: none; border-radius: 4px; cursor: pointer;`;
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => div.remove());

  div.append(heading, body, closeButton);
  document.body.appendChild(div);
  
  // Auto-remove after timeout
  setTimeout(() => {
    if (div.parentElement) {
      div.remove();
    }
  }, isError ? 10000 : 5000);
}

export async function addToLidarr(album, rootFolder = null) {
  console.log("🚀 Starting addToLidarr for:", album);

  if (rootFolder) {
    console.log("📁 Using custom root folder:", rootFolder);
  }
  
  try {
    console.log("🔡 Making POST request to /api/lidarr/add");
	
    const payload = { 
      mbid: album.mbid, 
      title: album.title, 
      artist: album.artist
    };
	
	// Include root folder if provided
    if (rootFolder) {
      payload.rootFolder = rootFolder;
    }
	
    console.log("📦 Request payload:", payload);
    
    const r = await secureApiCall("/api/lidarr/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    console.log("📈 Response status:", r.status);
    console.log("📋 Response headers:", Object.fromEntries(r.headers.entries()));
    
    const responseText = await r.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = null;
    }

    if (!r.ok || data?.success === false) {
      const details = data?.details || data?.error || data?.message || responseText || r.statusText;
      console.error("❌ Add to Lidarr failed:", {
        status: r.status,
        statusText: r.statusText,
        responseText
      });

      createNotificationDiv(
        'Failed to add album to Lidarr',
        `${r.status} ${r.statusText}\n${details}`,
        true
      );
      return { success: false, error: details };
    }

    console.log("✅ Add to Lidarr successful:", data);

    createNotificationDiv(
      'Album Added Successfully!',
      `"${data?.title || album.title}" has been added to Lidarr`,
      false
    );
    return { success: true, data };
    
  } catch (err) {
    console.error("💥 Exception in addToLidarr:", err);
    console.error("📊 Error details:", {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    
    createNotificationDiv('Network/Parsing Error', `${err.name}: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}
