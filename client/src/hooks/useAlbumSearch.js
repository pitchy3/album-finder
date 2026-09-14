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

  const beginAlbumAdd = (mbid) => {
    setResults(prev => prev.map(album => 
      album.mbid === mbid ? { ...album, addState: 'adding' } : album
    ));
  };

  const completeAlbumAdd = (mbid, response = {}) => {
    const percentComplete = response.percentComplete ?? 0;
    const complete = response.state === 'complete' || percentComplete === 100;

    setResults(prev => prev.map(album =>
      album.mbid === mbid
        ? {
            ...album,
            inLidarr: true,
            inLibrary: true,
            artistInLidarr: true,
            monitored: response.monitored ?? true,
            fullyAvailable: complete,
            percentComplete,
            addState: complete ? 'complete' : 'queued'
          }
        : album
    ));
  };

  const failAlbumAdd = (mbid) => {
    setResults(prev => prev.map(album =>
      album.mbid === mbid ? { ...album, addState: 'error' } : album
    ));
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
