// server/routes/api/config.js - Updated with Phase 2 enhancements
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const config = require("../../config");
const { ensureAuthenticated } = require("../../middleware/auth");
const { database } = require("../../services/database");
const { validate, schemas } = require("../../middleware/validation");
const { 
  encryptConfig, 
  decryptConfig, 
  isConfigEncrypted,
  migrateToEncryptedConfig,
  backupConfig,
  obfuscateConfig
} = require("../../services/configEncryption");
const { 
  validatePasswordRequirements, 
  hashPassword, 
  validateBasicAuthPassword 
} = require("../../services/auth");

const router = express.Router();

// Path to the configuration file
const CONFIG_FILE_PATH = path.join(__dirname, "../../data/config.json");
const BACKUP_DIR = path.join(__dirname, "../../data/backups");

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.dirname(CONFIG_FILE_PATH);
  try {
    await fs.access(dataDir);
    
    // Verify and fix permissions (Unix only)
    if (process.platform !== 'win32') {
      await fs.chmod(dataDir, 0o700); // Owner only
      
      try {
        const configStats = await fs.stat(CONFIG_FILE_PATH);
        if ((configStats.mode & 0o777) !== 0o600) {
          await fs.chmod(CONFIG_FILE_PATH, 0o600); // Owner read/write only
          console.log('📁 Fixed config file permissions');
        }
      } catch (err) {
        // File doesn't exist yet
      }
    }
  } catch {
    console.log('📁 Creating data directory:', dataDir);
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  }
  
  // Ensure backup directory exists
  try {
    await fs.access(BACKUP_DIR);
  } catch {
    await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  }
}

// Load configuration from JSON file (with decryption)
async function loadConfig() {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(data);
    
    // Decrypt if encrypted
    if (isConfigEncrypted(parsed)) {
      console.log('🔓 Decrypting configuration...');
      return decryptConfig(parsed);
    }
    
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, return default config
      return {
        authType: null,
        lidarr: { url: "", apiKey: "", rootFolder: "", qualityProfileId: "" },
        oidc: { issuerUrl: "", clientId: "", clientSecret: "", domain: "" },
        basicAuth: { username: "", passwordHash: "" }
      };
    }
    throw error;
  }
}

// Save configuration to JSON file (with encryption)
async function saveConfig(configData) {
  await ensureDataDirectory();
  
  // Create backup before saving
  try {
    const existingConfig = await loadConfig();
    await backupConfig(existingConfig, BACKUP_DIR);
  } catch (error) {
    console.warn('⚠️ Could not create backup:', error.message);
  }
  
  // Encrypt sensitive fields
  const encrypted = encryptConfig(configData);
  
  // Write with secure permissions
  await fs.writeFile(
    CONFIG_FILE_PATH, 
    JSON.stringify(encrypted, null, 2), 
    { 
      encoding: 'utf8',
      mode: 0o600 
    }
  );
  
  console.log('💾 Configuration saved and encrypted');
}

// Update specific section of config
async function updateConfigSection(section, data) {
  const currentConfig = await loadConfig();
  currentConfig[section] = { ...currentConfig[section], ...data };
  await saveConfig(currentConfig);
  return currentConfig;
}

function getBaseUrl(fullUrl) {
  try {
    const u = new URL(fullUrl);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return fullUrl;
  }
}

// Get current authentication configuration (sanitized)
router.get("/auth", ensureAuthenticated, async (req, res) => {
  try {
    const configData = await loadConfig();
    const obfuscated = obfuscateConfig(configData);
    
    res.json({
      authEnabled: config.auth.enabled,
      authType: configData.authType || null,
      oidc: {
        domain: obfuscated.oidc?.domain || "",
        issuerUrl: obfuscated.oidc?.issuerUrl || "",
        clientId: obfuscated.oidc?.clientId || "",
        clientSecret: obfuscated.oidc?.clientSecret || '',
        callbackUrl: obfuscated.oidc?.domain ? `https://${obfuscated.oidc.domain}/auth/callback` : ""
      },
      basicAuth: {
        username: obfuscated.basicAuth?.username || "",
        hasPassword: !!configData.basicAuth?.passwordHash
      }
    });
  } catch (error) {
    console.error("Error getting auth config:", error);
    res.status(500).json({ error: "Failed to get authentication configuration" });
  }
});

// Verify current password (for re-authentication)
router.post("/auth/verify-password", ensureAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    const userInfo = req.session?.user?.claims;
    
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }
    
    // Only works for BasicAuth users
    if (userInfo?.authType !== 'basicauth') {
      return res.status(400).json({ error: "Password verification only available for BasicAuth users" });
    }
    
    const username = userInfo.preferred_username || userInfo.sub;
    const isValid = await validateBasicAuthPassword(username, password);
    
    if (!isValid) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid password" 
      });
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error("Error verifying password:", error);
    res.status(500).json({ error: "Failed to verify password" });
  }
});

// Update authentication type
router.post("/auth/set-type", ensureAuthenticated, async (req, res) => {
  try {
    const { authType } = req.body;
    
    if (!['oidc', 'basicauth', null].includes(authType)) {
      return res.status(400).json({ error: "Invalid auth type" });
    }
    
    const currentConfig = await loadConfig();
    const oldAuthType = currentConfig.authType;
    
    // Update auth type in config file
    currentConfig.authType = authType;
    await saveConfig(currentConfig);
    
    // Update runtime config
    config.setAuthType(authType);
    
    // Log auth type change
    const userInfo = req.session?.user?.claims;
    await database.logAuthEvent({
      eventType: 'auth_type_change',
      userId: userInfo?.sub || userInfo?.preferred_username,
      username: userInfo?.preferred_username || userInfo?.name,
      email: userInfo?.email,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      sessionId: req.sessionID,
      errorMessage: `Auth type changed from ${oldAuthType || 'disabled'} to ${authType || 'disabled'}`
    });
    
    console.log(`🔄 Auth type changed from ${oldAuthType || 'disabled'} to ${authType || 'disabled'}`);
    
    // Reinitialize auth system
    const { reinitializeAuth } = require("../../services/auth");
    await reinitializeAuth();
    
    res.json({ 
      success: true, 
      authType: authType,
      message: `Authentication type set to ${authType || 'disabled'}` 
    });
    
  } catch (error) {
    console.error("Error setting auth type:", error);
    res.status(500).json({ error: "Failed to set authentication type" });
  }
});


// Update OIDC configuration (with validation)
router.post("/auth/oidc", 
  ensureAuthenticated,
  validate(schemas.oidcConfig), // Phase 2: Input validation
  async (req, res) => {
    try {
      const { issuerUrl, clientId, clientSecret, domain } = req.body;

      // Test the configuration first
      console.log("🔍 Testing OIDC configuration before saving...");
      const { Issuer } = require("openid-client");
      try {
        const testIssuer = await Issuer.discover(issuerUrl);
        console.log("✅ OIDC configuration test passed");
      } catch (testError) {
        console.error("❌ OIDC configuration test failed:", testError);
        return res.status(400).json({
          error: `Invalid OIDC configuration: ${testError.message}`
        });
      }

      // Save configuration (will be encrypted)
      await updateConfigSection("oidc", {
        issuerUrl,
        clientId,
        clientSecret,
        domain
      });

      // Update in-memory configuration
      config.updateOIDCConfig({ issuerUrl, clientId, clientSecret });
      config.updateDomainConfig(domain);

      console.log("🔄 OIDC configuration updated, reinitializing client...");

      // Reinitialize the OIDC client
      const { reinitializeAuth } = require("../../services/auth");
      const success = await reinitializeAuth();

      if (!success) {
        return res.status(500).json({
          error: "Configuration saved but failed to initialize OIDC client. Check server logs."
        });
      }

      console.log("✅ OIDC client successfully reinitialized");
      res.json({
        success: true,
        message: "OIDC configuration updated successfully",
        authEnabled: config.auth.enabled,
        issuer: issuerUrl
      });
    } catch (error) {
      console.error("❌ Error updating OIDC config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update OIDC configuration"
      });
    }
  }
);

// Update BasicAuth configuration (with validation)
router.post("/auth/basicauth",
  ensureAuthenticated,
  validate(schemas.basicAuthConfig),
  async (req, res) => {
    try {
      const { username, password, currentPassword } = req.body;
      const userInfo = req.session?.user?.claims;
      const currentUser = userInfo?.preferred_username || userInfo?.sub;
      
      // If user is logged in with BasicAuth, require current password
      if (userInfo?.authType === 'basicauth') {
        if (!currentPassword) {
          return res.status(400).json({ 
            error: "Current password is required to change BasicAuth settings" 
          });
        }
        
        const isValid = await validateBasicAuthPassword(currentUser, currentPassword);
        if (!isValid) {
          return res.status(401).json({ error: "Current password is incorrect" });
        }
      }

      // Hash the password
      console.log("🔐 Hashing password...");
      const passwordHash = await hashPassword(password);
      console.log("✅ Password hashed successfully");

      // Save configuration (will be encrypted)
      await updateConfigSection("basicAuth", {
        username,
        passwordHash
      });

      // Update in-memory configuration
      config.updateBasicAuthConfig({ username, passwordHash });

      console.log("🔄 BasicAuth configuration updated");

      // Reinitialize auth
      const { reinitializeAuth } = require("../../services/auth");
      const success = await reinitializeAuth();

      if (!success) {
        return res.status(500).json({
          error: "Configuration saved but failed to initialize BasicAuth. Check server logs."
        });
      }

      console.log("✅ BasicAuth successfully configured");
      res.json({
        success: true,
        message: "BasicAuth configuration updated successfully",
        authEnabled: config.auth.enabled,
        username: username
      });
    } catch (error) {
      console.error("❌ Error updating BasicAuth config:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update BasicAuth configuration"
      });
    }
  }
);

// Test OIDC connection - NO AUTH REQUIRED (for initial setup)
router.post("/auth/test", async (req, res) => {
  try {
    const { issuerUrl, clientId, clientSecret, domain } = req.body;
    
    if (!issuerUrl) {
      return res.status(400).json({ error: "Issuer URL is required for testing" });
    }

    console.log("🔍 Testing OIDC configuration...");
    const { Issuer } = require("openid-client");

    const testIssuer = await Issuer.discover(issuerUrl);
    console.log("✅ OIDC issuer discovery successful");

    const responseData = {
      success: true,
      message: "OIDC configuration test successful",
      issuer: testIssuer.issuer,
      issuerUrl: issuerUrl,
      discoveredEndpoints: {
        authorization: testIssuer.authorization_endpoint,
        token: testIssuer.token_endpoint,
        userinfo: testIssuer.userinfo_endpoint,
        jwks: testIssuer.jwks_uri
      }
    };

    if (clientId && clientSecret) {
      try {
        const testClient = new testIssuer.Client({
          client_id: clientId,
          client_secret: clientSecret,
        });
        
        const testAuthUrl = testClient.authorizationUrl({
          scope: "openid profile email",
          redirect_uri: `https://${domain || 'test.example.com'}/auth/callback`,
          code_challenge: "test_challenge",
          code_challenge_method: "S256",
          state: "test_state",
          nonce: "test_nonce"
        });

        responseData.clientTest = {
          success: true,
          message: "Client credentials are valid",
          authUrlGenerated: true
        };
      } catch (clientError) {
        responseData.clientTest = {
          success: false,
          message: `Client test failed: ${clientError.message}`
        };
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error("❌ OIDC test failed:", error);
    res.status(400).json({
      success: false,
      error: `OIDC test failed: ${error.message}`
    });
  }
});

// Get current Lidarr configuration (sanitized)
router.get("/lidarr", ensureAuthenticated, async (req, res) => {
  try {
    const configData = await loadConfig();
    const obfuscated = obfuscateConfig(configData);
    
    res.json({
      url: obfuscated.lidarr?.url ? getBaseUrl(obfuscated.lidarr.url) : "",
      apiKey: obfuscated.lidarr?.apiKey || '',
      rootFolder: obfuscated.lidarr?.rootFolder || "",
      qualityProfileId: obfuscated.lidarr?.qualityProfileId || ""
    });
  } catch (error) {
    console.error("Error getting Lidarr config:", error);
    res.status(500).json({ error: "Failed to get configuration" });
  }
});

// Update Lidarr configuration (with validation)
router.post("/lidarr",
  ensureAuthenticated,
  validate(schemas.lidarrConfig),
  async (req, res) => {
    try {
      const { url, apiKey, rootFolder, qualityProfileId } = req.body;

      const cleanUrl = url.replace(/\/$/, "");

      // Save configuration (will be encrypted)
      await updateConfigSection("lidarr", {
        url: cleanUrl,
        apiKey,
        rootFolder,
        qualityProfileId
      });

      // Update in-memory configuration
      config.lidarr.url = cleanUrl;
      config.lidarr.apiKey = apiKey;
      config.lidarr.rootFolder = rootFolder;
      config.lidarr.qualityProfileId = qualityProfileId;

      res.json({ success: true, message: "Configuration updated successfully" });
    } catch (error) {
      console.error("Error updating Lidarr config:", error);
      res.status(500).json({ error: "Failed to update configuration" });
    }
  }
);

// Test Lidarr connection (with validation)
router.post("/lidarr/test",
  ensureAuthenticated,
  validate(schemas.lidarrTest),
  async (req, res) => {
    try {
      const { url, apiKey, useSavedApiKey } = req.body;
      
      let testApiKey;
      let testUrl;
      
      if (useSavedApiKey) {
        const configData = await loadConfig();
        
        if (!configData.lidarr?.url || !configData.lidarr?.apiKey) {
          return res.status(400).json({ error: "No saved Lidarr configuration found" });
        }
        testUrl = url || configData.lidarr.url;
        testApiKey = configData.lidarr.apiKey;
      } else {
        testUrl = url;
        testApiKey = apiKey;
      }

      const baseUrl = testUrl.replace(/\/$/, "");
      const statusUrl = `${baseUrl}/api/v1/system/status`;

      const statusResponse = await fetch(statusUrl, {
        headers: { "X-Api-Key": testApiKey },
        timeout: 10000
      });

      if (!statusResponse.ok) {
        if (statusResponse.status === 401) {
          return res.status(400).json({ error: "Invalid API key" });
        } else if (statusResponse.status === 404) {
          return res.status(400).json({ error: "Lidarr API not found" });
        } else {
          return res.status(400).json({ error: `Connection failed: ${statusResponse.status}` });
        }
      }

      const statusData = await statusResponse.json();

      const profilesUrl = `${baseUrl}/api/v1/qualityprofile`;
      const profilesResponse = await fetch(profilesUrl, {
        headers: { "X-Api-Key": testApiKey },
        timeout: 10000
      });

      if (!profilesResponse.ok) {
        return res.json({
          success: true,
          version: statusData.version,
          profiles: [],
          message: "Connection successful but could not load quality profiles"
        });
      }

      const profiles = await profilesResponse.json();

      res.json({
        success: true,
        version: statusData.version,
        profiles: profiles.map(p => ({ id: p.id, name: p.name }))
      });
    } catch (error) {
      console.error("❌ Lidarr connection test failed:", error);
      if (error.code === 'ECONNREFUSED') {
        return res.status(400).json({ error: "Connection refused" });
      } else if (error.code === 'ENOTFOUND') {
        return res.status(400).json({ error: "Host not found" });
      } else {
        return res.status(500).json({ error: `Connection test failed: ${error.message}` });
      }
    }
  }
);

router.post("/lidarr/rootfolders", ensureAuthenticated, async (req, res) => {
  try {
    const { url, apiKey, useSavedApiKey } = req.body;
    
    let testApiKey;
    let testUrl;
    
    if (useSavedApiKey) {
      const configData = await loadConfig();
      const lidarrConfig = configData.lidarr || {};
      
      if (!lidarrConfig.url || !lidarrConfig.apiKey) {
        return res.status(400).json({ error: "No saved Lidarr configuration found" });
      }
      testUrl = url || lidarrConfig.url;
      testApiKey = lidarrConfig.apiKey;
    } else {
      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API key are required" });
      }
      testUrl = url;
      testApiKey = apiKey;
    }

    try {
      new URL(testUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const baseUrl = testUrl.replace(/\/$/, "");
    const rootFoldersUrl = `${baseUrl}/api/v1/rootfolder`;

    const response = await fetch(rootFoldersUrl, {
      headers: { "X-Api-Key": testApiKey },
      timeout: 10000
    });

    if (!response.ok) {
      return res.status(400).json({ error: "Failed to get root folders from Lidarr" });
    }

    const rootFolders = await response.json();

    res.json({
      rootFolders: rootFolders.map(rf => ({
        id: rf.id,
        path: rf.path,
        accessible: rf.accessible,
        freeSpace: rf.freeSpace,
        totalSpace: rf.totalSpace
      }))
    });
  } catch (error) {
    console.error("❌ Error getting root folders:", error);
    res.status(500).json({ error: "Failed to get root folders" });
  }
});

module.exports = router;