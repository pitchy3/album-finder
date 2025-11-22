/**
 * Unit tests for LidarrLogger
 * Tests database logging abstraction and data normalization
 */

const { LidarrLogger } = require('../lidarrLogger');

// Mock database - must be defined before jest.mock
jest.mock('../../../services/database', () => ({
  database: {
    logAlbumAddition: jest.fn().mockResolvedValue(undefined),
    logArtistAddition: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock queue service
jest.mock('../../../services/queue', () => ({
  getUsername: jest.fn((req) => req.session?.user?.claims?.sub || 'anonymous')
}));

describe('LidarrLogger', () => {
  let mockReq;
  let logger;
  let mockDatabase;

  beforeEach(() => {
    // Get reference to mocked database
    mockDatabase = require('../../../services/database').database;
    
    mockReq = {
      session: {
        user: {
          claims: {
            sub: 'user-123',
            preferred_username: 'testuser',
            name: 'Test User',
            email: 'test@example.com'
          }
        }
      },
      ip: '192.168.1.100',
      connection: {
        remoteAddress: '192.168.1.100'
      },
      get: jest.fn((header) => {
        if (header === 'User-Agent') return 'Mozilla/5.0';
        return null;
      })
    };

    logger = new LidarrLogger(mockReq);
    mockDatabase.logAlbumAddition.mockClear();
    mockDatabase.logArtistAddition.mockClear();
  });

  describe('constructor', () => {
    it('should extract user info from request', () => {
      expect(logger.baseData.userId).toBe('user-123');
      expect(logger.baseData.username).toBe('testuser');
      expect(logger.baseData.email).toBe('test@example.com');
      expect(logger.baseData.ipAddress).toBe('192.168.1.100');
      expect(logger.baseData.userAgent).toBe('Mozilla/5.0');
    });

    it('should use preferred_username over name', () => {
      mockReq.session.user.claims.preferred_username = 'preferred';
      mockReq.session.user.claims.name = 'regular';
      
      const logger2 = new LidarrLogger(mockReq);
      
      expect(logger2.baseData.username).toBe('preferred');
    });

    it('should fall back to name if preferred_username missing', () => {
      delete mockReq.session.user.claims.preferred_username;
      mockReq.session.user.claims.name = 'regular';
      
      const logger2 = new LidarrLogger(mockReq);
      
      expect(logger2.baseData.username).toBe('regular');
    });

    it('should handle missing user session', () => {
      mockReq.session = {};
      
      const logger2 = new LidarrLogger(mockReq);
      
      expect(logger2.baseData.username).toBeNull();
      expect(logger2.baseData.email).toBeNull();
    });

    it('should handle missing IP address', () => {
      delete mockReq.ip;
      delete mockReq.connection.remoteAddress;
      
      const logger2 = new LidarrLogger(mockReq);
      
      expect(logger2.baseData.ipAddress).toBeUndefined();
    });

    it('should use fallback IP from connection', () => {
      delete mockReq.ip;
      mockReq.connection.remoteAddress = '10.0.0.1';
      
      const logger2 = new LidarrLogger(mockReq);
      
      expect(logger2.baseData.ipAddress).toBe('10.0.0.1');
    });
  });

  describe('logAlbum', () => {
    it('should log successful album addition', async () => {
      const albumData = {
        albumTitle: 'Test Album',
        albumMbid: 'album-mbid',
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid',
        lidarrAlbumId: 10,
        lidarrArtistId: 1,
        releaseDate: '2024-01-01',
        monitored: true,
        searchTriggered: true
      };

      await logger.logAlbum(albumData, {
        success: true,
        requestData: { mbid: 'album-mbid' }
      });

      expect(mockDatabase.logAlbumAddition).toHaveBeenCalledWith({
        ...logger.baseData,
        ...albumData,
        success: true,
        errorMessage: null,
        requestData: JSON.stringify({ mbid: 'album-mbid' }),
        downloaded: false
      });
    });

    it('should log failed album addition', async () => {
      const albumData = {
        albumTitle: 'Test Album',
        albumMbid: 'album-mbid',
        monitored: false,
        searchTriggered: false
      };

      const error = new Error('Album not found');

      await logger.logAlbum(albumData, {
        success: false,
        error,
        requestData: {}
      });

      expect(mockDatabase.logAlbumAddition).toHaveBeenCalledWith(
        expect.objectContaining({
          albumTitle: 'Test Album',
          success: false,
          errorMessage: 'Album not found'
        })
      );
    });

    it('should default success to true', async () => {
      await logger.logAlbum({ albumTitle: 'Test' });

      expect(mockDatabase.logAlbumAddition).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should handle empty options', async () => {
      await logger.logAlbum({ albumTitle: 'Test' }, {});

      expect(mockDatabase.logAlbumAddition).toHaveBeenCalled();
    });
  });

  describe('logArtist', () => {
    it('should log successful artist addition', async () => {
      const artistData = {
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid',
        lidarrArtistId: 1,
        qualityProfileId: 1,
        rootFolder: '/music',
        monitored: true
      };

      await logger.logArtist(artistData, {
        success: true,
        requestData: { mbid: 'artist-mbid' }
      });

      expect(mockDatabase.logArtistAddition).toHaveBeenCalledWith({
        ...logger.baseData,
        ...artistData,
        success: true,
        errorMessage: null,
        requestData: JSON.stringify({ mbid: 'artist-mbid' })
      });
    });

    it('should log failed artist addition', async () => {
      const artistData = {
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid'
      };

      const error = new Error('Artist addition failed');

      await logger.logArtist(artistData, {
        success: false,
        error
      });

      expect(mockDatabase.logArtistAddition).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMessage: 'Artist addition failed'
        })
      );
    });
  });

  describe('buildAlbumData', () => {
    it('should build album data from album and artist objects', () => {
      const album = {
        id: 10,
        title: 'Test Album',
        foreignAlbumId: 'album-mbid',
        artistId: 1,
        releaseDate: '2024-01-01',
        monitored: true
      };

      const artist = {
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'artist-mbid',
        path: '/music/TestArtist'
      };

      const result = LidarrLogger.buildAlbumData(album, artist);

      expect(result).toEqual({
        albumTitle: 'Test Album',
        albumMbid: 'album-mbid',
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid',
        lidarrAlbumId: 10,
        lidarrArtistId: 1,
        releaseDate: '2024-01-01',
        rootFolderUsed: '/music/TestArtist',
        monitored: true,
        searchTriggered: false
      });
    });

    it('should use options as fallback values', () => {
      const result = LidarrLogger.buildAlbumData(null, null, {
        albumTitle: 'Fallback Album',
        albumMbid: 'fallback-mbid',
        monitored: false,
        searchTriggered: true
      });

      expect(result.albumTitle).toBe('Fallback Album');
      expect(result.albumMbid).toBe('fallback-mbid');
      expect(result.monitored).toBe(false);
      expect(result.searchTriggered).toBe(true);
    });

    it('should prefer album/artist values over options', () => {
      const album = { title: 'Album Title' };
      const result = LidarrLogger.buildAlbumData(album, null, {
        albumTitle: 'Option Title'
      });

      expect(result.albumTitle).toBe('Album Title');
    });

    it('should handle missing album and artist', () => {
      const result = LidarrLogger.buildAlbumData(null, null);

      expect(result.albumTitle).toBeNull();
      expect(result.artistName).toBeNull();
      expect(result.lidarrAlbumId).toBeNull();
    });

    it('should get artistId from album if not in artist object', () => {
      const album = { artistId: 5 };
      const artist = {};

      const result = LidarrLogger.buildAlbumData(album, artist);

      expect(result.lidarrArtistId).toBe(5);
    });

    it('should default monitored to true when undefined', () => {
      const result = LidarrLogger.buildAlbumData({}, {});

      expect(result.monitored).toBe(true);
    });

    it('should default searchTriggered to false', () => {
      const result = LidarrLogger.buildAlbumData({}, {});

      expect(result.searchTriggered).toBe(false);
    });
  });

  describe('buildArtistData', () => {
    it('should build artist data from artist object', () => {
      const artist = {
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'artist-mbid',
        path: '/music/TestArtist',
        monitored: true
      };

      const result = LidarrLogger.buildArtistData(artist, {
        qualityProfileId: 1
      });

      expect(result).toEqual({
        artistName: 'Test Artist',
        artistMbid: 'artist-mbid',
        lidarrArtistId: 1,
        qualityProfileId: 1,
        rootFolder: '/music/TestArtist',
        monitored: true
      });
    });

    it('should use options as fallback', () => {
      const result = LidarrLogger.buildArtistData(null, {
        artistName: 'Fallback Artist',
        artistMbid: 'fallback-mbid',
        monitored: false
      });

      expect(result.artistName).toBe('Fallback Artist');
      expect(result.artistMbid).toBe('fallback-mbid');
      expect(result.monitored).toBe(false);
    });

    it('should handle missing artist and options', () => {
      const result = LidarrLogger.buildArtistData(null);

      expect(result.artistName).toBeNull();
      expect(result.artistMbid).toBeNull();
      expect(result.lidarrArtistId).toBeNull();
    });

    it('should default monitored to true', () => {
      const result = LidarrLogger.buildArtistData({});

      expect(result.monitored).toBe(true);
    });
  });
});