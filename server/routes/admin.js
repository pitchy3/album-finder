// server/routes/admin.js - Admin routes for cache and queue management
const express = require("express");
const { ensureAuthenticated } = require("../middleware/auth");
const { cache } = require("../services/cache");
const { requestQueue } = require("../services/queue");

// Import logs routes
const logsRoutes = require("./api/logs");

const router = express.Router();

// Admin endpoints for cache and queue management
router.get("/cache/stats", ensureAuthenticated, (req, res) => {
  // TODO: Add proper admin role checking here
  res.json(cache.getStats());
});

router.delete("/cache/flush", ensureAuthenticated, (req, res) => {
  // TODO: Add proper admin role checking here
  cache.flushAll();
  res.json({ message: "Cache flushed successfully" });
});

router.get("/queue/stats", ensureAuthenticated, (req, res) => {
  // TODO: Add proper admin role checking here
  res.json(requestQueue.getStats());
});

module.exports = router;