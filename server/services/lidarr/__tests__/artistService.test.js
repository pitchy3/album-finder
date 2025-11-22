/**
 * Unit tests for ArtistService
 * Tests artist operations including add, refresh, and search
 */

const { ArtistService } = require('../artistService');

// Mock config
jest.mock('../../../config', () => ({
  lidarr: {
    qualityProfileId: '1',
    rootFolder: '/music'
  }
}));

describe('ArtistService', () => {
  let artistService;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };
    artistService = new ArtistService(mockClient);
  });

  describe('getAll', () => {
    it('should get all artists', async () => {
      const mockArtists = [
        { id: 1, artistName: 'Artist 1' },
        { id: 2, artistName: 'Artist 2' }
      ];
      mockClient.get.mockResolvedValueOnce(mockArtists);

      const result = await artistService.getAll();

      expect(result).toEqual(mockArtists);
      expect(mockClient.get).toHaveBeenCalledWith('artist');
    });
  });

  describe('findByMbid', () => {
    it('should find artist by MusicBrainz ID', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, foreignArtistId: 'mbid-1', artistName: 'Artist 1' },
        { id: 2, foreignArtistId: 'mbid-2', artistName: 'Artist 2' }
      ]);

      const result = await artistService.findByMbid('mbid-2');

      expect(result).toEqual({ id: 2, foreignArtistId: 'mbid-2', artistName: 'Artist 2' });
    });

    it('should return null when artist not found', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, foreignArtistId: 'mbid-1', artistName: 'Artist 1' }
      ]);

      const result = await artistService.findByMbid('mbid-999');

      expect(result).toBeNull();
    });
  });

  describe('getById', () => {
    it('should get artist by Lidarr ID', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 1,
        artistName: 'Test Artist'
      });

      const result = await artistService.getById(1);

      expect(result).toEqual({ id: 1, artistName: 'Test Artist' });
      expect(mockClient.get).toHaveBeenCalledWith('artist/1');
    });
  });

  describe('getRootFolder', () => {
    it('should get artist root folder path', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 1,
        artistName: 'Test Artist',
        rootFolderPath: '/music/TestArtist'
      });

      const result = await artistService.getRootFolder(1);

      expect(result).toBe('/music/TestArtist');
    });

    it('should return null if root folder not found', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 1,
        artistName: 'Test Artist'
        // No rootFolderPath
      });

      const result = await artistService.getRootFolder(1);

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('Not found'));

      const result = await artistService.getRootFolder(1);

      expect(result).toBeNull();
    });
  });

  describe('add', () => {
    it('should add artist with default options', async () => {
      const artistInfo = {
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      };

      mockClient.post.mockResolvedValueOnce({
        id: 1,
        ...artistInfo
      });

      const result = await artistService.add(artistInfo);

      expect(result.id).toBe(1);
      expect(mockClient.post).toHaveBeenCalledWith('artist', expect.objectContaining({
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderPath: '/music',
        monitored: true,
        monitorNewItems: 'none'
      }));
    });

    it('should add artist with custom root folder', async () => {
      const artistInfo = {
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      };

      mockClient.post.mockResolvedValueOnce({ id: 1 });

      await artistService.add(artistInfo, {
        customRootFolder: '/custom/music'
      });

      expect(mockClient.post).toHaveBeenCalledWith('artist', expect.objectContaining({
        rootFolderPath: '/custom/music'
      }));
    });

    it('should add artist with custom options', async () => {
      const artistInfo = {
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      };

      mockClient.post.mockResolvedValueOnce({ id: 1 });

      await artistService.add(artistInfo, {
        monitored: false,
        monitorNewItems: 'all',
        searchForMissingAlbums: true
      });

      expect(mockClient.post).toHaveBeenCalledWith('artist', expect.objectContaining({
        monitored: false,
        monitorNewItems: 'all',
        addOptions: expect.objectContaining({
          searchForMissingAlbums: true
        })
      }));
    });
  });

  describe('triggerRefresh', () => {
    it('should trigger refresh for single artist', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 1 });

      const result = await artistService.triggerRefresh(123);

      expect(result).toBe(true);
      expect(mockClient.post).toHaveBeenCalledWith(
        'command',
        {
          name: 'RefreshArtist',
          artistIds: [123]
        },
        expect.any(Number) // timeout
      );
    });

    it('should trigger refresh for multiple artists', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 1 });

      const result = await artistService.triggerRefresh([123, 456]);

      expect(result).toBe(true);
      expect(mockClient.post).toHaveBeenCalledWith(
        'command',
        {
          name: 'RefreshArtist',
          artistIds: [123, 456]
        },
        expect.any(Number)
      );
    });

    it('should return false on error', async () => {
      mockClient.post.mockRejectedValueOnce(new Error('Refresh failed'));

      const result = await artistService.triggerRefresh(123);

      expect(result).toBe(false);
    });
  });

  describe('waitForAlbumRefresh', () => {
    it('should find album immediately', async () => {
      const mockAlbumService = {
        getByArtistId: jest.fn().mockResolvedValue([
          { id: 1, foreignAlbumId: 'mbid-1' },
          { id: 2, foreignAlbumId: 'target-mbid' }
        ]),
        findInDiscography: jest.fn().mockReturnValue({ id: 2, foreignAlbumId: 'target-mbid' })
      };

      const result = await artistService.waitForAlbumRefresh(1, 'target-mbid', mockAlbumService);

      expect(result).toEqual({ id: 2, foreignAlbumId: 'target-mbid' });
      expect(mockAlbumService.getByArtistId).toHaveBeenCalledTimes(1);
    });

    it('should poll until album appears', async () => {
      jest.useFakeTimers();
      
      const mockAlbumService = {
        getByArtistId: jest.fn()
          .mockResolvedValueOnce([]) // First call: not found
          .mockResolvedValueOnce([]) // Second call: not found
          .mockResolvedValue([{ id: 2, foreignAlbumId: 'target-mbid' }]), // Third call: found
        findInDiscography: jest.fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(null)
          .mockReturnValue({ id: 2, foreignAlbumId: 'target-mbid' })
      };

      const promise = artistService.waitForAlbumRefresh(1, 'target-mbid', mockAlbumService);

      // Advance timers to trigger polling
      await jest.advanceTimersByTimeAsync(1000); // First poll
      await jest.advanceTimersByTimeAsync(1000); // Second poll

      const result = await promise;

      expect(result).toEqual({ id: 2, foreignAlbumId: 'target-mbid' });
      expect(mockAlbumService.getByArtistId).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    it('should return null after max attempts', async () => {
      jest.useFakeTimers();
      
      const mockAlbumService = {
        getByArtistId: jest.fn().mockResolvedValue([]),
        findInDiscography: jest.fn().mockReturnValue(null)
      };

      const promise = artistService.waitForAlbumRefresh(1, 'target-mbid', mockAlbumService);

      // Advance timers past max attempts (30 attempts * 1000ms)
      for (let i = 0; i < 30; i++) {
        await jest.advanceTimersByTimeAsync(1000);
      }

      const result = await promise;

      expect(result).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('findByName', () => {
    it('should find artist by exact name match', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, artistName: 'Test Artist' },
        { id: 2, artistName: 'Another Artist' }
      ]);

      const result = await artistService.findByName('Test Artist');

      expect(result).toEqual({ id: 1, artistName: 'Test Artist' });
    });

    it('should find artist by partial name match', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, artistName: 'The Test Artist' },
        { id: 2, artistName: 'Another Artist' }
      ]);

      const result = await artistService.findByName('Test Artist');

      expect(result).toEqual({ id: 1, artistName: 'The Test Artist' });
    });

    it('should be case insensitive', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, artistName: 'TEST ARTIST' }
      ]);

      const result = await artistService.findByName('test artist');

      expect(result).toEqual({ id: 1, artistName: 'TEST ARTIST' });
    });

    it('should trim whitespace', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, artistName: 'Test Artist' }
      ]);

      const result = await artistService.findByName('  Test Artist  ');

      expect(result).toEqual({ id: 1, artistName: 'Test Artist' });
    });

    it('should return null when not found', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, artistName: 'Test Artist' }
      ]);

      const result = await artistService.findByName('Nonexistent Artist');

      expect(result).toBeNull();
    });
  });
});