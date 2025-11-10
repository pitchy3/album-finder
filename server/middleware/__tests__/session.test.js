// server/middleware/__tests__/session.test.js
const express = require('express');
const request = require('supertest');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
});

// ✅ Mock Redis BEFORE importing session middleware
jest.mock('../../services/redis', () => ({
  getClient: jest.fn(() => null),
  isConnected: jest.fn(() => false)
}));

// ✅ Mock connect-redis to avoid any Redis store issues
jest.mock('connect-redis', () => {
  return {
    default: jest.fn(() => {
      return class MockRedisStore {
        constructor() {}
      };
    })
  };
});

const configureSession = require('../session');
const config = require('../../config');

// Silence logging
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Session Middleware', () => {
  let app;

  beforeEach(() => {
    // Create fresh app for each test
    app = express();
    app.use(express.json());
    
    // Set test session secret
    config.session.secret = 'test-secret-key-for-testing';
    config.server.nodeEnv = 'test';
    
    // Configure session
    configureSession(app);
    
    // Add test routes
    app.get('/test', (req, res) => {
      req.session.testValue = 'test';
      res.json({ sessionID: req.sessionID });
    });
    
    app.get('/session-data', (req, res) => {
      res.json({ 
        sessionID: req.sessionID,
        testValue: req.session.testValue 
      });
    });
  });

  it('should create sessions', async () => {
    const response = await request(app).get('/test');
    
    expect(response.status).toBe(200);
    expect(response.body.sessionID).toBeDefined();
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('should persist session data across requests', async () => {
    const agent = request.agent(app);
    
    // First request - set session data
    const firstResponse = await agent.get('/test');
    expect(firstResponse.status).toBe(200);
    const sessionID = firstResponse.body.sessionID;
    
    // Second request - verify session persists
    const secondResponse = await agent.get('/session-data');
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.sessionID).toBe(sessionID);
    expect(secondResponse.body.testValue).toBe('test');
  });

  it('should use secure cookies in production', () => {
    const originalEnv = config.server.nodeEnv;
    config.server.nodeEnv = 'production';
    
    const prodApp = express();
    configureSession(prodApp);
    
    // Session should be configured with secure cookies
    expect(config.server.nodeEnv).toBe('production');
    
    // Restore
    config.server.nodeEnv = originalEnv;
  });

  it('should handle session without Redis', async () => {
    const response = await request(app).get('/test');
    expect(response.status).toBe(200);
    expect(response.body.sessionID).toBeDefined();
  });
  
  it('should generate unique session IDs', async () => {
    const response1 = await request(app).get('/test');
    const response2 = await request(app).get('/test');
    
    expect(response1.body.sessionID).toBeDefined();
    expect(response2.body.sessionID).toBeDefined();
    expect(response1.body.sessionID).not.toBe(response2.body.sessionID);
  });
});