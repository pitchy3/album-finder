// client/src/components/config/AuthTab.jsx - Updated with BasicAuth support
import { useState, useEffect } from 'react';
import { useAuthConfig } from '../../hooks';
import { secureApiCall } from '../../services/apiService.js';

import {
  ConfigInput,
  ConfigSection,
  StatusBanner,
  MessageDisplay
} from './shared';

export default function AuthTab({ darkMode, onRequestReauth }) {
  const [message, setMessage] = useState(null);
  const [selectedAuthType, setSelectedAuthType] = useState(null);
  const [isAuthUIEnabled, setIsAuthUIEnabled] = useState(false);
  const auth = useAuthConfig();

  // Sync selected type with loaded config
  useEffect(() => {
    if (auth.config.authType !== undefined && selectedAuthType === null) {
      setSelectedAuthType(auth.config.authType);
    }
  }, [auth.config.authType, selectedAuthType]);

  const handleTestOIDC = async () => {
    setMessage(null);
    const result = await auth.testOIDCConnection();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
  };

  const handleSaveOIDC = async () => {
    setMessage(null);
    
    // Check if auth type is changing and user is logged in
    if (auth.isLoggedIn && auth.currentUserAuthType === 'basicauth' && selectedAuthType === 'oidc') {
      // Need re-authentication
      onRequestReauth('oidc');
      //return;
    }
    
    const result = await auth.saveOIDCConfig();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
	
	await secureApiCall('/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  };

  const handleSaveBasicAuth = async () => {
    setMessage(null);
    
    // Check if auth type is changing and user is logged in
    if (auth.isLoggedIn && auth.currentUserAuthType === 'oidc' && selectedAuthType === 'basicauth') {
      // Need re-authentication
      onRequestReauth('basicauth');
      //return;
    }
    
    const result = await auth.saveBasicAuthConfig();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
	
	await secureApiCall('/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  };

  const handleToggleAuth = async (enabled) => {
    setMessage(null);
    
    if (!enabled && auth.isLoggedIn) {
      // Disabling auth requires re-authentication
      onRequestReauth('disable', null);
      //return;
    }
    
    if (enabled) {
      // Enable UI toggle and set default auth type
      setIsAuthUIEnabled(true);
      if (selectedAuthType === null) {
        setSelectedAuthType('oidc'); // Default to OIDC
      }
      
      setMessage({
        type: 'info',
        text: 'Authentication enabled. Configure OIDC or BasicAuth below to activate.'
      });
    } else {
      // Disable auth on server
      const result = await auth.disableAuth();
      
      if (result.success) {
        // Reset UI state when disabling
        setIsAuthUIEnabled(false);
        setSelectedAuthType(null);
      }
      
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? 'Authentication disabled' : result.error
      });
    }
  };

  const handleAuthTypeChange = (newType) => {
    //if (auth.isLoggedIn && auth.config.authType && newType !== auth.config.authType) {
    //  // Changing auth type when logged in requires re-authentication
    //  setMessage({
    //    type: 'warning',
    //    text: 'Changing authentication type requires re-authentication. Save your changes to proceed.'
    //  });
    //}
    setSelectedAuthType(newType);
  };

  if (auth.loading.config) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
            Loading configuration...
          </p>
        </div>
      </div>
    );
  }

  const isAuthEnabled = ( auth.config.authType !== null || isAuthUIEnabled );

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
          Authentication Settings
        </h2>
        <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
          Configure authentication for multi-user access.
        </p>

        {/* Auth Status Banner */}
        <div className="mt-4">
          <StatusBanner
            type={isAuthEnabled ? 'success' : 'warning'}
            title={`Authentication is currently ${isAuthEnabled ? 'enabled' : 'disabled'}`}
            description={
              isAuthEnabled
                ? `Users must authenticate log in to access the application`
                : 'Complete configuration below and toggle on to enable authentication'
            }
            darkMode={darkMode}
          />
        </div>
      </div>

      <MessageDisplay
        message={message}
        onDismiss={() => setMessage(null)}
        darkMode={darkMode}
        autoHide={5000}
      />

      {/* Enable Auth Toggle */}
      <ConfigSection darkMode={darkMode}>
        <div className="flex items-center justify-between p-4 rounded-xl border-2 border-dashed" style={{
          borderColor: darkMode ? '#4B5563' : '#D1D5DB'
        }}>
          <div>
            <h3 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
              🔐 Enable Authentication
            </h3>
            <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {isAuthEnabled 
                ? 'Authentication is active. Configure settings below or toggle off to disable.'
                : 'Toggle on and configure authentication below to secure your application.'
              }
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isAuthEnabled}
              onChange={(e) => handleToggleAuth(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </ConfigSection>

      {/* Auth Type Selection */}
      {isAuthEnabled && (
        <ConfigSection 
          title="Authentication Type" 
          description="Choose how users will authenticate"
          darkMode={darkMode}
        >
          <div className="space-y-3">
            <label className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-colors ${
              selectedAuthType === 'oidc'
                ? darkMode
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-blue-500 bg-blue-50'
                : darkMode
                  ? 'border-gray-600 hover:border-gray-500'
                  : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                name="authType"
                value="oidc"
                checked={selectedAuthType === 'oidc'}
                onChange={() => handleAuthTypeChange('oidc')}
                className="w-4 h-4 text-blue-600"
              />
              <div className="ml-3">
                <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  OpenID Connect (OIDC)
                </div>
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Enterprise SSO with providers like Authentik, Keycloak, Auth0
                </div>
              </div>
            </label>

            <label className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-colors ${
              selectedAuthType === 'basicauth'
                ? darkMode
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-blue-500 bg-blue-50'
                : darkMode
                  ? 'border-gray-600 hover:border-gray-500'
                  : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                name="authType"
                value="basicauth"
                checked={selectedAuthType === 'basicauth'}
                onChange={() => handleAuthTypeChange('basicauth')}
                className="w-4 h-4 text-blue-600"
              />
              <div className="ml-3">
                <div className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Basic Authentication
                </div>
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Simple username/password authentication (single user)
                </div>
              </div>
            </label>
          </div>
        </ConfigSection>
      )}

      {/* OIDC Configuration */}
      {isAuthEnabled && selectedAuthType === 'oidc' && (
        <ConfigSection 
          title="OIDC Configuration" 
          darkMode={darkMode}
        >
          <ConfigInput
            label="Domain"
            type="text"
            value={auth.config.oidc.domain}
            onChange={(value) => auth.updateConfig('oidc', { domain: value })}
            placeholder="album.example.com"
            helpText="The domain where your application is hosted (without https://)"
            required={true}
            darkMode={darkMode}
          />

          {auth.config.oidc.callbackUrl && (
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                darkMode ? 'text-gray-200' : 'text-gray-700'
              }`}>
                Callback URL (Auto-generated)
              </label>
              <div className={`w-full border-2 rounded-xl p-3 font-mono ${
                darkMode
                  ? 'border-gray-600 bg-gray-700 text-gray-300'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}>
                {auth.config.oidc.callbackUrl}
              </div>
              <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Configure this URL in your OIDC provider
              </p>
            </div>
          )}

          <ConfigInput
            label="OIDC Issuer URL"
            type="url"
            value={auth.config.oidc.issuerUrl}
            onChange={(value) => auth.updateConfig('oidc', { issuerUrl: value })}
            placeholder="https://auth.example.com/application/o/your-app/"
            helpText="The base URL of your OpenID Connect provider"
            required={true}
            darkMode={darkMode}
          />

          <ConfigInput
            label="OIDC Client ID"
            type="text"
            value={auth.config.oidc.clientId}
            onChange={(value) => auth.updateConfig('oidc', { clientId: value })}
            placeholder="your-client-id"
            helpText="The client ID provided by your OIDC provider"
            required={true}
            darkMode={darkMode}
          />

          <ConfigInput
            label="OIDC Client Secret"
            type="password"
            value={auth.config.oidc.clientSecret}
            onChange={(value) => auth.updateConfig('oidc', { clientSecret: value })}
            placeholder={
              auth.originalOIDCSecret === 'OBFUSCATED_SECRET_EXISTS'
                ? 'Enter new client secret or leave blank to keep current'
                : 'Your OIDC client secret'
            }
            helpText={
              auth.originalOIDCSecret === 'OBFUSCATED_SECRET_EXISTS'
                ? '⚠️ Client secret is saved. Re-enter to update settings.'
                : 'The client secret provided by your OIDC provider'
            }
            required={true}
            darkMode={darkMode}
          />

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleTestOIDC}
              disabled={!auth.config.oidc.issuerUrl || auth.loading.testing}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {auth.loading.testing ? 'Testing...' : 'Test OIDC Connection'}
            </button>

            <button
              type="button"
              onClick={handleSaveOIDC}
              disabled={auth.loading.saving}
              className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl p-3 hover:from-green-600 hover:to-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {auth.loading.saving ? 'Saving...' : 'Save OIDC Configuration'}
            </button>
          </div>
        </ConfigSection>
      )}

      {/* BasicAuth Configuration */}
      {isAuthEnabled && selectedAuthType === 'basicauth' && (
        <ConfigSection 
          title="Basic Authentication Configuration" 
          darkMode={darkMode}
        >
          <ConfigInput
            label="Username"
            type="text"
            value={auth.config.basicAuth.username}
            onChange={(value) => auth.updateConfig('basicAuth', { username: value })}
            placeholder="admin"
            helpText="Username for authentication"
            required={true}
            darkMode={darkMode}
          />

          {auth.isLoggedInWithBasicAuth && (
            <ConfigInput
              label="Current Password"
              type="password"
              value={auth.config.basicAuth.currentPassword}
              onChange={(value) => auth.updateConfig('basicAuth', { currentPassword: value })}
              placeholder="Enter your current password"
              helpText="Required to change BasicAuth settings when logged in"
              required={true}
              darkMode={darkMode}
            />
          )}

          <ConfigInput
            label={auth.config.basicAuth.hasPassword ? "New Password" : "Password"}
            type="password"
            value={auth.config.basicAuth.password}
            onChange={(value) => auth.updateConfig('basicAuth', { password: value })}
            placeholder={auth.config.basicAuth.hasPassword ? "Enter new password to change" : "Enter password"}
            helpText="Minimum 16 characters, must include uppercase letter and number"
            required={!auth.config.basicAuth.hasPassword}
            darkMode={darkMode}
          />

          <button
            type="button"
            onClick={handleSaveBasicAuth}
            disabled={auth.loading.saving}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl p-3 hover:from-green-600 hover:to-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {auth.loading.saving ? 'Saving...' : 'Save BasicAuth Configuration'}
          </button>
        </ConfigSection>
      )}
    </div>
  );
}