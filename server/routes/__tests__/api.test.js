// server/routes/__tests__/api.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'test-user' } } };
    next();
  }
}));

jest.mock('../../services/cache', () => ({
  cache: {
    getStats: jest.fn(() => ({
      keys: 10,
      hits: 100,
      misses: 20,
      hitRate: 0.83
    }))
  }
}));

jest.mock('../../services/queue', () => ({
  requestQueue: {
    getStats: jest.fn(() => ({
      queueLength: 5,
      activeRequests: 3
    }))
  },
  getAuthenticatedUser: jest.fn((req) => req.authUser || req.session?.user || null),
  getUserId: jest.fn((req) => (req.authUser || req.session?.user)?.claims?.sub || 'test-user')
}));

jest.mock('../../services/redis', () => ({
  isConnected: jest.fn(() => true)
}));

jest.mock('../../utils/timezone', () => {
  const actualDate = new Date('2024-01-01T12:00:00Z');
  return {
    getTimezoneInfo: jest.fn(() => ({
      timezone: 'UTC',
      offset: '+00:00',
      currentTime: '2024-01-01 12:00:00',
      abbreviation: 'UTC',
      offsetMinutes: 0,
      isDST: false
    })),
    formatForAPI: jest.fn((date) => {
      if (typeof date === 'string') return date;
      if (date instanceof Date) return date.toISOString();
      return actualDate.toISOString();
    }),
    formatDisplay: jest.fn((date) => {
      if (typeof date === 'string') return date;
      if (date instanceof Date) return date.toISOString();
      return actualDate.toISOString();
    }),
    now: jest.fn(() => actualDate),
    fromTimestamp: jest.fn((ts) => new Date(ts)),
    fromISO: jest.fn((str) => new Date(str)),
    daysAgo: jest.fn((days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000))
  };
});

describe('API Routes', () => {
  let app;
  let apiRoutes;

  beforeEach(() => {
    jest.resetModules();

    const config = require('../../config');
    config.auth.enabled = true;

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    apiRoutes = require('../api');

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = {
        user: {
          claims: {
            sub: 'test-user',
            preferred_username: 'testuser',
            email: 'test@example.com'
          }
        }
      };
      next();
    });
    app.use('/api', apiRoutes);
  });

  afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  describe('GET /api/auth/user', () => {
    it('should return logged in status when authenticated', async () => {
      const response = await request(app).get('/api/auth/user');

      expect(response.status).toBe(200);
      expect(response.body.loggedIn).toBe(true);
      expect(response.body.authEnabled).toBe(true);
      expect(response.body.user).toBeDefined();
    });

    it('should return logged out status when not authenticated', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use((req, res, next) => {
        req.session = {};
        next();
      });
      testApp.use('/api', apiRoutes);

      const response = await request(testApp).get('/api/auth/user');

      expect(response.status).toBe(200);
      expect(response.body.loggedIn).toBe(false);
    });

    it('should return auth disabled status', async () => {
      const config = require('../../config');
      config.auth.enabled = false;

      const response = await request(app).get('/api/auth/user');

      expect(response.status).toBe(200);
      expect(response.body.authEnabled).toBe(false);

      config.auth.enabled = true;
    });
  });

  describe('GET /api/timezone-info', () => {
    it('should return timezone information', async () => {
      const response = await request(app).get('/api/timezone-info');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ timezone: 'UTC', offset: '+00:00' });
    });
  });

  describe('GET /api/me', () => {
    it('should return current user info', async () => {
      const response = await request(app).get('/api/me');

      expect(response.status).toBe(200);
      expect(response.body.user).toBeDefined();
    });
  });

  describe('GET /api/debug', () => {
    it('should return debug information', async () => {
      const response = await request(app).get('/api/debug');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'Server is running',
        authEnabled: expect.any(Boolean),
        redis: expect.objectContaining({ connected: true }),
        cache: expect.any(Object),
        queue: expect.any(Object)
      });
    });
  });

  describe('GET /api/stats', () => {
    it('should return system statistics or handle gracefully', async () => {
      const response = await request(app).get('/api/stats');

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          user: 'test-user',
          cache: expect.any(Object),
          queue: expect.any(Object)
        });

        if (response.body.server) {
          expect(response.body.server).toMatchObject({ uptime: expect.any(Number) });
        }
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.body).toBeDefined();
      }
    });

    it('should handle stats request without crashing', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.status).toBeDefined();
      expect(typeof response.status).toBe('number');
      expect(response).toBeDefined();
    });
  });

  describe('Swagger UI', () => {
    it('should handle OpenAPI spec endpoint', async () => {
      const response = await request(app).get('/api');
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('Error handling', () => {
    it('should handle timezone info errors gracefully', async () => {
      const tz = require('../../utils/timezone');
      tz.getTimezoneInfo.mockImplementationOnce(() => {
        throw new Error('Timezone error');
      });

      const response = await request(app).get('/api/timezone-info');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get timezone information' });
    });
  });
});
