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

  describe('prepareForAlbumAddition', () => {
    it('should use root-folder defaults and monitor only the selected album', async () => {
      const artistInfo = {
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      };

      mockClient.get.mockResolvedValueOnce([{
        path: '/music',
        defaultMetadataProfileId: 7
      }]);

      const result = await artistService.prepareForAlbumAddition(artistInfo);

      expect(result).toMatchObject({
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist',
        qualityProfileId: 1,
        metadataProfileId: 7,
        rootFolderPath: '/music',
        monitored: false,
        monitorNewItems: 'none',
        addOptions: {
          monitor: 'none',
          searchForMissingAlbums: false
        }
      });
    });

    it('should use the selected custom root folder', async () => {
      mockClient.get.mockResolvedValueOnce([
        { path: '/music', defaultMetadataProfileId: 1 },
        { path: '/custom/music', defaultMetadataProfileId: 9 }
      ]);

      const result = await artistService.prepareForAlbumAddition({
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      }, {
        customRootFolder: '/custom/music'
      });

      expect(result.rootFolderPath).toBe('/custom/music');
      expect(result.metadataProfileId).toBe(9);
    });

    it('should fall back to Lidarr metadata profiles when the root has no default', async () => {
      mockClient.get
        .mockResolvedValueOnce([{ path: '/music' }])
        .mockResolvedValueOnce([
          { id: 3, name: 'Standard' },
          { id: 4, name: 'None' }
        ]);

      const result = await artistService.prepareForAlbumAddition({
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      });

      expect(result.metadataProfileId).toBe(4);
      expect(mockClient.get).toHaveBeenNthCalledWith(2, 'metadataProfile');
    });

    it('should fail clearly when Lidarr has no metadata profile', async () => {
      mockClient.get
        .mockResolvedValueOnce([{ path: '/music' }])
        .mockResolvedValueOnce([]);

      await expect(artistService.prepareForAlbumAddition({
        foreignArtistId: 'mbid-123',
        artistName: 'Test Artist'
      })).rejects.toThrow('no metadata profile');
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
