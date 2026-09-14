import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiService.js', () => ({
  secureApiCall: vi.fn()
}));

import { secureApiCall } from '../apiService.js';
import { addToLidarr } from '../lidarrService.js';

const album = {
  mbid: 'album-mbid',
  title: 'Test Album',
  artist: 'Test Artist'
};

function response(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  };
}

describe('addToLidarr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the accepted Lidarr state', async () => {
    secureApiCall.mockResolvedValue(response({
      success: true,
      state: 'queued',
      artistId: 5,
      albumId: 10,
      title: 'Test Album'
    }));

    const result = await addToLidarr(album, '/music');

    expect(result).toMatchObject({
      success: true,
      data: { state: 'queued', artistId: 5, albumId: 10 }
    });
    expect(JSON.parse(secureApiCall.mock.calls[0][1].body)).toMatchObject({
      mbid: 'album-mbid',
      rootFolder: '/music'
    });
  });

  it('rejects a business failure returned with HTTP 200', async () => {
    secureApiCall.mockResolvedValue(response({
      success: false,
      message: 'Album was not added'
    }));

    const result = await addToLidarr(album);

    expect(result).toEqual({
      success: false,
      error: 'Album was not added'
    });
    expect(document.body).toHaveTextContent('Failed to add album to Lidarr');
    expect(document.body).not.toHaveTextContent('Album Added Successfully');
  });

  it('preserves HTTP error details', async () => {
    secureApiCall.mockResolvedValue(response({
      error: 'Lidarr rejected the request'
    }, {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    }));

    const result = await addToLidarr(album);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Lidarr rejected the request');
  });
});
