// __tests__/fixtures/helpers/seed.test.js
// Tests for the database seeding helper

const path = require('path');
const { seedTestData, clearTestData } = require('./seed');
const { database } = require(path.join(__dirname, '../../../services/database'));

describe('Database Seed Helper', () => {
  beforeAll(async () => {
    // Initialize database for testing
    await database.initialize();
  });

  afterAll(async () => {
    // Clean up and close database
    await clearTestData();
    await database.close();
  });

  beforeEach(async () => {
    // Clear data before each test
    await clearTestData();
  });

  describe('seedTestData', () => {
    it('should seed query log data', async () => {
      await seedTestData();

      const queries = await database.all(
        'SELECT * FROM query_log WHERE user_id = ?',
        ['user-1']
      );

      expect(queries.length).toBeGreaterThan(0);
      expect(queries[0].username).toBe('testuser1');
      expect(queries[0].artist).toBe('Queen');
      expect(queries[0].search_term).toBe('Bohemian Rhapsody');
    });

    it('should seed artist additions', async () => {
      await seedTestData();

      const artists = await database.all(
        'SELECT * FROM artist_additions WHERE user_id = ?',
        ['user-1']
      );

      expect(artists.length).toBeGreaterThan(0);
      expect(artists[0].artist_name).toBe('Queen');
      expect(artists[0].success).toBe(1); // SQLite stores boolean as 1/0
    });

    it('should seed album additions', async () => {
      await seedTestData();

      const albums = await database.all(
        'SELECT * FROM album_additions WHERE user_id = ?',
        ['user-1']
      );

      expect(albums.length).toBeGreaterThan(0);
      expect(albums[0].album_title).toBe('A Night at the Opera');
      expect(albums[0].artist_name).toBe('Queen');
      expect(albums[0].downloaded).toBe(1);
    });

    it('should seed auth events', async () => {
      await seedTestData();

      const events = await database.all(
        'SELECT * FROM auth_events WHERE user_id = ?',
        ['user-1']
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].event_type).toBe('login_success');
      expect(events[0].username).toBe('testuser1');
    });
  });

  describe('clearTestData', () => {
    it('should clear all test data', async () => {
      // First seed data
      await seedTestData();

      // Verify data exists
      const queriesBefore = await database.all('SELECT * FROM query_log');
      expect(queriesBefore.length).toBeGreaterThan(0);

      // Clear data
      await clearTestData();

      // Verify data is cleared
      const queriesAfter = await database.all('SELECT * FROM query_log');
      const artistsAfter = await database.all('SELECT * FROM artist_additions');
      const albumsAfter = await database.all('SELECT * FROM album_additions');
      const eventsAfter = await database.all('SELECT * FROM auth_events');

      expect(queriesAfter.length).toBe(0);
      expect(artistsAfter.length).toBe(0);
      expect(albumsAfter.length).toBe(0);
      expect(eventsAfter.length).toBe(0);
    });
  });

  describe('integration', () => {
    it('should support multiple seed and clear cycles', async () => {
      // Cycle 1
      await seedTestData();
      let queries = await database.all('SELECT * FROM query_log');
      expect(queries.length).toBeGreaterThan(0);

      await clearTestData();
      queries = await database.all('SELECT * FROM query_log');
      expect(queries.length).toBe(0);

      // Cycle 2
      await seedTestData();
      queries = await database.all('SELECT * FROM query_log');
      expect(queries.length).toBeGreaterThan(0);

      await clearTestData();
      queries = await database.all('SELECT * FROM query_log');
      expect(queries.length).toBe(0);
    });
  });
});