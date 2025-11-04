// server/app.js - Fixed CSRF implementation
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs").promises;

const config = require("./config");
const { initializeRedis } = require("./services/redis");
const { initializeAuth } = require("./services/auth");
const { database } = require("./services/database");
const { createLoggingMiddleware } = require("./middleware/logging");
const sessionConfig = require("./middleware/session");
const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const webhookRoutes = require("./routes/webhook");

// Configuration file path
const CONFIG_FILE_PATH = path.join(__dirname, "data/config.json");

// Load configuration from JSON file if it exists
async function loadStoredConfiguration() {
  try {
    console.log("📖 Looking for stored configuration at:", CONFIG_FILE_PATH);
    
    // Check if config file exists
    await fs.access(CONFIG_FILE_PATH);
    
    // Read and parse the config file
    const configData = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    const storedConfig = JSON.parse(configData);
    
    console.log("✅ Found stored configuration file");
    
    // Update Lidarr configuration if present
    if (storedConfig.lidarr) {
      const lidarrConfig = storedConfig.lidarr;
      if (lidarrConfig.url) config.lidarr.url = lidarrConfig.url;
      if (lidarrConfig.apiKey) config.lidarr.apiKey = lidarrConfig.apiKey;
      if (lidarrConfig.rootFolder) config.lidarr.rootFolder = lidarrConfig.rootFolder;
      if (lidarrConfig.qualityProfileId) config.lidarr.qualityProfileId = lidarrConfig.qualityProfileId;
      
      console.log("🎵 Loaded Lidarr configuration:", {
        url: lidarrConfig.url ? lidarrConfig.url : "Not set",
        apiKey: lidarrConfig.apiKey ? '***' + lidarrConfig.apiKey.slice(-4) : "Not set",
        rootFolder: lidarrConfig.rootFolder || "Not set",
        qualityProfileId: lidarrConfig.qualityProfileId || "Not set"
      });
    }
    
    if (storedConfig.authType) {
      config.setAuthType(storedConfig.authType);
      console.log("🔐 Loaded auth type:", storedConfig.authType);
    }

    // Update OIDC configuration if present
    if (storedConfig.oidc) {
      const oidcConfig = storedConfig.oidc;
      if (oidcConfig.issuerUrl && oidcConfig.clientId && oidcConfig.clientSecret) {
        // Update OIDC configuration
        config.updateOIDCConfig({
          issuerUrl: oidcConfig.issuerUrl,
          clientId: oidcConfig.clientId,
          clientSecret: oidcConfig.clientSecret
        });
        
        // Update domain configuration
        if (oidcConfig.domain) {
          config.updateDomainConfig(oidcConfig.domain);
        }
        
        console.log("🔐 Loaded OIDC configuration:", {
          issuerUrl: oidcConfig.issuerUrl,
          clientId: oidcConfig.clientId,
          clientSecret: oidcConfig.clientSecret ? '***' + oidcConfig.clientSecret.slice(-4) : "Not set",
          domain: oidcConfig.domain || "Not set"
        });
      } else {
        console.log("ℹ️ OIDC configuration found but incomplete - skipping");
      }
    }

    // Update BasicAuth configuration if present
    if (storedConfig.basicAuth) {
     const basicAuthConfig = storedConfig.basicAuth;
      if (basicAuthConfig.username && basicAuthConfig.passwordHash) {
        config.updateBasicAuthConfig({
          username: basicAuthConfig.username,
          passwordHash: basicAuthConfig.passwordHash
        });
        
        console.log("🔐 Loaded BasicAuth configuration:", {
          username: basicAuthConfig.username
        });
      } else {
        console.log("ℹ️ BasicAuth configuration found but incomplete - skipping");
      }
    }
    
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("ℹ️ No stored configuration file found - using defaults");
      console.log("   Configuration can be set via the Settings page");
    } else {
      console.error("⚠️ Error loading stored configuration:", error.message);
      console.log("   Continuing with default configuration");
    }
    return false;
  }
}

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.dirname(CONFIG_FILE_PATH);
  try {
    await fs.access(dataDir);
    console.log("✅ Data directory exists:", dataDir);
  } catch {
    console.log("📁 Creating data directory:", dataDir);
    try {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o755 });
      console.log("✅ Data directory created successfully");
    } catch (mkdirError) {
      console.warn("⚠️ Could not create data directory:", mkdirError.message);
      console.log("   Configuration will not persist between restarts");
    }
  }
}

async function main() {
  console.log("🚀 Starting AlbumFinder server...");

  // Ensure data directory exists
  await ensureDataDirectory();

  // Load stored configuration
  await loadStoredConfiguration();

  // Initialize Redis
  await initializeRedis();
  
  // Initialize database
  await database.initialize();

  // Create Express app
  const app = express();

  // Trust proxy for accurate IP addresses
  app.set("trust proxy", config.server.trustProxy);

  // Basic middleware - BEFORE session
  app.use(bodyParser.json());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Add this for form handling

  // Session configuration - MUST be before CSRF
  console.log("🔧 Setting up session middleware...");
  sessionConfig(app);

  // 🔎 Add request logging after sessions are ready
  app.use(createLoggingMiddleware());

  // Initialize OIDC client
  let authClients = { issuer: null, client: null };
  try {
    authClients = await initializeAuth();
    if (authClients.client) {
      console.log("🔐 OIDC client initialized successfully");
    }
  } catch (error) {
    console.warn("⚠️ OIDC client initialization failed:", error.message);
    console.warn("   Authentication can be configured via Settings page");
  }

  // CSRF Protection - Fixed configuration
  console.log("🔧 Setting up CSRF protection...");
  
  // Only enable CSRF in production or when explicitly enabled
  const enableCSRF = config.server.nodeEnv === 'production' || process.env.ENABLE_CSRF === 'true';
  
  if (enableCSRF) {
    try {
      const csrf = require('@dr.pogodin/csurf');
      
      // CSRF protection with proper configuration
      const csrfProtection = csrf({
        // Use session store (default behavior)
        cookie: false, // Use session instead of cookie store
        // Custom error handling
        onError: (err, req, res, next) => {
          if (err.code === 'EBADCSRFTOKEN') {
            console.warn("⚠️ CSRF token validation failed:", {
              path: req.path,
              method: req.method,
              userAgent: req.get('User-Agent')
            });
            
            // For API requests, return JSON error
            if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
              return res.status(403).json({ 
                error: 'Invalid or missing CSRF token',
                code: 'CSRF_INVALID'
              });
            }
            
            // For regular requests, redirect or show error page
            return res.status(403).send('CSRF token validation failed. Please refresh the page and try again.');
          }
          next(err);
        }
      });
	  
	  // CSRF token endpoint - must be BEFORE other routes
      app.get('/api/csrf-token', csrfProtection, (req, res) => {
        try {
          res.json({ csrfToken: req.csrfToken() });
        } catch (error) {
          console.error('Error generating CSRF token:', error);
          res.status(500).json({ error: 'Failed to generate CSRF token' });
        }
      });

      // Apply CSRF protection selectively
      app.use((req, res, next) => {
        // Skip CSRF for certain paths
        const skipPaths = [
          '/healthz',
          '/auth/login',
          '/auth/callback',
          '/api/csrf-token',
          '/api/config/auth',
          '/api/config/auth/test',
          '/api/config/lidarr/test',
          '/api/config/lidarr/rootfolders',
		  '/webhook/lidarr'
        ];
        
        // Skip for GET, HEAD, OPTIONS requests
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/api/csrf-token') {
          return next();
        }
        
        // Skip for specific paths
        if (skipPaths.some(path => req.path.startsWith(path))) {
          console.log(`🔓 Skipping CSRF for: ${req.method} ${req.path}`);
          return next();
        }
        
        // Apply CSRF protection
        console.log(`🛡️ Applying CSRF protection: ${req.method} ${req.path}`);
        csrfProtection(req, res, next);
      });

      console.log("✅ CSRF protection enabled");
      
    } catch (error) {
      console.error("❌ Failed to initialize CSRF protection:", error);
      console.warn("⚠️ Continuing without CSRF protection - install '@dr.pogodin/csurf' package");
    }
  } else {
    console.log("ℹ️ CSRF protection disabled (development mode)");
    
    // Provide dummy CSRF token endpoint for development
    app.get('/api/csrf-token', (req, res) => {
      res.json({ csrfToken: 'development-mode' });
    });
  }

  // Routes
  app.use("/auth", authRoutes(authClients.client));
  app.use("/api/admin", adminRoutes);
  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  // Health check
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  // Serve static files
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Start server
  const server = app.listen(config.server.port, () => {
    console.log(`🚀 Server listening on port ${config.server.port}`);
    console.log(`📊 Cache: TTL=${config.cache.ttl}s, MaxSize=${config.cache.maxSize}, MaxMemory=${config.cache.maxMemory}MB`);
    console.log(`🔄 Queue: MaxConcurrent=${config.rateLimit.maxConcurrentRequests}, Timeout=${config.rateLimit.requestTimeout}ms`);
    console.log(`⚡ Redis: ${require('./services/redis').isConnected() ? 'Connected' : 'Disconnected'}`);
    console.log(`🔐 Auth: ${config.auth.enabled ? `Enabled (${config.auth.type.toUpperCase()})` : 'Disabled'} (can be configured via Settings)`);
    console.log(`🛡️ CSRF: ${enableCSRF ? 'Enabled' : 'Disabled'}`);
    
    // Log configuration status
    const hasLidarrConfig = config.lidarr.url && config.lidarr.apiKey;
    const hasOIDCConfig = config.oidc.issuerUrl && config.oidc.clientId && config.oidc.clientSecret;
    const hasBasicAuthConfig = config.basicAuth.username && config.basicAuth.passwordHash;
    console.log(`⚙️ Configuration Status:`);
    console.log(`   - Lidarr: ${hasLidarrConfig ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   - OIDC: ${hasOIDCConfig ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   - BasicAuth: ${hasBasicAuthConfig ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   - Active Auth Type: ${config.authType || 'None'}`);
    console.log(`   - Data Directory: ${path.dirname(CONFIG_FILE_PATH)}`);
  });

  // Graceful shutdown
  function shutdown() {
    console.log("🛑 Received shutdown signal, closing server...");
    if (server) {
      server.close(async () => {
        console.log("🔌 HTTP server closed");
        
        // Close Redis connection
        const { closeRedis } = require('./services/redis');
        await closeRedis();
        
        // 🆕 Close database connection
        const { database } = require('./services/database');
        await database.close();
        
        console.log("✅ Graceful shutdown complete");
        process.exit(0);
      });
    } else {
      // Handle case where server hasn't started yet
      (async () => {
        const { closeRedis } = require('./services/redis');
        await closeRedis();
        
        const { database } = require('./services/database');
        await database.close();
        
        process.exit(0);
      })();
    }
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  
  // 🆕 Also handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', async (error) => {
    console.error('💥 Uncaught Exception:', error);
    await shutdown();
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdown();
  });
}

// Start the application
main().catch(err => {
  console.error("💥 Server startup failed:", err);
  process.exit(1);
});
