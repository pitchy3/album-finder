import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secureApiCall, refreshCsrfToken, hasCsrfToken } from '../../services/apiService';

import * as apiService from '../../services/apiService';

global.fetch = vi.fn();

describe('API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module's internal CSRF token cache
    if (apiService.__resetCsrfToken) {
      apiService.__resetCsrfToken();
    }
  });

  it('should get CSRF token for state-changing operations', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'test-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

    await secureApiCall('/api/test', { method: 'POST' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/csrf-token',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('should include CSRF token in request headers', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'test-token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

    await secureApiCall('/api/test', { method: 'POST' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'csrf-token': 'test-token'
        })
      })
    );
  });

  it('should retry on CSRF token failure', async () => {
    // Note: The current implementation of secureApiCall caches the CSRF token
    // so we need to test this differently or the implementation needs adjustment
    
    // For now, let's test that the service handles 403 errors
    fetch
      // First: initial CSRF token fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'initial-token' })
      })
      // Second: simulate a 403 CSRF failure
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'CSRF validation failed'
      })
      // Third: refresh token fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'refreshed-token' })
      })
      // Fourth: successful retry with refreshed token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

    const response = await secureApiCall('/api/test', { method: 'POST' });

    // Verify CSRF token was fetched initially
    expect(fetch).toHaveBeenCalledWith(
      '/api/csrf-token',
      expect.objectContaining({ credentials: 'include' })
    );

    // Verify POST request retried with refreshed token
    const lastCall = fetch.mock.calls.at(-1);
    expect(lastCall[0]).toBe('/api/test');
    expect(lastCall[1].headers['csrf-token']).toBe('refreshed-token');
  });

  it('should not add CSRF token for GET requests', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'test' })
    });

    await secureApiCall('/api/test', { method: 'GET' });

    const calls = fetch.mock.calls;
    const testCall = calls.find(call => call[0] === '/api/test');
    
    // GET requests shouldn't have CSRF token
    expect(testCall[1].headers).not.toHaveProperty('csrf-token');
  });
});