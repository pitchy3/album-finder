// server/routes/auth.js - Updated with Phase 1 security enhancements
const express = require("express");
const { generators } = require("../config/openidClient");
const config = require("../config");
const { getClient, getIssuer, recoverOIDCClient, validateBasicAuthPassword } = require("../services/auth");
const { database } = require("../services/database");
const { encryptToken, decryptToken } = require("../services/tokenEncryption");
const { errorDetails } = require('../utils/oidcDiagnostics');
const { authLimiter, checkProgressiveLockout, recordAuthSuccess, recordAuthFailure } = require("../middleware/rateLimit");

const debug = (process.env.NODE_ENV.toLowerCase() !== 'production' || process.env.DEBUG.toLowerCase() === 'true');
const SAFE_OAUTH_ERRORS = new Set([
  'access_denied', 'interaction_required', 'login_required', 'account_selection_required',
  'consent_required', 'invalid_request', 'temporarily_unavailable', 'server_error'
]);

function safeOAuthError(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return SAFE_OAUTH_ERRORS.has(normalized) ? normalized : null;
}

function callbackDiagnostics(error, req) {
  const secrets = [config.session.secret, config.oidc?.clientSecret, req?.query?.code, req?.headers?.authorization, req?.headers?.cookie];
  return {
    timestamp: new Date().toISOString(),
    sessionId: req.sessionID || null,
    ...errorDetails(error, secrets)
  };
}

function createAuthRoutes() {
  const router = express.Router();

  router.post("/login/basicauth", authLimiter, checkProgressiveLockout, async (req, res) => {
    const isSecure = req.secure || req.get('X-Forwarded-Proto') === 'https';
    if (!isSecure && process.env.REQUIRE_HTTPS_AUTH === 'true') {
      return res.status(403).json({ error: 'HTTPS required for authentication', details: 'This server requires encrypted connections for security' });
    }
    if (config.auth.type !== 'basicauth') return res.status(400).json({ error: "BasicAuth is not enabled" });
    const { username, password } = req.body;
    if (!username || !password) {
      await recordAuthFailure(req);
      return res.status(400).json({ error: "Username and password are required" });
    }
    try {
      const isValid = await validateBasicAuthPassword(username, password);
      if (!isValid) {
        const lockoutSeconds = await recordAuthFailure(req);
        await database.logAuthEvent({
          eventType: 'login_failure', userId: username, username, email: null,
          ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'),
          errorMessage: 'Invalid username or password', sessionId: req.sessionID
        });
        const response = { error: "Invalid username or password" };
        if (lockoutSeconds > 0) {
          response.retryAfter = lockoutSeconds;
          response.message = `Account locked. Try again in ${lockoutSeconds} seconds.`;
        }
        return res.status(401).json(response);
      }
      await recordAuthSuccess(req);
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: "Failed to create session" });
        req.session.user = { claims: { sub: username, preferred_username: username, name: username, authType: 'basicauth' } };
        database.logAuthEvent({
          eventType: 'login_success', userId: username, username, email: null,
          ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'), sessionId: req.sessionID
        });
        req.session.save((saveErr) => saveErr
          ? res.status(500).json({ error: "Failed to create session" })
          : res.json({ success: true, user: { username, authType: 'basicauth' } }));
      });
    } catch (error) {
      await recordAuthFailure(req);
      res.status(500).json({ error: "Authentication error" });
    }
  });

  router.get("/login", async (req, res) => {
    if (config.auth.type === 'basicauth') return res.redirect('/?auth=basicauth');
    if (config.auth.type !== 'oidc') return res.status(400).send("Authentication is not configured. Please configure authentication in Settings.");
    let client = getClient();
    if (!client) client = await recoverOIDCClient();
    if (!client) {
      res.set('Retry-After', '10');
      return res.status(503).send('<h2>Authentication Temporarily Unavailable</h2><p>The identity provider could not be reached. Please try again shortly.</p>');
    }
    if (!req.session) return res.status(500).send("Session not available");
    try {
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      req.session.codeVerifier = codeVerifier;
      req.session.state = generators.state();
      req.session.nonce = generators.nonce();
      req.session.save((err) => {
        if (err) return res.status(500).send("Session error during login setup");
        try {
          const authUrl = client.authorizationUrl({
            scope: config.oidc.scopes, redirect_uri: config.oidc.redirectUrl,
            code_challenge: codeChallenge, code_challenge_method: "S256",
            state: req.session.state, nonce: req.session.nonce
          });
          res.redirect(authUrl);
        } catch {
          res.status(500).send("Failed to generate login URL.");
        }
      });
    } catch {
      res.status(500).send("Error setting up login flow");
    }
  });

  router.get("/callback", async (req, res) => {
    if (config.auth.type !== 'oidc') return res.status(400).send("OIDC authentication is not configured");
    if (!req.session) return res.status(500).send("Session not available");
    const client = getClient();
    if (!client) return res.status(503).send("Authentication temporarily unavailable");

    try {
      const params = client.callbackParams(req);
      if (params.error) {
        const oauthError = safeOAuthError(params.error);
        await database.logAuthEvent({
          eventType: 'login_failure', userId: null, username: null, email: null,
          ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'),
          errorMessage: oauthError || 'oidc_callback_error', sessionId: req.sessionID,
          metadata: { oauthError: oauthError || 'unrecognized_oauth_error' }
        });
        return res.status(400).send(oauthError
          ? `Authentication failed (${oauthError}). Please try again.`
          : 'Authentication failed. Please try again.');
      }
      if (!req.session.codeVerifier || !req.session.state || !req.session.nonce) {
        return res.status(400).send("Session expired. Please try logging in again.");
      }
      if (params.state !== req.session.state) return res.status(400).send("Invalid state parameter");

      const tokenSet = await client.callback(config.oidc.redirectUrl, params, {
        code_verifier: req.session.codeVerifier, state: req.session.state, nonce: req.session.nonce
      });
      const idTokenClaims = tokenSet.claims();
      if (idTokenClaims.nonce !== req.session.nonce) throw new Error('ID token nonce mismatch');
      const userinfo = await client.userinfo(tokenSet.access_token);
      delete req.session.codeVerifier;
      delete req.session.state;
      delete req.session.nonce;

      req.session.regenerate(async (err) => {
        if (err) return res.status(500).send("Failed to create session");
        try {
          req.session.user = {
            claims: { ...userinfo, authType: 'oidc' },
            tokens: {
              access_token: encryptToken(tokenSet.access_token, config.session.secret),
              id_token: tokenSet.id_token ? encryptToken(tokenSet.id_token, config.session.secret) : null,
              refresh_token: tokenSet.refresh_token ? encryptToken(tokenSet.refresh_token, config.session.secret) : null,
              expires_at: tokenSet.expires_at
            }
          };
          await database.logAuthEvent({
            eventType: 'login_success', userId: userinfo.sub,
            username: userinfo.preferred_username || userinfo.name, email: userinfo.email,
            ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'),
            sessionId: req.sessionID, oidcSubject: userinfo.sub
          });
          req.session.save((saveErr) => {
            if (saveErr) return res.status(500).send("Failed to save authentication session");
            const redirectTo = req.session.returnTo || "/";
            delete req.session.returnTo;
            res.redirect(redirectTo);
          });
        } catch {
          return res.status(500).send("Failed to secure authentication tokens");
        }
      });
    } catch (err) {
      const details = callbackDiagnostics(err, req);
      console.error('❌ OIDC callback failed:', details);
      await database.logAuthEvent({
        eventType: 'login_failure', userId: null, username: null, email: null,
        ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'),
        errorMessage: 'oidc_callback_failed', sessionId: req.sessionID, metadata: details
      });
      res.status(500).send('Authentication failed. Please try again.');
    }
  });

  router.post("/logout", async (req, res) => {
    const userInfo = req.session?.user?.claims;
    const authType = userInfo?.authType || config.auth.type;
    if (userInfo) {
      await database.logAuthEvent({
        eventType: 'logout', userId: userInfo.sub || userInfo.preferred_username,
        username: userInfo.preferred_username || userInfo.name, email: userInfo.email,
        ipAddress: req.ip || req.connection.remoteAddress, userAgent: req.get('User-Agent'),
        sessionId: req.sessionID, oidcSubject: userInfo.sub
      });
    }
    const tokens = req.session?.user?.tokens;
    let providerLogoutUrl = null;
    if (authType === 'oidc') {
      const client = getClient();
      let refreshToken = null;
      let idToken = null;
      if (tokens?.refresh_token) {
        try { refreshToken = decryptToken(tokens.refresh_token, config.session.secret); } catch {}
      }
      if (refreshToken && typeof client?.revoke === 'function') {
        try { await client.revoke(refreshToken); } catch {}
      }
      if (tokens?.id_token) {
        try { idToken = decryptToken(tokens.id_token, config.session.secret); } catch {}
      }
      const endSessionEndpoint = getIssuer()?.metadata?.end_session_endpoint || client?.issuer?.metadata?.end_session_endpoint;
      if (endSessionEndpoint) {
        try {
          const logoutUrl = new URL(endSessionEndpoint);
          if (idToken) logoutUrl.searchParams.set("id_token_hint", idToken);
          else if (config.oidc.clientId) logoutUrl.searchParams.set("client_id", config.oidc.clientId);
          logoutUrl.searchParams.set("post_logout_redirect_uri", `https://${config.domain}/`);
          providerLogoutUrl = logoutUrl.toString();
        } catch {}
      }
    }
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.clearCookie("albumfinder.sid");
      res.clearCookie("__Host-albumfinder.sid");
      if (providerLogoutUrl && config.auth.type === 'oidc') return res.redirect(providerLogoutUrl);
      res.redirect("/");
    });
  });

  router.get("/debug", (req, res) => {
    const client = getClient();
    res.json({
      authEnabled: config.auth.enabled, authType: config.auth.type,
      clientAvailable: !!client, sessionExists: !!req.session,
      userLoggedIn: !!(req.session && req.session.user), userAuthType: req.session?.user?.claims?.authType
    });
  });

  return router;
}

module.exports = createAuthRoutes;
