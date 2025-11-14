// server/app.js - Updated with Phase 1 security enhancements
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs").promises;

const config = require("./config");
const { initializeRedis } = require("./services/redis");
const { initializeAuth } = require("./services/auth");
const { database } = require("./services/database");
const { validateMasterKey } = require("./services/tokenEncryption");
const { createLoggingMiddleware } = require("./middleware/logging");
const sessionConfig = require("./middleware/session");
const { createCsrfProtection } = require("./middleware/csrf");
const { apiLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./routes/auth");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const webhookRoutes = require("./routes/webhook");
const { apiKeyAuthMiddleware, logApiKeyStatus } = require('./middleware/apiKeyAuth');

// Configuration file path
const CONFIG_FILE_PATH = path.join(__dirname, "data/config.json");

// Load configuration from JSON file if it exists
async function loadStoredConfiguration() {
  try {
    console.log("📖 Looking for stored configuration at:", CONFIG_FILE_PATH);
    
    await fs.access(CONFIG_FILE_PATH);
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
      
      console.log("🎵 Loaded Lidarr configuration");
    }
    
    if (storedConfig.authType) {
      config.setAuthType(storedConfig.authType);
      console.log("🔐 Loaded auth type:", storedConfig.authType);
    }

    // Update OIDC configuration if present
    if (storedConfig.oidc) {
      const oidcConfig = storedConfig.oidc;
      if (oidcConfig.issuerUrl && oidcConfig.clientId && oidcConfig.clientSecret) {
        config.updateOIDCConfig({
          issuerUrl: oidcConfig.issuerUrl,
          clientId: oidcConfig.clientId,
          clientSecret: oidcConfig.clientSecret
        });
        
        if (oidcConfig.domain) {
          config.updateDomainConfig(oidcConfig.domain);
        }
        
        console.log("🔐 Loaded OIDC configuration");
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
        
        console.log("🔐 Loaded BasicAuth configuration");
      }
    }
    
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("ℹ️ No stored configuration file found - using defaults");
    } else {
      console.error("⚠️ Error loading stored configuration:", error.message);
    }
    return false;
  }
}

// Ensure data directory exists with proper permissions
async function ensureDataDirectory() {
  const dataDir = path.dirname(CONFIG_FILE_PATH);
  try {
    await fs.access(dataDir);
    
    // Verify and fix permissions (Unix only)
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(dataDir, 0o700); // Owner only
        console.log("✅ Data directory permissions verified");
      } catch (chmodErr) {
        console.warn("⚠️ Could not set directory permissions:", chmodErr.message);
      }
    }
    
    console.log("✅ Data directory exists:", dataDir);
  } catch {
    console.log("📁 Creating data directory:", dataDir);
    try {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      console.log("✅ Data directory created successfully");
    } catch (mkdirError) {
      console.warn("⚠️ Could not create data directory:", mkdirError.message);
    }
  }
}

async function main() {
  console.log("🚀 Starting AlbumFinder server...");
  console.log(`   Node version: ${process.version}`);
  console.log(`   Environment: ${config.server.nodeEnv}`);

  // Validate session secret before starting
  console.log("\n🔐 Validating security configuration...");
  const secretValidation = validateMasterKey(config.session.secret);
  if (!secretValidation.valid) {
    if (config.server.nodeEnv === 'production') {
      console.error("\n🚨 CRITICAL: Session secret validation failed:");
      secretValidation.issues.forEach(issue => console.error(`   ✗ ${issue}`));
      console.error("\nGenerate a secure secret:");
      console.error("   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
      process.exit(1);
    } else {
      console.warn("\n⚠️ Session secret validation warnings:");
      secretValidation.issues.forEach(issue => console.warn(`   • ${issue}`));
    }
  } else {
    console.log("✅ Session secret validated");
  }

  // Ensure data directory exists
  await ensureDataDirectory();

  // Load stored configuration
  await loadStoredConfiguration();

  // Validate and log API key status
  console.log("\n🔐 Validating API key configuration...");
  logApiKeyStatus();

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
  app.use(express.urlencoded({ extended: true }));

  // Cookie parser - REQUIRED for CSRF protection with cookies
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  // Session configuration - MUST be before CSRF
  console.log("\n🔧 Setting up session middleware...");
  sessionConfig(app);

  // Request logging after sessions are ready
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
  }

  // Security headers
  const { securityHeaders } = require('./middleware/securityHeaders');
  securityHeaders(app);
  
  // Input sanitization
  const { sanitizeInput } = require('./middleware/validation');
  app.use(sanitizeInput);

  // This allows stateless API access without sessions
  console.log("\n🔧 Setting up API key authentication...");
  app.use(apiKeyAuthMiddleware);

  // CSRF Protection with enhanced security
  console.log("\n🔧 Setting up CSRF protection...");
  const csrfProtection = createCsrfProtection();
  
  // Apply CSRF middleware first (adds req.csrfToken function)
  app.use(csrfProtection.middleware);
  
  // CSRF token endpoint - after middleware so req.csrfToken exists
  app.get('/api/csrf-token', csrfProtection.getToken);
  
  // Token refresh (for OIDC)
  const { refreshTokenMiddleware } = require('./middleware/tokenRefresh');
  app.use(refreshTokenMiddleware);  // NEW

  // Apply rate limiting to API routes
  app.use('/api/', apiLimiter);

  // Routes
  app.use("/auth", authRoutes());
  app.use("/api/admin", adminRoutes);
  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  // Health check
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  // Serve static files
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  
  // 404 for API routes
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Start server
  const server = app.listen(config.server.port, () => {
    console.log("\n" + "=".repeat(80));
    console.log("✅ Server started successfully!");
    console.log("=".repeat(80));
    console.log(`🌐 Listening on port ${config.server.port}`);
    console.log(`📊 Cache: TTL=${config.cache.ttl}s, MaxSize=${config.cache.maxSize}, MaxMemory=${config.cache.maxMemory}MB`);
    console.log(`🔄 Queue: MaxConcurrent=${config.rateLimit.maxConcurrentRequests}, Timeout=${config.rateLimit.requestTimeout}ms`);
    console.log(`⚡ Redis: ${require('./services/redis').isConnected() ? 'Connected' : 'Disconnected'}`);
    console.log(`🔐 Auth: ${config.auth.enabled ? `Enabled (${config.auth.type.toUpperCase()})` : 'Disabled'}`);
    
    // Security status
    const cookieSecure = process.env.COOKIE_SECURE !== 'false';
    const csrfEnabled = process.env.NODE_ENV === 'production' || process.env.ENABLE_CSRF === 'true';
    console.log(`🛡️ Security:`);
    console.log(`   - Secure cookies: ${cookieSecure ? '✅ Enabled' : '⚠️ Disabled'}`);
    console.log(`   - CSRF protection: ${csrfEnabled ? '✅ Enabled' : '⚠️ Disabled (dev mode)'}`);
    console.log(`   - Rate limiting: ✅ Enabled`);
    
    // Configuration status
    const hasLidarrConfig = config.lidarr.url && config.lidarr.apiKey;
    console.log(`⚙️ Configuration:`);
    console.log(`   - Lidarr: ${hasLidarrConfig ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   - Auth Type: ${config.authType || 'None'}`);
    console.log(`   - Data Directory: ${path.dirname(CONFIG_FILE_PATH)}`);
    
    console.log("=".repeat(80) + "\n");
    
    // Display security warnings if needed
    if (!cookieSecure && config.server.nodeEnv === 'production') {
      console.warn("\n⚠️⚠️⚠️  WARNING: Running with insecure cookies in production  ⚠️⚠️⚠️\n");
    }
  });

  // Graceful shutdown
  function shutdown() {
    console.log("\n🛑 Received shutdown signal, closing server...");
    if (server) {
      server.close(async () => {
        console.log("🔌 HTTP server closed");
        
        const { closeRedis } = require('./services/redis');
        await closeRedis();
        
        await database.close();
        
        console.log("✅ Graceful shutdown complete");
        process.exit(0);
      });
    } else {
      (async () => {
        const { closeRedis } = require('./services/redis');
        await closeRedis();
        await database.close();
        process.exit(0);
      })();
    }
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  
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
