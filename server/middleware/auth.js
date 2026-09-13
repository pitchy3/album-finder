// server/middleware/auth.js - Unified authentication middleware
const config = require("../config");

function ensureAuthenticated(req, res, next) {
  // API-key auth is request-scoped and is established by apiKeyAuthMiddleware.
  if (req.apiKeyAuthenticated) {
    return next();
  }

  // Check current auth status (may have changed dynamically)
  if (!config.auth.enabled) {
    console.log("Auth check skipped - authentication disabled");
    return next();
  }
  
  // Check if session exists
  if (!req.session) {
    console.error("Session middleware not initialized - req.session is undefined");
    return res.status(500).json({ error: "Session not initialized" });
  }
  
  if (req.session.user) return next();
  
  // Determine if this is an API request or a page request. Keep req.path for
  // mounted routers, and also consider originalUrl for direct middleware use.
  const isApiRequest = req.path?.startsWith('/api/')
    || req.originalUrl?.startsWith('/api/')
    || req.xhr
    || req.headers['content-type'] === 'application/json';
  
  if (isApiRequest) {
    console.log("API request not authenticated, returning 401");
    return res.status(401).json({ 
      error: "Authentication required", 
      loginUrl: "/auth/login" 
    });
  }

  req.session.returnTo = req.originalUrl;
  console.log("Page request not authenticated, redirecting to login, returnTo:", req.originalUrl);
  return res.redirect("/auth/login");
}

module.exports = {
  ensureAuthenticated
};
