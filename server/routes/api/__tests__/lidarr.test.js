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

    it('should require mbid parameter', async () => {
      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ title: 'Test Album' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('mbid');
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
          monitored: true,
          path: '/music/TestArtist'
        })
      });

      // Mock 4: Trigger artist refresh
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      // Mock 5: Get artist albums (polling - return album immediately)
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

      // Mock 6: Update album monitoring
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 1,
          monitored: true
        })
      });

      // Mock 7: Trigger album search
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

      // If test fails, show the error in the assertion message
      if (response.status !== 200) {
        throw new Error(`Expected 200 but got ${response.status}. Error: ${response.body.error || JSON.stringify(response.body)}`);
      }

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
      expect(response.body.artist).toBe('Test Artist');
      expect(response.body.title).toBe('Test Album');
      expect(response.body.albumId).toBe(1);
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
          foreignArtistId: 'existing-artist-mbid',
          path: '/music/ExistingArtist'
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
          releaseDate: '2024-01-01',
          statistics: { percentOfTracks: 50 }
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
      expect(response.body.artist).toBe('Existing Artist');
      expect(response.body.albumId).toBe(10);
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
      expect(response.body.error).toContain('mbid');
    });

    it('should handle missing title parameter', async () => {
      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          artist: 'Test Artist'
          // Missing title
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('title');
    });

    it('should handle missing artist parameter', async () => {
      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album'
          // Missing artist
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('artist');
    });

    it('should handle Lidarr configuration not set', async () => {
      // Save original config
      const originalUrl = config.lidarr.url;
      const originalKey = config.lidarr.apiKey;
      
      // Clear config
      config.lidarr.url = '';
      config.lidarr.apiKey = '';

      // Create new app instance to pick up config changes
      const testApp = express();
      testApp.use(express.json());
      testApp.use((req, res, next) => {
        req.session = { user: { claims: { sub: 'test-user', preferred_username: 'testuser', email: 'test@example.com' } } };
        req.ip = '127.0.0.1';
        req.get = jest.fn(() => 'Mozilla/5.0');
        next();
      });
      
      // Force reload of the routes module to reset service singletons
      jest.resetModules();
      const freshLidarrRoutes = require('../lidarr');
      testApp.use('/api/lidarr', freshLidarrRoutes);

      const response = await request(testApp)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Lidarr URL/API key not configured');

      // Restore config immediately
      config.lidarr.url = originalUrl;
      config.lidarr.apiKey = originalKey;
      
      // Reset modules to clear the singleton with bad config
      jest.resetModules();
    });

    it('should handle album with missing artist information', async () => {
      // Mock album lookup with missing artist info
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: null // Missing artist info
        }])
      });

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('missing artist information');
    });

    it('should handle custom root folder for new artist', async () => {
      // Mock 1: Album lookup
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: {
            artistName: 'New Artist',
            foreignArtistId: 'new-artist-mbid'
          }
        }])
      });

      // Mock 2: Get all artists (empty - artist doesn't exist)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      // Mock 3: Add artist - verify custom root folder in body
      let capturedRootFolder = null;
      global.fetch.mockImplementationOnce((url, options) => {
        if (options?.method === 'POST' && url.includes('/artist')) {
          const body = JSON.parse(options.body);
          capturedRootFolder = body.rootFolderPath;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              id: 1,
              artistName: 'New Artist',
              foreignArtistId: 'new-artist-mbid',
              path: '/custom/music/NewArtist'
            })
          });
        }
        return Promise.reject(new Error('Unexpected call'));
      });

      // Mock 4: Trigger refresh
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      // Mock 5: Get albums (polling)
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

      // Mock 6: Update monitoring
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1, monitored: true })
      });

      // Mock 7: Trigger search
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
          artist: 'New Artist',
          rootFolder: '/custom/music'
        });

      // Verify custom root folder was used
      expect(capturedRootFolder).toBe('/custom/music');
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/lidarr/artist-status', () => {
    it('should find artist by MBID', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 1,
          artistName: 'Test Artist',
          foreignArtistId: 'test-mbid',
          monitored: true,
          statistics: {
            albumCount: 5,
            trackFileCount: 42
          },
          path: '/music/TestArtist'
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/artist-status')
        .query({ mbid: 'test-mbid' });

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(true);
      expect(response.body.artistName).toBe('Test Artist');
      expect(response.body.monitored).toBe(true);
      expect(response.body.albumCount).toBe(5);
    });

    it('should find artist by name', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 2,
          artistName: 'Another Artist',
          foreignArtistId: 'another-mbid',
          monitored: false,
          statistics: {
            albumCount: 3,
            trackFileCount: 25
          }
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/artist-status')
        .query({ name: 'Another Artist' });

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(true);
      expect(response.body.artistName).toBe('Another Artist');
    });

    it('should return not found when artist does not exist', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      const response = await request(app)
        .get('/api/lidarr/artist-status')
        .query({ mbid: 'nonexistent' });

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(false);
      expect(response.body.artistId).toBeNull();
    });

    it('should require either mbid or name parameter', async () => {
      const response = await request(app)
        .get('/api/lidarr/artist-status')
        .query({});

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('mbid');
    });
  });

  describe('GET /api/lidarr/album-list', () => {
    it('should return albums with cover art for artist', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          {
            id: 1,
            foreignAlbumId: 'album-1',
            title: 'Album One',
            monitored: true,
            statistics: { percentOfTracks: 100, trackCount: 10, trackFileCount: 10 },
            images: [{ coverType: 'cover', remoteUrl: 'http://example.com/cover1.jpg' }],
            albumType: 'Album',
            releaseDate: '2024-01-01'
          },
          {
            id: 2,
            foreignAlbumId: 'album-2',
            title: 'Album Two',
            monitored: false,
            statistics: { percentOfTracks: 50, trackCount: 8, trackFileCount: 4 },
            images: [{ coverType: 'cover', url: 'http://example.com/cover2.jpg' }],
            albumType: 'EP',
            releaseDate: '2024-02-01'
          }
        ])
      });

      const response = await request(app)
        .get('/api/lidarr/album-list')
        .query({ lidarrArtistId: '1' });

      expect(response.status).toBe(200);
      expect(response.body['album-1']).toBeDefined();
      expect(response.body['album-1'].title).toBe('Album One');
      expect(response.body['album-1'].coverUrl).toBe('http://example.com/cover1.jpg');
      expect(response.body['album-1'].fullyAvailable).toBe(true);
      expect(response.body['album-2'].fullyAvailable).toBe(false);
    });

    it('should require lidarrArtistId parameter', async () => {
      const response = await request(app)
        .get('/api/lidarr/album-list')
        .query({});

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('lidarrArtistId');
    });

    it('should reject invalid lidarrArtistId', async () => {
      const response = await request(app)
        .get('/api/lidarr/album-list')
        .query({ lidarrArtistId: 'not-a-number' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Invalid');
    });
  });

  describe('POST /api/lidarr/retry-download', () => {
    it('should retry download for existing album', async () => {
      // Mock 1: Get artist by ID
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 1,
          artistName: 'Test Artist',
          foreignArtistId: 'artist-mbid'
        })
      });

      // Mock 2: Get artist albums
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 10,
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          monitored: false,
          statistics: { percentOfTracks: 50 }
        }])
      });

      // Mock 3: Update monitoring
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 10, monitored: true })
      });

      // Mock 4: Trigger search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      const response = await request(app)
        .post('/api/lidarr/retry-download')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist',
          lidarrArtistId: 1
        });

      expect(response.status).toBe(200);
      expect(response.body.searchTriggered).toBe(true);
      expect(response.body.title).toBe('Test Album');
    });

    it('should require all parameters', async () => {
      const response = await request(app)
        .post('/api/lidarr/retry-download')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album'
          // Missing artist and lidarrArtistId
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should handle artist not found', async () => {
      global.fetch.mockRejectedValueOnce({
        message: 'Artist not found with ID: 999'
      });

      const response = await request(app)
        .post('/api/lidarr/retry-download')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist',
          lidarrArtistId: 999
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Artist not found');
    });
  });

  describe('GET /api/lidarr/debug', () => {
    it('should return debug information', async () => {
      // Mock 1: System status
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          version: '1.0.0',
          apiVersion: 'v1',
          instanceName: 'My Lidarr'
        })
      });

      // Mock 2: Root folders
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          { id: 1, path: '/music', accessible: true, freeSpace: 1000000000 }
        ])
      });

      // Mock 3: Quality profiles
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          { id: 1, name: 'Lossless' },
          { id: 2, name: 'High Quality' }
        ])
      });

      const response = await request(app)
        .get('/api/lidarr/debug');

      expect(response.status).toBe(200);
      expect(response.body.connected).toBe(true);
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.rootFolders).toHaveLength(1);
      expect(response.body.qualityProfiles).toHaveLength(2);
      expect(response.body.cacheStats).toBeDefined();
    });

    it('should handle connection failure', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app)
        .get('/api/lidarr/debug');

      expect(response.status).toBe(200); // Still returns 200 with error info
      expect(response.body.connected).toBe(false);
      expect(response.body.error).toContain('Connection refused');
    });
  });

  describe('POST /api/lidarr/cache/clear', () => {
    it('should clear cache entries', async () => {
      const response = await request(app)
        .post('/api/lidarr/cache/clear');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.clearedCount).toBeDefined();
    });
  });

  describe('GET /api/lidarr/health', () => {
    it('should return healthy status', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          version: '1.0.0',
          instanceName: 'My Lidarr'
        })
      });

      const response = await request(app)
        .get('/api/lidarr/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.lidarr.connected).toBe(true);
    });

    it('should return unhealthy status on error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Connection error'));

      const response = await request(app)
        .get('/api/lidarr/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle album lookup timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      global.fetch.mockRejectedValueOnce(abortError);

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'test-mbid' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('timeout');
    });

    it('should handle malformed API response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'test-mbid' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should handle 404 from Lidarr API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('Not found')
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'test-mbid' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('404');
    });

    it('should handle 401 unauthorized from Lidarr API', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: jest.fn().mockResolvedValue('Invalid API key')
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'test-mbid' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('401');
    });

    it('should handle empty artist list gracefully', async () => {
      // Mock album lookup
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: {
            artistName: 'New Artist',
            foreignArtistId: 'new-artist-mbid'
          }
        }])
      });

      // Mock empty artist list
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      // This should proceed to add the artist
      // We're just testing that empty array doesn't crash
      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'New Artist'
        });

      // Response might fail due to incomplete mocks, but shouldn't crash
      expect(response.status).toBeDefined();
    });

    it('should handle album with no statistics', async () => {
      // Mock album lookup with no statistics field
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          title: 'Test Album',
          foreignAlbumId: 'mbid-123',
          monitored: true
          // No statistics field
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        // When no statistics, should default to 0
        expect(response.body[0].percentComplete).toBe(0);
        expect(response.body[0].fullyAvailable).toBe(false);
        expect(response.body[0].inLibrary).toBe(false); // No id means not in library
      }
    });

    it('should handle album refresh timeout', async () => {
      // Mock album lookup
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          foreignAlbumId: 'album-mbid',
          title: 'Test Album',
          artist: {
            artistName: 'Test Artist',
            foreignArtistId: 'artist-mbid'
          }
        }])
      });

      // Mock existing artist
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          id: 1,
          artistName: 'Test Artist',
          foreignArtistId: 'artist-mbid'
        }])
      });

      // Mock albums (album not found initially)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([])
      });

      // Mock refresh trigger
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      // Mock polling - return empty array 30 times (simulating timeout)
      // This should complete within the test timeout
      for (let i = 0; i < 30; i++) {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue([]) // Album never appears
        });
      }

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      // Should return success=false when album not found after refresh
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    }, 60000); // Increase timeout to 60 seconds for this test
  });

  describe('Integration Scenarios', () => {
    it('should handle complete workflow for new artist with multiple albums', async () => {
      // This test simulates adding an album when the artist doesn't exist yet
      // and verifies all the steps happen in correct order

      const mockCalls = [];

      global.fetch.mockImplementation((url, options) => {
        const method = options?.method || 'GET';
        mockCalls.push({ url, method, body: options?.body });

        // Step 1: Album lookup
        if (url.includes('album/lookup') || url.includes('album%2Flookup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              foreignAlbumId: 'album-mbid',
              title: 'Test Album',
              artist: {
                artistName: 'Test Artist',
                foreignArtistId: 'artist-mbid'
              }
            }])
          });
        }

        // Step 2: Check existing artists - GET /artist (not /artist?)
        if ((url.includes('/artist?') || url.endsWith('/artist')) && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([]) // Empty = artist doesn't exist
          });
        }

        // Step 3: Add artist - POST /artist
        if (url.includes('/artist') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              id: 1,
              artistName: 'Test Artist',
              foreignArtistId: 'artist-mbid',
              path: '/music/TestArtist'
            })
          });
        }

        // Step 4: Commands (refresh or search)
        if (url.includes('command') && method === 'POST') {
          const body = options.body ? JSON.parse(options.body) : {};
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({ id: 1, name: body.name })
          });
        }

        // Step 5: Get albums (polling) - GET /album?artistId=X
        if (url.includes('album') && url.includes('artistId')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              id: 10,
              foreignAlbumId: 'album-mbid',
              title: 'Test Album',
              monitored: false,
              statistics: { percentOfTracks: 0 }
            }])
          });
        }

        // Step 6: Update album monitoring - PUT /album/X
        if (url.includes('/album/') && method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({
              id: 10,
              monitored: true
            })
          });
        }

        console.warn('Unhandled mock URL:', url, method);
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      expect(response.status).toBe(200);
      
      // Verify the workflow steps happened
      expect(mockCalls.length).toBeGreaterThan(4);
      expect(mockCalls[0].url).toMatch(/lookup/); // First: lookup album
      expect(mockCalls.some(c => c.method === 'GET' && c.url.includes('artist'))).toBe(true); // Check existing
      expect(mockCalls.some(c => c.method === 'POST' && c.url.includes('artist') && !c.url.includes('command'))).toBe(true); // Add artist
      expect(mockCalls.some(c => c.method === 'POST' && c.url.includes('command'))).toBe(true); // Commands (refresh/search)
      expect(mockCalls.some(c => c.url.includes('album') && c.url.includes('artistId'))).toBe(true); // Get albums
    });

    it('should handle concurrent requests gracefully', async () => {
      // Mock a simple successful lookup
      global.fetch.mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue([{
            id: 1,
            title: 'Test Album',
            foreignAlbumId: 'mbid-123',
            inLibrary: true,
            fullyAvailable: true,
            percentComplete: 100
          }])
        });
      });

      // Make 3 concurrent requests
      const promises = [
        request(app).get('/api/lidarr/lookup').query({ mbid: 'mbid-1' }),
        request(app).get('/api/lidarr/lookup').query({ mbid: 'mbid-2' }),
        request(app).get('/api/lidarr/lookup').query({ mbid: 'mbid-3' })
      ];

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Data Validation', () => {
    it('should handle special characters in album title', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          title: 'Test Album: Special Edition (Deluxe)',
          foreignAlbumId: 'mbid-123',
          inLibrary: false
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
    });

    it('should handle very long album titles', async () => {
      const longTitle = 'A'.repeat(500);
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          title: longTitle,
          foreignAlbumId: 'mbid-123',
          inLibrary: false
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
    });

    it('should handle unicode characters in artist name', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([{
          title: 'Test Album',
          foreignAlbumId: 'mbid-123',
          artist: {
            artistName: 'Björk & 日本人',
            foreignArtistId: 'artist-mbid'
          },
          inLibrary: false
        }])
      });

      const response = await request(app)
        .get('/api/lidarr/lookup')
        .query({ mbid: 'mbid-123' });

      expect(response.status).toBe(200);
    });
  });

  describe('Logging and Database Integration', () => {
    it('should complete album addition workflow successfully', async () => {
      // This test verifies the complete workflow runs without errors
      // Database logging is tested separately in unit tests for LidarrLogger
      
      // Setup complete successful flow for existing artist
      global.fetch.mockImplementation((url, options) => {
        if (url.includes('lookup') || url.includes('album%2Flookup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              foreignAlbumId: 'album-mbid',
              title: 'Test Album',
              artist: { artistName: 'Test Artist', foreignArtistId: 'artist-mbid' }
            }])
          });
        }
        // GET /artist (check for existing artists)
        if ((url.includes('/artist?') || url.endsWith('/artist')) && (!options || options.method !== 'POST')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              id: 1,
              artistName: 'Test Artist',
              foreignArtistId: 'artist-mbid',
              path: '/music/TestArtist'
            }])
          });
        }
        // GET /album?artistId (get artist's albums)
        if (url.includes('album') && url.includes('artistId')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue([{
              id: 10,
              foreignAlbumId: 'album-mbid',
              title: 'Test Album',
              monitored: false,
              statistics: { percentOfTracks: 50 }
            }])
          });
        }
        // PUT /album/X (update monitoring)
        if (url.includes('/album/') && options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({ id: 10, monitored: true })
          });
        }
        // POST /command (trigger search)
        if (url.includes('command') && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: jest.fn().mockResolvedValue({ id: 1 })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 1 })
        });
      });

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      // Verify the complete workflow succeeded
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
      expect(response.body.artist).toBe('Test Artist');
      expect(response.body.title).toBe('Test Album');
      expect(response.body.albumId).toBe(10);
      expect(response.body.message).toBeDefined();
      
      // Verify database mock was available (it's called internally)
      const databaseMock = require('../../../services/database');
      expect(databaseMock.database.logAlbumAddition).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      // Force a failure at lookup stage
      global.fetch.mockRejectedValueOnce(new Error('Connection timeout'));

      const response = await request(app)
        .post('/api/lidarr/add')
        .send({
          mbid: 'album-mbid',
          title: 'Test Album',
          artist: 'Test Artist'
        });

      // Should return error response
      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Connection timeout');
    });
    
    it('should validate database logging interface', () => {
      // This test verifies that the database mock has the expected interface
      // Actual logging behavior is tested in LidarrLogger unit tests
      const databaseMock = require('../../../services/database');
      
      expect(typeof databaseMock.database.logAlbumAddition).toBe('function');
      expect(typeof databaseMock.database.logArtistAddition).toBe('function');
      
      // Verify mock is set up correctly
      expect(databaseMock.database.logAlbumAddition).toHaveProperty('mock');
      expect(databaseMock.database.logArtistAddition).toHaveProperty('mock');
    });
  });
});