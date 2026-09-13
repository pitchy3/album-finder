// server/services/auth.js - Enhanced authentication with timing attack protection
const { Issuer } = require("../config/openidClient");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const config = require("../config");
const { errorDetails, safeUrl } = require('../utils/oidcDiagnostics');

let issuer = null;
let client = null;
let oidcRecoveryPromise = null;

const STARTUP_RETRY_DELAYS_MS = [1000, 3000, 10000];
const sleep = (delayMs) => new Promise(resolve => setTimeout(resolve, delayMs));

/**
 * Initialize authentication based on configured type
 */
async function initializeAuth() {
  if (!config.auth.enabled) {
    console.log("Authentication not configured - skipping client initialization");
    return { issuer: null, client: null };
  }

  if (config.auth.type === 'oidc') {
    return await initializeOIDC();
  } else if (config.auth.type === 'basicauth') {
    return await initializeBasicAuth();
  }

  return { issuer: null, client: null };
}

/**
 * Initialize authentication during startup, retrying transient OIDC failures.
 * The retry schedule is deliberately bounded so an unavailable identity
 * provider can delay, but never prevent, application startup.
 */
async function initializeAuthWithRetry({ retryDelays = STARTUP_RETRY_DELAYS_MS, wait = sleep } = {}) {
  let result = await initializeAuth();

  if (!config.auth.enabled || config.auth.type !== 'oidc' || result.client) {
    return result;
  }

  for (const delayMs of retryDelays) {
    console.warn(`OIDC initialization unavailable; retrying in ${delayMs}ms`);
    await wait(delayMs);
    result = await initializeAuth();
    if (result.client) {
      return result;
    }
  }

  console.warn('OIDC initialization retries exhausted; continuing startup without an OIDC client');
  return result;
}

/**
 * Lazily recover a missing OIDC client. All callers share the same in-flight
 * discovery attempt, preventing a login burst from amplifying an outage.
 */
async function recoverOIDCClient() {
  if (client) return client;
  if (!config.auth.enabled || config.auth.type !== 'oidc') return null;

  if (!oidcRecoveryPromise) {
    oidcRecoveryPromise = initializeOIDC()
      .then(result => result.client)
      .finally(() => {
        oidcRecoveryPromise = null;
      });
  }

  return oidcRecoveryPromise;
}

/**
 * Initialize OIDC client
 */
async function initializeOIDC() {
  const discoveryStartedAt = Date.now();
  try {
    console.log(`Initializing OIDC with issuer: ${config.oidc.issuerUrl}`);
    const newIssuer = await Issuer.discover(config.oidc.issuerUrl);
    
    const newClient = new newIssuer.Client({
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
	  token_endpoint_auth_method: 'client_secret_basic',
    });

    // Only publish the replacement after discovery and client construction have
    // both succeeded. This keeps a working client available during retries.
    issuer = newIssuer;
    client = newClient;
    
    console.log("✅ OIDC authentication enabled and client initialized");
    return { issuer, client };
  } catch (err) {
    const secrets = [config.oidc.clientSecret];
    console.error('❌ Failed to initialize OIDC client:', {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - discoveryStartedAt,
      issuerUrl: safeUrl(config.oidc.issuerUrl, secrets),
      ...errorDetails(err, secrets)
    });
    return { issuer: null, client: null };
  }
}

/**
 * Initialize BasicAuth (no external client needed)
 */
async function initializeBasicAuth() {
  console.log("✅ BasicAuth authentication enabled");
  return { issuer: null, client: null };
}

/**
 * Reinitialize authentication when configuration changes
 */
async function reinitializeAuth() {
  console.log("🔄 Reinitializing authentication with new configuration...");

  if (config.auth.enabled) {
    try {
      const result = await initializeAuth();

      if (config.auth.type === 'oidc' && (!result.issuer || !result.client)) {
        console.error("❌ Failed to reinitialize authentication: OIDC initialization returned no issuer or client");
        return false;
      }

      issuer = result.issuer;
      client = result.client;
      console.log(`✅ Authentication reinitialized: ${config.auth.type}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to reinitialize authentication:", error.message);
      return false;
    }
  } else {
    issuer = null;
    client = null;
    console.log("🔓 Authentication disabled");
    return true;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Pads strings to same length and uses crypto.timingSafeEqual
 * 
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {number} maxLength - Maximum length to pad to (default 256)
 * @returns {boolean} True if strings match
 */
function constantTimeEqual(a, b, maxLength = 256) {
  if (!a || !b) {
    return false;
  }
  
  // Normalize strings to prevent encoding attacks
  const normalizedA = Buffer.from(String(a).normalize('NFC'), 'utf8');
  const normalizedB = Buffer.from(String(b).normalize('NFC'), 'utf8');
  
  // Pad to same length to prevent timing leaks
  const paddedA = Buffer.alloc(maxLength);
  const paddedB = Buffer.alloc(maxLength);
  
  normalizedA.copy(paddedA);
  normalizedB.copy(paddedB);
  
  try {
    return crypto.timingSafeEqual(paddedA, paddedB);
  } catch (error) {
    // timingSafeEqual throws if buffers are different lengths
    // This shouldn't happen with our padding, but handle it safely
    return false;
  }
}

/**
 * Validate BasicAuth password with timing attack protection
 * CRITICAL: Always validates password even if username is wrong
 * This prevents timing-based username enumeration
 * 
 * @param {string} username - Username to validate
 * @param {string} password - Password to validate
 * @returns {Promise<boolean>} True if credentials are valid
 */
async function validateBasicAuthPassword(username, password) {
  // Check if BasicAuth is configured
  if (!config.basicAuth.username || !config.basicAuth.passwordHash) {
    // Still run bcrypt to maintain consistent timing
    await bcrypt.compare('dummy', '$2a$12$dummyhashfordummypassword0000000000000000000000000');
    return false;
  }
  
  // Validate input exists
  if (!username || !password) {
    // Still run bcrypt to maintain consistent timing
    await bcrypt.compare('dummy', config.basicAuth.passwordHash);
    return false;
  }
  
  // Constant-time username comparison
  const usernameMatch = constantTimeEqual(username, config.basicAuth.username);
  
  // CRITICAL: ALWAYS verify password, even if username is wrong
  // This prevents timing-based username enumeration
  // Attacker cannot determine valid username by measuring response time
  let passwordValid = false;
  try {
    passwordValid = await bcrypt.compare(password, config.basicAuth.passwordHash);
  } catch (error) {
    console.error("❌ Error validating password:", error.message);
    passwordValid = false;
  }
  
  // Only return true if BOTH match
  // This happens in constant time regardless of which fails
  return usernameMatch && passwordValid;
}

/**
 * Hash password for BasicAuth with secure parameters
 * 
 * @param {string} password - Password to hash
 * @returns {Promise<string>} Bcrypt hash
 */
async function hashPassword(password) {
  // Use 12 rounds (good balance of security and performance)
  // Each additional round doubles the computation time
  const saltRounds = 12;
  
  try {
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    console.error("❌ Error hashing password:", error.message);
    throw new Error("Failed to hash password");
  }
}

/**
 * Validate password meets security requirements
 * 
 * @param {string} password - Password to validate
 * @returns {object} Validation result with errors array
 */
function validatePasswordRequirements(password) {
  const errors = [];
  
  if (!password) {
    errors.push('Password is required');
    return { valid: false, errors };
  }
  
  // Minimum length: 16 characters
  if (password.length < 16) {
    errors.push('Password must be at least 16 characters long');
  }
  
  // Maximum length (bcrypt has 72 byte limit)
  if (password.length > 72) {
    errors.push('Password must be less than 72 characters');
  }
  
  // Must contain uppercase
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  // Must contain lowercase
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  // Must contain number
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  // Optional: special character (uncomment to require)
  // if (!/[^A-Za-z0-9]/.test(password)) {
  //   errors.push('Password must contain at least one special character');
  // }
  
  // Check for common patterns
  const commonPasswords = [
    'password', '12345678', 'qwertyuiop', 'abcdefgh',
    'letmein', 'welcome', 'monkey', 'dragon'
  ];
  
  const lowerPassword = password.toLowerCase();
  for (const common of commonPasswords) {
    if (lowerPassword.includes(common)) {
      errors.push(`Password contains common pattern: ${common}`);
    }
  }
  
  // Check for repeated characters
  if (/(.)\1{3,}/.test(password)) {
    errors.push('Password contains too many repeated characters');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Estimate password strength (0-4 scale)
 * 
 * @param {string} password - Password to evaluate
 * @returns {number} Strength score (0=very weak, 4=very strong)
 */
function estimatePasswordStrength(password) {
  if (!password) return 0;
  
  let score = 0;
  
  // Length bonus
  if (password.length >= 16) score++;
  if (password.length >= 20) score++;
  
  // Character diversity
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  
  // Entropy check
  const uniqueChars = new Set(password).size;
  if (uniqueChars / password.length > 0.5) score++;
  
  // Cap at 4
  return Math.min(score, 4);
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
  initializeAuthWithRetry,
  recoverOIDCClient,
  reinitializeAuth,
  getClient,
  getIssuer,
  isAuthReady,
  validateBasicAuthPassword,
  hashPassword,
  validatePasswordRequirements,
  estimatePasswordStrength,
  constantTimeEqual
};
