global.fetch = jest.fn();

jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => next()
}));

jest.mock('../../../services/queue', () => ({
  queuedApiCall: jest.fn()
}));

jest.mock('../../../services/cache', () => ({
  cachedFetch: jest.fn()
}));

jest.mock('../../../services/rateLimit', () => ({
  rateLimitedFetch: jest.fn((url, options) => global.fetch(url, options))
}));

jest.mock('../../../services/lidarr/lidarrClient', () => ({
  LidarrClient: class MockLidarrClient {
    static validateConfig() {}
  }
}));

jest.mock('../../../services/lidarr/artistService', () => ({
  ArtistService: class MockArtistService {
    findByMbid() {
      return Promise.resolve({
        id: 7,
        artistName: 'Test Artist',
        foreignArtistId: 'artist-mbid',
        monitored: false
      });
    }
  }
}));

jest.mock('../../../services/lidarr/albumService', () => ({
  AlbumService: class MockAlbumService {
    getAllWithCoverArt() {
      return Promise.resolve(new Map([[
        'known-album',
        {
          inLibrary: true,
          fullyAvailable: false,
          percentComplete: 50,
          title: 'Known Album',
          coverUrl: 'https://lidarr.test/known.jpg',
          albumType: 'Album',
          secondaryTypes: []
        }
      ]]));
    }
  }
}));

const express = require('express');
const request = require('supertest');
const musicbrainzRoutes = require('../musicbrainz');

describe('MusicBrainz catalog with Lidarr status overlay', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/musicbrainz', musicbrainzRoutes);
    global.fetch.mockReset();
  });

  it('falls back to the Lidarr catalog when the initial MusicBrainz request fails', async () => {
    global.fetch.mockImplementation(url => {
      if (url.includes('/ws/2/artist/')) {
        return Promise.resolve(jsonResponse({
          artists: [{ id: 'artist-mbid', name: 'Test Artist' }]
        }));
      }

      if (url.includes('/ws/2/release-group?')) {
        return Promise.resolve(jsonResponse({}, 503));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const response = await request(app)
      .get('/api/musicbrainz/release-group/stream')
      .query({ artist: 'Test Artist', limit: 50 })
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: batch');
    expect(response.text).toContain('Known Album');
    expect(response.text).toContain('"source":"lidarr-fallback"');
    expect(response.text).toContain('"degraded":true');
    expect(response.text).not.toContain('event: error');
  });

  it('emits an error instead of clean completion when a later catalog page fails', async () => {
    let catalogRequests = 0;
    const releases = Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? 'known-album' : `album-${index}`,
      title: `Album ${index}`,
      'primary-type': 'Album',
      'artist-credit': [{ name: 'Test Artist' }]
    }));

    global.fetch.mockImplementation(url => {
      if (url.includes('/ws/2/artist/')) {
        return Promise.resolve(jsonResponse({
          artists: [{ id: 'artist-mbid', name: 'Test Artist' }]
        }));
      }

      if (url.includes('/ws/2/release-group?')) {
        catalogRequests += 1;
        return Promise.resolve(catalogRequests === 1
          ? jsonResponse({ 'release-groups': releases })
          : jsonResponse({}, 503));
      }

      if (url.includes('coverartarchive.org/release-group/')) {
        return Promise.resolve(jsonResponse({}, 404));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const response = await request(app)
      .get('/api/musicbrainz/release-group/stream')
      .query({ artist: 'Test Artist', limit: 101 })
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: batch');
    expect(response.text).toContain('event: error');
    expect(response.text).toContain('MusicBrainz catalog request failed (HTTP 503)');
    expect(response.text).toContain('"partialResults":100');
    expect(response.text).not.toContain('event: complete');
  });

  it('keeps MusicBrainz-only releases visible for an existing artist', async () => {
    global.fetch.mockImplementation(url => {
      if (url.includes('/ws/2/artist/')) {
        return Promise.resolve(jsonResponse({
          artists: [{ id: 'artist-mbid', name: 'Test Artist' }]
        }));
      }

      if (url.includes('/ws/2/release-group?')) {
        return Promise.resolve(jsonResponse({
          'release-groups': [
            {
              id: 'known-album',
              title: 'Known Album',
              'primary-type': 'Album',
              'artist-credit': [{ name: 'Test Artist' }]
            },
            {
              id: 'missing-album',
              title: 'Discoverable Album',
              'primary-type': 'Album',
              'artist-credit': [{ name: 'Test Artist' }]
            },
            {
              id: 'broadcast-album',
              title: 'Radio Session',
              'primary-type': 'Broadcast',
              'artist-credit': [{ name: 'Test Artist' }]
            }
          ]
        }));
      }

      if (
        url.includes('coverartarchive.org/release-group/missing-album') ||
        url.includes('coverartarchive.org/release-group/broadcast-album')
      ) {
        return Promise.resolve(jsonResponse({}, 404));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const response = await request(app)
      .get('/api/musicbrainz/release-group/stream')
      .query({ artist: 'Test Artist', limit: 50 })
      .timeout(5000);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Known Album');
    expect(response.text).toContain('Discoverable Album');
    expect(response.text).toContain('"source":"musicbrainz"');
    expect(response.text).toContain('Artist exists with 1 albums in Lidarr');
    expect(response.text).toContain('"mbid":"known-album"');
    expect(response.text).toContain('"inLidarr":true');
    expect(response.text).toContain('"mbid":"missing-album"');
    expect(response.text).toContain('"mbid":"broadcast-album"');
    expect(response.text).toContain('"releaseType":"other"');
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('coverartarchive.org/release-group/known-album')
    );
  });
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(data)
  };
}
