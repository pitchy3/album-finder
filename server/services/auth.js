// server/services/auth.js - OIDC authentication service with dynamic configuration
const { Issuer } = require("openid-client");
const config = require("../config");

let issuer = null;
let client = null;

async function initializeAuth() {
  // If auth configuration is not complete, don't try to initialize
  if (!config.auth.enabled) {
    console.log("OIDC authentication not configured - skipping client initialization");
    console.log("Authentication can be configured via the Settings page");
    return { issuer: null, client: null };
  }

  try {
    console.log(`Initializing OIDC with issuer: ${config.oidc.issuerUrl}`);
    issuer = await Issuer.discover(config.oidc.issuerUrl);
    
    client = new issuer.Client({
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
    });
    
    console.log("OIDC authentication enabled and client initialized");
    return { issuer, client };
  } catch (err) {
    console.error("Failed to initialize OIDC client:", err.message);
    console.error("Make sure your OIDC configuration is correct in Settings");
    // Don't exit - allow the app to run without auth
    return { issuer: null, client: null };
  }
}

// Function to reinitialize auth when configuration changes
async function reinitializeAuth() {
  console.log("Reinitializing OIDC client with new configuration...");
  
  // Clear existing client
  issuer = null;
  client = null;
  
  // Reinitialize if auth is now enabled
  if (config.auth.enabled) {
    try {
      const result = await initializeAuth();
      issuer = result.issuer;
      client = result.client;
      console.log("OIDC client successfully reinitialized");
      return true;
    } catch (error) {
      console.error("Failed to reinitialize OIDC client:", error.message);
      return false;
    }
  } else {
    console.log("Authentication is disabled - OIDC client cleared");
    return true;
  }
}

function getClient() {
  return client;
}

function getIssuer() {
  return issuer;
}

function isAuthReady() {
  return config.auth.enabled && client !== null;
}

module.exports = {
  initializeAuth,
  reinitializeAuth,
  getClient,
  getIssuer,
  isAuthReady
};