// server/routes/api/__tests__/logs.test.js
const request = require('supertest');
const express = require('express');
const logsRoutes = require('../../api/logs');

jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { user: { claims: { sub: 'test-user' } } };
    next();
  }
}));

jest.mock('../../../services/database', () => ({
  database: {
    db: {
      all: jest.fn(),
      get: jest.fn()
    },
    getStats: jest.fn(),
    getQueryStats: jest.fn(),
    getRecentAdditions: jest.fn(),
    all: jest.fn(),
    get: jest.fn()
  }
}));

jest.mock('../../../utils/timezone', () => ({
  getTimezoneInfo: jest.fn(() => ({
    timezone: 'UTC',
    abbreviation: 'UTC',
    offset: '+00:00',
    currentTime: '2024-01-01 12:00:00'
  })),
  formatForDatabase: jest.fn((date) => date.toISOString()),
  formatForAPI: jest.fn((date) => date.toISOString()),
  formatDisplay: jest.fn((date) => date.toISOString()),
  getRelativeTime: jest.fn(() => '1 hour ago'),
  daysAgo: jest.fn((days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)),
  fromISO: jest.fn((str) => new Date(str)),
  now: jest.fn(() => new Date())
}));

describe('Logs Routes', () => {
  let app;
  const { database } = require('../../../services/database');

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/logs', logsRoutes);
    
    jest.clearAllMocks();
  });

  describe('GET /api/logs/stats', () => {
    it('should return database statistics', async () => {
      database.getStats.mockResolvedValue({
        totalQueries: 100,
        totalArtists: 50,
        totalAlbums: 75,
        cacheHitRate: 85
      });

      const response = await request(app).get('/api/logs/stats');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        totalQueries: 100,
        totalArtists: 50,
        totalAlbums: 75
      });
      expect(response.body.timezone).toBeDefined();
    });
  });

  describe('GET /api/logs/queries/stats', () => {
    it('should return query statistics', async () => {
      database.getQueryStats.mockResolvedValue({
        total_queries: 200,
        avg_response_time: 150,
        cacheHitRate: 80
      });

      const response = await request(app)
        .get('/api/logs/queries/stats')
        .query({ days: 7 });
      
      expect(response.status).toBe(200);
      expect(response.body.total_queries).toBe(200);
      expect(database.getQueryStats).toHaveBeenCalledWith(7);
    });
  });

  describe('GET /api/logs/additions', () => {
    it('should return recent additions', async () => {
      database.getRecentAdditions.mockResolvedValue([
        { type: 'artist', name: 'Test Artist' },
        { type: 'album', name: 'Test Album' }
      ]);

      const response = await request(app)
        .get('/api/logs/additions')
        .query({ limit: 50 });
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /api/logs/queries', () => {
    it('should return query logs with pagination', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            user_id: 'user-1',
            endpoint: '/api/test'
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app)
        .get('/api/logs/queries')
        .query({ page: 1, limit: 100 });
      
      expect(response.status).toBe(200);
      expect(response.body.logs).toBeDefined();
      expect(response.body.pagination).toBeDefined();
    });

    it('should filter by user_id', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 0 });
      });

      const response = await request(app)
        .get('/api/logs/queries')
        .query({ user_id: 'specific-user' });
      
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/logs/artists', () => {
    it('should return artist addition logs', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            artist_name: 'Test Artist'
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app).get('/api/logs/artists');
      
      expect(response.status).toBe(200);
      expect(response.body.logs).toBeDefined();
    });
  });

  describe('GET /api/logs/albums', () => {
    it('should return album addition logs', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            album_title: 'Test Album'
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app).get('/api/logs/albums');
      
      expect(response.status).toBe(200);
      expect(response.body.logs).toBeDefined();
    });
  });

  describe('GET /api/logs/albums/downloaded', () => {
    it('should return downloaded albums only', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            album_title: 'Downloaded Album',
            downloaded: 1
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app).get('/api/logs/albums/downloaded');
      
      expect(response.status).toBe(200);
      expect(response.body.logs[0].downloaded).toBe(1);
    });
  });

  describe('GET /api/logs/albums/pending', () => {
    it('should return pending albums only', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            album_title: 'Pending Album',
            downloaded: 0,
            success: 1
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app).get('/api/logs/albums/pending');
      
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/logs/auth-events', () => {
    it('should return authentication events', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            event_type: 'login_success',
            user_id: 'user-1'
          }
        ]);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 1 });
      });

      const response = await request(app).get('/api/logs/auth-events');
      
      expect(response.status).toBe(200);
      expect(response.body.logs).toBeDefined();
    });

    it('should filter by event type', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      database.db.get.mockImplementation((query, params, callback) => {
        callback(null, { total: 0 });
      });

      const response = await request(app)
        .get('/api/logs/auth-events')
        .query({ event_type: 'login_success' });
      
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/logs/export/:type', () => {
    it('should export queries as CSV', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            timestamp: '2024-01-01T12:00:00Z',
            user_id: 'user-1',
            endpoint: '/api/test',
            method: 'GET'
          }
        ]);
      });

      const response = await request(app)
        .get('/api/logs/export/queries')
        .query({ days: 30 });
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should export artists as CSV', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            timestamp: '2024-01-01T12:00:00Z',
            user_id: 'user-1',
            artist_name: 'Test Artist'
          }
        ]);
      });

      const response = await request(app).get('/api/logs/export/artists');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should export albums as CSV', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            timestamp: '2024-01-01T12:00:00Z',
            user_id: 'user-1',
            album_title: 'Test Album'
          }
        ]);
      });

      const response = await request(app).get('/api/logs/export/albums');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should return error for invalid export type', async () => {
      const response = await request(app).get('/api/logs/export/invalid');
      
      expect(response.status).toBe(400);
    });

    it('should return 404 when no data found', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      const response = await request(app).get('/api/logs/export/queries');
      
      expect(response.status).toBe(404);
    });
  });

  describe('error handling', () => {
    it('should handle database errors in stats', async () => {
      database.getStats.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/logs/stats');
      
      expect(response.status).toBe(500);
    });

    it('should handle database errors in queries', async () => {
      database.db.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      const response = await request(app).get('/api/logs/queries');
      
      expect(response.status).toBe(500);
    });
  });
});