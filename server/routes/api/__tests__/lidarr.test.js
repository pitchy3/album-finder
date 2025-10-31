// Mock fetch BEFORE any imports
global.fetch = jest.fn();

const request = require('supertest');
const express = require('express');
const lidarrRoutes = require('../lidarr');
const config = require('../../../config');

// Mock the auth middleware
jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'test-user' } } };
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
    set: jest.fn()
  }
}));

describe('Lidarr API Routes', () => {
  let app;
  let fetchCallCount = 0;

  // Suppress console output
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Configure Lidarr settings
    config.lidarr.url = 'http://localhost:8686';
    config.lidarr.apiKey = 'test-api-key';
    config.lidarr.rootFolder = '/music';
    config.lidarr.qualityProfileId = 1;
  });

  afterAll(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  beforeEach(() => {
    fetchCallCount = 0;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { user: { claims: { sub: 'test-user' } } };
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
        
        console.log(`Unhandled URL in mock: ${url}`);
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123', title: 'Test Album', artist: 'Test Artist' });

      console.log('Response status:', response.status);
      console.log('Response body:', JSON.stringify(response.body, null, 2));
      console.log('Total fetch calls:', fetchCallCount);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      const album = response.body[0];
      expect(album.inLibrary).toBe(true);
      expect(album.fullyAvailable).toBe(true);
      expect(album.percentComplete).toBe(100);
    });

    it('should handle album not in library', async () => {
      // Mock lookup response for album not in library (no id field)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          title: 'Test Album',
          foreignAlbumId: 'mbid-123',
          monitored: false,
          artist: {
            artistName: 'Test Artist',
            foreignArtistId: 'artist-mbid'
          }
          // No 'id' field = not in library
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
      expect(response.body[0].inLibrary).toBe(false);
    });

    it('should handle album not found', async () => {
      // Mock empty lookup response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'nonexistent-mbid' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    it('should handle Lidarr connection errors', async () => {
      // Mock connection error
      global.fetch.mockRejectedValueOnce({
        code: 'ECONNREFUSED',
        message: 'Connection refused'
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/lidarr/add', () => {
    it('should add artist and album to Lidarr', async () => {
      // Mock 1: Album lookup
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: {
            artistName: 'Test Artist',
            foreignArtistId: 'artist-mbid',
            id: undefined
          }
        }])
      });

      // Mock 2: Get all artists (artist doesn't exist)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      // Mock 3: Add artist
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 1,
          artistName: 'Test Artist',
          foreignArtistId: 'artist-mbid',
          monitored: true
        })
      });

      // Mock 4: Get artist albums
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 1,
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          monitored: false,
          statistics: { percentOfTracks: 0 }
        }])
      });

      // Mock 5: Update album monitoring
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 1,
          monitored: true
        })
      });

      // Mock 6: Trigger album search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
      expect(response.body.artist).toBe('Test Artist');
    });

    it('should handle existing artist', async () => {
      // Mock 1: Album lookup
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: {
            artistName: 'Existing Artist',
            foreignArtistId: 'existing-artist-mbid'
          }
        }])
      });

      // Mock 2: Get all artists (artist exists)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 5,
          artistName: 'Existing Artist',
          foreignArtistId: 'existing-artist-mbid'
        }])
      });

      // Mock 3: Get artist albums
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 10,
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          monitored: false,
          releaseDate: '2024-01-01'
        }])
      });

      // Mock 4: Update album monitoring
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 10,
          monitored: true
        })
      });

      // Mock 5: Trigger album search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Existing Artist'
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(5);
    });

    it('should handle missing mbid parameter', async () => {
      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          title: 'Test Album',
          artist: 'Test Artist'
          // Missing mbid
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should handle Lidarr configuration not set', async () => {
      // Temporarily clear Lidarr config
      const originalUrl = config.lidarr.url;
      const originalKey = config.lidarr.apiKey;
      config.lidarr.url = '';
      config.lidarr.apiKey = '';

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Lidarr URL/API key not configured');

      // Restore config
      config.lidarr.url = originalUrl;
      config.lidarr.apiKey = originalKey;
    });
  });

  describe('GET /api/lidarr/debug', () => {
    it('should return debug information', async () => {
      // Mock system status call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          version: '1.0.0',
          branch: 'master'
        })
      });

      const response = await request(app)
        .get('/api/lidarr/debug');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBeDefined();
    });
  });
});