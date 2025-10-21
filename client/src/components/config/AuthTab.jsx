// client/src/components/config/AuthTab.jsx
import { useState } from 'react';
import { useAuthConfig } from '../../hooks';
import {
  ConfigInput,
  ConfigSection,
  StatusBanner,
  MessageDisplay
} from './shared';

export default function AuthTab({ darkMode }) {
  const [message, setMessage] = useState(null);
  const auth = useAuthConfig();

  const handleTestConnection = async () => {
    setMessage(null);
    const result = await auth.testConnection();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
  };

  const handleSave = async () => {
    setMessage(null);
    const result = await auth.saveConfig();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
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

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
          Authentication Settings
        </h2>
        <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
          Configure OpenID Connect (OIDC) authentication for multi-user access.
        </p>

        {/* Auth Status Banner */}
        <div className="mt-4">
          <StatusBanner
            type={auth.authEnabled ? 'success' : 'warning'}
            title={`Authentication is currently ${auth.authEnabled ? 'enabled' : 'disabled'}`}
            description={
              auth.authEnabled
                ? 'Users must authenticate to access the application'
                : 'Complete all fields below and save to enable authentication and multi-user support'
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

      <ConfigSection darkMode={darkMode}>
        <ConfigInput
          label="Domain"
          type="text"
          value={auth.config.domain}
          onChange={(value) => auth.updateConfig('domain', value)}
          placeholder="album.example.com"
          helpText="The domain where your application is hosted (without https://)"
          required={true}
          darkMode={darkMode}
        />

        {/* Callback URL Display */}
        {auth.callbackUrl && (
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
              {auth.callbackUrl}
            </div>
            <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              This URL is automatically generated and must be configured in your OIDC provider
            </p>
          </div>
        )}

        <ConfigInput
          label="OIDC Issuer URL"
          type="url"
          value={auth.config.issuerUrl}
          onChange={(value) => auth.updateConfig('issuerUrl', value)}
          placeholder="https://auth.example.com/application/o/your-app/"
          helpText="The base URL of your OpenID Connect provider"
          required={true}
          darkMode={darkMode}
        />

        <ConfigInput
          label="OIDC Client ID"
          type="text"
          value={auth.config.clientId}
          onChange={(value) => auth.updateConfig('clientId', value)}
          placeholder="your-client-id"
          helpText="The client ID provided by your OIDC provider"
          required={true}
          darkMode={darkMode}
        />

        <ConfigInput
          label="OIDC Client Secret"
          type="password"
          value={auth.config.clientSecret}
          onChange={(value) => auth.updateConfig('clientSecret', value)}
          placeholder={
            auth.originalClientSecret === 'OBFUSCATED_SECRET_EXISTS'
              ? 'Enter new client secret or leave blank to keep current'
              : 'Your OIDC client secret'
          }
          helpText={
            auth.originalClientSecret === 'OBFUSCATED_SECRET_EXISTS'
              ? '⚠️ Client secret is saved. You must re-enter it to update other settings (for security reasons).'
              : 'The client secret provided by your OIDC provider'
          }
          required={true}
          darkMode={darkMode}
        />

        {/* Test Connection Button */}
        <div>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={!auth.config.issuerUrl || auth.loading.testing}
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl font-medium hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {auth.loading.testing ? 'Testing...' : 'Test OIDC Connection'}
          </button>
          <p className={`text-sm mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            Test the connection to your OIDC provider to verify the issuer URL is accessible
          </p>
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleSave}
            disabled={auth.loading.saving}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl p-3 hover:from-green-600 hover:to-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {auth.loading.saving ? 'Saving...' : 'Save Authentication Configuration'}
          </button>
        </div>
      </ConfigSection>
    </div>
  );
}