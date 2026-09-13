// server/routes/auth.js - Updated with Phase 1 security enhancements
const express = require("express");
const { generators } = require("../config/openidClient");
const config = require("../config");
const { getClient, getIssuer, recoverOIDCClient, validateBasicAuthPassword } = require("../services/auth");
const { database } = require("../services/database");
const { encryptToken, decryptToken } = require("../services/tokenEncryption");
const { 
  authLimiter, 
  checkProgressiveLockout, 
  recordAuthSuccess, 
  recordAuthFailure 
} = require("../middleware/rateLimit");

const debug = ( process.env.NODE_ENV.toLowerCase() !== 'production' || process.env.DEBUG.toLowerCase() === 'true' );

function createAuthRoutes() {
  const router = express.Router();

  console.log("🔧 Creating auth routes - auth type:", config.auth.type || 'disabled');

  // BasicAuth login route - with rate limiting and timing attack protection
  router.post("/login/basicauth", 
    authLimiter,              // Express rate limiter (5 attempts per 15 min)
    checkProgressiveLockout,  // Progressive lockout (escalating delays)
    async (req, res) => {
      console.log("🔐 BasicAuth login attempt");
      
      // Check if connection is secure
      const isSecure = req.secure || req.get('X-Forwarded-Proto') === 'https';
      
      if (!isSecure) {
        console.error("🚨 CRITICAL SECURITY WARNING 🚨");
        console.error("BasicAuth credentials transmitted over INSECURE HTTP");
        console.error(`Client: ${req.ip}`);
        console.error("Credentials may have been intercepted");
        
        // Optionally reject if configured to require HTTPS
        if (process.env.REQUIRE_HTTPS_AUTH === 'true') {
          return res.status(403).json({
            error: 'HTTPS required for authentication',
            details: 'This server requires encrypted connections for security'
          });
        }
      }
      
      if (config.auth.type !== 'basicauth') {
        return res.status(400).json({ error: "BasicAuth is not enabled" });
      }
      
      const { username, password } = req.body;
      
      if (!username || !password) {
        await recordAuthFailure(req);
        return res.status(400).json({ error: "Username and password are required" });
      }
      
      try {
        // validateBasicAuthPassword now includes timing attack protection
        const isValid = await validateBasicAuthPassword(username, password);
        
        if (!isValid) {
          console.log("❌ BasicAuth login failed: Invalid credentials");
          
          // Record failure and get lockout duration
          const lockoutSeconds = await recordAuthFailure(req);
          
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
          
          const response = { 
            error: "Invalid username or password"
          };
          
          if (lockoutSeconds > 0) {
            response.retryAfter = lockoutSeconds;
            response.message = `Account locked. Try again in ${lockoutSeconds} seconds.`;
          }
          
          return res.status(401).json(response);
        }
        
        // Success! Record it
        await recordAuthSuccess(req);
        
        // Regenerate session ID to prevent session fixation
        req.session.regenerate((err) => {
          if (err) {
            console.error("❌ Error regenerating session:", err);
            return res.status(500).json({ error: "Failed to create session" });
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
          database.logAuthEvent({
            eventType: 'login_success',
            userId: username,
            username: username,
            email: null,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            sessionId: req.sessionID
          });
          
          console.log("✅ BasicAuth login successful:", username);
          
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error("❌ Error saving session:", saveErr);
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
        });
        
      } catch (error) {
        console.error("❌ BasicAuth login error:", error);
        await recordAuthFailure(req);
        res.status(500).json({ error: "Authentication error" });
      }
    }
  );

  // OIDC login route
  router.get("/login", async (req, res) => {
	if (debug) {
      console.log("🔐 /auth/login accessed");
	}
    
    if (config.auth.type === 'basicauth') {
      return res.redirect('/?auth=basicauth');
    }
    
    if (config.auth.type !== 'oidc') {
      return res.status(400).send("Authentication is not configured. Please configure authentication in Settings.");
    }
    
    let client = getClient();
    
    if (!client) {
      console.warn("⚠️ No OIDC client available; attempting recovery");
      client = await recoverOIDCClient();
    }

    if (!client) {
      console.error("❌ OIDC client temporarily unavailable after recovery attempt");
      res.set('Retry-After', '10');
      return res.status(503).send(`
        <html>
          <body>
            <h2>Authentication Temporarily Unavailable</h2>
            <p>The identity provider could not be reached. Please try again shortly.</p>
            <p><a href="/auth/login">Try again</a></p>
          </body>
        </html>
      `);
    }
    
    if (!req.session) {
      console.error("❌ No session available");
      return res.status(500).send("Session not available");
    }
    
	if (debug) {
      console.log("🔐 Starting OIDC login flow...");
	}
    
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
          
		  if (debug) {
            console.log("🔐 Redirecting to OIDC provider");
		  }
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

  // OIDC callback route - with enhanced token encryption
  router.get("/callback", async (req, res) => {
	if (debug) {
      console.log("🔄 /auth/callback accessed");
	}
    
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
        
        await database.logAuthEvent({
          eventType: 'login_failure',
          userId: null,
          username: null,
          email: null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          errorMessage: `OIDC callback error: ${params.error}`,
          sessionId: req.sessionID
        });
        
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
      
      // Clear OIDC-specific session data
      delete req.session.codeVerifier;
      delete req.session.state;
      delete req.session.nonce;

      // Regenerate session ID to prevent session fixation
      req.session.regenerate(async (err) => {
        if (err) {
          console.error("❌ Error regenerating session:", err);
          return res.status(500).send("Failed to create session");
        }
        
        try {
          // Encrypt tokens using new secure method
          req.session.user = {
            claims: {
              ...userinfo,
              authType: 'oidc'
            },
            tokens: {
              access_token: encryptToken(tokenSet.access_token, config.session.secret),
              id_token: encryptToken(tokenSet.id_token, config.session.secret),
              refresh_token: tokenSet.refresh_token 
                ? encryptToken(tokenSet.refresh_token, config.session.secret) 
                : null,
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
            
			if (debug) {
              console.log("✅ OIDC authentication successful");
			}
            res.redirect(redirectTo);
          });
        } catch (encryptError) {
          console.error("❌ Token encryption error:", encryptError);
          return res.status(500).send("Failed to secure authentication tokens");
        }
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
	if (debug) {
      console.log("🚪 Logout requested");
	}
    
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
    
    // Capture everything needed for provider logout before destroying the local
    // session. Provider operations are deliberately best-effort: none of them
    // may prevent local logout.
    const tokens = req.session?.user?.tokens;
    let providerLogoutUrl = null;

    if (authType === 'oidc') {
      const client = getClient();
      let refreshToken = null;
      let idToken = null;

      if (tokens?.refresh_token) {
        try {
          refreshToken = decryptToken(tokens.refresh_token, config.session.secret);
        } catch (err) {
          console.warn("⚠️ Unable to prepare refresh token for revocation");
        }
      }

      if (refreshToken && typeof client?.revoke === 'function') {
        try {
          await client.revoke(refreshToken);
		  if (debug) {
            console.log("✅ Refresh token revoked at provider");
		  }
        } catch (err) {
          console.warn("⚠️ Token revocation failed");
        }
      }

      if (tokens?.id_token) {
        try {
          idToken = decryptToken(tokens.id_token, config.session.secret);
        } catch (err) {
          console.warn("⚠️ Unable to prepare ID token for provider logout");
        }
      }

      const endSessionEndpoint = getIssuer()?.metadata?.end_session_endpoint
        || client?.issuer?.metadata?.end_session_endpoint;

      if (endSessionEndpoint) {
        try {
          const logoutUrl = new URL(endSessionEndpoint);
          if (idToken) {
            logoutUrl.searchParams.set("id_token_hint", idToken);
          } else if (config.oidc.clientId) {
            // RP-Initiated Logout providers need a client identifier to
            // validate the registered post-logout redirect when no ID token
            // hint is available (for example, refresh-token-only sessions).
            logoutUrl.searchParams.set("client_id", config.oidc.clientId);
          } else {
            throw new Error("OIDC logout requires an ID token or client ID");
          }
          logoutUrl.searchParams.set("post_logout_redirect_uri", `https://${config.domain}/`);
          providerLogoutUrl = logoutUrl.toString();
        } catch (err) {
          console.warn("⚠️ Unable to create provider logout URL");
        }
      }
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error("❌ Error destroying session:", err);
      }
      
      res.clearCookie("connect.sid");
      res.clearCookie("albumfinder.sid");
      res.clearCookie("__Host-albumfinder.sid");
      
      if (providerLogoutUrl && config.auth.type === 'oidc') {
        return res.redirect(providerLogoutUrl);
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
