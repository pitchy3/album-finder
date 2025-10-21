// client/src/components/config/PreferencesTab.jsx
import {
  ConfigToggle,
  ConfigSelect,
  ConfigSection
} from './shared';

export default function PreferencesTab({ preferences, updatePreference, darkMode }) {
  const handleCategoryChange = (category) => {
    if (category === 'all') {
      updatePreference('artistReleaseCategories', { all: !preferences.artistReleaseCategories.all });
    } else {
      updatePreference('artistReleaseCategories', { [category]: !preferences.artistReleaseCategories[category] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
          Preferences
        </h2>
        <p className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
          Customize your application experience and search behavior.
        </p>
      </div>

      {/* Dark Mode Toggle */}
      <ConfigToggle
        label="🌙 Dark Mode"
        description="Switch between light and dark theme"
        checked={preferences.darkMode}
        onChange={(checked) => updatePreference('darkMode', checked)}
        darkMode={darkMode}
      />

      {/* Artist Release Limit */}
      <ConfigSection
        title="🎤 Artist Release Limit"
        description="Number of releases to fetch when browsing an artist"
        darkMode={darkMode}
      >
        <ConfigSelect
          label="Release Limit"
          value={preferences.artistReleaseLimit}
          onChange={(value) => {
            const parsedValue = value === 'all' ? 'all' : parseInt(value, 10);
            updatePreference('artistReleaseLimit', parsedValue);
          }}
          options={[
            { value: 50, label: '50 releases' },
            { value: 100, label: '100 releases' },
            { value: 'all', label: 'All releases' }
          ]}
          helpText="Controls how many releases appear when browsing an artist's discography"
          darkMode={darkMode}
        />

        {preferences.artistReleaseLimit === 'all' && (
          <div className={`mt-4 p-3 rounded-lg ${
            darkMode ? 'bg-yellow-900/50 border border-yellow-700' : 'bg-yellow-50 border border-yellow-200'
          }`}>
            <p className={`text-sm font-medium ${
              darkMode ? 'text-yellow-300' : 'text-yellow-800'
            }`}>
              ⚠️ Warning: Selecting "All releases" may significantly slow down response times for artists with many albums and singles.
            </p>
          </div>
        )}
      </ConfigSection>

      {/* Release Categories */}
      <ConfigSection
        title="🎵 Release Categories"
        description="Filter which types of releases appear in artist browse mode"
        darkMode={darkMode}
      >
        <div className="space-y-3">
          {/* All Categories Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="category-all"
              checked={preferences.artistReleaseCategories.all}
              onChange={() => handleCategoryChange('all')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            />
            <label
              htmlFor="category-all"
              className={`ml-2 text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
            >
              🎯 All Categories
            </label>
          </div>

          {/* Individual Categories */}
          <div className="ml-6 space-y-2">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="category-albums"
                checked={preferences.artistReleaseCategories.albums}
                disabled={preferences.artistReleaseCategories.all}
                onChange={() => handleCategoryChange('albums')}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:opacity-50"
              />
              <label
                htmlFor="category-albums"
                className={`ml-2 text-sm ${
                  preferences.artistReleaseCategories.all
                    ? 'text-gray-400'
                    : darkMode
                    ? 'text-gray-300'
                    : 'text-gray-600'
                }`}
              >
                💿 Albums
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="category-eps"
                checked={preferences.artistReleaseCategories.eps}
                disabled={preferences.artistReleaseCategories.all}
                onChange={() => handleCategoryChange('eps')}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:opacity-50"
              />
              <label
                htmlFor="category-eps"
                className={`ml-2 text-sm ${
                  preferences.artistReleaseCategories.all
                    ? 'text-gray-400'
                    : darkMode
                    ? 'text-gray-300'
                    : 'text-gray-600'
                }`}
              >
                🎵 EPs
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="category-singles"
                checked={preferences.artistReleaseCategories.singles}
                disabled={preferences.artistReleaseCategories.all}
                onChange={() => handleCategoryChange('singles')}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:opacity-50"
              />
              <label
                htmlFor="category-singles"
                className={`ml-2 text-sm ${
                  preferences.artistReleaseCategories.all
                    ? 'text-gray-400'
                    : darkMode
                    ? 'text-gray-300'
                    : 'text-gray-600'
                }`}
              >
                🎤 Singles
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="category-other"
                checked={preferences.artistReleaseCategories.other}
                disabled={preferences.artistReleaseCategories.all}
                onChange={() => handleCategoryChange('other')}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:opacity-50"
              />
              <label
                htmlFor="category-other"
                className={`ml-2 text-sm ${
                  preferences.artistReleaseCategories.all
                    ? 'text-gray-400'
                    : darkMode
                    ? 'text-gray-300'
                    : 'text-gray-600'
                }`}
              >
                ❓ Other
              </label>
            </div>
          </div>
        </div>
      </ConfigSection>

      {/* Auto-save Note */}
      <div className={`pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          💡 Changes are automatically saved as you make them
        </p>
      </div>
    </div>
  );
}