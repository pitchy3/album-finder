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
  validateBasicAuthPassword,
  prepareOIDCClient,
  publishOIDCClient,
  reinitializeAuth
} = require("../../services/auth");

const router = express.Router();
const CONFIG_FILE_PATH = path.join(__dirname, "../../data/config.json");
const BACKUP_DIR = path.join(__dirname, "../../data/backups");

async function ensureDataDirectory() {
  const dataDir = path.dirname(CONFIG_FILE_PATH);
  try {
    await fs.access(dataDir);
    if (process.platform !== 'win32') {
      await fs.chmod(dataDir, 0o700);
      try {
        const configStats = await fs.stat(CONFIG_FILE_PATH);
        if ((configStats.mode & 0o777) !== 0o600) {
          await fs.chmod(CONFIG_FILE_PATH, 0o600);
          console.log('📁 Fixed config file permissions');
        }
      } catch {}
    }
  } catch {
    console.log('📁 Creating data directory:', dataDir);
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  }

  try { await fs.access(BACKUP_DIR); }
  catch { await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 }); }
}

async function loadConfig() {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(data);
    if (isConfigEncrypted(parsed)) {
      console.log('🔓 Decrypting configuration...');
      return decryptConfig(parsed);
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
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

async function saveConfig(configData) {
  await ensureDataDirectory();
  try {
    const existingConfig = await loadConfig();
    await backupConfig(existingConfig, BACKUP_DIR);
  } catch (error) {
    console.warn('⚠️ Could not create backup:', error.message);
  }

  const encrypted = encryptConfig(configData);
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(encrypted, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  console.log('💾 Configuration saved and encrypted');
}

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

function applyRuntimeConfig(configData) {
  if (configData.oidc) {
    config.updateOIDCConfig({
      issuerUrl: configData.oidc.issuerUrl || '',
      clientId: configData.oidc.clientId || '',
      clientSecret: configData.oidc.clientSecret || ''
    });
    if (configData.oidc.domain) config.updateDomainConfig(configData.oidc.domain);
  }
  if (configData.basicAuth) {
    config.updateBasicAuthConfig({
      username: configData.basicAuth.username || '',
      passwordHash: configData.basicAuth.passwordHash || ''
    });
  }
  config.setAuthType(configData.authType ?? null);
}

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

router.post("/auth/verify-password", ensureAuthenticated, async (req, res) => {
  try {
    const { password } = req.body;
    const userInfo = req.session?.user?.claims;
    if (!password) return res.status(400).json({ error: "Password is required" });
    if (userInfo?.authType !== 'basicauth') {
      return res.status(400).json({ error: "Password verification only available for BasicAuth users" });
    }
    const username = userInfo.preferred_username || userInfo.sub;
    const isValid = await validateBasicAuthPassword(username, password);
    if (!isValid) return res.status(401).json({ success: false, error: "Invalid password" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error verifying password:", error);
    res.status(500).json({ error: "Failed to verify password" });
  }
});

router.post("/auth/set-type", ensureAuthenticated, async (req, res) => {
  try {
    const { authType } = req.body;
    if (!['oidc', 'basicauth', null].includes(authType)) {
      return res.status(400).json({ error: "Invalid auth type" });
    }

    const currentConfig = await loadConfig();
    const oldAuthType = currentConfig.authType;
    const nextConfig = { ...currentConfig, authType };

    let preparedOIDC = null;
    if (authType === 'oidc') {
      preparedOIDC = await prepareOIDCClient({
        issuerUrl: currentConfig.oidc?.issuerUrl,
        clientId: currentConfig.oidc?.clientId,
        clientSecret: currentConfig.oidc?.clientSecret
      });
      if (!preparedOIDC.client) {
        return res.status(503).json({
          success: false,
          error: "OIDC is temporarily unavailable; authentication type was not changed."
        });
      }
    }

    await saveConfig(nextConfig);
    applyRuntimeConfig(nextConfig);

    const success = authType === 'oidc'
      ? publishOIDCClient(preparedOIDC)
      : await reinitializeAuth();

    if (!success) {
      applyRuntimeConfig(currentConfig);
      await saveConfig(currentConfig);
      await reinitializeAuth();
      return res.status(500).json({
        success: false,
        error: "Failed to activate authentication type; previous configuration was restored."
      });
    }

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

    res.json({
      success: true,
      authType,
      message: `Authentication type set to ${authType || 'disabled'}`
    });
  } catch (error) {
    console.error("Error setting auth type:", error);
    res.status(500).json({ error: "Failed to set authentication type" });
  }
});

router.post("/auth/oidc",
  ensureAuthenticated,
  validate(schemas.oidcConfig),
  async (req, res) => {
    try {
      const { issuerUrl, clientId, clientSecret, domain } = req.body;
      const currentConfig = await loadConfig();
      const nextConfig = {
        ...currentConfig,
        oidc: {
          ...currentConfig.oidc,
          issuerUrl,
          clientId,
          clientSecret,
          domain
        }
      };

      console.log("🔍 Testing staged OIDC configuration before saving...");
      const prepared = await prepareOIDCClient({ issuerUrl, clientId, clientSecret });
      if (!prepared.client) {
        return res.status(400).json({
          success: false,
          error: "Invalid or unavailable OIDC configuration. Existing configuration was left unchanged."
        });
      }

      try {
        await saveConfig(nextConfig);
      } catch (persistError) {
        console.error("❌ Failed to persist staged OIDC configuration:", persistError);
        return res.status(500).json({
          success: false,
          error: "Failed to save OIDC configuration. Existing configuration remains active."
        });
      }

      applyRuntimeConfig(nextConfig);
      if (!publishOIDCClient(prepared)) {
        applyRuntimeConfig(currentConfig);
        await saveConfig(currentConfig);
        await reinitializeAuth();
        return res.status(500).json({
          success: false,
          error: "Failed to activate OIDC configuration; previous configuration was restored."
        });
      }

      console.log("✅ OIDC configuration committed atomically");
      res.json({
        success: true,
        message: "OIDC configuration updated successfully",
        authEnabled: config.auth.enabled,
        issuer: issuerUrl
      });
    } catch (error) {
      console.error("❌ Error updating OIDC config:", error);
      res.status(500).json({ success: false, error: "Failed to update OIDC configuration" });
    }
  }
);

router.post("/auth/basicauth",
  ensureAuthenticated,
  validate(schemas.basicAuthConfig),
  async (req, res) => {
    try {
      const { username, password, currentPassword } = req.body;
      const userInfo = req.session?.user?.claims;
      const currentUser = userInfo?.preferred_username || userInfo?.sub;
      if (userInfo?.authType === 'basicauth') {
        if (!currentPassword) return res.status(400).json({ error: "Current password is required to change BasicAuth settings" });
        const isValid = await validateBasicAuthPassword(currentUser, currentPassword);
        if (!isValid) return res.status(401).json({ error: "Current password is incorrect" });
      }

      const passwordHash = await hashPassword(password);
      await updateConfigSection("basicAuth", { username, passwordHash });
      config.updateBasicAuthConfig({ username, passwordHash });
      const success = await reinitializeAuth();
      if (!success) return res.status(500).json({ error: "Configuration saved but failed to initialize BasicAuth. Check server logs." });

      res.json({ success: true, message: "BasicAuth configuration updated successfully", authEnabled: config.auth.enabled, username });
    } catch (error) {
      console.error("❌ Error updating BasicAuth config:", error);
      res.status(500).json({ success: false, error: "Failed to update BasicAuth configuration" });
    }
  }
);

router.post("/auth/test", async (req, res) => {
  try {
    const { issuerUrl, clientId, clientSecret, domain } = req.body;
    if (!issuerUrl) return res.status(400).json({ error: "Issuer URL is required for testing" });
    const { Issuer } = require("../../config/openidClient");
    const testIssuer = await Issuer.discover(issuerUrl);
    const responseData = {
      success: true,
      message: "OIDC configuration test successful",
      issuer: testIssuer.issuer,
      issuerUrl,
      discoveredEndpoints: {
        authorization: testIssuer.authorization_endpoint,
        token: testIssuer.token_endpoint,
        userinfo: testIssuer.userinfo_endpoint,
        jwks: testIssuer.jwks_uri
      }
    };
    if (clientId && clientSecret) {
      try {
        const testClient = new testIssuer.Client({ client_id: clientId, client_secret: clientSecret });
        testClient.authorizationUrl({
          scope: "openid profile email",
          redirect_uri: `https://${domain || 'test.example.com'}/auth/callback`,
          code_challenge: "test_challenge",
          code_challenge_method: "S256",
          state: "test_state",
          nonce: "test_nonce"
        });
        responseData.clientTest = { success: true, message: "Client credentials are valid", authUrlGenerated: true };
      } catch (clientError) {
        responseData.clientTest = { success: false, message: `Client test failed: ${clientError.message}` };
      }
    }
    res.json(responseData);
  } catch (error) {
    console.error("❌ OIDC test failed:", error);
    res.status(400).json({ success: false, error: `OIDC test failed: ${error.message}` });
  }
});

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

router.post("/lidarr", ensureAuthenticated, validate(schemas.lidarrConfig), async (req, res) => {
  try {
    const { url, apiKey, rootFolder, qualityProfileId } = req.body;
    const cleanUrl = url.replace(/\/$/, "");
    await updateConfigSection("lidarr", { url: cleanUrl, apiKey, rootFolder, qualityProfileId });
    config.updateLidarrConfig({ url: cleanUrl, apiKey, rootFolder, qualityProfileId });
    res.json({ success: true, message: "Configuration updated successfully" });
  } catch (error) {
    console.error("Error updating config:", error);
    res.status(500).json({ error: "Failed to update configuration" });
  }
});

router.post("/lidarr/test", async (req, res) => {
  try {
    const { url, apiKey } = req.body;
    if (!url || !apiKey) return res.status(400).json({ error: "URL and API key are required" });
    const cleanUrl = url.replace(/\/$/, "");
    const statusResponse = await fetch(`${cleanUrl}/api/v1/system/status`, { headers: { 'X-Api-Key': apiKey } });
    if (!statusResponse.ok) {
      if (statusResponse.status === 401) return res.status(400).json({ error: "Invalid API key" });
      return res.status(400).json({ error: `Lidarr returned ${statusResponse.status}: ${statusResponse.statusText}` });
    }
    const profilesResponse = await fetch(`${cleanUrl}/api/v1/qualityprofile`, { headers: { 'X-Api-Key': apiKey } });
    if (!profilesResponse.ok) return res.status(400).json({ error: "Unable to fetch quality profiles" });
    const profiles = await profilesResponse.json();
    res.json({ success: true, profiles });
  } catch (error) {
    const message = error.code === 'ENOTFOUND' || error.cause?.message?.includes('ENOTFOUND')
      ? 'Host not found'
      : error.message;
    res.status(400).json({ error: message });
  }
});

router.post("/lidarr/rootfolders", async (req, res) => {
  try {
    let { url, apiKey, useSavedApiKey } = req.body;
    if (useSavedApiKey) {
      const stored = await loadConfig();
      apiKey = stored.lidarr?.apiKey;
    }
    if (!url || !apiKey) return res.status(400).json({ error: "URL and API key are required" });
    const cleanUrl = url.replace(/\/$/, "");
    const response = await fetch(`${cleanUrl}/api/v1/rootfolder`, { headers: { 'X-Api-Key': apiKey } });
    if (!response.ok) return res.status(400).json({ error: `Lidarr returned ${response.status}` });
    const rootFolders = await response.json();
    res.json({ success: true, rootFolders });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;