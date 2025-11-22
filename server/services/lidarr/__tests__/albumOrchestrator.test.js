/**
 * Unit tests for AlbumOrchestrator
 * Tests complex workflow orchestration for album additions
 */

const { AlbumOrchestrator } = require('../albumOrchestrator');

// Mock config BEFORE any imports
jest.mock('../../../config', () => ({
  lidarr: {
    qualityProfileId: '1',
    rootFolder: '/music'
  },
  rateLimit: {
    maxConcurrentRequests: 5,
    requestTimeout: 30000
  }
}));

// Mock database
jest.mock('../../../services/database', () => ({
  database: {
    logAlbumAddition: jest.fn().mockResolvedValue(undefined),
    logArtistAddition: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock queue service
jest.mock('../../../services/queue', () => ({
  getUsername: jest.fn(() => 'test-user')
}));

describe('AlbumOrchestrator', () => {
  let orchestrator;
  let mockAlbumService;
  let mockArtistService;
  let mockLogger;

  beforeEach(() => {
    mockAlbumService = {
      getByArtistId: jest.fn(),
      findInDiscography: jest.fn(),
      updateMonitoring: jest.fn(),
      triggerSearch: jest.fn()
    };

    mockArtistService = {
      add: jest.fn(),
      triggerRefresh: jest.fn(),
      waitForAlbumRefresh: jest.fn()
    };

    mockLogger = {
      logAlbum: jest.fn().mockResolvedValue(undefined),
      logArtist: jest.fn().mockResolvedValue(undefined)
    };

    orchestrator = new AlbumOrchestrator(
      mockAlbumService,
      mockArtistService,
      mockLogger
    );
  });

  describe('handleExistingArtist', () => {
    const artist = {
      id: 1,
      artistName: 'Test Artist',
      foreignArtistId: 'artist-mbid',
      path: '/music/TestArtist'
    };

    const targetMbid = 'album-mbid';
    const requestData = { mbid: targetMbid, title: 'Test Album', artist: 'Test Artist' };

    it('should handle album found immediately', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: targetMbid,
        monitored: true,
        statistics: { percentOfTracks: 50 }
      };

      mockAlbumService.getByArtistId.mockResolvedValue([album]);
      mockAlbumService.findInDiscography.mockReturnValue(album);
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      const result = await orchestrator.handleExistingArtist(artist, targetMbid, requestData);

      expect(result.id).toBe(1);
      expect(result.albumId).toBe(10);
      expect(result.searchTriggered).toBe(true);
      expect(mockLogger.logAlbum).toHaveBeenCalledWith(
        expect.objectContaining({ albumTitle: 'Test Album' }),
        expect.objectContaining({ success: true })
      );
    });

    it('should enable monitoring if album not monitored', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: targetMbid,
        monitored: false,
        statistics: { percentOfTracks: 0 }
      };

      mockAlbumService.getByArtistId.mockResolvedValue([album]);
      mockAlbumService.findInDiscography.mockReturnValue(album);
      mockAlbumService.updateMonitoring.mockResolvedValue(album);
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      await orchestrator.handleExistingArtist(artist, targetMbid, requestData);

      expect(mockAlbumService.updateMonitoring).toHaveBeenCalledWith(album, true);
    });

    it('should not trigger search if album complete', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: targetMbid,
        monitored: true,
        statistics: { percentOfTracks: 100 }
      };

      mockAlbumService.getByArtistId.mockResolvedValue([album]);
      mockAlbumService.findInDiscography.mockReturnValue(album);

      const result = await orchestrator.handleExistingArtist(artist, targetMbid, requestData);

      expect(result.searchTriggered).toBe(false);
      expect(mockAlbumService.triggerSearch).not.toHaveBeenCalled();
    });

    it('should refresh artist if album not found initially', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: targetMbid,
        monitored: false,
        statistics: { percentOfTracks: 0 }
      };

      mockAlbumService.getByArtistId.mockResolvedValue([]);
      mockAlbumService.findInDiscography.mockReturnValueOnce(null);
      mockArtistService.triggerRefresh.mockResolvedValue(true);
      mockArtistService.waitForAlbumRefresh.mockResolvedValue(album);
      mockAlbumService.updateMonitoring.mockResolvedValue(album);
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      const result = await orchestrator.handleExistingArtist(artist, targetMbid, requestData);

      expect(mockArtistService.triggerRefresh).toHaveBeenCalledWith(1);
      expect(mockArtistService.waitForAlbumRefresh).toHaveBeenCalledWith(
        1,
        targetMbid,
        mockAlbumService
      );
      expect(result.success).not.toBe(false);
    });

    it('should handle album not found after refresh', async () => {
      mockAlbumService.getByArtistId.mockResolvedValue([]);
      mockAlbumService.findInDiscography.mockReturnValue(null);
      mockArtistService.triggerRefresh.mockResolvedValue(true);
      mockArtistService.waitForAlbumRefresh.mockResolvedValue(null);

      const result = await orchestrator.handleExistingArtist(artist, targetMbid, requestData);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(mockLogger.logAlbum).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('handleNewArtist', () => {
    const artistInfo = {
      foreignArtistId: 'artist-mbid',
      artistName: 'New Artist'
    };

    const targetMbid = 'album-mbid';
    const requestData = { mbid: targetMbid, title: 'Test Album', artist: 'New Artist' };

    it('should add new artist and album successfully', async () => {
      const addedArtist = {
        id: 5,
        ...artistInfo,
        path: '/music/NewArtist'
      };

      const album = {
        id: 20,
        title: 'Test Album',
        foreignAlbumId: targetMbid,
        monitored: false,
        statistics: { percentOfTracks: 0 }
      };

      mockArtistService.add.mockResolvedValue(addedArtist);
      mockArtistService.triggerRefresh.mockResolvedValue(true);
      mockArtistService.waitForAlbumRefresh.mockResolvedValue(album);
      mockAlbumService.updateMonitoring.mockResolvedValue(album);
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      const result = await orchestrator.handleNewArtist(artistInfo, targetMbid, requestData);

      expect(result.id).toBe(5);
      expect(result.title).toBe('Test Album');
      expect(mockLogger.logArtist).toHaveBeenCalled();
      expect(mockLogger.logAlbum).toHaveBeenCalled();
    });

    it('should use custom root folder', async () => {
      const addedArtist = {
        id: 5,
        ...artistInfo,
        path: '/custom/music/NewArtist'
      };

      const requestDataWithCustomFolder = {
        ...requestData,
        rootFolder: '/custom/music'
      };

      mockArtistService.add.mockResolvedValue(addedArtist);
      mockArtistService.triggerRefresh.mockResolvedValue(true);
      mockArtistService.waitForAlbumRefresh.mockResolvedValue({
        id: 20,
        title: 'Test Album',
        monitored: false,
        statistics: { percentOfTracks: 0 }
      });
      mockAlbumService.updateMonitoring.mockResolvedValue({});
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      await orchestrator.handleNewArtist(artistInfo, targetMbid, requestDataWithCustomFolder);

      expect(mockArtistService.add).toHaveBeenCalledWith(
        artistInfo,
        expect.objectContaining({ customRootFolder: '/custom/music' })
      );
    });

    it('should handle album not found after artist refresh', async () => {
      const addedArtist = {
        id: 5,
        ...artistInfo,
        path: '/music/NewArtist'
      };

      mockArtistService.add.mockResolvedValue(addedArtist);
      mockArtistService.triggerRefresh.mockResolvedValue(true);
      mockArtistService.waitForAlbumRefresh.mockResolvedValue(null);

      const result = await orchestrator.handleNewArtist(artistInfo, targetMbid, requestData);

      expect(result.success).toBe(false);
      expect(mockLogger.logArtist).toHaveBeenCalled();
      expect(mockLogger.logAlbum).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('monitorAndSearchAlbum', () => {
    const artist = {
      id: 1,
      artistName: 'Test Artist',
      foreignArtistId: 'artist-mbid'
    };

    const requestData = { mbid: 'album-mbid', title: 'Test Album', artist: 'Test Artist' };

    it('should enable monitoring and trigger search', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        monitored: false,
        statistics: { percentOfTracks: 0 }
      };

      mockAlbumService.updateMonitoring.mockResolvedValue(album);
      mockAlbumService.triggerSearch.mockResolvedValue(true);

      const result = await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(mockAlbumService.updateMonitoring).toHaveBeenCalledWith(album, true);
      expect(mockAlbumService.triggerSearch).toHaveBeenCalledWith(10);
      expect(result.searchTriggered).toBe(true);
      expect(result.message).toContain('search triggered');
    });

    it('should not update monitoring if already monitored', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        monitored: true,
        statistics: { percentOfTracks: 0 }
      };

      mockAlbumService.triggerSearch.mockResolvedValue(true);

      await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(mockAlbumService.updateMonitoring).not.toHaveBeenCalled();
    });

    it('should not trigger search if album complete', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        monitored: true,
        statistics: { percentOfTracks: 100 }
      };

      const result = await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(mockAlbumService.triggerSearch).not.toHaveBeenCalled();
      expect(result.searchTriggered).toBe(false);
      expect(result.message).toContain('already complete');
    });

    it('should log to database', async () => {
      const album = {
        id: 10,
        title: 'Test Album',
        monitored: true,
        statistics: { percentOfTracks: 50 }
      };

      mockAlbumService.triggerSearch.mockResolvedValue(true);

      await orchestrator.monitorAndSearchAlbum(album, artist, requestData);

      expect(mockLogger.logAlbum).toHaveBeenCalledWith(
        expect.objectContaining({
          albumTitle: 'Test Album',
          artistName: 'Test Artist',
          monitored: true,
          searchTriggered: true
        }),
        expect.objectContaining({
          success: true,
          requestData
        })
      );
    });
  });

  describe('handleAlbumNotFound', () => {
    it('should log failure and return error response', async () => {
      const artist = {
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'artist-mbid'
      };

      const requestData = {
        mbid: 'album-mbid',
        title: 'Missing Album',
        artist: 'Test Artist'
      };

      const result = await orchestrator.handleAlbumNotFound(artist, requestData);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.title).toBe('Missing Album');
      expect(mockLogger.logAlbum).toHaveBeenCalledWith(
        expect.objectContaining({
          albumTitle: 'Missing Album',
          monitored: false,
          searchTriggered: false
        }),
        expect.objectContaining({
          success: false,
          error: expect.any(Error)
        })
      );
    });

    it('should include helpful suggestions in message', async () => {
      const artist = { id: 1, artistName: 'Test Artist', foreignArtistId: 'artist-mbid' };
      const requestData = { mbid: 'album-mbid', title: 'Missing Album', artist: 'Test Artist' };

      const result = await orchestrator.handleAlbumNotFound(artist, requestData);

      expect(result.message).toContain('MusicBrainz');
      expect(result.message).toContain('metadata');
      expect(result.message).toContain('manually');
    });
  });
});