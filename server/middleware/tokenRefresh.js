// server/middleware/tokenRefresh.js - Automatic OIDC token refresh
const { getClient } = require('../services/auth');
const { encryptToken, decryptToken } = require('../services/tokenEncryption');
const config = require('../config');

/**
 * Middleware to automatically refresh OIDC tokens before they expire
 * Should be placed after session middleware and before protected routes
 */
async function refreshTokenMiddleware(req, res, next) {
  // Only process if user is logged in with OIDC
  if (!req.session?.user?.tokens) {
    return next();
  }

  if (req.session.user.claims.authType !== 'oidc') {
    return next();
  }

  const tokens = req.session.user.tokens;
  const now = Math.floor(Date.now() / 1000);
  
  // Check if token is expired or will expire in next 5 minutes (300 seconds)
  const expiresAt = tokens.expires_at;
  
  if (!expiresAt) {
    console.warn('⚠️ Token has no expiration time, cannot refresh');
    return next();
  }
  
  const timeUntilExpiry = expiresAt - now;
  
  // If token still valid for more than 5 minutes, no refresh needed
  if (timeUntilExpiry > 300) {
    return next();
  }

  // Token expired or expiring soon, attempt refresh
  console.log(`🔄 Token expires in ${timeUntilExpiry}s, attempting refresh...`);
  
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

  try {
    const client = getClient();
    if (!client) {
      throw new Error('OIDC client not available');
    }

    // Decrypt refresh token
    let refreshToken;
    try {
      refreshToken = decryptToken(tokens.refresh_token, config.session.secret);
    } catch (decryptError) {
      console.error('❌ Failed to decrypt refresh token:', decryptError.message);
      throw new Error('Failed to decrypt refresh token');
    }

    console.log('🔄 Refreshing tokens with OIDC provider...');

    // Refresh the tokens
    const tokenSet = await client.refresh(refreshToken);
    
    console.log('✅ Tokens refreshed successfully');

    // Update session with new tokens
    req.session.user.tokens = {
      access_token: encryptToken(tokenSet.access_token, config.session.secret),
      id_token: encryptToken(tokenSet.id_token, config.session.secret),
      refresh_token: tokenSet.refresh_token 
        ? encryptToken(tokenSet.refresh_token, config.session.secret)
        : tokens.refresh_token, // Keep old if new not provided
      expires_at: tokenSet.expires_at
    };

    // Update user claims if they've changed
    if (tokenSet.claims) {
      req.session.user.claims = {
        ...req.session.user.claims,
        ...tokenSet.claims()
      };
    }

    // Save updated session
    req.session.save((err) => {
      if (err) {
        console.error('❌ Failed to save refreshed tokens:', err);
        return res.status(500).json({ 
          error: 'Failed to refresh session',
          code: 'SESSION_SAVE_FAILED'
        });
      }
      
      console.log('✅ Session updated with refreshed tokens');
      next();
    });

  } catch (error) {
    console.error('❌ Token refresh failed:', error.message);
    
    // Log the refresh failure
    const { database } = require('../services/database');
    await database.logAuthEvent({
      eventType: 'token_refresh_failure',
      userId: req.session.user.claims.sub,
      username: req.session.user.claims.preferred_username || req.session.user.claims.name,
      email: req.session.user.claims.email,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      errorMessage: error.message,
      sessionId: req.sessionID
    });
    
    // Clear session and require re-authentication
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.error('Error destroying session:', destroyErr);
      }
    });
    
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