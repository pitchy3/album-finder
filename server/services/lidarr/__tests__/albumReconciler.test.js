const { AlbumReconciler } = require('../albumReconciler');

describe('AlbumReconciler', () => {
  let albumService;

  beforeEach(() => {
    albumService = {
      hasActiveArtistRefresh: jest.fn(),
      findInLibraryStrict: jest.fn(),
      updateMonitoring: jest.fn().mockResolvedValue({ monitored: true }),
      triggerSearchStrict: jest.fn().mockResolvedValue(true)
    };
  });

  it('waits for artist refresh and reasserts monitoring before searching', async () => {
    albumService.hasActiveArtistRefresh
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    let monitored = false;
    albumService.findInLibraryStrict.mockImplementation(async () => ({
      id: 10,
      monitored,
      statistics: { percentOfTracks: 0 }
    }));
    albumService.updateMonitoring.mockImplementation(async () => {
      monitored = true;
      return { id: 10, monitored: true };
    });

    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1,
      maxAttempts: 10,
      stablePasses: 2,
      retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1',
      artistId: 5,
      albumMbid: 'album-1'
    });
    await reconciler.waitFor('artist-1');

    expect(albumService.updateMonitoring).toHaveBeenCalledTimes(1);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledWith(10);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledTimes(1);
  });

  it('rechecks every selected album when a later add shares the refresh window', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    const monitored = new Map([
      ['album-1', false],
      ['album-2', false]
    ]);
    albumService.findInLibraryStrict.mockImplementation(async mbid => ({
      id: mbid === 'album-1' ? 10 : 11,
      foreignAlbumId: mbid,
      monitored: monitored.get(mbid),
      statistics: { percentOfTracks: 0 }
    }));
    albumService.updateMonitoring.mockImplementation(async album => {
      monitored.set(album.foreignAlbumId, true);
      return { ...album, monitored: true };
    });

    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 2,
      maxAttempts: 20,
      stablePasses: 3,
      retentionMs: 1,
      protectionWindow: 0
    });

    const first = reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1'
    });
    await new Promise(resolve => setTimeout(resolve, 1));
    const second = reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-2'
    });

    await Promise.all([first, second]);
    await reconciler.waitFor('artist-1');

    expect(monitored.get('album-1')).toBe(true);
    expect(monitored.get('album-2')).toBe(true);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledWith(10);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledWith(11);
  });

  it('reapplies monitoring if Lidarr clears it during stabilization', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    let lookupCount = 0;
    albumService.findInLibraryStrict.mockImplementation(async () => {
      lookupCount += 1;
      return {
        id: 10,
        monitored: lookupCount === 2 || lookupCount >= 4,
        statistics: { percentOfTracks: 0 }
      };
    });

    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1,
      maxAttempts: 10,
      stablePasses: 2,
      retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1'
    });
    await reconciler.waitFor('artist-1');

    expect(albumService.updateMonitoring).toHaveBeenCalledTimes(2);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledTimes(1);
  });

  it('reports success only after monitoring remains stable', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    albumService.findInLibraryStrict.mockResolvedValue({
      id: 10, monitored: true, statistics: { percentOfTracks: 0 }
    });
    const onStateChange = jest.fn();
    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1, maxAttempts: 5, stablePasses: 2, retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1', onStateChange
    });
    await reconciler.waitFor('artist-1');

    expect(albumService.hasActiveArtistRefresh).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      operationState: 'search_queued', monitored: true, success: true
    }));
  });

  it('reports a failed state when reconciliation times out', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(true);
    const onStateChange = jest.fn();
    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1, maxAttempts: 1, stablePasses: 2, retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1', onStateChange
    });
    await reconciler.waitFor('artist-1');

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      operationState: 'failed', success: false
    }));
  });

  it('starts fresh search and notification state for an explicit retry', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    albumService.findInLibraryStrict.mockResolvedValue({
      id: 10, monitored: true, statistics: { percentOfTracks: 0 }
    });
    const firstState = jest.fn();
    const retryState = jest.fn();
    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1, maxAttempts: 5, stablePasses: 1, retentionMs: 100,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1', onStateChange: firstState
    });
    await reconciler.waitFor('artist-1');
    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1',
      forceSearch: true, onStateChange: retryState
    });
    await reconciler.waitFor('artist-1');

    expect(albumService.triggerSearchStrict).toHaveBeenCalledTimes(2);
    expect(retryState).toHaveBeenCalledWith(expect.objectContaining({ operationState: 'search_queued' }));
  });

  it('reports failure only for albums that did not reconcile', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    albumService.findInLibraryStrict.mockImplementation(async mbid => mbid === 'good'
      ? { id: 10, monitored: true, statistics: { percentOfTracks: 0 } }
      : null);
    const goodState = jest.fn();
    const missingState = jest.fn();
    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1, maxAttempts: 1, stablePasses: 2, retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'good', onStateChange: goodState
    });
    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'missing', onStateChange: missingState
    });
    await reconciler.waitFor('artist-1');

    expect(goodState).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(goodState).not.toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(missingState).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('restores the activity callback for a persisted job', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    albumService.findInLibraryStrict.mockResolvedValue({
      id: 10, monitored: true, statistics: { percentOfTracks: 0 }
    });
    const store = {
      getAlbumReconciliationJobs: jest.fn().mockResolvedValue([{
        artist_mbid: 'artist-1', artist_id: 5, album_mbid: 'album-1',
        activity_id: 42, search_triggered: 0
      }]),
      saveAlbumReconciliationJob: jest.fn().mockResolvedValue(),
      deleteAlbumReconciliationJob: jest.fn().mockResolvedValue(),
      updateAlbumAdditionState: jest.fn().mockResolvedValue()
    };
    const reconciler = new AlbumReconciler(albumService, {
      store,
      cache: { clearByPrefix: jest.fn() },
      pollInterval: 1, maxAttempts: 3, stablePasses: 1, retentionMs: 1,
      protectionWindow: 0
    });

    await reconciler.ready;
    await reconciler.waitFor('artist-1');

    expect(store.updateAlbumAdditionState).toHaveBeenCalledWith(42, expect.objectContaining({
      operationState: 'search_queued', success: true
    }));
  });

  it('reasserts monitoring when Lidarr changes it after initial verification', async () => {
    albumService.hasActiveArtistRefresh.mockResolvedValue(false);
    let monitored = true;
    albumService.findInLibraryStrict.mockImplementation(async () => ({
      id: 10, monitored, statistics: { percentOfTracks: 0 }
    }));
    albumService.updateMonitoring.mockImplementation(async () => {
      monitored = true;
      return { id: 10, monitored: true };
    });
    const reconciler = new AlbumReconciler(albumService, {
      pollInterval: 1,
      protectionPollInterval: 5,
      protectionWindow: 20,
      maxAttempts: 5,
      stablePasses: 1,
      retentionMs: 1
    });
    const driftTimer = setTimeout(() => { monitored = false; }, 3);

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1'
    });
    await reconciler.waitFor('artist-1');
    clearTimeout(driftTimer);

    expect(albumService.updateMonitoring).toHaveBeenCalled();
    expect(monitored).toBe(true);
  });
});
