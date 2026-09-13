// server/middleware/__tests__/apiKeyAuth.test.js
const {
  validateApiKey,
  isApiKeyValid,
  apiKeyAuthMiddleware,
  logApiKeyStatus,
  constantTimeApiKeyEqual
} = require('../apiKeyAuth');

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
    if (originalEnv) process.env.API_KEY = originalEnv;
    else delete process.env.API_KEY;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('validateApiKey', () => {
    mockConsole();

    it('returns not configured when API_KEY is absent', () => {
      delete process.env.API_KEY;
      const result = validateApiKey();
      expect(result.valid).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.issues).toContain('API_KEY not configured');
    });

    it('accepts a strong API key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      const result = validateApiKey();
      expect(result.valid).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects short and weak API keys', () => {
      process.env.API_KEY = 'password';
      const result = validateApiKey();
      expect(result.valid).toBe(false);
      expect(result.configured).toBe(true);
      expect(result.issues.some(issue => issue.includes('too short'))).toBe(true);
      expect(result.issues.some(issue => issue.includes('password'))).toBe(true);
    });

    it('rejects low-entropy API keys', () => {
      process.env.API_KEY = 'a'.repeat(40);
      const result = validateApiKey();
      expect(result.valid).toBe(false);
      expect(result.issues.some(issue => issue.includes('entropy'))).toBe(true);
    });
  });

  describe('isApiKeyValid', () => {
    mockConsole();

    it('returns false when not configured or weak', () => {
      delete process.env.API_KEY;
      expect(isApiKeyValid()).toBe(false);
      process.env.API_KEY = 'weak';
      expect(isApiKeyValid()).toBe(false);
    });

    it('returns true for a strong key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      expect(isApiKeyValid()).toBe(true);
    });
  });

  describe('constantTimeApiKeyEqual', () => {
    it('matches identical keys and rejects different keys', () => {
      expect(constantTimeApiKeyEqual('same-key', 'same-key')).toBe(true);
      expect(constantTimeApiKeyEqual('same-key', 'different-key')).toBe(false);
    });

    it('does not truncate keys longer than 256 bytes', () => {
      const commonPrefix = 'A'.repeat(256);
      const configured = `${commonPrefix}-configured-tail`;
      const provided = `${commonPrefix}-attacker-tail`;
      expect(constantTimeApiKeyEqual(provided, configured)).toBe(false);
    });

    it('supports unicode and arbitrarily long keys', () => {
      const key = `prefix-🔐-${'abcdef0123456789'.repeat(40)}`;
      expect(constantTimeApiKeyEqual(key, key)).toBe(true);
    });
  });

  describe('apiKeyAuthMiddleware', () => {
    mockConsole();
    let req;
    let res;
    let next;

    beforeEach(() => {
      req = { headers: {}, ip: '127.0.0.1' };
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
    });

    it('continues when no API key is supplied', () => {
      apiKeyAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.apiKeyAuthenticated).toBeUndefined();
    });

    it('rejects a supplied key when API key auth is not configured', () => {
      delete process.env.API_KEY;
      req.headers['x-api-key'] = 'provided-key';
      apiKeyAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'API_KEY_NOT_CONFIGURED' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a weak configured API key', () => {
      process.env.API_KEY = 'weak';
      req.headers['x-api-key'] = 'weak';
      apiKeyAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WEAK_API_KEY' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an incorrect API key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      req.headers['x-api-key'] = 'wrong-key';
      apiKeyAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_API_KEY' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('authenticates a valid key without creating a session', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;

      apiKeyAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.apiKeyAuthenticated).toBe(true);
      expect(req.authUser).toEqual({
        claims: {
          sub: 'api-key-user',
          preferred_username: 'api-key-user',
          name: 'API Key User',
          authType: 'apikey'
        }
      });
      expect(req.session).toBeUndefined();
    });

    it('does not mutate an existing browser session', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;
      req.session = { existingData: 'preserved' };

      apiKeyAuthMiddleware(req, res, next);

      expect(req.session).toEqual({ existingData: 'preserved' });
      expect(req.authUser.claims.authType).toBe('apikey');
    });

    it('accepts a valid key longer than 256 bytes', () => {
      const longKey = `Z9!${'aB3$cD4%eF5&gH6*'.repeat(25)}`;
      process.env.API_KEY = longKey;
      req.headers['x-api-key'] = longKey;
      apiKeyAuthMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.apiKeyAuthenticated).toBe(true);
    });

    it('rejects a different key sharing the first 256 bytes', () => {
      const prefix = 'Xy9!'.repeat(64);
      process.env.API_KEY = `${prefix}configured-tail`;
      req.headers['x-api-key'] = `${prefix}attacker-tail`;
      apiKeyAuthMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('handles timingSafeEqual failures without leaking the key', () => {
      const validKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      process.env.API_KEY = validKey;
      req.headers['x-api-key'] = validKey;
      const original = cryptoTimingSafeEqual();
      const crypto = require('crypto');
      crypto.timingSafeEqual = jest.fn(() => { throw new Error('Comparison failed'); });

      apiKeyAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'API_KEY_COMPARISON_FAILED' }));
      expect(JSON.stringify(res.json.mock.calls)).not.toContain(validKey);
      crypto.timingSafeEqual = original;
    });
  });

  describe('logApiKeyStatus', () => {
    mockConsole();

    it('logs when API key auth is not configured', () => {
      delete process.env.API_KEY;
      logApiKeyStatus();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not configured'));
    });

    it('logs success for a valid API key', () => {
      process.env.API_KEY = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(dE8)hI0+';
      logApiKeyStatus();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('enabled and validated'));
    });

    it('logs validation failure for a weak API key', () => {
      process.env.API_KEY = 'weak';
      logApiKeyStatus();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('CRITICAL: API key validation failed'));
    });
  });
});

function cryptoTimingSafeEqual() {
  return require('crypto').timingSafeEqual;
}
