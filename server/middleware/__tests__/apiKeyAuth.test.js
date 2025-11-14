// server/middleware/__tests__/apiKeyAuth.test.js
const { 
  validateApiKey, 
  isApiKeyValid, 
  apiKeyAuthMiddleware,
  logApiKeyStatus,
  ensureAuthenticatedWithApiKey
} = require('../apiKeyAuth');

// Mock console methods to avoid cluttering test output
const mockConsole = () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  
  beforeEach(() => {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });
  
  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });
};

describe('API Key Authentication', () => {
  const originalEnv = process.env.API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  
  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.API_KEY = originalEnv;
    } else {
      delete process.env.API_KEY;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });
  
  describe('validateApiKey', () => {
    mockConsole();
    
    it('should return not configured when API_KEY not set', () => {
      delete process.env.API_KEY;
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.issues).toContain('API_KEY not configured');
    });
    
    it('should validate strong API key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
    
    it('should reject short API key', () => {
      process.env.API_KEY = 'short';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.configured).toBe(true);
      expect(result.issues.some(i => i.includes('too short'))).toBe(true);
    });
    
    it('should reject API key with exactly 31 characters', () => {
      process.env.API_KEY = 'a'.repeat(31);
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('too short'))).toBe(true);
    });
    
    it('should accept API key with exactly 32 characters and good entropy', () => {
      process.env.API_KEY = 'uK8m!3Tz@9Wp#5Bv$7Jx&2Fy^1Qn4Rd6';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(true);
      expect(result.configured).toBe(true);
    });
    
    it('should reject API key with low entropy', () => {
      process.env.API_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('entropy'))).toBe(true);
    });
    
    it('should reject API key with weak pattern - password', () => {
      process.env.API_KEY = 'mypassword123456789012345678901234';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('password'))).toBe(true);
    });
    
    it('should reject API key with weak pattern - secret', () => {
      process.env.API_KEY = 'mysecret1234567890123456789012345';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('secret'))).toBe(true);
    });
    
    it('should reject API key with weak pattern - key', () => {
      process.env.API_KEY = 'mykey1234567890123456789012345678';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('key'))).toBe(true);
    });
    
    it('should reject API key with weak pattern - 123456', () => {
      process.env.API_KEY = '123456789012345678901234567890123';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('123456'))).toBe(true);
    });
    
    it('should reject API key with weak pattern - qwerty', () => {
      process.env.API_KEY = 'qwerty123456789012345678901234567';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('qwerty'))).toBe(true);
    });
    
    it('should reject API key with repeated characters', () => {
      process.env.API_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('repeated'))).toBe(true);
    });
    
    it('should reject API key with sequential pattern - 012', () => {
      process.env.API_KEY = '0123456789abcdefghijklmnopqrstuvwxyz';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('sequential'))).toBe(true);
    });
    
    it('should reject API key with sequential pattern - 123', () => {
      process.env.API_KEY = '123456789abcdefghijklmnopqrstuvwxyz';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('sequential'))).toBe(true);
    });
    
    it('should reject API key with sequential pattern - abc', () => {
      process.env.API_KEY = 'abcdefghijklmnopqrstuvwxyz123456789';
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('sequential'))).toBe(true);
    });
    
    it('should handle multiple validation issues', () => {
      process.env.API_KEY = 'password'; // Short + weak pattern
      
      const result = validateApiKey();
      
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(1);
    });
  });
  
  describe('isApiKeyValid', () => {
    mockConsole();
    
    it('should return false when not configured', () => {
      delete process.env.API_KEY;
      expect(isApiKeyValid()).toBe(false);
    });
    
    it('should return false when weak', () => {
      process.env.API_KEY = 'weak';
      expect(isApiKeyValid()).toBe(false);
    });
    
    it('should return true when strong', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      expect(isApiKeyValid()).toBe(true);
    });
    
    it('should return false for undefined API_KEY', () => {
      process.env.API_KEY = undefined;
      expect(isApiKeyValid()).toBe(false);
    });
    
    it('should return false for null API_KEY', () => {
      process.env.API_KEY = null;
      expect(isApiKeyValid()).toBe(false);
    });
    
    it('should return false for empty string API_KEY', () => {
      process.env.API_KEY = '';
      expect(isApiKeyValid()).toBe(false);
    });
  });
  
  describe('apiKeyAuthMiddleware', () => {
    mockConsole();
    
    let req, res, next;
    
    beforeEach(() => {
      req = {
        headers: {},
        ip: '127.0.0.1'
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      next = jest.fn();
    });
    
    it('should call next when no API key provided', () => {
      delete process.env.API_KEY;
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.apiKeyAuthenticated).toBeUndefined();
    });
    
    it('should call next when X-API-Key header is empty string', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      req.headers['x-api-key'] = '';
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
    
    it('should call next when X-API-Key header is undefined', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      req.headers['x-api-key'] = undefined;
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
    
    it('should reject when API key provided but not configured', () => {
      delete process.env.API_KEY;
      req.headers['x-api-key'] = 'some-key';
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'API key authentication not available',
          code: 'API_KEY_NOT_CONFIGURED'
        })
      );
      expect(next).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });
    
    it('should reject when API key provided but weak', () => {
      process.env.API_KEY = 'weak';
      req.headers['x-api-key'] = 'weak';
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'API key authentication unavailable due to security requirements',
          code: 'WEAK_API_KEY'
        })
      );
      expect(next).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('weak API key detected')
      );
    });
    
    it('should reject invalid API key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      req.headers['x-api-key'] = 'wrong-key-here';
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid API key',
          code: 'INVALID_API_KEY'
        })
      );
      expect(next).not.toHaveBeenCalled();
      // Console.warn is called with two arguments: message and IP
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid API key attempt'),
        expect.any(String)
      );
    });
    
    it('should authenticate with valid API key', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyAuthenticated).toBe(true);
      expect(req.session).toBeDefined();
      expect(req.session.user).toBeDefined();
      expect(req.session.user.claims.sub).toBe('api-key-user');
      expect(req.session.user.claims.preferred_username).toBe('api-key-user');
      expect(req.session.user.claims.name).toBe('API Key User');
      expect(req.session.user.claims.authType).toBe('apikey');
      // Console.log is called with two arguments: message and IP
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API key authentication successful'),
        expect.any(String)
      );
    });
    
    it('should preserve existing session object if present', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;
      req.session = { existingData: 'preserved' };
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.session.existingData).toBe('preserved');
      expect(req.session.user).toBeDefined();
    });
    
    it('should use constant-time comparison', async () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      
      // Test with key that differs only at the end
      const wrongKey1 = validKey.substring(0, validKey.length - 1) + 'X';
      req.headers['x-api-key'] = wrongKey1;
      
      const start1 = Date.now();
      apiKeyAuthMiddleware(req, res, next);
      const timeDiff1 = Date.now() - start1;
      
      // Reset mocks
      res.status.mockClear();
      res.json.mockClear();
      next.mockClear();
      
      // Test with completely different key
      req.headers['x-api-key'] = 'completely-different-key-value';
      const start2 = Date.now();
      apiKeyAuthMiddleware(req, res, next);
      const timeDiff2 = Date.now() - start2;
      
      // Timing should be similar (within 10ms) due to constant-time comparison
      expect(Math.abs(timeDiff1 - timeDiff2)).toBeLessThan(10);
    });
    
    it('should handle unicode API keys', () => {
      const unicodeKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4émojis🔐特殊字符';
      process.env.API_KEY = unicodeKey;
      req.headers['x-api-key'] = unicodeKey;
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyAuthenticated).toBe(true);
    });
    
    it('should handle API key with spaces', () => {
      const keyWithSpaces = 'aB3$ fG7* jK9! mN2# pQ5& sT8^ vW1@ xY4%';
      process.env.API_KEY = keyWithSpaces;
      req.headers['x-api-key'] = keyWithSpaces;
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyAuthenticated).toBe(true);
    });
    
    it('should handle crypto.timingSafeEqual error gracefully', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;
      
      // Mock crypto to throw error
      const crypto = require('crypto');
      const originalTimingSafeEqual = crypto.timingSafeEqual;
      crypto.timingSafeEqual = jest.fn(() => {
        throw new Error('Comparison failed');
      });
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication error',
          code: 'API_KEY_COMPARISON_FAILED'
        })
      );
      // Console.error is called with two arguments: message and error object
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('API key comparison error'),
        expect.any(Error)
      );
      
      // Restore
      crypto.timingSafeEqual = originalTimingSafeEqual;
    });
  });
  
  describe('logApiKeyStatus', () => {
    let originalLog, originalError;
    
    beforeEach(() => {
      originalLog = console.log;
      originalError = console.error;
      console.log = jest.fn();
      console.error = jest.fn();
    });
    
    afterEach(() => {
      console.log = originalLog;
      console.error = originalError;
    });
    
    it('should log info message when not configured', () => {
      delete process.env.API_KEY;
      
      logApiKeyStatus();
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API key authentication not configured')
      );
    });
    
    it('should log success when valid', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      
      logApiKeyStatus();
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API key authentication enabled and validated')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API key meets security requirements')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('X-API-Key header')
      );
    });
    
    it('should log critical error when weak in production', () => {
      process.env.API_KEY = 'weak';
      process.env.NODE_ENV = 'production';
      
      logApiKeyStatus();
      
      expect(console.error).toHaveBeenCalledWith('');
      expect(console.error).toHaveBeenCalledWith('='.repeat(80));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL: API key validation failed')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Running in production with weak API key')
      );
    });
    
    it('should log all validation issues when weak', () => {
      process.env.API_KEY = 'password'; // Multiple issues
      
      logApiKeyStatus();
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('API key validation failed')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Generate a secure API key')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('API_KEY=')
      );
    });
    
    it('should log warning when weak in development', () => {
      process.env.API_KEY = 'weak';
      process.env.NODE_ENV = 'development';
      
      logApiKeyStatus();
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('API key validation failed')
      );
      // Should not have production-specific warning
      const prodWarningCalls = console.error.mock.calls.filter(
        call => call[0] && call[0].includes('Running in production')
      );
      expect(prodWarningCalls).toHaveLength(0);
    });
  });
  
  describe('ensureAuthenticatedWithApiKey', () => {
    mockConsole();
    
    let req, res, next;
    let mockConfig;
    
    beforeEach(() => {
      req = {
        headers: {},
        path: '/api/test',
        xhr: false,
        ip: '127.0.0.1',
        originalUrl: '/api/test?param=value',
        session: {}
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn()
      };
      next = jest.fn();
      
      // Mock config
      mockConfig = require('../../config');
      mockConfig.auth = { enabled: true };
    });
    
    it('should call next if API key authenticated', () => {
      req.apiKeyAuthenticated = true;
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });
    
    it('should call next if auth disabled and no API key', () => {
      delete process.env.API_KEY;
      mockConfig.auth.enabled = false;
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('authentication disabled')
      );
    });
    
    it('should call next if session user exists', () => {
      req.session.user = {
        claims: { sub: 'user123' }
      };
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(next).toHaveBeenCalled();
    });
    
    it('should return 500 if session not initialized', () => {
      req.session = null;
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Session not initialized'
        })
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Session middleware not initialized')
      );
    });
    
    it('should return 401 for unauthenticated API request', () => {
      req.path = '/api/test';
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
          loginUrl: '/auth/login'
        })
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API request not authenticated')
      );
    });
    
    it('should return 401 for XHR request', () => {
      req.path = '/some/page';
      req.xhr = true;
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
    });
    
    it('should return 401 for JSON content-type request', () => {
      req.path = '/some/endpoint';
      req.headers['content-type'] = 'application/json';
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(401);
    });
    
    it('should redirect to login for unauthenticated page request', () => {
      req.path = '/settings';
      
      ensureAuthenticatedWithApiKey(req, res, next);
      
      expect(res.redirect).toHaveBeenCalledWith('/auth/login');
      expect(req.session.returnTo).toBe('/api/test?param=value');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Page request not authenticated')
      );
    });
  });
  
  describe('Security Properties', () => {
    mockConsole();
    
    it('should not leak API key in errors', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      
      const req = {
        headers: { 'x-api-key': 'wrong' },
        ip: '127.0.0.1'
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();
      
      apiKeyAuthMiddleware(req, res, next);
      
      const errorResponse = res.json.mock.calls[0][0];
      expect(JSON.stringify(errorResponse)).not.toContain(process.env.API_KEY);
    });
    
    it('should not leak API key in validation messages', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      
      const validation = validateApiKey();
      
      expect(JSON.stringify(validation)).not.toContain(process.env.API_KEY);
    });
    
    it('should validate on every request', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      
      const req1 = {
        headers: { 'x-api-key': validKey },
        ip: '127.0.0.1'
      };
      const req2 = {
        headers: { 'x-api-key': 'wrong' },
        ip: '127.0.0.1'
      };
      
      const res1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const res2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next1 = jest.fn();
      const next2 = jest.fn();
      
      // First request with valid key
      apiKeyAuthMiddleware(req1, res1, next1);
      expect(next1).toHaveBeenCalled();
      
      // Second request with invalid key should still be rejected
      apiKeyAuthMiddleware(req2, res2, next2);
      expect(res2.status).toHaveBeenCalledWith(401);
      expect(next2).not.toHaveBeenCalled();
    });
    
    it('should handle very long API keys', () => {
      // Create a long but still valid key (meets entropy requirements)
      const longKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+kL7mN9pQ2rS4tU6vW8xY0zA1bC3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1fG3hI5jK7lM9nO1pQ3rS5tU7vW9xY1zA3bC5dE7fG9hI1jK3lM5nO7pQ9rS1tU3vW5xY7zA9bC1dE3fG5hI7jK9lM1nO3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hI3jK5lM7nO9pQ1rS3tU5vW7xY9zA1bC3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1fG3hI5jK7lM9nO1pQ3rS5tU7vW9xY1zA3bC5dE7fG9hI1jK3lM5nO7pQ9rS1tU3vW5xY7zA9bC1dE3fG5hI7jK9lM1nO3pQ5rS7tU9vW1xY3zA5bC7dE9';
      process.env.API_KEY = longKey;
      
      const req = {
        headers: { 'x-api-key': longKey },
        ip: '127.0.0.1'
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();
      
      apiKeyAuthMiddleware(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(req.apiKeyAuthenticated).toBe(true);
    });
    
    it('should handle API key with null bytes', () => {
      const keyWithNull = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4\x00attack';
      process.env.API_KEY = keyWithNull;
      
      const validation = validateApiKey();
      
      // Should still validate (validateMasterKey handles this)
      expect(validation.configured).toBe(true);
    });
  });
});
