import { secureApiCall } from '../services/apiService.js';

function createNotificationDiv(message, isError = false) {
  const div = document.createElement('div');
  div.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    background: ${isError ? '#fee' : '#efe'}; 
    border: 2px solid ${isError ? '#fcc' : '#cfc'}; 
    border-radius: 8px;
    padding: 16px; max-width: 400px; font-family: ${isError ? 'monospace' : 'sans-serif'};
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  `;
  div.innerHTML = message;
  document.body.appendChild(div);
  
  // Auto-remove after timeout
  setTimeout(() => {
    if (div.parentElement) {
      div.remove();
    }
  }, isError ? 10000 : 5000);
}

export async function addToLidarr(album) {
  console.log("🚀 Starting addToLidarr for:", album);
  
  try {
    console.log("🔡 Making POST request to /api/lidarr/add");
    console.log("📦 Request payload:", { mbid: album.mbid, title: album.title, artist: album.artist });
    
    const r = await secureApiCall("/api/lidarr/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        mbid: album.mbid, 
        title: album.title, 
        artist: album.artist
      }),
    });
    
    console.log("📈 Response status:", r.status);
    console.log("📋 Response headers:", Object.fromEntries(r.headers.entries()));
    
    if (!r.ok) {
      const text = await r.text();
      console.error("❌ Add to Lidarr failed:", {
        status: r.status,
        statusText: r.statusText,
        responseText: text
      });
      
      const errorMessage = `
        <h4 style="margin: 0 0 8px 0; color: #c00;">Failed to add album to Lidarr</h4>
        <p style="margin: 4px 0;"><strong>Status:</strong> ${r.status} ${r.statusText}</p>
        <p style="margin: 4px 0;"><strong>Response:</strong></p>
        <pre style="margin: 4px 0; white-space: pre-wrap; font-size: 12px;">${text}</pre>
        <button onclick="this.parentElement.remove()" style="margin-top: 8px; padding: 4px 8px; background: #c00; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      `;
      
      createNotificationDiv(errorMessage, true);
      return { success: false };
    }
    
    const data = await r.json();
    console.log("✅ Add to Lidarr successful:", data);
    
    const successMessage = `
      <h4 style="margin: 0 0 8px 0; color: #060;">Album Added Successfully!</h4>
      <p style="margin: 4px 0;">"${data.title || album.title}" has been added to Lidarr</p>
      <button onclick="this.parentElement.remove()" style="margin-top: 8px; padding: 4px 8px; background: #060; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
    `;
    
    createNotificationDiv(successMessage, false);
    return { success: true, data };
    
  } catch (err) {
    console.error("💥 Exception in addToLidarr:", err);
    console.error("📊 Error details:", {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    
    const errorMessage = `
      <h4 style="margin: 0 0 8px 0; color: #c00;">Network/Parsing Error</h4>
      <p style="margin: 4px 0;"><strong>Error:</strong> ${err.message}</p>
      <p style="margin: 4px 0;"><strong>Type:</strong> ${err.name}</p>
      <button onclick="this.parentElement.remove()" style="margin-top: 8px; padding: 4px 8px; background: #c00; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
    `;
    
    createNotificationDiv(errorMessage, true);
    return { success: false };
  }
}
