// client/src/services/albumEnrichmentService.js
import { secureApiCall } from '../services/apiService.js';

export async function enrichAlbumsWithMetadata(albums) {
  console.log("🎨 Fetching cover art and Lidarr info in parallel for", albums.length, "releases");
  const artistStatusRequests = new Map();
  
  const albumsWithCovers = await Promise.allSettled(
    albums.map(async (album, index) => {
      console.log(`💿 Processing release ${index + 1}:`, album);
      const albumData = { ...album };
      
      // Create promises for parallel execution
      const coverPromise = fetchCoverArt(album);
      const lidarrPromise = checkLidarrStatus(album);
      const artistStatusPromise = checkArtistLidarrStatus(album, artistStatusRequests);

      // Wait for all enrichment requests to complete
      const [coverUrl, lidarrData, artistStatus] = await Promise.all([
        coverPromise,
        lidarrPromise,
        artistStatusPromise
      ]);
      
      albumData.coverUrl = coverUrl;
      
      // Handle the enhanced Lidarr response
      if (lidarrData && typeof lidarrData === 'object') {
        // Map backend fields to frontend fields
        albumData.inLidarr = lidarrData.inLibrary || false;  // Keep existing field name
        albumData.fullyAvailable = lidarrData.fullyAvailable || false;
        albumData.percentComplete = lidarrData.percentComplete || 0;
        
        // Also add backend field names for compatibility
        albumData.inLibrary = lidarrData.inLibrary || false;
      } else {
        // Fallback to old boolean format
        albumData.inLidarr = !!lidarrData;
        albumData.fullyAvailable = !!lidarrData;
        albumData.percentComplete = lidarrData ? 100 : 0;
        albumData.inLibrary = !!lidarrData;
      }

      // Album membership and artist membership are different. A song search
      // can return a new album by an artist who already has a fixed root path.
      albumData.artistInLidarr = albumData.inLidarr || artistStatus.found;
      albumData.lidarrArtistId = artistStatus.artistId || null;

      console.log(`✅ Finished processing release ${index + 1}:`, {
        title: albumData.title,
        inLidarr: albumData.inLidarr,
        fullyAvailable: albumData.fullyAvailable,
        percentComplete: albumData.percentComplete,
        isFullyDownloaded: albumData.inLidarr && albumData.fullyAvailable
      });
      return albumData;
    })
  );

  // Process results from Promise.allSettled
  const processedAlbums = albumsWithCovers
    .map(result => result.status === 'fulfilled' ? result.value : null)
    .filter(album => album !== null);

  console.log("🎨 All releases processed successfully:", processedAlbums);
  return processedAlbums;
}

async function checkArtistLidarrStatus(album, requests) {
  const artistMbid = album.artistMbid?.trim();
  const artistName = album.artist?.trim();
  if (!artistMbid && !artistName) {
    return { found: false, artistId: null };
  }

  const cacheKey = artistMbid
    ? `mbid:${artistMbid.toLocaleLowerCase()}`
    : `name:${artistName.toLocaleLowerCase()}`;
  if (!requests.has(cacheKey)) {
    requests.set(cacheKey, fetchArtistLidarrStatus({ artistMbid, artistName }));
  }

  return requests.get(cacheKey);
}

async function fetchArtistLidarrStatus({ artistMbid, artistName }) {
  const identity = artistMbid || artistName;

  try {
    const query = artistMbid
      ? `mbid=${encodeURIComponent(artistMbid)}`
      : `name=${encodeURIComponent(artistName)}`;
    const response = await secureApiCall(`/api/lidarr/artist-status?${query}`);

    if (!response.ok) {
      return { found: false, artistId: null };
    }

    const status = await response.json();
    return {
      found: status.found === true,
      artistId: status.artistId || null
    };
  } catch (error) {
    console.error(`📚 Lidarr artist status error for ${identity}:`, error);
    return { found: false, artistId: null };
  }
}

async function fetchCoverArt(album) {
  try {
    const coverRes = await secureApiCall(`/api/coverart/${album.mbid}`);
    console.log(`🖼️ Cover art response status for ${album.title}:`, coverRes.status);
    
    if (coverRes.ok) {
      const coverData = await coverRes.json();
      console.log(`🖼️ Cover art data for ${album.title}:`, coverData);
      return coverData.images?.[0]?.thumbnails?.large || coverData.images?.[0]?.image;
    }
    return null;
  } catch (error) {
    console.error(`🖼️ Cover art error for ${album.title}:`, error);
    return null;
  }
}

async function checkLidarrStatus(album) {
  try {
    const lidarrRes = await secureApiCall(`/api/lidarr/lookup?mbid=${encodeURIComponent(album.mbid)}&title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist)}`);
    console.log(`📚 Lidarr lookup response status for ${album.title}:`, lidarrRes.status);
    
    if (lidarrRes.ok) {
      const lidarrData = await lidarrRes.json();
      console.log(`📚 Lidarr lookup data for ${album.title}:`, lidarrData);
      
      if (Array.isArray(lidarrData) && lidarrData.length > 0) {
        const albumInfo = lidarrData[0];
        return {
          inLibrary: albumInfo.inLibrary || false,
          fullyAvailable: albumInfo.fullyAvailable || false,
          percentComplete: albumInfo.percentComplete || 0
        };
      }
      return { inLibrary: false, fullyAvailable: false, percentComplete: 0 };
    }
    return { inLibrary: false, fullyAvailable: false, percentComplete: 0 };
  } catch (error) {
    console.error(`📚 Lidarr lookup error for ${album.title}:`, error);
    return { inLibrary: false, fullyAvailable: false, percentComplete: 0 };
  }
}
