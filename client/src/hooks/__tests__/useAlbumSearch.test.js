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

    const mbid = result.current.results[0].mbid;
    act(() => result.current.beginAlbumAdd(mbid));
    expect(result.current.results[0].addState).toBe('adding');

    act(() => result.current.completeAlbumAdd(mbid, {
      state: 'queued',
      monitored: true,
      percentComplete: 0
    }));
    expect(result.current.results[0]).toMatchObject({
      inLidarr: true,
      fullyAvailable: false,
      addState: 'queued'
    });
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

  it('should expose lifecycle actions for album additions', async () => {
    const { result } = renderHook(() => useAlbumSearch());

    expect(result.current.beginAlbumAdd).toBeTypeOf('function');
    expect(result.current.completeAlbumAdd).toBeTypeOf('function');
    expect(result.current.failAlbumAdd).toBeTypeOf('function');
  });
});
