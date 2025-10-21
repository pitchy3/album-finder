// client/src/components/config/LidarrTab.jsx
import { useState } from 'react';
import { useLidarrConfig } from '../../hooks';
import {
  ConfigInput,
  ConfigSelect,
  ConfigSection,
  MessageDisplay
} from './shared';

export default function LidarrTab({ darkMode }) {
  const [message, setMessage] = useState(null);
  const lidarr = useLidarrConfig();

  const handleTestConnection = async () => {
    setMessage(null);
    const result = await lidarr.testConnection();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
  };

  const handleSave = async () => {
    setMessage(null);
    const result = await lidarr.saveConfig();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? result.message : result.error
    });
  };

  if (lidarr.loading.config) {
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
          Lidarr Configuration
        </h2>
        <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
          Configure your Lidarr instance for automatic music downloads.
        </p>
      </div>

      <MessageDisplay
        message={message}
        onDismiss={() => setMessage(null)}
        darkMode={darkMode}
        autoHide={5000}
      />

      <ConfigSection darkMode={darkMode}>
        <ConfigInput
          label="Lidarr URL"
          type="url"
          value={lidarr.config.url}
          onChange={(value) => lidarr.updateConfig('url', value)}
          placeholder="http://localhost:8686"
          helpText="The base URL of your Lidarr instance (including port if needed)"
          required={true}
          darkMode={darkMode}
        />

        <ConfigInput
          label="API Key"
          type="password"
          value={lidarr.config.apiKey}
          onChange={(value) => lidarr.updateConfig('apiKey', value)}
          placeholder={
            lidarr.originalApiKey === 'OBFUSCATED_KEY_EXISTS'
              ? 'Enter new API key or leave blank to keep current'
              : 'Your Lidarr API key'
          }
          helpText={
            lidarr.originalApiKey === 'OBFUSCATED_KEY_EXISTS'
              ? '⚠️ API key is saved. You must re-enter it to update other settings (for security reasons).'
              : 'Found in Lidarr → Settings → General → Security → API Key'
          }
          required={true}
          darkMode={darkMode}
        />

        {/* Test Connection Button */}
        <div>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={!lidarr.config.url || lidarr.loading.testing}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lidarr.loading.testing ? 'Testing...' : 'Test Lidarr Connection'}
          </button>
        </div>

        {/* Quality Profile */}
        {lidarr.profiles.length > 0 ? (
          <ConfigSelect
            label="Quality Profile"
            value={lidarr.config.qualityProfileId}
            onChange={(value) => lidarr.updateConfig('qualityProfileId', value)}
            options={lidarr.profiles.map(p => ({ value: p.id, label: p.name }))}
            helpText="Select the quality profile to use for new albums"
            required={true}
            darkMode={darkMode}
            placeholder="Select a quality profile..."
          />
        ) : (
          <ConfigInput
            label="Quality Profile ID"
            type="number"
            value={lidarr.config.qualityProfileId}
            onChange={(value) => lidarr.updateConfig('qualityProfileId', value)}
            placeholder="1"
            helpText="Test connection first to load available profiles, or enter profile ID manually"
            required={true}
            darkMode={darkMode}
          />
        )}

        {/* Root Folder */}
        {lidarr.rootFolders.length > 0 ? (
          <ConfigSelect
            label="Root Folder"
            value={lidarr.config.rootFolder}
            onChange={(value) => lidarr.updateConfig('rootFolder', value)}
            options={lidarr.rootFolders.map(f => ({
              value: f.path,
              label: `${f.path}${!f.accessible ? ' (Not accessible)' : ''}`,
              disabled: !f.accessible
            }))}
            helpText="Select from your configured Lidarr root folders"
            required={true}
            darkMode={darkMode}
            loading={lidarr.loading.folders}
            placeholder="Select a root folder..."
          />
        ) : (
          <ConfigInput
            label="Root Folder"
            type="text"
            value={lidarr.config.rootFolder}
            onChange={(value) => lidarr.updateConfig('rootFolder', value)}
            placeholder="/music"
            helpText={
              lidarr.loading.folders
                ? 'Loading root folders...'
                : 'The root folder path where music will be stored. Test connection to load available folders.'
            }
            required={true}
            darkMode={darkMode}
          />
        )}

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleSave}
            disabled={lidarr.loading.saving}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl p-3 hover:from-green-600 hover:to-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lidarr.loading.saving ? 'Saving...' : 'Save Lidarr Configuration'}
          </button>
        </div>
      </ConfigSection>
    </div>
  );
}