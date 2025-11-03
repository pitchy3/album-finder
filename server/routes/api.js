// server/routes/api.js - Main API routes with timezone support and BasicAuth support
const express = require("express");
const config = require("../config");
const { ensureAuthenticated } = require("../middleware/auth");
const { getUserId, queuedApiCall } = require("../services/queue");
const { cache } = require("../services/cache");
const { isConnected: isRedisConnected } = require("../services/redis");
const { database } = require("../services/database");
const tz = require("../utils/timezone");

const router = express.Router();

// Safe route imports with error handling
function safeRequire(modulePath, fallbackName) {
  try {
    const module = require(modulePath);
    if (typeof module === 'function' || (module && typeof module.use === 'function')) {
      return module;
    } else {
      console.warn(`⚠️ ${fallbackName} module did not export a router function`);
      return express.Router(); // Return empty router as fallback
    }
  } catch (error) {
    console.warn(`⚠️ Failed to load ${fallbackName} routes:`, error.message);
    return express.Router(); // Return empty router as fallback
  }
}

// Import route modules with safe loading
const musicbrainzRoutes = safeRequire("./api/musicbrainz", "MusicBrainz");
const lidarrRoutes = safeRequire("./api/lidarr", "Lidarr");
const configRoutes = safeRequire("./api/config", "Config");
const coverartRoutes = safeRequire("./api/coverart", "Cover Art");
const logsRoutes = safeRequire("./api/logs", "Logs");

// Swagger UI - only if openapi.json exists and swagger-ui-express is available
let openapiSpec = {};
try {
  openapiSpec = require("./openapi.json");
  const swaggerUi = require("swagger-ui-express");
  
  // Serve OpenAPI spec (raw JSON) for unauthenticated users
  router.get("/", (req, res) => {
    res.json(openapiSpec);
  });
  
  // Serve Swagger UI at /api/docs
  router.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
  console.log("✅ Swagger UI enabled at /api/docs");
} catch (error) {
  console.warn("⚠️ OpenAPI/Swagger setup failed:", error.message);
}

// Public auth status endpoint with auth type information
router.get("/auth/user", (req, res) => {
  const response = {
    loggedIn: false,
    authEnabled: config.auth.enabled,
    authType: config.auth.type || null
  };
  
  if (req.session?.user) {
    response.loggedIn = true;
    response.user = req.session.user.claims;
  }
  
  res.json(response);
});

// Timezone info endpoint
router.get("/timezone-info", (req, res) => {
  try {
    const timezoneInfo = tz.getTimezoneInfo();
    res.json(timezoneInfo);
  } catch (error) {
    console.error("Error getting timezone info:", error);
    res.status(500).json({ error: "Failed to get timezone information" });
  }
});

// User info endpoint
router.get("/me", ensureAuthenticated, (req, res) => {
  console.log(req.session.user);
  res.json({
    user: req.session.user,
  });
});

// Enhanced debug endpoint with scalability metrics and timezone info
router.get("/debug", ensureAuthenticated, (req, res) => {
  const userId = getUserId(req);
  const timezoneInfo = tz.getTimezoneInfo();
  
  res.json({
    status: "Server is running",
    timestamp: tz.formatForAPI(tz.now()),
    displayTime: tz.formatDisplay(tz.now()),
    timezone: timezoneInfo,
    nodeVersion: process.version,
    environment: config.server.nodeEnv,
    authEnabled: config.auth.enabled,
    authType: config.auth.type,
    authenticated: config.auth.enabled ? !!req.session.user : null,
    userId,
    redis: {
      connected: isRedisConnected(),
      url: config.redis.url
    },
    cache: cache.getStats(),
    queue: require("../services/queue").requestQueue.getStats(),
    memoryUsage: {
      ...process.memoryUsage(),
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    }
  });
});

// Statistics endpoint with timezone-aware timestamps
router.get("/stats", ensureAuthenticated, (req, res) => {
  const userId = getUserId(req);
  const timezoneInfo = tz.getTimezoneInfo();
  
  res.json({
    user: userId,
    timezone: timezoneInfo,
    serverTime: {
      utc: tz.formatForDatabase(tz.now()),
      local: tz.formatDisplay(tz.now()),
      timestamp: Date.now()
    },
    cache: cache.getStats(),
    queue: require("../services/queue").requestQueue.getStats(),
    server: {
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      startTime: tz.formatDisplay(tz.fromTimestamp(Date.now() - (process.uptime() * 1000)))
    },
    redis: {
      connected: isRedisConnected(),
      url: config.redis.url.replace(/\/\/.*@/, '//***@') // Hide credentials
    }
  });
});

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Mount API route modules with error handling
console.log("🔧 Mounting API routes...");

try {
  router.use("/musicbrainz", musicbrainzRoutes);
  console.log("✅ MusicBrainz routes mounted");
} catch (error) {
  console.error("❌ Failed to mount MusicBrainz routes:", error.message);
}

try {
  router.use("/lidarr", lidarrRoutes);
  console.log("✅ Lidarr routes mounted");
} catch (error) {
  console.error("❌ Failed to mount Lidarr routes:", error.message);
}

try {
  router.use("/config", configRoutes);
  console.log("✅ Config routes mounted");
} catch (error) {
  console.error("❌ Failed to mount Config routes:", error.message);
}

try {
  router.use("/coverart", coverartRoutes);
  console.log("✅ Cover art routes mounted");
} catch (error) {
  console.error("❌ Failed to mount Cover art routes:", error.message);
}

try {
  router.use("/logs", logsRoutes);
  console.log("✅ Logs routes mounted");
} catch (error) {
  console.error("❌ Failed to mount Logs routes:", error.message);
}

console.log("🔧 API routes setup complete");

module.exports = router;