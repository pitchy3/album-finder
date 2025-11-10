// client/src/hooks/useAuthConfig.js - Fixed to use secureApiCall for CSRF protection
import { useState, useEffect } from 'react';
import { secureApiCall } from '../services/apiService.js';

export function useAuthConfig() {
  const [config, setConfig] = useState({
    authType: null,
    oidc: {
      domain: '',
      issuerUrl: '',
      clientId: '',
      clientSecret: '',
      callbackUrl: ''
    },
    basicAuth: {
      username: '',
      password: '',
      currentPassword: '',
      hasPassword: false
    }
  });

  const [originalOIDCSecret, setOriginalOIDCSecret] = useState('');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserAuthType, setCurrentUserAuthType] = useState(null);
  
  const [loading, setLoading] = useState({
    config: true,
    testing: false,
    saving: false
  });

  const updateConfig = (section, updates) => {
    setConfig(prev => ({
      ...prev,
      [section]: { ...prev[section], ...updates }
    }));
  };

  const loadConfig = async () => {
    setLoading(prev => ({ ...prev, config: true }));
    try {
      const response = await fetch('/api/config/auth');
      if (response.ok) {
        const data = await response.json();
        
        const isOIDCSecretObfuscated = data.oidc.clientSecret && data.oidc.clientSecret.startsWith('***');
        
        setConfig({
          authType: data.authType,
          oidc: {
            domain: data.oidc.domain || '',
            issuerUrl: data.oidc.issuerUrl || '',
            clientId: data.oidc.clientId || '',
            clientSecret: isOIDCSecretObfuscated ? '' : (data.oidc.clientSecret || ''),
            callbackUrl: data.oidc.callbackUrl || ''
          },
          basicAuth: {
            username: data.basicAuth.username || '',
            password: '',
            currentPassword: '',
            hasPassword: data.basicAuth.hasPassword || false
          }
        });

        setOriginalOIDCSecret(isOIDCSecretObfuscated ? 'OBFUSCATED_SECRET_EXISTS' : (data.oidc.clientSecret || ''));
        setAuthEnabled(data.authEnabled || false);
      }

      // Check if user is logged in
      const authResponse = await fetch('/api/auth/user', { credentials: 'include' });
      if (authResponse.ok) {
        const authData = await authResponse.json();
        setIsLoggedIn(authData.loggedIn);
        setCurrentUserAuthType(authData.user?.authType);
      }
    } catch (error) {
      console.error('Failed to load Auth config:', error);
    } finally {
      setLoading(prev => ({ ...prev, config: false }));
    }
  };

  const testOIDCConnection = async () => {
    const hasNewIssuerUrl = config.oidc.issuerUrl && config.oidc.issuerUrl.trim() !== '';
    const hasSavedConfig = originalOIDCSecret === 'OBFUSCATED_SECRET_EXISTS';
    
    if (!hasNewIssuerUrl && !hasSavedConfig) {
      return { success: false, error: 'Issuer URL is required for testing' };
    }
    
    setLoading(prev => ({ ...prev, testing: true }));
    
    try {
      const testPayload = {
        issuerUrl: config.oidc.issuerUrl,
        useSavedConfig: !hasNewIssuerUrl && hasSavedConfig
      };

      if (hasNewIssuerUrl) {
        testPayload.clientId = config.oidc.clientId;
        testPayload.clientSecret = config.oidc.clientSecret;
        testPayload.domain = config.oidc.domain;
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
        
        const issuerInfo = result.issuer || result.issuerUrl || config.oidc.issuerUrl;
        if (issuerInfo) {
          successMsg += ` Issuer: ${issuerInfo.replace(/\/$/, '')}`;
        }
        
        if (result.clientTest?.success) {
          successMsg += ' | Client credentials valid';
        }
        
        return { success: true, message: successMsg };
      } else {
        return { success: false, error: result.error || 'Connection test failed' };
      }
    } catch (error) {
      setLoading(prev => ({ ...prev, testing: false }));
      return { success: false, error: `Failed to test OIDC connection: ${error.message}` };
    }
  };

  const saveOIDCConfig = async () => {
    setLoading(prev => ({ ...prev, saving: true }));
    
    try {
      if (!config.oidc.domain || !config.oidc.issuerUrl || !config.oidc.clientId) {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'Domain, Issuer URL, and Client ID are required' };
      }

      let clientSecretToSend;
      
      if (config.oidc.clientSecret && config.oidc.clientSecret.trim() !== '') {
        clientSecretToSend = config.oidc.clientSecret;
      } else if (originalOIDCSecret === 'OBFUSCATED_SECRET_EXISTS') {
        setLoading(prev => ({ ...prev, saving: false }));
        return { 
          success: false, 
          error: 'Cannot save without re-entering Client Secret' 
        };
      } else {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'Client Secret is required' };
      }

      // First save OIDC config (uses secureApiCall for CSRF)
      const response = await secureApiCall('/api/config/auth/oidc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: config.oidc.domain,
          issuerUrl: config.oidc.issuerUrl,
          clientId: config.oidc.clientId,
          clientSecret: clientSecretToSend
        })
      });

      const result = await response.json();
      
      if (!response.ok || result.success === false) {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: result.error || 'Failed to save OIDC configuration' };
      }

      // Then set auth type to OIDC (uses secureApiCall for CSRF)
      const typeResponse = await secureApiCall('/api/config/auth/set-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authType: 'oidc' })
      });

      const typeResult = await typeResponse.json();
      
      setLoading(prev => ({ ...prev, saving: false }));
      
      if (typeResponse.ok && typeResult.success) {
        setOriginalOIDCSecret('OBFUSCATED_SECRET_EXISTS');
        setAuthEnabled(true);
        
        return { 
          success: true, 
          message: 'OIDC configuration saved successfully!' 
        };
      } else {
        return { success: false, error: typeResult.error || 'Failed to enable OIDC' };
      }
    } catch (error) {
      setLoading(prev => ({ ...prev, saving: false }));
      return { success: false, error: `Failed to save OIDC configuration: ${error.message}` };
    }
  };

  const saveBasicAuthConfig = async () => {
    setLoading(prev => ({ ...prev, saving: true }));
    
    try {
      if (!config.basicAuth.username || !config.basicAuth.password) {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: 'Username and password are required' };
      }

      const payload = {
        username: config.basicAuth.username,
        password: config.basicAuth.password
      };

      // If logged in with BasicAuth, include current password
      if (isLoggedIn && currentUserAuthType === 'basicauth') {
        if (!config.basicAuth.currentPassword) {
          setLoading(prev => ({ ...prev, saving: false }));
          return { success: false, error: 'Current password is required' };
        }
        payload.currentPassword = config.basicAuth.currentPassword;
      }

      // First save BasicAuth config (uses secureApiCall for CSRF)
      const response = await secureApiCall('/api/config/auth/basicauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (!response.ok || result.success === false) {
        setLoading(prev => ({ ...prev, saving: false }));
        return { success: false, error: result.error || 'Failed to save BasicAuth configuration' };
      }

      // Then set auth type to basicauth (uses secureApiCall for CSRF)
      const typeResponse = await secureApiCall('/api/config/auth/set-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authType: 'basicauth' })
      });

      const typeResult = await typeResponse.json();
      
      setLoading(prev => ({ ...prev, saving: false }));
      
      if (typeResponse.ok && typeResult.success) {
        setAuthEnabled(true);
        
        // Clear password fields
        setConfig(prev => ({
          ...prev,
          basicAuth: {
            ...prev.basicAuth,
            password: '',
            currentPassword: '',
            hasPassword: true
          }
        }));
        
        return { 
          success: true, 
          message: 'BasicAuth configuration saved successfully!' 
        };
      } else {
        return { success: false, error: typeResult.error || 'Failed to enable BasicAuth' };
      }
    } catch (error) {
      setLoading(prev => ({ ...prev, saving: false }));
      return { success: false, error: `Failed to save BasicAuth configuration: ${error.message}` };
    }
  };

  const disableAuth = async () => {
    try {
      // Use secureApiCall for CSRF protection
      const response = await secureApiCall('/api/config/auth/set-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authType: null })
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        setAuthEnabled(false);
        return { success: true, message: 'Authentication disabled' };
      } else {
        return { success: false, error: result.error || 'Failed to disable authentication' };
      }
    } catch (error) {
      return { success: false, error: `Failed to disable authentication: ${error.message}` };
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const isLoggedInWithBasicAuth = isLoggedIn && currentUserAuthType === 'basicauth';

  return {
    config,
    updateConfig,
    setConfig,
    authEnabled,
    isLoggedIn,
    currentUserAuthType,
    isLoggedInWithBasicAuth,
    loading,
    testOIDCConnection,
    saveOIDCConfig,
    saveBasicAuthConfig,
    disableAuth,
    originalOIDCSecret
  };
}