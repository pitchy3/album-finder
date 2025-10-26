// __tests__/fixtures/helpers/seed.js
// Helper for seeding test data in database tests

const path = require('path');

// Correct path: from __tests__/fixtures/helpers/ to server/services/
const { database } = require(path.join(__dirname, '../../../services/database'));

async function seedTestData() {
  console.log('📝 Seeding test data...');
  
  // Seed queries
  await database.logQuery({
    userId: 'user-1',
    username: 'testuser1',
    email: 'test1@example.com',
    endpoint: '/api/musicbrainz/recording',
    method: 'GET',
    searchTerm: 'Bohemian Rhapsody',
    artist: 'Queen',
    responseStatus: 200,
    responseTime: 150,
    cacheHit: false,
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent'
  });

  // Seed artist additions
  await database.logArtistAddition({
    userId: 'user-1',
    username: 'testuser1',
    email: 'test1@example.com',
    artistName: 'Queen',
    artistMbid: 'artist-mbid-123',
    lidarrArtistId: 1,
    qualityProfileId: 1,
    rootFolder: '/music',
    monitored: true,
    success: true,
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent'
  });

  // Seed album additions
  await database.logAlbumAddition({
    userId: 'user-1',
    username: 'testuser1',
    email: 'test1@example.com',
    albumTitle: 'A Night at the Opera',
    albumMbid: 'album-mbid-123',
    artistName: 'Queen',
    artistMbid: 'artist-mbid-123',
    lidarrAlbumId: 1,
    lidarrArtistId: 1,
    releaseDate: '1975-11-21',
    monitored: true,
    searchTriggered: true,
    success: true,
    downloaded: true,
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent'
  });

  // Seed auth events
  await database.logAuthEvent({
    eventType: 'login_success',
    userId: 'user-1',
    username: 'testuser1',
    email: 'test1@example.com',
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent',
    sessionId: 'session-123',
    oidcSubject: 'oidc-sub-123'
  });

  console.log('✅ Test data seeded successfully');
}

async function clearTestData() {
  console.log('🧹 Clearing test data...');
  
  await database.run('DELETE FROM query_log');
  await database.run('DELETE FROM artist_additions');
  await database.run('DELETE FROM album_additions');
  await database.run('DELETE FROM auth_events');
  
  console.log('✅ Test data cleared');
}

module.exports = { seedTestData, clearTestData };