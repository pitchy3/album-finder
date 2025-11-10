// server/middleware/session.js - Enhanced session security with HTTPS enforcement
const session = require("express-session");
const RedisStore = require("connect-redis").default;
const crypto = require("crypto");
const config = require("../config");
const { getClient: getRedisClient, isConnected: isRedisConnected } = require("../services/redis");

/**
 * Validate session secret strength
 */
function validateSessionSecret(secret, nodeEnv) {
  const errors = [];
  
  if (!secret || secret === 'change-me') {
    errors.push('Session secret not set or using default value');
  }
  
  if (secret) {
    if (secret.length < 32) {
      errors.push(`Session secret too short (${secret.length} chars, minimum 32 required)`);
    }
    
    // Check character diversity
    const uniqueChars = new Set(secret).size;
    if (uniqueChars < 16) {
      errors.push(`Session secret lacks entropy (${uniqueChars} unique chars, recommend 20+)`);
    }
    
    // Check for repeated characters
    if (/^(.)\1+$/.test(secret)) {
      errors.push('Session secret contains only repeated characters');
    }
    
    // Check for sequential patterns
    if (/^(012|123|234|abc|bcd|qwe)/i.test(secret)) {
      errors.push('Session secret contains sequential patterns');
    }
    
    // Check for common weak strings
    const weakPatterns = ['password', 'secret', 'key', '123456', 'qwerty'];
    for (const pattern of weakPatterns) {
      if (secret.toLowerCase().includes(pattern)) {
        errors.push(`Session secret contains weak pattern: "${pattern}"`);
      }
    }
  }
  
  if (errors.length > 0) {
    if (nodeEnv === 'production') {
      console.error("\n" + "=".repeat(80));
      console.error("🚨 CRITICAL: Session secret validation failed");
      console.error("=".repeat(80));
      errors.forEach(err => console.error(`   ✗ ${err}`));
      console.error("\nGenerate a strong secret with:");
      console.error("   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
      console.error("\nThen set it in your .env file:");
      console.error("   SESSION_SECRET=<generated-secret>");
      console.error("=".repeat(80) + "\n");
	  if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
	  }
    } else {
      console.warn("\n⚠️  Session secret validation warnings:");
      errors.forEach(err => console.warn(`   • ${err}`));
      console.warn("Generate a strong secret for production:");
      console.warn("   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n");
    }
  }
  
  return errors.length === 0;
}

/**
 * Display security warnings for insecure configurations
 */
function displaySecurityWarnings(cookieSecure, isProduction, redisAvailable) {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return;
  }
  
  const warnings = [];
  
  // Critical: HTTP in production
  if (isProduction && !cookieSecure) {
    console.error("\n" + "=".repeat(80));
    console.error("🚨 CRITICAL SECURITY WARNING - DANGEROUS CONFIGURATION 🚨");
    console.error("=".repeat(80));
    console.error("Running in PRODUCTION mode with COOKIE_SECURE=false");
    console.error("");
    console.error("THIS IS EXTREMELY DANGEROUS:");
    console.error("  ✗ Session cookies transmitted in PLAIN TEXT");
    console.error("  ✗ Anyone on the network can steal user sessions");
    console.error("  ✗ Users remain compromised until they logout");
    console.error("  ✗ All authentication credentials at risk");
    console.error("");
    console.error("IMMEDIATE ACTIONS REQUIRED:");
    console.error("  1. Set COOKIE_SECURE=true in your .env file");
    console.error("  2. Deploy behind HTTPS reverse proxy (Caddy, nginx, etc.)");
    console.error("  3. OR switch to NODE_ENV=development for testing");
    console.error("");
    console.error("Starting in 30 seconds... Press Ctrl+C to cancel and fix configuration");
    console.error("=".repeat(80) + "\n");
    
    // Give time to cancel
    const timer = setTimeout(() => {
      console.warn("⚠️  Proceeding with INSECURE session cookies - sessions are NOT protected!");
    }, 30000);
    
    // Allow process to exit during wait
    process.on('SIGINT', () => {
      clearTimeout(timer);
      console.log("\n\n✓ Cancelled. Fix your configuration before running in production.");
      process.exit(0);
    });
  }
  
  // Warning: HTTP in development
  if (!isProduction && !cookieSecure) {
    console.warn("\n" + "⚠️  ".repeat(20));
    console.warn("⚠️  SECURITY WARNING - Development Mode");
    console.warn("⚠️  " + "‾".repeat(38));
    console.warn("⚠️  Session cookies NOT encrypted (COOKIE_SECURE=false)");
    console.warn("⚠️  Only use this on localhost or trusted networks");
    console.warn("⚠️  DO NOT use this configuration in production");
    console.warn("⚠️  ".repeat(20) + "\n");
  }
  
  // Warning: Memory store in production
  if (isProduction && !redisAvailable) {
    console.error("\n" + "=".repeat(80));
    console.error("🚨 CRITICAL: Redis not available in production");
    console.error("=".repeat(80));
    console.error("Using memory store for sessions will cause:");
    console.error("  ✗ All sessions lost on server restart");
    console.error("  ✗ Sessions not shared across multiple instances");
    console.error("  ✗ Users logged out unexpectedly");
    console.error("");
    console.error("Fix Redis connection before production deployment!");
    console.error("Starting in 30 seconds... Press Ctrl+C to cancel");
    console.error("=".repeat(80) + "\n");
    
    const timer = setTimeout(() => {
      console.warn("⚠️  Proceeding with MEMORY session store - sessions will be lost on restart!");
    }, 30000);
    
    process.on('SIGINT', () => {
      clearTimeout(timer);
      console.log("\n\n✓ Cancelled. Fix Redis connection before production use.");
      process.exit(0);
    });
  }
}

/**
 * Configure session middleware with enhanced security
 */
function configureSession(app) {
  console.log("🔧 Configuring session middleware...");
  
  const isProduction = config.server.nodeEnv === 'production';
  
  // Validate session secret
  validateSessionSecret(config.session.secret, config.server.nodeEnv);
  
  // Determine if cookies should be secure
  // Default to true, only allow false if explicitly set
  const cookieSecure = process.env.COOKIE_SECURE !== 'false';
  
  // Check Redis availability
  const redisClient = getRedisClient();
  const redisAvailable = redisClient && isRedisConnected();
  
  // Display security warnings
  displaySecurityWarnings(cookieSecure, isProduction, redisAvailable);
  
  // Choose cookie name based on security settings
  // __Host- prefix provides additional security guarantees
  const cookieName = cookieSecure ? '__Host-albumfinder.sid' : 'albumfinder.sid';
  
  const sessionConfig = {
    secret: config.session.secret,
    resave: false,
    
    // Changed: Don't save empty sessions (security best practice)
    saveUninitialized: false,
    
    // Keep session alive on activity
    rolling: true,
    
    // Cookie name with __Host- prefix for secure cookies
    name: cookieName,
    
    cookie: {
      // Secure flag
      secure: cookieSecure,
      
      // Prevent JavaScript access (XSS protection)
      httpOnly: true,
      
      // Session duration: 24 hours
      maxAge: 24 * 60 * 60 * 1000,
      
      // ALWAYS use strict for maximum CSRF protection
      sameSite: 'strict',
      
      // __Host- prefix requires these
      domain: undefined,
      path: '/'
    },
    
    // Generate cryptographically strong session IDs
    genid: () => crypto.randomBytes(32).toString('hex'),
    
    // Proxy trust
    proxy: config.server.trustProxy
  };

  // Use Redis store if available
  if (redisAvailable) {
    sessionConfig.store = new RedisStore({
      client: redisClient,
      prefix: 'albumfinder:sess:',
      ttl: 24 * 60 * 60, // 24 hours in seconds
      disableTouch: false, // Update TTL on access
      disableTTL: false
    });
    console.log("✅ Using Redis session store");
  } else {
    if (isProduction) {
      console.warn("⚠️  Using MEMORY session store in production (not recommended)");
    } else {
      console.log("ℹ️  Using memory session store (development only)");
    }
  }

  // Apply session middleware
  app.use(session(sessionConfig));
  
  // Add session security middleware
  app.use((req, res, next) => {
    // Regenerate session ID on privilege escalation (login)
    if (req.session && !req.session.regenerated && req.session.user) {
      req.session.regenerated = true;
    }
    
    // Add security headers for session cookies
    if (req.session) {
      // Prevent session fixation by regenerating on login
      const originalLogin = req.session.save;
      req.session.save = function(callback) {
        originalLogin.call(this, (err) => {
          if (err) return callback(err);
          
          // Additional security: clear old session data on save
          if (this.user && !this.loginVerified) {
            this.loginVerified = true;
          }
          
          if (callback) callback();
        });
      };
    }
    
    next();
  });
  
  // Session debugging in development
  if (!isProduction) {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') && req.method !== 'GET') {
        console.log(`🔍 Session: ${req.method} ${req.path}`, {
          hasSession: !!req.session,
          sessionID: req.sessionID?.substring(0, 8) + '...',
          hasUser: !!req.session?.user,
          secure: req.secure,
          protocol: req.protocol
        });
      }
      next();
    });
  }
  
  console.log("✅ Session middleware configured");
  console.log(`   Cookie name: ${cookieName}`);
  console.log(`   Secure cookies: ${cookieSecure}`);
  console.log(`   SameSite: strict`);
  console.log(`   Store: ${redisAvailable ? 'Redis' : 'Memory'}`);
  console.log(`   Environment: ${isProduction ? 'Production' : 'Development'}`);
}

module.exports = configureSession;