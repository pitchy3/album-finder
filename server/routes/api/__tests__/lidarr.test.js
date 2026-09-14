// Mock fetch BEFORE any imports
global.fetch = jest.fn();

const request = require('supertest');
const express = require('express');
const lidarrRoutes = require('../lidarr');
const config = require('../../../config');

// Mock the auth middleware
jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'test-user', preferred_username: 'testuser', email: 'test@example.com' } } };
    next();
  }
}));

// Mock the database to avoid initialization issues
jest.mock('../../../services/database', () => ({
  database: {
    logAlbumAddition: jest.fn().mockResolvedValue(undefined),
    logArtistAddition: jest.fn().mockResolvedValue(undefined),
  }
}));

// Mock the queue service
jest.mock('../../../services/queue', () => ({
  getAuthenticatedUser: jest.fn((req) => req.authUser || req.session?.user || null),
  getUserId: jest.fn(() => 'test-user'),
  getUsername: jest.fn(() => 'test-user'),
  queuedApiCall: jest.fn((req, res, apiFunction) => {
    return apiFunction(req).then(result => res.json(result)).catch(error => {
      res.status(500).json({ error: error.message });
    });
  })
}));

// Mock the cache service
jest.mock('../../../services/cache', () => ({
  cachedFetch: jest.fn((key, params, fetchFn) => fetchFn()),
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    getStats: jest.fn(() => ({
      keys: 10,
      hits: 50,
      misses: 20,
      hitRate: 0.71,
      memoryUsageMB: 5,
      maxMemoryMB: 100,
      maxKeys: 1000
    })),
    clearByPrefix: jest.fn(() => 5)
  }
}));

// Mock the config encryption service
jest.mock('../../../services/configEncryption', () => ({
  getDecryptedLidarrApiKey: jest.fn(() => 'test-api-key')
}));

describe('Lidarr API Routes', () => {
  let app;
  let fetchCallCount = 0;

  beforeAll(() => {
    // Configure Lidarr settings
    config.lidarr.url = 'http://localhost:8686';
    config.lidarr.apiKey = 'test-api-key';
    config.lidarr.rootFolder = '/music';
    config.lidarr.qualityProfileId = 1;
  });

  beforeEach(() => {
    fetchCallCount = 0;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { user: { claims: { sub: 'test-user', preferred_username: 'testuser', email: 'test@example.com' } } };
      req.ip = '127.0.0.1';
      req.get = jest.fn(() => 'Mozilla/5.0');
      next();
    });
    app.use('/api/lidarr', lidarrRoutes);
    
    // Reset fetch mock
    global.fetch.mockReset();
  });

  describe('GET /api/lidarr/lookup', () => {
    it('should lookup album in Lidarr', async () => {
      // Create a flexible mock that logs what's being called
      global.fetch.mockImplementation((url, options) => {
        fetchCallCount++;
        console.log(`Mock fetch call #${fetchCallCount}:`, url);
        
        // Mock lookup call
        if (url.includes('album/lookup') || url.includes('album%2Flookup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              id: 1, // Has ID = in library
              title: 'Test Album',
              foreignAlbumId: 'mbid-123',
              monitored: true,
              artistId: 1,
              artist: {
                artistName: 'Test Artist',
                foreignArtistId: 'artist-mbid-123'
              },
              grabbed: false,
              statistics: { 
                percentOfTracks: 100,
                trackCount: 10,
                trackFileCount: 10
              }
            }])
          });
        }
        
        // Mock get album by ID
        if (url.includes('/album/1') && !url.includes('lookup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              id: 1,
              title: 'Test Album',
              foreignAlbumId: 'mbid-123',
              monitored: true,
              artistId: 1,
              artist: {
                artistName: 'Test Artist',
                foreignArtistId: 'artist-mbid-123'
              },
              grabbed: false,
              statistics: { 
                percentOfTracks: 100,
                trackCount: 10,
                trackFileCount: 10
              }
            })
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue([])
        });
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });
  });
});
