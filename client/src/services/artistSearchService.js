export async function searchArtistReleases(artistName) {
  console.log("🎤 Starting artist release search");
  console.log("🎤 Artist:", artistName);
  
  try {
    // Step 1: Search for release groups by artist
    const rgQuery = `artist:"${artistName}"`;
    const rgUrl = `/api/musicbrainz/release-group?query=${encodeURIComponent(rgQuery)}&limit=50`; // Higher limit for browsing
    
    console.log("🔗 Release group search URL:", rgUrl);

    const rgRes = await fetch(rgUrl);
    console.log("📈 Release group search response status:", rgRes.status);
    
    // Handle authentication redirect
    if (rgRes.status === 401 || (rgRes.status === 302 && rgRes.headers.get('Location')?.includes('/auth/login'))) {
      window.location.href = '/auth/login';
      return null;
    }
    
    if (!rgRes.ok) {
      const errorData = await rgRes.json().catch(() => ({ error: "Unknown error" }));
      console.error("❌ Release group search failed with status:", rgRes.status, errorData);
      throw new Error(`Artist search failed: ${errorData.error || rgRes.statusText}`);
    }

    const rgData = await rgRes.json();
    console.log("📊 Release group search results:", rgData);
    console.log("📊 Number of release groups found:", rgData["release-groups"]?.length || 0);
    
    const releaseGroups = rgData["release-groups"] || [];
    
    if (releaseGroups.length === 0) {
      throw new Error("No releases found for this artist");
    }

    // Step 2: Process and categorize releases
    const processedReleases = releaseGroups.map(rg => {
      const confidence = calculateArtistMatchConfidence(rg, artistName);
      
      return {
        mbid: rg.id,
        title: rg.title,
        artist: rg["artist-credit"]?.[0]?.artist?.name || artistName,
        score: confidence,
        releaseType: rg["primary-type"]?.toLowerCase() || 'unknown',
        secondaryTypes: rg["secondary-types"] || [],
        releaseDate: rg["first-release-date"] || null
      };
    });

    // Step 3: Sort releases by type priority and then by date (newest first)
    const sortedReleases = processedReleases.sort((a, b) => {
      // First sort by type priority
      const typeOrder = { 'album': 0, 'ep': 1, 'single': 2, 'unknown': 3 };
      const aTypeOrder = typeOrder[a.releaseType] ?? 99;
      const bTypeOrder = typeOrder[b.releaseType] ?? 99;
      
      if (aTypeOrder !== bTypeOrder) {
        return aTypeOrder - bTypeOrder;
      }
      
      // Then sort by date (newest first)
      if (a.releaseDate && b.releaseDate) {
        return new Date(b.releaseDate) - new Date(a.releaseDate);
      } else if (a.releaseDate) {
        return -1;
      } else if (b.releaseDate) {
        return 1;
      }
      
      // Finally sort by confidence
      return b.score - a.score;
    });

    console.log("🏆 Processed and sorted releases:", sortedReleases);
    return sortedReleases;

  } catch (error) {
    console.error("💥 Exception in searchArtistReleases:", error);
    throw error;
  }
}

function calculateArtistMatchConfidence(releaseGroup, searchArtist) {
  let confidence = 0.7; // Base confidence for artist match
  
  // Artist name exact match bonus
  const artistCredit = releaseGroup["artist-credit"]?.[0]?.artist?.name || "";
  if (artistCredit.toLowerCase() === searchArtist.toLowerCase()) {
    confidence += 0.2;
  } else if (artistCredit.toLowerCase().includes(searchArtist.toLowerCase())) {
    confidence += 0.1;
  }
  
  // Release type priority scoring
  const primaryType = releaseGroup["primary-type"]?.toLowerCase();
  switch (primaryType) {
    case "album":
      confidence += 0.1; // Albums get slight priority
      break;
    case "single":
    case "ep":
      confidence += 0.05;
      break;
    default:
      confidence += 0.0;
  }
  
  // Penalize certain secondary types
  const secondaryTypes = releaseGroup["secondary-types"] || [];
  for (const type of secondaryTypes) {
    const normalized = type.toLowerCase();
    switch (normalized) {
      case "compilation":
        confidence -= 0.1; // Slight penalty for compilations
        break;
      case "remix":
        confidence -= 0.05; // Small penalty for remixes
        break;
      case "live":
        confidence -= 0.02; // Very small penalty for live albums
        break;
    }
  }
  
  return Math.max(0.1, Math.min(1.0, confidence)); // Clamp between 0.1 and 1.0
}
