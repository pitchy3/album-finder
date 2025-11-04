// client/src/components/ConfigPage.jsx - Refactored to use modular tab components
import { useState } from "react";
import { usePreferences } from "../contexts/PreferencesContext.jsx";
import { TabNavigation } from "./config/shared";
import { PreferencesTab, LidarrTab, AuthTab } from "./config";

export default function ConfigPage({ onBack, onRequestReauth }) {
  const { preferences, updatePreference } = usePreferences();
  const [activeTab, setActiveTab] = useState('preferences');

  // Tab configuration
  const tabs = [
    { id: 'preferences', label: 'Preferences' },
    { id: 'lidarr', label: 'Lidarr Settings' },
    { id: 'auth', label: 'Auth Settings' }
  ];

  return (
    <div className={`min-h-screen p-6 ${
      preferences.darkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-blue-50 to-indigo-100'
    }`}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className={`rounded-2xl shadow-xl p-6 mb-6 ${
          preferences.darkMode ? 'bg-gray-800 text-white' : 'bg-white'
        }`}>
          <h1 className={`text-3xl font-bold ${
            preferences.darkMode ? 'text-white' : 'text-gray-800'
          }`}>
            Application Settings
          </h1>
          <p className={preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}>
            Configure your application settings below.
          </p>
        </div>

        {/* Tab Navigation */}
        <TabNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={tabs}
          darkMode={preferences.darkMode}
        />

        {/* Tab Content */}
        <div className={`rounded-2xl shadow-xl p-6 ${
          preferences.darkMode ? 'bg-gray-800 text-white' : 'bg-white'
        }`}>
          {activeTab === 'preferences' && (
            <PreferencesTab
              preferences={preferences}
              updatePreference={updatePreference}
              darkMode={preferences.darkMode}
            />
          )}

          {activeTab === 'lidarr' && (
            <LidarrTab darkMode={preferences.darkMode} />
          )}

          {activeTab === 'auth' && (
            <AuthTab darkMode={preferences.darkMode} onRequestReauth={onRequestReauth} />
          )}
        </div>

        {/* Help Section - Context-aware based on active tab */}
        <div className={`rounded-2xl p-6 mt-6 ${
          preferences.darkMode ? 'bg-blue-900/50' : 'bg-blue-50'
        }`}>
          <h3 className={`text-lg font-semibold mb-3 ${
            preferences.darkMode ? 'text-blue-300' : 'text-blue-800'
          }`}>
            {activeTab === 'preferences' && 'Preferences Help'}
            {activeTab === 'lidarr' && 'Lidarr Configuration Help'}
            {activeTab === 'auth' && 'Authentication Help'}
          </h3>

          {activeTab === 'preferences' && (
            <ul className={`space-y-2 text-sm ${
              preferences.darkMode ? 'text-blue-300' : 'text-blue-700'
            }`}>
              <li>• <strong>Dark Mode:</strong> Changes the application theme - takes effect immediately</li>
              <li>• <strong>Release Limit:</strong> Controls how many releases to fetch when browsing artists</li>
              <li>• <strong>Release Categories:</strong> Filter which types of releases appear in artist browse mode</li>
              <li>• <strong>"All" Selection:</strong> When checked, shows all release types and disables individual filters</li>
            </ul>
          )}

          {activeTab === 'lidarr' && (
            <ul className={`space-y-2 text-sm ${
              preferences.darkMode ? 'text-blue-300' : 'text-blue-700'
            }`}>
              <li>• <strong>URL:</strong> Ensure your Lidarr instance is accessible from this server</li>
              <li>• <strong>API Key:</strong> Found in Lidarr → Settings → General → Security → API Key</li>
              <li>• <strong>Root Folder:</strong> Must match a folder configured in Lidarr → Settings → Media Management → Root Folders</li>
              <li>• <strong>Quality Profile:</strong> Found in Lidarr → Settings → Profiles → Quality Profiles</li>
            </ul>
          )}

          {activeTab === 'auth' && (
            <ul className={`space-y-2 text-sm ${
              preferences.darkMode ? 'text-blue-300' : 'text-blue-700'
            }`}>
              <li>• <strong>Authentication Types:</strong> Choose between OIDC (enterprise SSO) or BasicAuth (simple username/password)</li>
              <li>• <strong>OIDC:</strong> Supports providers like Authentik, Keycloak, Auth0, and other OpenID Connect providers</li>
              <li>• <strong>BasicAuth:</strong> Single user account with strong password requirements (16+ chars, uppercase, number)</li>
              <li>• <strong>Switching Types:</strong> Changing authentication type requires re-authentication for security</li>
              <li>• <strong>Domain:</strong> Required for OIDC - the domain where your application is hosted (e.g., album.example.com)</li>
              <li>• <strong>Security:</strong> All credentials are stored securely and never displayed in full</li>
            </ul>
          )}

          <div className={`mt-4 p-3 rounded-lg ${
            preferences.darkMode ? 'bg-blue-800/50' : 'bg-blue-100'
          }`}>
            <p className={`text-sm font-medium ${
              preferences.darkMode ? 'text-blue-200' : 'text-blue-800'
            }`}>
              {activeTab === 'preferences' 
                ? "Note: Preferences are automatically saved as you change them and will persist between sessions."
                : activeTab === 'lidarr'
                ? "Note: Lidarr configuration is managed entirely through this settings page. Environment variables are no longer used for Lidarr settings."
                : "Note: Authentication settings are managed entirely through this settings page. Changing auth type or disabling auth requires re-authentication for security."
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}