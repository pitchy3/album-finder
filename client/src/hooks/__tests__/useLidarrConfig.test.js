import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLidarrConfig } from '../../hooks/useLidarrConfig';

global.fetch = vi.fn();

describe('useLidarrConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load configuration on mount', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'http://lidarr:8686',
        apiKey: '***1234',
        rootFolder: '/music',
        qualityProfileId: 1
      })
    });

    const { result } = renderHook(() => useLidarrConfig());

    await waitFor(() => {
      expect(result.current.loading.config).toBe(false);
    });

    expect(result.current.config.url).toBe('http://lidarr:8686');
  });

  it('should test Lidarr connection', async () => {
    // Mock initial config load
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'http://lidarr:8686',
        apiKey: '***1234'
      })
    });

    const { result } = renderHook(() => useLidarrConfig());

    await waitFor(() => {
      expect(result.current.loading.config).toBe(false);
    });

    // Mock CSRF token request (happens before test connection POST)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        csrfToken: 'test-csrf-token'
      })
    });

    // Mock test connection response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        version: '1.0.0',
        profiles: [{ id: 1, name: 'Standard' }]
      })
    });

    // Mock CSRF token for the automatic loadRootFolders call (happens after successful test)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        csrfToken: 'test-csrf-token-2'
      })
    });

    // Mock root folders response (called automatically after successful connection)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rootFolders: [{ path: '/music', id: 1 }]
      })
    });

    let testResult;
    await act(async () => {
      testResult = await result.current.testConnection();
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });

    expect(testResult.success).toBe(true);
    expect(result.current.profiles[0]).toEqual({ id: 1, name: 'Standard' });
  });

  it('should save configuration', async () => {
    // Mock initial config load
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 
        url: '', 
        apiKey: '',
        rootFolder: '',
        qualityProfileId: ''
      })
    });

    const { result } = renderHook(() => useLidarrConfig());

    await waitFor(() => {
      expect(result.current.loading.config).toBe(false);
    });

    // Update config values
    act(() => {
      result.current.updateConfig('url', 'http://lidarr:8686');
      result.current.updateConfig('apiKey', 'test-key');
      result.current.updateConfig('rootFolder', '/music');
      result.current.updateConfig('qualityProfileId', 1);
    });

    // Mock the secureApiCall for CSRF token
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'test-token' })
    });

    // Mock save response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Configuration saved'
      })
    });

    let saveResult;
    await act(async () => {
      saveResult = await result.current.saveConfig();
    });

    expect(saveResult.success).toBe(true);
  });
});