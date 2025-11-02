// server/routes/api/__tests__/coverart.test.js
global.fetch = jest.fn();

const request = require('supertest');
const express = require('express');
const coverartRoutes = require('../../api/coverart');

jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => next()
}));

jest.mock('../../../services/queue', () => ({
  queuedApiCall: jest.fn((req, res, apiFunction) => {
    return apiFunction(req).then(result => res.json(result)).catch(error => {
      res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
    });
  })
}));

jest.mock('../../../services/cache', () => ({
  cachedFetch: jest.fn((key, params, fetchFn) => fetchFn())
}));

describe('Cover Art Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/coverart', coverartRoutes);
    global.fetch.mockReset();
  });

  describe('GET /api/coverart/:mbid', () => {
    it('should fetch cover art successfully', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          images: [
            {
              types: ['Front'],
              image: 'https://example.com/cover.jpg',
              thumbnails: { small: 'https://example.com/thumb.jpg' }
            }
          ]
        })
      });

      const response = await request(app).get('/api/coverart/test-mbid');
      
      expect(response.status).toBe(200);
      expect(response.body.images).toBeDefined();
      expect(response.body.images).toHaveLength(1);
    });

    it('should handle cover art not found', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const response = await request(app).get('/api/coverart/nonexistent');
      
      expect(response.status).toBe(200);
      expect(response.body.images).toEqual([]);
    });

    it('should handle API errors', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      });

      const response = await request(app).get('/api/coverart/test-mbid');
      
      expect(response.status).toBe(500);
    });
  });
});