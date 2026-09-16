const { AlbumReconciler } = require('../../services/lidarr/albumReconciler');

describe('selected-album reconciliation workflow', () => {
  it('protects four rapid selections through a delayed refresh and searches only incomplete albums', async () => {
    const albums = new Map([
      ['album-1', { id: 1, foreignAlbumId: 'album-1', monitored: false, percent: 100 }],
      ['album-2', { id: 2, foreignAlbumId: 'album-2', monitored: false, percent: 100 }],
      ['album-3', { id: 3, foreignAlbumId: 'album-3', monitored: false, percent: 0 }],
      ['album-4', { id: 4, foreignAlbumId: 'album-4', monitored: false, percent: 0 }]
    ]);
    const searches = [];
    let refreshChecks = 0;
    let delayedRefreshApplied = false;

    const albumService = {
      hasActiveArtistRefresh: jest.fn(async () => {
        refreshChecks += 1;
        if (refreshChecks === 1) return true;
        if (!delayedRefreshApplied && refreshChecks >= 3) {
          delayedRefreshApplied = true;
          albums.forEach(album => { album.monitored = false; });
          return true;
        }
        return false;
      }),
      findInLibraryStrict: jest.fn(async mbid => {
        const album = albums.get(mbid);
        return album && {
          ...album,
          statistics: { percentOfTracks: album.percent }
        };
      }),
      updateMonitoring: jest.fn(async album => {
        albums.get(album.foreignAlbumId).monitored = true;
        return { ...album, monitored: true };
      }),
      triggerSearchStrict: jest.fn(async id => {
        searches.push(id);
        return true;
      })
    };

    const jobs = new Map();
    const store = {
      getAlbumReconciliationJobs: jest.fn().mockResolvedValue([]),
      saveAlbumReconciliationJob: jest.fn(async job => {
        jobs.set(`${job.artistMbid}:${job.albumMbid}`, { ...job });
      }),
      deleteAlbumReconciliationJob: jest.fn(async (artistMbid, albumMbid) => {
        jobs.delete(`${artistMbid}:${albumMbid}`);
      }),
      updateAlbumAdditionState: jest.fn().mockResolvedValue()
    };
    const cache = { clearByPrefix: jest.fn() };
    const reconciler = new AlbumReconciler(albumService, {
      store,
      cache,
      pollInterval: 1,
      protectionPollInterval: 1,
      protectionWindow: 8,
      maxAttempts: 20,
      stablePasses: 1,
      retentionMs: 1
    });

    await Promise.all([...albums.keys()].map((albumMbid, index) => reconciler.enqueue({
      artistMbid: 'artist-1',
      artistId: 5,
      albumMbid,
      activityId: index + 10
    })));
    await reconciler.waitFor('artist-1');

    expect(delayedRefreshApplied).toBe(true);
    expect([...albums.values()].every(album => album.monitored)).toBe(true);
    expect(searches.sort()).toEqual([3, 4]);
    expect(jobs.size).toBe(0);
    expect(store.deleteAlbumReconciliationJob).toHaveBeenCalledTimes(4);
    expect(cache.clearByPrefix).toHaveBeenCalledWith('lidarr');
  });

  it('restores persisted desired state after restart without duplicating an issued search', async () => {
    const album = {
      id: 8,
      foreignAlbumId: 'album-8',
      monitored: false,
      statistics: { percentOfTracks: 0 }
    };
    const albumService = {
      hasActiveArtistRefresh: jest.fn().mockResolvedValue(false),
      findInLibraryStrict: jest.fn(async () => ({ ...album })),
      updateMonitoring: jest.fn(async () => {
        album.monitored = true;
        return { ...album };
      }),
      triggerSearchStrict: jest.fn().mockResolvedValue(true)
    };
    const store = {
      getAlbumReconciliationJobs: jest.fn().mockResolvedValue([{
        artist_mbid: 'artist-1',
        artist_id: 5,
        album_mbid: 'album-8',
        activity_id: 18,
        search_triggered: 1
      }]),
      saveAlbumReconciliationJob: jest.fn().mockResolvedValue(),
      deleteAlbumReconciliationJob: jest.fn().mockResolvedValue(),
      updateAlbumAdditionState: jest.fn().mockResolvedValue()
    };
    const reconciler = new AlbumReconciler(albumService, {
      store,
      cache: { clearByPrefix: jest.fn() },
      pollInterval: 1,
      protectionWindow: 0,
      maxAttempts: 5,
      stablePasses: 1,
      retentionMs: 1
    });

    await reconciler.ready;
    await reconciler.waitFor('artist-1');

    expect(album.monitored).toBe(true);
    expect(albumService.triggerSearchStrict).not.toHaveBeenCalled();
    expect(store.updateAlbumAdditionState).toHaveBeenCalledWith(18, expect.objectContaining({
      operationState: 'search_queued',
      monitored: true,
      success: true
    }));
    expect(store.deleteAlbumReconciliationJob).toHaveBeenCalledWith('artist-1', 'album-8');
  });
});
