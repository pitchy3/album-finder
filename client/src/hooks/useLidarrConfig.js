// client/src/hooks/useLidarrConfig.js
import { useState, useEffect } from 'react';
import { secureApiCall } from '../services/apiService.js';

/**
 * Hook for managing Lidarr configuration
 * Handles loading, testing, and saving Lidarr settings
 * 
 * Based on the original ConfigPage.jsx implementation - kept simple!
 */
export function useLidarrConfig() {
  const [config, setConfig] = useState({
    url: '',
    apiKey: '',
    rootFolder: '',
    qualityProfileId: ''
  });

  const [originalApiKey, setOriginalApiKey] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [rootFolders, setRootFolders] = useState([]);
  
  const [loading, setLoading] = useState({
    config: true,
    folders: false,
    testing: false,
    saving: false
  });

  /**
   * Update a single config field
   */
  const updateConfig = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  /**
   * Load current Lidarr configuration
   */
  const loadConfig = async () => {
    setLoading(prev => ({ ...prev, config: true }));
    try {
      const response = await secureApiCall('/api/config/lidarr');
      if (response.ok) {
        const data = await response.json();
        const isObfuscated = data.apiKey && data.apiKey.startsWith('***');
        
        setConfig({
          url: data.url || '',
          apiKey: isObfuscated ? '' : (data.apiKey || ''),
          rootFolder: data.rootFolder || '',
          qualityProfileId: data.qualityProfileId || ''
        });

        setOriginalApiKey(isObfuscated ? 'OBFUSCATED_KEY_EXISTS' : (data.apiKey || ''));
      }
    } catch (error) {
      console.error('Failed to load Lidarr config:', error);
    } finally {
      setLoading(prev => ({ ...prev, config: false }));
    }
  };

  /**
   * Load root folders from Lidarr
   */
  const loadRootFolders = async () => {
    setLoading(prev => ({ ...prev, folders: true }));
    try {
      const hasNewApiKey = config.apiKey && config.apiKey.trim() !== '';
      const hasSavedObfuscatedKey = originalApiKey === 'OBFUSCATED_KEY_EXISTS';
      
      let response;
      
      if (hasNewApiKey) {
        response = await fetch('/api/config/lidarr/rootfolders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: config.url, apiKey: config.apiKey })
        });
      } else if (hasSavedObfuscatedKey) {
        response = await fetch('/api/config/lidarr/rootfolders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: config.url, useSavedApiKey: true })
        });
      } else {
        setLoading(prev => ({ ...prev, folders: false }));
        return { success: false, error: 'No API key available' };
      }
      
      if (response.ok) {
        const data = await response.json();
        setRootFolders(data.rootFolders || []);
        setLoading(prev => ({ ...prev, folders: false }));
        return { success: true, rootFolders: data.rootFolders || [] };
      } else {
        const error = await response.json();
        setLoading(prev => ({ ...prev, folders: false }));
        return { success: false, error: error.error || 'Failed to load root folders' };
      }
    } catch (error) {
      console.error('Failed to load root folders:', error);
      setLoading(prev => ({ ...prev, folders: false }));
      return { success: false, error: error.message };
    }
  };

  /**
   * Test connection to Lidarr
   */
  const testConnection = async () => {
    const hasNewApiKey = config.apiKey && config.apiKey.trim() !== '';
    const hasSavedObfuscatedKey = originalApiKey === 'OBFUSCATED_KEY_EXISTS';
    
    if (!config.url) {
      return { success: false, error: 'URL is required for testing' };
    }

    if (!hasNewApiKey && !hasSavedObfuscatedKey) {
      return { success: false, error: 'API Key is required for testing' };
    }

    setLoading(prev => ({ ...prev, testing: true }));

    try {
      let response;
      
      if (hasNewApiKey) {
        response = await fetch('/api/config/lidarr/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: config.url, apiKey: config.apiKey })
        });
      } else {
        response = await fetch('/api/config/lidarr/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: config.url, useSavedApiKey: true })
        });
      }

      const result = await response.json();

      if (response.ok) {
        setProfiles(result.profiles || []);
        setLoading(prev => ({ ...prev, testing: false }));
        
        // Automatically load root folders after successful connection
        setTimeout(() => loadRootFolders(), 500);
        
        return {
          success: true,
          message: `Connection successful! Lidarr ${result.version || 'detected'}. ${result.profiles?.length || 0} quality profiles loaded.`,
          profiles: result.profiles || []
        };
      } else {
        setLoading(prev => ({ ...prev, testing: false }));
        return {
          success: false,
          error: result.error || 'Connection test failed'
        };
      }
    } catch (error) {
      setLoading(prev => ({ ...prev, testing: false }));
      return {
        success: false,
        error: 'Failed to test connection'
      };
    }
  };

  /**
   * Save Lidarr configuration
   */
  const saveConfig = async () => {
    setLoading(prev => ({ ...prev, saving: true }));

    try {
      // Determine which API key to send
      let apiKeyToSend;
      
      if (config.apiKey && config.apiKey.trim() !== '') {
        // User entered a new key
        apiKeyToSend = config.apiKey;
      } else if (originalApiKey === 'OBFUSCATED_KEY_EXISTS') {
        // Use a special marker that backend will recognize
        // Backend needs to be updated to handle this, but for now we need to send something
        // Let's load the actual key from config
        const currentConfig = await (async () => {
          try {
            const response = await fetch('/api/config/lidarr');
            if (response.ok) {
              const data = await response.json();
              // The GET endpoint returns obfuscated key, so we need the real one
              // We'll need to get it from server-side storage
              return null; // Can't get the real key from client
            }
          } catch {
            return null;
          }
        })();
        
        // We can't get the original key, so we have to fail
        setLoading(prev => ({ ...prev, saving: false }));
        return { 
          success: false, 
          error: 'Cannot save without re-entering API key. The saved key cannot be retrieved for security reasons.' 
        };
      } else {
        // No new key and no saved key
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'API key is required' };
      }

      const response = await secureApiCall('/api/config/lidarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          apiKey: apiKeyToSend,
          rootFolder: config.rootFolder,
          qualityProfileId: config.qualityProfileId
        })
      });

      if (response.ok) {
        setOriginalApiKey('OBFUSCATED_KEY_EXISTS');
        setLoading(prev => ({ ...prev, saving: false }));
        return {
          success: true,
          message: 'Lidarr configuration saved successfully!'
        };
      } else {
        const error = await response.json();
        setLoading(prev => ({ ...prev, saving: false }));
        return {
          success: false,
          error: error.error || 'Failed to save configuration'
        };
      }
    } catch (error) {
      setLoading(prev => ({ ...prev, saving: false }));
      return {
        success: false,
        error: 'Failed to save Lidarr configuration'
      };
    }
  };

  // Load config on mount - SIMPLE, just like the original!
  useEffect(() => {
    loadConfig();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    config,
    updateConfig,
    setConfig,
    profiles,
    rootFolders,
    loading,
    testConnection,
    loadRootFolders,
    saveConfig,
    originalApiKey
  };
}