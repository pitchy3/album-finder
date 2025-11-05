// server/middleware/session.js - Updated cookie configuration
const session = require("express-session");
const RedisStore = require("connect-redis").default;
const config = require("../config");
const { getClient: getRedisClient, isConnected: isRedisConnected } = require("../services/redis");

function configureSession(app) {
  console.log("🔧 Configuring session middleware...");
  
  // Validate session secret
  if (!config.session.secret || config.session.secret === 'change-me') {
    if (config.server.nodeEnv === 'production') {
      console.error("🚨 CRITICAL: SESSION_SECRET must be set in production");
      process.exit(1);
    } else {
      console.warn("⚠️ Using default session secret (development only)");
    }
  }

  // Determine if we're in a secure context
  const isSecureContext = config.server.nodeEnv === 'production' && 
                          config.session.cookieSecure === true;
  
  // Log cookie configuration for debugging
  console.log("🍪 Cookie configuration:", {
    secure: isSecureContext,
    sameSite: isSecureContext ? 'strict' : 'lax',
    nodeEnv: config.server.nodeEnv,
    cookieSecure: config.session.cookieSecure
  });

  const sessionConfig = {
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false, // 🔧 Changed from true to false - better security
    rolling: true,
    name: 'albumfinder.sid',
    cookie: {
      secure: isSecureContext, // Only secure in production with HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: isSecureContext ? 'strict' : 'lax',
      // 🔧 FIX: Add domain/path configuration for better compatibility
      path: '/',
      // Don't set domain - let browser handle it automatically
    },
    proxy: true, // Trust proxy headers from Caddy
    genid: () => require('crypto').randomBytes(16).toString('hex')
  };

  // Use Redis store if available
  const redisClient = getRedisClient();
  if (redisClient && isRedisConnected()) {
    sessionConfig.store = new RedisStore({
      client: redisClient,
      prefix: 'albumfinder:sess:',
      ttl: 24 * 60 * 60 // 24 hours in seconds
    });
    console.log("✅ Using Redis session store");
  } else {
    console.log("⚠️ Using memory session store (not recommended for production)");
  }

  // Apply session middleware
  app.use(session(sessionConfig));
  
  // 🔧 FIX: Add middleware to log cookie issues (development only)
  if (config.server.nodeEnv !== 'production') {
    app.use((req, res, next) => {
      // Log session details for debugging auth issues
      if (req.path.startsWith('/auth/login') || req.path.startsWith('/api/auth/user')) {
        const protocol = req.protocol;
        const host = req.get('host');
        const isHttps = protocol === 'https' || req.secure || req.get('x-forwarded-proto') === 'https';
        
        console.log(`🔍 Session debug: ${req.method} ${req.path}`, {
          protocol,
          host,
          isHttps,
          hasSession: !!req.session,
          sessionID: req.sessionID?.substring(0, 8) + '...',
          hasUser: !!req.session?.user,
          cookies: req.headers.cookie ? 'present' : 'missing',
          secure: req.secure,
          'x-forwarded-proto': req.get('x-forwarded-proto')
        });
      }
      next();
    });
  }
  
  console.log("✅ Session middleware configured");
}

module.exports = configureSession;
