// server/middleware/session.js - Fixed session configuration for CSRF compatibility
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

  const sessionConfig = {
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: 'albumfinder.sid',
    cookie: {
      secure: config.server.nodeEnv === 'production', // Always secure in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: config.server.nodeEnv === 'production' ? 'strict' : 'lax'
    },
    // Add session regeneration middleware
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
  
  // Session debugging middleware (development only)
  if (config.server.nodeEnv !== 'production') {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') && req.method !== 'GET') {
        console.log(`🔍 Session debug: ${req.method} ${req.path}`, {
          hasSession: !!req.session,
          sessionID: req.sessionID?.substring(0, 8) + '...',
          hasUser: !!req.session?.user
        });
      }
      next();
    });
  }
  
  console.log("✅ Session middleware configured");
}

module.exports = configureSession;