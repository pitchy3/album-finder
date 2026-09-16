// server/middleware/rateLimit.js - Comprehensive rate limiting with progressive lockout and IPv6 support
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { getClient: getRedisClient, isConnected: isRedisConnected } = require('../services/redis');
const { getAuthenticatedUser } = require('../services/queue');

class ProgressiveRateLimiter {
  constructor() {
    this.failureCounts = new Map();
    this.lockoutExpiry = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    // Housekeeping must not keep short-lived processes such as tests and
    // maintenance commands alive after their actual work is complete.
    this.cleanupTimer.unref?.();
  }

  async recordFailure(identifier) {
    const now = Date.now();
    const lockoutUntil = this.lockoutExpiry.get(identifier);
    if (lockoutUntil && lockoutUntil > now) {
      return Math.ceil((lockoutUntil - now) / 1000);
    }

    const count = (this.failureCounts.get(identifier) || 0) + 1;
    this.failureCounts.set(identifier, count);

    let lockoutSeconds = 0;
    if (count >= 20) lockoutSeconds = 3600;
    else if (count >= 15) lockoutSeconds = 1800;
    else if (count >= 10) lockoutSeconds = 900;
    else if (count >= 7) lockoutSeconds = 300;
    else if (count >= 5) lockoutSeconds = 120;
    else if (count >= 3) lockoutSeconds = 30;

    if (lockoutSeconds > 0) {
      this.lockoutExpiry.set(identifier, now + (lockoutSeconds * 1000));
      console.warn(`🔒 Account locked out`, {
        identifier: identifier.substring(0, 20) + '...',
        failures: count,
        lockoutSeconds
      });
    }

    return lockoutSeconds;
  }

  async recordSuccess(identifier) {
    this.failureCounts.delete(identifier);
    this.lockoutExpiry.delete(identifier);
  }

  async getDelay(identifier) {
    const lockoutUntil = this.lockoutExpiry.get(identifier);
    if (!lockoutUntil) return 0;

    const now = Date.now();
    if (lockoutUntil <= now) {
      this.lockoutExpiry.delete(identifier);
      return 0;
    }

    return Math.ceil((lockoutUntil - now) / 1000);
  }

  async getFailureCount(identifier) {
    return this.failureCounts.get(identifier) || 0;
  }

  cleanup() {
    const now = Date.now();
    for (const [identifier, expiry] of this.lockoutExpiry.entries()) {
      if (expiry <= now) {
        this.lockoutExpiry.delete(identifier);
        this.failureCounts.delete(identifier);
      }
    }
  }
}

const progressiveLimiter = new ProgressiveRateLimiter();

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function createAuthLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: true,
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:auth:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    handler: (req, res) => {
      const retryAfter = Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000);
      res.status(429).json({
        error: 'Too many authentication attempts',
        retryAfter,
        message: 'Please wait before trying again'
      });
    },
    keyGenerator: (req) => `${getClientIp(req)}:${req.body?.username || 'unknown'}`,
    standardHeaders: true,
    legacyHeaders: false
  });
}

function createApiLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();

  return rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:api:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    handler: (req, res) => {
      const retryAfter = Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000);
      res.status(429).json({ error: 'Too many requests', retryAfter });
    },
    keyGenerator: (req) => {
      const userId = getAuthenticatedUser(req)?.claims?.sub;
      return userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => ['/healthz', '/api/csrf-token'].some(path => req.path === path)
  });
}

function createWebhookLimiter() {
  const redisClient = getRedisClient();
  const useRedis = redisClient && isRedisConnected();

  return rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    ...(useRedis && {
      store: new RedisStore({
        client: redisClient,
        prefix: 'rate_limit:webhook:',
        sendCommand: (...args) => redisClient.sendCommand(args)
      })
    }),
    handler: (_req, res) => res.status(429).json({ error: 'Too many webhook requests' }),
    keyGenerator: (req) => `webhook:${getClientIp(req)}`,
    standardHeaders: true,
    legacyHeaders: false
  });
}

async function checkProgressiveLockout(req, res, next) {
  const username = req.body?.username;
  const ip = getClientIp(req);
  if (!username) return next();

  const identifier = `${ip}:${username}`;
  const delay = await progressiveLimiter.getDelay(identifier);

  if (delay > 0) {
    const failureCount = await progressiveLimiter.getFailureCount(identifier);
    return res.status(429).json({
      error: 'Account temporarily locked',
      retryAfter: delay,
      failures: failureCount,
      message: `Too many failed attempts. Please try again in ${delay} seconds.`
    });
  }

  next();
}

async function recordAuthSuccess(req) {
  const username = req.body?.username || getAuthenticatedUser(req)?.claims?.preferred_username;
  const ip = getClientIp(req);
  if (username) await progressiveLimiter.recordSuccess(`${ip}:${username}`);
}

async function recordAuthFailure(req) {
  const username = req.body?.username || 'unknown';
  return progressiveLimiter.recordFailure(`${getClientIp(req)}:${username}`);
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
