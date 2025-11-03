// server/routes/auth.js - Authentication routes supporting both OIDC and BasicAuth
const express = require("express");
const { generators } = require("openid-client");
const config = require("../config");
const { getClient, validateBasicAuthPassword } = require("../services/auth");
const { database } = require("../services/database");

function createAuthRoutes(clientParam) {
  const router = express.Router();

  console.log("🔧 Creating auth routes - auth type:", config.auth.type || 'disabled');

  // BasicAuth login route
  router.post("/login/basicauth", async (req, res) => {
    console.log("🔐 BasicAuth login attempt");
    
    if (config.auth.type !== 'basicauth') {
      return res.status(400).json({ error: "BasicAuth is not enabled" });
    }
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    
    try {
      const isValid = await validateBasicAuthPassword(username, password);
      
      if (!isValid) {
        console.log("❌ BasicAuth login failed: Invalid credentials");
        
        await database.logAuthEvent({
          eventType: 'login_failure',
          userId: username,
          username: username,
          email: null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          errorMessage: 'Invalid username or password',
          sessionId: req.sessionID
        });
        
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      // Create user session
      req.session.user = {
        claims: {
          sub: username,
          preferred_username: username,
          name: username,
          authType: 'basicauth'
        }
      };
      
      // Log successful login
      await database.logAuthEvent({
        eventType: 'login_success',
        userId: username,
        username: username,
        email: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID
      });
      
      console.log("✅ BasicAuth login successful:", username);
      
      req.session.save((err) => {
        if (err) {
          console.error("❌ Error saving session:", err);
          return res.status(500).json({ error: "Failed to create session" });
        }
        
        res.json({ 
          success: true, 
          user: {
            username,
            authType: 'basicauth'
          }
        });
      });
      
    } catch (error) {
      console.error("❌ BasicAuth login error:", error);
      res.status(500).json({ error: "Authentication error" });
    }
  });

  // OIDC login route
  router.get("/login", (req, res) => {
    console.log("🔐 /auth/login accessed");
    
    if (config.auth.type === 'basicauth') {
      // Redirect to BasicAuth login page
      return res.redirect('/?auth=basicauth');
    }
    
    if (config.auth.type !== 'oidc') {
      return res.status(400).send("Authentication is not configured. Please configure authentication in Settings.");
    }
    
    const client = getClient();
    
    if (!client) {
      console.error("❌ No OIDC client available");
      return res.status(500).send(`
        <html>
          <body>
            <h2>Authentication Configuration Error</h2>
            <p>OIDC client is not properly configured.</p>
            <p><a href="/">Go back to home page</a> and try accessing Settings to reconfigure.</p>
          </body>
        </html>
      `);
    }
    
    if (!req.session) {
      console.error("❌ No session available");
      return res.status(500).send("Session not available");
    }
    
    console.log("🔐 Starting OIDC login flow...");
    
    try {
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();
      const nonce = generators.nonce();
      
      req.session.codeVerifier = codeVerifier;
      req.session.state = state;
      req.session.nonce = nonce;
      
      req.session.save((err) => {
        if (err) {
          console.error("❌ Session save error:", err);
          return res.status(500).send("Session error during login setup");
        }
        
        try {
          const authUrl = client.authorizationUrl({
            scope: config.oidc.scopes,
            redirect_uri: config.oidc.redirectUrl,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state: state,
            nonce: nonce
          });
          
          console.log("🔐 Redirecting to OIDC provider");
          res.redirect(authUrl);
        } catch (urlError) {
          console.error("❌ Error generating authorization URL:", urlError);
          res.status(500).send("Failed to generate login URL.");
        }
      });
    } catch (error) {
      console.error("❌ Error in login flow setup:", error);
      res.status(500).send("Error setting up login flow");
    }
  });

  // OIDC callback route
  router.get("/callback", async (req, res) => {
    console.log("🔄 /auth/callback accessed");
    
    if (config.auth.type !== 'oidc') {
      return res.status(400).send("OIDC authentication is not configured");
    }
    
    if (!req.session) {
      console.error("❌ No session in callback");
      return res.status(500).send("Session not available");
    }
    
    const client = getClient();
    if (!client) {
      console.error("❌ No OIDC client available in callback");
      return res.status(500).send("Authentication not properly configured");
    }
    
    try {
      const params = client.callbackParams(req);
      
      if (params.error) {
        console.error("❌ OIDC callback error:", params.error);
        return res.status(400).send(`Authentication error: ${params.error}`);
      }
      
      if (!req.session.codeVerifier || !req.session.state || !req.session.nonce) {
        console.error("❌ Missing session data");
        return res.status(400).send("Session expired. Please try logging in again.");
      }
      
      if (params.state !== req.session.state) {
        console.error("❌ State mismatch");
        return res.status(400).send("Invalid state parameter");
      }
      
      const tokenSet = await client.callback(
        config.oidc.redirectUrl, 
        params, 
        {
          code_verifier: req.session.codeVerifier,
          state: req.session.state,
          nonce: req.session.nonce
        }
      );

      // Validate ID token
      const idTokenClaims = tokenSet.claims();
      
      if (idTokenClaims.nonce !== req.session.nonce) {
        throw new Error('ID token nonce mismatch');
      }

      const userinfo = await client.userinfo(tokenSet.access_token);
      
      delete req.session.codeVerifier;
      delete req.session.state;
      delete req.session.nonce;

      // Encrypt tokens
      const crypto = require('crypto');
      
      function encryptToken(token, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(key, 'salt', 32), iv);
        let encrypted = cipher.update(token, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
      }

      req.session.user = {
        claims: {
          ...userinfo,
          authType: 'oidc'
        },
        tokens: {
          access_token: encryptToken(tokenSet.access_token, config.session.secret),
          id_token: encryptToken(tokenSet.id_token, config.session.secret),
          refresh_token: tokenSet.refresh_token ? encryptToken(tokenSet.refresh_token, config.session.secret) : null,
          expires_at: tokenSet.expires_at
        }
      };

      await database.logAuthEvent({
        eventType: 'login_success',
        userId: userinfo.sub,
        username: userinfo.preferred_username || userinfo.name,
        email: userinfo.email,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID,
        oidcSubject: userinfo.sub
      });

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("❌ Error saving user session:", saveErr);
          return res.status(500).send("Failed to save authentication session");
        }

        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        
        console.log("✅ OIDC authentication successful");
        res.redirect(redirectTo);
      });
      
    } catch (err) {
      console.error("❌ Callback error:", err.message);

      await database.logAuthEvent({
        eventType: 'login_failure',
        userId: null,
        username: null,
        email: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        errorMessage: err.message,
        sessionId: req.sessionID
      });
      
      res.status(500).send(`Authentication error: ${err.message}`);
    }
  });

  // Unified logout route
  router.post("/logout", async (req, res) => {
    console.log("🚪 Logout requested");
    
    const userInfo = req.session?.user?.claims;
    const authType = userInfo?.authType || config.auth.type;
    
    if (userInfo) {
      await database.logAuthEvent({
        eventType: 'logout',
        userId: userInfo.sub || userInfo.preferred_username,
        username: userInfo.preferred_username || userInfo.name,
        email: userInfo.email,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID,
        oidcSubject: userInfo.sub
      });
    }
    
    // For OIDC, try to revoke tokens
    if (authType === 'oidc') {
      const tokens = req.session?.user?.tokens;
      const client = getClient();
      
      if (tokens?.refresh_token && client?.revoke) {
        try {
          await client.revoke(tokens.refresh_token);
          console.log("✅ Refresh token revoked at provider");
        } catch (err) {
          console.warn("⚠️ Token revocation failed:", err.message);
        }
      }
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Error destroying session:", err);
      }
      
      res.clearCookie("connect.sid");
      res.clearCookie("albumfinder.sid");
      
      // For OIDC, redirect to provider logout if available
      if (authType === 'oidc' && config.auth.type === 'oidc') {
        const tokens = req.session?.user?.tokens;
        if (tokens?.id_token) {
          const logoutUrl = new URL(`${config.oidc.issuerUrl}/protocol/openid-connect/logout`);
          logoutUrl.searchParams.set("id_token_hint", tokens.id_token);
          logoutUrl.searchParams.set("post_logout_redirect_uri", `https://${config.domain}/`);
          return res.redirect(logoutUrl.toString());
        }
      }
      
      res.redirect("/");
    });
  });

  // Auth status debug endpoint
  router.get("/debug", (req, res) => {
    const client = getClient();
    res.json({
      authEnabled: config.auth.enabled,
      authType: config.auth.type,
      clientAvailable: !!client,
      sessionExists: !!req.session,
      userLoggedIn: !!(req.session && req.session.user),
      userAuthType: req.session?.user?.claims?.authType
    });
  });

  console.log("🔧 Auth routes created successfully");
  return router;
}

module.exports = createAuthRoutes;