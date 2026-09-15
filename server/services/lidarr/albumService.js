/**
 * Business logic for album operations in Lidarr
 * 
 * @module services/lidarr/AlbumService
 */

class AlbumService {
  /**
   * Create album service
   * @param {LidarrClient} client - HTTP client for Lidarr API
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * Look up album by MusicBrainz ID
   * Enriches result with library status and download statistics
   * 
   * @param {string} mbid - MusicBrainz Release Group ID
   * @returns {Promise<Object|null>} Album data with enhanced status info, or null if not found
   */
  async lookupByMbid(mbid) {
    const data = await this.client.get('album/lookup', { 
      term: `lidarr:${encodeURIComponent(mbid)}` 
    });

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const album = data[0];

    // If album exists in library, get detailed statistics
    if (album.id) {
      try {
        const details = await this.getById(album.id);
        return {
          ...album,
          ...details,
          grabbed: details.statistics?.percentOfTracks === 100
        };
      } catch (error) {
        console.warn(`Could not get album details for ${album.id}:`, error.message);
      }
    }

    return {
      ...album,
      grabbed: false
    };
  }

  /**
   * Get album by Lidarr ID
   * @param {number} albumId - Lidarr album ID
   * @returns {Promise<Object|null>} Album data with enriched status, or null if not found
   */
  async getById(albumId) {
    try {
      const album = await this.client.get(`album/${albumId}`);
      return this.enrichAlbumStatus(album);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search for album in library by foreignAlbumId
   * @param {string} mbid - MusicBrainz Release Group ID
   * @returns {Promise<Object|null>} Album data if found in library
   */
  async findInLibrary(mbid) {
    try {
      const results = await this.client.get('album', { 
        foreignAlbumId: encodeURIComponent(mbid) 
      });

      if (Array.isArray(results) && results.length > 0) {
        return this.enrichAlbumStatus(results[0]);
      }

      return null;
    } catch (error) {
      console.warn('Library search failed:', error.message);
      return null;
    }
  }

  /**
   * Search for an album in the library without suppressing Lidarr errors.
   * This is used before mutations so a temporary read failure cannot turn
   * into a duplicate add attempt.
   *
   * @param {string} mbid - MusicBrainz Release Group ID
   * @returns {Promise<Object|null>} Album data if found in the library
   */
  async findInLibraryStrict(mbid) {
    const results = await this.client.get('album', {
      foreignAlbumId: encodeURIComponent(mbid)
    });

    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    return this.enrichAlbumStatus(results[0]);
  }

  /**
   * Add a selected album through Lidarr's native album endpoint. Lidarr will
   * create the nested artist when necessary and perform its refresh/search
   * workflow asynchronously.
   *
   * @param {Object} album - Album lookup resource configured for addition
   * @returns {Promise<Object>} Added album resource
   */
  async add(album) {
    return this.client.post('album', album);
  }

  /**
   * Update album monitoring status
   * @param {Object} album - Album object to update
   * @param {boolean} monitored - Whether album should be monitored
   * @returns {Promise<Object>} Updated album data
   */
  async updateMonitoring(album, monitored = true) {
    album.monitored = monitored;
    return this.client.put(`album/${album.id}`, album);
  }

  /**
   * Trigger album search in download clients
   * @param {number|number[]} albumIds - Single ID or array of album IDs
   * @returns {Promise<boolean>} True if search triggered successfully
   */
  async triggerSearch(albumIds) {
    const ids = Array.isArray(albumIds) ? albumIds : [albumIds];
    
    try {
      await this.client.post('command', {
        name: 'AlbumSearch',
        albumIds: ids
      });
      return true;
    } catch (error) {
      console.error('Album search trigger failed:', error.message);
      return false;
    }
  }

  /**
   * Trigger an album search and propagate Lidarr errors to the caller.
   * Mutation workflows use this variant so a failed search cannot be
   * reported as a successful add.
   *
   * @param {number|number[]} albumIds - Single ID or array of album IDs
   * @returns {Promise<boolean>} True after Lidarr accepts the command
   */
  async triggerSearchStrict(albumIds) {
    const ids = Array.isArray(albumIds) ? albumIds : [albumIds];

    await this.client.post('command', {
      name: 'AlbumSearch',
      albumIds: ids
    });

    return true;
  }

  /**
   * Check whether Lidarr is still running or waiting to run an artist refresh.
   * Album mutations made during that refresh can be overwritten by the
   * refresh's monitoring policy, so callers must reconcile after it is quiet.
   */
  async hasActiveArtistRefresh(artistId) {
    if (!artistId) return false;

    const response = await this.client.get('command', {
      page: 1,
      pageSize: 100,
      sortKey: 'queuedAt',
      sortDirection: 'descending'
    });
    const commands = Array.isArray(response) ? response : response?.records || [];
    const activeStatuses = new Set(['queued', 'started', 'running']);

    return commands.some(command => {
      const name = (command.name || command.commandName || '').toLowerCase();
      const status = (command.status || '').toLowerCase();
      const body = command.body || {};
      const artistIds = Array.isArray(body.artistIds)
        ? body.artistIds
        : body.artistId != null
          ? [body.artistId]
          : [];

      return name === 'refreshartist' &&
        activeStatuses.has(status) &&
        artistIds.map(Number).includes(Number(artistId));
    });
  }

  /**
   * Enrich album with status information
   * Adds inLibrary, fullyAvailable, and percentComplete fields
   * 
   * @param {Object} album - Raw album data from Lidarr
   * @returns {Object} Album with enriched status fields
   */
  enrichAlbumStatus(album) {
    const percentOfTracks = album.statistics?.percentOfTracks || 0;
    const requested = album.monitored === true || percentOfTracks > 0;
    
    return {
      ...album,
      // Lidarr creates database rows for every release discovered during an
      // artist refresh. A row ID therefore means "known", not "requested".
      inLibrary: requested,
      fullyAvailable: percentOfTracks === 100,
      percentComplete: percentOfTracks
    };
  }

  /**
   * Get all albums for an artist
   * @param {number} artistId - Lidarr artist ID
   * @returns {Promise<Object[]>} Array of album objects
   */
  async getByArtistId(artistId) {
    return this.client.get('album', { artistId });
  }

  /**
   * Find specific album in artist's discography by MBID
   * @param {Object[]} albums - Array of album objects
   * @param {string} targetMbid - MusicBrainz Release Group ID to find
   * @returns {Object|undefined} Matching album or undefined
   */
  findInDiscography(albums, targetMbid) {
    return albums.find(album => 
      album.foreignAlbumId === targetMbid || 
      album.mbId === targetMbid
    );
  }

  /**
   * Get all albums for an artist with cover art URLs
   * Returns a Map for instant O(1) lookup by MBID
   * 
   * @param {number} lidarrArtistId - Lidarr artist ID
   * @returns {Promise<Map<string, Object>>} Map of MBID -> album data with cover art
   */
  async getAllWithCoverArt(lidarrArtistId) {
    const albums = await this.getByArtistId(lidarrArtistId);
    
    const albumsMap = new Map();
    
    albums.forEach(album => {
      if (!album.foreignAlbumId) return;

      const percentComplete = album.statistics?.percentOfTracks || 0;
      const requested = album.monitored === true || percentComplete > 0;
      
      // Extract cover art URL from Lidarr response
      let coverUrl = null;
      if (album.images?.length > 0) {
        const coverImage = album.images.find(img => img.coverType === 'cover') || album.images[0];
        coverUrl = coverImage?.remoteUrl || coverImage?.url || null;
      }
      
      albumsMap.set(album.foreignAlbumId, {
        inLibrary: requested,
        fullyAvailable: percentComplete === 100,
        percentComplete,
        lidarrId: album.id,
        monitored: album.monitored,
        title: album.title,
        trackCount: album.statistics?.trackCount || 0,
        trackFileCount: album.statistics?.trackFileCount || 0,
        coverUrl,
        albumType: album.albumType || 'Album',
        secondaryTypes: album.secondaryTypes || [],
        releaseDate: album.releaseDate || null
      });
    });
    
    return albumsMap;
  }
}

module.exports = { AlbumService };
