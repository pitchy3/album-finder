/**
 * Centralized logging for Lidarr operations
 * Eliminates ~150 lines of duplicated database logging code
 * 
 * @module services/lidarr/LidarrLogger
 */

const { database } = require('../database');
const { getUsername } = require('../queue');

class LidarrLogger {
  /**
   * Create a new logger instance for a request
   * @param {Object} req - Express request object
   */
  constructor(req) {
    const userInfo = req.session?.user?.claims;
    
    // Extract common fields once
    this.baseData = {
      userId: getUsername(req),
      username: userInfo?.preferred_username || userInfo?.name || null,
      email: userInfo?.email || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };
  }

  /**
   * Log album addition attempt
   * @param {Object} albumData - Album-specific data
   * @param {Object} options - Logging options
   * @param {boolean} options.success - Whether operation succeeded
   * @param {Error} options.error - Error object if failed
   * @param {Object} options.requestData - Original request data for context
   */
  async logAlbum(albumData, options = {}) {
    const {
      success = true,
      error = null,
      requestData = {}
    } = options;

    return database.logAlbumAddition({
      ...this.baseData,
      ...albumData,
      success,
      errorMessage: error?.message || null,
      requestData: JSON.stringify(requestData),
      downloaded: false
    });
  }

  /**
   * Log artist addition attempt
   * @param {Object} artistData - Artist-specific data
   * @param {Object} options - Logging options
   * @param {boolean} options.success - Whether operation succeeded
   * @param {Error} options.error - Error object if failed
   * @param {Object} options.requestData - Original request data for context
   */
  async logArtist(artistData, options = {}) {
    const {
      success = true,
      error = null,
      requestData = {}
    } = options;

    return database.logArtistAddition({
      ...this.baseData,
      ...artistData,
      success,
      errorMessage: error?.message || null,
      requestData: JSON.stringify(requestData)
    });
  }

  /**
   * Build album data object from various sources
   * Handles merging data from album, artist, and override options
   * 
   * @param {Object} album - Album object from Lidarr
   * @param {Object} artist - Artist object from Lidarr
   * @param {Object} options - Override values
   * @returns {Object} Normalized album data for database
   */
  static buildAlbumData(album, artist, options = {}) {
    return {
      albumTitle: album?.title || options.albumTitle || null,
      albumMbid: album?.foreignAlbumId || options.albumMbid || null,
      artistName: artist?.artistName || options.artistName || null,
      artistMbid: artist?.foreignArtistId || options.artistMbid || null,
      lidarrAlbumId: album?.id || options.lidarrAlbumId || null,
      lidarrArtistId: artist?.id || album?.artistId || options.lidarrArtistId || null,
      releaseDate: album?.releaseDate || options.releaseDate || null,
      rootFolderUsed: artist?.path || options.rootFolderUsed || null,
      monitored: album?.monitored ?? options.monitored ?? true,
      searchTriggered: options.searchTriggered ?? false
    };
  }

  /**
   * Build artist data object from artist and override options
   * 
   * @param {Object} artist - Artist object from Lidarr
   * @param {Object} options - Override values
   * @returns {Object} Normalized artist data for database
   */
  static buildArtistData(artist, options = {}) {
    return {
      artistName: artist?.artistName || options.artistName || null,
      artistMbid: artist?.foreignArtistId || options.artistMbid || null,
      lidarrArtistId: artist?.id || options.lidarrArtistId || null,
      qualityProfileId: options.qualityProfileId || null,
      rootFolder: artist?.path || options.rootFolder || null,
      monitored: artist?.monitored ?? options.monitored ?? true
    };
  }
}

module.exports = { LidarrLogger };