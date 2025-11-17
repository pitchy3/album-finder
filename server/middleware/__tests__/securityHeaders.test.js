// server/middleware/__tests__/securityHeaders.test.js
const {
  securityHeaders,
  reportOnlyCSP,
  cspNonceMiddleware,
  generateNonce,
  generateSRIHash,
  developmentSecurityHeaders
} = require('../securityHeaders');
const express = require('express');
const request = require('supertest');

// Mock config
jest.mock('../../config', () => ({
  server: {
    nodeEnv: 'production'
  }
}));

describe('Security Headers Middleware', () => {
  let app;

  beforeEach(() => {
    // Reset environment
    process.env.COOKIE_SECURE = 'true';
    process.env.NODE_ENV = 'production';
  });

  describe('securityHeaders - Production Mode', () => {
    beforeEach(() => {
      app = express();
      securityHeaders(app);
    });

    it('should set Content-Security-Policy header', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('should include upgrade-insecure-requests in CSP', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    });

    it('should set Strict-Transport-Security header', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['strict-transport-security']).toBe(
        'max-age=31536000; includeSubDomains; preload'
      );
    });

    it('should set X-Frame-Options to DENY', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should set X-Content-Type-Options', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-XSS-Protection', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should set Referrer-Policy', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should set Permissions-Policy', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['permissions-policy']).toBeDefined();
      expect(response.headers['permissions-policy']).toContain('geolocation=()');
    });

    it('should set Cross-Origin-Opener-Policy', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('should set Cross-Origin-Embedder-Policy', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['cross-origin-embedder-policy']).toBe('credentialless');
    });

    it('should set Cross-Origin-Resource-Policy', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
    });

    it('should remove X-Powered-By header', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should allow scripts from self with unsafe-inline', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    });

    it('should allow styles from self and Google Fonts', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    });

    it('should allow fonts from self and Google Fonts', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("font-src 'self' https://fonts.gstatic.com data:");
    });

    it('should allow images from self, data URIs, and Cover Art Archive', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("img-src 'self' data: https:");
    });

    it('should deny frames', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("frame-src 'none'");
    });

    it('should deny objects', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("object-src 'none'");
    });
  });

  describe('securityHeaders - HTTP Mode', () => {
    beforeEach(() => {
      process.env.COOKIE_SECURE = 'false';
      app = express();
      securityHeaders(app);
    });

    it('should not set HSTS when COOKIE_SECURE is false', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });

    it('should not include upgrade-insecure-requests in CSP', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    });

    it('should still set other security headers', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('API Cache Control', () => {
    beforeEach(() => {
      app = express();
      securityHeaders(app);
    });

    it('should set no-cache headers for API routes', async () => {
      app.get('/api/test', (req, res) => res.json({ data: 'test' }));

      const response = await request(app).get('/api/test');

      expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
      expect(response.headers['pragma']).toBe('no-cache');
      expect(response.headers['expires']).toBe('0');
    });

    it('should not affect non-API routes', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['cache-control']).not.toBe('no-store, no-cache, must-revalidate, private');
    });
  });

  describe('security.txt', () => {
    beforeEach(() => {
      app = express();
      securityHeaders(app);
    });

    it('should serve security.txt at /.well-known/security.txt', async () => {
      const response = await request(app).get('/.well-known/security.txt');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/plain');
    });

    it('should include contact information', async () => {
      const response = await request(app).get('/.well-known/security.txt');

      expect(response.text).toContain('Contact:');
    });

    it('should include expiry date', async () => {
      const response = await request(app).get('/.well-known/security.txt');

      expect(response.text).toContain('Expires:');
    });

    it('should include canonical URL', async () => {
      const response = await request(app).get('/.well-known/security.txt');

      expect(response.text).toContain('Canonical:');
    });

    it('should include preferred languages', async () => {
      const response = await request(app).get('/.well-known/security.txt');

      expect(response.text).toContain('Preferred-Languages: en');
    });
  });

  describe('robots.txt', () => {
    beforeEach(() => {
      app = express();
      securityHeaders(app);
    });

    it('should serve robots.txt', async () => {
      const response = await request(app).get('/robots.txt');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/plain');
    });

    it('should disallow sensitive paths', async () => {
      const response = await request(app).get('/robots.txt');

      expect(response.text).toContain('Disallow: /api/');
      expect(response.text).toContain('Disallow: /auth/');
      expect(response.text).toContain('Disallow: /webhook/');
    });

    it('should allow root path', async () => {
      const response = await request(app).get('/robots.txt');

      expect(response.text).toContain('Allow: /');
    });
  });

  describe('reportOnlyCSP', () => {
    beforeEach(() => {
      app = express();
      reportOnlyCSP(app);
    });

    it('should set Content-Security-Policy-Report-Only header', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy-report-only']).toBeDefined();
      expect(response.headers['content-security-policy-report-only']).toContain("default-src 'self'");
    });

    it('should not set enforcing CSP header', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('cspNonceMiddleware', () => {
    beforeEach(() => {
      app = express();
      app.use(cspNonceMiddleware);
      securityHeaders(app);
    });

    it('should generate nonce and add to res.locals', async () => {
      app.get('/test', (req, res) => {
        res.json({ nonce: res.locals.nonce });
      });

      const response = await request(app).get('/test');

      expect(response.body.nonce).toBeDefined();
      expect(response.body.nonce.length).toBeGreaterThan(0);
    });

    it('should modify CSP header to include nonce', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toMatch(/nonce-[A-Za-z0-9+/=]+/);
    });

    it('should remove unsafe-inline when using nonce', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      const csp = response.headers['content-security-policy'];
      // Should have nonce instead of unsafe-inline
      expect(csp).toMatch(/script-src 'self' 'nonce-/);
    });
  });

  describe('generateNonce', () => {
    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
    });

    it('should generate base64 encoded nonces', () => {
      const nonce = generateNonce();

      // Base64 regex
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should generate nonces of consistent length', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1.length).toBe(nonce2.length);
    });
  });

  describe('generateSRIHash', () => {
    it('should generate SHA-384 hash by default', () => {
      const content = 'console.log("test");';
      const hash = generateSRIHash(content);

      expect(hash).toMatch(/^sha384-/);
    });

    it('should generate consistent hashes for same content', () => {
      const content = 'console.log("test");';
      const hash1 = generateSRIHash(content);
      const hash2 = generateSRIHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const content1 = 'console.log("test1");';
      const content2 = 'console.log("test2");';
      
      const hash1 = generateSRIHash(content1);
      const hash2 = generateSRIHash(content2);

      expect(hash1).not.toBe(hash2);
    });

    it('should support different algorithms', () => {
      const content = 'console.log("test");';
      
      const sha256Hash = generateSRIHash(content, 'sha256');
      const sha512Hash = generateSRIHash(content, 'sha512');

      expect(sha256Hash).toMatch(/^sha256-/);
      expect(sha512Hash).toMatch(/^sha512-/);
    });

    it('should generate valid base64 hashes', () => {
      const content = 'console.log("test");';
      const hash = generateSRIHash(content);
      
      const base64Part = hash.split('-')[1];
      expect(base64Part).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe('developmentSecurityHeaders', () => {
    beforeEach(() => {
      app = express();
      developmentSecurityHeaders(app);
    });

    it('should set more permissive CSP for development', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain("'unsafe-inline'");
      expect(response.headers['content-security-policy']).toContain("'unsafe-eval'");
    });

    it('should allow WebSocket connections in CSP', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['content-security-policy']).toContain('ws:');
      expect(response.headers['content-security-policy']).toContain('wss:');
    });

    it('should use SAMEORIGIN for X-Frame-Options', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('should still set basic security headers', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should still remove X-Powered-By', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should not set HSTS in development', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('Permissions-Policy Details', () => {
    beforeEach(() => {
      app = express();
      securityHeaders(app);
    });

    it('should disable geolocation', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['permissions-policy']).toContain('geolocation=()');
    });

    it('should disable microphone', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['permissions-policy']).toContain('microphone=()');
    });

    it('should disable camera', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['permissions-policy']).toContain('camera=()');
    });

    it('should disable payment', async () => {
      app.get('/test', (req, res) => res.send('ok'));

      const response = await request(app).get('/test');

      expect(response.headers['permissions-policy']).toContain('payment=()');
    });
  });
});