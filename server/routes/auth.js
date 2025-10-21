// server/routes/auth.js - Fixed authentication routes with proper client handling
const express = require("express");
const { generators } = require("openid-client");
const config = require("../config");
const { getClient } = require("../services/auth");
const { database } = require("../services/database");

function createAuthRoutes(clientParam) {
  const router = express.Router();

  console.log("🔧 Creating auth routes - auth enabled:", config.auth.enabled);
  console.log("🔧 Client parameter provided:", !!clientParam);

  router.get("/login", (req, res) => {
    console.log("🔐 /auth/login accessed");
    console.log("🔐 Auth enabled:", config.auth.enabled);
    console.log("🔐 Session exists:", !!req.session);
    
    if (!config.auth.enabled) {
      console.log("🔐 Auth not enabled, returning error");
      return res.status(400).send("Authentication is not configured. Please configure OIDC settings first.");
    }
    
    // Get the current client (IMPORTANT: use getClient() instead of parameter)
    const client = getClient();
    console.log("🔐 OIDC client available:", !!client);
    
    if (!client) {
      console.error("❌ No OIDC client available");
      return res.status(500).send(`
        <html>
          <body>
            <h2>Authentication Configuration Error</h2>
            <p>OIDC client is not properly configured. This usually happens when:</p>
            <ul>
              <li>OIDC settings were just saved and the client needs to be reinitialized</li>
              <li>There's an error in the OIDC configuration</li>
              <li>The OIDC provider is unreachable</li>
            </ul>
            <p><a href="/">Go back to home page</a> and try accessing Settings to reconfigure.</p>
            <p>If the problem persists, check the server logs for more details.</p>
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
      // Generate PKCE parameters AND nonce
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();
      const nonce = generators.nonce();
      
      // Store all parameters in session
      req.session.codeVerifier = codeVerifier;
      req.session.state = state;
      req.session.nonce = nonce;
      
      console.log("🔐 Generated PKCE and nonce parameters");
      console.log("🔐 Callback URL:", config.oidc.redirectUrl);
      
      // Save session before redirect
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
          
          console.log("🔐 Redirecting to OIDC provider:", authUrl);
          res.redirect(authUrl);
        } catch (urlError) {
          console.error("❌ Error generating authorization URL:", urlError);
          res.status(500).send("Failed to generate login URL. Check OIDC configuration.");
        }
      });
    } catch (error) {
      console.error("❌ Error in login flow setup:", error);
      res.status(500).send("Error setting up login flow");
    }
  });

  router.get("/callback", async (req, res) => {
    console.log("🔄 /auth/callback accessed");
    console.log("🔄 Query params:", req.query);
    
    if (!config.auth.enabled) {
      return res.status(400).send("Authentication is not configured");
    }
    
    if (!req.session) {
      console.error("❌ No session in callback");
      return res.status(500).send("Session not available");
    }
    
    // Get current client (dynamic)
    const client = getClient();
    if (!client) {
      console.error("❌ No OIDC client available in callback");
      return res.status(500).send("Authentication not properly configured - client missing");
    }
    
    try {
      const params = client.callbackParams(req);
      console.log("🔄 Parsed callback params:", params);
      
      // Check for error in callback
      if (params.error) {
        console.error("❌ OIDC callback error:", params.error, params.error_description);
        return res.status(400).send(`Authentication error: ${params.error} - ${params.error_description}`);
      }
      
      // Validate session data exists
      if (!req.session.codeVerifier || !req.session.state || !req.session.nonce) {
        console.error("❌ Missing session data:", {
          hasCodeVerifier: !!req.session.codeVerifier,
          hasState: !!req.session.state,
          hasNonce: !!req.session.nonce
        });
        return res.status(400).send("Session expired or invalid. Please try logging in again.");
      }
      
      // Validate state parameter
      if (params.state !== req.session.state) {
        console.error("❌ State mismatch:", {
          received: params.state,
          expected: req.session.state
        });
        return res.status(400).send("Invalid state parameter - possible CSRF attack");
      }
      
      console.log("🔄 Performing token exchange...");
      
      // Perform callback with PKCE and nonce validation
      const tokenSet = await client.callback(
        config.oidc.redirectUrl, 
        params, 
        {
          code_verifier: req.session.codeVerifier,
          state: req.session.state,
          nonce: req.session.nonce
        }
      );

      console.log("🔄 Token exchange successful, validating ID token...");

      // Validate ID token claims
      try {
        // Comprehensive ID token validation
        const idTokenClaims = tokenSet.claims();
        
        // Validate nonce
        if (idTokenClaims.nonce !== req.session.nonce) {
          throw new Error('ID token nonce mismatch');
        }
        
        // Validate issuer
        if (idTokenClaims.iss !== config.oidc.issuerUrl) {
          throw new Error('ID token issuer mismatch');
        }
        
        // Validate audience (client_id)
        if (idTokenClaims.aud !== config.oidc.clientId) {
          throw new Error('ID token audience mismatch');
        }
        
        // Validate token expiration
        if (Date.now() >= (idTokenClaims.exp * 1000)) {
          throw new Error('ID token has expired');
        }
        
        // Validate issued at time (not too old)
        const maxAge = 300; // 5 minutes
        if (Date.now() > (idTokenClaims.iat * 1000) + (maxAge * 1000)) {
          throw new Error('ID token is too old');
        }
        
        // Additional validation for sub claim
        if (!idTokenClaims.sub || idTokenClaims.sub.length === 0) {
          throw new Error('ID token missing subject claim');
        }
        
        console.log("✅ ID token validation successful:", {
          sub: idTokenClaims.sub,
          iss: idTokenClaims.iss,
          exp: new Date(idTokenClaims.exp * 1000).toISOString()
        });
        
      } catch (validationError) {
        console.error("❌ ID token validation failed:", validationError.message);
        // Clear session data on validation failure
        delete req.session.codeVerifier;
        delete req.session.state;
        delete req.session.nonce;
        return res.status(400).send(`ID token validation failed: ${validationError.message}`);
      }

      console.log("🔄 Getting user info...");

      // Get user info
      const userinfo = await client.userinfo(tokenSet.access_token);
      console.log("🔄 User info received:", {
        sub: userinfo.sub,
        email: userinfo.email,
        username: userinfo.preferred_username
      });

      // Clear PKCE data from session
      delete req.session.codeVerifier;
      delete req.session.state;
      delete req.session.nonce;
	  
	  // Encrypt sensitive tokens before storing
      const crypto = require('crypto');
      
      function encryptToken(token, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(key, 'salt', 32), iv); // ← Use createCipheriv
        let encrypted = cipher.update(token, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
      }

      // Store encrypted tokens
      req.session.user = {
        claims: userinfo,
        tokens: {
          access_token: encryptToken(tokenSet.access_token, config.session.secret),
          id_token: encryptToken(tokenSet.id_token, config.session.secret),
          refresh_token: tokenSet.refresh_token ? encryptToken(tokenSet.refresh_token, config.session.secret) : null,
          expires_at: tokenSet.expires_at
        }
      };

      // In the /callback route, after successful token validation and before session save
      console.log("🔄 User info received:", {
        sub: userinfo.sub,
        email: userinfo.email,
        username: userinfo.preferred_username
      });

      // ADD THIS LOGGING BLOCK
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

      console.log("🔄 User stored in session, saving...");

      // Save session before redirect
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("❌ Error saving user session:", saveErr);
          return res.status(500).send("Failed to save authentication session");
        }

        // Redirect to original URL
        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        
        console.log("✅ Authentication successful, redirecting to:", redirectTo);
        res.redirect(redirectTo);
      });
      
    } catch (err) {
      console.error("❌ Callback error:", err.message);
      console.error("❌ Full error:", err);

      await database.logAuthEvent({
        eventType: 'login_failure',
        userId: null,
        username: null,
        email: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        errorMessage: err.message,
        sessionId: req.sessionID,
        oidcSubject: null
      });
      
      // Clear session data on error
      if (req.session) {
        delete req.session.codeVerifier;
        delete req.session.state;
        delete req.session.nonce;
        delete req.session.returnTo;
      }
      
      res.status(500).send(`Authentication error: ${err.message}`);
    }
  });

  router.post("/logout", async (req, res) => {
    console.log("🚪 Logout requested");
    
    const tokens = req.session?.user?.tokens;
	const userInfo = req.session?.user?.claims;
	
	if (userInfo) {
      await database.logAuthEvent({
        eventType: 'logout',
        userId: userInfo.sub,
        username: userInfo.preferred_username || userInfo.name,
        email: userInfo.email,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID,
        oidcSubject: userInfo.sub
      });
    }
    
    // Revoke tokens at provider if possible
    if (tokens?.refresh_token && client.revoke) {
      try {
        await client.revoke(tokens.refresh_token);
        console.log("✅ Refresh token revoked at provider");
      } catch (err) {
        console.warn("⚠️ Token revocation failed:", err.message);
      }
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Error destroying session:", err);
      }
      
      res.clearCookie("connect.sid");
      res.clearCookie("albumfinder.sid");
      
      if (tokens?.id_token && config.auth.enabled) {
        console.log("🚪 Redirecting to OIDC logout");
        const logoutUrl = new URL(`${config.oidc.issuerUrl}/protocol/openid-connect/logout`);
        logoutUrl.searchParams.set("id_token_hint", tokens.id_token);
        logoutUrl.searchParams.set("post_logout_redirect_uri", `https://${config.domain}/`);
        
        return res.redirect(logoutUrl.toString());
      }
      
      res.redirect("/");
    });
  });

  // Debug endpoint to check auth status
  router.get("/debug", (req, res) => {
    const client = getClient();
    res.json({
      authEnabled: config.auth.enabled,
      clientAvailable: !!client,
      sessionExists: !!req.session,
      userLoggedIn: !!(req.session && req.session.user),
      oidcConfig: {
        issuerUrl: config.oidc.issuerUrl,
        clientId: config.oidc.clientId,
        redirectUrl: config.oidc.redirectUrl,
        hasClientSecret: !!config.oidc.clientSecret,
        domain: config.domain
      }
    });
  });

  console.log("🔧 Auth routes created successfully");
  return router;
}

module.exports = createAuthRoutes;
