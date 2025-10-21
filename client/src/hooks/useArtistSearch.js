// client/src/hooks/useArtistSearch.js - Updated with artist monitoring optimization
import { useState } from "react";

export function useArtistSearch() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const searchArtistReleases = async (artistName, preferences = {}) => {
    if (!artistName.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      // Build search parameters with preferences
      const searchParams = new URLSearchParams({
        artist: artistName.trim(),
        limit: preferences.artistReleaseLimit || 50,
      });

      // Add category filters if not all categories are selected
      if (preferences.artistReleaseCategories && !preferences.artistReleaseCategories.all) {
        const categories = [];
        if (preferences.artistReleaseCategories.albums) categories.push('album');
        if (preferences.artistReleaseCategories.eps) categories.push('ep');
        if (preferences.artistReleaseCategories.singles) categories.push('single');
        if (preferences.artistReleaseCategories.other) categories.push('other');
        
        if (categories.length > 0) {
          searchParams.append('categories', categories.join(','));
        }
      }

      console.log("🎤 Artist search with preferences:", {
        artist: artistName,
        limit: preferences.artistReleaseLimit,
        categories: preferences.artistReleaseCategories
      });

      // Search for the artist's releases
      const releaseResponse = await fetch(`/api/musicbrainz/release-group?${searchParams}`, {
        credentials: 'include'
      });

      if (!releaseResponse.ok) {
        throw new Error(`Release search failed: ${releaseResponse.status} ${releaseResponse.statusText}`);
      }

      const releaseData = await releaseResponse.json();
      console.log("🎼 MusicBrainz release-group results:", releaseData);

      if (!releaseData['release-groups'] || releaseData['release-groups'].length === 0) {
        setResults([]);
        return;
      }

      // ✨ OPTIMIZATION: Check if artist is in Lidarr first
      let artistInLidarr = false;
      let monitoredArtistMbid = null;
      
      // Extract the artist's MBID from the first release
      const firstRelease = releaseData['release-groups'][0];
      if (firstRelease && firstRelease['artist-credit'] && firstRelease['artist-credit'][0]) {
        const artistCredit = firstRelease['artist-credit'][0];
        if (artistCredit.artist && artistCredit.artist.id) {
          monitoredArtistMbid = artistCredit.artist.id;
        }
      }

      try {
        // Check if this artist is already in Lidarr
        const artistCheckResponse = await fetch(`/api/lidarr/artist-status?mbid=${monitoredArtistMbid}&name=${encodeURIComponent(artistName)}`, {
          credentials: 'include'
        });
        
        if (artistCheckResponse.ok) {
          const artistStatus = await artistCheckResponse.json();
          artistInLidarr = artistStatus.found || false;
          console.log(`🎵 Artist "${artistName}" already in Lidarr:`, artistInLidarr);
        } else {
          console.log(`🔍 Artist status check failed, assuming not monitored:`, artistCheckResponse.status);
        }
      } catch (artistCheckError) {
        console.warn(`⚠️ Could not check artist monitoring status, assuming in Lidarr and checking just in case:`, artistCheckError);
        artistInLidarr = true;
      }

      let lidarrResults = [];

      if (artistInLidarr) {
        console.log("✅ Artist is in Lidarr - checking album statuses");
        
        // Artist is in Lidarr, so check Lidarr status for all albums in parallel
        const lidarrPromises = releaseData['release-groups'].map(async (release) => {
          try {
            const lidarrResponse = await fetch(`/api/lidarr/lookup?mbid=${release.id}&title=${encodeURIComponent(release.title)}&artist=${encodeURIComponent(artistName)}`, {
              credentials: 'include'
            });

            if (lidarrResponse.ok) {
              const lidarrData = await lidarrResponse.json();
              return lidarrData.length > 0 ? lidarrData[0] : null;
            }
          } catch (error) {
            console.warn(`Lidarr lookup failed for ${release.title}:`, error);
          }
          return null;
        });

        lidarrResults = await Promise.all(lidarrPromises);
      } else {
        console.log("⏭️ Artist is not in Lidarr - skipping individual album checks");
        
        // Artist is not in Lidarr, so all albums are definitely not in Lidarr
        // Create array of null results matching the number of releases
        lidarrResults = new Array(releaseData['release-groups'].length).fill(null);
      }

      // Get cover art for all albums in parallel (regardless of Lidarr status)
      const coverArtPromises = releaseData['release-groups'].map(async (release) => {
        try {
          const coverResponse = await fetch(`/api/coverart/${release.id}`, {
            credentials: 'include'
          });
		  
		  if (coverResponse.status === 404) {
            console.log(`🖼️ Cover art not found for album "${release.title}"`);
            return null; // fallback to no cover
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
          console.log(`Cover art lookup failed for ${release.title}:`);
        }
        return null;
      });

      const coverArtResults = await Promise.all(coverArtPromises);

      // Process and format results
      const processedResults = releaseData['release-groups']
        .map((release, index) => {
          const lidarrInfo = lidarrResults[index];
          const coverUrl = coverArtResults[index];

          // Apply category filtering if specified
          if (preferences.artistReleaseCategories && !preferences.artistReleaseCategories.all) {
            const releaseType = release['primary-type']?.toLowerCase() || 'other';
            const categories = preferences.artistReleaseCategories;
            
            if (releaseType === 'album' && !categories.albums) return null;
            if (releaseType === 'ep' && !categories.eps) return null;
            if (releaseType === 'single' && !categories.singles) return null;
            if (!['album', 'ep', 'single'].includes(releaseType) && !categories.other) return null;
          }

          return {
            mbid: release.id,
            title: release.title,
            artist: release['artist-credit']?.[0]?.name || artistName,
            releaseDate: release['first-release-date'],
            releaseType: release['primary-type']?.toLowerCase() || 'unknown',
            secondaryTypes: release['secondary-types'] || [],
            score: 1.0, // Perfect match since we're searching by exact artist
            coverUrl,
            // If artist is not monitored, all albums are definitely not in Lidarr
            inLidarr: artistInLidarr ? (lidarrInfo?.inLibrary || false) : false,
            fullyAvailable: artistInLidarr ? (lidarrInfo?.fullyAvailable || false) : false,
            percentComplete: artistInLidarr ? (lidarrInfo?.percentComplete || 0) : 0
          };
        })
        .filter(Boolean) // Remove null entries from category filtering
        .sort((a, b) => {
          // Sort by release date (newest first), then by title
          if (a.releaseDate && b.releaseDate) {
            return b.releaseDate.localeCompare(a.releaseDate);
          } else if (a.releaseDate) {
            return -1;
          } else if (b.releaseDate) {
            return 1;
          } else {
            return a.title.localeCompare(b.title);
          }
        });

      // Apply limit after filtering and sorting
      const limitedResults = preferences.artistReleaseLimit === 'all' 
        ? processedResults 
        : processedResults.slice(0, parseInt(preferences.artistReleaseLimit) || 50);

      console.log(`🎯 Processed ${limitedResults.length} releases for artist search`);
      console.log(`⚡ Performance: Artist monitored=${artistInLidarr}, Lidarr calls saved=${artistInLidarr ? 0 : releaseData['release-groups'].length}`);
      
      setResults(limitedResults);

    } catch (err) {
      console.error("Artist search error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateArtistAlbumLidarrStatus = (mbid, inLidarr) => {
    setResults(prev =>
      prev.map(album =>
        album.mbid === mbid
          ? { ...album, inLidarr, fullyAvailable: inLidarr }
          : album
      )
    );
  };

  return {
    loading,
    results,
    error,
    searchArtistReleases,
    updateArtistAlbumLidarrStatus
  };
}