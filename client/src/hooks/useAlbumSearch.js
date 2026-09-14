import { useState } from "react";
import { findAlbum } from "../services/albumSearchService.js";
import { enrichAlbumsWithMetadata } from "../services/albumEnrichmentService.js";

export function useAlbumSearch() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const searchAlbums = async (track, artist) => {
    setLoading(true);
    setResults([]);
    setError(null);

    try {
      // Step 1: Find albums
      const topAlbums = await findAlbum(track, artist);
      
      // Step 2: Enrich with metadata (cover art and Lidarr status)
      const enrichedAlbums = await enrichAlbumsWithMetadata(topAlbums);
      
      setResults(enrichedAlbums);
    } catch (err) {
      console.error("💥 Exception in album search:", err);
      setError(err?.message || "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isSameArtist = (album, { artistMbid, artistName } = {}) => {
    if (artistMbid) {
      return album.artistMbid === artistMbid;
    }

    const normalizedName = artistName?.trim().toLocaleLowerCase();
    return normalizedName && album.artist?.trim().toLocaleLowerCase() === normalizedName;
  };

  const beginAlbumAdd = (mbid, artist = {}) => {
    setResults(prev => prev.map(album => {
      if (album.mbid === mbid) {
        return {
          ...album,
          addState: 'adding',
          artistCreationState: artist.creatingArtist ? 'creating' : album.artistCreationState
        };
      }

      if (artist.creatingArtist && isSameArtist(album, artist)) {
        return { ...album, artistCreationState: 'creating' };
      }

      return album;
    }));
  };

  const completeAlbumAdd = (mbid, response = {}, artist = {}) => {
    const percentComplete = response.percentComplete ?? 0;
    const complete = response.state === 'complete' || percentComplete === 100;

    setResults(prev => prev.map(album => {
      const sameArtist = isSameArtist(album, artist);
      const artistState = sameArtist
        ? {
            artistInLidarr: true,
            lidarrArtistId: response.artistId ?? response.id ?? album.lidarrArtistId ?? null,
            artistCreationState: 'ready'
          }
        : {};

      return album.mbid === mbid
        ? {
            ...album,
            ...artistState,
            inLidarr: true,
            inLibrary: true,
            artistInLidarr: true,
            monitored: response.monitored ?? true,
            fullyAvailable: complete,
            percentComplete,
            addState: complete ? 'complete' : 'queued'
          }
        : { ...album, ...artistState };
    }));
  };

  const failAlbumAdd = (mbid, response = {}, artist = {}) => {
    const artistId = response?.artistId ?? response?.id ?? null;
    const artistWasCreated = artistId !== null;

    setResults(prev => prev.map(album => {
      const sameArtist = isSameArtist(album, artist);
      const artistState = sameArtist
        ? {
            artistInLidarr: artistWasCreated ? true : album.artistInLidarr,
            lidarrArtistId: artistWasCreated ? artistId : album.lidarrArtistId,
            artistCreationState: artistWasCreated ? 'ready' : 'error'
          }
        : {};

      return album.mbid === mbid
        ? { ...album, ...artistState, addState: 'error' }
        : { ...album, ...artistState };
    }));
  };

  return {
    loading,
    results,
    error,
    searchAlbums,
    beginAlbumAdd,
    completeAlbumAdd,
    failAlbumAdd
  };
}
