/**
 * Orchestrates complex album addition workflows
 * Coordinates between AlbumService, ArtistService, and LidarrLogger
 * Eliminates 100+ line functions in route handlers
 * 
 * @module services/lidarr/AlbumOrchestrator
 */

const { LidarrLogger } = require('./lidarrLogger');
const config = require('../../config');

class AlbumOrchestrator {
  /**
   * Create orchestrator
   * @param {AlbumService} albumService - Album operations service
   * @param {ArtistService} artistService - Artist operations service
   * @param {LidarrLogger} logger - Database logger instance
   */
  constructor(albumService, artistService, logger) {
    this.albumService = albumService;
    this.artistService = artistService;
    this.logger = logger;
  }

  /**
   * Add a selected album using Lidarr's native album-add workflow. This
   * returns as soon as Lidarr accepts the album; metadata refresh and search
   * continue inside Lidarr.
   *
   * @param {Object} album - Album lookup resource
   * @param {Object|null} existingArtist - Existing Lidarr artist, if any
   * @param {Object} requestData - Original request data for logging
   * @returns {Promise<Object>} Accepted operation result
   */
  async addAlbum(album, existingArtist, requestData) {
    const artistCreated = !existingArtist;
    const artist = existingArtist || await this.artistService.prepareForAlbumAddition(
      album.artist,
      { customRootFolder: requestData.rootFolder }
    );

    const albumToAdd = {
      ...album,
      artist,
      monitored: true,
      addOptions: {
        ...(album.addOptions || {}),
        // Search only after AlbumReconciler verifies that the artist refresh
        // can no longer overwrite this album's monitored state.
        searchForNewAlbum: false
      }
    };

    console.log(`➕ Adding album through Lidarr's native album endpoint: ${album.title}`);
    const addedAlbum = await this.albumService.add(albumToAdd);
    const addedArtist = addedAlbum.artist || existingArtist || artist;

    if (artistCreated) {
      await this.safeLog('artist', LidarrLogger.buildArtistData(addedArtist, {
        artistName: artist.artistName,
        artistMbid: artist.foreignArtistId,
        qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
        rootFolder: requestData.rootFolder || config.lidarr.rootFolder,
        monitored: false
      }), requestData);
    }

    const albumLog = await this.safeLog('album', LidarrLogger.buildAlbumData(addedAlbum, addedArtist, {
      albumTitle: requestData.title,
      albumMbid: requestData.mbid,
      artistName: requestData.artist,
      monitored: false,
      searchTriggered: false,
      operationState: 'reconciling'
    }), requestData);

    return {
      success: true,
      state: 'queued',
      id: addedArtist.id,
      artistId: addedArtist.id,
      artistCreated,
      title: addedAlbum.title || requestData.title,
      artist: addedArtist.artistName || requestData.artist,
      albumId: addedAlbum.id,
      monitored: true,
      searchTriggered: false,
      searchRequested: true,
      reconciliationQueued: true,
      activityId: albumLog?.lastID || null,
      percentComplete: 0,
      message: `\"${addedAlbum.title || requestData.title}\" by \"${addedArtist.artistName || requestData.artist}\" added and search queued`
    };
  }

  /**
   * Monitor album and trigger search if needed
   * Final step in album addition workflow
   * 
   * @param {Object} album - Album object from Lidarr
   * @param {Object} artist - Artist object from Lidarr
   * @param {Object} requestData - Original request data for logging
   * @returns {Promise<Object>} Success response
   */
  async monitorAndSearchAlbum(album, artist, requestData) {
    // Update monitoring if needed
    if (!album.monitored) {
      console.log(`👁️ Enabling monitoring for ${album.title}`);
      await this.albumService.updateMonitoring(album, true);
      album.monitored = true;
    }

    // Trigger search if not complete
    const percentComplete = album.statistics?.percentOfTracks || 0;
    const searchTriggered = percentComplete < 100 
      ? await this.albumService.triggerSearchStrict(album.id)
      : false;

    if (searchTriggered) {
      console.log(`🔍 Search triggered for ${album.title}`);
    } else if (percentComplete === 100) {
      console.log(`✅ Album ${album.title} already complete`);
    }

    // Log success to database
    const albumData = LidarrLogger.buildAlbumData(album, artist, {
      monitored: true,
      searchTriggered
    });

    await this.safeLog('album', albumData, requestData);

    // Return success response
    const statusMsg = searchTriggered
      ? 'added and search triggered'
      : percentComplete === 100 
        ? 'already complete' 
        : 'added successfully';

    return {
      success: true,
      state: percentComplete === 100 ? 'complete' : 'queued',
      id: artist.id,
      artistId: artist.id,
      artistCreated: false,
      title: album.title,
      artist: artist.artistName,
      message: `"${album.title}" by "${artist.artistName}" ${statusMsg}`,
      albumId: album.id,
      monitored: album.monitored,
      searchTriggered,
      percentComplete
    };
  }

  async safeLog(type, data, requestData) {
    try {
      if (type === 'artist') {
        return await this.logger.logArtist(data, { success: true, requestData });
      } else {
        return await this.logger.logAlbum(data, { success: true, requestData });
      }
    } catch (error) {
      console.warn(`Failed to record ${type} addition log:`, error.message);
      return null;
    }
  }

}

module.exports = { AlbumOrchestrator };
