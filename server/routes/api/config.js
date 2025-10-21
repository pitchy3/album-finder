// server/routes/api/config.js - Configuration management API routes
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const config = require("../../config");
const { ensureAuthenticated } = require("../../middleware/auth");
const router = express.Router();

// Path to the configuration file
const CONFIG_FILE_PATH = path.join(__dirname, "../../data/config.json");

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.dirname(CONFIG_FILE_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// Load configuration from JSON file
async function loadConfig() {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, return default config
      return {
        lidarr: {
          url: "",
          apiKey: "",
          rootFolder: "",
          qualityProfileId: ""
        },
        oidc: {
          issuerUrl: "",
          clientId: "",
          clientSecret: "",
          domain: ""
        }
      };
    }
    throw error;
  }
}

// Save configuration to JSON file
async function saveConfig(configData) {
  await ensureDataDirectory();
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(configData, null, 2), "utf8");
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
    // fallback if invalid
    return fullUrl;
  }
}

// Get current Lidarr configuration (sanitized)
router.get("/lidarr", ensureAuthenticated, async (req, res) => {
  try {
    const configData = await loadConfig();
    const lidarrConfig = configData.lidarr || {};
    
    res.json({
      url: lidarrConfig.url ? getBaseUrl(lidarrConfig.url) : "",
      apiKey: lidarrConfig.apiKey ? '***' + lidarrConfig.apiKey.slice(-4) : '', // Show only last 4 chars for security
      rootFolder: lidarrConfig.rootFolder || "",
      qualityProfileId: lidarrConfig.qualityProfileId || ""
    });
  } catch (error) {
    console.error("Error getting Lidarr config:", error);
    res.status(500).json({ error: "Failed to get configuration" });
  }
});

// Get current authentication configuration (sanitized)
router.get("/auth", async (req, res) => {
  try {
    const configData = await loadConfig();
    const oidcConfig = configData.oidc || {};
    
    res.json({
      domain: oidcConfig.domain || "",
      issuerUrl: oidcConfig.issuerUrl || "",
      clientId: oidcConfig.clientId || "",
      clientSecret: oidcConfig.clientSecret ? '***' + oidcConfig.clientSecret.slice(-4) : '',
      callbackUrl: oidcConfig.domain ? `https://${oidcConfig.domain}/auth/callback` : "",
      authEnabled: config.auth.enabled
    });
  } catch (error) {
    console.error("Error getting auth config:", error);
    res.status(500).json({ error: "Failed to get authentication configuration" });
  }
});

// Update authentication configuration
router.post("/auth", ensureAuthenticated, async (req, res) => {
  try {
    const { issuerUrl, clientId, clientSecret, domain } = req.body;
    
    // Validate required fields
    if (!issuerUrl || !clientId || !clientSecret || !domain) {
      return res.status(400).json({
        error: "All fields are required: issuerUrl, clientId, clientSecret, domain"
      });
    }

    // Test the configuration first
    console.log("🔍 Testing OIDC configuration before saving...");
    const { Issuer } = require("openid-client");
    try {
      const testIssuer = await Issuer.discover(issuerUrl);
      console.log("✅  OIDC configuration test passed");
    } catch (testError) {
      console.error("❌  OIDC configuration test failed:", testError);
      return res.status(400).json({
        error: `Invalid OIDC configuration: ${testError.message}`
      });
    }

    // Save configuration to JSON file
    await updateConfigSection("oidc", {
      issuerUrl,
      clientId,
      clientSecret,
      domain
    });

    // Update in-memory configuration for backward compatibility
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

    console.log("✅  OIDC client successfully reinitialized");
    res.json({
      success: true,
      message: "OIDC configuration updated successfully",
      authEnabled: config.auth.enabled,
      issuer: issuerUrl
    });
  } catch (error) {
    console.error("❌  Error updating OIDC config:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update OIDC configuration"
    });
  }
});

// Test OIDC connection - NO AUTH REQUIRED (needed to test before auth is working)
router.post("/auth/test", async (req, res) => {
  try {
    const { issuerUrl, clientId, clientSecret, domain } = req.body;
    
    if (!issuerUrl) {
      return res.status(400).json({ error: "Issuer URL is required for testing" });
    }

    console.log("🔍 Testing OIDC configuration...");
    console.log("🔍 Testing issuer:", issuerUrl);

    const { Issuer } = require("openid-client");

    // Try to discover the issuer
    const testIssuer = await Issuer.discover(issuerUrl);
    console.log("✅  OIDC issuer discovery successful");
    console.log("✅  Discovered issuer:", testIssuer.issuer);

    // Prepare response data
    const responseData = {
      success: true,
      message: "OIDC configuration test successful",
      issuer: testIssuer.issuer, // This is the key fix - use testIssuer.issuer
      issuerUrl: issuerUrl,
      discoveredEndpoints: {
        authorization: testIssuer.authorization_endpoint,
        token: testIssuer.token_endpoint,
        userinfo: testIssuer.userinfo_endpoint,
        jwks: testIssuer.jwks_uri
      }
    };

    // If we have client credentials, test them too
    if (clientId && clientSecret) {
      try {
        const testClient = new testIssuer.Client({
          client_id: clientId,
          client_secret: clientSecret,
        });
        console.log("✅  OIDC client creation successful");

        // Test if we can generate an auth URL
        const testAuthUrl = testClient.authorizationUrl({
          scope: "openid profile email",
          redirect_uri: `https://${domain || 'test.example.com'}/auth/callback`,
          code_challenge: "test_challenge",
          code_challenge_method: "S256",
          state: "test_state",
          nonce: "test_nonce"
        });
        console.log("✅  OIDC authorization URL generation successful");

        // Add client test results
        responseData.clientTest = {
          success: true,
          message: "Client credentials are valid",
          authUrlGenerated: true
        };
      } catch (clientError) {
        console.warn("⚠️ Client test failed:", clientError.message);
        responseData.clientTest = {
          success: false,
          message: `Client test failed: ${clientError.message}`
        };
      }
    } else {
      responseData.clientTest = {
        success: false,
        message: "Client ID and secret not provided - only issuer discovery tested"
      };
    }

    console.log("✅  OIDC test completed successfully");
    res.json(responseData);
  } catch (error) {
    console.error("❌  OIDC test failed:", error);
    res.status(400).json({
      success: false,
      error: `OIDC test failed: ${error.message}`,
      issuer: null,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update Lidarr configuration
router.post("/lidarr", ensureAuthenticated, async (req, res) => {
  try {
    const { url, apiKey, rootFolder, qualityProfileId } = req.body;
    
    // Validate required fields
    if (!url || !apiKey || !rootFolder || !qualityProfileId) {
      return res.status(400).json({
        error: "All fields are required: url, apiKey, rootFolder, qualityProfileId"
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const cleanUrl = url.replace(/\/$/, ""); // Remove trailing slash

    // Save configuration to JSON file
    await updateConfigSection("lidarr", {
      url: cleanUrl,
      apiKey,
      rootFolder,
      qualityProfileId
    });

    // Update in-memory configuration for backward compatibility
    config.lidarr.url = cleanUrl;
    config.lidarr.apiKey = apiKey;
    config.lidarr.rootFolder = rootFolder;
    config.lidarr.qualityProfileId = qualityProfileId;

    console.log("✅  Lidarr configuration updated:", {
      url: cleanUrl,
      apiKey: '***' + apiKey.slice(-4),
      rootFolder: rootFolder,
      qualityProfileId: qualityProfileId
    });

    res.json({ success: true, message: "Configuration updated successfully" });
  } catch (error) {
    console.error("Error updating Lidarr config:", error);
    res.status(500).json({ error: "Failed to update configuration" });
  }
});

// Test Lidarr connection and get quality profiles
router.post("/lidarr/test", ensureAuthenticated, async (req, res) => {
  try {
    const { url, apiKey, useSavedApiKey } = req.body;
    
    // Determine which API key to use
    let testApiKey;
    let testUrl;
    
    if (useSavedApiKey) {
      // Use saved configuration from JSON file
      const configData = await loadConfig();
      const lidarrConfig = configData.lidarr || {};
      
      if (!lidarrConfig.url || !lidarrConfig.apiKey) {
        return res.status(400).json({ error: "No saved Lidarr configuration found" });
      }
      testUrl = url || lidarrConfig.url; // Allow URL override
      testApiKey = lidarrConfig.apiKey;
    } else {
      // Use provided parameters
      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API key are required" });
      }
      testUrl = url;
      testApiKey = apiKey;
    }

    // Validate URL format
    try {
      new URL(testUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const baseUrl = testUrl.replace(/\/$/, "");
    console.log("🧪 Testing Lidarr connection:", baseUrl, useSavedApiKey ? "(using saved API key)" : "");

    // Test connection by getting system status
    const statusUrl = `${baseUrl}/api/v1/system/status`;
    console.log("📡 Testing status endpoint:", statusUrl);

    const statusResponse = await fetch(statusUrl, {
      headers: { "X-Api-Key": testApiKey },
      timeout: 10000 // 10 second timeout
    });

    if (!statusResponse.ok) {
      console.error("❌  Status check failed:", {
        status: statusResponse.status,
        statusText: statusResponse.statusText
      });
      if (statusResponse.status === 401) {
        return res.status(400).json({ error: "Invalid API key" });
      } else if (statusResponse.status === 404) {
        return res.status(400).json({ error: "Lidarr API not found. Check URL and ensure Lidarr is running" });
      } else {
        return res.status(400).json({ error: `Connection failed: ${statusResponse.status} ${statusResponse.statusText}` });
      }
    }

    const statusData = await statusResponse.json();
    console.log("✅  Lidarr connection successful, version:", statusData.version);

    // Get quality profiles
    const profilesUrl = `${baseUrl}/api/v1/qualityprofile`;
    console.log("📡 Getting quality profiles:", profilesUrl);

    const profilesResponse = await fetch(profilesUrl, {
      headers: { "X-Api-Key": testApiKey },
      timeout: 10000
    });

    if (!profilesResponse.ok) {
      console.error("⚠️ Failed to get quality profiles:", {
        status: profilesResponse.status,
        statusText: profilesResponse.statusText
      });
      // Connection works but can't get profiles - still return success
      return res.json({
        success: true,
        version: statusData.version,
        profiles: [],
        message: "Connection successful but could not load quality profiles"
      });
    }

    const profiles = await profilesResponse.json();
    console.log("📋 Quality profiles loaded:", profiles.length);

    res.json({
      success: true,
      version: statusData.version,
      profiles: profiles.map(p => ({ id: p.id, name: p.name }))
    });
  } catch (error) {
    console.error("❌  Lidarr connection test failed:", error);
    if (error.code === 'ECONNREFUSED') {
      return res.status(400).json({ error: "Connection refused. Check if Lidarr is running and accessible" });
    } else if (error.code === 'ENOTFOUND') {
      return res.status(400).json({ error: "Host not found. Check the URL" });
    } else if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
      return res.status(400).json({ error: "Connection timeout. Check URL and network connectivity" });
    } else {
      return res.status(500).json({ error: `Connection test failed: ${error.message}` });
    }
  }
});

// Get root folders from Lidarr
router.post("/lidarr/rootfolders", ensureAuthenticated, async (req, res) => {
  try {
    const { url, apiKey, useSavedApiKey } = req.body;
    
    // Determine which API key to use
    let testApiKey;
    let testUrl;
    
    if (useSavedApiKey) {
      // Use saved configuration from JSON file
      const configData = await loadConfig();
      const lidarrConfig = configData.lidarr || {};
      
      if (!lidarrConfig.url || !lidarrConfig.apiKey) {
        return res.status(400).json({ error: "No saved Lidarr configuration found" });
      }
      testUrl = url || lidarrConfig.url; // Allow URL override
      testApiKey = lidarrConfig.apiKey;
    } else {
      // Use provided parameters
      if (!url || !apiKey) {
        return res.status(400).json({ error: "URL and API key are required" });
      }
      testUrl = url;
      testApiKey = apiKey;
    }

    // Validate URL format
    try {
      new URL(testUrl);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const baseUrl = testUrl.replace(/\/$/, "");
    const rootFoldersUrl = `${baseUrl}/api/v1/rootfolder`;
    console.log("📡 Getting root folders:", rootFoldersUrl, useSavedApiKey ? "(using saved API key)" : "");

    const response = await fetch(rootFoldersUrl, {
      headers: { "X-Api-Key": testApiKey },
      timeout: 10000
    });

    if (!response.ok) {
      console.error("❌  Failed to get root folders:", {
        status: response.status,
        statusText: response.statusText
      });
      return res.status(400).json({ error: "Failed to get root folders from Lidarr" });
    }

    const rootFolders = await response.json();
    console.log("📂 Root folders loaded:", rootFolders.length);

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
    console.error("❌  Error getting root folders:", error);
    res.status(500).json({ error: "Failed to get root folders" });
  }
});

// Debug route to check data directory status (remove in production)
router.get("/debug/data-dir", async (req, res) => {
  try {
    const dataDir = path.dirname(CONFIG_FILE_PATH);
    const stats = await fs.stat(dataDir).catch(() => null);
    const configExists = await fs.access(CONFIG_FILE_PATH, fs.constants.F_OK).then(() => true).catch(() => false);
    const configWritable = await fs.access(CONFIG_FILE_PATH, fs.constants.W_OK).then(() => true).catch(() => false);
    
    res.json({
      dataDir,
      configFile: CONFIG_FILE_PATH,
      dataDirExists: !!stats,
      dataDirStats: stats ? {
        isDirectory: stats.isDirectory(),
        mode: '0' + (stats.mode & parseInt('777', 8)).toString(8)
      } : null,
      configExists,
      configWritable,
      processUid: process.getuid?.(),
      processGid: process.getgid?.()
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

module.exports = router;