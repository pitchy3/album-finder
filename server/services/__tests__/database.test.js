const { database } = require('../database');

// Setup an in-memory temporary DB before running tests
beforeAll(async () => {
  process.env.NODE_ENV = 'test'; // silence logs + enable test mode
  await database.initialize(':memory:'); // use fast in-memory SQLite
});

// Clean up DB after all tests
afterAll(async () => {
  await database.close();
});

describe('Database Service', () => {
  // Clean tables before each test
  beforeEach(async () => {
    await database.run('DELETE FROM query_log');
    await database.run('DELETE FROM artist_additions');
    await database.run('DELETE FROM album_additions');
  });

  describe('logQuery', () => {
    it('should log API queries correctly', async () => {
      await database.logQuery({
        userId: 'test-user',
        endpoint: '/api/test',
        method: 'GET',
        responseStatus: 200,
        responseTime: 100
      });

      const logs = await database.all('SELECT * FROM query_log');
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe('test-user');
      expect(logs[0].endpoint).toBe('/api/test');
    });

    it('should handle optional fields', async () => {
      await database.logQuery({
        userId: 'test-user',
        endpoint: '/api/test',
        searchTerm: 'test song',
        artist: 'test artist'
      });

      const logs = await database.all('SELECT * FROM query_log');
      expect(logs[0].search_term).toBe('test song');
      expect(logs[0].artist).toBe('test artist');
    });
  });

  describe('logArtistAddition', () => {
    it('should log artist additions', async () => {
      await database.logArtistAddition({
        userId: 'test-user',
        artistName: 'Test Artist',
        artistMbid: 'mbid-123',
        lidarrArtistId: 1,
        success: true
      });

      const logs = await database.all('SELECT * FROM artist_additions');
      expect(logs).toHaveLength(1);
      expect(logs[0].artist_name).toBe('Test Artist');
    });
  });

  describe('logAlbumAddition', () => {
    it('should log album additions', async () => {
      await database.logAlbumAddition({
        userId: 'test-user',
        albumTitle: 'Test Album',
        albumMbid: 'album-mbid',
        artistName: 'Test Artist',
        success: true
      });

      const logs = await database.all('SELECT * FROM album_additions');
      expect(logs).toHaveLength(1);
      expect(logs[0].album_title).toBe('Test Album');
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      await database.logQuery({
        userId: 'user1',
        endpoint: '/api/test',
        responseStatus: 200
      });

      await database.logArtistAddition({
        userId: 'user1',
        artistName: 'Artist 1',
        success: true
      });

      const stats = await database.getStats();
      expect(stats.totalQueries).toBe(1);
      expect(stats.totalArtists).toBe(1);
    });
  });
});