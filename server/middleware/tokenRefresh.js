// server/middleware/tokenRefresh.js - Automatic OIDC token refresh
const { getClient } = require('../services/auth');
const { encryptToken, decryptToken } = require('../services/tokenEncryption');
const config = require('../config');
const { errorDetails, safeUrl } = require('../utils/oidcDiagnostics');

const REFRESH_BUFFER_SECONDS = 60;
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT'
]);
const TRANSIENT_OAUTH_ERRORS = new Set([
  'temporarily_unavailable'
]);
const PERMANENT_OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client'
]);

function getOAuthError(error) {
  const oauthError = error?.error || error?.response?.body?.error;
  return typeof oauthError === 'string' ? oauthError.toLowerCase() : null;
}

function getErrorValues(error) {
  return [
    error?.code,
    error?.errno,
    error?.error,
    error?.message,
    error?.cause?.code,
    error?.cause?.errno,
    error?.cause?.message,
    error?.response?.body?.error,
    error?.response?.body?.error_description
  ].filter(value => typeof value === 'string');
}

function isTransientRefreshError(error) {
  const oauthError = getOAuthError(error);

  // An explicit OAuth response is more authoritative than an accompanying
  // transport status. In particular, providers sometimes return a 5xx while
  // still reporting that the refresh credentials are definitively invalid.
  if (PERMANENT_OAUTH_ERRORS.has(oauthError)) {
    return false;
  }
  if (TRANSIENT_OAUTH_ERRORS.has(oauthError)) {
    return true;
  }
  if (oauthError) {
    return false;
  }

  const values = getErrorValues(error);
  const upperCaseValues = values.map(value => value.toUpperCase());
  const status = error?.statusCode || error?.status || error?.response?.statusCode || error?.response?.status;

  return upperCaseValues.some(value => TRANSIENT_ERROR_CODES.has(value))
    || values.some(value => /timed?\s*out|timeout|socket hang up|temporary failure/i.test(value))
    || status === 429
    || status >= 500;
}

function getSafeRefreshError(error, transient) {
  const oauthError = getOAuthError(error);
  const transportCode = [error?.code, error?.errno, error?.cause?.code, error?.cause?.errno]
    .find(value => typeof value === 'string' && TRANSIENT_ERROR_CODES.has(value.toUpperCase()));

  if (typeof oauthError === 'string' && /^[a-z_]+$/i.test(oauthError)) {
    return oauthError;
  }
  if (transportCode) {
    return transportCode.toUpperCase();
  }
  return transient ? 'transient_oidc_failure' : 'oidc_refresh_rejected';
}

// This process-local map is sufficient for the application's current
// single-process deployment. Each value covers both the OIDC refresh and the
// subsequent session save, allowing parallel requests to share the complete
// operation without blocking refreshes for other sessions.
const inFlightRefreshes = new Map();

const debug = ( process.env.NODE_ENV.toLowerCase() !== 'production' || process.env.DEBUG.toLowerCase() === 'true' );

function refreshOncePerSession(sessionId, refresh) {
  const existingRefresh = inFlightRefreshes.get(sessionId);
  if (existingRefresh) {
    return { promise: existingRefresh, isOwner: false };
  }

  const refreshPromise = Promise.resolve().then(refresh);
  inFlightRefreshes.set(sessionId, refreshPromise);

  refreshPromise.finally(() => {
    // Only remove the promise installed by this call. This guard makes cleanup
    // safe if the implementation later permits a replacement entry.
    if (inFlightRefreshes.get(sessionId) === refreshPromise) {
      inFlightRefreshes.delete(sessionId);
    }
  }).catch(() => {
    // The middleware handles the original promise's rejection. Consume the
    // promise returned by finally() to avoid creating an unhandled rejection.
  });

  return { promise: refreshPromise, isOwner: true };
}

/**
 * Middleware to automatically refresh OIDC tokens before they expire
 * Should be placed after session middleware and before protected routes
 */
async function refreshTokenMiddleware(req, res, next) {
  // Local logout must remain available even when the provider cannot refresh
  // an expired token. The logout handler can destroy the session without a
  // valid access token and treats provider revocation as best-effort.
  if (req.method === 'POST' && req.path === '/auth/logout') {
    return next();
  }

  // Only process if user is logged in with OIDC
  if (!req.session?.user?.tokens) {
    return next();
  }

  if (req.session.user.claims.authType !== 'oidc') {
    return next();
  }

  const tokens = req.session.user.tokens;
  const now = Math.floor(Date.now() / 1000);
  
  // Check if token is expired or will expire within the refresh buffer
  const expiresAt = tokens.expires_at;
  
  if (!expiresAt) {
    console.warn('⚠️ Token has no expiration time, cannot refresh');
    return next();
  }
  
  const timeUntilExpiry = expiresAt - now;
  
  // If the token is valid beyond the refresh buffer, no refresh is needed
  if (timeUntilExpiry > REFRESH_BUFFER_SECONDS) {
    return next();
  }

  // Token expired or expiring soon, attempt refresh
  if (debug) {
    console.log(`🔄 Token expires in ${timeUntilExpiry}s, attempting refresh...`);
  }
  
  if (!tokens.refresh_token) {
    console.log('❌ No refresh token available, user must re-authenticate');
    
    // Clear session and require re-authentication
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
    });
    
    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Session expired', 
        loginUrl: '/auth/login',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    // For page requests, redirect to login
    return res.redirect('/auth/login');
  }

  // Requests that fail before joining a flight remain responsible for their
  // own cleanup. Once a request joins a flight, only its owner may perform the
  // shared refresh failure's audit and session-destruction side effects.
  let ownsRefreshFlight = true;
  const refreshStartedAt = Date.now();
  let tokenEndpointUrl = null;

  try {
    const client = getClient();
    if (!client) {
      throw new Error('OIDC client not available');
    }
    tokenEndpointUrl = client.issuer?.metadata?.token_endpoint || client.metadata?.token_endpoint || null;

    // Decrypt refresh token
    let refreshToken;
    try {
      refreshToken = decryptToken(tokens.refresh_token, config.session.secret);
    } catch (decryptError) {
      throw new Error('Failed to decrypt refresh token', { cause: decryptError });
    }

    if (debug) {
      console.log('🔄 Refreshing tokens with OIDC provider...');
	}

    // Keep the single-flight entry until the refreshed tokens are persisted.
    // Otherwise, a request arriving after the provider responds but before the
    // session store finishes saving could refresh the old token a second time.
    const refreshFlight = refreshOncePerSession(req.sessionID, async () => {
      const tokenSet = await client.refresh(refreshToken);

      if (debug) {
        console.log('✅ Tokens refreshed successfully');
      }

      // Update session with new tokens
      const refreshedTokens = {
        access_token: encryptToken(tokenSet.access_token, config.session.secret),
        id_token: encryptToken(tokenSet.id_token, config.session.secret),
        refresh_token: tokenSet.refresh_token
          ? encryptToken(tokenSet.refresh_token, config.session.secret)
          : tokens.refresh_token, // Keep old if new not provided
        expires_at: tokenSet.expires_at
      };
      req.session.user.tokens = refreshedTokens;

      // Update user claims if they've changed
      if (tokenSet.claims) {
        req.session.user.claims = {
          ...req.session.user.claims,
          ...tokenSet.claims()
        };
      }

      // Saving is part of the shared operation so the flight remains active
      // until other requests can load the new tokens from the session store.
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            err.code = 'SESSION_SAVE_FAILED';
            reject(err);
          } else {
            resolve();
          }
        });
      });

      if (debug) {
        console.log('✅ Session updated with refreshed tokens');
      }

      // Return the canonical auth state so requests which joined this flight
      // can update their separately-loaded session objects without refreshing
      // again or performing a redundant session-store write.
      return {
        tokens: { ...refreshedTokens },
        claims: { ...req.session.user.claims }
      };
    });
    ownsRefreshFlight = refreshFlight.isOwner;
    const refreshedAuth = await refreshFlight.promise;

    if (!ownsRefreshFlight) {
      req.session.user.tokens = { ...refreshedAuth.tokens };
      req.session.user.claims = { ...refreshedAuth.claims };
    }

    next();

  } catch (error) {
    const secrets = [
      config.session.secret,
      config.oidc?.clientSecret,
      tokens.access_token,
      tokens.refresh_token
    ];
    const failureDetails = {
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - refreshStartedAt,
      sessionId: req.sessionID || null,
      tokenEndpointUrl: safeUrl(tokenEndpointUrl, secrets),
      accessTokenExpiresAt: expiresAt,
      timeUntilExpiry,
      ...errorDetails(error, secrets)
    };

    if (error.code === 'SESSION_SAVE_FAILED') {
      console.error('❌ Failed to save refreshed tokens:', failureDetails);
      return res.status(500).json({
        error: 'Failed to refresh session',
        code: 'SESSION_SAVE_FAILED'
      });
    }

    const transientFailure = isTransientRefreshError(error);
    const safeError = getSafeRefreshError(error, transientFailure);

    if (ownsRefreshFlight) {
      console.error(
        transientFailure ? '⚠️ Token refresh temporarily unavailable:' : '❌ Token refresh failed:',
        failureDetails
      );

      // The flight owner performs shared failure side effects exactly once.
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

      if (!transientFailure) {
        // Permanent refresh failures invalidate the authentication session.
        req.session.destroy((destroyErr) => {
          if (destroyErr) {
            console.error('Error destroying session:', destroyErr);
          }
        });
      }
    }

    if (transientFailure) {
      // A refresh is attempted before expiry. Let the request use the existing
      // access token during a provider/network hiccup while it remains valid.
      if (expiresAt > Math.floor(Date.now() / 1000)) {
        return next();
      }

      return res.status(503).json({
        error: 'Authentication service temporarily unavailable, please retry',
        loginUrl: '/auth/login',
        retryable: true,
        code: 'TOKEN_REFRESH_TEMPORARY_FAILURE'
      });
    }
    
    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Session expired, please log in again',
        loginUrl: '/auth/login',
        code: 'TOKEN_REFRESH_FAILED'
      });
    }
    
    // For page requests, redirect to login
    return res.redirect('/auth/login');
  }
}

/**
 * Helper function to manually trigger token refresh
 * Can be called by routes that need fresh tokens
 */
async function forceTokenRefresh(req) {
  if (!req.session?.user?.tokens || req.session.user.claims.authType !== 'oidc') {
    throw new Error('Not an OIDC session');
  }

  if (!req.session.user.tokens.refresh_token) {
    throw new Error('No refresh token available');
  }

  const client = getClient();
  if (!client) {
    throw new Error('OIDC client not available');
  }

  const refreshToken = decryptToken(
    req.session.user.tokens.refresh_token, 
    config.session.secret
  );

  const tokenSet = await client.refresh(refreshToken);

  req.session.user.tokens = {
    access_token: encryptToken(tokenSet.access_token, config.session.secret),
    id_token: encryptToken(tokenSet.id_token, config.session.secret),
    refresh_token: tokenSet.refresh_token 
      ? encryptToken(tokenSet.refresh_token, config.session.secret)
      : req.session.user.tokens.refresh_token,
    expires_at: tokenSet.expires_at
  };

  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        reject(err);
      } else {
        resolve(tokenSet);
      }
    });
  });
}

/**
 * Get decrypted access token from session
 * Useful for making API calls to OIDC provider
 */
function getAccessToken(req) {
  if (!req.session?.user?.tokens) {
    return null;
  }

  if (req.session.user.claims.authType !== 'oidc') {
    return null;
  }

  try {
    return decryptToken(req.session.user.tokens.access_token, config.session.secret);
  } catch (error) {
    console.error('Failed to decrypt access token:', error);
    return null;
  }
}

module.exports = {
  refreshTokenMiddleware,
  forceTokenRefresh,
  getAccessToken
};
