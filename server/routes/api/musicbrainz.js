// server/routes/api/musicbrainz.js - Updated MusicBrainz API routes with preference support
const express = require("express");
const { ensureAuthenticated } = require("../../middleware/auth");
const { queuedApiCall } = require("../../services/queue");
const { cachedFetch } = require("../../services/cache");
const { rateLimitedFetch } = require("../../services/rateLimit");
const config = require("../../config");

// Import new Lidarr services instead of old helpers
const { LidarrClient } = require("../../services/lidarr/lidarrClient");
const { AlbumService } = require("../../services/lidarr/albumService");
const { ArtistService } = require("../../services/lidarr/artistService");

const router = express.Router();

// Initialize Lidarr services (singleton pattern)
let lidarrClient, albumService, artistService;

function getLidarrServices() {
  if (!lidarrClient) {
    try {
      LidarrClient.validateConfig();
      lidarrClient = new LidarrClient();
      albumService = new AlbumService(lidarrClient);
      artistService = new ArtistService(lidarrClient);
    } catch (error) {
      console.warn('⚠️  Lidarr not configured, will skip Lidarr integration');
      return null;
    }
  }
  return { lidarrClient, albumService, artistService };
}

// Updated processBatch - uses pre-built Lidarr map for instant lookups
async function processBatch(releases, artistName, lidarrAlbumsMap, categories) {
  console.log(`📄 Processing batch of ${releases.length} releases...`);
  
  // Prefer Lidarr's cover when the album exists there; otherwise fetch the
  // MusicBrainz release-group cover. A partially populated Lidarr artist must
  // not suppress artwork for albums that are only in MusicBrainz.
  const coverArtPromises = releases.map(async (release) => {
    const lidarrInfo = lidarrAlbumsMap.get(release.id || release.foreignAlbumId);
    if (lidarrInfo?.coverUrl) {
      return lidarrInfo.coverUrl;
    }

      try {
        const url = `https://coverartarchive.org/release-group/${release.id}`;
        const coverResponse = await fetch(url);
        
        if (coverResponse.status === 404) {
          return null;
        }
        
        if (coverResponse.ok) {
          const coverData = await coverResponse.json();
          if (coverData.images && coverData.images.length > 0) {
            const frontCover = coverData.images.find(img => 
              img.types && img.types.includes("Front")
            ) || coverData.images[0];
            return frontCover.image;
          }
        }
      } catch (error) {
        // Silently fail - just no cover art
      }
      return null;
  });

  const coverArtResults = await Promise.all(coverArtPromises);
  console.log(`✅ Resolved cover art for batch (${coverArtResults.filter(Boolean).length}/${releases.length} found)`);
    
  // Process results with instant Lidarr status lookup (no API calls!)
  const processedResults = releases
    .map((release, index) => {
      // Get Lidarr info if available
      const lidarrInfo = lidarrAlbumsMap.get(release.id || release.foreignAlbumId) || {
        inLibrary: false,
        fullyAvailable: false,
        percentComplete: 0,
        coverUrl: false,
        albumType: null,
        secondaryTypes: []
      };

      // Determine release type - handle both MusicBrainz and Lidarr formats
      let releaseType;
      
      if (release['primary-type']) {
        // MusicBrainz format
        releaseType = release['primary-type'].toLowerCase();
      } else if (lidarrInfo.albumType) {
        // Lidarr format from our map - map their types to our types
        const lidarrType = lidarrInfo.albumType.toLowerCase();
        const typeMap = {
          'album': 'album',
          'ep': 'ep',
          'single': 'single',
          'broadcast': 'other',
          'other': 'other'
        };
        releaseType = typeMap[lidarrType] || 'other';
      } else if (release.albumType) {
        // Fallback: Direct from release object (shouldn't happen but safe)
        const lidarrType = release.albumType.toLowerCase();
        const typeMap = {
          'album': 'album',
          'ep': 'ep',
          'single': 'single',
          'broadcast': 'other',
          'other': 'other'
        };
        releaseType = typeMap[lidarrType] || 'other';
      } else {
        releaseType = 'unknown';
      }
	  
      // Apply category filtering
      if (categories && categories !== 'all') {
        const allowedCategories = categories.split(',').map(c => c.trim().toLowerCase());
        
        const categoryMap = {
          'album': 'album',
          'ep': 'ep', 
          'single': 'single'
        };
        
        const releaseCategory = categoryMap[releaseType] || 'other';
        if (!allowedCategories.includes(releaseCategory)) return null;
      }
	  
	  // Determine cover URL source
      const coverUrl = lidarrInfo.coverUrl || coverArtResults[index] || null;
      
      // Handle artist credit for both formats
      let artistCredit;
      if (release['artist-credit']) {
        artistCredit = release['artist-credit'][0]?.name;
      } else if (release.artist) {
        artistCredit = release.artist.artistName;
      }
      
      // Combine secondary types from both sources
      const secondaryTypes = release['secondary-types'] || lidarrInfo.secondaryTypes || [];
      
      return {
        mbid: release.id || release.foreignAlbumId,
        title: release.title,
        artist: artistCredit || artistName,
        releaseDate: release['first-release-date'] || release.releaseDate,
        releaseType: releaseType,
        secondaryTypes: secondaryTypes,
        score: 1.0,
        coverUrl,
        inLidarr: lidarrInfo.inLibrary,
        fullyAvailable: lidarrInfo.fullyAvailable,
        percentComplete: lidarrInfo.percentComplete
      };
    })
    .filter(Boolean);
  
  const inLidarrCount = processedResults.filter(r => r.inLidarr).length;
  console.log(`✅ Processed batch: ${processedResults.length} albums (${inLidarrCount} in Lidarr)`);
  
  return processedResults;
}

// MusicBrainz recording search
router.get("/recording", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { query, limit = 10 } = req.query;
    
    if (!query) {
      throw new Error("Missing 'query' parameter");
    }

    return await cachedFetch('recording', { query, limit }, async () => {
      const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}&inc=releases+release-groups+artist-credits`;
      console.log("🎵 MusicBrainz recording search:", url);

      const response = await rateLimitedFetch(url);
      
      if (!response.ok) {
        console.error("⚠️ MusicBrainz recording search failed:", response.status, response.statusText);
        throw new Error(`MusicBrainz error: ${response.statusText}`);
      }

      return await response.json();
    });
  });
});

// MusicBrainz release-group search with preference support
router.get("/release-group", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { 
      query, 
      artist,
      limit = 50,
      categories 
    } = req.query;
    
    // Build search query with improved precision
    let searchQuery;
    if (query) {
      searchQuery = query;
    } else if (artist) {
      // Use a more precise search approach:
      // 1. Try exact match first (in quotes)
      // 2. Add fuzzy match with higher threshold for close variations only
      // 3. Include common name variations for specific artists
      searchQuery = `artist:"${artist}" OR artistname:"${artist}"`;
      console.log("🎤 Using precise search with minimal fuzzy matching");
    } else {
      throw new Error("Missing 'query' or 'artist' parameter");
    }

    // Parse limit - handle 'all' case
    const searchLimit = limit === 'all' ? 500 : Math.min(parseInt(limit) || 50, 500); // Cap at 500 for API limits

    // Create cache key that includes preferences (but cache based on final limit, not batch size)
    const cacheKey = { 
      query: searchQuery, 
      limit: searchLimit, 
      categories: categories || 'all',
      paginated: searchLimit > 25 ? true : false // Distinguish paginated vs single requests
    };

    return await cachedFetch('release-group-with-prefs', cacheKey, async () => {
      let allReleaseGroups = [];
      let offset = 0;
      const batchSize = 25; // MusicBrainz limit per request
      const targetLimit = searchLimit;
      
      console.log("🎯 Search preferences:", { limit: searchLimit, categories });
      console.log("🔍 Search query used:", searchQuery);
      
      // If we need more than 25 results, make multiple paginated requests
      while (allReleaseGroups.length < targetLimit) {
        const currentBatchSize = Math.min(batchSize, targetLimit - allReleaseGroups.length);
        const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(searchQuery)}&fmt=json&limit=${currentBatchSize}&offset=${offset}`;
        
        console.log(`🎼 MusicBrainz release-group search (batch ${Math.floor(offset/batchSize) + 1}):`, url);
        console.log(`📄 Fetching results ${offset + 1}-${offset + currentBatchSize} (total collected: ${allReleaseGroups.length})`);

        const response = await rateLimitedFetch(url);
        
        if (!response.ok) {
          console.error("⚠️ MusicBrainz release-group search failed:", response.status, response.statusText);
          throw new Error(`MusicBrainz error: ${response.statusText}`);
        }

        const batchData = await response.json();
        const batchReleaseGroups = batchData['release-groups'] || [];
        
        console.log(`📊 Batch ${Math.floor(offset/batchSize) + 1} results:`, batchReleaseGroups.length, "release groups found");
        
        // If we got no results in this batch, we've reached the end
        if (batchReleaseGroups.length === 0) {
          console.log("🏁 No more results available from MusicBrainz");
          break;
        }
        
        // Add this batch to our collection
        allReleaseGroups = allReleaseGroups.concat(batchReleaseGroups);
        
        // If we got fewer results than requested, we've reached the end
        if (batchReleaseGroups.length < currentBatchSize) {
          console.log("🏁 Received fewer results than requested - end of available data");
          break;
        }
        
        // Move to next batch
        offset += batchSize;
        
        // Add a small delay between requests to be respectful to MusicBrainz
        if (allReleaseGroups.length < targetLimit) {
          console.log("⏸️ Adding delay between MusicBrainz requests...");
          await new Promise(resolve => setTimeout(resolve, 1100)); // 1.1 second delay
        }
      }
      
      // Create combined data structure
      const data = {
        'release-groups': allReleaseGroups,
        'release-group-count': allReleaseGroups.length,
        'release-group-offset': 0
      };
      
      console.log("📊 Total MusicBrainz results collected:", data['release-groups']?.length || 0, "release groups");

      // Apply category filtering if specified
      if (categories && categories !== 'all') {
        const allowedCategories = categories.split(',').map(c => c.trim().toLowerCase());
        console.log("🔍 Filtering by categories:", allowedCategories);
        
        if (data['release-groups']) {
          const originalCount = data['release-groups'].length;
          
          data['release-groups'] = data['release-groups'].filter(release => {
            const primaryType = release['primary-type']?.toLowerCase();
            
            // Map MusicBrainz types to our categories
            let releaseCategory;
            switch (primaryType) {
              case 'album':
                releaseCategory = 'album';
                break;
              case 'ep':
                releaseCategory = 'ep';
                break;
              case 'single':
                releaseCategory = 'single';
                break;
              case 'broadcast':
              case 'compilation':
              case 'interview':
              case 'audiobook':
              case 'spokenword':
              case 'mixtape/street':
              default:
                releaseCategory = 'other';
            }
            
            const shouldInclude = allowedCategories.includes(releaseCategory);
            if (!shouldInclude) {
              console.log(`🚫 Filtering out ${release.title} (${primaryType || 'unknown'} -> ${releaseCategory})`);
            }
            return shouldInclude;
          });
          
          console.log(`✅ Category filtering: ${originalCount} -> ${data['release-groups'].length} releases`);
        }
      } else {
        console.log("🎯 No category filtering applied (showing all types)");
      }

      // Apply final limit after filtering (in case filtering reduced results significantly)
      if (limit !== 'all' && data['release-groups'] && data['release-groups'].length > parseInt(limit)) {
        const beforeLimit = data['release-groups'].length;
        data['release-groups'] = data['release-groups'].slice(0, parseInt(limit));
        console.log(`✂️ Applied final limit: ${beforeLimit} -> ${data['release-groups'].length} releases`);
      }

      // Log final results for debugging
      console.log(`🎯 Final results: ${data['release-groups']?.length || 0} releases returned`);
      if (data['release-groups']?.length > 0) {
        console.log("🔍 First few results:");
        data['release-groups'].slice(0, 3).forEach((release, idx) => {
          console.log(`  ${idx + 1}. ${release.title} (${release['primary-type'] || 'unknown'}) by ${release['artist-credit']?.[0]?.name || 'Unknown'}`);
        });
      }

      return data;
    }, 10 * 60); // Cache for 10 minutes since results can be large
  });
});

// MusicBrainz release lookup by ID
router.get("/release/:id", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { id } = req.params;
    const { inc = "release-groups" } = req.query;
    
    return await cachedFetch('release', { id, inc }, async () => {
      const url = `https://musicbrainz.org/ws/2/release/${id}?fmt=json&inc=${encodeURIComponent(inc)}`;
      console.log("💿 MusicBrainz release lookup:", url);

      const response = await rateLimitedFetch(url);
      
      if (!response.ok) {
        console.error("⚠️ MusicBrainz release lookup failed:", response.status, response.statusText);
        throw new Error(`MusicBrainz error: ${response.statusText}`);
      }

      return await response.json();
    });
  });
});

// MusicBrainz releases by release-group
router.get("/release", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { 'release-group': releaseGroup, inc = "recordings" } = req.query;
    
    if (!releaseGroup) {
      throw new Error("Missing 'release-group' parameter");
    }

    return await cachedFetch('releases', { releaseGroup, inc }, async () => {
      const url = `https://musicbrainz.org/ws/2/release/?release-group=${encodeURIComponent(releaseGroup)}&inc=${encodeURIComponent(inc)}&fmt=json`;
      console.log("💿 MusicBrainz releases lookup:", url);

      const response = await rateLimitedFetch(url);
      
      if (!response.ok) {
        console.error("⚠️ MusicBrainz releases lookup failed:", response.status, response.statusText);
        throw new Error(`MusicBrainz error: ${response.statusText}`);
      }

      return await response.json();
    });
  });
});

// Add SSE streaming endpoint
router.get("/release-group/stream", ensureAuthenticated, async (req, res) => {
  const { artist, limit = 50, categories } = req.query;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error('Error sending SSE event:', error);
    }
  };
  
  try {
    console.log('🔍 Starting stream for artist:', artist);
    const searchLimit = limit === 'all' ? 500 : Math.min(parseInt(limit) || 50, 500);
    
    let artistInLidarr = false;
    let lidarrArtistId = null;
    const lidarrAlbumsMap = new Map();
    
    sendEvent('start', { 
      totalRequested: searchLimit,
      batchSize: 100 
    });
    
    // STEP 1: Find the artist's MBID first
    console.log(`🔍 Finding artist MBID for: ${artist}`);
    const artistSearchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(artist)}"&fmt=json&limit=1`;
    const artistSearchResponse = await rateLimitedFetch(artistSearchUrl);
    
    if (!artistSearchResponse.ok) {
      console.error('❌ MusicBrainz artist search failed:', artistSearchResponse.status, artistSearchResponse.statusText);
      sendEvent('error', { message: 'Failed to find artist' });
      return res.end();
    }
    
    const artistSearchData = await artistSearchResponse.json();
    const artists = artistSearchData.artists || [];
    
    if (artists.length === 0) {
      console.log('❌ No artist found matching:', artist);
      sendEvent('error', { message: `No artist found matching "${artist}"` });
      return res.end();
    }
    
    const artistMbid = artists[0].id;
    const artistName = artists[0].name;
    console.log(`✅ Found artist: ${artistName} (${artistMbid})`);
    
    // STEP 2: Check Lidarr status using new services
    try {
      console.log('🔍 Checking Lidarr status for artist:', artistMbid);
      const services = getLidarrServices();
      
      if (services) {
        const { artistService, albumService } = services;
        const existingArtist = await artistService.findByMbid(artistMbid);
        
        if (existingArtist) {
          artistInLidarr = true;
          lidarrArtistId = existingArtist.id;
          console.log(`✅ Artist found in Lidarr with ID: ${lidarrArtistId}`);
          
          try {
            const albumsMapFromService = await albumService.getAllWithCoverArt(lidarrArtistId);
            console.log(`✅ Retrieved albums map with ${albumsMapFromService.size} entries from Lidarr`);
            
            // Copy the map entries into our lidarrAlbumsMap
            albumsMapFromService.forEach((value, key) => {
              lidarrAlbumsMap.set(key, value);
            });
            
            console.log(`✅ Mapped ${lidarrAlbumsMap.size} Lidarr albums`);
            
          } catch (albumError) {
            console.error('❌ Error getting Lidarr albums:', albumError);
          }
        } else {
          console.log('ℹ️ Artist not found in Lidarr');
        }
      } else {
        console.log('ℹ️ Lidarr services not available (not configured)');
      }
    } catch (lidarrError) {
      console.error('❌ Error checking Lidarr:', lidarrError);
    }
    
    sendEvent('artist-status', { 
      artistInLidarr,
      artistName,
      artistMbid,
      lidarrArtistId,
      albumsInLidarr: lidarrAlbumsMap.size,
      message: artistInLidarr 
        ? `Artist exists with ${lidarrAlbumsMap.size} albums in Lidarr`
        : 'Artist does not exist in Lidarr'
    });
    
    // STEP 3: MusicBrainz is the discovery catalog. Lidarr is only a status
    // overlay, so a stale or partial Lidarr discography cannot hide releases.
    let allProcessedReleases = [];
    let allReleases = [];
    let offset = 0;
    const batchSize = 100;

    console.log(`📡 Fetching MusicBrainz catalog with ${lidarrAlbumsMap.size} Lidarr status overlays`);

    while (allReleases.length < searchLimit) {
      const currentLimit = Math.min(batchSize, searchLimit - allReleases.length);
      const url = `https://musicbrainz.org/ws/2/release-group?artist=${artistMbid}&limit=${currentLimit}&offset=${offset}&fmt=json`;

      console.log(`📡 Fetching batch at offset ${offset}`);
      const response = await rateLimitedFetch(url);

      if (!response.ok) {
        console.error('❌ MusicBrainz request failed:', response.status);

        // If discovery is unavailable before it yields anything, preserve the
        // useful catalog we already have from Lidarr. Never report a clean
        // MusicBrainz completion for a failed or truncated request.
        if (allReleases.length === 0 && lidarrAlbumsMap.size > 0) {
          const lidarrReleases = Array.from(lidarrAlbumsMap.entries())
            .map(([mbid, albumInfo]) => ({
              id: mbid,
              title: albumInfo.title,
              'first-release-date': albumInfo.releaseDate || null,
              'primary-type': albumInfo.albumType || 'Album',
              'secondary-types': albumInfo.secondaryTypes || [],
              'artist-credit': [{ name: artistName }]
            }));

          const processed = await processBatch(
            lidarrReleases,
            artistName,
            lidarrAlbumsMap,
            categories
          );
          allProcessedReleases = processed;

          sendEvent('batch', {
            releases: processed,
            offset: processed.length,
            total: processed.length,
            hasMore: false,
            batchNumber: 1,
            source: 'lidarr-fallback'
          });
          sendEvent('complete', {
            total: processed.length,
            source: 'lidarr-fallback',
            degraded: true
          });
          return;
        }

        sendEvent('error', {
          message: `MusicBrainz catalog request failed (HTTP ${response.status})`,
          partialResults: allProcessedReleases.length
        });
        return;
      }

      const data = await response.json();
      const releases = data['release-groups'] || [];

      if (releases.length === 0) break;

      allReleases = allReleases.concat(releases);

      const processed = await processBatch(releases, artistName, lidarrAlbumsMap, categories);
      allProcessedReleases = allProcessedReleases.concat(processed);

      sendEvent('batch', {
        releases: processed,
        offset: allProcessedReleases.length,
        total: allProcessedReleases.length,
        hasMore: releases.length === currentLimit,
        batchNumber: Math.floor(offset / batchSize) + 1,
        source: 'musicbrainz'
      });

      if (releases.length < currentLimit) break;

      offset += batchSize;

      if (allReleases.length < searchLimit) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }
    
    sendEvent('complete', { 
      total: allProcessedReleases.length,
      source: 'musicbrainz'
    });
    
  } catch (error) {
    console.error('❌ Stream error:', error);
    sendEvent('error', { message: error.message });
  } finally {
    res.end();
  }
});

module.exports = router;
