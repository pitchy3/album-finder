// server/middleware/tokenRefresh.js - Automatic OIDC token refresh
const { getClient } = require('../services/auth');
const { encryptToken, decryptToken } = require('../services/tokenEncryption');
const config = require('../config');
const { errorDetails, safeUrl } = require('../utils/oidcDiagnostics');

const REFRESH_BUFFER_SECONDS = 60;
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN',
  'ENETDOWN', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT'
]);
const TRANSIENT_OAUTH_ERRORS = new Set(['temporarily_unavailable']);
const PERMANENT_OAUTH_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

function getOAuthError(error) {
  const oauthError = error?.error || error?.response?.body?.error;
  return typeof oauthError === 'string' ? oauthError.toLowerCase() : null;
}

function getErrorValues(error) {
  return [error?.code, error?.errno, error?.error, error?.message,
    error?.cause?.code, error?.cause?.errno, error?.cause?.message,
    error?.response?.body?.error, error?.response?.body?.error_description]
    .filter(value => typeof value === 'string');
}

function isTransientRefreshError(error) {
  const oauthError = getOAuthError(error);
  if (PERMANENT_OAUTH_ERRORS.has(oauthError)) return false;
  if (TRANSIENT_OAUTH_ERRORS.has(oauthError)) return true;
  if (oauthError) return false;
  const values = getErrorValues(error);
  const upper = values.map(v => v.toUpperCase());
  const status = error?.statusCode || error?.status || error?.response?.statusCode || error?.response?.status;
  return upper.some(v => TRANSIENT_ERROR_CODES.has(v))
    || values.some(v => /timed?\s*out|timeout|socket hang up|temporary failure/i.test(v))
    || status === 429 || status >= 500;
}

function getSafeRefreshError(error, transient) {
  const oauthError = getOAuthError(error);
  const transportCode = [error?.code, error?.errno, error?.cause?.code, error?.cause?.errno]
    .find(value => typeof value === 'string' && TRANSIENT_ERROR_CODES.has(value.toUpperCase()));
  if (typeof oauthError === 'string' && /^[a-z_]+$/i.test(oauthError)) return oauthError;
  if (transportCode) return transportCode.toUpperCase();
  return transient ? 'transient_oidc_failure' : 'oidc_refresh_rejected';
}

const inFlightRefreshes = new Map();
const debug = (process.env.NODE_ENV.toLowerCase() !== 'production' || process.env.DEBUG.toLowerCase() === 'true');

function refreshOncePerSession(sessionId, refresh) {
  const existing = inFlightRefreshes.get(sessionId);
  if (existing) return { promise: existing, isOwner: false };
  const promise = Promise.resolve().then(refresh);
  inFlightRefreshes.set(sessionId, promise);
  promise.finally(() => {
    if (inFlightRefreshes.get(sessionId) === promise) inFlightRefreshes.delete(sessionId);
  }).catch(() => {});
  return { promise, isOwner: true };
}

function requireOidcSession(req) {
  if (!req.session?.user?.tokens || req.session.user.claims?.authType !== 'oidc') {
    throw new Error('Not an OIDC session');
  }
  if (!req.session.user.tokens.refresh_token) throw new Error('No refresh token available');
}

async function performSharedRefresh(req) {
  requireOidcSession(req);
  const client = getClient();
  if (!client) throw new Error('OIDC client not available');

  const originalTokens = req.session.user.tokens;
  const refreshToken = decryptToken(originalTokens.refresh_token, config.session.secret);
  const flight = refreshOncePerSession(req.sessionID, async () => {
    try {
      const tokenSet = await client.refresh(refreshToken);
      const refreshedTokens = {
        access_token: encryptToken(tokenSet.access_token, config.session.secret),
        id_token: tokenSet.id_token ? encryptToken(tokenSet.id_token, config.session.secret) : originalTokens.id_token,
        refresh_token: tokenSet.refresh_token
          ? encryptToken(tokenSet.refresh_token, config.session.secret)
          : originalTokens.refresh_token,
        expires_at: tokenSet.expires_at
      };
      req.session.user.tokens = refreshedTokens;
      if (tokenSet.claims) {
        req.session.user.claims = { ...req.session.user.claims, ...tokenSet.claims() };
      }
      await new Promise((resolve, reject) => {
        req.session.save(err => {
          if (err) {
            err.code = 'SESSION_SAVE_FAILED';
            reject(err);
          } else resolve();
        });
      });
      return {
        tokenSet,
        tokens: { ...refreshedTokens },
        claims: { ...req.session.user.claims }
      };
    } catch (error) {
      // Ownership belongs to the request that created the shared refresh promise.
      // Tag the rejection here, inside the owner callback, so waiters cannot race
      // to overwrite ownership metadata on the same Error object.
      error.refreshFlightOwner = true;
      throw error;
    }
  });

  try {
    const refreshed = await flight.promise;
    if (!flight.isOwner) {
      req.session.user.tokens = { ...refreshed.tokens };
      req.session.user.claims = { ...refreshed.claims };
    }
    return { ...refreshed, isOwner: flight.isOwner, client, originalTokens, refreshToken };
  } catch (error) {
    if (!flight.isOwner) {
      error.refreshFlightOwner = false;
    }
    throw error;
  }
}

async function refreshTokenMiddleware(req, res, next) {
  if (req.method === 'POST' && req.path === '/auth/logout') return next();
  if (!req.session?.user?.tokens) return next();
  if (req.session.user.claims?.authType !== 'oidc') return next();

  const tokens = req.session.user.tokens;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokens.expires_at;
  if (!expiresAt) return next();
  const timeUntilExpiry = expiresAt - now;
  if (timeUntilExpiry > REFRESH_BUFFER_SECONDS) return next();

  if (!tokens.refresh_token) {
    req.session.destroy(() => {});
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Session expired', loginUrl: '/auth/login', code: 'TOKEN_EXPIRED' });
    }
    return res.redirect('/auth/login');
  }

  const started = Date.now();
  let ownsRefreshFlight = true;
  let tokenEndpointUrl = null;
  let decryptedRefreshToken;
  try {
    const client = getClient();
    tokenEndpointUrl = client?.issuer?.metadata?.token_endpoint || client?.metadata?.token_endpoint || null;
    decryptedRefreshToken = decryptToken(tokens.refresh_token, config.session.secret);
    const result = await performSharedRefresh(req);
    ownsRefreshFlight = result.isOwner;
    if (debug) console.log('✅ Session updated with refreshed tokens');
    return next();
  } catch (error) {
    if (typeof error.refreshFlightOwner === 'boolean') {
      ownsRefreshFlight = error.refreshFlightOwner;
    }
    const secrets = [config.session.secret, config.oidc?.clientSecret, tokens.access_token, tokens.refresh_token, decryptedRefreshToken];
    const failureDetails = {
      timestamp: new Date().toISOString(), elapsedMs: Date.now() - started,
      sessionId: req.sessionID || null, tokenEndpointUrl: safeUrl(tokenEndpointUrl, secrets),
      accessTokenExpiresAt: expiresAt, timeUntilExpiry, ...errorDetails(error, secrets)
    };
    if (error.code === 'SESSION_SAVE_FAILED') {
      console.error('❌ Failed to save refreshed tokens:', failureDetails);
      return res.status(500).json({ error: 'Failed to refresh session', code: 'SESSION_SAVE_FAILED' });
    }
    const transientFailure = isTransientRefreshError(error);
    const safeError = getSafeRefreshError(error, transientFailure);
    if (ownsRefreshFlight) {
      console.error(transientFailure ? '⚠️ Token refresh temporarily unavailable:' : '❌ Token refresh failed:', failureDetails);
      const { database } = require('../services/database');
      await database.logAuthEvent({
        eventType: transientFailure ? 'token_refresh_transient_failure' : 'token_refresh_failure',
        userId: req.session.user.claims.sub,
        username: req.session.user.claims.preferred_username || req.session.user.claims.name,
        email: req.session.user.claims.email,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        errorMessage: safeError,
        sessionId: req.sessionID,
        metadata: failureDetails
      });
      if (!transientFailure) req.session.destroy(() => {});
    }
    if (transientFailure) {
      if (expiresAt > Math.floor(Date.now() / 1000)) return next();
      return res.status(503).json({
        error: 'Authentication service temporarily unavailable, please retry',
        loginUrl: '/auth/login', retryable: true, code: 'TOKEN_REFRESH_TEMPORARY_FAILURE'
      });
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Session expired, please log in again', loginUrl: '/auth/login', code: 'TOKEN_REFRESH_FAILED' });
    }
    return res.redirect('/auth/login');
  }
}

async function forceTokenRefresh(req) {
  const { tokenSet } = await performSharedRefresh(req);
  return tokenSet;
}

function getAccessToken(req) {
  if (!req.session?.user?.tokens || req.session.user.claims?.authType !== 'oidc') return null;
  try {
    return decryptToken(req.session.user.tokens.access_token, config.session.secret);
  } catch (error) {
    console.error('Failed to decrypt access token:', error);
    return null;
  }
}

module.exports = { refreshTokenMiddleware, forceTokenRefresh, getAccessToken };
