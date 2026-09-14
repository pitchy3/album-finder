// server/services/auth.js - Enhanced authentication with timing attack protection
const { Issuer } = require("../config/openidClient");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const config = require("../config");
const { errorDetails, safeUrl } = require('../utils/oidcDiagnostics');

let issuer = null;
let client = null;
let oidcRecoveryPromise = null;
let oidcInitializationGeneration = 0;
let oidcRecoveryRetryAt = 0;

const STARTUP_RETRY_DELAYS_MS = [1000, 3000, 10000];
const OIDC_RECOVERY_COOLDOWN_MS = 10000;
const sleep = (delayMs) => new Promise(resolve => setTimeout(resolve, delayMs));

async function initializeAuth() {
  if (!config.auth.enabled) {
    console.log("Authentication not configured - skipping client initialization");
    return { issuer: null, client: null };
  }

  if (config.auth.type === 'oidc') return await initializeOIDC();
  if (config.auth.type === 'basicauth') return await initializeBasicAuth();
  return { issuer: null, client: null };
}

async function initializeAuthWithRetry({ retryDelays = STARTUP_RETRY_DELAYS_MS, wait = sleep } = {}) {
  let result = await initializeAuth();
  if (!config.auth.enabled || config.auth.type !== 'oidc' || result.client) return result;

  for (const delayMs of retryDelays) {
    console.warn(`OIDC initialization unavailable; retrying in ${delayMs}ms`);
    await wait(delayMs);
    result = await initializeAuth();
    if (result.client) return result;
  }

  console.warn('OIDC initialization retries exhausted; continuing startup without an OIDC client');
  return result;
}

async function recoverOIDCClient() {
  if (client) return client;
  if (!config.auth.enabled || config.auth.type !== 'oidc') return null;
  if (Date.now() < oidcRecoveryRetryAt) return null;

  if (!oidcRecoveryPromise) {
    oidcRecoveryPromise = initializeOIDC()
      .then(result => {
        oidcRecoveryRetryAt = result.client ? 0 : Date.now() + OIDC_RECOVERY_COOLDOWN_MS;
        return result.client;
      })
      .finally(() => { oidcRecoveryPromise = null; });
  }

  return oidcRecoveryPromise;
}

async function prepareOIDCClient(oidcConfig) {
  if (!oidcConfig?.issuerUrl || !oidcConfig?.clientId || !oidcConfig?.clientSecret) {
    return { issuer: null, client: null };
  }

  const discoveryStartedAt = Date.now();
  const secrets = [oidcConfig.clientSecret];
  try {
    const newIssuer = await Issuer.discover(oidcConfig.issuerUrl);
    const newClient = new newIssuer.Client({
      client_id: oidcConfig.clientId,
      client_secret: oidcConfig.clientSecret,
      token_endpoint_auth_method: 'client_secret_basic',
    });
    return { issuer: newIssuer, client: newClient };
  } catch (err) {
    console.error('❌ Failed to initialize OIDC client:', {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - discoveryStartedAt,
      issuerUrl: safeUrl(oidcConfig.issuerUrl, secrets),
      ...errorDetails(err, secrets)
    });
    return { issuer: null, client: null };
  }
}

function publishOIDCClient(prepared) {
  if (!prepared?.issuer || !prepared?.client) return false;
  oidcInitializationGeneration++;
  issuer = prepared.issuer;
  client = prepared.client;
  oidcRecoveryRetryAt = 0;
  return true;
}

async function initializeOIDC() {
  const initializationGeneration = ++oidcInitializationGeneration;
  const oidcConfig = {
    issuerUrl: config.oidc.issuerUrl,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret
  };
  console.log(`Initializing OIDC with issuer: ${oidcConfig.issuerUrl}`);
  const prepared = await prepareOIDCClient(oidcConfig);
  if (!prepared.client) return prepared;

  if (initializationGeneration === oidcInitializationGeneration) {
    issuer = prepared.issuer;
    client = prepared.client;
    oidcRecoveryRetryAt = 0;
  }
  console.log("✅ OIDC authentication enabled and client initialized");
  return { issuer, client };
}

async function initializeBasicAuth() {
  console.log("✅ BasicAuth authentication enabled");
  return { issuer: null, client: null };
}

async function reinitializeAuth() {
  console.log("🔄 Reinitializing authentication with new configuration...");
  oidcInitializationGeneration++;

  if (config.auth.enabled) {
    try {
      const result = await initializeAuth();
      if (config.auth.type === 'oidc' && (!result.issuer || !result.client)) {
        console.error("❌ Failed to reinitialize authentication: OIDC initialization returned no issuer or client");
        return false;
      }
      issuer = result.issuer;
      client = result.client;
      oidcRecoveryRetryAt = 0;
      console.log(`✅ Authentication reinitialized: ${config.auth.type}`);
      return true;
    } catch (error) {
      console.error("❌ Failed to reinitialize authentication:", error.message);
      return false;
    }
  }

  issuer = null;
  client = null;
  oidcRecoveryRetryAt = 0;
  console.log("🔓 Authentication disabled");
  return true;
}

function constantTimeEqual(a, b, maxLength = 256) {
  if (!a || !b) return false;
  const normalizedA = Buffer.from(String(a).normalize('NFC'), 'utf8');
  const normalizedB = Buffer.from(String(b).normalize('NFC'), 'utf8');
  const paddedA = Buffer.alloc(maxLength);
  const paddedB = Buffer.alloc(maxLength);
  normalizedA.copy(paddedA);
  normalizedB.copy(paddedB);
  try { return crypto.timingSafeEqual(paddedA, paddedB); } catch { return false; }
}

async function validateBasicAuthPassword(username, password) {
  if (!config.basicAuth.username || !config.basicAuth.passwordHash) {
    await bcrypt.compare('dummy', '$2a$12$dummyhashfordummypassword0000000000000000000000000');
    return false;
  }
  if (!username || !password) {
    await bcrypt.compare('dummy', config.basicAuth.passwordHash);
    return false;
  }
  const usernameMatch = constantTimeEqual(username, config.basicAuth.username);
  let passwordValid = false;
  try { passwordValid = await bcrypt.compare(password, config.basicAuth.passwordHash); }
  catch (error) { console.error("❌ Error validating password:", error.message); }
  return usernameMatch && passwordValid;
}

async function hashPassword(password) {
  try { return await bcrypt.hash(password, 12); }
  catch (error) {
    console.error("❌ Error hashing password:", error.message);
    throw new Error("Failed to hash password");
  }
}

function validatePasswordRequirements(password) {
  const errors = [];
  if (!password) {
    errors.push('Password is required');
    return { valid: false, errors };
  }
  if (password.length < 16) errors.push('Password must be at least 16 characters long');
  if (password.length > 72) errors.push('Password must be less than 72 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
  const commonPasswords = ['password', '12345678', 'qwertyuiop', 'abcdefgh', 'letmein', 'welcome', 'monkey', 'dragon'];
  const lowerPassword = password.toLowerCase();
  for (const common of commonPasswords) if (lowerPassword.includes(common)) errors.push(`Password contains common pattern: ${common}`);
  if (/(.)\1{3,}/.test(password)) errors.push('Password contains too many repeated characters');
  return { valid: errors.length === 0, errors };
}

function estimatePasswordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 16) score++;
  if (password.length >= 20) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const uniqueChars = new Set(password).size;
  if (uniqueChars / password.length > 0.5) score++;
  return Math.min(score, 4);
}

function getClient() { return client; }
function getIssuer() { return issuer; }
function isAuthReady() {
  if (!config.auth.enabled) return false;
  if (config.auth.type === 'oidc') return client !== null;
  if (config.auth.type === 'basicauth') return !!(config.basicAuth.username && config.basicAuth.passwordHash);
  return false;
}

module.exports = {
  initializeAuth,
  initializeAuthWithRetry,
  recoverOIDCClient,
  reinitializeAuth,
  prepareOIDCClient,
  publishOIDCClient,
  getClient,
  getIssuer,
  isAuthReady,
  validateBasicAuthPassword,
  hashPassword,
  validatePasswordRequirements,
  estimatePasswordStrength,
  constantTimeEqual
};