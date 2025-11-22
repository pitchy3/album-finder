/**
 * Unit tests for AlbumService
 * Tests album operations including lookup, monitoring, and search
 */

const { AlbumService } = require('../albumService');

describe('AlbumService', () => {
  let albumService;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };
    albumService = new AlbumService(mockClient);
  });

  describe('lookupByMbid', () => {
    it('should lookup album and return enriched data', async () => {
      mockClient.get.mockResolvedValueOnce([{
        id: 1,
        title: 'Test Album',
        foreignAlbumId: 'mbid-123',
        monitored: true,
        statistics: { percentOfTracks: 100 }
      }]);

      mockClient.get.mockResolvedValueOnce({
        id: 1,
        title: 'Test Album',
        foreignAlbumId: 'mbid-123',
        monitored: true,
        statistics: { percentOfTracks: 100 }
      });

      const result = await albumService.lookupByMbid('mbid-123');

      expect(result).toBeDefined();
      expect(result.title).toBe('Test Album');
      expect(result.grabbed).toBe(true);
      expect(mockClient.get).toHaveBeenCalledWith('album/lookup', {
        term: 'lidarr:mbid-123'
      });
    });

    it('should return null when album not found', async () => {
      mockClient.get.mockResolvedValueOnce([]);

      const result = await albumService.lookupByMbid('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle album not in library', async () => {
      mockClient.get.mockResolvedValueOnce([{
        title: 'Test Album',
        foreignAlbumId: 'mbid-123',
        monitored: false
        // No id field = not in library
      }]);

      const result = await albumService.lookupByMbid('mbid-123');

      expect(result).toBeDefined();
      expect(result.grabbed).toBe(false);
      expect(mockClient.get).toHaveBeenCalledTimes(1); // No second call for details
    });

    it('should handle error getting album details gracefully', async () => {
      mockClient.get
        .mockResolvedValueOnce([{
          id: 1,
          title: 'Test Album',
          foreignAlbumId: 'mbid-123'
        }])
        .mockRejectedValueOnce(new Error('Details fetch failed'));

      const result = await albumService.lookupByMbid('mbid-123');

      expect(result).toBeDefined();
      expect(result.title).toBe('Test Album');
      expect(result.grabbed).toBe(false); // Fallback value
    });
  });

  describe('getById', () => {
    it('should get album by ID', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 1,
        title: 'Test Album',
        statistics: { percentOfTracks: 50 }
      });

      const result = await albumService.getById(1);

      expect(result.inLibrary).toBe(true);
      expect(result.percentComplete).toBe(50);
      expect(mockClient.get).toHaveBeenCalledWith('album/1');
    });

    it('should return null for 404 error', async () => {
      const error = new Error('API request failed: 404 Not Found');
      mockClient.get.mockRejectedValueOnce(error);

      const result = await albumService.getById(999);

      expect(result).toBeNull();
    });

    it('should throw for other errors', async () => {
      const error = new Error('API request failed: 500 Server Error');
      mockClient.get.mockRejectedValueOnce(error);

      await expect(albumService.getById(1)).rejects.toThrow('500 Server Error');
    });
  });

  describe('findInLibrary', () => {
    it('should find album by foreignAlbumId', async () => {
      mockClient.get.mockResolvedValueOnce([{
        id: 1,
        title: 'Test Album',
        foreignAlbumId: 'mbid-123',
        statistics: { percentOfTracks: 100 }
      }]);

      const result = await albumService.findInLibrary('mbid-123');

      expect(result).toBeDefined();
      expect(result.fullyAvailable).toBe(true);
      expect(mockClient.get).toHaveBeenCalledWith('album', {
        foreignAlbumId: 'mbid-123'
      });
    });

    it('should return null when not found', async () => {
      mockClient.get.mockResolvedValueOnce([]);

      const result = await albumService.findInLibrary('mbid-123');

      expect(result).toBeNull();
    });

    it('should handle search errors gracefully', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('Search failed'));

      const result = await albumService.findInLibrary('mbid-123');

      expect(result).toBeNull();
    });
  });

  describe('updateMonitoring', () => {
    it('should update album monitoring status', async () => {
      const album = { id: 1, title: 'Test', monitored: false };
      mockClient.put.mockResolvedValueOnce({ id: 1, monitored: true });

      await albumService.updateMonitoring(album, true);

      expect(album.monitored).toBe(true);
      expect(mockClient.put).toHaveBeenCalledWith('album/1', album);
    });

    it('should default to monitored=true', async () => {
      const album = { id: 1, title: 'Test', monitored: false };
      mockClient.put.mockResolvedValueOnce({ id: 1, monitored: true });

      await albumService.updateMonitoring(album);

      expect(album.monitored).toBe(true);
    });
  });

  describe('triggerSearch', () => {
    it('should trigger search for single album', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 1 });

      const result = await albumService.triggerSearch(123);

      expect(result).toBe(true);
      expect(mockClient.post).toHaveBeenCalledWith('command', {
        name: 'AlbumSearch',
        albumIds: [123]
      });
    });

    it('should trigger search for multiple albums', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 1 });

      const result = await albumService.triggerSearch([123, 456]);

      expect(result).toBe(true);
      expect(mockClient.post).toHaveBeenCalledWith('command', {
        name: 'AlbumSearch',
        albumIds: [123, 456]
      });
    });

    it('should return false on error', async () => {
      mockClient.post.mockRejectedValueOnce(new Error('Search failed'));

      const result = await albumService.triggerSearch(123);

      expect(result).toBe(false);
    });
  });

  describe('enrichAlbumStatus', () => {
    it('should enrich album with status fields', () => {
      const album = {
        id: 1,
        title: 'Test',
        statistics: { percentOfTracks: 75 }
      };

      const result = albumService.enrichAlbumStatus(album);

      expect(result.inLibrary).toBe(true);
      expect(result.fullyAvailable).toBe(false);
      expect(result.percentComplete).toBe(75);
    });

    it('should handle album without statistics', () => {
      const album = {
        id: 1,
        title: 'Test'
      };

      const result = albumService.enrichAlbumStatus(album);

      expect(result.percentComplete).toBe(0);
      expect(result.fullyAvailable).toBe(false);
    });

    it('should handle album not in library', () => {
      const album = {
        title: 'Test'
        // No id
      };

      const result = albumService.enrichAlbumStatus(album);

      expect(result.inLibrary).toBe(false);
    });

    it('should identify fully available albums', () => {
      const album = {
        id: 1,
        title: 'Test',
        statistics: { percentOfTracks: 100 }
      };

      const result = albumService.enrichAlbumStatus(album);

      expect(result.fullyAvailable).toBe(true);
    });
  });

  describe('getByArtistId', () => {
    it('should get all albums for artist', async () => {
      mockClient.get.mockResolvedValueOnce([
        { id: 1, title: 'Album 1' },
        { id: 2, title: 'Album 2' }
      ]);

      const result = await albumService.getByArtistId(1);

      expect(result).toHaveLength(2);
      expect(mockClient.get).toHaveBeenCalledWith('album', { artistId: 1 });
    });
  });

  describe('findInDiscography', () => {
    it('should find album by foreignAlbumId', () => {
      const albums = [
        { id: 1, foreignAlbumId: 'mbid-1' },
        { id: 2, foreignAlbumId: 'mbid-2' }
      ];

      const result = albumService.findInDiscography(albums, 'mbid-2');

      expect(result).toEqual({ id: 2, foreignAlbumId: 'mbid-2' });
    });

    it('should find album by mbId', () => {
      const albums = [
        { id: 1, mbId: 'mbid-1' },
        { id: 2, mbId: 'mbid-2' }
      ];

      const result = albumService.findInDiscography(albums, 'mbid-2');

      expect(result).toEqual({ id: 2, mbId: 'mbid-2' });
    });

    it('should return undefined when not found', () => {
      const albums = [
        { id: 1, foreignAlbumId: 'mbid-1' }
      ];

      const result = albumService.findInDiscography(albums, 'mbid-999');

      expect(result).toBeUndefined();
    });
  });

  describe('getAllWithCoverArt', () => {
    it('should get all albums with cover art URLs', async () => {
      mockClient.get.mockResolvedValueOnce([
        {
          id: 1,
          foreignAlbumId: 'mbid-1',
          title: 'Album 1',
          monitored: true,
          statistics: { percentOfTracks: 100, trackCount: 10, trackFileCount: 10 },
          images: [{ coverType: 'cover', remoteUrl: 'http://example.com/cover1.jpg' }],
          albumType: 'Album',
          releaseDate: '2024-01-01'
        },
        {
          id: 2,
          foreignAlbumId: 'mbid-2',
          title: 'Album 2',
          monitored: false,
          statistics: { percentOfTracks: 50, trackCount: 8, trackFileCount: 4 },
          images: [{ coverType: 'banner', url: 'http://example.com/cover2.jpg' }],
          albumType: 'EP',
          releaseDate: '2024-02-01'
        },
        {
          id: 3,
          // No foreignAlbumId - should be skipped
          title: 'Album 3'
        }
      ]);

      const result = await albumService.getAllWithCoverArt(1);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2); // Third album skipped
      expect(result.get('mbid-1')).toMatchObject({
        title: 'Album 1',
        fullyAvailable: true,
        coverUrl: 'http://example.com/cover1.jpg'
      });
      expect(result.get('mbid-2')).toMatchObject({
        title: 'Album 2',
        fullyAvailable: false,
        coverUrl: 'http://example.com/cover2.jpg'
      });
    });

    it('should handle albums without cover art', async () => {
      mockClient.get.mockResolvedValueOnce([{
        id: 1,
        foreignAlbumId: 'mbid-1',
        title: 'Album 1',
        monitored: true,
        statistics: { percentOfTracks: 100 }
        // No images
      }]);

      const result = await albumService.getAllWithCoverArt(1);

      expect(result.get('mbid-1').coverUrl).toBeNull();
    });

    it('should use first image if no cover type found', async () => {
      mockClient.get.mockResolvedValueOnce([{
        id: 1,
        foreignAlbumId: 'mbid-1',
        title: 'Album 1',
        images: [{ coverType: 'banner', remoteUrl: 'http://example.com/banner.jpg' }]
      }]);

      const result = await albumService.getAllWithCoverArt(1);

      expect(result.get('mbid-1').coverUrl).toBe('http://example.com/banner.jpg');
    });
  });
});