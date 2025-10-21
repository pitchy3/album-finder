#!/usr/bin/env node
// server/scripts/init-database.js - Initialize database with sample data for testing

const { database } = require('../services/database');

async function initializeDatabase() {
  console.log('🗄️  Initializing AlbumFinder database...');
  
  try {
    // Initialize database
    await database.initialize();
    
    // Log system startup event
    await database.logSystemEvent('database_init', 'Database manually initialized via script');
    
    // Get current stats
    const stats = await database.getStats();
    
    console.log('✅ Database initialized successfully!');
    console.log('📊 Current database stats:');
    console.log(`   - Total queries: ${stats.totalQueries}`);
    console.log(`   - Total artists added: ${stats.totalArtists}`);
    console.log(`   - Total albums added: ${stats.totalAlbums}`);
    console.log(`   - Total events: ${stats.totalEvents}`);
    
    // Test logging functionality
    console.log('\n🧪 Testing logging functionality...');
    
    // Test query log
    await database.logQuery({
      userId: 'test-user',
      endpoint: '/api/test',
      method: 'GET',
      searchTerm: 'test search',
      artist: 'Test Artist',
      album: 'Test Album',
      mbid: 'test-mbid-123',
      responseStatus: 200,
      responseTime: 150,
      cacheHit: false,
      userAgent: 'Test Agent',
      ipAddress: '127.0.0.1'
    });
    
    // Test artist addition log
    await database.logArtistAddition({
      userId: 'test-user',
      artistName: 'Test Artist',
      artistMbid: 'artist-mbid-123',
      lidarrArtistId: 1,
      qualityProfileId: 1,
      rootFolder: '/music',
      monitored: true,
      success: true
    });
    
    // Test album addition log
    await database.logAlbumAddition({
      userId: 'test-user',
      albumTitle: 'Test Album',
      albumMbid: 'album-mbid-123',
      artistName: 'Test Artist',
      artistMbid: 'artist-mbid-123',
      lidarrAlbumId: 1,
      lidarrArtistId: 1,
      releaseDate: '2024-01-01',
      monitored: true,
      searchTriggered: true,
      success: true
    });
    
    console.log('✅ Test data logged successfully!');
    
    // Get updated stats
    const updatedStats = await database.getStats();
    console.log('\n📊 Updated database stats:');
    console.log(`   - Total queries: ${updatedStats.totalQueries}`);
    console.log(`   - Total artists added: ${updatedStats.totalArtists}`);
    console.log(`   - Total albums added: ${updatedStats.totalAlbums}`);
    console.log(`   - Total events: ${updatedStats.totalEvents}`);
    
    console.log('\n🎉 Database initialization complete!');
    console.log('🔗 Access logs via: /api/admin/logs/stats');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await database.close();
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = { initializeDatabase };