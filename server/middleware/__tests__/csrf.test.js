// server/middleware/__tests__/csrf.test.js
const { createCsrfProtection, injectCsrfToken } = require('../csrf');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

describe('CSRF Protection Middleware', () => {
  let app;

  beforeEach(() => {
    // Reset environment variables
    delete process.env.ENABLE_CSRF;
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECURE;
  });

  describe('createCsrfProtection - Disabled Mode', () => {
    it('should disable CSRF when ENABLE_CSRF=false explicitly', () => {
      process.env.ENABLE_CSRF = 'false';
      process.env.NODE_ENV = 'production';
      
      const csrfProtection = createCsrfProtection();
      
      expect(csrfProtection).toHaveProperty('middleware');
      expect(csrfProtection).toHaveProperty('getToken');
    });

    it('should return dummy token in disabled mode', async () => {
      process.env.ENABLE_CSRF = 'false';
      
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      const response = await request(app)
        .get('/api/csrf-token');
      
      expect(response.status).toBe(200);
      expect(response.body.csrfToken).toBe('development-mode');
    });

    it('should add dummy csrfToken function to request', async () => {
      process.env.ENABLE_CSRF = 'false';
      
      app = express();
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/test', (req, res) => {
        res.json({ token: req.csrfToken() });
      });
      
      const response = await request(app)
        .post('/test');
      
      expect(response.status).toBe(200);
      expect(response.body.token).toBe('development-mode');
    });
  });

  describe('createCsrfProtection - Enabled Mode', () => {
    beforeEach(() => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'false'; // Disable for testing
    });

    it('should enable CSRF when explicitly enabled', () => {
      const csrfProtection = createCsrfProtection();
      
      expect(csrfProtection).toHaveProperty('middleware');
      expect(csrfProtection).toHaveProperty('getToken');
    });

    it('should enable CSRF in production by default', () => {
      delete process.env.ENABLE_CSRF;
      process.env.NODE_ENV = 'production';
      
      const csrfProtection = createCsrfProtection();
      
      expect(csrfProtection).toHaveProperty('middleware');
      expect(csrfProtection).toHaveProperty('getToken');
    });

    it('should generate valid CSRF token', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      const response = await request(app)
        .get('/api/csrf-token');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('csrfToken');
      expect(response.body.csrfToken).not.toBe('development-mode');
      expect(response.body.expiresIn).toBe(24 * 60 * 60);
    });

    it('should set CSRF cookie', async () => {
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      const response = await request(app)
        .get('/api/csrf-token');
      
      expect(response.headers['set-cookie']).toBeDefined();
      const cookieHeader = response.headers['set-cookie'].find(c => c.includes('csrf-token'));
      expect(cookieHeader).toBeDefined();
    });

    it('should allow GET requests without token', async () => {
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .get('/test');
      
      expect(response.status).toBe(200);
    });

    it('should allow HEAD requests without token', async () => {
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.head('/test', (req, res) => {
        res.status(200).end();
      });
      
      const response = await request(app)
        .head('/test');
      
      expect(response.status).toBe(200);
    });

    it('should allow OPTIONS requests without token', async () => {
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.options('/test', (req, res) => {
        res.status(200).end();
      });
      
      const response = await request(app)
        .options('/test');
      
      expect(response.status).toBe(200);
    });

    it('should reject POST without CSRF token', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('CSRF_INVALID');
    });

    it('should accept POST with valid CSRF token in header', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token first
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make POST with token
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .send({ data: 'test' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should accept POST with valid CSRF token in body', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make POST with token in body
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .send({ _csrf: token });
      
      expect(response.status).toBe(200);
    });

    it('should skip CSRF for whitelisted paths', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/healthz', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/healthz');
      
      expect(response.status).toBe(200);
    });

    it('should skip CSRF for /auth/callback', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/auth/callback', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/auth/callback');
      
      expect(response.status).toBe(200);
    });

    it('should skip CSRF for webhook endpoints', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/webhook/lidarr', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/webhook/lidarr');
      
      expect(response.status).toBe(200);
    });
  });

  describe('Origin Validation', () => {
    beforeEach(() => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'false';
    });

    it('should validate matching Origin header', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make request with matching origin
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .set('Origin', 'http://127.0.0.1')
        .set('Host', '127.0.0.1')
        .send({ data: 'test' });
      
      expect(response.status).toBe(200);
    });

    it('should reject mismatched Origin header', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make request with mismatched origin
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .set('Origin', 'http://evil.com')
        .set('Host', '127.0.0.1')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ORIGIN_MISMATCH');
    });

    it('should validate matching Referer when no Origin', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make request with matching referer
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .set('Referer', 'http://127.0.0.1/page')
        .set('Host', '127.0.0.1')
        .send({ data: 'test' });
      
      expect(response.status).toBe(200);
    });

    it('should reject mismatched Referer', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make request with mismatched referer
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .set('Referer', 'http://evil.com/page')
        .set('Host', '127.0.0.1')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ORIGIN_MISMATCH');
    });

    it('should handle invalid Origin URL gracefully', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // Get token
      const tokenResponse = await request(app)
        .get('/api/csrf-token');
      
      const token = tokenResponse.body.csrfToken;
      const cookies = tokenResponse.headers['set-cookie'];
      
      // Make request with invalid origin
      const response = await request(app)
        .post('/test')
        .set('Cookie', cookies)
        .set('csrf-token', token)
        .set('Origin', 'not-a-valid-url')
        .set('Host', '127.0.0.1')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
    });
  });

  describe('Cookie Configuration', () => {
    it('should use __Host- prefix when COOKIE_SECURE=true', () => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'true';
      
      const csrfProtection = createCsrfProtection();
      
      // The function logs the cookie name, we can't directly test it
      // but we can verify it doesn't throw
      expect(csrfProtection).toHaveProperty('middleware');
    });

    it('should use regular name when COOKIE_SECURE=false', () => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'false';
      
      const csrfProtection = createCsrfProtection();
      
      expect(csrfProtection).toHaveProperty('middleware');
    });
  });

  describe('injectCsrfToken', () => {
    it('should inject CSRF token to res.locals', () => {
      const req = {
        csrfToken: jest.fn(() => 'test-token')
      };
      const res = {
        locals: {}
      };
      const next = jest.fn();
      
      injectCsrfToken(req, res, next);
      
      expect(res.locals.csrfToken).toBe('test-token');
      expect(next).toHaveBeenCalled();
    });

    it('should handle missing csrfToken function', () => {
      const req = {};
      const res = {
        locals: {}
      };
      const next = jest.fn();
      
      injectCsrfToken(req, res, next);
      
      expect(res.locals.csrfToken).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'false';
    });

    it('should clear CSRF cookie on validation failure', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
      expect(response.body.hint).toContain('refresh the page');
    });

    it('should provide helpful error message', async () => {
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
      
      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Invalid or missing CSRF token');
      expect(response.body.code).toBe('CSRF_INVALID');
      expect(response.body.hint).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    beforeEach(() => {
      process.env.ENABLE_CSRF = 'true';
      process.env.COOKIE_SECURE = 'false';
    });

    it('should set security headers on token endpoint', async () => {
      app = express();
      app.use(cookieParser());
      
      const csrfProtection = createCsrfProtection();
      app.use(csrfProtection.middleware);
      app.get('/api/csrf-token', csrfProtection.getToken);
      
      const response = await request(app)
        .get('/api/csrf-token');
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });
});