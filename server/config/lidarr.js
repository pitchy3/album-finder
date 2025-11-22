/**
 * Lidarr service configuration constants
 * Centralizes all timeouts, polling intervals, and cache TTLs
 * 
 * @module config/lidarr
 */

module.exports = {
  // API request timeouts (milliseconds)
  timeouts: {
    standard: 10000,      // Standard API calls (10s)
    refresh: 30000,       // Artist refresh operations (30s)
    maxRefreshWait: 30000 // Maximum time to wait for refresh completion
  },

  // Polling configuration for async operations
  polling: {
    interval: 1000,       // Check every 1 second
    maxAttempts: 30       // Max 30 attempts = 30 seconds total
  },

  // Retry configuration
  retry: {
    maxAttempts: 3,
    backoffMs: 1000
  },

  // Cache TTLs (seconds)
  cache: {
    albumLookup: 300,     // 5 minutes
    artistStatus: 300,    // 5 minutes
    albumList: 300        // 5 minutes
  }
};