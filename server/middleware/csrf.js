// server/middleware/csrf.js - Enhanced CSRF protection with origin validation
const csrf = require('@dr.pogodin/csurf');
const crypto = require('crypto');

/**
 * Create CSRF protection middleware with enhanced security
 * Uses double-submit cookie pattern with origin validation
 */
function createCsrfProtection() {
  // Check if CSRF should be enabled
  // Explicit false in env variable takes precedence
  const explicitlyDisabled = process.env.ENABLE_CSRF === 'false';
  const explicitlyEnabled = process.env.ENABLE_CSRF === 'true';
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Enable CSRF if explicitly enabled, OR if in production and not explicitly disabled
  const enableCSRF = explicitlyEnabled || (isProduction && !explicitlyDisabled);
  
  const cookieSecure = process.env.COOKIE_SECURE !== 'false';
  
  if (!enableCSRF) {
    console.log("ℹ️  CSRF protection disabled");
    if (isProduction) {
      console.warn("⚠️  CSRF disabled in production mode - this reduces security");
    }
    
    // Return middleware that adds a dummy csrfToken function
    const dummyMiddleware = (req, res, next) => {
      // Add dummy csrfToken function for compatibility
      req.csrfToken = () => 'development-mode';
      next();
    };
    
    return {
      middleware: dummyMiddleware,
      getToken: (req, res) => {
        res.json({ csrfToken: 'development-mode' });
      }
    };
  }

  console.log("🛡️  Initializing CSRF protection...");

  // Configure CSRF with double-submit cookie pattern
  const csrfProtection = csrf({
    cookie: {
      key: cookieSecure ? '__Host-csrf' : 'csrf-token',
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict',
      signed: false, // We'll use HMAC instead
      maxAge: 24 * 60 * 60 // 24 hours
    },
    
    // Custom value function to check both header and body
    value: (req) => {
      return req.headers['csrf-token'] || 
             req.body._csrf || 
             req.query._csrf;
    },
    
    // Ignore methods that are safe by definition
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
  });

  /**
   * Validate Origin/Referer headers for additional CSRF protection
   * This provides defense-in-depth beyond token validation
   */
  function validateOrigin(req) {
    // Get origin from header
    const origin = req.get('Origin');
    const referer = req.get('Referer');
    const host = req.get('Host');
    
    // If we have an origin header, validate it
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          console.warn(`⚠️  CSRF: Origin mismatch`, {
            origin: originHost,
            host: host,
            ip: req.ip,
            path: req.path
          });
          return false;
        }
      } catch (error) {
        console.warn(`⚠️  CSRF: Invalid origin header`, {
          origin: origin,
          error: error.message
        });
        return false;
      }
    }
    
    // If no origin but we have referer, validate it
    // Note: Referer is less reliable as it may be stripped by browser/proxy
    if (!origin && referer) {
      try {
        const refererHost = new URL(referer).host;
        if (refererHost !== host) {
          console.warn(`⚠️  CSRF: Referer mismatch`, {
            referer: refererHost,
            host: host,
            ip: req.ip,
            path: req.path
          });
          return false;
        }
      } catch (error) {
        // Invalid referer URL - allow but log
        console.debug(`Invalid referer header: ${referer}`);
      }
    }
    
    return true;
  }

  /**
   * Check if request should skip CSRF validation
   */
  function shouldSkipCsrf(req) {
    // Skip for safe HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return true;
    }
    
    // Skip for specific paths
    const skipPaths = [
      '/healthz',
      '/auth/callback',
      '/webhook/lidarr'
      // Note: /api/csrf-token NOT in skip list so it gets token added
    ];
    
    return skipPaths.some(path => req.path.startsWith(path));
  }

  /**
   * Enhanced CSRF validation middleware
   */
  const enhancedCsrf = (req, res, next) => {
    // Apply CSRF protection first to add req.csrfToken function
    csrfProtection(req, res, (err) => {
      if (err) {
        // Skip validation errors for token endpoint
        if (req.path === '/api/csrf-token' && err.code === 'EBADCSRFTOKEN') {
          return next();
        }
        
        if (err.code === 'EBADCSRFTOKEN') {
          // Skip if this is a path that should be skipped
          if (shouldSkipCsrf(req)) {
            return next();
          }
          
          console.warn(`⚠️  CSRF token validation failed`, {
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 50)
          });
          
          // Clear the CSRF cookie to force regeneration
          const cookieName = cookieSecure ? '__Host-csrf' : 'csrf-token';
          res.clearCookie(cookieName);
          
          // Return helpful error
          return res.status(403).json({
            error: 'Invalid or missing CSRF token',
            code: 'CSRF_INVALID',
            hint: 'Your session may have expired. Please refresh the page and try again.'
          });
        }
        
        // Other CSRF errors
        console.error(`❌ CSRF error:`, err);
        return res.status(500).json({
          error: 'CSRF validation error',
          code: 'CSRF_ERROR'
        });
      }
      
      // Skip validation for safe paths (but csrf middleware already ran to add csrfToken)
      if (shouldSkipCsrf(req)) {
        return next();
      }

      // Validate origin/referer for defense-in-depth
      if (!validateOrigin(req)) {
        return res.status(403).json({
          error: 'Origin validation failed',
          code: 'ORIGIN_MISMATCH',
          hint: 'Request origin does not match expected host'
        });
      }
      
      next();
    });
  };

  /**
   * Middleware to get CSRF token
   */
  const getToken = (req, res) => {
    try {
      const token = req.csrfToken();
      
      // Add security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      
      res.json({ 
        csrfToken: token,
        expiresIn: 24 * 60 * 60 // 24 hours in seconds
      });
    } catch (error) {
      console.error('❌ Error generating CSRF token:', error);
      res.status(500).json({ 
        error: 'Failed to generate CSRF token',
        code: 'CSRF_GENERATION_FAILED'
      });
    }
  };

  console.log("✅ CSRF protection initialized");
  console.log(`   Cookie name: ${cookieSecure ? '__Host-csrf' : 'csrf-token'}`);
  console.log(`   Secure cookies: ${cookieSecure}`);
  console.log(`   Origin validation: enabled`);

  return {
    middleware: enhancedCsrf,
    getToken: getToken
  };
}

/**
 * Additional middleware to add CSRF token to response for SPA
 * This can be used to include CSRF token in initial page load
 */
function injectCsrfToken(req, res, next) {
  if (req.csrfToken) {
    res.locals.csrfToken = req.csrfToken();
  }
  next();
}

module.exports = {
  createCsrfProtection,
  injectCsrfToken
};
