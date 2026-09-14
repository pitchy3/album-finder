import Fuse from "fuse.js";

// In-memory cache for release group tracklists
const releaseCache = {};

async function searchRecordings(track, artist) {
  console.log("🔡 Step 1: Optimized MusicBrainz recording search");
  const recQuery = `recording:"${track}" AND artistname:"${artist}"`; // More specific query
  const recUrl = `/api/musicbrainz/recording?query=${encodeURIComponent(recQuery)}&limit=10`; // Reduced limit
  
  console.log("🔗 Recording search URL:", recUrl);

  const recRes = await fetch(recUrl);
  console.log("📈 Recording search response status:", recRes.status);
  
  // Handle authentication redirect
  if (recRes.status === 401 || (recRes.status === 302 && recRes.headers.get('Location')?.includes('/auth/login'))) {
    window.location.href = '/auth/login';
    return null;
  }
  
  if (!recRes.ok) {
    const errorData = await recRes.json().catch(() => ({ error: "Unknown error" }));
    console.error("❌ Recording search failed with status:", recRes.status, errorData);
    throw new Error(`Recording search failed: ${errorData.error || recRes.statusText}`);
  }

  const recData = await recRes.json();
  console.log("📊 Recording search results:", recData);
  console.log("📊 Number of recordings found:", recData.recordings?.length || 0);
  
  return recData.recordings || [];
}

async function processRecordings(recordings, artist, track) {
  console.log("🔍 Processing recordings for album matches with type prioritization");
  const albumSet = new Set(); // To avoid duplicates
  const foundAlbums = [];
  
  for (const [recIndex, recording] of recordings.entries()) {
    console.log(`🎵 Processing recording ${recIndex + 1}:`, recording.title);
    
    if (recording.releases) {
      console.log(`💿 Found ${recording.releases.length} releases for recording`);
      
      for (const [relIndex, release] of recording.releases.entries()) {
        try {
          console.log(`💿 Processing release ${relIndex + 1}:`, release.title);
          const releaseUrl = `/api/musicbrainz/release/${release.id}?inc=release-groups`;
          const releaseRes = await fetch(releaseUrl);
          
          if (!releaseRes.ok) {
            console.warn(`⚠️ Release lookup failed for ${release.id}:`, releaseRes.status);
            continue;
          }
          
          const releaseDetail = await releaseRes.json();
          console.log(`💿 Release details:`, releaseDetail);
          const releaseGroup = releaseDetail["release-group"];
          
          if (releaseGroup) {
            console.log(`💿 Release group:`, releaseGroup);
            console.log(`💿 Primary type:`, releaseGroup["primary-type"]);
          }
          
          if (
            releaseGroup &&
            releaseGroup["primary-type"] &&
            !albumSet.has(releaseGroup.id)
          ) {
            console.log(`✅ Found release match:`, releaseGroup.title, `(${releaseGroup["primary-type"]})`);
            albumSet.add(releaseGroup.id);
            
            const confidence = calculateConfidence(releaseGroup, artist, track);
            
            foundAlbums.push({
              mbid: releaseGroup.id,
              title: releaseGroup.title,
              artist: releaseGroup["artist-credit"]?.[0]?.artist?.name || artist,
              artistMbid: releaseGroup["artist-credit"]?.[0]?.artist?.id || null,
              score: confidence,
              releaseType: releaseGroup["primary-type"]?.toLowerCase() || 'unknown'
            });
            
            // OPTIMIZATION: Early termination for high-confidence matches
            const hasGoodAlbums = foundAlbums.filter(a => a.releaseType === 'album' && a.score > 0.8).length;
            if (foundAlbums.length >= 3 && (confidence > 0.9 || hasGoodAlbums >= 2)) {
              console.log("🎯 Found sufficient high-confidence results, stopping early");
              break;
            }
          }
        } catch (releaseError) {
          console.error(`❌ Error processing release ${release.id}:`, releaseError);
          continue;
        }
      }
    }
    
    // OPTIMIZATION: Stop processing if we have enough good results
    const hasGoodAlbums = foundAlbums.filter(a => a.releaseType === 'album' && a.score > 0.8).length;
    if (foundAlbums.length >= 3 && (foundAlbums.some(a => a.score > 0.9) || hasGoodAlbums >= 2)) {
      console.log("🎯 Found sufficient high-confidence albums, stopping recording search");
      break;
    }
  }
  
  return foundAlbums;
}

async function fallbackReleaseGroupSearch(track, artist, foundAlbums) {
  const goodAlbums = foundAlbums.filter(a => a.releaseType === 'album' && a.score > 0.8);
  if (foundAlbums.length >= 3 || goodAlbums.length >= 2) {
    console.log("🎯 Skipping release group search - sufficient high-quality results found");
    return foundAlbums;
  }

  console.log(`🔡 Step 2: Fallback release group search (need ${3 - foundAlbums.length} more, have ${goodAlbums.length} good albums)`);
  const rgQuery = `artist:"${artist}"`; // Remove type filter to get all release types
  const rgUrl = `/api/musicbrainz/release-group?query=${encodeURIComponent(rgQuery)}&limit=15`; // Reduced limit
  
  console.log("🔗 Release group search URL:", rgUrl);
  const rgRes = await fetch(rgUrl);
  console.log("📈 Release group search response status:", rgRes.status);
  
  if (!rgRes.ok) {
    const errorData = await rgRes.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(`Release-group search failed: ${errorData.error || rgRes.statusText}`);
  }
  
  const rgData = await rgRes.json();
  console.log("📊 Release group search results:", rgData);
  console.log("📊 Number of release groups found:", rgData["release-groups"]?.length || 0);

  const albumSet = new Set(foundAlbums.map(a => a.mbid)); // Avoid duplicates
  
  for (const [rgIndex, rg] of (rgData["release-groups"] || []).entries()) {
    if (albumSet.has(rg.id) || foundAlbums.length >= 5) {
      console.log(`⏭️ Skipping release group ${rg.title} (duplicate or limit reached)`);
      continue;
    }
    
    console.log(`💿 Processing release group ${rgIndex + 1}:`, rg.title, `(${rg["primary-type"]})`);
    const rgId = rg.id;
    let tracks;

    if (releaseCache[rgId]) {
      console.log(`💾 Using cached tracks for ${rg.title}`);
      tracks = releaseCache[rgId].tracks;
    } else {
      console.log(`🔡 Fetching tracks for ${rg.title}`);
      const releasesUrl = `/api/musicbrainz/release?release-group=${rgId}&inc=recordings`;
      const releasesRes = await fetch(releasesUrl);
      if (!releasesRes.ok) {
        console.warn(`⚠️ Releases fetch failed for ${rg.title}:`, releasesRes.status);
        continue;
      }
      const releasesData = await releasesRes.json();
      console.log(`📊 Releases data for ${rg.title}:`, releasesData);
      
      tracks = [];
      for (const release of releasesData.releases || []) {
        for (const medium of release.media || []) {
          for (const t of medium.tracks || []) {
            tracks.push(t.title);
          }
        }
      }
      console.log(`🎵 Extracted ${tracks.length} tracks for ${rg.title}:`, tracks);
      releaseCache[rgId] = { tracks };
    }

    // Fuzzy search for the track inside this release-group
    console.log(`🔍 Fuzzy searching for "${track}" in ${tracks.length} tracks`);
    const fuse = new Fuse(tracks, { includeScore: true, threshold: 0.4 });
    const fRes = fuse.search(track);
    console.log(`🔍 Fuzzy search results:`, fRes);
    
    if (fRes.length > 0) {
      let confidence = 1 - fRes[0].score; // Convert Fuse score to confidence (0.6 base)
      confidence = applyReleaseTypeConfidence(confidence, rg, track, artist);
      
      // Cap confidence at 1.0
      confidence = Math.min(confidence, 1.0);
      
      console.log(`✅ Found fuzzy match in ${rg.title} (${rg["primary-type"]}) with confidence:`, confidence);
      albumSet.add(rgId);
      foundAlbums.push({
        mbid: rgId,
        title: rg.title,
        artist: rg["artist-credit"]?.[0]?.artist?.name || artist,
        artistMbid: rg["artist-credit"]?.[0]?.artist?.id || null,
        score: confidence,
        releaseType: rg["primary-type"]?.toLowerCase() || 'unknown'
      });
      
      // OPTIMIZATION: Early termination if we found a good match
      const hasGoodAlbums = foundAlbums.filter(a => a.releaseType === 'album' && a.score > 0.8).length;
      if (foundAlbums.length >= 3 && (confidence > 0.8 || hasGoodAlbums >= 1)) {
        console.log("🎯 Found sufficient albums with good confidence, stopping");
        break;
      }
    } else {
      console.log(`❌ No fuzzy match found in ${rg.title}`);
    }
  }
  
  return foundAlbums;
}

function calculateConfidence(releaseGroup, artist, track) {
  // Calculate confidence score based on exact matches and release type priority
  let confidence = 0.6; // Base confidence for direct recording match
  
  confidence = applyReleaseTypeConfidence(confidence, releaseGroup, track, artist);
  
  // Additional matching bonuses
  if (releaseGroup.title.toLowerCase().includes(track.toLowerCase())) {
    confidence += 0.05;
  }
  if (releaseGroup["artist-credit"]?.[0]?.artist?.name?.toLowerCase() === artist.toLowerCase()) {
    confidence += 0.05;
  }
  
  return confidence;
}

function applyReleaseTypeConfidence(confidence, releaseGroup, track, artist) {
  // Release type priority scoring
  const primaryType = releaseGroup["primary-type"]?.toLowerCase();
  switch (primaryType) {
    case "album":
      confidence += 0.3; // Highest priority
      break;
    case "single":
      confidence += 0.2;
      break;
    case "ep":
      confidence += 0.15;
      break;
    default:
      confidence += 0.00; // Unknown types get minimal boost
  }
  
  const secondaryTypes = releaseGroup["secondary-types"] || [];
  
  if (Array.isArray(secondaryTypes) && secondaryTypes.length > 0) {
    console.log("Secondary types:", secondaryTypes);
  
    for (const type of secondaryTypes) {
      const normalized = type.toLowerCase();
      switch (normalized) {
        case "compilation":
          confidence += -0.2; // Strong penalty for compilations
          break;
        case "remix":
          confidence += -0.2; // Smaller penalty for remixes
          break;
        case "live":
          confidence += -0.05; // Smaller penalty for live albums
          break;
        default:
          confidence += 0.0; // Unknown types = no change
      }
    }
  } else {
    console.log("No secondary types found");
  }
  
  return confidence;
}

export async function findAlbum(track, artist) {
  console.log("🔍 Starting optimized album search with release type prioritization");
  console.log("🎵 Track:", track);
  console.log("🎤 Artist:", artist);
  
  try {
    // Step 1: Optimized recording search with type prioritization
    const recordings = await searchRecordings(track, artist);
    let foundAlbums = [];

    if (recordings.length > 0) {
      foundAlbums = await processRecordings(recordings, artist, track);
      console.log(`📊 Found ${foundAlbums.length} releases from recording search`);
    }

    // Step 2: Conditional fallback search with type prioritization
    foundAlbums = await fallbackReleaseGroupSearch(track, artist, foundAlbums);

    console.log(`📊 Total releases found: ${foundAlbums.length}`);
    console.log("🏆 All found releases:", foundAlbums);

    // Sort by confidence score and take top 3
    foundAlbums.sort((a, b) => b.score - a.score);
    const topAlbums = foundAlbums.slice(0, 3);
    console.log("🥇 Top 3 releases:", topAlbums);

    if (topAlbums.length === 0) {
      throw new Error("No matching releases found");
    }

    return topAlbums;
  } catch (error) {
    console.error("💥 Exception in findAlbum:", error);
    throw error;
  }
}