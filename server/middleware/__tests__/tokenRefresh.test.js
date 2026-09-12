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
      method: 'GET',
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

    it('should skip refresh for the local logout route', async () => {
      req.method = 'POST';
      req.path = '/auth/logout';
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 1;

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockClient.refresh).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip if token not expiring soon', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 299;

      await refreshTokenMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockClient.refresh).not.toHaveBeenCalled();
    });

    it('should not immediately refresh a freshly-issued 300-second token', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 300;

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
      // Set token to expire within the refresh buffer
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;

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

    it('should refresh tokens with exactly 60 seconds remaining', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 60;

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

    it('should share one refresh between concurrent requests for the same session', async () => {
      let resolveRefresh;
      mockClient.refresh.mockReturnValue(new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
      const secondReq = {
        ...req,
        session: {
          ...req.session,
          user: {
            ...req.session.user,
            claims: { ...req.session.user.claims },
            tokens: { ...req.session.user.tokens }
          },
          save: jest.fn((cb) => cb())
        }
      };
      const secondNext = jest.fn();

      const firstCall = refreshTokenMiddleware(req, res, next);
      const secondCall = refreshTokenMiddleware(secondReq, res, secondNext);
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh({
        access_token: 'shared-access-token',
        id_token: 'shared-id-token',
        refresh_token: 'shared-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
      await Promise.all([firstCall, secondCall]);

      expect(next).toHaveBeenCalled();
      expect(secondNext).toHaveBeenCalled();
    });

    it('should synchronize refreshed auth state into a waiter session before next', async () => {
      let resolveRefresh;
      mockClient.refresh.mockReturnValue(new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
      const ownerSession = req.session;
      const waiterSession = {
        ...ownerSession,
        user: {
          ...ownerSession.user,
          claims: { ...ownerSession.user.claims },
          tokens: { ...ownerSession.user.tokens }
        },
        save: jest.fn((cb) => cb())
      };
      const waiterReq = { ...req, session: waiterSession };
      const waiterNext = jest.fn(() => {
        expect(waiterSession.user.tokens).toEqual({
          access_token: 'encrypted:shared-access-token',
          id_token: 'encrypted:shared-id-token',
          refresh_token: 'encrypted:rotated-refresh-token',
          expires_at: 1234567890
        });
        expect(waiterSession.user.claims).toEqual(expect.objectContaining({
          name: 'Shared User',
          role: 'admin'
        }));
      });

      expect(ownerSession).not.toBe(waiterSession);
      expect(ownerSession.user).not.toBe(waiterSession.user);

      const ownerCall = refreshTokenMiddleware(req, res, next);
      const waiterCall = refreshTokenMiddleware(waiterReq, res, waiterNext);
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh({
        access_token: 'shared-access-token',
        id_token: 'shared-id-token',
        refresh_token: 'rotated-refresh-token',
        expires_at: 1234567890,
        claims: () => ({
          name: 'Shared User',
          role: 'admin'
        })
      });
      await Promise.all([ownerCall, waiterCall]);

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(ownerSession.save).toHaveBeenCalledTimes(1);
      expect(waiterSession.save).not.toHaveBeenCalled();
      expect(waiterNext).toHaveBeenCalledTimes(1);
    });

    it('should keep sharing the refresh until the updated session is saved', async () => {
      let finishSave;
      req.session.save.mockImplementation((cb) => {
        finishSave = cb;
      });
      const secondReq = {
        ...req,
        session: {
          ...req.session,
          user: {
            ...req.session.user,
            claims: { ...req.session.user.claims },
            tokens: { ...req.session.user.tokens }
          }
        }
      };
      const secondNext = jest.fn();

      const firstCall = refreshTokenMiddleware(req, res, next);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      const secondCall = refreshTokenMiddleware(secondReq, res, secondNext);
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
      expect(secondNext).not.toHaveBeenCalled();

      finishSave();
      await Promise.all([firstCall, secondCall]);

      expect(next).toHaveBeenCalledTimes(1);
      expect(secondNext).toHaveBeenCalledTimes(1);
    });

    it('should refresh different sessions independently', async () => {
      const secondReq = {
        ...req,
        sessionID: 'other-session-id',
        session: {
          ...req.session,
          user: {
            ...req.session.user,
            claims: { ...req.session.user.claims },
            tokens: { ...req.session.user.tokens }
          },
          save: jest.fn((cb) => cb())
        }
      };
      const secondNext = jest.fn();

      await Promise.all([
        refreshTokenMiddleware(req, res, next),
        refreshTokenMiddleware(secondReq, res, secondNext)
      ]);

      expect(mockClient.refresh).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
      expect(secondNext).toHaveBeenCalled();
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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
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

    it('should destroy the session for invalid_grant even with HTTP 500', async () => {
      const error = new Error('Refresh credentials were rejected');
      error.error = 'invalid_grant';
      error.statusCode = 500;
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalledTimes(1);
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'token_refresh_failure',
          errorMessage: 'invalid_grant'
        })
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should destroy the session for invalid_client even with HTTP 503', async () => {
      const error = new Error('Provider rejected client credentials');
      error.response = {
        status: 503,
        body: { error: 'invalid_client' }
      };
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).toHaveBeenCalledTimes(1);
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'token_refresh_failure',
          errorMessage: 'invalid_client'
        })
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should preserve the session and refresh token after a timeout', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 1;
      const storedRefreshToken = req.session.user.tokens.refresh_token;
      mockClient.refresh.mockRejectedValue(new Error('outgoing request timed out after 3500ms'));

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(req.session.user.tokens.refresh_token).toBe(storedRefreshToken);
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'token_refresh_transient_failure' })
      );
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'TOKEN_REFRESH_TEMPORARY_FAILURE',
        retryable: true
      }));
    });

    it('should preserve the session after ECONNRESET', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 1;
      const error = new Error('socket closed');
      error.code = 'ECONNRESET';
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should treat temporarily_unavailable as transient', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 1;
      const error = new Error('provider rejected refresh');
      error.error = 'temporarily_unavailable';
      error.statusCode = 400;
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'token_refresh_transient_failure',
          errorMessage: 'temporarily_unavailable'
        })
      );
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it.each([500, 503])('should treat HTTP %i without an OAuth error as transient', async (statusCode) => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 1;
      const error = new Error('provider request failed');
      error.statusCode = statusCode;
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'token_refresh_transient_failure' })
      );
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should continue after a transient failure while the access token is valid', async () => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
      const error = new Error('request failed');
      error.code = 'ETIMEDOUT';
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should perform failure side effects once for concurrent requests sharing a rejected refresh', async () => {
      let rejectRefresh;
      mockClient.refresh.mockReturnValue(new Promise((resolve, reject) => {
        rejectRefresh = reject;
      }));
      const secondReq = {
        ...req,
        session: {
          ...req.session,
          user: {
            ...req.session.user,
            claims: { ...req.session.user.claims },
            tokens: { ...req.session.user.tokens }
          }
        }
      };
      const secondRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn()
      };

      const firstCall = refreshTokenMiddleware(req, res, next);
      const secondCall = refreshTokenMiddleware(secondReq, secondRes, jest.fn());
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      rejectRefresh(new Error('Shared refresh failed'));
      await Promise.all([firstCall, secondCall]);

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(mockDatabase.logAuthEvent).toHaveBeenCalledTimes(1);
      expect(req.session.destroy).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'TOKEN_REFRESH_FAILED'
      }));
      expect(secondRes.status).toHaveBeenCalledWith(401);
      expect(secondRes.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'TOKEN_REFRESH_FAILED'
      }));
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
        errorMessage: 'oidc_refresh_rejected',
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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
      
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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
      
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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
      
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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 30;
      
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
