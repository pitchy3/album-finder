import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findAlbum } from '../../services/albumSearchService';

global.fetch = vi.fn();

describe('Album Search Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should find albums by track and artist', async () => {
    // Mock recording search
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        recordings: [{
          title: 'Test Song',
          releases: [{
            id: 'rel-1'
          }]
        }]
      })
    });

    // Mock release lookup
    fetch.mockResolvedValueOnce({
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
    });

    // Mock fallback release group search (empty results)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'release-groups': []
      })
    });

    const results = await findAlbum('Test Song', 'Test Artist');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Test Album');
  });

  it('should prioritize albums over other types', async () => {
    // Mock recording search
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        recordings: [{
          releases: [
            { id: 'rel-1' },
            { id: 'rel-2' }
          ]
        }]
      })
    });

    // Mock first release (Single)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'release-group': {
          id: 'rg-1',
          title: 'Single',
          'primary-type': 'Single',
          'artist-credit': [{ artist: { name: 'Artist' } }]
        }
      })
    });

    // Mock second release (Album)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'release-group': {
          id: 'rg-2',
          title: 'Album',
          'primary-type': 'Album',
          'artist-credit': [{ artist: { name: 'Artist' } }]
        }
      })
    });

    // Mock fallback release group search (empty)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'release-groups': []
      })
    });

    const results = await findAlbum('Test', 'Artist');

    // Album should be ranked higher
    const albumIndex = results.findIndex(r => r.title === 'Album');
    const singleIndex = results.findIndex(r => r.title === 'Single');
    
    expect(albumIndex).toBeLessThan(singleIndex);
  });

  it('should handle search errors', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(findAlbum('Test', 'Artist')).rejects.toThrow();
  });
});