import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiService.js', () => ({
  secureApiCall: vi.fn()
}));

import { secureApiCall } from '../apiService.js';
import { enrichAlbumsWithMetadata } from '../albumEnrichmentService.js';

function jsonResponse(data, ok = true) {
  return { ok, json: vi.fn().mockResolvedValue(data) };
}

describe('enrichAlbumsWithMetadata artist status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distinguishes an existing artist from an album missing in Lidarr', async () => {
    secureApiCall.mockImplementation(url => {
      if (url.includes('/coverart/')) {
        return Promise.resolve(jsonResponse({ images: [] }));
      }
      if (url.includes('/lidarr/lookup')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/lidarr/artist-status')) {
        return Promise.resolve(jsonResponse({ found: true, artistId: 42 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const [result] = await enrichAlbumsWithMetadata([{
      mbid: 'album-mbid',
      title: 'New Album',
      artist: 'Existing Artist'
    }]);

    expect(result).toMatchObject({
      inLidarr: false,
      artistInLidarr: true,
      lidarrArtistId: 42
    });
  });

  it('deduplicates artist-status requests across results by the same artist', async () => {
    secureApiCall.mockImplementation(url => {
      if (url.includes('/coverart/')) {
        return Promise.resolve(jsonResponse({ images: [] }));
      }
      if (url.includes('/lidarr/lookup')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/lidarr/artist-status')) {
        return Promise.resolve(jsonResponse({ found: false, artistId: null }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await enrichAlbumsWithMetadata([
      { mbid: 'album-1', title: 'One', artist: 'Same Artist' },
      { mbid: 'album-2', title: 'Two', artist: 'same artist' }
    ]);

    const artistCalls = secureApiCall.mock.calls
      .filter(([url]) => url.includes('/lidarr/artist-status'));
    expect(artistCalls).toHaveLength(1);
  });

  it('keeps album membership authoritative when artist status is unavailable', async () => {
    secureApiCall.mockImplementation(url => {
      if (url.includes('/coverart/')) {
        return Promise.resolve(jsonResponse({ images: [] }));
      }
      if (url.includes('/lidarr/lookup')) {
        return Promise.resolve(jsonResponse([{
          inLibrary: true,
          fullyAvailable: false,
          percentComplete: 25
        }]));
      }
      if (url.includes('/lidarr/artist-status')) {
        return Promise.resolve(jsonResponse({}, false));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const [result] = await enrichAlbumsWithMetadata([{
      mbid: 'album-mbid',
      title: 'Known Album',
      artist: 'Known Artist'
    }]);

    expect(result.artistInLidarr).toBe(true);
    expect(result.inLidarr).toBe(true);
  });
});
