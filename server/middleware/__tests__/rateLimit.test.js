// server/middleware/__tests__/rateLimit.test.js
const {
  authLimiter,
  apiLimiter,
  webhookLimiter,
  progressiveLimiter,
  checkProgressiveLockout,
  recordAuthSuccess,
  recordAuthFailure
} = require('../rateLimit');
const express = require('express');
const request = require('supertest');

// Mock Redis
jest.mock('../../services/redis', () => ({
  getClient: jest.fn(() => null),
  isConnected: jest.fn(() => false)
}));

describe('Rate Limiting Middleware', () => {
  let app;

  describe('ProgressiveRateLimiter', () => {
    beforeEach(() => {
      // Clear the limiter's internal state
      progressiveLimiter.failureCounts.clear();
      progressiveLimiter.lockoutExpiry.clear();
    });

    describe('recordFailure', () => {
      it('should record first failure without lockout', async () => {
        const lockoutSeconds = await progressiveLimiter.recordFailure('test-user-1');
        
        expect(lockoutSeconds).toBe(0);
        expect(progressiveLimiter.failureCounts.get('test-user-1')).toBe(1);
      });

      it('should record second failure without lockout', async () => {
        const identifier = 'test-user-2';
        await progressiveLimiter.recordFailure(identifier);
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(0);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(2);
      });

      it('should lock out after 3 failures', async () => {
        const identifier = 'test-user-3';
        await progressiveLimiter.recordFailure(identifier);
        await progressiveLimiter.recordFailure(identifier);
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(30);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(3);
      });

      it('should increase lockout after 5 failures', async () => {
        const identifier = 'test-user-5';
        
        // Directly set failure count to 4 to simulate previous failures
        progressiveLimiter.failureCounts.set(identifier, 4);
        // Ensure no existing lockout
        progressiveLimiter.lockoutExpiry.delete(identifier);
        
        // 5th failure should trigger 120 second lockout
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(120);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(5);
      });

      it('should increase lockout after 7 failures', async () => {
        const identifier = 'test-user-7';
        
        // Set count to 6
        progressiveLimiter.failureCounts.set(identifier, 6);
        progressiveLimiter.lockoutExpiry.delete(identifier);
        
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(300);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(7);
      });

      it('should increase lockout after 10 failures', async () => {
        const identifier = 'test-user-10';
        
        progressiveLimiter.failureCounts.set(identifier, 9);
        progressiveLimiter.lockoutExpiry.delete(identifier);
        
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(900);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(10);
      });

      it('should increase lockout after 15 failures', async () => {
        const identifier = 'test-user-15';
        
        progressiveLimiter.failureCounts.set(identifier, 14);
        progressiveLimiter.lockoutExpiry.delete(identifier);
        
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(1800);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(15);
      });

      it('should increase lockout after 20 failures', async () => {
        const identifier = 'test-user-20';
        
        progressiveLimiter.failureCounts.set(identifier, 19);
        progressiveLimiter.lockoutExpiry.delete(identifier);
        
        const lockoutSeconds = await progressiveLimiter.recordFailure(identifier);
        
        expect(lockoutSeconds).toBe(3600);
        expect(progressiveLimiter.failureCounts.get(identifier)).toBe(20);
      });

      it('should return remaining lockout time if already locked', async () => {
        // Lock out the user
        for (let i = 0; i < 3; i++) {
          await progressiveLimiter.recordFailure('test-user');
        }
        
        // Try again immediately
        const lockoutSeconds = await progressiveLimiter.recordFailure('test-user');
        
        expect(lockoutSeconds).toBeGreaterThan(0);
        expect(lockoutSeconds).toBeLessThanOrEqual(30);
      });

      it('should handle multiple users independently', async () => {
        await progressiveLimiter.recordFailure('user1');
        await progressiveLimiter.recordFailure('user1');
        await progressiveLimiter.recordFailure('user2');
        
        expect(progressiveLimiter.failureCounts.get('user1')).toBe(2);
        expect(progressiveLimiter.failureCounts.get('user2')).toBe(1);
      });
    });

    describe('recordSuccess', () => {
      it('should clear failure count on success', async () => {
        await progressiveLimiter.recordFailure('test-user');
        await progressiveLimiter.recordFailure('test-user');
        
        await progressiveLimiter.recordSuccess('test-user');
        
        expect(progressiveLimiter.failureCounts.get('test-user')).toBeUndefined();
      });

      it('should clear lockout on success', async () => {
        // Create lockout
        for (let i = 0; i < 3; i++) {
          await progressiveLimiter.recordFailure('test-user');
        }
        
        await progressiveLimiter.recordSuccess('test-user');
        
        expect(progressiveLimiter.lockoutExpiry.get('test-user')).toBeUndefined();
      });
    });

    describe('getDelay', () => {
      it('should return 0 when not locked out', async () => {
        const delay = await progressiveLimiter.getDelay('test-user');
        
        expect(delay).toBe(0);
      });

      it('should return remaining seconds when locked out', async () => {
        // Create lockout
        for (let i = 0; i < 3; i++) {
          await progressiveLimiter.recordFailure('test-user');
        }
        
        const delay = await progressiveLimiter.getDelay('test-user');
        
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(30);
      });

      it('should return 0 after lockout expires', async () => {
        // Manually set an expired lockout
        progressiveLimiter.lockoutExpiry.set('test-user', Date.now() - 1000);
        
        const delay = await progressiveLimiter.getDelay('test-user');
        
        expect(delay).toBe(0);
        expect(progressiveLimiter.lockoutExpiry.get('test-user')).toBeUndefined();
      });
    });

    describe('getFailureCount', () => {
      it('should return 0 for new user', async () => {
        const count = await progressiveLimiter.getFailureCount('new-user');
        
        expect(count).toBe(0);
      });

      it('should return correct failure count', async () => {
        await progressiveLimiter.recordFailure('test-user');
        await progressiveLimiter.recordFailure('test-user');
        
        const count = await progressiveLimiter.getFailureCount('test-user');
        
        expect(count).toBe(2);
      });
    });

    describe('cleanup', () => {
      it('should remove expired lockouts', async () => {
        // Set expired lockout
        progressiveLimiter.lockoutExpiry.set('expired-user', Date.now() - 1000);
        progressiveLimiter.failureCounts.set('expired-user', 5);
        
        // Set active lockout
        progressiveLimiter.lockoutExpiry.set('active-user', Date.now() + 10000);
        progressiveLimiter.failureCounts.set('active-user', 3);
        
        progressiveLimiter.cleanup();
        
        expect(progressiveLimiter.lockoutExpiry.get('expired-user')).toBeUndefined();
        expect(progressiveLimiter.failureCounts.get('expired-user')).toBeUndefined();
        expect(progressiveLimiter.lockoutExpiry.get('active-user')).toBeDefined();
        expect(progressiveLimiter.failureCounts.get('active-user')).toBe(3);
      });
    });
  });

  describe('authLimiter', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should allow requests within limit', async () => {
      app.use(authLimiter);
      app.post('/auth/login', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/auth/login')
        .send({ username: 'test', password: 'test' });

      expect(response.status).toBe(200);
    });

    it('should rate limit after exceeding limit', async () => {
      app.use(authLimiter);
      app.post('/auth/login', (req, res) => {
        // Return 401 so skipSuccessfulRequests doesn't skip counting
        res.status(401).json({ error: 'Invalid credentials' });
      });

      const agent = request.agent(app);
      const testUser = 'test-rate-limit-user';
      
      // Make exactly 5 requests (the limit) - all counted as failures
      for (let i = 0; i < 5; i++) {
        const res = await agent
          .post('/auth/login')
          .send({ username: testUser, password: 'wrong' });
        expect(res.status).toBe(401);
      }

      // 6th request should be rate limited
      const response = await agent
        .post('/auth/login')
        .send({ username: testUser, password: 'wrong' });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many authentication attempts');
    });

    it('should include retry-after in rate limit response', async () => {
      app.use(authLimiter);
      app.post('/auth/login', (req, res) => {
        // Return 401 so requests are counted
        res.status(401).json({ error: 'Invalid credentials' });
      });

      const agent = request.agent(app);
      const testUser = 'test-retry-after-user';
      
      // Exceed limit (6 requests total)
      for (let i = 0; i < 6; i++) {
        await agent
          .post('/auth/login')
          .send({ username: testUser, password: 'wrong' });
      }

      const response = await agent
        .post('/auth/login')
        .send({ username: testUser, password: 'wrong' });

      expect(response.status).toBe(429);
      expect(response.body.retryAfter).toBeDefined();
      expect(typeof response.body.retryAfter).toBe('number');
    });
  });

  describe('apiLimiter', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should allow API requests within limit', async () => {
      app.use('/api', apiLimiter);
      app.get('/api/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/api/test');

      expect(response.status).toBe(200);
    });

    it('should skip rate limiting for health check', async () => {
      app.use('/api', apiLimiter);
      app.get('/api/healthz', (req, res) => {
        res.json({ success: true });
      });

      // Make many requests
      for (let i = 0; i < 150; i++) {
        const response = await request(app)
          .get('/api/healthz');
        
        expect(response.status).toBe(200);
      }
    });

    it('should skip rate limiting for CSRF token endpoint', async () => {
      app.use('/api', apiLimiter);
      app.get('/api/csrf-token', (req, res) => {
        res.json({ token: 'test' });
      });

      // Make many requests - should all succeed due to skip
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .get('/api/csrf-token');
        
        expect(response.status).toBe(200);
      }
    });

    it('should rate limit authenticated users by user ID', async () => {
      app.use((req, res, next) => {
        req.session = {
          user: {
            claims: {
              sub: 'user-123'
            }
          }
        };
        next();
      });
      
      app.use('/api', apiLimiter);
      app.get('/api/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/api/test');

      expect(response.status).toBe(200);
    });
  });

  describe('webhookLimiter', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should allow webhook requests within limit', async () => {
      app.use('/webhook', webhookLimiter);
      app.post('/webhook/lidarr', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/webhook/lidarr')
        .send({ event: 'test' });

      expect(response.status).toBe(200);
    });

    it('should rate limit webhooks after exceeding limit', async () => {
      app.use('/webhook', webhookLimiter);
      app.post('/webhook/lidarr', (req, res) => {
        res.json({ success: true });
      });

      // Make requests up to limit (60 per minute)
      for (let i = 0; i < 61; i++) {
        await request(app)
          .post('/webhook/lidarr')
          .send({ event: 'test' });
      }

      const response = await request(app)
        .post('/webhook/lidarr')
        .send({ event: 'test' });

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many webhook requests');
    });
  });

  describe('checkProgressiveLockout', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      progressiveLimiter.failureCounts.clear();
      progressiveLimiter.lockoutExpiry.clear();
    });

    it('should allow request when not locked out', async () => {
      app.use(checkProgressiveLockout);
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .send({ username: 'test' });

      expect(response.status).toBe(200);
    });

    it('should block request when locked out', async () => {
      // Create lockout
      const identifier = '::ffff:127.0.0.1:test';
      for (let i = 0; i < 3; i++) {
        await progressiveLimiter.recordFailure(identifier);
      }

      app.use(checkProgressiveLockout);
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .send({ username: 'test' });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Account temporarily locked');
      expect(response.body.retryAfter).toBeDefined();
      expect(response.body.failures).toBeDefined();
    });

    it('should skip check when no username provided', async () => {
      app.use(checkProgressiveLockout);
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('recordAuthSuccess', () => {
    beforeEach(() => {
      progressiveLimiter.failureCounts.clear();
      progressiveLimiter.lockoutExpiry.clear();
    });

    it('should clear failures on successful auth', async () => {
      const identifier = '::ffff:127.0.0.1:test';
      await progressiveLimiter.recordFailure(identifier);
      await progressiveLimiter.recordFailure(identifier);

      const req = {
        body: { username: 'test' },
        ip: '::ffff:127.0.0.1'
      };

      await recordAuthSuccess(req);

      expect(progressiveLimiter.failureCounts.get(identifier)).toBeUndefined();
    });

    it('should handle missing username', async () => {
      const req = {
        body: {},
        ip: '::ffff:127.0.0.1'
      };

      await expect(recordAuthSuccess(req)).resolves.not.toThrow();
    });

    it('should use session username if body username missing', async () => {
      const identifier = '::ffff:127.0.0.1:sessionuser';
      await progressiveLimiter.recordFailure(identifier);

      const req = {
        body: {},
        session: {
          user: {
            claims: {
              preferred_username: 'sessionuser'
            }
          }
        },
        ip: '::ffff:127.0.0.1'
      };

      await recordAuthSuccess(req);

      expect(progressiveLimiter.failureCounts.get(identifier)).toBeUndefined();
    });
  });

  describe('recordAuthFailure', () => {
    beforeEach(() => {
      progressiveLimiter.failureCounts.clear();
      progressiveLimiter.lockoutExpiry.clear();
    });

    it('should record failure and return lockout duration', async () => {
      const req = {
        body: { username: 'test' },
        ip: '::ffff:127.0.0.1'
      };

      const lockoutSeconds = await recordAuthFailure(req);

      expect(lockoutSeconds).toBe(0); // First failure, no lockout
      
      const identifier = '::ffff:127.0.0.1:test';
      expect(progressiveLimiter.failureCounts.get(identifier)).toBe(1);
    });

    it('should return lockout duration after threshold', async () => {
      const req = {
        body: { username: 'test' },
        ip: '::ffff:127.0.0.1'
      };

      // Record 3 failures to trigger lockout
      await recordAuthFailure(req);
      await recordAuthFailure(req);
      const lockoutSeconds = await recordAuthFailure(req);

      expect(lockoutSeconds).toBe(30);
    });

    it('should use "unknown" for missing username', async () => {
      const req = {
        body: {},
        ip: '::ffff:127.0.0.1'
      };

      await recordAuthFailure(req);

      const identifier = '::ffff:127.0.0.1:unknown';
      expect(progressiveLimiter.failureCounts.get(identifier)).toBe(1);
    });
  });

  describe('IPv6 Support', () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should handle IPv6 addresses correctly', async () => {
      app.use(checkProgressiveLockout);
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .set('X-Forwarded-For', '2001:0db8:85a3:0000:0000:8a2e:0370:7334')
        .send({ username: 'test' });

      expect(response.status).toBe(200);
    });

    it('should handle IPv4-mapped IPv6 addresses', async () => {
      app.use(checkProgressiveLockout);
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/test')
        .send({ username: 'test' });

      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limiter Configuration', () => {
    it('should create auth limiter with correct config', () => {
      expect(authLimiter).toBeDefined();
      expect(typeof authLimiter).toBe('function');
    });

    it('should create API limiter with correct config', () => {
      expect(apiLimiter).toBeDefined();
      expect(typeof apiLimiter).toBe('function');
    });

    it('should create webhook limiter with correct config', () => {
      expect(webhookLimiter).toBeDefined();
      expect(typeof webhookLimiter).toBe('function');
    });
  });
});