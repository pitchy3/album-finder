// server/middleware/__mocks__/rateLimit.js
// Mock rate limiting middleware for tests

module.exports = {
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
  webhookLimiter: (req, res, next) => next(),
  progressiveLimiter: {
    recordFailure: jest.fn().mockResolvedValue(0),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    getDelay: jest.fn().mockResolvedValue(0),
    getFailureCount: jest.fn().mockResolvedValue(0),
    cleanup: jest.fn()
  },
  checkProgressiveLockout: (req, res, next) => next(),
  recordAuthSuccess: jest.fn().mockResolvedValue(undefined),
  recordAuthFailure: jest.fn().mockResolvedValue(0)
};