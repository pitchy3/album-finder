// server/middleware/__tests__/tokenRefresh.test.js
const {
  refreshTokenMiddleware,
  forceTokenRefresh,
  getAccessToken
} = require('../tokenRefresh');
const { encryptToken, decryptToken } = require('../../services/tokenEncryption');

// Mock dependencies
jest.mock('../../services/auth', () => ({
  getClient: jest.fn()
}));

jest.mock('../../services/tokenEncryption', () => ({
  encryptToken: jest.fn((token) => `encrypted:${token}`),
  decryptToken: jest.fn((encrypted) => encrypted.replace('encrypted:', ''))
}));

jest.mock('../../config', () => ({
  session: {
    secret: 'test-secret-key-must-be-at-least-32-chars-long'
  }
}));

// Mock database
const mockDatabase = {
  logAuthEvent: jest.fn()
};
jest.mock('../../services/database', () => ({
  database: mockDatabase
}));

const { getClient } = require('../../services/auth');

describe('Token Refresh Middleware', () => {
  let req, res, next;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset decryptToken mock to default behavior
    decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
    
    // Setup mock OIDC client
    mockClient = {
      refresh: jest.fn()
    };
    getClient.mockReturnValue(mockClient);

    // Setup request/response/next
    req = {
      session: {
        user: {
          claims: {
            authType: 'oidc',
            sub: 'user-123',
            preferred_username: 'testuser',
            name: 'Test User',
            email: 'test@example.com'
          },
          tokens: {
            access_token: 'encrypted:old-access-token',
            id_token: 'encrypted:old-id-token',
            refresh_token: 'encrypted:old-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 600 // Expires in 10 minutes
          }
        },
        save: jest.fn((cb) => cb()),
        destroy: jest.fn((cb) => cb())
      },
      path: '/api/test',
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'test-user-agent'),
      sessionID: 'test-session-id'
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      redirect: jest.fn()
    };

    next = jest.fn();

    // Reset environment
    process.env.NODE_ENV = 'production';
    process.env.DEBUG = 'false';
  });

  describe('refreshTokenMiddleware - Skip Cases', () => {
    it('should skip if user not logged in', async () => {
      delete req.session.user;

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });

    it('should skip if no tokens in session', async () => {
      delete req.session.user.tokens;

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });

    it('should skip if auth type is not OIDC', async () => {
      req.session.user.claims.authType = 'basicauth';

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });

    it('should skip if token not expiring soon', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 600; // 10 minutes

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });

    it('should skip if no expiration time', async () => {
      delete req.session.user.tokens.expires_at;

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokenMiddleware - Token Refresh', () => {
    beforeEach(() => {
      // Set token to expire in 4 minutes (should trigger refresh)
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;

      // Mock successful refresh
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        refresh_token: 'new-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        claims: () => ({
          sub: 'user-123',
          name: 'Test User Updated'
        })
      });
    });

    it('should refresh tokens when expiring soon', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).toHaveBeenCalledWith('old-refresh-token');
      expect(next).toHaveBeenCalled();
    });

    it('should update session with new tokens', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.user.tokens.access_token).toBe('encrypted:new-access-token');
      expect(req.session.user.tokens.id_token).toBe('encrypted:new-id-token');
      expect(req.session.user.tokens.refresh_token).toBe('encrypted:new-refresh-token');
    });

    it('should keep old refresh token if new one not provided', async () => {
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.user.tokens.refresh_token).toBe('encrypted:old-refresh-token');
    });

    it('should update user claims if provided', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.user.claims.name).toBe('Test User Updated');
    });

    it('should save updated session', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.save).toHaveBeenCalled();
    });

    it('should call next after successful refresh', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('refreshTokenMiddleware - No Refresh Token', () => {
    beforeEach(() => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 10; // Expired
      delete req.session.user.tokens.refresh_token;
    });

    it('should destroy session if no refresh token', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalled();
    });

    it('should return 401 for API requests without refresh token', async () => {
      req.path = '/api/test';

      await refreshTokenMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session expired',
        loginUrl: '/auth/login',
        code: 'TOKEN_EXPIRED'
      });
    });

    it('should redirect to login for page requests without refresh token', async () => {
      req.path = '/dashboard';

      await refreshTokenMiddleware(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });
  });

  describe('refreshTokenMiddleware - Refresh Failures', () => {
    beforeEach(() => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;
    });

    it('should handle OIDC client not available', async () => {
      getClient.mockReturnValue(null);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalled();
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'token_refresh_failure'
        })
      );
    });

    it('should handle refresh failure', async () => {
      mockClient.refresh.mockRejectedValue(new Error('Token refresh failed'));

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalled();
    });

    it('should log refresh failure to database', async () => {
      mockClient.refresh.mockRejectedValue(new Error('Token expired'));

      await refreshTokenMiddleware(req, res, next);

      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith({
        eventType: 'token_refresh_failure',
        userId: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        ipAddress: '127.0.0.1',
        userAgent: 'test-user-agent',
        errorMessage: 'Token expired',
        sessionId: 'test-session-id'
      });
    });

    it('should return 401 for API requests on refresh failure', async () => {
      mockClient.refresh.mockRejectedValue(new Error('Refresh failed'));
      req.path = '/api/data';

      await refreshTokenMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session expired, please log in again',
        loginUrl: '/auth/login',
        code: 'TOKEN_REFRESH_FAILED'
      });
    });

    it('should redirect page requests on refresh failure', async () => {
      mockClient.refresh.mockRejectedValue(new Error('Refresh failed'));
      req.path = '/dashboard';

      await refreshTokenMiddleware(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should handle decryption failure', async () => {
      decryptToken.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalled();
    });

    it('should handle session save failure', async () => {
      req.session.save.mockImplementation((cb) => cb(new Error('Save failed')));
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });

      await refreshTokenMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to refresh session',
        code: 'SESSION_SAVE_FAILED'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('forceTokenRefresh', () => {
    beforeEach(() => {
      // Ensure clean mock state for this describe block
      jest.clearAllMocks();
      decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'forced-access-token',
        id_token: 'forced-id-token',
        refresh_token: 'forced-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
    });

    it('should force token refresh', async () => {
      const tokenSet = await forceTokenRefresh(req);

      expect(mockClient.refresh).toHaveBeenCalledWith('old-refresh-token');
      expect(tokenSet).toBeDefined();
    });

    it('should update session tokens', async () => {
      await forceTokenRefresh(req);

      expect(req.session.user.tokens.access_token).toBe('encrypted:forced-access-token');
      expect(req.session.user.tokens.id_token).toBe('encrypted:forced-id-token');
    });

    it('should save session after forced refresh', async () => {
      await forceTokenRefresh(req);

      expect(req.session.save).toHaveBeenCalled();
    });

    it('should throw if not an OIDC session', async () => {
      req.session.user.claims.authType = 'basicauth';

      await expect(forceTokenRefresh(req)).rejects.toThrow('Not an OIDC session');
    });

    it('should throw if no session', async () => {
      delete req.session.user;

      await expect(forceTokenRefresh(req)).rejects.toThrow('Not an OIDC session');
    });

    it('should throw if no refresh token', async () => {
      delete req.session.user.tokens.refresh_token;

      await expect(forceTokenRefresh(req)).rejects.toThrow('No refresh token available');
    });

    it('should throw if OIDC client not available', async () => {
      getClient.mockReturnValue(null);

      await expect(forceTokenRefresh(req)).rejects.toThrow('OIDC client not available');
    });

    it('should handle session save failure', async () => {
      req.session.save.mockImplementation((cb) => cb(new Error('Save failed')));

      await expect(forceTokenRefresh(req)).rejects.toThrow('Save failed');
    });

    it('should keep old refresh token if new one not provided', async () => {
      mockClient.refresh.mockResolvedValue({
        access_token: 'forced-access-token',
        id_token: 'forced-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });

      await forceTokenRefresh(req);

      expect(req.session.user.tokens.refresh_token).toBe('encrypted:old-refresh-token');
    });
  });

  describe('getAccessToken', () => {
    beforeEach(() => {
      // Ensure clean mock for getAccessToken tests
      jest.clearAllMocks();
      decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
    });

    it('should return decrypted access token', () => {
      const token = getAccessToken(req);

      expect(token).toBe('old-access-token');
      expect(decryptToken).toHaveBeenCalledWith(
        'encrypted:old-access-token',
        'test-secret-key-must-be-at-least-32-chars-long'
      );
    });

    it('should return null if no session', () => {
      delete req.session.user;

      const token = getAccessToken(req);

      expect(token).toBeNull();
    });

    it('should return null if no tokens', () => {
      delete req.session.user.tokens;

      const token = getAccessToken(req);

      expect(token).toBeNull();
    });

    it('should return null if not OIDC auth', () => {
      req.session.user.claims.authType = 'basicauth';

      const token = getAccessToken(req);

      expect(token).toBeNull();
    });

    it('should return null on decryption error', () => {
      decryptToken.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const token = getAccessToken(req);

      expect(token).toBeNull();
    });
  });

  describe('Debug Mode', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
      
      process.env.DEBUG = 'true';
      process.env.NODE_ENV = 'development';
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
    });

    it('should work in debug mode', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Development Mode', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
      
      process.env.NODE_ENV = 'development';
      process.env.DEBUG = 'false';
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
    });

    it('should work in development mode', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      decryptToken.mockImplementation((encrypted) => encrypted.replace('encrypted:', ''));
    });

    it('should handle missing connection.remoteAddress', async () => {
      delete req.connection.remoteAddress;
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;
      
      mockClient.refresh.mockRejectedValue(new Error('Refresh failed'));

      await refreshTokenMiddleware(req, res, next);

      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: '127.0.0.1'
        })
      );
    });

    it('should handle missing user-agent', async () => {
      req.get.mockReturnValue(undefined);
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 240;
      
      mockClient.refresh.mockRejectedValue(new Error('Refresh failed'));

      await refreshTokenMiddleware(req, res, next);

      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: undefined
        })
      );
    });

    it('should handle session destroy error', async () => {
      req.session.destroy.mockImplementation((cb) => cb(new Error('Destroy failed')));
      delete req.session.user.tokens.refresh_token;
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 10;
      req.path = '/dashboard';

      await refreshTokenMiddleware(req, res, next);

      // Should still redirect despite destroy error
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
    });

    it('should handle token expiring in exactly 5 minutes', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 300;
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });

      await refreshTokenMiddleware(req, res, next);

      // Should refresh at exactly 300 seconds
      expect(mockClient.refresh).toHaveBeenCalled();
    });

    it('should handle already expired token', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 100;
      
      mockClient.refresh.mockResolvedValue({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });

      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).toHaveBeenCalled();
    });
  });
});
