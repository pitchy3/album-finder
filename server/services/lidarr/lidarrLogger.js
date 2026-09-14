/**
 * Centralized logging for Lidarr operations
 * Eliminates ~150 lines of duplicated database logging code
 * 
 * @module services/lidarr/LidarrLogger
 */

const { database } = require('../database');
const { getAuthenticatedUser, getUsername } = require('../queue');

class LidarrLogger {
  /**
   * Create a new logger instance for a request
   * @param {Object} req - Express request object
   */
  constructor(req) {
    const userInfo = getAuthenticatedUser(req)?.claims;

    this.baseData = {
      userId: getUsername(req),
      username: userInfo?.preferred_username || userInfo?.name || null,
      email: userInfo?.email || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };
  }

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
