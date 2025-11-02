// server/routes/__tests__/admin.test.js
const request = require('supertest');
const express = require('express');
const adminRoutes = require('../admin');

jest.mock('../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'admin-user' } } };
    next();
  }
}));

jest.mock('../../services/cache', () => ({
  cache: {
    getStats: jest.fn(() => ({
      keys: 10,
      hits: 100,
      misses: 20,
      hitRate: 0.83,
      memoryUsageMB: 5
    })),
    flushAll: jest.fn()
  }
}));

jest.mock('../../services/queue', () => ({
  requestQueue: {
    getStats: jest.fn(() => ({
      queueLength: 5,
      activeRequests: 3,
      maxConcurrent: 10
    }))
  }
}));

describe('Admin Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/admin', adminRoutes);
  });

  describe('GET /admin/cache/stats', () => {
    it('should return cache statistics', async () => {
      const response = await request(app).get('/admin/cache/stats');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        keys: 10,
        hits: 100,
        misses: 20,
        hitRate: 0.83
      });
    });
  });

  describe('DELETE /admin/cache/flush', () => {
    it('should flush cache', async () => {
      const { cache } = require('../../services/cache');
      const response = await request(app).delete('/admin/cache/flush');
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('flushed');
      expect(cache.flushAll).toHaveBeenCalled();
    });
  });

  describe('GET /admin/queue/stats', () => {
    it('should return queue statistics', async () => {
      const response = await request(app).get('/admin/queue/stats');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        queueLength: 5,
        activeRequests: 3,
        maxConcurrent: 10
      });
    });
  });
});