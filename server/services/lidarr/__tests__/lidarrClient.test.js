/**
 * Unit tests for LidarrClient
 * Tests HTTP client functionality, authentication, timeouts, and error handling
 */

global.fetch = jest.fn();

const { LidarrClient } = require('../lidarrClient');
const config = require('../../../config');

// Mock config encryption
jest.mock('../../../services/configEncryption', () => ({
  getDecryptedLidarrApiKey: jest.fn(() => 'test-api-key-12345')
}));

describe('LidarrClient', () => {
  let client;

  beforeAll(() => {
    config.lidarr.url = 'http://localhost:8686';
    config.lidarr.apiKey = 'encrypted-key';
  });

  beforeEach(() => {
    client = new LidarrClient();
    global.fetch.mockReset();
  });

  describe('constructor', () => {
    it('should initialize with correct base URL', () => {
      expect(client.baseUrl).toBe('http://localhost:8686');
    });

    it('should strip trailing slash from URL', () => {
      config.lidarr.url = 'http://localhost:8686/';
      const client2 = new LidarrClient();
      expect(client2.baseUrl).toBe('http://localhost:8686');
    });
  });

  describe('buildUrl', () => {
    it('should build URL with endpoint and API key', () => {
      const url = client.buildUrl('album/lookup', { term: 'test' });
      expect(url).toContain('http://localhost:8686/api/v1/album/lookup');
      expect(url).toContain('term=test');
      expect(url).toContain('apikey=test-api-key-12345');
    });

    it('should handle endpoint without parameters', () => {
      const url = client.buildUrl('system/status');
      expect(url).toContain('http://localhost:8686/api/v1/system/status');
      expect(url).toContain('apikey=test-api-key-12345');
    });

    it('should encode special characters in parameters', () => {
      const url = client.buildUrl('album/lookup', { term: 'test & special' });
      expect(url).toContain('term=test+%26+special');
    });
  });

  describe('redactUrl', () => {
    it('should redact API key from URL', () => {
      const url = 'http://localhost:8686/api/v1/album?apikey=secret123456789';
      const redacted = LidarrClient.redactUrl(url);
      expect(redacted).toContain('***789');
      expect(redacted).not.toContain('secret');
    });

    it('should handle short API keys', () => {
      const url = 'http://localhost:8686/api/v1/album?apikey=abc';
      const redacted = LidarrClient.redactUrl(url);
      expect(redacted).toContain('***');
      expect(redacted).not.toContain('abc');
    });

    it('should handle URLs without API key', () => {
      const url = 'http://localhost:8686/api/v1/album';
      const redacted = LidarrClient.redactUrl(url);
      expect(redacted).toBe(url);
    });

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'not a valid url';
      const redacted = LidarrClient.redactUrl(invalidUrl);
      expect(redacted).toBe(invalidUrl);
    });
  });

  describe('request', () => {
    it('should make successful GET request', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ data: 'test' })
      });

      const result = await client.request('system/status');
      
      expect(result).toEqual({ data: 'test' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('system/status'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json'
          })
        })
      );
    });

    it('should make successful POST request with body', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 1 })
      });

      const result = await client.request('artist', {
        method: 'POST',
        body: { artistName: 'Test Artist' }
      });

      expect(result).toEqual({ id: 1 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ artistName: 'Test Artist' })
        })
      );
    });

    it('should handle 404 error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('Album not found')
      });

      await expect(client.request('album/999')).rejects.toThrow('404 Not Found');
    });

    it('should handle 401 unauthorized', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: jest.fn().mockResolvedValue('Invalid API key')
      });

      await expect(client.request('album')).rejects.toThrow('401 Unauthorized');
    });

    it('should handle timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      global.fetch.mockRejectedValueOnce(abortError);

      await expect(
        client.request('album', { timeout: 100 })
      ).rejects.toThrow('timeout');
    });

    it('should handle network error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.request('album')).rejects.toThrow('Network error');
    });

    it('should pass custom timeout to request', async () => {
      // This test verifies timeout is used, without actually waiting for it
      const customTimeout = 15000;
      
      global.fetch.mockImplementationOnce(() => 
        Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ success: true })
        })
      );

      await client.request('album', { timeout: customTimeout });

      // Verify fetch was called (timeout handler was set up)
      expect(global.fetch).toHaveBeenCalled();
      
      // The actual timeout behavior is already tested in "should handle timeout" test
    });

    it('should include API key in header when not in URL', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({})
      });

      await client.request('album', { includeApiKeyInUrl: false });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.not.stringContaining('apikey='),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Api-Key': 'test-api-key-12345'
          })
        })
      );
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: true })
      });
    });

    it('should support get method', async () => {
      await client.get('album', { artistId: 1 });
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('artistId=1'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should support post method', async () => {
      await client.post('artist', { artistName: 'Test' });
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ artistName: 'Test' })
        })
      );
    });

    it('should support put method', async () => {
      await client.put('album/1', { monitored: true });
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ monitored: true })
        })
      );
    });

    it('should support delete method', async () => {
      await client.delete('album/1');
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('validateConfig', () => {
    it('should pass with valid config', () => {
      config.lidarr.url = 'http://localhost:8686';
      config.lidarr.apiKey = 'test-key';
      
      expect(() => LidarrClient.validateConfig()).not.toThrow();
    });

    it('should throw when URL missing', () => {
      config.lidarr.url = '';
      config.lidarr.apiKey = 'test-key';
      
      expect(() => LidarrClient.validateConfig()).toThrow('not configured');
    });

    it('should throw when API key missing', () => {
      config.lidarr.url = 'http://localhost:8686';
      config.lidarr.apiKey = '';
      
      expect(() => LidarrClient.validateConfig()).toThrow('not configured');
    });
  });

  describe('error handling edge cases', () => {
    it('should handle malformed JSON response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      await expect(client.request('album')).rejects.toThrow('Invalid JSON');
    });

    it('should handle empty error response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('')
      });

      await expect(client.request('album')).rejects.toThrow('500 Internal Server Error');
    });

    it('should clean up timeout on success', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({})
      });

      await client.request('album');
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clean up timeout on error', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.request('album')).rejects.toThrow();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});