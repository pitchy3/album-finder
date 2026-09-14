// server/middleware/logging.js - Updated with preferences support
const { database } = require('../services/database');
const { getAuthenticatedUser, getUserId } = require('../services/queue');

function createLoggingMiddleware() {
  return (req, res, next) => {
    const shouldLog = (
      req.path === '/api/musicbrainz/recording' ||
      req.path === '/api/musicbrainz/release-group' ||
      req.path === '/api/musicbrainz/release-group/stream' ||
      req.path === '/api/lidarr/add' ||
      req.path === '/api/log-search'
    );

    if (!shouldLog) return next();

    global.currentRequest = { req, res };
    const startTime = Date.now();
    const originalJson = res.json;

    res.json = function(data) {
      res.locals.responseData = data;
      return originalJson.call(this, data);
    };

    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - startTime;
        if (req.originalUrl.includes('/api/musicbrainz/recording')) {
          await logMusicBrainzRecordingQuery(req, res, responseTime);
        }
        if (req.originalUrl.includes('/api/musicbrainz/release-group')) {
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
  if (!query) return;

  const results = res.locals.responseData?.recordings || [];
  const searchQuery = decodeURIComponent(query);
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
    const first = results[0];
    searchTerm = first.title || null;
    if (first["artist-credit"]?.length > 0) {
      artist = first["artist-credit"].map(ac => ac.name).join(", ");
    }
  }

  const userId = getUserId(req);
  const userInfo = getAuthenticatedUser(req)?.claims;

  await database.logQuery({
    userId,
    username: userInfo?.preferred_username || userInfo?.name || userInfo?.username || null,
    email: userInfo?.email || null,
    endpoint: '/api/musicbrainz/recording',
    method: req.method,
    searchTerm,
    artist,
    responseStatus: res.statusCode,
    responseTime,
    cacheHit: res.locals.cacheHit || false,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    searchType: 'musicbrainz_recording_search',
    metadata: null
  });
}

async function logMusicBrainzReleaseGroupQuery(req, res, responseTime) {
  const query = req.query.query;
  const artistParam = req.query.artist;
  const limit = req.query.limit;
  const categories = req.query.categories;

  if (!query && !artistParam) return;

  let artistName = artistParam;
  const results = res.locals.responseData?.["release-groups"] || [];

  if (results.length > 0 && results[0]["artist-credit"]?.length > 0) {
    artistName = results[0]["artist-credit"].map(ac => ac.name).join(", ");
  } else if (!artistName && query) {
    const artistMatch = query.match(/artist:"([^"]+)"/);
    artistName = artistMatch ? artistMatch[1] : query;
  }

  const userId = getUserId(req);
  const userInfo = getAuthenticatedUser(req)?.claims;
  const searchPreferences = {
    limit: limit || 50,
    categories: categories || 'all'
  };

  await database.logQuery({
    userId,
    username: userInfo?.preferred_username || userInfo?.name || null,
    email: userInfo?.email || null,
    endpoint: '/api/musicbrainz/release-group',
    method: req.method,
    searchTerm: null,
    artist: artistName,
    album: null,
    responseStatus: res.statusCode,
    responseTime,
    cacheHit: res.locals.cacheHit || false,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    searchType: 'musicbrainz_artist_browse',
    metadata: JSON.stringify(searchPreferences)
  });
}

function markCacheHit(res) {
  res.locals.cacheHit = true;
}

module.exports = {
  createLoggingMiddleware,
  markCacheHit
};
