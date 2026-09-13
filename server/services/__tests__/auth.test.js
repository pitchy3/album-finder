// server/services/__tests__/auth.test.js
jest.unmock('../auth');

const config = require('../../config');

// Mock only openid-client
jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn()
  },
  custom: {
    setHttpOptionsDefaults: jest.fn()
  }
}));

describe('Auth Service - Actual Implementation', () => {
  let Issuer;

  beforeAll(() => {
    // Get the mocked Issuer once
    Issuer = require('openid-client').Issuer;
  });

  beforeEach(async () => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset config
    config.auth.enabled = false;
    config.auth.type = null;
    config.oidc.issuerUrl = '';
    config.oidc.clientId = '';
    config.oidc.clientSecret = '';
    // Clear the process-local client published by any preceding test.
    await require('../auth').reinitializeAuth();
  });

  describe('initializeAuth', () => {
    it('should return null clients when auth not enabled', async () => {
      // Clear require cache to get fresh auth module
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth } = require('../auth');
      
      config.auth.enabled = false;
      
      const result = await initializeAuth();
      
      expect(result.issuer).toBeNull();
      expect(result.client).toBeNull();
    });

    it('should handle OIDC discovery errors gracefully', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth } = require('../auth');
      
      config.auth.enabled = true;
      config.oidc.issuerUrl = 'https://auth.example.com';
      config.oidc.clientId = 'test-client';
      config.oidc.clientSecret = 'test-secret';
      
      Issuer.discover.mockRejectedValue(new Error('Discovery failed'));
      
      const result = await initializeAuth();
      
      // Should handle error gracefully
      expect(result.issuer).toBeNull();
      expect(result.client).toBeNull();
    });

    it('logs structured discovery diagnostics without secrets', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth } = require('../auth');
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      config.auth.enabled = true;
      config.auth.type = 'oidc';
      config.oidc.issuerUrl = 'https://auth.example.com';
      config.oidc.clientId = 'test-client';
      config.oidc.clientSecret = 'super-secret-client-value';
      const cause = new Error('upstream exposed super-secret-client-value');
      cause.code = 'ECONNRESET';
      const error = new Error('Discovery failed with client_secret=super-secret-client-value', { cause });
      error.code = 'OIDC_DISCOVERY_FAILED';
      Issuer.discover.mockRejectedValue(error);

      await initializeAuth();

      const diagnostic = consoleError.mock.calls.find(call => call[0].includes('Failed to initialize'))[1];
      expect(diagnostic).toEqual(expect.objectContaining({
        timestamp: expect.any(String),
        elapsedMs: expect.any(Number),
        issuerUrl: 'https://auth.example.com/',
        errorName: 'Error',
        errorCode: 'OIDC_DISCOVERY_FAILED',
        stack: expect.any(String),
        errorCause: expect.objectContaining({ code: 'ECONNRESET' })
      }));
      expect(JSON.stringify(diagnostic)).not.toContain('super-secret-client-value');
      consoleError.mockRestore();
    });
  });

  describe('getClient and getIssuer', () => {
    it('should return null when not initialized', () => {
      delete require.cache[require.resolve('../auth')];
      const { getClient, getIssuer } = require('../auth');
      
      expect(getClient()).toBeNull();
      expect(getIssuer()).toBeNull();
    });
  });

  describe('isAuthReady', () => {
    it('should return false when auth not enabled', () => {
      delete require.cache[require.resolve('../auth')];
      const { isAuthReady } = require('../auth');
      
      config.auth.enabled = false;
      expect(isAuthReady()).toBe(false);
    });

    it('should return false when client not initialized', () => {
      delete require.cache[require.resolve('../auth')];
      const { isAuthReady } = require('../auth');
      
      config.auth.enabled = true;
      expect(isAuthReady()).toBe(false);
    });
  });

  describe('reinitializeAuth', () => {
    const oidcConfig = () => {
      config.auth.enabled = true;
      config.auth.type = 'oidc';
      config.oidc.issuerUrl = 'https://auth.example.com';
      config.oidc.clientId = 'test-client';
      config.oidc.clientSecret = 'test-secret';
    };

    const mockIssuer = (client) => ({
      Client: jest.fn(() => client)
    });

    it('should return true when auth disabled', async () => {
      delete require.cache[require.resolve('../auth')];
      const { reinitializeAuth } = require('../auth');
      
      config.auth.enabled = false;
      
      const result = await reinitializeAuth();
      expect(result).toBe(true);
    });

    it('should replace the old issuer and client after successful reinitialization', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth, reinitializeAuth, getClient, getIssuer } = require('../auth');
      oidcConfig();
      const oldClient = { name: 'old' };
      const newClient = { name: 'new' };
      const oldIssuer = mockIssuer(oldClient);
      const newIssuer = mockIssuer(newClient);
      Issuer.discover.mockResolvedValueOnce(oldIssuer).mockResolvedValueOnce(newIssuer);

      await initializeAuth();
      const result = await reinitializeAuth();

      expect(result).toBe(true);
      expect(getIssuer()).toBe(newIssuer);
      expect(getClient()).toBe(newClient);
    });

    it('should preserve the old issuer and client when replacement discovery fails', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth, reinitializeAuth, getClient, getIssuer } = require('../auth');
      oidcConfig();
      const oldClient = { name: 'old' };
      const oldIssuer = mockIssuer(oldClient);
      Issuer.discover.mockResolvedValueOnce(oldIssuer)
        .mockRejectedValueOnce(new Error('Discovery failed'));

      await initializeAuth();
      const result = await reinitializeAuth();

      expect(result).toBe(false);
      expect(getIssuer()).toBe(oldIssuer);
      expect(getClient()).toBe(oldClient);
    });

    it('should preserve a valid client when replacement client construction fails', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuth, reinitializeAuth, getClient, getIssuer } = require('../auth');
      oidcConfig();
      const oldClient = { name: 'old' };
      const oldIssuer = mockIssuer(oldClient);
      const brokenIssuer = {
        Client: jest.fn(() => {
          throw new Error('Client construction failed');
        })
      };
      Issuer.discover.mockResolvedValueOnce(oldIssuer).mockResolvedValueOnce(brokenIssuer);

      await initializeAuth();
      const result = await reinitializeAuth();

      expect(result).toBe(false);
      expect(getIssuer()).toBe(oldIssuer);
      expect(getClient()).toBe(oldClient);
    });
  });

  describe('OIDC recovery', () => {
    const oidcConfig = () => {
      config.auth.enabled = true;
      config.auth.type = 'oidc';
      config.oidc.issuerUrl = 'https://auth.example.com';
      config.oidc.clientId = 'test-client';
      config.oidc.clientSecret = 'test-secret';
    };

    const mockIssuer = (client) => ({ Client: jest.fn(() => client) });

    it('retries transient startup discovery failures and succeeds', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuthWithRetry, getClient } = require('../auth');
      oidcConfig();
      const recoveredClient = { name: 'recovered' };
      Issuer.discover
        .mockRejectedValueOnce(new Error('temporary outage'))
        .mockResolvedValueOnce(mockIssuer(recoveredClient));
      const wait = jest.fn().mockResolvedValue(undefined);

      const result = await initializeAuthWithRetry({ retryDelays: [1000, 3000, 10000], wait });

      expect(wait).toHaveBeenCalledTimes(1);
      expect(wait).toHaveBeenCalledWith(1000);
      expect(Issuer.discover).toHaveBeenCalledTimes(2);
      expect(result.client).toBe(recoveredClient);
      expect(getClient()).toBe(recoveredClient);
    });

    it('continues after bounded startup retries are exhausted', async () => {
      delete require.cache[require.resolve('../auth')];
      const { initializeAuthWithRetry, getClient } = require('../auth');
      oidcConfig();
      Issuer.discover.mockRejectedValue(new Error('outage'));
      const wait = jest.fn().mockResolvedValue(undefined);

      const result = await initializeAuthWithRetry({ retryDelays: [1000, 3000, 10000], wait });

      expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1000, 3000, 10000]);
      expect(Issuer.discover).toHaveBeenCalledTimes(4);
      expect(result.client).toBeNull();
      expect(getClient()).toBeNull();
    });

    it('shares one lazy discovery attempt among concurrent callers', async () => {
      delete require.cache[require.resolve('../auth')];
      const { recoverOIDCClient, getClient } = require('../auth');
      oidcConfig();
      const recoveredClient = { name: 'lazy' };
      let finishDiscovery;
      Issuer.discover.mockReturnValue(new Promise(resolve => { finishDiscovery = resolve; }));

      const first = recoverOIDCClient();
      const second = recoverOIDCClient();
      expect(Issuer.discover).toHaveBeenCalledTimes(1);
      finishDiscovery(mockIssuer(recoveredClient));

      await expect(Promise.all([first, second])).resolves.toEqual([recoveredClient, recoveredClient]);
      expect(getClient()).toBe(recoveredClient);
    });

    it('leaves auth state empty when lazy recovery fails', async () => {
      delete require.cache[require.resolve('../auth')];
      const { recoverOIDCClient, getClient, getIssuer } = require('../auth');
      oidcConfig();
      Issuer.discover.mockRejectedValueOnce(new Error('outage'));

      await expect(recoverOIDCClient()).resolves.toBeNull();
      expect(getClient()).toBeNull();
      expect(getIssuer()).toBeNull();
    });

    it('throttles lazy discovery attempts after a failure', async () => {
      delete require.cache[require.resolve('../auth')];
      const { recoverOIDCClient } = require('../auth');
      oidcConfig();
      const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
      Issuer.discover.mockRejectedValue(new Error('outage'));

      await expect(recoverOIDCClient()).resolves.toBeNull();
      await expect(recoverOIDCClient()).resolves.toBeNull();
      expect(Issuer.discover).toHaveBeenCalledTimes(1);

      now.mockReturnValue(11000);
      await expect(recoverOIDCClient()).resolves.toBeNull();
      expect(Issuer.discover).toHaveBeenCalledTimes(2);
      now.mockRestore();
    });

    it('does not let stale recovery overwrite a newer configuration', async () => {
      delete require.cache[require.resolve('../auth')];
      const { recoverOIDCClient, reinitializeAuth, getClient, getIssuer } = require('../auth');
      oidcConfig();
      let finishOldDiscovery;
      const oldDiscovery = new Promise(resolve => { finishOldDiscovery = resolve; });
      const oldClient = { name: 'old recovery' };
      const newClient = { name: 'new configuration' };
      const oldIssuer = mockIssuer(oldClient);
      const newIssuer = mockIssuer(newClient);
      Issuer.discover.mockReturnValueOnce(oldDiscovery).mockResolvedValueOnce(newIssuer);

      const recovery = recoverOIDCClient();
      config.oidc.issuerUrl = 'https://new-auth.example.com';
      config.oidc.clientId = 'new-client';
      config.oidc.clientSecret = 'new-secret';
      await expect(reinitializeAuth()).resolves.toBe(true);
      finishOldDiscovery(oldIssuer);

      await expect(recovery).resolves.toBe(newClient);
      expect(oldIssuer.Client).toHaveBeenCalledWith(expect.objectContaining({
        client_id: 'test-client',
        client_secret: 'test-secret'
      }));
      expect(getIssuer()).toBe(newIssuer);
      expect(getClient()).toBe(newClient);
    });
  });
});
