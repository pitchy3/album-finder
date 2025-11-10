// server/routes/__tests__/auth.test.js
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const authRoutes = require('../auth');
const config = require('../../config');
const crypto = require('crypto');

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// ✅ Mock rate limiting BEFORE it's imported
jest.mock('../../middleware/rateLimit');

// Mock the auth service
jest.mock('../../services/auth', () => ({
  getClient: jest.fn(),
  getIssuer: jest.fn(),
  validateBasicAuthPassword: jest.fn()
}));

// Mock the database service
jest.mock('../../services/database', () => ({
  database: {
    logAuthEvent: jest.fn().mockResolvedValue(undefined)
  }
}));

const { getClient, validateBasicAuthPassword } = require('../../services/auth');
const { database } = require('../../services/database');

// Mock token encryption to skip real crypto validation
jest.mock('../../services/tokenEncryption', () => ({
  encryptToken: jest.fn((token) => `enc(${token})`),
  decryptToken: jest.fn((token) => token.replace(/^enc\(|\)$/g, ''))
}));

describe('Authentication Routes', () => {
  let app;
  let mockClient;

  beforeAll(() => {
    // Configure OIDC settings for all tests
    config.authType = 'oidc';
    config.auth.enabled = true;
    config.auth.type = 'oidc';
    config.oidc.issuerUrl = 'https://auth.example.com';
    config.oidc.clientId = 'test-client';
    config.oidc.clientSecret = 'test-secret';
    config.oidc.redirectUrl = 'https://app.example.com/auth/callback';
    config.oidc.scopes = 'openid profile email';
    config.domain = 'app.example.com';
    config.session.secret = 'test-secret';
  });

  beforeEach(() => {
    // Create mock OIDC client
    mockClient = {
      authorizationUrl: jest.fn().mockReturnValue('https://auth.example.com/authorize?client_id=test-client'),
      callbackParams: jest.fn(),
      callback: jest.fn(),
      userinfo: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined)
    };
	
	// Default mock OIDC callback and params
    mockClient.callbackParams.mockImplementation((req) => ({
      code: 'mock-code',
      state: 'mock-state'
    }));
    
    mockClient.callback.mockResolvedValue({
      access_token: 'access123',
      id_token: 'idtoken123',
      expires_at: Date.now() / 1000 + 3600,
      claims: () => ({
        sub: 'user-123',
        iss: config.oidc.issuerUrl,
        aud: config.oidc.clientId,
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
        nonce: 'mock-nonce'
      })
    });
    
    mockClient.userinfo.mockResolvedValue({
      sub: 'user-123',
      email: 'test@example.com',
      preferred_username: 'testuser',
      name: 'Test User'
    });


    // Mock getClient to return our mock client
    getClient.mockReturnValue(mockClient);

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
    }));
    
    // Mount auth routes
    app.use('/auth', authRoutes(mockClient));
	
	// Inject mock session data required by /auth/callback
    app.use((req, res, next) => {
      req.session = req.session || {};
      req.session.state = 'mock-state';
      req.session.nonce = 'mock-nonce';
      req.session.codeVerifier = 'mock-verifier';
      next();
    });

  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login/basicauth', () => {
    beforeEach(() => {
      config.auth.type = 'basicauth';
      config.authType = 'basicauth';
    });

    afterEach(() => {
      config.auth.type = 'oidc';
      config.authType = 'oidc';
    });

    it('should successfully login with valid credentials', async () => {
      validateBasicAuthPassword.mockResolvedValue(true);

      const response = await request(app)
        .post('/auth/login/basicauth')
        .send({
          username: 'testuser',
          password: 'testpassword'
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        user: {
          username: 'testuser',
          authType: 'basicauth'
        }
      });
      expect(database.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'login_success',
          username: 'testuser'
        })
      );
    });

    it('should reject invalid credentials', async () => {
      validateBasicAuthPassword.mockResolvedValue(false);

      const response = await request(app)
        .post('/auth/login/basicauth')
        .send({
          username: 'testuser',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid username or password');
      expect(database.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'login_failure',
          errorMessage: 'Invalid username or password'
        })
      );
    });

    it('should return error if BasicAuth is not enabled', async () => {
      config.auth.type = 'oidc';

      const response = await request(app)
        .post('/auth/login/basicauth')
        .send({
          username: 'testuser',
          password: 'testpassword'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('BasicAuth is not enabled');
    });

    it('should require username and password', async () => {
      const response = await request(app)
        .post('/auth/login/basicauth')
        .send({
          username: 'testuser'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username and password are required');
    });

    it('should handle authentication errors', async () => {
      validateBasicAuthPassword.mockRejectedValue(new Error('Auth service error'));

      const response = await request(app)
        .post('/auth/login/basicauth')
        .send({
          username: 'testuser',
          password: 'testpassword'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Authentication error');
    });
  });

  describe('GET /auth/login', () => {
    it('should redirect to OIDC provider', async () => {
      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('auth.example.com');
      expect(mockClient.authorizationUrl).toHaveBeenCalled();
    });

    it('should set session parameters', async () => {
      const agent = request.agent(app);
      const response = await agent.get('/auth/login');

      expect(response.status).toBe(302);
      expect(mockClient.authorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: expect.any(String),
          redirect_uri: expect.any(String),
          code_challenge: expect.any(String),
          code_challenge_method: 'S256',
          state: expect.any(String),
          nonce: expect.any(String)
        })
      );
    });

    it('should return error if auth not configured', async () => {
      const originalType = config.auth.type;
      const originalAuthType = config.authType;
      config.auth.type = null;
      config.authType = null;

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(400);
      expect(response.text).toContain('Authentication is not configured');

      config.auth.type = originalType;
      config.authType = originalAuthType;
    });

    it('should redirect to home for BasicAuth', async () => {
      const originalType = config.auth.type;
      config.auth.type = 'basicauth';

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/?auth=basicauth');

      config.auth.type = originalType;
    });

    it('should return error if no OIDC client available', async () => {
      getClient.mockReturnValueOnce(null);

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(500);
      expect(response.text).toContain('Authentication Configuration Error');
    });

    it('should handle authorizationUrl errors', async () => {
      mockClient.authorizationUrl.mockImplementation(() => {
        throw new Error('Authorization URL generation failed');
      });

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(500);
      expect(response.text).toContain('Failed to generate login URL');
    });
  });

  describe('GET /auth/callback', () => {
    it('should handle successful authentication', async () => {
      const agent = request.agent(app);
      
      // First establish session with state and nonce
      await agent.get('/auth/login');
      
      const authUrlCall = mockClient.authorizationUrl.mock.calls[0][0];
      const sessionState = authUrlCall.state;
      const sessionNonce = authUrlCall.nonce;

      // ✅ FIX: Mock callbackParams to return the state
      mockClient.callbackParams.mockReturnValue({
        code: 'mock-auth-code',
        state: sessionState
      });

      // ✅ FIX: Mock callback to return valid token set with matching nonce
      mockClient.callback.mockResolvedValue({
        access_token: 'mock-access-token',
        id_token: 'mock-id-token',
        expires_at: Date.now() / 1000 + 3600,
        claims: () => ({
          sub: 'user-123',
          iss: config.oidc.issuerUrl,
          aud: config.oidc.clientId,
          exp: Date.now() / 1000 + 3600,
          iat: Date.now() / 1000,
          nonce: sessionNonce  // ✅ Must match session nonce
        })
      });

      mockClient.userinfo.mockResolvedValue({
        sub: 'user-123',
        email: 'test@example.com',
        preferred_username: 'testuser',
        name: 'Test User'
      });

      const response = await agent
        .get('/auth/callback')
        .query({
          code: 'mock-auth-code',
          state: sessionState
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
      expect(mockClient.callback).toHaveBeenCalled();
      expect(mockClient.userinfo).toHaveBeenCalled();
      expect(database.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'login_success',
          userId: 'user-123'
        })
      );
    });

    it('should handle authentication errors', async () => {
      const agent = request.agent(app);
      
      await agent.get('/auth/login');
      
      mockClient.callbackParams.mockReturnValue({
        error: 'access_denied',
        error_description: 'User denied access'
      });

      const response = await agent
        .get('/auth/callback')
        .query({
          error: 'access_denied',
          error_description: 'User denied access'
        });

      expect(response.status).toBe(400);
      expect(response.text).toContain('access_denied');
    });

    it('should handle missing session data', async () => {
      mockClient.callbackParams.mockReturnValue({
        code: 'mock-auth-code',
        state: 'mock-state'
      });

      const response = await request(app)
        .get('/auth/callback')
        .query({
          code: 'mock-auth-code',
          state: 'mock-state'
        });

      expect(response.status).toBe(400);
      expect(response.text).toContain('Session expired. Please try logging in again.');
    });

    it('should validate state parameter', async () => {
      const agent = request.agent(app);
      
      await agent.get('/auth/login');

      mockClient.callbackParams.mockReturnValue({
        code: 'mock-auth-code',
        state: 'wrong-state'
      });

      const response = await agent
        .get('/auth/callback')
        .query({
          code: 'mock-auth-code',
          state: 'wrong-state'
        });

      expect(response.status).toBe(400);
      expect(response.text).toContain('Invalid state parameter');
    });

    it('should validate nonce in ID token', async () => {
      const agent = request.agent(app);
      
      await agent.get('/auth/login');
      
      const authUrlCall = mockClient.authorizationUrl.mock.calls[0][0];
      const sessionState = authUrlCall.state;

      mockClient.callbackParams.mockReturnValue({
        code: 'mock-auth-code',
        state: sessionState
      });

      mockClient.callback.mockResolvedValue({
        access_token: 'mock-access-token',
        id_token: 'mock-id-token',
        expires_at: Date.now() / 1000 + 3600,
        claims: () => ({
          sub: 'user-123',
          iss: config.oidc.issuerUrl,
          aud: config.oidc.clientId,
          exp: Date.now() / 1000 + 3600,
          iat: Date.now() / 1000,
          nonce: 'wrong-nonce'
        })
      });

      const response = await agent
        .get('/auth/callback')
        .query({
          code: 'mock-auth-code',
          state: sessionState
        });

      expect(response.status).toBe(500);
      expect(response.text).toContain('Authentication error');
    });

    it('should return error if not configured for OIDC', async () => {
      const originalType = config.auth.type;
      config.auth.type = 'basicauth';

      const response = await request(app)
        .get('/auth/callback');

      expect(response.status).toBe(400);
      expect(response.text).toContain('OIDC authentication is not configured');

      config.auth.type = originalType;
    });

    it('should return error if no OIDC client available', async () => {
      const agent = request.agent(app);
      await agent.get('/auth/login');
      
      getClient.mockReturnValueOnce(null);

      const response = await agent
        .get('/auth/callback')
        .query({ code: 'test', state: 'test' });

      expect(response.status).toBe(500);
      expect(response.text).toContain('Authentication not properly configured');
    });
  });

  describe('POST /auth/logout', () => {
    it('should destroy session and redirect', async () => {
      const agent = request.agent(app);
      
      await agent.get('/auth/login');

      const response = await agent
        .post('/auth/logout');

      expect(response.status).toBe(302);
    });

    it('should log logout event', async () => {
      const originalType = config.auth.type;
      const originalAuthType = config.authType;
      config.auth.type = 'basicauth';
      config.authType = 'basicauth';
    
      validateBasicAuthPassword.mockResolvedValue(true);
    
      const agent = request.agent(app);
    
      try {
        await agent
          .post('/auth/login/basicauth')
          .send({ username: 'testuser', password: 'testpassword' })
          .expect(200);
    
        await agent.post('/auth/logout').expect(302);
    
        expect(database.logAuthEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'logout',
            username: 'testuser'
          })
        );
      } finally {
        config.auth.type = originalType;
        config.authType = originalAuthType;
      }
    });

    it('should handle token revocation errors gracefully', async () => {
      mockClient.revoke.mockRejectedValue(new Error('Revocation failed'));

      const agent = request.agent(app);
      const response = await agent.post('/auth/logout');

      expect(response.status).toBe(302);
    });
  });

  describe('GET /auth/debug', () => {
    it('should return auth status information', async () => {
      const response = await request(app)
        .get('/auth/debug');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        authEnabled: true,
        authType: 'oidc',
        clientAvailable: true,
        sessionExists: expect.any(Boolean),
        userLoggedIn: expect.any(Boolean)
      });
    });

    it('should work when auth is disabled', async () => {
      const originalEnabled = config.auth.enabled;
      config.auth.enabled = false;

      const response = await request(app)
        .get('/auth/debug');

      expect(response.status).toBe(200);
      expect(response.body.authEnabled).toBe(false);

      config.auth.enabled = originalEnabled;
    });

    it('should indicate BasicAuth type correctly', async () => {
      const originalType = config.auth.type;
      config.auth.type = 'basicauth';

      const response = await request(app)
        .get('/auth/debug');

      expect(response.status).toBe(200);
      expect(response.body.authType).toBe('basicauth');

      config.auth.type = originalType;
    });
  });
});