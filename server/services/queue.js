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
        timeoutId: null,
        settled: false
      };

      request.timeoutId = setTimeout(() => {
        if (request.settled) return;

        request.settled = true;
        const removedFromQueue = this.removeFromQueue(request);
        reject(new Error('Request timeout'));

        if (removedFromQueue) {
          setImmediate(() => this.process());
        }
      }, timeout);

      this.queue.push(request);
      this.process();
    });
  }

  removeFromQueue(request) {
    const index = this.queue.indexOf(request);
    if (index > -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const userCounts = new Map();
      this.queue.forEach(req => {
        userCounts.set(req.userId, (userCounts.get(req.userId) || 0) + 1);
      });

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

      this.removeFromQueue(nextRequest);
      this.activeRequests.set(nextRequest.userId, (this.activeRequests.get(nextRequest.userId) || 0) + 1);
      this.processRequest(nextRequest);
    }

    this.processing = false;
  }

  async processRequest(request) {
    try {
      const result = await request.requestFn();
      if (!request.settled) {
        request.settled = true;
        clearTimeout(request.timeoutId);
        request.resolve(result);
      }
    } catch (error) {
      if (!request.settled) {
        request.settled = true;
        clearTimeout(request.timeoutId);
        request.reject(error);
      }
    } finally {
      clearTimeout(request.timeoutId);
      const count = this.activeRequests.get(request.userId) || 1;
      if (count <= 1) {
        this.activeRequests.delete(request.userId);
      } else {
        this.activeRequests.set(request.userId, count - 1);
      }

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

function getAuthenticatedUser(req) {
  return req.authUser || req.session?.user || null;
}

function getUserId(req) {
  return getAuthenticatedUser(req)?.claims?.sub || req.ip || 'anonymous';
}

function getUsername(req) {
  const claims = getAuthenticatedUser(req)?.claims;
  return claims?.preferred_username || claims?.name || req.ip || 'anonymous';
}

function calculateTimeout(req) {
  const baseTimeout = config.rateLimit.requestTimeout;

  if (req.originalUrl && req.originalUrl.includes('/api/musicbrainz/release-group')) {
    const limit = parseInt(req.query?.limit) || 50;

    if (req.query?.limit === 'all' || limit > 25) {
      const targetLimit = req.query?.limit === 'all' ? 500 : limit;
      const batches = Math.ceil(targetLimit / 25);
      const estimatedTime = batches * 4000;
      const bufferTime = Math.max(30000, estimatedTime * 1.5);

      console.log(`⏱️ Dynamic timeout: ${targetLimit} limit requires ${batches} batches, setting ${Math.round(bufferTime/1000)}s timeout`);
      return Math.min(bufferTime, 300000);
    }
  }

  if (req.originalUrl && (
    req.originalUrl.includes('/api/lidarr/add') ||
    req.originalUrl.includes('/api/coverart/')
  )) {
    return baseTimeout * 2;
  }

  return baseTimeout;
}

async function queuedApiCall(req, res, apiFunction) {
  const userId = getUserId(req);
  const dynamicTimeout = calculateTimeout(req);

  try {
    const result = await requestQueue.add(userId, () => apiFunction(req), dynamicTimeout);
    res.json(result);
  } catch (error) {
    if (error.message && error.message.includes("Cover art not found")) {
      console.log(`Coverart was not found for`, req.params);
      res.status(404).json({
        error: "Cover art not found",
        params: req.params
      });
    } else if (error.message === 'Request timeout') {
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

const requestQueue = new RequestQueue();

module.exports = {
  requestQueue,
  getAuthenticatedUser,
  getUserId,
  getUsername,
  queuedApiCall
};
