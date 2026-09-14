const { AlbumOrchestrator } = require('../albumOrchestrator');

jest.mock('../../../config', () => ({
  lidarr: { qualityProfileId: '2', rootFolder: '/music' },
  rateLimit: { maxConcurrentRequests: 5, requestTimeout: 30000 }
}));

describe('AlbumOrchestrator', () => {
  let orchestrator;
  let albumService;
  let artistService;
  let logger;

  const requestData = {
    mbid: 'album-mbid', title: 'Test Album', artist: 'Test Artist', rootFolder: '/music'
  };

  beforeEach(() => {
    albumService = {
      add: jest.fn(),
      updateMonitoring: jest.fn(),
      triggerSearchStrict: jest.fn()
    };
    artistService = { prepareForAlbumAddition: jest.fn() };
    logger = {
      logAlbum: jest.fn().mockResolvedValue(undefined),
      logArtist: jest.fn().mockResolvedValue(undefined)
    };
    orchestrator = new AlbumOrchestrator(albumService, artistService, logger);
  });

  describe('addAlbum', () => {
    it('uses Lidarr native album creation for a new artist', async () => {
      const lookupAlbum = {
        title: 'Test Album',
        foreignAlbumId: 'album-mbid',
        monitored: false,
        artist: { artistName: 'Test Artist', foreignArtistId: 'artist-mbid' }
      };
      const preparedArtist = {
        id: 0,
        artistName: 'Test Artist',
        foreignArtistId: 'artist-mbid',
        rootFolderPath: '/music',
        monitored: false
      };
      const addedAlbum = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: 'album-mbid',
        monitored: true,
        artist: { ...preparedArtist, id: 5 }
      };

      artistService.prepareForAlbumAddition.mockResolvedValue(preparedArtist);
      albumService.add.mockResolvedValue(addedAlbum);

      const result = await orchestrator.addAlbum(lookupAlbum, null, requestData);

      expect(albumService.add).toHaveBeenCalledWith(expect.objectContaining({
        monitored: true,
        artist: preparedArtist,
        addOptions: expect.objectContaining({ searchForNewAlbum: true })
      }));
      expect(result).toMatchObject({
        success: true,
        state: 'queued',
        artistCreated: true,
        artistId: 5,
        albumId: 10,
        searchRequested: true
      });
      expect(logger.logArtist).toHaveBeenCalled();
      expect(logger.logAlbum).toHaveBeenCalled();
    });

    it('uses an existing artist without preparing a root folder', async () => {
      const existingArtist = {
        id: 5, artistName: 'Test Artist', foreignArtistId: 'artist-mbid'
      };
      const lookupAlbum = {
        title: 'Second Album',
        foreignAlbumId: 'second-mbid',
        artist: { artistName: 'Test Artist', foreignArtistId: 'artist-mbid' }
      };
      albumService.add.mockResolvedValue({
        id: 11, title: 'Second Album', artist: existingArtist
      });

      const result = await orchestrator.addAlbum(lookupAlbum, existingArtist, {
        ...requestData, mbid: 'second-mbid', title: 'Second Album', rootFolder: null
      });

      expect(artistService.prepareForAlbumAddition).not.toHaveBeenCalled();
      expect(albumService.add).toHaveBeenCalledWith(expect.objectContaining({
        artist: existingArtist
      }));
      expect(result.artistCreated).toBe(false);
      expect(logger.logArtist).not.toHaveBeenCalled();
    });

    it('does not convert a successful Lidarr mutation into a failure when audit logging fails', async () => {
      const preparedArtist = { artistName: 'Test Artist', foreignArtistId: 'artist-mbid' };
      artistService.prepareForAlbumAddition.mockResolvedValue(preparedArtist);
      albumService.add.mockResolvedValue({
        id: 10, title: 'Test Album', artist: { ...preparedArtist, id: 5 }
      });
      logger.logArtist.mockRejectedValue(new Error('database unavailable'));
      logger.logAlbum.mockRejectedValue(new Error('database unavailable'));

      await expect(orchestrator.addAlbum({
        title: 'Test Album', artist: preparedArtist
      }, null, requestData)).resolves.toMatchObject({ success: true });
    });

    it('propagates Lidarr album-add failures', async () => {
      const existingArtist = { id: 5, artistName: 'Test Artist' };
      albumService.add.mockRejectedValue(new Error('Lidarr rejected album'));

      await expect(orchestrator.addAlbum({
        title: 'Test Album', artist: existingArtist
      }, existingArtist, requestData)).rejects.toThrow('Lidarr rejected album');
    });
  });

  describe('monitorAndSearchAlbum', () => {
    const artist = { id: 5, artistName: 'Test Artist', foreignArtistId: 'artist-mbid' };

    it('idempotently monitors and searches an existing incomplete album', async () => {
      const album = {
        id: 10, title: 'Test Album', monitored: false,
        statistics: { percentOfTracks: 25 }
      };
      albumService.updateMonitoring.mockResolvedValue({ ...album, monitored: true });
      albumService.triggerSearchStrict.mockResolvedValue(true);

      const result = await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(albumService.updateMonitoring).toHaveBeenCalledWith(album, true);
      expect(albumService.triggerSearchStrict).toHaveBeenCalledWith(10);
      expect(result).toMatchObject({
        success: true, state: 'queued', artistCreated: false, percentComplete: 25
      });
    });

    it('returns complete without searching a fully downloaded album', async () => {
      const album = {
        id: 10, title: 'Test Album', monitored: true,
        statistics: { percentOfTracks: 100 }
      };

      const result = await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(albumService.triggerSearchStrict).not.toHaveBeenCalled();
      expect(result.state).toBe('complete');
    });

    it('propagates a failed search request instead of reporting success', async () => {
      const album = {
        id: 10, title: 'Test Album', monitored: true,
        statistics: { percentOfTracks: 0 }
      };
      albumService.triggerSearchStrict.mockRejectedValue(new Error('search failed'));

      await expect(orchestrator.monitorAndSearchAlbum(
        album, artist, requestData
      )).rejects.toThrow('search failed');
    });
  });
});
