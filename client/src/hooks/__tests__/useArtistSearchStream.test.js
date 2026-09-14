import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useArtistSearchStream } from '../useArtistSearchStream.js';

class MockEventSource {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor() {
    this.listeners = new Map();
    this.readyState = MockEventSource.OPEN;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, data) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('useArtistSearchStream album addition state', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    global.EventSource = MockEventSource;
  });

  it('promotes the artist to ready and keeps a queued album incomplete', () => {
    const { result } = renderHook(() => useArtistSearchStream());

    act(() => {
      result.current.searchArtistReleases('Test Artist');
    });

    const stream = MockEventSource.instances[0];
    act(() => {
      stream.emit('artist-status', {
        artistInLidarr: false,
        artistMbid: 'artist-mbid'
      });
      stream.emit('batch', {
        releases: [{
          mbid: 'album-mbid',
          title: 'Test Album',
          inLidarr: false,
          fullyAvailable: false,
          percentComplete: 0
        }],
        total: 1,
        hasMore: false
      });
    });

    act(() => {
      result.current.beginArtistAlbumAdd('album-mbid', true);
    });
    expect(result.current.artistStatus.creationState).toBe('creating');
    expect(result.current.results[0].addState).toBe('adding');

    act(() => {
      result.current.completeArtistAlbumAdd('album-mbid', {
        state: 'queued',
        artistId: 5,
        monitored: true,
        percentComplete: 0
      }, '/music');
    });

    expect(result.current.artistStatus).toMatchObject({
      artistInLidarr: true,
      creationState: 'ready',
      lidarrArtistId: 5,
      rootFolder: '/music'
    });
    expect(result.current.results[0]).toMatchObject({
      inLidarr: true,
      fullyAvailable: false,
      percentComplete: 0,
      addState: 'queued'
    });
  });

  it('restores retryable state when artist creation fails', () => {
    const { result } = renderHook(() => useArtistSearchStream());

    act(() => {
      result.current.beginArtistAlbumAdd('album-mbid', true);
      result.current.failArtistAlbumAdd('album-mbid');
    });

    expect(result.current.artistStatus).toMatchObject({
      artistInLidarr: false,
      creationState: 'error'
    });
  });
});
