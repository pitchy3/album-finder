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
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) + 600;

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

  describe('Authentik 300-second access token regression', () => {
    const issuedAt = 2000000000;

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(issuedAt * 1000);
      req.session.user.tokens = {
        access_token: 'encrypted:login-access-token',
        id_token: 'encrypted:login-id-token',
        // Authentik keeps this token valid for 30 days in production.
        refresh_token: 'encrypted:authentik-30-day-refresh-token',
        expires_at: issuedAt + 300
      };
      mockClient.refresh.mockResolvedValue({
        access_token: 'refreshed-access-token',
        id_token: 'refreshed-id-token',
        refresh_token: 'authentik-30-day-refresh-token',
        expires_at: issuedAt + 300
      });
    });

    afterEach(() => {
      Date.now.mockRestore();
    });

    it('does not refresh the login session immediately after a 300-second token is issued', async () => {
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.user.tokens.expires_at).toBe(issuedAt + 300);
      expect(mockClient.refresh).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not refresh with approximately 299 seconds remaining', async () => {
      Date.now.mockReturnValue((issuedAt + 1) * 1000);

      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('begins refreshing only after entering the 60-second refresh window', async () => {
      Date.now.mockReturnValue((issuedAt + 239) * 1000);
      await refreshTokenMiddleware(req, res, next);
      expect(mockClient.refresh).not.toHaveBeenCalled();

      Date.now.mockReturnValue((issuedAt + 240) * 1000);
      await refreshTokenMiddleware(req, res, next);

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(mockClient.refresh).toHaveBeenCalledWith('authentik-30-day-refresh-token');
    });

    it('does not refresh again on the next request after receiving another 300-second token', async () => {
      Date.now.mockReturnValue((issuedAt + 270) * 1000);
      mockClient.refresh.mockResolvedValue({
        access_token: 'refreshed-access-token',
        id_token: 'refreshed-id-token',
        refresh_token: 'authentik-30-day-refresh-token',
        expires_at: issuedAt + 570
      });

      await refreshTokenMiddleware(req, res, next);
      await refreshTokenMiddleware(req, res, next);

      expect(req.session.user.tokens.expires_at).toBe(issuedAt + 570);
      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('coalesces parallel requests into one refresh call', async () => {
      Date.now.mockReturnValue((issuedAt + 270) * 1000);
      let resolveRefresh;
      mockClient.refresh.mockReturnValue(new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
      const parallelReq = {
        ...req,
        session: {
          ...req.session,
          user: {
            ...req.session.user,
            claims: { ...req.session.user.claims },
            tokens: { ...req.session.user.tokens }
          },
          save: jest.fn((callback) => callback())
        }
      };
      const parallelNext = jest.fn();

      const firstRequest = refreshTokenMiddleware(req, res, next);
      const secondRequest = refreshTokenMiddleware(parallelReq, res, parallelNext);
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh({
        access_token: 'refreshed-access-token',
        id_token: 'refreshed-id-token',
        refresh_token: 'authentik-30-day-refresh-token',
        expires_at: issuedAt + 570
      });
      await Promise.all([firstRequest, secondRequest]);

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect(parallelNext).toHaveBeenCalledTimes(1);
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

      const first = refreshTokenMiddleware(req, res, next);
      const second = refreshTokenMiddleware(secondReq, res, secondNext);
      await Promise.resolve();

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);

      resolveRefresh({
        access_token: 'new-access-token',
        id_token: 'new-id-token',
        refresh_token: 'rotated-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        claims: () => ({ sub: 'user-123', name: 'Updated' })
      });

      await Promise.all([first, second]);

      expect(mockClient.refresh).toHaveBeenCalledTimes(1);
      expect(secondReq.session.user.tokens.access_token).toBe('encrypted:new-access-token');
      expect(secondReq.session.user.tokens.refresh_token).toBe('encrypted:rotated-refresh-token');
      expect(secondReq.session.user.claims.name).toBe('Updated');
      expect(secondNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshTokenMiddleware - Refresh Failures', () => {
    beforeEach(() => {
      req.session.user.tokens.expires_at = Math.floor(Date.now() / 1000) - 10;
    });

    it('should return 503 for transient timeout when access token is expired', async () => {
      const error = new Error('outgoing request timed out after 3500ms');
      error.code = 'ETIMEDOUT';
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(req.session.destroy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'TOKEN_REFRESH_TEMPORARY_FAILURE',
        retryable: true
      }));
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

      const sharedError = new Error('Shared refresh failed');
      sharedError.error = 'invalid_grant';
      rejectRefresh(sharedError);
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
      const error = new Error('Token expired');
      error.error = 'invalid_grant';
      mockClient.refresh.mockRejectedValue(error);

      await refreshTokenMiddleware(req, res, next);

      expect(mockDatabase.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'token_refresh_failure',
        userId: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        ipAddress: '127.0.0.1',
        userAgent: 'test-user-agent',
        errorMessage: 'invalid_grant',
        sessionId: 'test-session-id',
        metadata: expect.objectContaining({
          timestamp: expect.any(String),
          elapsedMs: expect.any(Number),
          sessionId: 'test-session-id',
          accessTokenExpiresAt: expect.any(Number),
          timeUntilExpiry: expect.any(Number)
        })
      }));
    });
  });

  describe('forceTokenRefresh', () => {
    beforeEach(() => {
      mockClient.refresh.mockResolvedValue({
        access_token: 'forced-access-token',
        refresh_token: 'forced-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      });
    });

    it('refreshes and persists through the shared refresh path', async () => {
      const tokenSet = await forceTokenRefresh(req);

      expect(mockClient.refresh).toHaveBeenCalledWith('old-refresh-token');
      expect(req.session.save).toHaveBeenCalledTimes(1);
      expect(req.session.user.tokens.access_token).toBe('encrypted:forced-access-token');
      expect(req.session.user.tokens.refresh_token).toBe('encrypted:forced-refresh-token');
      expect(tokenSet.access_token).toBe('forced-access-token');
    });
  });

  describe('getAccessToken', () => {
    it('returns decrypted access token for OIDC sessions', () => {
      expect(getAccessToken(req)).toBe('old-access-token');
    });

    it('returns null for non-OIDC sessions', () => {
      req.session.user.claims.authType = 'basicauth';
      expect(getAccessToken(req)).toBeNull();
    });
  });
});
