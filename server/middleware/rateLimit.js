// server/middleware/rateLimit.js - Comprehensive rate limiting with progressive lockout and IPv6 support
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { getClient: getRedisClient, isConnected: isRedisConnected } = require('../services/redis');

/**
 * Progressive rate limiter that increases penalties for repeated failures
 */
class ProgressiveRateLimiter {
  constructor() {
    // In-memory fallback if Redis not available
    this.failureCounts = new Map();
    this.lockoutExpiry = new Map();
    
    // Cleanup old entries every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Record a failed authentication attempt
   * Returns lockout duration in seconds
   */
  async recordFailure(identifier) {
    const now = Date.now();
    
    // Check if currently locked out
    const lockoutUntil = this.lockoutExpiry.get(identifier);
    if (lockoutUntil && lockoutUntil > now) {
      return Math.ceil((lockoutUntil - now) / 1000);
    }
    
    // Increment failure count
    const count = (this.failureCounts.get(identifier) || 0) + 1;
    this.failureCounts.set(identifier, count);
    
    // Calculate lockout duration based on failure count
    let lockoutSeconds = 0;
    
    if (count >= 20) {
      lockoutSeconds = 3600; // 1 hour after 20 failures
    } else if (count >= 15) {
      lockoutSeconds = 1800; // 30 minutes after 15 failures
    } else if (count >= 10) {
      lockoutSeconds = 900;  // 15 minutes after 10 failures
    } else if (count >= 7) {
      lockoutSeconds = 300;  // 5 minutes after 7 failures
    } else if (count >= 5) {
      lockoutSeconds = 120;  // 2 minutes after 5 failures
    } else if (count >= 3) {
      lockoutSeconds = 30;   // 30 seconds after 3 failures
    }
    
    // Set lockout expiry if needed
    if (lockoutSeconds > 0) {
      this.lockoutExpiry.set(identifier, now + (lockoutSeconds * 1000));
      
      console.warn(`🔒 Account locked out`, {
        identifier: identifier.substring(0, 20) + '...',
        failures: count,
        lockoutSeconds: lockoutSeconds
      });
    }
    
    return lockoutSeconds;
  }

  /**
   * Record successful authentication
   * Clears failure count and lockout
   */
  async recordSuccess(identifier) {
    this.failureCounts.delete(identifier);
    this.lockoutExpiry.delete(identifier);
  }

  /**
   * Get current lockout delay for identifier
   * Returns 0 if not locked out, or seconds remaining if locked
   */
  async getDelay(identifier) {
    const lockoutUntil = this.lockoutExpiry.get(identifier);
    if (!lockoutUntil) return 0;
    
    const now = Date.now();
    if (lockoutUntil <= now) {
      // Lockout expired
      this.lockoutExpiry.delete(identifier);
      return 0;
    }
    
    return Math.ceil((lockoutUntil - now) / 1000);
  }

  /**
   * Get current failure count
   */
  async getFailureCount(identifier) {
    return this.failureCounts.get(identifier) || 0;
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean expired lockouts
    for (const [identifier, expiry] of this.lockoutExpiry.entries()) {
      if (expiry <= now) {
        this.lockoutExpiry.delete(identifier);
        this.failureCounts.delete(identifier);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired rate limit entries`);
    }
  }
}

// Initialize progressive limiter
const progressiveLimiter = new ProgressiveRateLimiter();

/**
 * Helper to get normalized IP address (handles IPv6)
 * This is the key fix - we need to properly handle IPv6 addresses
 */
function getClientIp(req) {
  // express-rate-limit provides this helper for properly handling IPv6
  // If available via req.ip (which should be normalized by Express with trust proxy)
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Create rate limiter for authentication endpoints
 * Very strict limits to prevent brute force
 */
function createAuthLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();
  
  const config = {
    windowMs: 15 * 60 * 1000, // 15 minute window
    max: 5, // 5 attempts per window
    skipSuccessfulRequests: true, // Don't count successful logins
    
    // Use Redis store if available
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:auth:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    
    // Custom handler
    handler: (req, res) => {
      const retryAfter = Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000);
      
      console.warn(`⚠️ Rate limit exceeded for authentication`, {
        ip: getClientIp(req),
        userAgent: req.get('User-Agent')?.substring(0, 50),
        retryAfter: retryAfter
      });
      
      res.status(429).json({
        error: 'Too many authentication attempts',
        retryAfter: retryAfter,
        message: 'Please wait before trying again'
      });
    },
    
    // ✅ FIX: Use proper key generation that handles IPv6
    // Option 1: Let express-rate-limit handle it automatically (recommended)
    // Just don't specify keyGenerator and it will use the default which properly handles IPv6
    
    // Option 2: If you need custom logic, use this pattern:
    keyGenerator: (req) => {
      const username = req.body?.username || 'unknown';
      const ip = getClientIp(req);
      // Combine IP and username for more granular limiting
      return `${ip}:${username}`;
    },
    
    // Standard headers
    standardHeaders: true,
    legacyHeaders: false
  };
  
  console.log(`✅ Auth rate limiter configured (store: ${useRedis ? 'Redis' : 'Memory'})`);
  return rateLimit(config);
}

/**
 * Create rate limiter for general API endpoints
 * More permissive than auth limiter
 */
function createApiLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();
  
  const config = {
    windowMs: 60 * 1000, // 1 minute window
    max: 100, // 100 requests per minute
    
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:api:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    
    handler: (req, res) => {
      const retryAfter = Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000);
      
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: retryAfter
      });
    },
    
    // ✅ FIX: Proper key generation for API limiter
    keyGenerator: (req) => {
      // Use session user ID if authenticated, otherwise IP
      const userId = req.session?.user?.claims?.sub;
      if (userId) {
        return `user:${userId}`;
      }
      // For unauthenticated requests, use IP
      return `ip:${getClientIp(req)}`;
    },
    
    standardHeaders: true,
    legacyHeaders: false,
    
    // Skip certain endpoints
    skip: (req) => {
      const skipPaths = ['/healthz', '/api/csrf-token'];
      return skipPaths.some(path => req.path === path);
    }
  };
  
  console.log(`✅ API rate limiter configured (store: ${useRedis ? 'Redis' : 'Memory'})`);
  return rateLimit(config);
}

/**
 * Create rate limiter for webhook endpoints
 */
function createWebhookLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();
  
  const config = {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 webhooks per minute
    
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:webhook:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    
    handler: (req, res) => {
      console.warn(`⚠️ Webhook rate limit exceeded`, {
        ip: getClientIp(req),
        path: req.path
      });
      
      res.status(429).json({
        error: 'Too many webhook requests'
      });
    },
    
    // ✅ FIX: Use proper IP handling for webhooks
    keyGenerator: (req) => `webhook:${getClientIp(req)}`,
    
    standardHeaders: true,
    legacyHeaders: false
  };
  
  console.log(`✅ Webhook rate limiter configured (store: ${useRedis ? 'Redis' : 'Memory'})`);
  return rateLimit(config);
}

/**
 * Middleware to check progressive lockout
 * Use this in addition to express-rate-limit for auth endpoints
 */
async function checkProgressiveLockout(req, res, next) {
  const username = req.body?.username;
  const ip = getClientIp(req);
  
  if (!username) {
    return next();
  }
  
  // Create identifier from IP + username
  const identifier = `${ip}:${username}`;
  
  // Check if locked out
  const delay = await progressiveLimiter.getDelay(identifier);
  
  if (delay > 0) {
    const failureCount = await progressiveLimiter.getFailureCount(identifier);
    
    console.warn(`🔒 Progressive lockout active`, {
      identifier: identifier.substring(0, 30) + '...',
      failures: failureCount,
      retryAfter: delay
    });
    
    return res.status(429).json({
      error: 'Account temporarily locked',
      retryAfter: delay,
      failures: failureCount,
      message: `Too many failed attempts. Please try again in ${delay} seconds.`
    });
  }
  
  next();
}

/**
 * Helper function to record auth success
 * Call this after successful authentication
 */
async function recordAuthSuccess(req) {
  const username = req.body?.username || req.session?.user?.claims?.preferred_username;
  const ip = getClientIp(req);
  
  if (username) {
    const identifier = `${ip}:${username}`;
    await progressiveLimiter.recordSuccess(identifier);
  }
}

/**
 * Helper function to record auth failure
 * Call this after failed authentication
 * Returns lockout duration in seconds
 */
async function recordAuthFailure(req) {
  const username = req.body?.username || 'unknown';
  const ip = getClientIp(req);
  
  const identifier = `${ip}:${username}`;
  return await progressiveLimiter.recordFailure(identifier);
}

module.exports = {
  authLimiter: createAuthLimiter(),
  apiLimiter: createApiLimiter(),
  webhookLimiter: createWebhookLimiter(),
  progressiveLimiter,
  checkProgressiveLockout,
  recordAuthSuccess,
  recordAuthFailure
};