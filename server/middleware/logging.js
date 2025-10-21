// server/middleware/logging.js - Updated with preferences support
const { database } = require('../services/database');
const { getUserId } = require('../services/queue');

function createLoggingMiddleware() {
  return (req, res, next) => {
    // ONLY log specific endpoints per requirements
    const shouldLog = (
      req.path === '/api/musicbrainz/recording' ||
      req.path === '/api/musicbrainz/release-group' ||
      req.path === '/api/musicbrainz/release-group/stream' ||
      req.path === '/api/lidarr/add' ||
      req.path === '/api/log-search'
    );

    if (!shouldLog) {
      return next();
    }

    // Set global request context for cache hit detection
    global.currentRequest = { req, res };

    // Capture start time
    const startTime = Date.now();
    
    // Store original res.json to intercept response data
    const originalJson = res.json;
    let responseData = null;
    let cacheHit = false;

    // Override res.json to capture response data
    res.json = function(data) {
      responseData = data;
	  res.locals.responseData = data;
      cacheHit = res.locals.cacheHit || false;
      return originalJson.call(this, data);
    };

    // Log after response is sent
    res.on('finish', async () => {
      try {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
	  
        console.log(`🔍 Response finished for: ${req.originalUrl}, calling log function`);
	  
        // Only log musicbrainz recording searches - use originalUrl for full path
        if (req.originalUrl.includes('/api/musicbrainz/recording')) {
          console.log(`🔍 logMusicBrainzRecordingQuery called for: ${req.originalUrl}`);
          await logMusicBrainzRecordingQuery(req, res, responseTime);
        }
	    
	    // Log musicbrainz release-group searches (artist browsing)
        if (req.originalUrl.includes('/api/musicbrainz/release-group')) {
          console.log(`📝 logMusicBrainzReleaseGroupQuery called for: ${req.originalUrl}`);
          await logMusicBrainzReleaseGroupQuery(req, res, responseTime);
        }
        
      } catch (error) {
        console.error('⚠️ Error in logging middleware:', error.message);
      } finally {
        global.currentRequest = null;
      }
    });

    next();
  };
}

async function logMusicBrainzRecordingQuery(req, res, responseTime) {
  const query = req.query.query;
  if (!query) return; // No query to log
  
  // responseData was captured in res.json override
  const results = res.locals.responseData?.recordings || [];
  
  const searchQuery = decodeURIComponent(query);
  
  // Parse queries like: recording:"song name" AND artistname:"artist name"
  let artist = null;
  let searchTerm = null;
  
  const recordingMatch = searchQuery.match(/recording:"([^"]+)"/);
  const artistMatch = searchQuery.match(/artistname:"([^"]+)"/);
  
  if (recordingMatch && artistMatch) {
    searchTerm = recordingMatch[1];
    artist = artistMatch[1];
  } else {
    searchTerm = searchQuery;
  }
  
  if (results.length > 0) {
    const first = results[0]; // or loop / join if you want multiple
    searchTerm = first.title || null;

    if (first["artist-credit"]?.length > 0) {
      artist = first["artist-credit"]
        .map(ac => ac.name)   // MusicBrainz capitalization preserved
        .join(", ");
    }
  }
  console.log('$(artist)');

  // Get user information
  const userId = getUserId(req);
  const userInfo = req.session?.user?.claims;
  
  const logData = {
    userId: userId,
    username: userInfo?.preferred_username || userInfo?.name || userInfo?.username || null,
    email: userInfo?.email || null,
    endpoint: '/api/musicbrainz/recording',
    method: req.method,
    searchTerm: searchTerm,
    artist: artist,
    responseStatus: res.statusCode,
    responseTime: responseTime,
    cacheHit: res.locals.cacheHit || false,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    searchType: 'musicbrainz_recording_search',
	metadata: null
  };

  await database.logQuery(logData);
}

async function logMusicBrainzReleaseGroupQuery(req, res, responseTime) {
  const query = req.query.query;
  const artistParam = req.query.artist;
  const limit = req.query.limit;
  const categories = req.query.categories;
  
  if (!query && !artistParam ) return; // No search to log
  
  // Extract artist name from query or use direct artist parameter
  let artistName = artistParam ;
  
  // Prefer API response capitalization if available
  const results = res.locals.responseData?.["release-groups"] || [];
  
  if (results.length > 0 && results[0]["artist-credit"]?.length > 0) {
    artistName = results[0]["artist-credit"]
      .map(ac => ac.name)  // Proper MusicBrainz casing
      .join(", ");
  } else {
    // Fallback to parsing query if API response missing
    if (!artistName && query) {
      const artistMatch = query.match(/artist:"([^"]+)"/);
      if (artistMatch) {
        artistName = artistMatch[1];
      } else {
        artistName = query; // Fallback to full query
      }
    }
  }

  // Get user information
  const userId = getUserId(req);
  const userInfo = req.session?.user?.claims;
  
  const debug = false;
  if (debug) {
    console.log('🔍 Release group session debug:', {
      hasSession: !!req.session,
      hasUser: !!req.session?.user,
      hasClaims: !!req.session?.user?.claims,
      userInfoKeys: userInfo ? Object.keys(userInfo) : 'none',
      userId: userId
    });
  }
  
  // Build search preferences info for logging
  const searchPreferences = {
    limit: limit || 50,
    categories: categories || 'all'
  };
  
  const logData = {
    userId: userId,
    username: userInfo?.preferred_username || userInfo?.name || null,
    email: userInfo?.email || null,
    endpoint: '/api/musicbrainz/release-group',
    method: req.method,
    searchTerm: null, // No specific search term for artist browsing
    artist: artistName,
    album: null,
    responseStatus: res.statusCode,
    responseTime: responseTime,
    cacheHit: res.locals.cacheHit || false,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    searchType: 'musicbrainz_artist_browse',
    // Store preferences as additional metadata
    metadata: JSON.stringify(searchPreferences)
  };

  await database.logQuery(logData);
}

// Helper function to mark cache hits
function markCacheHit(res) {
  res.locals.cacheHit = true;
}

module.exports = {
  createLoggingMiddleware,
  markCacheHit
};
