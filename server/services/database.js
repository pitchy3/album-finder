// server/services/database.js - Database service with timezone support and user search logging
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const tz = require('../utils/timezone');

class Database {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  async initialize(dbPathOverride) {
    try {
      const dataDir = path.join(__dirname, '../data');
      const dbPath = dbPathOverride || path.join(dataDir, 'albumfinder.db');
  
      console.log('📊 Initializing SQLite database...');
      console.log('📁 Database path:', dbPath);
  
      // ⭐ Try multiple strategies to ensure directory is writable
      await this.ensureWritableDataDirectory(dataDir);
  
      // NOW create the database connection
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('❌ Failed to open database:', err);
          throw err;
        }
        console.log('✅ Database connection established');
      });
  
      // Wait for database to be ready
      await new Promise((resolve, reject) => {
        this.db.once('open', resolve);
        this.db.once('error', reject);
        setTimeout(resolve, 100);
      });
  
      // Enable foreign keys and WAL mode
      await this.run('PRAGMA foreign_keys = ON');
      await this.run('PRAGMA journal_mode = WAL');
      await this.run('PRAGMA synchronous = NORMAL');
      await this.run('PRAGMA cache_size = 10000');
      await this.run('PRAGMA temp_store = memory');
  
      // Create tables FIRST
      await this.createTables();
      
      // THEN run migrations
      await this.migrateTables();
      
      this.isInitialized = true;
      console.log('✅ Database initialized successfully');
      console.log(`🌍 All timestamps will be stored in UTC and displayed in ${tz.TIMEZONE}`);
      
    } catch (error) {
      console.error('⚠️ Database initialization failed:', error);
      throw error;
    }
  }
  
  async ensureWritableDataDirectory(dataDir) {
    const { execSync } = require('child_process');
    
    console.log('🔧 Ensuring data directory is writable...');
  
    // Strategy 1: Try to create with mkdir -p (works if parent is writable)
    try {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o777 });
      console.log('✅ Directory created with mkdir');
    } catch (mkdirError) {
      if (mkdirError.code !== 'EEXIST') {
        console.warn('⚠️  mkdir failed:', mkdirError.message);
      }
    }
  
    // Strategy 2: Try to chmod the directory
    try {
      await fs.chmod(dataDir, 0o777);
      console.log('✅ Permissions set with chmod');
    } catch (chmodError) {
      console.warn('⚠️  chmod failed:', chmodError.message);
    }
  
    // Strategy 3: Test if directory is actually writable
    try {
      await fs.access(dataDir, fs.constants.W_OK);
      console.log('✅ Data directory is writable');
      return; // Success!
    } catch (accessError) {
      console.warn('⚠️  Directory not writable with current permissions');
    }
  
    // Strategy 4: Show detailed diagnostic info
    try {
      const stats = await fs.stat(dataDir);
      const processUid = process.getuid?.();
      const processGid = process.getgid?.();
      
      console.log('📋 Permission diagnostic:');
      console.log('   Directory mode:', '0' + (stats.mode & parseInt('777', 8)).toString(8));
      console.log('   Directory owner:', `${stats.uid}:${stats.gid}`);
      console.log('   Process running as:', `${processUid}:${processGid}`);
      
      // Strategy 5: Try using shell chown if we have permissions
      if (processUid === 0) {
        // We're root, we can fix this
        console.log('🔧 Running as root, attempting to fix permissions...');
        try {
          execSync(`chown -R ${processUid}:${processGid} "${dataDir}"`);
          execSync(`chmod -R 777 "${dataDir}"`);
          console.log('✅ Permissions fixed via shell commands');
          return;
        } catch (shellError) {
          console.warn('⚠️  Shell commands failed:', shellError.message);
        }
      }
    } catch (statError) {
      console.error('❌ Could not stat directory:', statError.message);
    }
  
    // Strategy 6: Use alternative location as absolute fallback
    const fallbackDir = process.env.ALBUMFINDER_DATA_DIR || '/tmp/albumfinder-data';
    
    if (dataDir !== fallbackDir) {
      console.warn(`⚠️  Cannot write to ${dataDir}`);
      console.warn(`🔄 Attempting fallback to: ${fallbackDir}`);
      
      try {
        await fs.mkdir(fallbackDir, { recursive: true, mode: 0o777 });
        await fs.access(fallbackDir, fs.constants.W_OK);
        
        console.log(`✅ Using fallback directory: ${fallbackDir}`);
        console.warn(`⚠️  WARNING: Data will not persist! Please fix volume permissions.`);
        
        // Update the path for this instance
        return await this.ensureWritableDataDirectory(fallbackDir);
      } catch (fallbackError) {
        console.error('❌ Fallback directory also failed:', fallbackError.message);
      }
    }
  
    // All strategies failed
    throw new Error(
      `Cannot create writable data directory.\n` +
      `Attempted: ${dataDir}\n` +
      `Please ensure the directory is writable by UID ${process.getuid?.()} or run container with appropriate permissions.\n` +
      `You can also set ALBUMFINDER_DATA_DIR environment variable to specify an alternative location.`
    );
  }

  async createTables() {
    // Query log table
    await this.run(`
      CREATE TABLE IF NOT EXISTS query_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT,
        endpoint TEXT NOT NULL,
        method TEXT DEFAULT 'GET',
        search_term TEXT,
        artist TEXT,
        album TEXT,
        mbid TEXT,
        response_status INTEGER,
        response_time_ms INTEGER,
        cache_hit BOOLEAN DEFAULT FALSE,
        ip_address TEXT,
        user_agent TEXT,
        search_type TEXT,
        metadata TEXT, -- JSON field for storing search preferences and other metadata
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        username TEXT,
        email TEXT
      )
    `);

    // Artist additions table
    await this.run(`
      CREATE TABLE IF NOT EXISTS artist_additions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT,
        username TEXT,
        email TEXT,
        artist_name TEXT NOT NULL,
        artist_mbid TEXT,
        lidarr_artist_id INTEGER,
        quality_profile_id INTEGER,
        root_folder TEXT,
        monitored BOOLEAN DEFAULT TRUE,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        request_data TEXT, -- JSON of original request
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Album additions table  
    await this.run(`
      CREATE TABLE IF NOT EXISTS album_additions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT,
        username TEXT,
        email TEXT,
        album_title TEXT NOT NULL,
        album_mbid TEXT,
        artist_name TEXT,
        artist_mbid TEXT,
        lidarr_album_id INTEGER,
        lidarr_artist_id INTEGER,
        release_date TEXT,
        monitored BOOLEAN DEFAULT TRUE,
        search_triggered BOOLEAN DEFAULT FALSE,
        success BOOLEAN DEFAULT TRUE,
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        request_data TEXT, -- JSON of original request
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        downloaded BOOLEAN DEFAULT FALSE
      )
    `);

    // Auth events table
    await this.run(`
      CREATE TABLE IF NOT EXISTS auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL, -- 'login_success', 'login_failure', 'logout'
        user_id TEXT,
        username TEXT,
        email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        error_message TEXT,
        session_id TEXT,
        oidc_subject TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
	
    // Add username and email columns if they don't exist
    await this.addColumnsIfNotExist('query_log', [
      { name: 'username', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
      { name: 'metadata', type: 'TEXT' }
    ]);
	
    await this.addColumnsIfNotExist('album_additions', [
      { name: 'downloaded', type: 'BOOLEAN' }
    ]);

    // Create indexes for better performance
    await this.run('CREATE INDEX IF NOT EXISTS idx_query_log_timestamp ON query_log(timestamp)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_query_log_user_id ON query_log(user_id)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_query_log_endpoint ON query_log(endpoint)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_artist_additions_timestamp ON artist_additions(timestamp)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_album_additions_timestamp ON album_additions(timestamp)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_album_additions_user_id ON album_additions(user_id)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_auth_events_timestamp ON auth_events(timestamp)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_auth_events_user_id ON auth_events(user_id)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_auth_events_type ON auth_events(event_type)');
  }
  
  async addColumnsIfNotExist(tableName, columns) {
    try {
      // Get current table structure
      const tableInfo = await new Promise((resolve, reject) => {
        this.db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
  
      const existingColumns = tableInfo.map(col => col.name);
  
      for (const column of columns) {
        if (!existingColumns.includes(column.name)) {
          console.log(`🔧 Adding ${column.name} column to ${tableName} table...`);
          await this.run(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.type}`);
          console.log(`✅ Added ${column.name} column to ${tableName} table`);
        } else {
          console.log(`ℹ️ Column ${column.name} already exists in ${tableName} table`);
        }
      }
    } catch (error) {
      console.error(`⚠️ Error adding columns to ${tableName}:`, error.message);
      throw error;
    }
  }
  
  // Migration to add username and email columns to query_log table
  async migrateTables() {
    if (!this.isInitialized) return;
  
    try {
      // Check if username column exists in query_log
      const tableInfo_query = await new Promise((resolve, reject) => {
        this.db.all("PRAGMA table_info(query_log)", (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      // Check if downloaded column exists in album_additions
      const tableInfo_album = await new Promise((resolve, reject) => {
        this.db.all("PRAGMA table_info(album_additions)", (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
  
      const hasUsernameColumn = tableInfo_query.some(col => col.name === 'username');
      const hasEmailColumn = tableInfo_query.some(col => col.name === 'email');
      const hasMetadataColumn = tableInfo_query.some(col => col.name === 'metadata');
      
      const hasDownloadedColumn = tableInfo_album.some(col => col.name === 'downloaded');
  
      // Add username column if it doesn't exist
      if (!hasUsernameColumn) {
        console.log('🔧 Adding username column to query_log table...');
        await this.run('ALTER TABLE query_log ADD COLUMN username TEXT');
        console.log('✅ Added username column to query_log table');
      }
  
      // Add email column if it doesn't exist
      if (!hasEmailColumn) {
        console.log('🔧 Adding email column to query_log table...');
        await this.run('ALTER TABLE query_log ADD COLUMN email TEXT');
        console.log('✅ Added email column to query_log table');
      }
      
      // Add metadata column if it doesn't exist
      if (!hasMetadataColumn) {
        console.log('🔧 Adding metadata column to query_log table...');
        await this.run('ALTER TABLE query_log ADD COLUMN metadata TEXT');
        console.log('✅ Added metadata column to query_log table');
      }
      
      // Add downloaded column if it doesn't exist
      if (!hasDownloadedColumn) {
        console.log('🔧 Adding downloaded column to album_additions table...');
        await this.run('ALTER TABLE album_additions ADD COLUMN downloaded BOOLEAN DEFAULT FALSE');
        console.log('✅ Added downloaded column to album_additions table');
      }
  
    } catch (error) {
      console.error('⚠️ Error migrating tables:', error.message);
    }
  }

  // Promisify database operations
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Log API query with timezone-aware timestamps
  async logQuery(data) {
    if (!this.isInitialized) return;
  
    try {
      const timestamp = tz.formatForDatabase(tz.now());
      
      await this.run(`
        INSERT INTO query_log (
          timestamp, user_id, username, email, endpoint, method, search_term, 
          artist, album, mbid, response_status, response_time_ms, cache_hit, 
          ip_address, user_agent, search_type, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        timestamp,
        data.userId || null,
        data.username || null,
        data.email || null,
        data.endpoint || null,
        data.method || 'GET',
        data.searchTerm || null,
        data.artist || null,
        data.album || null,
        data.mbid || null,
        data.responseStatus || null,
        data.responseTime || null,
        data.cacheHit || false,
        data.ipAddress || null,
        data.userAgent || null,
        data.searchType || null,
        data.metadata || null
      ]);
    } catch (error) {
      console.error('⚠️ Error logging query:', error.message);
    }
  }

  // Log artist addition with timezone-aware timestamps
  async logArtistAddition(data) {
    if (!this.isInitialized) return;
  
    try {
      const timestamp = tz.formatForDatabase(tz.now());
      
      await this.run(`
        INSERT INTO artist_additions (
          timestamp, user_id, username, email, artist_name, artist_mbid, 
          lidarr_artist_id, quality_profile_id, root_folder, monitored, 
          success, error_message, ip_address, user_agent, request_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        timestamp,
        data.userId || null,
        data.username || null,
        data.email || null,
        data.artistName || null,
        data.artistMbid || null,
        data.lidarrArtistId || null,
        data.qualityProfileId || null,
        data.rootFolder || null,
        data.monitored !== undefined ? data.monitored : true,
        data.success !== undefined ? data.success : true,
        data.errorMessage || null,
        data.ipAddress || null,
        data.userAgent || null,
        data.requestData || null
      ]);
    } catch (error) {
      console.error('⚠️ Error logging artist addition:', error.message);
    }
  }

  // Log album addition with timezone-aware timestamps
  async logAlbumAddition(data) {
    if (!this.isInitialized) return;
  
    try {
      const timestamp = tz.formatForDatabase(tz.now());
      
      await this.run(`
        INSERT INTO album_additions (
          timestamp, user_id, username, email, album_title, album_mbid, 
          artist_name, artist_mbid, lidarr_album_id, lidarr_artist_id, 
          release_date, monitored, search_triggered, success, error_message,
          ip_address, user_agent, request_data, downloaded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        timestamp,
        data.userId || null,
        data.username || null,
        data.email || null,
        data.albumTitle || null,
        data.albumMbid || null,
        data.artistName || null,
        data.artistMbid || null,
        data.lidarrAlbumId || null,
        data.lidarrArtistId || null,
        data.releaseDate || null,
        data.monitored !== undefined ? data.monitored : true,
        data.searchTriggered !== undefined ? data.searchTriggered : false,
        data.success !== undefined ? data.success : true,
        data.errorMessage || null,
        data.ipAddress || null,
        data.userAgent || null,
        data.requestData || null,
        data.downloaded || null
      ]);
    } catch (error) {
      console.error('⚠️ Error logging album addition:', error.message);
    }
  }

  // Log authentication events with timezone-aware timestamps
  async logAuthEvent(data) {
    if (!this.isInitialized) return;

    try {
      const timestamp = tz.formatForDatabase(tz.now());
    
      await this.run(`
        INSERT INTO auth_events (
          timestamp, event_type, user_id, username, email, ip_address, 
          user_agent, error_message, session_id, oidc_subject
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        timestamp,
        data.eventType || null,
        data.userId || null,
        data.username || null,
        data.email || null,
        data.ipAddress || null,
        data.userAgent || null,
        data.errorMessage || null,
        data.sessionId || null,
        data.oidcSubject || null
      ]);
    } catch (error) {
      console.error('⚠️ Error logging auth event:', error.message);
    }
  }

  // Get statistics with timezone formatting
  async getStats() {
    if (!this.isInitialized) return null;

    try {
      const stats = {};
      
      // Total counts
      const totalQueries = await this.get('SELECT COUNT(*) as count FROM query_log');
      const totalArtists = await this.get('SELECT COUNT(*) as count FROM artist_additions WHERE success = 1');
      const totalAlbums = await this.get('SELECT COUNT(*) as count FROM album_additions WHERE success = 1');
      
      stats.totalQueries = totalQueries.count;
      stats.totalArtists = totalArtists.count;
      stats.totalAlbums = totalAlbums.count;

      // Recent activity (last 24 hours)
      const yesterday = tz.formatForDatabase(tz.daysAgo(1));
      
      const recentQueries = await this.get(
        'SELECT COUNT(*) as count FROM query_log WHERE timestamp >= ?',
        [yesterday]
      );
      const recentArtists = await this.get(
        'SELECT COUNT(*) as count FROM artist_additions WHERE timestamp >= ? AND success = 1',
        [yesterday]
      );
      const recentAlbums = await this.get(
        'SELECT COUNT(*) as count FROM album_additions WHERE timestamp >= ? AND success = 1',
        [yesterday]
      );

      stats.recent = {
        queries: recentQueries.count,
        artists: recentArtists.count,
        albums: recentAlbums.count
      };

      // Most active users (last 7 days)
      const lastWeek = tz.formatForDatabase(tz.daysAgo(7));
      
      const activeUsers = await this.all(`
        SELECT user_id, COUNT(*) as activity_count
        FROM query_log 
        WHERE timestamp >= ? AND user_id IS NOT NULL
        GROUP BY user_id 
        ORDER BY activity_count DESC 
        LIMIT 10
      `, [lastWeek]);

      stats.activeUsers = activeUsers;

      // Cache hit rate (last 7 days)
      const cacheStats = await this.get(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits
        FROM query_log 
        WHERE timestamp >= ?
      `, [lastWeek]);

      if (cacheStats.total_requests > 0) {
        stats.cacheHitRate = ((cacheStats.cache_hits / cacheStats.total_requests) * 100).toFixed(1);
      } else {
        stats.cacheHitRate = 0;
      }

      return stats;
    } catch (error) {
      console.error('⚠️ Error getting database stats:', error.message);
      return null;
    }
  }

  // Get recent additions with timezone formatting
  async getRecentAdditions(limit = 50) {
    if (!this.isInitialized) return [];

    try {
      // Get recent artist and album additions combined
      const results = await this.all(`
        SELECT 
          'artist' as type,
          timestamp,
          user_id,
          artist_name as name,
          artist_mbid as mbid,
          lidarr_artist_id as lidarr_id,
          success,
          error_message
        FROM artist_additions
        WHERE timestamp >= datetime('now', '-30 days')
        
        UNION ALL
        
        SELECT 
          'album' as type,
          timestamp,
          user_id,
          album_title as name,
          album_mbid as mbid,
          lidarr_album_id as lidarr_id,
          success,
          error_message
        FROM album_additions
        WHERE timestamp >= datetime('now', '-30 days')
        
        ORDER BY timestamp DESC 
        LIMIT ?
      `, [limit]);

      // Format timestamps for display
      return results.map(row => ({
        ...row,
        timestamp: tz.formatForAPI(tz.fromISO(row.timestamp)),
        displayTime: tz.formatDisplay(tz.fromISO(row.timestamp), 'MMM D, YYYY HH:mm z'),
        relativeTime: tz.getRelativeTime(tz.fromISO(row.timestamp))
      }));
    } catch (error) {
      console.error('⚠️ Error getting recent additions:', error.message);
      return [];
    }
  }

  // Get query statistics with timezone support
  async getQueryStats(days = 30) {
    if (!this.isInitialized) return null;

    try {
      const since = tz.formatForDatabase(tz.daysAgo(days));
      
      const stats = await this.get(`
        SELECT 
          COUNT(*) as total_queries,
          COUNT(DISTINCT user_id) as unique_users,
          AVG(response_time_ms) as avg_response_time,
          SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
          SUM(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) as errors
        FROM query_log 
        WHERE timestamp >= ?
      `, [since]);

      // Get hourly breakdown for the last 24 hours
      const yesterday = tz.formatForDatabase(tz.daysAgo(1));
      const hourlyStats = await this.all(`
        SELECT 
          strftime('%H', timestamp) as hour,
          COUNT(*) as count
        FROM query_log 
        WHERE timestamp >= ?
        GROUP BY hour
        ORDER BY hour
      `, [yesterday]);

      return {
        ...stats,
        cacheHitRate: stats.total_queries > 0 ? 
          ((stats.cache_hits / stats.total_queries) * 100).toFixed(1) : 0,
        errorRate: stats.total_queries > 0 ? 
          ((stats.errors / stats.total_queries) * 100).toFixed(1) : 0,
        hourlyBreakdown: hourlyStats,
        period: {
          days: days,
          since: tz.formatDisplay(tz.daysAgo(days))
        }
      };
    } catch (error) {
      console.error('⚠️ Error getting query stats:', error.message);
      return null;
    }
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('⚠️ Error closing database:', err.message);
          } else {
            console.log('📊 Database connection closed');
          }
          this.db = null;
          this.isInitialized = false;
          resolve();
        });
      });
    }
  }
}

// Create singleton instance
const database = new Database();

module.exports = { database };
