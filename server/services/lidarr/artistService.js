/**
 * Business logic for artist operations in Lidarr
 * 
 * @module services/lidarr/ArtistService
 */

const lidarrConfig = require('../../config/lidarr');
const config = require('../../config');

class ArtistService {
  /**
   * Create artist service
   * @param {LidarrClient} client - HTTP client for Lidarr API
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Get all artists from Lidarr
   * @returns {Promise<Object[]>} Array of all artists
   */
  async getAll() {
    return this.client.get('artist');
  }

  /**
   * Find artist by MusicBrainz foreign artist ID
   * @param {string} foreignArtistId - MusicBrainz Artist ID
   * @returns {Promise<Object|null>} Artist object or null if not found
   */
  async findByMbid(foreignArtistId) {
    const artists = await this.getAll();
    return artists.find(a => a.foreignArtistId === foreignArtistId) || null;
  }

  /**
   * Get artist by Lidarr ID
   * @param {number} artistId - Lidarr artist ID
   * @returns {Promise<Object>} Artist object
   */
  async getById(artistId) {
    return this.client.get(`artist/${artistId}`);
  }

  /**
   * Get artist's root folder path
   * @param {number} artistId - Lidarr artist ID
   * @returns {Promise<string|null>} Root folder path or null if not found
   */
  async getRootFolder(artistId) {
    try {
      const artist = await this.getById(artistId);
      return artist?.rootFolderPath || null;
    } catch (error) {
      console.warn(`Could not get root folder for artist ${artistId}:`, error.message);
      return null;
    }
  }

  /**
   * Add new artist to Lidarr
   * @param {Object} artistInfo - Artist information from lookup
   * @param {string} artistInfo.foreignArtistId - MusicBrainz Artist ID
   * @param {string} artistInfo.artistName - Artist name
   * @param {Object} options - Addition options
   * @param {string} options.customRootFolder - Custom root folder path (overrides default)
   * @param {boolean} options.monitored - Whether artist should be monitored
   * @param {string} options.monitorNewItems - Monitor new items setting
   * @param {boolean} options.searchForMissingAlbums - Whether to search immediately
   * @returns {Promise<Object>} Added artist object
   */
  async add(artistInfo, options = {}) {
    const {
      customRootFolder = null,
      monitored = true,
      monitorNewItems = 'none',
      searchForMissingAlbums = false
    } = options;

    const rootFolderPath = customRootFolder || config.lidarr.rootFolder;

    const artistData = {
      foreignArtistId: artistInfo.foreignArtistId,
      artistName: artistInfo.artistName,
      qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
      metadataProfileId: 1,
      rootFolderPath,
      monitored,
      monitorNewItems,
      addOptions: {
        monitor: 'None',
        searchForMissingAlbums
      }
    };

    return this.client.post('artist', artistData);
  }

  /**
   * Trigger artist metadata refresh
   * Forces Lidarr to update artist information from MusicBrainz
   * 
   * @param {number|number[]} artistIds - Single ID or array of artist IDs
   * @returns {Promise<boolean>} True if refresh triggered successfully
   */
  async triggerRefresh(artistIds) {
    const ids = Array.isArray(artistIds) ? artistIds : [artistIds];
    
    try {
      await this.client.post('command', {
        name: 'RefreshArtist',
        artistIds: ids
      }, lidarrConfig.timeouts.refresh);
      
      return true;
    } catch (error) {
      console.error('Artist refresh failed:', error.message);
      return false;
    }
  }

  /**
   * Poll for album to appear in artist's discography after refresh
   * Uses smart polling with configurable interval and max attempts
   * 
   * @param {number} artistId - Lidarr artist ID
   * @param {string} targetMbid - MusicBrainz Release Group ID to wait for
   * @param {AlbumService} albumService - Album service instance for checking discography
   * @returns {Promise<Object|null>} Album object when found, or null if timeout
   */
  async waitForAlbumRefresh(artistId, targetMbid, albumService) {
    const startTime = Date.now();
    const { interval, maxAttempts } = lidarrConfig.polling;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const albums = await albumService.getByArtistId(artistId);
      const found = albumService.findInDiscography(albums, targetMbid);

      if (found) {
        const elapsed = Date.now() - startTime;
        console.log(`✅ Album appeared after ${elapsed}ms (${attempt + 1} attempts)`);
        return found;
      }

      // Don't wait after last attempt
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    const elapsed = Date.now() - startTime;
    console.warn(`⏱️ Album not found after ${elapsed}ms (${maxAttempts} attempts)`);
    return null;
  }

  /**
   * Find artist by name using fuzzy matching
   * Useful when MBID is not available
   * 
   * @param {string} searchName - Artist name to search for
   * @returns {Promise<Object|null>} Artist object or null if not found
   */
  async findByName(searchName) {
    const artists = await this.getAll();
    const normalized = searchName.toLowerCase().trim();
    
    return artists.find(artist => {
      const name = artist.artistName.toLowerCase().trim();
      return name === normalized || 
             name.includes(normalized) || 
             normalized.includes(name);
    }) || null;
  }
}

module.exports = { ArtistService };