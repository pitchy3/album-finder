// server/__tests__/integration/setup.js
const path = require('path');
const fs = require('fs').promises;

// Test database path
const TEST_DB_PATH = path.join(__dirname, '../test-data/test.db');
const TEST_CONFIG_PATH = path.join(__dirname, '../test-data/config.json');

// Setup test environment
beforeAll(async () => {
  // Ensure test data directory exists
  const testDataDir = path.dirname(TEST_DB_PATH);
  try {
    await fs.mkdir(testDataDir, { recursive: true });
  } catch (err) {
    // Directory already exists
  }
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.SESSION_SECRET = 'test-secret-key';
  process.env.TZ = 'UTC';
});

// Cleanup after all tests
afterAll(async () => {
  // Clean up test database
  try {
    await fs.unlink(TEST_DB_PATH);
    await fs.unlink(TEST_CONFIG_PATH);
  } catch (err) {
    // Files might not exist
  }
});

// Helper to create mock request object
function createMockRequest(overrides = {}) {
  return {
    query: {},
    params: {},
    body: {},
    headers: {},
    session: {},
    ip: '127.0.0.1',
    get: (header) => overrides.headers?.[header] || null,
    ...overrides
  };
}

// Helper to create mock response object
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status: jest.fn().mockReturnThis(),
    json: jest.fn((data) => {
      res.body = data;
      return res;
    }),
    send: jest.fn((data) => {
      res.body = data;
      return res;
    }),
    setHeader: jest.fn((key, value) => {
      res.headers[key] = value;
      return res;
    }),
    redirect: jest.fn(),
    locals: {}
  };
  return res;
}

module.exports = {
  TEST_DB_PATH,
  TEST_CONFIG_PATH,
  createMockRequest,
  createMockResponse
};