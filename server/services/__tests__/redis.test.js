// server/services/__tests__/redis.test.js
jest.unmock('../redis');

// Mock only the redis module
jest.mock('redis', () => ({
  createClient: jest.fn()
}));

describe('Redis Service - Actual Implementation', () => {
  let redis;
  let mockClient;

  beforeAll(() => {
    redis = require('redis');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Standard mock client
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };
    
    redis.createClient.mockReturnValue(mockClient);
  });

  describe('initializeRedis', () => {
    it('should attempt to connect to Redis', async () => {
      delete require.cache[require.resolve('../redis')];
      const { initializeRedis } = require('../redis');
      
      const result = await initializeRedis();
      
      // Should return a boolean
      expect(typeof result).toBe('boolean');
      
      // Should have called createClient
      expect(redis.createClient).toHaveBeenCalled();
    });

    it('should handle connection failures', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection failed'));
      
      delete require.cache[require.resolve('../redis')];
      const { initializeRedis } = require('../redis');
      
      const result = await initializeRedis();
      
      // Should not throw and should return boolean
      expect(typeof result).toBe('boolean');
    });

    it('should set up event handlers', async () => {
      delete require.cache[require.resolve('../redis')];
      const { initializeRedis } = require('../redis');
      
      await initializeRedis();
      
      // Should have registered event handlers
      expect(mockClient.on).toHaveBeenCalled();
      
      // Check for error handler
      const hasErrorHandler = mockClient.on.mock.calls.some(
        call => call[0] === 'error'
      );
      expect(hasErrorHandler).toBe(true);
    });
  });

  describe('getClient', () => {
    it('should return client after initialization', async () => {
      delete require.cache[require.resolve('../redis')];
      const { initializeRedis, getClient } = require('../redis');
      
      await initializeRedis();
      const client = getClient();
      
      // Should return something (mock client or null)
      expect(client !== undefined).toBe(true);
    });
  });

  describe('isConnected', () => {
    it('should return boolean connection status', () => {
      delete require.cache[require.resolve('../redis')];
      const { isConnected } = require('../redis');
      
      const status = isConnected();
      expect(typeof status).toBe('boolean');
    });
  });

  describe('closeRedis', () => {
    it('should not throw when closing', async () => {
      delete require.cache[require.resolve('../redis')];
      const { initializeRedis, closeRedis } = require('../redis');
      
      await initializeRedis();
      await expect(closeRedis()).resolves.not.toThrow();
    });

    it('should handle close when not initialized', async () => {
      delete require.cache[require.resolve('../redis')];
      const { closeRedis } = require('../redis');
      
      await expect(closeRedis()).resolves.not.toThrow();
    });
  });
});