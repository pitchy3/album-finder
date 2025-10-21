// client/src/hooks/useAuthConfig.js
import { useState, useEffect } from 'react';

/**
 * Hook for managing Authentication configuration
 * Handles loading, testing, and saving OIDC settings
 * 
 * Based on the original ConfigPage.jsx implementation - kept simple!
 */
export function useAuthConfig() {
  const [config, setConfig] = useState({
    domain: '',
    issuerUrl: '',
    clientId: '',
    clientSecret: ''
  });

  const [originalClientSecret, setOriginalClientSecret] = useState('');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  
  const [loading, setLoading] = useState({
    config: true,
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
   * Load current Auth configuration
   */
  const loadConfig = async () => {
    setLoading(prev => ({ ...prev, config: true }));
    try {
      const response = await fetch('/api/config/auth');
      if (response.ok) {
        const data = await response.json();
        const isSecretObfuscated = data.clientSecret && data.clientSecret.startsWith('***');
        
        setConfig({
          domain: data.domain || '',
          issuerUrl: data.issuerUrl || '',
          clientId: data.clientId || '',
          clientSecret: isSecretObfuscated ? '' : (data.clientSecret || '')
        });

        setOriginalClientSecret(isSecretObfuscated ? 'OBFUSCATED_SECRET_EXISTS' : (data.clientSecret || ''));
        setAuthEnabled(data.authEnabled || false);
        setCallbackUrl(data.callbackUrl || '');
      }
    } catch (error) {
      console.error('Failed to load Auth config:', error);
    } finally {
      setLoading(prev => ({ ...prev, config: false }));
    }
  };

  /**
   * Test OIDC connection
   */
  const testConnection = async () => {
    const hasNewIssuerUrl = config.issuerUrl && config.issuerUrl.trim() !== '';
    const hasSavedConfig = config.issuerUrl || originalClientSecret === 'OBFUSCATED_SECRET_EXISTS';
    
    if (!hasNewIssuerUrl && !hasSavedConfig) {
      return { success: false, error: 'Issuer URL is required for testing' };
    }
    
    setLoading(prev => ({ ...prev, testing: true }));
    
    try {
      const testPayload = {
        issuerUrl: config.issuerUrl,
        useSavedConfig: !hasNewIssuerUrl && hasSavedConfig
      };

      if (hasNewIssuerUrl) {
        testPayload.clientId = config.clientId;
        testPayload.clientSecret = config.clientSecret;
        testPayload.domain = config.domain;
      }

      const response = await fetch('/api/config/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(testPayload)
      });

      const result = await response.json();
      
      setLoading(prev => ({ ...prev, testing: false }));
      
      if (response.ok && result.success) {
        let successMsg = 'OIDC connection successful!';
        
        const issuerInfo = result.issuer || result.issuerUrl || config.issuerUrl;
        if (issuerInfo) {
          const displayIssuer = issuerInfo.replace(/\/$/, '');
          successMsg += ` Issuer: ${displayIssuer}`;
        }
        
        if (result.clientTest) {
          if (result.clientTest.success) {
            successMsg += ' | Client credentials valid';
          } else if (result.clientTest.message && !result.clientTest.message.includes('not provided')) {
            successMsg += ` | ${result.clientTest.message}`;
          }
        }
        
        if (result.discoveredEndpoints) {
          const endpoints = result.discoveredEndpoints;
          const endpointNames = [];
          
          if (endpoints.authorization) endpointNames.push('authorization');
          if (endpoints.token) endpointNames.push('token');
          if (endpoints.userinfo) endpointNames.push('userinfo');
          if (endpoints.jwks) endpointNames.push('JWKS');
          
          if (endpointNames.length > 0) {
            successMsg += ` | Discovered: ${endpointNames.join(', ')}`;
          }
        }
        
        return { success: true, message: successMsg };
        
      } else {
        const errorMsg = result.error || 'Connection test failed';
        return { success: false, error: `OIDC test failed: ${errorMsg}` };
      }
      
    } catch (error) {
      setLoading(prev => ({ ...prev, testing: false }));
      return { success: false, error: `Failed to test OIDC connection: ${error.message}` };
    }
  };

  /**
   * Save Auth configuration
   */
  const saveConfig = async () => {
    setLoading(prev => ({ ...prev, saving: true }));
    
    try {
      // Check required fields first
      if (!config.domain || !config.issuerUrl || !config.clientId) {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'Domain, Issuer URL, and Client ID are required' };
      }

      // Determine which client secret to send
      let clientSecretToSend;
      
      if (config.clientSecret && config.clientSecret.trim() !== '') {
        // User entered a new secret
        clientSecretToSend = config.clientSecret;
      } else if (originalClientSecret === 'OBFUSCATED_SECRET_EXISTS') {
        // Can't retrieve the saved secret from client side for security
        setLoading(prev => ({ ...prev, saving: false }));
        return { 
          success: false, 
          error: 'Cannot save without re-entering Client Secret. The saved secret cannot be retrieved for security reasons.' 
        };
      } else {
        // No new secret and no saved secret
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'Client Secret is required' };
      }

      const response = await fetch('/api/config/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: config.domain,
          issuerUrl: config.issuerUrl,
          clientId: config.clientId,
          clientSecret: clientSecretToSend
        })
      });

      const result = await response.json();
      
      setLoading(prev => ({ ...prev, saving: false }));
      
      if (response.ok && (result.success !== false)) {
        let successMsg = result.message || 'Authentication configuration saved successfully!';
        
        const issuerInfo = result.issuer || config.issuerUrl;
        if (issuerInfo) {
          const displayIssuer = issuerInfo.replace(/\/$/, '');
          successMsg += ` | Issuer: ${displayIssuer}`;
        }
        
        if (result.authEnabled) {
          successMsg += ' | Authentication is now enabled';
        }
        
        const newCallbackUrl = result.callbackUrl || `https://${config.domain}/auth/callback`;
        successMsg += ` | Callback: ${newCallbackUrl}`;
        
        setOriginalClientSecret('OBFUSCATED_SECRET_EXISTS');
        setAuthEnabled(result.authEnabled || true);
        setCallbackUrl(result.callbackUrl || newCallbackUrl);
        
        return { success: true, message: successMsg };
        
      } else {
        const errorMsg = result.error || 'Failed to save configuration';
        return { success: false, error: `Save failed: ${errorMsg}` };
      }
      
    } catch (error) {
      setLoading(prev => ({ ...prev, saving: false }));
      return { success: false, error: `Failed to save authentication configuration: ${error.message}` };
    }
  };

  // Load config on mount - SIMPLE, just like the original!
  useEffect(() => {
    loadConfig();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update callback URL when domain changes
  useEffect(() => {
    if (config.domain && config.domain.trim() !== '') {
      setCallbackUrl(`https://${config.domain}/auth/callback`);
    } else {
      // Clear callback URL if domain is empty (unless we have a saved one from the server)
      if (!authEnabled) {
        setCallbackUrl('');
      }
    }
  }, [config.domain, authEnabled]);

  return {
    config,
    updateConfig,
    setConfig,
    authEnabled,
    callbackUrl,
    loading,
    testConnection,
    saveConfig,
    originalClientSecret
  };
}