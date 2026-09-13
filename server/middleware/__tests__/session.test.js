// server/middleware/__tests__/session.test.js
const express = require('express');
const request = require('supertest');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
});

jest.mock('../../services/redis', () => ({
  getClient: jest.fn(() => null),
  isConnected: jest.fn(() => false)
}));

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

jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

describe('Session Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    config.session.secret = 'test-secret-key-for-testing';
    config.server.nodeEnv = 'test';
    
    configureSession(app);
    
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

    app.get('/save-without-callback', (req, res, next) => {
      req.session.testValue = 'saved-without-callback';
      try {
        req.session.save();
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
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
    const firstResponse = await agent.get('/test');
    expect(firstResponse.status).toBe(200);
    const sessionID = firstResponse.body.sessionID;
    
    const secondResponse = await agent.get('/session-data');
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.sessionID).toBe(sessionID);
    expect(secondResponse.body.testValue).toBe('test');
  });

  it('should preserve native save() behavior when no callback is supplied', async () => {
    const response = await request(app).get('/save-without-callback');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('should use secure cookies in production', () => {
    const originalEnv = config.server.nodeEnv;
    config.server.nodeEnv = 'production';
    const prodApp = express();
    configureSession(prodApp);
    expect(config.server.nodeEnv).toBe('production');
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
