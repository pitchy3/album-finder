// __tests__/setup.js
// Global test setup and mocks

// Suppress console output during tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock Redis service with a mock client
jest.mock('../services/redis', () => {
  const mockRedisClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
  };

  return {
    initializeRedis: jest.fn().mockResolvedValue(true),
    getClient: jest.fn(() => mockRedisClient),
    isConnected: jest.fn(() => true),
    closeRedis: jest.fn().mockResolvedValue(undefined)
  };
});

// Mock authentication service
jest.mock('../services/auth', () => ({
  initializeAuth: jest.fn().mockResolvedValue({ issuer: null, client: null }),
  reinitializeAuth: jest.fn().mockResolvedValue(true),
  getClient: jest.fn(() => null),
  getIssuer: jest.fn(() => null),
  isAuthReady: jest.fn(() => false)
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.REDIS_URL = 'redis://localhost:6379';

// Global test timeout
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});