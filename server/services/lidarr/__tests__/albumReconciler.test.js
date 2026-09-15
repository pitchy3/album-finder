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
      retentionMs: 1
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1',
      artistId: 5,
      albumMbid: 'album-1'
    });

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
      retentionMs: 1
    });

    const first = reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1'
    });
    await new Promise(resolve => setTimeout(resolve, 1));
    const second = reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-2'
    });

    await Promise.all([first, second]);

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
      retentionMs: 1
    });

    await reconciler.enqueue({
      artistMbid: 'artist-1', artistId: 5, albumMbid: 'album-1'
    });

    expect(albumService.updateMonitoring).toHaveBeenCalledTimes(2);
    expect(albumService.triggerSearchStrict).toHaveBeenCalledTimes(1);
  });
});
