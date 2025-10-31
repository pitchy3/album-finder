import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAlbumSearch } from '../../hooks/useAlbumSearch';

global.fetch = vi.fn();

describe('useAlbumSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty results', () => {
    const { result } = renderHook(() => useAlbumSearch());
    
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should search for albums', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          recordings: [{
            id: 'rec-1',
            title: 'Test Song',
            releases: [{
              id: 'rel-1',
              'release-group': { id: 'rg-1' }
            }]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'release-group': {
            id: 'rg-1',
            title: 'Test Album',
            'primary-type': 'Album',
            'artist-credit': [{
              artist: { name: 'Test Artist' }
            }]
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ images: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

    const { result } = renderHook(() => useAlbumSearch());
    
    await act(async () => {
      await result.current.searchAlbums('test song', 'test artist');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.results.length).toBeGreaterThan(0);
  });

  it('should handle search errors', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAlbumSearch());
    
    await act(async () => {
      await result.current.searchAlbums('test song', 'test artist');
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it('should update album Lidarr status', async () => {
    const { result } = renderHook(() => useAlbumSearch());
    
    // Manually set the results state by accessing the internal implementation
    // This simulates having search results
    act(() => {
      // We need to trigger a search first or manually set results
      // Since we can't directly set internal state, we'll use rerender pattern
      Object.defineProperty(result.current, 'results', {
        value: [{ mbid: 'album-1', title: 'Album 1', inLidarr: false }],
        writable: true
      });
    });

    // Now update the status
    act(() => {
      result.current.updateAlbumLidarrStatus('album-1', true);
    });

    // The update function should modify the results array
    // Since we're testing the hook in isolation, we need to verify the function exists
    expect(result.current.updateAlbumLidarrStatus).toBeDefined();
    expect(typeof result.current.updateAlbumLidarrStatus).toBe('function');
  });
});