// server/services/queue.js - Request queue management with dynamic timeouts
const config = require("../config");

// Fair request queuing system
class RequestQueue {
  constructor() {
    this.queue = [];
    this.activeRequests = new Map(); // userId -> count
    this.processing = false;
    this.maxConcurrent = config.rateLimit.maxConcurrentRequests;
  }

  async add(userId, requestFn, timeout = config.rateLimit.requestTimeout) {
    return new Promise((resolve, reject) => {
      const request = {
        userId,
        requestFn,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout: setTimeout(() => {
          reject(new Error('Request timeout'));
          this.remove(request);
        }, timeout)
      };

      this.queue.push(request);
      this.process();
    });
  }

  remove(request) {
    const index = this.queue.indexOf(request);
    if (index > -1) {
      this.queue.splice(index, 1);
    }
    if (request.timeout) {
      clearTimeout(request.timeout);
    }
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      // Count active requests per user
      const userCounts = new Map();
      this.queue.forEach(req => {
        userCounts.set(req.userId, (userCounts.get(req.userId) || 0) + 1);
      });

      // Find next request to process (fair scheduling)
      let nextRequest = null;
      let minActiveCount = Infinity;

      for (const request of this.queue) {
        const userActiveCount = this.activeRequests.get(request.userId) || 0;
        if (userActiveCount < minActiveCount) {
          minActiveCount = userActiveCount;
          nextRequest = request;
        }
      }

      if (!nextRequest || this.getTotalActiveRequests() >= this.maxConcurrent) {
        break;
      }

      // Remove from queue and track as active
      this.remove(nextRequest);
      this.activeRequests.set(nextRequest.userId, (this.activeRequests.get(nextRequest.userId) || 0) + 1);

      // Process request
      this.processRequest(nextRequest);
    }

    this.processing = false;
  }

  async processRequest(request) {
    try {
      const result = await request.requestFn();
      clearTimeout(request.timeout);
      request.resolve(result);
    } catch (error) {
      clearTimeout(request.timeout);
      request.reject(error);
    } finally {
      // Decrement active count
      const count = this.activeRequests.get(request.userId) || 1;
      if (count <= 1) {
        this.activeRequests.delete(request.userId);
      } else {
        this.activeRequests.set(request.userId, count - 1);
      }

      // Process next requests
      setImmediate(() => this.process());
    }
  }

  getTotalActiveRequests() {
    return Array.from(this.activeRequests.values()).reduce((sum, count) => sum + count, 0);
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.getTotalActiveRequests(),
      maxConcurrent: this.maxConcurrent,
      activeByUser: Object.fromEntries(this.activeRequests)
    };
  }
}

// Helper function to get user ID
function getUserId(req) {
  return req.session?.user?.claims?.sub || req.ip || 'anonymous';
}

// Helper function to get user ID
function getUsername(req) {
  return req.session?.user?.claims?.preferred_username || req.ip || 'anonymous';
}

// Calculate dynamic timeout based on request parameters
function calculateTimeout(req) {
  const baseTimeout = config.rateLimit.requestTimeout; // 30 seconds
  
  // Check if this is a paginated MusicBrainz request
  if (req.originalUrl && req.originalUrl.includes('/api/musicbrainz/release-group')) {
    const limit = parseInt(req.query?.limit) || 50;
    
    // If limit is 'all' or > 25, this will require pagination
    if (req.query?.limit === 'all' || limit > 25) {
      // Calculate estimated batches needed
      const targetLimit = req.query?.limit === 'all' ? 500 : limit;
      const batches = Math.ceil(targetLimit / 25);
      
      // Each batch takes ~1.1 seconds delay + ~2 seconds for request = ~3.2 seconds per batch
      // Add extra buffer for processing and network variations
      const estimatedTime = batches * 4000; // 4 seconds per batch
      const bufferTime = Math.max(30000, estimatedTime * 1.5); // At least 30s, or 1.5x estimated
      
      console.log(`⏱️ Dynamic timeout: ${targetLimit} limit requires ${batches} batches, setting ${Math.round(bufferTime/1000)}s timeout`);
      return Math.min(bufferTime, 300000); // Cap at 5 minutes
    }
  }
  
  // Check for other potentially long-running requests
  if (req.originalUrl && (
    req.originalUrl.includes('/api/lidarr/add') ||
    req.originalUrl.includes('/api/coverart/')
  )) {
    return baseTimeout * 2; // 60 seconds for Lidarr/cover art requests
  }
  
  return baseTimeout; // Default 30 seconds
}

// Helper function to queue API requests with dynamic timeout
async function queuedApiCall(req, res, apiFunction) {
  const userId = getUserId(req);
  const dynamicTimeout = calculateTimeout(req);
  
  try {
    const result = await requestQueue.add(userId, () => apiFunction(req), dynamicTimeout);
    res.json(result);
  } catch (error) {
    if (error.message && error.message.includes("Cover art not found")) {
      // Special handling for cover art error
      console.log(`Coverart was not found for`, req.params);
      res.status(404).json({ 
        error: "Cover art not found", 
        params: req.params 
      });
    } else if (error.message === 'Request timeout') {
      // Enhanced timeout error with more context
      console.error(`Request timeout for user ${userId} on ${req.originalUrl} (timeout: ${Math.round(dynamicTimeout/1000)}s)`);
      res.status(504).json({ 
        error: "Request timeout - the operation took too long to complete", 
        details: "This can happen with large searches. Try reducing the limit or searching for a more specific term.",
        timeout: Math.round(dynamicTimeout/1000),
        queueStats: requestQueue.getStats()
      });
    } else {
      console.error(`API call failed for user ${userId}:`, error);
      res.status(500).json({ 
        error: "API request failed", 
        details: error.message,
        queueStats: requestQueue.getStats()
      });
    }
  }
}

// Initialize request queue
const requestQueue = new RequestQueue();

module.exports = {
  requestQueue,
  getUserId,
  getUsername,
  queuedApiCall
};
