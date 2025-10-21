// client/src/components/LidarrSetupBanner.jsx

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function LidarrSetupBanner({ onSettingsClick }) {
  const { preferences } = usePreferences();

  return (
    <div className={`border-2 rounded-xl p-4 mb-6 ${
      preferences.darkMode 
        ? 'bg-yellow-900/50 border-yellow-700' 
        : 'bg-yellow-50 border-yellow-200'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`font-medium mb-1 ${preferences.darkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>
            ⚙️ Lidarr Setup Required
          </h3>
          <p className={`text-sm ${preferences.darkMode ? 'text-yellow-400' : 'text-yellow-700'}`}>
            Configure your Lidarr connection to start adding albums.
          </p>
        </div>
        <button
          onClick={onSettingsClick}
          className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors text-sm font-medium"
        >
          Configure Now
        </button>
      </div>
    </div>
  );
}