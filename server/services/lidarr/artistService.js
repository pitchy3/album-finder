/**
 * Business logic for artist operations in Lidarr
 * 
 * @module services/lidarr/ArtistService
 */

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
   * Configure a lookup artist for Lidarr's native album-add endpoint.
   * Album Finder monitors only the selected album, not the whole artist.
   *
   * @param {Object} artistInfo - Artist resource nested in an album lookup
   * @param {Object} options - Addition options
   * @param {string|null} options.customRootFolder - Selected root folder
   * @returns {Promise<Object>} Artist resource configured for addition
   */
  async prepareForAlbumAddition(artistInfo, options = {}) {
    const rootFolderPath = options.customRootFolder || config.lidarr.rootFolder;
    const rootFolders = await this.client.get('rootfolder');
    const selectedRoot = Array.isArray(rootFolders)
      ? rootFolders.find(folder => folder.path === rootFolderPath)
      : null;

    let metadataProfileId = selectedRoot?.defaultMetadataProfileId;

    if (!metadataProfileId) {
      const metadataProfiles = await this.client.get('metadataProfile');
      const noneProfile = Array.isArray(metadataProfiles)
        ? metadataProfiles.find(profile => profile.name?.toLowerCase() === 'none')
        : null;
      metadataProfileId = noneProfile?.id || metadataProfiles?.[0]?.id;
    }

    if (!metadataProfileId) {
      throw new Error('Lidarr has no metadata profile available for the new artist');
    }

    return {
      ...artistInfo,
      rootFolderPath,
      qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
      metadataProfileId,
      monitored: false,
      monitorNewItems: 'none',
      addOptions: {
        monitor: 'none',
        searchForMissingAlbums: false
      }
    };
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
