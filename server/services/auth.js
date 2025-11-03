// server/services/auth.js - Enhanced authentication service with BasicAuth support
const { Issuer } = require("openid-client");
const bcrypt = require("bcryptjs");
const config = require("../config");

let issuer = null;
let client = null;

async function initializeAuth() {
  // If auth is not enabled, don't initialize
  if (!config.auth.enabled) {
    console.log("Authentication not configured - skipping client initialization");
    console.log("Authentication can be configured via the Settings page");
    return { issuer: null, client: null };
  }

  // Initialize based on auth type
  if (config.auth.type === 'oidc') {
    return await initializeOIDC();
  } else if (config.auth.type === 'basicauth') {
    return await initializeBasicAuth();
  }

  return { issuer: null, client: null };
}

async function initializeOIDC() {
  try {
    console.log(`Initializing OIDC with issuer: ${config.oidc.issuerUrl}`);
    issuer = await Issuer.discover(config.oidc.issuerUrl);
    
    client = new issuer.Client({
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
    });
    
    console.log("✅ OIDC authentication enabled and client initialized");
    return { issuer, client };
  } catch (err) {
    console.error("❌ Failed to initialize OIDC client:", err.message);
    console.error("Make sure your OIDC configuration is correct in Settings");
    return { issuer: null, client: null };
  }
}

async function initializeBasicAuth() {
  // BasicAuth doesn't require external client initialization
  console.log("✅ BasicAuth authentication enabled");
  return { issuer: null, client: null };
}

// Function to reinitialize auth when configuration changes
async function reinitializeAuth() {
  console.log("🔄 Reinitializing authentication with new configuration...");
  
  // Clear existing OIDC client
  issuer = null;
  client = null;
  
  // Reinitialize based on current auth type
  if (config.auth.enabled) {
    try {
      const result = await initializeAuth();
      issuer = result.issuer;
      client = result.client;
      console.log(`✅ Authentication reinitialized: ${config.auth.type}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to reinitialize authentication:", error.message);
      return false;
    }
  } else {
    console.log("🔓 Authentication disabled");
    return true;
  }
}

// BasicAuth password validation
async function validateBasicAuthPassword(username, password) {
  if (!config.basicAuth.username || !config.basicAuth.passwordHash) {
    return false;
  }
  
  // Check username match (case-sensitive)
  if (username !== config.basicAuth.username) {
    return false;
  }
  
  // Validate password against hash
  try {
    const isValid = await bcrypt.compare(password, config.basicAuth.passwordHash);
    return isValid;
  } catch (error) {
    console.error("❌ Error validating password:", error.message);
    return false;
  }
}

// Hash password for BasicAuth
async function hashPassword(password) {
  const saltRounds = 12; // Good balance of security and performance
  return await bcrypt.hash(password, saltRounds);
}

// Validate password meets requirements
function validatePasswordRequirements(password) {
  const errors = [];
  
  if (!password || password.length < 16) {
    errors.push('Password must be at least 16 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

function getClient() {
  return client;
}

function getIssuer() {
  return issuer;
}

function isAuthReady() {
  if (!config.auth.enabled) {
    return false;
  }
  
  if (config.auth.type === 'oidc') {
    return client !== null;
  } else if (config.auth.type === 'basicauth') {
    return !!(config.basicAuth.username && config.basicAuth.passwordHash);
  }
  
  return false;
}

module.exports = {
  initializeAuth,
  reinitializeAuth,
  getClient,
  getIssuer,
  isAuthReady,
  validateBasicAuthPassword,
  hashPassword,
  validatePasswordRequirements
};