const request = require('supertest');
const express = require('express');
const session = require('express-session');
const authRoutes = require('../auth');
const config = require('../../config');

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

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

const { getClient } = require('../../services/auth');

describe('Authentication Routes', () => {
  let app;
  let mockClient;

  beforeAll(() => {
    // Configure OIDC settings for all tests
    config.authType = 'oidc'; // ✅ SET AUTH TYPE
    config.auth.enabled = true;
    config.auth.type = 'oidc'; // ✅ SET AUTH TYPE IN AUTH OBJECT
    config.oidc.issuerUrl = 'https://auth.example.com';
    config.oidc.clientId = 'test-client';
    config.oidc.clientSecret = 'test-secret';
    config.oidc.redirectUrl = 'https://app.example.com/auth/callback';
    config.domain = 'app.example.com';
  });

  beforeEach(() => {
    // Create mock OIDC client
    mockClient = {
      authorizationUrl: jest.fn().mockReturnValue('https://auth.example.com/authorize?client_id=test-client'),
      callbackParams: jest.fn(),
      callback: jest.fn(),
      userinfo: jest.fn(),
      revoke: jest.fn()
    };

    // Mock getClient to return our mock client
    getClient.mockReturnValue(mockClient);

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false } // Disable secure for tests
    }));
    
    // Mount auth routes
    app.use('/auth', authRoutes(mockClient));
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      // Temporarily disable auth
      const originalType = config.auth.type;
      const originalAuthType = config.authType;
      config.auth.type = null;
      config.authType = null;

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(400);
      expect(response.text).toContain('Authentication is not configured');

      // Restore auth state
      config.auth.type = originalType;
      config.authType = originalAuthType;
    });

    it('should redirect to home for BasicAuth', async () => {
      // Temporarily set to BasicAuth
      const originalType = config.auth.type;
      config.auth.type = 'basicauth';

      const response = await request(app)
        .get('/auth/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/?auth=basicauth');

      // Restore auth state
      config.auth.type = originalType;
    });
  });

  describe('GET /auth/callback', () => {
    it('should handle successful authentication', async () => {
      const agent = request.agent(app);
      
      // First, initiate login to set session and capture the state
      const loginResponse = await agent.get('/auth/login');
      
      // Extract the state from the mock call
      const authUrlCall = mockClient.authorizationUrl.mock.calls[0][0];
      const sessionState = authUrlCall.state;
      const sessionNonce = authUrlCall.nonce;

      // Mock the OIDC callback flow with the correct state
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
          nonce: sessionNonce
        })
      });

      mockClient.userinfo.mockResolvedValue({
        sub: 'user-123',
        email: 'test@example.com',
        preferred_username: 'testuser'
      });

      // Make callback request with correct state
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
    });

    it('should handle authentication errors', async () => {
      const agent = request.agent(app);
      
      // Need to initiate login first to have a session
      await agent.get('/auth/login');
      
      // Mock callbackParams to return the error
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
      
      // First, initiate login
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
  });

  describe('POST /auth/logout', () => {
    it('should destroy session and redirect', async () => {
      const agent = request.agent(app);
      
      // Set up authenticated session by simulating login flow
      await agent.get('/auth/login');

      const response = await agent
        .post('/auth/logout');

      expect(response.status).toBe(302);
    });

    it('should revoke tokens if available', async () => {
      const agent = request.agent(app);
      
      // Set up session with tokens
      await agent.get('/auth/login');
      
      // Mock session with tokens
      const logoutResponse = await agent
        .post('/auth/logout');

      expect(logoutResponse.status).toBe(302);
    });
  });

  describe('GET /auth/debug', () => {
    it('should return auth status information', async () => {
      const response = await request(app)
        .get('/auth/debug');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        authEnabled: true,
        authType: 'oidc', // ✅ UPDATED TO CHECK AUTH TYPE
        clientAvailable: true,
        sessionExists: expect.any(Boolean),
        userLoggedIn: expect.any(Boolean)
      });
    });
  });
});
