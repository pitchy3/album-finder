// server/config/index.js - Enhanced configuration management with runtime-only updates

// Environment configuration
const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    trustProxy: true
  },

  // Lidarr configuration - ONLY configurable via settings page (no env vars)
  lidarr: {
    url: "",
    apiKey: "",
    rootFolder: "",
    qualityProfileId: ""
  },

  // OIDC authentication configuration - ONLY configurable via settings page (no env vars)
  oidc: {
    issuerUrl: "",
    clientId: "",
    clientSecret: "",
    redirectUrl: "", // Will be constructed as [domain]/auth/callback
    scopes: "openid profile email"
  },

  // Domain configuration - ONLY configurable via settings page (no env vars)
  domain: "",

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || "change-me",
    cookieSecure: process.env.COOKIE_SECURE === "true"
  },

  // Redis configuration
  redis: {
    url: process.env.REDIS_URL || "redis://redis:6379"
  },

  // Cache configuration
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || "3600", 10), // 1 hour default
    maxSize: parseInt(process.env.MAX_CACHE_SIZE || "1000", 10), // Max 1000 entries
    maxMemory: parseInt(process.env.MAX_CACHE_MEMORY || "100", 10) // 100MB default
  },

  // Rate limiting configuration
  rateLimit: {
    musicbrainzDelay: parseInt(process.env.MUSICBRAINZ_DELAY || "1000", 10), // 1 second
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || "10", 10),
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || "30000", 10) // 30 seconds
  },

  // User agent for MusicBrainz
  userAgent: 'AlbumFinder/2.0'
};

// Check if authentication is configured
config.auth = {
  enabled: !!(config.oidc.issuerUrl && config.oidc.clientId && config.oidc.clientSecret && config.domain && config.session.secret)
};

// Helper function to update Lidarr config at runtime
config.updateLidarrConfig = (updates) => {
  const allowedFields = ['url', 'apiKey', 'rootFolder', 'qualityProfileId'];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      config.lidarr[key] = value;
      console.log(`🔧 Updated Lidarr config: ${key} = ${key === 'apiKey' ? '***' + value.slice(-4) : value}`);
    }
  }
};

// Helper function to update OIDC config at runtime
config.updateOIDCConfig = (updates) => {
  const allowedFields = ['issuerUrl', 'clientId', 'clientSecret'];
  let configChanged = false;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      config.oidc[key] = value;
      configChanged = true;
      console.log(`🔧 Updated OIDC config: ${key} = ${key === 'clientSecret' ? '***' + value.slice(-4) : value}`);
    }
  }
  
  if (configChanged) {
    // Update auth enabled status
    config.auth.enabled = !!(config.oidc.issuerUrl && config.oidc.clientId && config.oidc.clientSecret && config.domain && config.session.secret);
  }
};

// Helper function to update domain config at runtime
config.updateDomainConfig = (domain) => {
  if (domain && domain !== config.domain) {
    config.domain = domain;
    // Construct the callback URL automatically
    config.oidc.redirectUrl = `https://${domain}/auth/callback`;
    console.log(`🔧 Updated domain: ${domain}`);
    console.log(`🔧 Updated callback URL: ${config.oidc.redirectUrl}`);
    
    // Update auth enabled status
    config.auth.enabled = !!(config.oidc.issuerUrl && config.oidc.clientId && config.oidc.clientSecret && config.domain && config.session.secret);
  }
};

// Helper function to validate Lidarr configuration
config.validateLidarrConfig = () => {
  const required = ['url', 'apiKey', 'rootFolder', 'qualityProfileId'];
  const missing = required.filter(field => !config.lidarr[field]);
  
  if (missing.length > 0) {
    return {
      valid: false,
      missing: missing,
      message: `Missing required Lidarr configuration: ${missing.join(', ')}`
    };
  }
  
  // Validate URL format
  try {
    new URL(config.lidarr.url);
  } catch {
    return {
      valid: false,
      message: 'Invalid Lidarr URL format'
    };
  }
  
  return { valid: true };
};

// Helper function to validate OIDC configuration
config.validateOIDCConfig = () => {
  const required = ['issuerUrl', 'clientId', 'clientSecret'];
  const missing = required.filter(field => !config.oidc[field]);
  
  if (missing.length > 0) {
    return {
      valid: false,
      missing: missing,
      message: `Missing required OIDC configuration: ${missing.join(', ')}`
    };
  }
  
  if (!config.domain) {
    return {
      valid: false,
      missing: ['domain'],
      message: 'Domain is required for OIDC configuration'
    };
  }
  
  // Validate URL format
  try {
    new URL(config.oidc.issuerUrl);
  } catch {
    return {
      valid: false,
      message: 'Invalid OIDC Issuer URL format'
    };
  }
  
  return { valid: true };
};

// Log authentication status
if (!config.auth.enabled) {
  console.warn("⚠️  Authentication disabled - missing OIDC or domain configuration");
  console.warn("   App will run without authentication protection");
  console.warn("   Configure OIDC and domain settings via the Settings page");
}

// Log configuration status
console.log("📋 Lidarr configuration must be set via the Settings page");
console.log("🔐 OIDC and domain configuration must be set via the Settings page");
console.log("🚫 Environment variables for Lidarr, OIDC, and domain are no longer supported");

module.exports = config;