// client/src/hooks/useArtistSearchStream.js

import { useState, useRef } from "react";

export function useArtistSearchStream() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0, hasMore: false });
  const [artistStatus, setArtistStatus] = useState(null);
  const eventSourceRef = useRef(null);
  const errorMessageRef = useRef(null); // Track if we received a specific error message

  const searchArtistReleases = async (artistName, preferences = {}) => {
    if (!artistName.trim()) return;

    // Reset state
    setLoading(true);
    setError(null);
    setResults([]);
    setProgress({ loaded: 0, total: 0, hasMore: true });
    setArtistStatus(null);
    errorMessageRef.current = null; // Reset error tracking

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const searchParams = new URLSearchParams({
        artist: artistName.trim(),
        limit: preferences.artistReleaseLimit || 50,
      });

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

      console.log("🎤 Starting streaming artist search:", { artist: artistName, preferences });

      const eventSource = new EventSource(
        `/api/musicbrainz/release-group/stream?${searchParams}`,
        { withCredentials: true }
      );
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('start', (event) => {
        const data = JSON.parse(event.data);
        console.log("📡 Stream started:", data);
        setProgress({ loaded: 0, total: data.totalRequested, hasMore: true });
      });

      eventSource.addEventListener('artist-status', (event) => {
        const data = JSON.parse(event.data);
        console.log("🎵 Artist status:", data);
        setArtistStatus(data);
      });

      eventSource.addEventListener('batch', (event) => {
        const data = JSON.parse(event.data);
        console.log(`📦 Received batch #${data.batchNumber || '?'}: ${data.releases.length} releases`);
        
        // Append new releases and sort
        setResults(prev => {
          const combined = [...prev, ...data.releases];
          
          // Sort by release date (newest first)
          return combined.sort((a, b) => {
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
        });
        
        setProgress({
          loaded: data.total,
          total: preferences.artistReleaseLimit === 'all' 
            ? 500 
            : preferences.artistReleaseLimit,
          hasMore: data.hasMore
        });
      });

      eventSource.addEventListener('complete', (event) => {
        const data = JSON.parse(event.data);
        console.log("✅ Stream complete:", data);
        setLoading(false);
        setProgress(prev => ({ ...prev, hasMore: false }));
        eventSource.close();
      });

      // Handle error events sent by the server
      eventSource.addEventListener('error', (event) => {
        try {
          // Try to parse error data sent by server
          const data = event.data ? JSON.parse(event.data) : null;
          if (data && data.message) {
            console.error("❌ Stream error:", data);
            errorMessageRef.current = data.message;
            setError(data.message);
            setLoading(false);
            eventSource.close();
          }
        } catch (parseError) {
          // If parsing fails, this will be handled by onerror below
          console.warn("⚠️ Could not parse error event data:", parseError);
        }
      });

      // Handle EventSource connection errors (fallback)
      eventSource.onerror = (event) => {
        console.error("❌ EventSource connection error:", event);
        
        // Only set generic error if we haven't already set a specific one
        if (!errorMessageRef.current) {
          // Check the connection state to provide better error messages
          if (eventSource.readyState === EventSource.CONNECTING) {
            errorMessageRef.current = 'Connecting to search service...';
            // Don't set error or stop loading yet - might reconnect
            console.log("⏳ EventSource attempting to reconnect...");
          } else if (eventSource.readyState === EventSource.CLOSED) {
            errorMessageRef.current = 'Unable to connect to search service. Please check your connection and try again.';
            setError(errorMessageRef.current);
            setLoading(false);
          } else {
            errorMessageRef.current = 'An unexpected error occurred. Please try again.';
            setError(errorMessageRef.current);
            setLoading(false);
          }
        } else {
          // We already have a specific error message, just stop loading
          setLoading(false);
        }
        
        // Close the connection if it's in CLOSED state
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
        }
      };

    } catch (err) {
      console.error("Artist search stream initialization error:", err);
      const errorMessage = err.message || 'Failed to start artist search. Please try again.';
      errorMessageRef.current = errorMessage;
      setError(errorMessage);
      setLoading(false);
    }
  };

  const cancelSearch = () => {
    if (eventSourceRef.current) {
      console.log("🛑 Cancelling artist search...");
      eventSourceRef.current.close();
      setLoading(false);
      errorMessageRef.current = null;
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
    progress,
    artistStatus,
    searchArtistReleases,
    cancelSearch,
    updateArtistAlbumLidarrStatus
  };
}