// server/routes/api/lidarr.js - Fixed authentication for POST requests
const express = require("express");
const config = require("../../config");
const { ensureAuthenticated } = require("../../middleware/auth");
const { queuedApiCall, getUsername } = require("../../services/queue");
const { cachedFetch, getCacheKey, cache } = require("../../services/cache");
const { database } = require("../../services/database");
const { getDecryptedLidarrApiKey } = require("../../services/configEncryption");

const router = express.Router();

// Helper functions to reduce code duplication
const lidarrHelpers = {
  // Redact apikey from URL before printing in logs.
  redactApiKey(url) {
    try {
      const u = new URL(url);
      const params = u.searchParams;
  
      if (params.has("apikey")) {
        const apiKey = params.get("apikey");
        if (apiKey.length > 3) {
          // Mask everything except the last 3 characters
          const redacted = "***" + apiKey.slice(-3);
          params.set("apikey", redacted);
        } else {
          params.set("apikey", "***");
        }
      }
  
      return u.toString();
    } catch (err) {
      console.error("Invalid URL:", err);
      return url; // fallback
    }
  },
  
  // Build API URL with proper formatting
  buildApiUrl(endpoint, params = {}) {
    const baseUrl = config.lidarr.url.replace(/\/$/, "");
	const decryptedApiKey = getDecryptedLidarrApiKey(config);
    const queryParams = new URLSearchParams({
      ...params,
      apikey: decryptedApiKey
    });
    return `${baseUrl}/api/v1/${endpoint}?${queryParams}`;
  },

  // Standard API request with error handling and reduced lidarr timeout
  async apiRequest(url, options = {}) {
    // Check if URL already has apikey parameter
    const hasApiKeyInUrl = url.includes('apikey=');
    
    const headers = {
      "accept": "application/json",
      ...options.headers
    };
    
    // Only add X-Api-Key header if not already in URL
    if (!hasApiKeyInUrl) {
      headers["X-Api-Key"] = getDecryptedLidarrApiKey(config);
    }
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 6 second timeout, assumes local Lidarr
    
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        ...options
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
      }
      
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort/timeout error
      if (error.name === 'AbortError') {
        throw new Error(`Lidarr API timeout after 10 seconds for URL: ${url}`);
      }
      
      // Re-throw other errors
      throw error;
    }
  },

  // Validate required configuration
  validateConfig() {
    if (!config.lidarr.url || !config.lidarr.apiKey) {
      throw new Error("Lidarr URL/API key not configured");
    }
  },

  // Log with consistent formatting
  log(title, message, data = null) {
    const prefix = title ? `[${title}]` : '';
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  },

  // Create album result object with status flags
  createAlbumResult(album, inLibrary, percentComplete = 0) {
    return {
      ...album,
      inLibrary,
      fullyAvailable: percentComplete === 100,
      percentComplete
    };
  },

  // Lookup album by MBID
  async lookupAlbum(mbid, title) {
    this.log(title, "Looking up album metadata");
    const url = this.buildApiUrl("album/lookup", { term: `lidarr:${encodeURIComponent(mbid)}` });
    this.log(title, "Lookup URL:", lidarrHelpers.redactApiKey(url));
    
    const data = await this.apiRequest(url);
    this.log(title, "Lookup results count:", data.length);
    
    if (!Array.isArray(data) || data.length === 0) {
      this.log(title, "No album found in lookup");
      return null;
    }
    
    const album = data[0];
    
    // If album has an ID (exists in library), get detailed stats to calculate grabbed status
    if (album.id) {
      try {
        const albumDetails = await this.getAlbumDetails(album.id, title);
        if (albumDetails) {
          // Use the detailed album data which includes statistics
          const enhancedAlbum = {
            ...album,
            ...albumDetails,
            grabbed: albumDetails.statistics?.percentOfTracks === 100
          };
          
          this.log(title, "Found album in lookup with details:", {
            title: enhancedAlbum.title,
            foreignAlbumId: enhancedAlbum.foreignAlbumId,
            id: enhancedAlbum.id,
            monitored: enhancedAlbum.monitored,
            grabbed: enhancedAlbum.grabbed,
            percentOfTracks: enhancedAlbum.statistics?.percentOfTracks || 0,
            artistId: enhancedAlbum.artistId
          });
          
          return enhancedAlbum;
        }
      } catch (detailsError) {
        this.log(title, "Could not get album details, using lookup data:", detailsError.message);
      }
    }
    
    // Fallback: album not in library or details unavailable
    const albumWithGrabbed = {
      ...album,
      grabbed: false // Not in library or no completion data = not grabbed
    };
    
    this.log(title, "Found album in lookup:", {
      title: albumWithGrabbed.title,
      foreignAlbumId: albumWithGrabbed.foreignAlbumId,
      id: albumWithGrabbed.id || null,
      monitored: albumWithGrabbed.monitored,
      grabbed: albumWithGrabbed.grabbed,
      artistId: albumWithGrabbed.artistId
    });
    
    return albumWithGrabbed;
  },

  // Get album details by ID
  async getAlbumDetails(albumId, title) {
    this.log(title, `Getting album details for ID ${albumId}`);
    const url = this.buildApiUrl(`album/${albumId}`);
    
    try {
      const albumDetails = await this.apiRequest(url);
      this.log(title, "Album details retrieved successfully");
      
      const percentOfTracks = albumDetails.statistics?.percentOfTracks || 0;
      const trackCount = albumDetails.statistics?.trackCount || 0;
      const trackFileCount = albumDetails.statistics?.trackFileCount || 0;
      
      this.log(title, `Album found in library with ${percentOfTracks}% of tracks (${trackFileCount}/${trackCount} files)`);
      return this.createAlbumResult(albumDetails, true, percentOfTracks);
    } catch (error) {
      if (error.message.includes("404")) {
        this.log(title, "Album not found in library (404)");
        return null;
      }
      this.log(title, "Error checking album details:", error.message);
      return null;
    }
  },

  // Search for album in library by foreignAlbumId
  async searchAlbumInLibrary(mbid, title) {
    this.log(title, "Searching album in library by foreignAlbumId");
    const url = this.buildApiUrl("album", { foreignAlbumId: encodeURIComponent(mbid) });
    
    try {
      const results = await this.apiRequest(url);
      this.log(title, "Library search results count:", results.length);
      
      if (Array.isArray(results) && results.length > 0) {
        const album = results[0];
        const percentOfTracks = album.statistics?.percentOfTracks || 0;
        this.log(title, `Album found in library with ${percentOfTracks}% of tracks`);
        return this.createAlbumResult(album, true, percentOfTracks);
      }
      
      return null;
    } catch (error) {
      this.log(title, "Library search failed:", error.message);
      return null;
    }
  },

  // Get all artists from Lidarr
  async getAllArtists() {
    const url = this.buildApiUrl("artist");
    return this.apiRequest(url);
  },

  // Find existing artist by foreignArtistId
  async findExistingArtist(foreignArtistId, title) {
    this.log(title, "Checking if artist already exists");
    
    try {
      const allArtists = await this.getAllArtists();
      const existing = allArtists.find(a => a.foreignArtistId === foreignArtistId);
      
      if (existing) {
        this.log(title, "Artist already exists:", {
          name: existing.artistName,
          id: existing.id,
          foreignArtistId: existing.foreignArtistId
        });
      }
      
      return existing;
    } catch (error) {
      this.log(title, "Error checking existing artists:", error.message);
      return null;
    }
  },

  // Get albums for an artist
  async getArtistAlbums(artistId) {
    const url = this.buildApiUrl("album", { artistId });
    return this.apiRequest(url);
  },

  // Update album monitoring status
  async updateAlbumMonitoring(album, monitored = true) {
    album.monitored = monitored;
    
    // Use query parameter authentication for PUT requests
    const url = this.buildApiUrl(`album/${album.id}`); // This includes apikey in query
    
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "accept": "application/json"
          // Don't include X-Api-Key header since it's in the URL
        },
        body: JSON.stringify(album)
      });
  
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
      }
  
      return await response.json();
    } catch (error) {
      console.error("Failed to update album monitoring:", error.message);
      throw error;
    }
  },

  // Trigger album search - FIXED: Use proper authentication
  async triggerAlbumSearch(albumIds, title) {
    this.log(title, "Triggering search for album(s):", albumIds);
  
    // Use query parameter authentication
    const url = this.buildApiUrl("command"); // This includes apikey in query
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "accept": "application/json"
          // Don't include X-Api-Key header since it's in the URL
        },
        body: JSON.stringify({
          name: "AlbumSearch",
          albumIds: Array.isArray(albumIds) ? albumIds : [albumIds]
        })
      });
  
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
      }
  
      this.log(title, "Album search triggered successfully");
      return true;
    } catch (error) {
      this.log(title, "Album search trigger failed:", error.message);
      return false;
    }
  },

  // Trigger artist refresh - FIXED: Use proper authentication with query param fallback
  async triggerArtistRefresh(artistIds, title) {
    this.log(title, "Triggering artist refresh");
    
    // Use query parameter authentication
    const url = this.buildApiUrl("command"); // This includes apikey in query
    
	// Create AbortController for timeout
    const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 30000);
	
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "accept": "application/json"
          // Don't include X-Api-Key header since it's in the URL
        },
        body: JSON.stringify({
          name: "RefreshArtist",
          artistIds: Array.isArray(artistIds) ? artistIds : [artistIds]
        })
      });
	  
	  clearTimeout(timeoutId);
  
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
      }
      
      this.log(title, "Artist refresh triggered successfully");
      return true;
    } catch (error) {
	  clearTimeout(timeoutId);
      this.log(title, "Artist refresh failed:", error.message);
      return false;
    }
  },

  // Add artist to Lidarr - FIXED: Use proper authentication
  async addArtist(artistInfo, title, customRootFolder = null) {
    this.log(title, "Adding artist to Lidarr");
	
	// Use custom root folder if provided, otherwise use default
    const rootFolderPath = customRootFolder || config.lidarr.rootFolder;
  
    this.log(title, `Using root folder: ${rootFolderPath}${customRootFolder ? ' (custom)' : ' (default)'}`);
    
    const artistData = {
      foreignArtistId: artistInfo.foreignArtistId,
      artistName: artistInfo.artistName,
      qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
      metadataProfileId: 1,
      rootFolderPath: rootFolderPath,
      monitored: true,
      monitorNewItems: "none",
      addOptions: {
        monitor: "None",
        searchForMissingAlbums: false
      }
    };
  
    // Use query parameter authentication (more reliable)
    const url = this.buildApiUrl("artist"); // This includes apikey in query
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "accept": "application/json"
          // Don't include X-Api-Key header since it's in the URL
        },
        body: JSON.stringify(artistData)
      });
  
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
      }
  
      const addedArtist = await response.json();
      
      this.log(title, "Artist added successfully:", {
        id: addedArtist.id,
        name: addedArtist.artistName,
        monitored: addedArtist.monitored
      });
  
      return addedArtist;
    } catch (error) {
      this.log(title, "Artist addition failed:", error.message);
      throw error;
    }
  },

  // Find target album in artist's discography
  findTargetAlbum(albums, mbid) {
    return albums.find(album => 
      album.foreignAlbumId === mbid || 
      album.mbId === mbid
    );
  },
  
  // Get artist by MusicBrainz ID
  async getArtistByMbid(artistMbid) {
    try {
      this.log("GET_ARTIST", `Checking for artist with MBID: ${artistMbid}`);
      const allArtists = await this.getAllArtists();
      const artist = allArtists.find(a => a.foreignArtistId === artistMbid);
      
      if (artist) {
        this.log("GET_ARTIST", "Artist found:", {
          id: artist.id,
          name: artist.artistName,
          foreignArtistId: artist.foreignArtistId,
          monitored: artist.monitored
        });
        return artist;
      }
      
      this.log("GET_ARTIST", "Artist not found in Lidarr");
      return null;
    } catch (error) {
      this.log("GET_ARTIST", "Error finding artist:", error.message);
      return null;
    }
  },
  
  /**
   * Get the root folder path for an existing artist
   * @param {number} artistId - Lidarr artist ID
   * @returns {Promise<string|null>} Root folder path or null if not found
   */
  async getArtistRootFolder(artistId) {
    try {
      this.log("GET_ROOT_FOLDER", `Getting root folder for artist ID: ${artistId}`);
      
      const url = this.buildApiUrl(`artist/${artistId}`);
      const artistData = await this.apiRequest(url);
      
      if (artistData && artistData.rootFolderPath) {
        this.log("GET_ROOT_FOLDER", `Found root folder: ${artistData.rootFolderPath}`);
        return artistData.rootFolderPath;
      }
      
      this.log("GET_ROOT_FOLDER", "Root folder not found in artist data");
      return null;
    } catch (error) {
      this.log("GET_ROOT_FOLDER", "Error getting root folder:", error.message);
      return null;
    }
  },
  
  // Get all albums for an artist with their download status AND cover art
  async getAllAlbumsForArtist(lidarrArtistId) {
    try {
      this.log("GET_ALBUMS", `Fetching all albums for artist ID: ${lidarrArtistId}`);
      
      const url = this.buildApiUrl("album", { artistId: lidarrArtistId });
      const albums = await this.apiRequest(url);
      
      this.log("GET_ALBUMS", `Retrieved ${albums.length} albums from Lidarr`);
      
      // Build a map of MBID -> album status + cover art for instant lookup
      const albumsMap = new Map();
      
      albums.forEach(album => {
        if (album.foreignAlbumId) {
          const percentComplete = album.statistics?.percentOfTracks || 0;
          
          // ✅ Extract cover art URL from Lidarr response
          let coverUrl = null;
          if (album.images && album.images.length > 0) {
            // Lidarr returns images array with coverType property
            const coverImage = album.images.find(img => img.coverType === 'cover') || album.images[0];
            coverUrl = coverImage?.remoteUrl || coverImage?.url || null;
          }
          
          albumsMap.set(album.foreignAlbumId, {
            inLibrary: true,
            fullyAvailable: percentComplete === 100,
            percentComplete: percentComplete,
            lidarrId: album.id,
            monitored: album.monitored,
            title: album.title,
            trackCount: album.statistics?.trackCount || 0,
            trackFileCount: album.statistics?.trackFileCount || 0,
            coverUrl: coverUrl,
            albumType: album.albumType || 'Album',
            secondaryTypes: album.secondaryTypes || [],
            releaseDate: album.releaseDate || null
          });
        }
      });
      
      const coversFound = Array.from(albumsMap.values()).filter(a => a.coverUrl).length;
      this.log("GET_ALBUMS", `Mapped ${albumsMap.size} albums (${coversFound} with covers) by MBID for instant lookup`);
      
      return albumsMap;
      
    } catch (error) {
      this.log("GET_ALBUMS", "Error fetching albums:", error.message);
      throw error;
    }
  }
  
};

// Lidarr lookup endpoint
router.get("/lookup", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { mbid, title, artist } = req.query;
    if (!mbid) throw new Error("Missing 'mbid' query param");
    
    lidarrHelpers.validateConfig();
    lidarrHelpers.log("LOOKUP START", `Processing album: ${title} by ${artist} (MBID: ${mbid})`);

    return await cachedFetch('lidarr', { mbid, title, artist }, async () => {
      // Step 1: MBID lookup to get album metadata
      const album = await lidarrHelpers.lookupAlbum(mbid, title);
      if (!album) return [];

      // Step 2: Check if album exists in library
      if (album.id) {
        const libraryResult = await lidarrHelpers.getAlbumDetails(album.id, title);
        if (libraryResult) return [libraryResult];
      }

      // Album not in library
      lidarrHelpers.log(title, "Album not in library");
      return [lidarrHelpers.createAlbumResult(album, false, 0)];
    }, 5 * 60 * 1000);
  });
});

// Alternative method using foreignAlbumId search
router.get("/lookup-search", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { mbid, title, artist } = req.query;
    if (!mbid) throw new Error("Missing 'mbid' query param");
    
    lidarrHelpers.validateConfig();
    lidarrHelpers.log("SEARCH METHOD", `Processing album: ${title} by ${artist} (MBID: ${mbid})`);

    return await cachedFetch('lidarr-search', { mbid, title, artist }, async () => {
      // Try library search first
      const libraryResult = await lidarrHelpers.searchAlbumInLibrary(mbid, title);
      if (libraryResult) return [libraryResult];

      // Not in library, get metadata from lookup
      lidarrHelpers.log(title, "Album not in library, getting metadata from lookup");
      const album = await lidarrHelpers.lookupAlbum(mbid, title);
      
      return album ? [lidarrHelpers.createAlbumResult(album, false, 0)] : [];
    }, 5 * 60 * 1000);
  });
});

/**
 * POST /api/lidarr/add
 * 
 * Add album to Lidarr
 * 
 * Body:
 *   - mbid: string (required) - MusicBrainz release group ID
 *   - title: string (required) - Album title
 *   - artist: string (required) - Artist name
 *   - rootFolder: string (optional) - Custom root folder path
 *     * Only used when adding NEW artists
 *     * Ignored for existing artists (uses artist's current folder)
 *     * If omitted, uses default root folder from config
 * 
 * Authentication: Session or API Key
 */
router.post("/add", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { mbid, title, artist, rootFolder } = req.body;
    if (!mbid) throw new Error("Missing 'mbid' in request body");
    
    const userName = getUsername(req); // Extract userName
    
    lidarrHelpers.validateConfig();
	
	// Log if custom root folder was provided
    if (rootFolder) {
      lidarrHelpers.log("ADD", `Custom root folder requested: ${rootFolder}`);
    }
	
    lidarrHelpers.log("ADD", `Lidarr add request for: ${title} by ${artist} (MBID: ${mbid})`);

    // Step 1: Look up the album to get artist information
    const album = await lidarrHelpers.lookupAlbum(mbid, title);
    if (!album) throw new Error("Album not found in Lidarr lookup");

    if (!album.artist || !album.artist.foreignArtistId) {
      throw new Error("Album missing artist information required for adding to Lidarr");
    }

    const artistInfo = album.artist;
    lidarrHelpers.log(title, "Artist info:", {
      name: artistInfo.artistName,
      foreignArtistId: artistInfo.foreignArtistId,
      id: artistInfo.id
    });

    // Step 2: Check if artist already exists
    const existingArtist = await lidarrHelpers.findExistingArtist(artistInfo.foreignArtistId, title);
    
    if (existingArtist) {
	  // Artist exists: ignore custom root folder
      if (rootFolder) {
        lidarrHelpers.log(title, `⚠️ Ignoring custom root folder - artist exists in: ${existingArtist.path || 'unknown'}`);
      }
      return await handleExistingArtist(existingArtist, mbid, title, artist, userName, req);
    }

    // Step 3: Add new artist and album
    return await addNewArtistAndAlbum(artistInfo, mbid, title, artist, userName, req, rootFolder);
  });
});

router.get("/debug", ensureAuthenticated, async (req, res) => {
  try {
    lidarrHelpers.validateConfig();
    
    // Test basic connectivity
    const url = lidarrHelpers.buildApiUrl("system/status");
    lidarrHelpers.log('[DEBUG]','Testing Lidarr connection:', lidarrHelpers.redactApiKey(url));
    
    const status = await lidarrHelpers.apiRequest(url);
    lidarrHelpers.log('[DEBUG]','Lidarr connection successful:', status);
    
    res.json({
      success: true,
      status,
      config: {
        url: config.lidarr.url,
        hasApiKey: !!config.lidarr.apiKey,
        rootFolder: config.lidarr.rootFolder,
        qualityProfileId: config.lidarr.qualityProfileId
      }
    });
  } catch (error) {
    console.error('❌ Lidarr debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      config: {
        url: config.lidarr.url,
        hasApiKey: !!config.lidarr.apiKey,
        rootFolder: config.lidarr.rootFolder,
        qualityProfileId: config.lidarr.qualityProfileId
      }
    });
  }
});

// Artist monitoring status endpoint - checks if an artist is monitored in Lidarr
router.get("/artist-status", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { mbid, name } = req.query;
    if (!mbid && !name) {
      throw new Error("Missing 'mbid' or 'name' query parameter");
    }

    lidarrHelpers.validateConfig();
    const title = `ARTIST_STATUS_${name || mbid}`;
    
    lidarrHelpers.log(title, `Checking artist monitoring status for: ${name || mbid}`);

    return await cachedFetch('lidarr-artist-status', { mbid, name }, async () => {
      try {
        // Get all artists from Lidarr
        const allArtists = await lidarrHelpers.getAllArtists();
        lidarrHelpers.log(title, `Retrieved ${allArtists.length} artists from Lidarr`);

        // Look for the artist by MBID or name
        let targetArtist = null;
        
        if (mbid) {
          // First try to find by foreign artist ID (MBID)
          targetArtist = allArtists.find(artist => 
            artist.foreignArtistId === mbid
          );
          
          if (targetArtist) {
            lidarrHelpers.log(title, `Found artist by MBID: ${targetArtist.artistName} (monitored: ${targetArtist.monitored})`);
          }
        }
        
        // If not found by MBID and we have a name, try fuzzy name matching
        if (!targetArtist && name) {
          const normalizedSearchName = name.toLowerCase().trim();
          targetArtist = allArtists.find(artist => {
            const normalizedArtistName = artist.artistName.toLowerCase().trim();
            return normalizedArtistName === normalizedSearchName ||
                   normalizedArtistName.includes(normalizedSearchName) ||
                   normalizedSearchName.includes(normalizedArtistName);
          });
          
          if (targetArtist) {
            lidarrHelpers.log(title, `Found artist by name match: ${targetArtist.artistName} (monitored: ${targetArtist.monitored})`);
          }
        }

        if (targetArtist) {
          return {
            found: true,
            monitored: targetArtist.monitored || false,
            artistId: targetArtist.id,
            artistName: targetArtist.artistName,
            foreignArtistId: targetArtist.foreignArtistId,
            albumCount: targetArtist.statistics?.albumCount || 0,
            trackFileCount: targetArtist.statistics?.trackFileCount || 0
          };
        } else {
          lidarrHelpers.log(title, "Artist not found in Lidarr");
          return {
            found: false,
            monitored: false,
            artistId: null,
            artistName: null,
            foreignArtistId: null,
            albumCount: 0,
            trackFileCount: 0
          };
        }

      } catch (error) {
        lidarrHelpers.log(title, "Error checking artist status:", error.message);
        throw error;
      }
    }, 5 * 60); // Cache for 5 minutes
  });
});

// Retry album download endpoint
router.post("/retry-download", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { logId, albumTitle, artistName, albumMbid, lidarrAlbumId } = req.body;
    
    if (!logId) {
      throw new Error("Missing 'logId' in request body");
    }

    const userName = getUsername(req);
    const userInfo = req.session?.user?.claims;
    
    lidarrHelpers.validateConfig();
    lidarrHelpers.log("RETRY", `Album download retry request for: ${albumTitle} by ${artistName} (Log ID: ${logId})`);

    try {
      let albumInfo;
      
      if (lidarrAlbumId) {
        // Option 1: Get album by ID using direct API call
        lidarrHelpers.log("RETRY", `Getting album details for Lidarr album ID: ${lidarrAlbumId}`);
        
        try {
          const url = lidarrHelpers.buildApiUrl(`album/${lidarrAlbumId}`);
          albumInfo = await lidarrHelpers.apiRequest(url);
          lidarrHelpers.log("RETRY", `Successfully retrieved album details from Lidarr`);
        } catch (detailsError) {
          lidarrHelpers.log("RETRY", `Failed to get album details: ${detailsError.message}`);
          throw new Error(`Album with ID ${lidarrAlbumId} not found in Lidarr: ${detailsError.message}`);
        }
      } else if (albumMbid) {
        // Option 2: Look up by MBID
        lidarrHelpers.log("RETRY", `Looking up album by MBID: ${albumMbid}`);
        albumInfo = await lidarrHelpers.lookupAlbum(albumMbid, albumTitle);
        
        if (!albumInfo || !albumInfo.id) {
          throw new Error(`Album "${albumTitle}" not found in Lidarr. It may need to be re-added first.`);
        }
      } else {
        throw new Error("Either lidarrAlbumId or albumMbid is required to retry download");
      }

      // Log what we found
      lidarrHelpers.log("RETRY", `Album found:`, {
        id: albumInfo.id,
        title: albumInfo.title,
        foreignAlbumId: albumInfo.foreignAlbumId || 'missing',
        monitored: albumInfo.monitored,
        artistId: albumInfo.artistId || 'missing'
      });

      // Step 1: Handle monitoring (skip if missing required fields)
      let monitoringUpdated = false;
      if (albumInfo.foreignAlbumId && albumInfo.artistId) {
        if (!albumInfo.monitored) {
          lidarrHelpers.log("RETRY", `Album is not monitored, enabling monitoring`);
          try {
            await lidarrHelpers.updateAlbumMonitoring(albumInfo, true);
            monitoringUpdated = true;
            lidarrHelpers.log("RETRY", `Album monitoring enabled successfully`);
          } catch (monitoringError) {
            lidarrHelpers.log("RETRY", `Warning: Failed to update monitoring: ${monitoringError.message}`);
            lidarrHelpers.log("RETRY", `Continuing with search trigger anyway`);
          }
        } else {
          lidarrHelpers.log("RETRY", `Album is already monitored`);
        }
      } else {
        lidarrHelpers.log("RETRY", `Skipping monitoring update - missing required fields (foreignAlbumId or artistId)`);
      }

      // Step 2: Trigger album search (this is the most important part)
      lidarrHelpers.log("RETRY", `Triggering album search for album ID: ${albumInfo.id}`);
      const searchTriggered = await lidarrHelpers.triggerAlbumSearch(albumInfo.id, "RETRY");
      
      if (!searchTriggered) {
        throw new Error("Failed to trigger album search in Lidarr");
      }

      lidarrHelpers.log("RETRY", `Successfully triggered album search for: ${albumInfo.title}`);

      // Step 3: Log the retry attempt to database
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: albumInfo.title,
        albumMbid: albumMbid || albumInfo.foreignAlbumId,
        artistName: artistName,
        artistMbid: albumInfo.artist?.foreignArtistId || null,
        lidarrAlbumId: albumInfo.id,
        lidarrArtistId: albumInfo.artistId || null,
        releaseDate: albumInfo.releaseDate || null,
        monitored: albumInfo.monitored || monitoringUpdated,
        searchTriggered: true,
        success: true,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ 
          retryFrom: logId,
          originalAlbumTitle: albumTitle,
          originalArtistName: artistName,
          retryReason: 'manual_retry',
          monitoringUpdated: monitoringUpdated
        }),
        downloaded: false
      });

      return {
        success: true,
        message: `Download retry triggered successfully for "${albumInfo.title}"`,
        albumId: albumInfo.id,
        albumTitle: albumInfo.title,
        searchTriggered: true,
        monitored: albumInfo.monitored || monitoringUpdated,
        monitoringUpdated: monitoringUpdated
      };

    } catch (error) {
      // Log the failed retry attempt
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: albumTitle,
        albumMbid: albumMbid,
        artistName: artistName,
        artistMbid: null,
        lidarrAlbumId: lidarrAlbumId || null,
        lidarrArtistId: null,
        releaseDate: null,
        monitored: false,
        searchTriggered: false,
        success: false,
        errorMessage: error.message,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({
          retryFrom: logId,
          originalAlbumTitle: albumTitle,
          originalArtistName: artistName,
          retryReason: 'manual_retry_failed'
        }),
        downloaded: false
      });

      lidarrHelpers.log("RETRY", `Retry failed for ${albumTitle}:`, error.message);
      throw error;
    }
  });
});

// Helper function to handle existing artist case
async function handleExistingArtist(existingArtist, mbid, title, artist, userName, req) {
  const userInfo = req.session?.user?.claims;
  
  // Get artist's current root folder
  const artistRootFolder = await lidarrHelpers.getArtistRootFolder(existingArtist.id);
  if (artistRootFolder) {
    lidarrHelpers.log(title, `📁 Artist exists in root folder: ${artistRootFolder}`);
  }
  
  // Check if the specific album is already in artist's discography
  try {
    const artistAlbums = await lidarrHelpers.getArtistAlbums(existingArtist.id);
    lidarrHelpers.log(title, `Found ${artistAlbums.length} albums for existing artist`);
    
    const targetAlbum = lidarrHelpers.findTargetAlbum(artistAlbums, mbid);
    
    if (targetAlbum) {
      lidarrHelpers.log(title, "Target album found in existing artist's discography:", {
        id: targetAlbum.id,
        title: targetAlbum.title,
        monitored: targetAlbum.monitored,
        foreignAlbumId: targetAlbum.foreignAlbumId
      });

      // Update monitoring if needed and trigger search
      if (!targetAlbum.monitored) {
        await lidarrHelpers.updateAlbumMonitoring(targetAlbum, true);
        lidarrHelpers.log(title, "Album monitoring updated successfully");
      }
      
      await lidarrHelpers.triggerAlbumSearch(targetAlbum.id, title);
      
      // LOG ALBUM ADDITION TO DATABASE
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: targetAlbum.title,
        albumMbid: mbid,
        artistName: existingArtist.artistName,
        artistMbid: existingArtist.foreignArtistId,
        lidarrAlbumId: targetAlbum.id,
        lidarrArtistId: existingArtist.id,
        releaseDate: targetAlbum.releaseDate,
        monitored: true,
        searchTriggered: true,
        success: true,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ 
		  mbid, 
		  title, 
		  artist, 
		  rootFolder: artistRootFolder || 'unknown' 
		}),
		downloaded: false
      });
      
      const message = targetAlbum.monitored 
        ? `Album "${targetAlbum.title}" by "${existingArtist.artistName}" is already monitored.`
        : `Album "${targetAlbum.title}" by "${existingArtist.artistName}" is now monitored and searching.`;

      searchTriggered = await lidarrHelpers.triggerAlbumSearch(targetAlbum.id, title);
	  if (searchTriggered) {
		lidarrHelpers.log(title, "Album search triggered.");
	  }
      else {
		lidarrHelpers.log(title, "Album search NOT triggered.");
	  }

      return {
        id: existingArtist.id,
        title: targetAlbum.title,
        artist: existingArtist.artistName,
        message
      };
    } else {
      // Artist exists but album not found - refresh artist
      lidarrHelpers.log(title, "Artist exists but target album not found, refreshing artist metadata");
      
      const refreshSuccess = await lidarrHelpers.triggerArtistRefresh(existingArtist.id, title);
      
      if (!refreshSuccess) {
        lidarrHelpers.log(title, "Artist refresh failed, but continuing to check for album");
      }
      
      // Wait and try to find album again
      await new Promise(resolve => setTimeout(resolve, 2000));
      const refreshedAlbums = await lidarrHelpers.getArtistAlbums(existingArtist.id);
      const refreshedTargetAlbum = lidarrHelpers.findTargetAlbum(refreshedAlbums, mbid);
      
      if (refreshedTargetAlbum) {
        lidarrHelpers.log(title,"1");
        await lidarrHelpers.updateAlbumMonitoring(refreshedTargetAlbum, true);
        await lidarrHelpers.triggerAlbumSearch(refreshedTargetAlbum.id, title);
        
        // LOG ALBUM ADDITION TO DATABASE
        await database.logAlbumAddition({
          userId: userName,
          username: userInfo?.preferred_username || userInfo?.name || null,
          email: userInfo?.email || null,
          albumTitle: refreshedTargetAlbum.title,
          albumMbid: mbid,
          artistName: existingArtist.artistName,
          artistMbid: existingArtist.foreignArtistId,
          lidarrAlbumId: refreshedTargetAlbum.id,
          lidarrArtistId: existingArtist.id,
          releaseDate: refreshedTargetAlbum.releaseDate,
          monitored: true,
          searchTriggered: true,
          success: true,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          requestData: JSON.stringify({ mbid, title, artist }),
          downloaded: false
        });
		
        searchTriggered = await lidarrHelpers.triggerAlbumSearch(targetAlbum.id, title);
        if (searchTriggered) {
          lidarrHelpers.log(title, "Album search triggered.");
        }
        else {
          lidarrHelpers.log(title, "Album search NOT triggered.");
        }
        
        return {
          id: existingArtist.id,
          title: refreshedTargetAlbum.title,
          artist: existingArtist.artistName,
          message: `Album "${refreshedTargetAlbum.title}" by "${existingArtist.artistName}" found after refresh and is now monitored.`
        };
      }
      lidarrHelpers.log(title,"2");
      
      // If still not found, log the failure
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: title,
        albumMbid: mbid,
        artistName: existingArtist.artistName,
        artistMbid: existingArtist.foreignArtistId,
        lidarrAlbumId: null,
        lidarrArtistId: existingArtist.id,
        releaseDate: null,
        monitored: false,
        searchTriggered: false,
        success: false,
        errorMessage: 'Album not found in artist discography after refresh',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ mbid, title, artist }),
		downloaded: false
      });
      
      return {
        id: existingArtist.id,
        title: title,
        artist: existingArtist.artistName,
        message: `Artist "${existingArtist.artistName}" exists in Lidarr but the album "${title}" could not be found. This may happen if the album is not in MusicBrainz or has different metadata. Try refreshing the artist manually in Lidarr or add the album directly through Lidarr's interface.`,
        success: false
      };
    }
  } catch (error) {
    // Log the error to database
    lidarrHelpers.log(title,"3");
    await database.logAlbumAddition({
      userId: userName,
      username: userInfo?.preferred_username || userInfo?.name || null,
      email: userInfo?.email || null,
      albumTitle: title,
      albumMbid: mbid,
      artistName: existingArtist.artistName,
      artistMbid: existingArtist.foreignArtistId,
      lidarrAlbumId: null,
      lidarrArtistId: existingArtist.id,
      releaseDate: null,
      monitored: false,
      searchTriggered: false,
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      requestData: JSON.stringify({ mbid, title, artist }),
	  downloaded: false
    });
    
    lidarrHelpers.log(title, "Error checking artist's albums:", error.message);
    throw error;
  }
}

// Helper function to add new artist and album
async function addNewArtistAndAlbum(artistInfo, mbid, title, artist, userName, req, customRootFolder) {
  let addedArtist;
  const userInfo = req.session?.user?.claims;
  
  // Determine root folder to use
  const rootFolderToUse = customRootFolder || config.lidarr.rootFolder;
  lidarrHelpers.log(title, `📁 Adding new artist to root folder: ${rootFolderToUse}`);
  
  try {
    // Add the artist without searching for all albums
    addedArtist = await lidarrHelpers.addArtist(artistInfo, title, rootFolderToUse);

    await database.logArtistAddition({
      userId: userName,
      username: userInfo?.preferred_username || userInfo?.name || null,
      email: userInfo?.email || null,
      artistName: addedArtist.artistName,
      artistMbid: addedArtist.foreignArtistId,
      lidarrArtistId: addedArtist.id,
      qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
      rootFolder: rootFolderToUse,
      monitored: addedArtist.monitored,
      success: true,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      requestData: JSON.stringify({ mbid, title, artist, rootFolder: rootFolderToUse }), // Original request context
      downloaded: false
    });

    // Find and add the specific album
    lidarrHelpers.log(title, "Refreshing artist after adding to Lidarr");
	
	const refreshSuccess = await lidarrHelpers.triggerArtistRefresh(addedArtist.id, title);
	
    // Find and add the specific album
    lidarrHelpers.log(title, "Finding and adding specific album");
    
    const artistAlbums = await lidarrHelpers.getArtistAlbums(addedArtist.id);
    lidarrHelpers.log(title, `Found ${artistAlbums.length} albums for artist`);

    const targetAlbum = lidarrHelpers.findTargetAlbum(artistAlbums, mbid);
    
    if (!targetAlbum) {
      // Log album addition failure
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: targetAlbum.title,
        albumMbid: mbid,
        artistName: addedArtist.artistName,
        artistMbid: addedArtist.foreignArtistId,
        lidarrAlbumId: null,
        lidarrArtistId: addedArtist.id,
        releaseDate: null,
        monitored: false,
        searchTriggered: false,
        success: false,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ mbid, title, artist }), // Original request context
		downloaded: false
      });
      
      return {
        id: addedArtist.id,
        title: title,
        artist: addedArtist.artistName,
        message: `Artist "${addedArtist.artistName}" added to Lidarr, but target album not found in discography.`
      };
    }

    lidarrHelpers.log(title, "Found target album:", {
      id: targetAlbum.id,
      title: targetAlbum.title,
      monitored: targetAlbum.monitored,
      foreignAlbumId: targetAlbum.foreignAlbumId
    });

    // Update album to be monitored
    await lidarrHelpers.updateAlbumMonitoring(targetAlbum, true);
    
    // Check if search is needed
    const percentOfTracks = targetAlbum.statistics?.percentOfTracks || 0;
    lidarrHelpers.log(title, `Album completion: ${percentOfTracks}%`);
    
    let finalMessage;
    let searchTriggered = false;
    
    if (percentOfTracks < 100) {
      searchTriggered = await lidarrHelpers.triggerAlbumSearch(targetAlbum.id, title);
      finalMessage = `Artist "${addedArtist.artistName}" and album "${targetAlbum.title}" added to Lidarr successfully. Search triggered for missing files.`;
    } else {
      finalMessage = `Artist "${addedArtist.artistName}" and album "${targetAlbum.title}" added to Lidarr successfully (already complete).`;
    }

    // 🆕 LOG ALBUM ADDITION TO DATABASE
    await database.logAlbumAddition({
      userId: userName,
      username: userInfo?.preferred_username || userInfo?.name || null,
      email: userInfo?.email || null,
      albumTitle: targetAlbum.title,
      albumMbid: mbid,
      artistName: addedArtist.artistName,
      artistMbid: addedArtist.foreignArtistId,
      lidarrAlbumId: targetAlbum.id,
      lidarrArtistId: addedArtist.id,
      releaseDate: targetAlbum.releaseDate,
      rootFolder: rootFolderToUse,
      monitored: true,
      searchTriggered: searchTriggered,
      success: true,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      requestData: JSON.stringify({ mbid, title, artist }), // Original request context
	  downloaded: false
    });

    return {
      id: addedArtist.id,
      title: targetAlbum.title,
      artist: addedArtist.artistName,
      message: finalMessage
    };

  } catch (error) {
    // Log artist addition failure if artist creation failed
    if (!addedArtist) {
      await database.logArtistAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        artistName: artistInfo.artistName,
        artistMbid: artistInfo.foreignArtistId,
        lidarrArtistId: null,
        qualityProfileId: parseInt(config.lidarr.qualityProfileId, 10),
        rootFolder: config.lidarr.rootFolder,
        monitored: false,
        success: false,
        errorMessage: error.message,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ mbid, title, artist })
      });
    } else {
      // Artist was added but album processing failed
      await database.logAlbumAddition({
        userId: userName,
        username: userInfo?.preferred_username || userInfo?.name || null,
        email: userInfo?.email || null,
        albumTitle: title,
        albumMbid: mbid,
        artistName: addedArtist.artistName,
        artistMbid: addedArtist.foreignArtistId,
        lidarrAlbumId: null,
        lidarrArtistId: addedArtist.id,
        releaseDate: null,
        monitored: false,
        searchTriggered: false,
        success: false,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestData: JSON.stringify({ mbid, title, artist }), // Original request context
		downloaded: false
      });
    }
    
    lidarrHelpers.log(title, "Failed to process specific album:", error.message);
    
    if (addedArtist) {
      return {
        id: addedArtist.id,
        title: title,
        artist: addedArtist.artistName,
        message: `Artist "${addedArtist.artistName}" added to Lidarr, but could not add specific album.`
      };
    } else {
      throw error; // Re-throw if artist addition failed
    }
  }
}

module.exports = router;
module.exports.lidarrHelpers = lidarrHelpers;
