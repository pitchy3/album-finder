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

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset config
    config.auth.enabled = false;
    config.oidc.issuerUrl = '';
    config.oidc.clientId = '';
    config.oidc.clientSecret = '';
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
});
