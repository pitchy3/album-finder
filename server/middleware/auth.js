// server/middleware/auth.js - Authentication middleware with proper API vs page handling
const config = require("../config");

// Helper: ensure authenticated (no-op if auth disabled)
function ensureAuthenticated(req, res, next) {
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
  
  //console.log("Auth check - session user exists:", !!req.session.user);
  
  if (req.session.user) return next();
  
  // Determine if this is an API request or a page request
  const isApiRequest = req.path.startsWith('/api/') || req.xhr || req.headers['content-type'] === 'application/json';
  
  if (isApiRequest) {
    // For API requests, return JSON error instead of redirect
    console.log("API request not authenticated, returning 401");
    return res.status(401).json({ 
      error: "Authentication required", 
      loginUrl: "/auth/login" 
    });
  } else {
    // For page requests, save returnTo and redirect to login
    req.session.returnTo = req.originalUrl;
    console.log("Page request not authenticated, redirecting to login, returnTo:", req.originalUrl);
    return res.redirect("/auth/login");
  }
}

module.exports = {
  ensureAuthenticated
};