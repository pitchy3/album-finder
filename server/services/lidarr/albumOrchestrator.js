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
   * Handle album addition for existing artist
   * Checks if album exists in discography, refreshes if needed
   * 
   * @param {Object} artist - Existing artist object from Lidarr
   * @param {string} targetMbid - MusicBrainz Release Group ID
   * @param {Object} requestData - Original request data for logging
   * @returns {Promise<Object>} Operation result
   */
  async handleExistingArtist(artist, targetMbid, requestData) {
    console.log(`📀 Processing album for existing artist: ${artist.artistName}`);
    
    // Get artist's albums
    const albums = await this.albumService.getByArtistId(artist.id);
    let targetAlbum = this.albumService.findInDiscography(albums, targetMbid);

    // If not found, try refreshing artist metadata
    if (!targetAlbum) {
      console.log(`🔄 Album not found, triggering artist refresh for ${artist.artistName}`);
      
      await this.artistService.triggerRefresh(artist.id);
      targetAlbum = await this.artistService.waitForAlbumRefresh(
        artist.id, 
        targetMbid, 
        this.albumService
      );

      if (!targetAlbum) {
        return this.handleAlbumNotFound(artist, requestData);
      }
    }

    // Monitor and search for album
    return this.monitorAndSearchAlbum(targetAlbum, artist, requestData);
  }

  /**
   * Handle album addition for new artist
   * Adds artist to Lidarr, refreshes metadata, then adds album
   * 
   * @param {Object} artistInfo - Artist information from album lookup
   * @param {string} targetMbid - MusicBrainz Release Group ID
   * @param {Object} requestData - Original request data for logging
   * @returns {Promise<Object>} Operation result
   */
  async handleNewArtist(artistInfo, targetMbid, requestData) {
    const { rootFolder } = requestData;

    console.log(`➕ Adding new artist: ${artistInfo.artistName}`);
    
    // Add artist
    const addedArtist = await this.artistService.add(artistInfo, {
      customRootFolder: rootFolder
    });

    // Log artist addition
    const artistData = LidarrLogger.buildArtistData(addedArtist, {
      qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
      rootFolder: rootFolder || config.lidarr.rootFolder
    });
    
    await this.logger.logArtist(artistData, { 
      success: true, 
      requestData 
    });

    console.log(`🔄 Refreshing artist metadata to fetch discography`);
    
    // Trigger refresh and wait for album to appear
    await this.artistService.triggerRefresh(addedArtist.id);
    const targetAlbum = await this.artistService.waitForAlbumRefresh(
      addedArtist.id,
      targetMbid,
      this.albumService
    );

    if (!targetAlbum) {
      return this.handleAlbumNotFound(addedArtist, requestData);
    }

    // Monitor and search for album
    return this.monitorAndSearchAlbum(targetAlbum, addedArtist, requestData);
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
      ? await this.albumService.triggerSearch(album.id)
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

    await this.logger.logAlbum(albumData, {
      success: true,
      requestData
    });

    // Return success response
    const statusMsg = searchTriggered
      ? 'added and search triggered'
      : percentComplete === 100 
        ? 'already complete' 
        : 'added successfully';

    return {
      id: artist.id,
      title: album.title,
      artist: artist.artistName,
      message: `"${album.title}" by "${artist.artistName}" ${statusMsg}`,
      albumId: album.id,
      monitored: album.monitored,
      searchTriggered,
      percentComplete
    };
  }

  /**
   * Handle case where album not found in artist's discography after refresh
   * Logs failure and returns helpful error message
   * 
   * @param {Object} artist - Artist object from Lidarr
   * @param {Object} requestData - Original request data for logging
   * @returns {Promise<Object>} Failure response
   */
  async handleAlbumNotFound(artist, requestData) {
    console.warn(`⚠️ Album "${requestData.title}" not found in ${artist.artistName}'s discography`);
    
    const albumData = LidarrLogger.buildAlbumData(null, artist, {
      albumTitle: requestData.title,
      albumMbid: requestData.mbid,
      monitored: false,
      searchTriggered: false
    });

    await this.logger.logAlbum(albumData, {
      success: false,
      error: new Error('Album not found in artist discography after refresh'),
      requestData
    });

    return {
      id: artist.id,
      title: requestData.title,
      artist: artist.artistName,
      message: `Artist "${artist.artistName}" exists but album "${requestData.title}" not found in their discography. This may happen if:\n` +
               `• The album is not in MusicBrainz\n` +
               `• The album has different metadata\n` +
               `• The album is a compilation or various artists release\n\n` +
               `Try refreshing the artist manually in Lidarr or add the album directly through Lidarr's interface.`,
      success: false
    };
  }
}

module.exports = { AlbumOrchestrator };