const request = require('supertest');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Mock fetch BEFORE importing anything that uses it
global.fetch = jest.fn();

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

// Mock the auth middleware
jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'test-user' } } };
    next();
  }
}));

const configRoutes = require('../config');

describe('Config API Routes', () => {
  let app;
  const testConfigPath = path.join(__dirname, '../../../data/config.test.json');

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/config', configRoutes);
    
    // Reset fetch mock before each test
    global.fetch.mockReset();
  });

  afterEach(async () => {
    // Clean up test config file
    try {
      await fs.unlink(testConfigPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  describe('GET /api/config/lidarr', () => {
    it('should return Lidarr configuration with masked API key', async () => {
      const response = await request(app)
        .get('/api/config/lidarr');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('apiKey');
      expect(response.body).toHaveProperty('rootFolder');
    });
  });

  describe('POST /api/config/lidarr', () => {
    it('should update Lidarr configuration', async () => {
      const config = {
        url: 'http://lidarr:8686',
        apiKey: 'test-api-key-12345',
        rootFolder: '/music',
        qualityProfileId: 1
      };

      const response = await request(app)
        .post('/api/config/lidarr')
        .send(config);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/config/lidarr')
        .send({ url: 'http://lidarr:8686' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/config/lidarr/test', () => {
    it('should test Lidarr connection', async () => {
      // Mock successful responses for status and quality profile endpoints
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue({ version: '1.0.0' }),
          text: jest.fn().mockResolvedValue(''),
          headers: new Map()
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
          text: jest.fn().mockResolvedValue(''),
          headers: new Map()
        });

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'test-key'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profiles).toHaveLength(1);
      expect(response.body.profiles[0].name).toBe('Standard');
      
      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(1,
        'http://lidarr:8686/api/v1/system/status',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Api-Key': 'test-key'
          }),
          timeout: 10000
        })
      );
    });

    it('should handle connection errors', async () => {
      // Mock a 401 unauthorized response
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({ error: 'Invalid API key' }),
        text: jest.fn().mockResolvedValue('Invalid API key'),
        headers: new Map()
      });

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'bad-key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid API key');
    });
    
    it('should handle network errors', async () => {
      // Mock a network error
      const networkError = new Error('fetch failed');
      networkError.code = 'ENOTFOUND';
      networkError.cause = new Error('getaddrinfo ENOTFOUND lidarr');
      
      global.fetch.mockRejectedValueOnce(networkError);

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'test-key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Host not found');
    });
  });
});
