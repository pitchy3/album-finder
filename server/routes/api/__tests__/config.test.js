const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock fetch BEFORE importing anything that uses it
global.fetch = jest.fn();

// ✅ mock fs safely inside the factory (prevents TDZ / hoisting issues)
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  const mockReadFile = jest.fn();
  const mockWriteFile = jest.fn();
  const mockAccess = jest.fn();
  const mockMkdir = jest.fn();
  const mockUnlink = jest.fn();

  return {
    ...actualFs,
    promises: {
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      access: mockAccess,
      mkdir: mockMkdir,
      unlink: mockUnlink,
    },
    // expose mocks for test access
    __mocks__: { mockReadFile, mockWriteFile, mockAccess, mockMkdir, mockUnlink },
  };
});

// Extract the mock references for later resets
const { mockReadFile, mockWriteFile, mockAccess, mockMkdir } =
  require('fs').__mocks__;

// --- mock config encryption service and backup ---
jest.mock('../../../services/configEncryption', () => {
  const actual = jest.requireActual('../../../services/configEncryption');
  return {
    ...actual,
    encryptConfig: jest.fn((data) => data), // no encryption
    decryptConfig: jest.fn((data) => data),
    isConfigEncrypted: jest.fn(() => false),
    ensureDataDirectory: jest.fn().mockResolvedValue(undefined),
    backupConfig: jest.fn().mockResolvedValue(undefined),
  };
});

// Silence config logging during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock the auth middleware
jest.mock('../../../middleware/auth', () => ({
  ensureAuthenticated: (req, res, next) => {
    req.session = { 
      user: { 
        claims: { 
          sub: 'test-user',
          preferred_username: 'testuser'
        } 
      },
      sessionID: 'test-session-id'
    };
    req.ip = '127.0.0.1';
    next();
  }
}));

// Mock database
jest.mock('../../../services/database', () => ({
  database: {
    logAuthEvent: jest.fn().mockResolvedValue(undefined)
  }
}));

const configRoutes = require('../config');

describe('Config API Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/config', configRoutes);
    
    // Reset all mocks
    global.fetch.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockAccess.mockReset();
    mockMkdir.mockReset();
    
    // ✅ Setup default mock behavior for file operations
    // Mock that config file doesn't exist initially (ENOENT)
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  describe('GET /api/config/lidarr', () => {
    it('should return Lidarr configuration with masked API key', async () => {
      // Mock existing config
      mockReadFile.mockResolvedValue(JSON.stringify({
        lidarr: {
          url: 'http://lidarr:8686',
          apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
          rootFolder: '/music',
          qualityProfileId: 1
        }
      }));

      const response = await request(app)
        .get('/api/config/lidarr');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('apiKey');
      expect(response.body).toHaveProperty('rootFolder');
      // API key should be obfuscated
      expect(response.body.apiKey).toMatch(/^\*\*\*/);
    });
  });

  describe('POST /api/config/lidarr', () => {
    it('should update Lidarr configuration', async () => {
      const config = {
        url: 'http://lidarr:8686',
        apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
        rootFolder: '/music',
        qualityProfileId: 1
      };

      const response = await request(app)
        .post('/api/config/lidarr')
        .send(config);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify file was written
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/config/lidarr')
        .send({ url: 'http://lidarr:8686' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
    
    it('should reject invalid URL format', async () => {
      const config = {
        url: 'not-a-valid-url',
        apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
        rootFolder: '/music',
        qualityProfileId: 1
      };

      const response = await request(app)
        .post('/api/config/lidarr')
        .send(config);

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
    
    it('should handle file system errors gracefully', async () => {
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const config = {
        url: 'http://lidarr:8686',
        apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
        rootFolder: '/music',
        qualityProfileId: 1
      };

      const response = await request(app)
        .post('/api/config/lidarr')
        .send(config);

      // Should handle error gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/config/lidarr/test', () => {
    it('should test Lidarr connection', async () => {
      // Mock successful responses for status and quality profile endpoints
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue({ version: '1.0.0' }),
          text: jest.fn().mockResolvedValue(''),
          headers: new Map()
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
          text: jest.fn().mockResolvedValue(''),
          headers: new Map()
        });

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'test-key'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.profiles).toHaveLength(1);
      expect(response.body.profiles[0].name).toBe('Standard');
    });

    it('should handle connection errors', async () => {
      // Mock a 401 unauthorized response
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({ error: 'Invalid API key' }),
        text: jest.fn().mockResolvedValue('Invalid API key'),
        headers: new Map()
      });

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'bad-key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid API key');
    });
    
    it('should handle network errors', async () => {
      // Mock a network error
      const networkError = new Error('fetch failed');
      networkError.code = 'ENOTFOUND';
      networkError.cause = new Error('getaddrinfo ENOTFOUND lidarr');
      
      global.fetch.mockRejectedValueOnce(networkError);

      const response = await request(app)
        .post('/api/config/lidarr/test')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'test-key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Host not found');
    });
  });
  
  describe('POST /api/config/lidarr/rootfolders', () => {
    it('should fetch root folders from Lidarr', async () => {
      // Mock successful root folders response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          {
            id: 1,
            path: '/music',
            accessible: true,
            freeSpace: 1000000000000,
            totalSpace: 2000000000000
          }
        ]),
        headers: new Map()
      });

      const response = await request(app)
        .post('/api/config/lidarr/rootfolders')
        .send({
          url: 'http://lidarr:8686',
          apiKey: 'test-key'
        });

      expect(response.status).toBe(200);
      expect(response.body.rootFolders).toHaveLength(1);
      expect(response.body.rootFolders[0].path).toBe('/music');
      expect(response.body.rootFolders[0].accessible).toBe(true);
    });

    it('should use saved API key when useSavedApiKey is true', async () => {
      // Mock that config file exists with saved API key
      mockReadFile.mockResolvedValue(JSON.stringify({
        lidarr: {
          url: 'http://lidarr:8686',
          apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
          rootFolder: '/music',
          qualityProfileId: 1
        }
      }));

      // Mock successful root folders response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue([
          {
            id: 1,
            path: '/music',
            accessible: true
          }
        ])
      });

      const response = await request(app)
        .post('/api/config/lidarr/rootfolders')
        .send({
          url: 'http://lidarr:8686',
          useSavedApiKey: true
        });

      expect(response.status).toBe(200);
      expect(response.body.rootFolders).toBeDefined();
    });
  });
});
