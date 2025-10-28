// server/__tests__/integration/database.test.js
const { database } = require('../../services/database');
const tz = require('../../utils/timezone');

describe('Database Service Integration', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; // silence logs + enable test mode
    await database.initialize(':memory:'); // use fast in-memory SQLite
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // Clear tables before each test
    await database.run('DELETE FROM query_log');
    await database.run('DELETE FROM artist_additions');
    await database.run('DELETE FROM album_additions');
    await database.run('DELETE FROM auth_events');
  });

  describe('Query Logging', () => {
    test('should log a query with all fields', async () => {
      const queryData = {
        userId: 'test-user-123',
        username: 'testuser',
        email: 'test@example.com',
        endpoint: '/api/musicbrainz/recording',
        method: 'GET',
        searchTerm: 'test song',
        artist: 'Test Artist',
        album: 'Test Album',
        mbid: 'test-mbid-123',
        responseStatus: 200,
        responseTime: 150,
        cacheHit: false,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        searchType: 'recording'
      };

      await database.logQuery(queryData);

      const result = await database.get(
        'SELECT * FROM query_log WHERE user_id = ?',
        [queryData.userId]
      );

      expect(result).toBeDefined();
      expect(result.user_id).toBe(queryData.userId);
      expect(result.username).toBe(queryData.username);
      expect(result.search_term).toBe(queryData.searchTerm);
      expect(result.artist).toBe(queryData.artist);
      expect(result.response_status).toBe(queryData.responseStatus);
    });

    test('should handle queries with missing optional fields', async () => {
      const minimalQuery = {
        userId: 'test-user-456',
        endpoint: '/api/test',
        responseStatus: 200
      };

      await database.logQuery(minimalQuery);

      const result = await database.get(
        'SELECT * FROM query_log WHERE user_id = ?',
        [minimalQuery.userId]
      );

      expect(result).toBeDefined();
      expect(result.user_id).toBe(minimalQuery.userId);
      expect(result.search_term).toBeNull();
      expect(result.artist).toBeNull();
    });
  });

  describe('Artist Addition Logging', () => {
    test('should log successful artist addition', async () => {
      const artistData = {
        userId: 'test-user-789',
        username: 'artistfan',
        email: 'fan@example.com',
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid-123',
        lidarrArtistId: 1,
        qualityProfileId: 1,
        rootFolder: '/music',
        monitored: true,
        success: true,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0'
      };

      await database.logArtistAddition(artistData);

      const result = await database.get(
        'SELECT * FROM artist_additions WHERE user_id = ?',
        [artistData.userId]
      );

      expect(result).toBeDefined();
      expect(result.artist_name).toBe(artistData.artistName);
      expect(result.artist_mbid).toBe(artistData.artistMbid);
      expect(result.lidarr_artist_id).toBe(artistData.lidarrArtistId);
      expect(result.success).toBe(1); // SQLite stores boolean as 1/0
    });

    test('should log failed artist addition with error message', async () => {
      const failedArtistData = {
        userId: 'test-user-999',
        artistName: 'Failed Artist',
        artistMbid: 'failed-mbid',
        success: false,
        errorMessage: 'Connection timeout'
      };

      await database.logArtistAddition(failedArtistData);

      const result = await database.get(
        'SELECT * FROM artist_additions WHERE user_id = ?',
        [failedArtistData.userId]
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(0);
      expect(result.error_message).toBe('Connection timeout');
    });
  });

  describe('Album Addition Logging', () => {
    test('should log successful album addition', async () => {
      const albumData = {
        userId: 'test-user-111',
        username: 'musiclover',
        email: 'lover@example.com',
        albumTitle: 'Test Album',
        albumMbid: 'album-mbid-123',
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid-123',
        lidarrAlbumId: 1,
        lidarrArtistId: 1,
        releaseDate: '2024-01-01',
        monitored: true,
        searchTriggered: true,
        success: true,
        downloaded: false
      };

      await database.logAlbumAddition(albumData);

      const result = await database.get(
        'SELECT * FROM album_additions WHERE user_id = ?',
        [albumData.userId]
      );

      expect(result).toBeDefined();
      expect(result.album_title).toBe(albumData.albumTitle);
      expect(result.album_mbid).toBe(albumData.albumMbid);
      expect(result.artist_name).toBe(albumData.artistName);
      expect(result.monitored).toBe(1);
      expect(result.search_triggered).toBe(1);
      expect([0, null]).toContain(result.downloaded);
    });

    test('should track downloaded status', async () => {
      const albumData = {
        userId: 'test-user-222',
        albumTitle: 'Downloaded Album',
        albumMbid: 'download-mbid',
        lidarrAlbumId: 2,
        success: true,
        downloaded: true
      };

      await database.logAlbumAddition(albumData);

      const result = await database.get(
        'SELECT * FROM album_additions WHERE lidarr_album_id = ?',
        [albumData.lidarrAlbumId]
      );

      expect(result).toBeDefined();
      expect(result.downloaded).toBe(1);
    });
  });

  describe('Authentication Event Logging', () => {
    test('should log successful login', async () => {
      const authData = {
        eventType: 'login_success',
        userId: 'oauth-user-123',
        username: 'testuser',
        email: 'test@example.com',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        sessionId: 'session-123',
        oidcSubject: 'oauth-sub-123'
      };

      await database.logAuthEvent(authData);

      const result = await database.get(
        'SELECT * FROM auth_events WHERE user_id = ?',
        [authData.userId]
      );

      expect(result).toBeDefined();
      expect(result.event_type).toBe('login_success');
      expect(result.username).toBe(authData.username);
      expect(result.oidc_subject).toBe(authData.oidcSubject);
    });

    test('should log failed login with error', async () => {
      const failedAuthData = {
        eventType: 'login_failure',
        ipAddress: '127.0.0.1',
        errorMessage: 'Invalid credentials'
      };

      await database.logAuthEvent(failedAuthData);

      const result = await database.get(
        "SELECT * FROM auth_events WHERE event_type = 'login_failure' ORDER BY timestamp DESC LIMIT 1"
      );

      expect(result).toBeDefined();
      expect(result.error_message).toBe('Invalid credentials');
    });

    test('should log logout event', async () => {
      const logoutData = {
        eventType: 'logout',
        userId: 'oauth-user-456',
        username: 'logoutuser',
        sessionId: 'session-456'
      };

      await database.logAuthEvent(logoutData);

      const result = await database.get(
        'SELECT * FROM auth_events WHERE session_id = ?',
        [logoutData.sessionId]
      );

      expect(result).toBeDefined();
      expect(result.event_type).toBe('logout');
    });
  });

  describe('Statistics and Queries', () => {
    beforeEach(async () => {
      // Insert test data
      await database.logQuery({
        userId: 'stats-user-1',
        endpoint: '/api/test',
        responseStatus: 200,
        responseTime: 100,
        cacheHit: true
      });

      await database.logQuery({
        userId: 'stats-user-2',
        endpoint: '/api/test',
        responseStatus: 200,
        responseTime: 200,
        cacheHit: false
      });

      await database.logArtistAddition({
        userId: 'stats-user-1',
        artistName: 'Stats Artist',
        success: true
      });

      await database.logAlbumAddition({
        userId: 'stats-user-1',
        albumTitle: 'Stats Album',
        success: true
      });
    });

    test('should retrieve overall statistics', async () => {
      const stats = await database.getStats();

      expect(stats).toBeDefined();
      expect(stats.totalQueries).toBeGreaterThanOrEqual(2);
      expect(stats.totalArtists).toBeGreaterThanOrEqual(1);
      expect(stats.totalAlbums).toBeGreaterThanOrEqual(1);
      expect(stats.cacheHitRate).toBeDefined();
    });

    test('should retrieve query statistics for time period', async () => {
      const stats = await database.getQueryStats(7); // Last 7 days

      expect(stats).toBeDefined();
      expect(stats.total_queries).toBeGreaterThanOrEqual(2);
      expect(stats.avg_response_time).toBeDefined();
      expect(stats.cacheHitRate).toBeDefined();
    });

    test('should retrieve recent additions', async () => {
      const additions = await database.getRecentAdditions(10);

      expect(Array.isArray(additions)).toBe(true);
      expect(additions.length).toBeGreaterThanOrEqual(2);
      
      const hasArtist = additions.some(a => a.type === 'artist');
      const hasAlbum = additions.some(a => a.type === 'album');
      
      expect(hasArtist).toBe(true);
      expect(hasAlbum).toBe(true);
    });
  });

  describe('Timezone Handling', () => {
    test('should store timestamps in UTC', async () => {
      const beforeLog = new Date();
      
      await database.logQuery({
        userId: 'tz-test-user',
        endpoint: '/api/test',
        responseStatus: 200
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await database.get(
        'SELECT * FROM query_log WHERE user_id = ?',
        ['tz-test-user']
      );

      expect(result).toBeDefined();
      expect(result.timestamp).toBeDefined();
      
      // Verify timestamp is in ISO format
      const timestamp = new Date(result.timestamp);
      expect(timestamp.toISOString()).toBeTruthy();
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeLog.getTime());
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent writes without corruption', async () => {
      const promises = [];
      
      // Create 10 concurrent writes
      for (let i = 0; i < 10; i++) {
        promises.push(
          database.logQuery({
            userId: `concurrent-user-${i}`,
            endpoint: '/api/test',
            responseStatus: 200
          })
        );
      }

      await Promise.all(promises);

      // Verify all writes succeeded
      const count = await database.get(
        "SELECT COUNT(*) as count FROM query_log WHERE user_id LIKE 'concurrent-user-%'"
      );

      expect(count.count).toBe(10);
    });
  });
});
