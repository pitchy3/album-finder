// server/middleware/apiKeyAuth.js - API Key authentication middleware
const crypto = require('crypto');
const { validateMasterKey } = require('../services/tokenEncryption');

/**
 * Validate API key at runtime
 * Uses same validation logic as master key
 */
function validateApiKey() {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    return {
      valid: false,
      configured: false,
      issues: ['API_KEY not configured']
    };
  }
  
  // Reuse validateMasterKey logic for consistency
  const validation = validateMasterKey(apiKey);
  
  return {
    ...validation,
    configured: true
  };
}

/**
 * Check if API key authentication is available and valid
 */
function isApiKeyValid() {
  const validation = validateApiKey();
  return validation.configured && validation.valid;
}

function constantTimeApiKeyEqual(provided, configured) {
  if (typeof provided !== 'string' || typeof configured !== 'string') {
    return false;
  }

  // Compare fixed-length digests so arbitrarily long keys cannot be silently
  // truncated while retaining a constant-time final comparison.
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const configuredDigest = crypto.createHash('sha256').update(configured, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, configuredDigest);
}

/**
 * Middleware to authenticate requests via API key
 * Checks X-API-Key header against API_KEY env var
 */
function apiKeyAuthMiddleware(req, res, next) {
  const providedKey = req.headers['x-api-key'];
  
  // No API key provided, continue to next auth method
  if (!providedKey) {
    return next();
  }
  
  // API key provided, validate it
  const validation = validateApiKey();
  
  // API key not configured
  if (!validation.configured) {
    console.warn('⚠️ API key authentication attempted but API_KEY not configured');
    return res.status(401).json({
      error: 'API key authentication not available',
      code: 'API_KEY_NOT_CONFIGURED'
    });
  }
  
  // API key configured but weak
  if (!validation.valid) {
    console.error('🚨 API key authentication blocked - weak API key detected');
    console.error('   Issues:', validation.issues.join(', '));
    return res.status(401).json({
      error: 'API key authentication unavailable due to security requirements',
      code: 'WEAK_API_KEY'
    });
  }
  
  try {
    if (!constantTimeApiKeyEqual(providedKey, process.env.API_KEY)) {
      console.warn('⚠️ Invalid API key attempt from', req.ip);
      return res.status(401).json({
        error: 'Invalid API key',
        code: 'INVALID_API_KEY'
      });
    }
    
    // API-key identity is request-scoped. Do not create or mutate a browser
    // session merely because this request supplied a valid API key.
    req.apiKeyAuthenticated = true;
    req.authUser = {
      claims: {
        sub: 'api-key-user',
        preferred_username: 'api-key-user',
        name: 'API Key User',
        authType: 'apikey'
      }
    };
    
    console.log('✅ API key authentication successful from', req.ip);
    return next();
    
  } catch (error) {
    console.error('❌ API key comparison error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      code: 'API_KEY_COMPARISON_FAILED'
    });
  }
}

/**
 * Log API key validation status on startup
 */
function logApiKeyStatus() {
  const validation = validateApiKey();
  
  if (!validation.configured) {
    console.log('ℹ️  API key authentication not configured (API_KEY not set)');
    return;
  }
  
  if (!validation.valid) {
    console.error('');
    console.error('='.repeat(80));
    console.error('🚨 CRITICAL: API key validation failed');
    console.error('='.repeat(80));
    validation.issues.forEach(issue => console.error(`   ✗ ${issue}`));
    console.error('');
    console.error('API key authentication will be DISABLED due to security requirements.');
    console.error('Generate a secure API key:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.error('');
    console.error('Then set it in your .env file:');
    console.error('   API_KEY=<generated-key>');
    console.error('='.repeat(80));
    console.error('');
    
    // In production, this is a critical issue
    if (process.env.NODE_ENV === 'production') {
      console.error('⚠️  Running in production with weak API key configuration');
    }
  } else {
    console.log('✅ API key authentication enabled and validated');
    console.log('   API key meets security requirements');
    console.log('   Clients can authenticate using X-API-Key header');
  }
}

module.exports = {
  apiKeyAuthMiddleware,
  validateApiKey,
  isApiKeyValid,
  logApiKeyStatus,
  constantTimeApiKeyEqual
};
