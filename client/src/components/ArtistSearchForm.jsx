// client/src/components/ArtistSearchForm.jsx

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function ArtistSearchForm({ artist, setArtist, onSubmit, loading, disabled = false, disabledMessage = null }) {
  const { preferences } = usePreferences();

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !disabled && !loading) {
      onSubmit(e);
    }
  };

  return (
    <div>
      {disabledMessage && (
        <div className={`mb-4 p-3 border rounded-xl ${
          preferences.darkMode 
            ? 'bg-gray-700 border-gray-600 text-gray-300' 
            : 'bg-gray-100 border-gray-200 text-gray-600'
        }`}>
          <p className="text-sm text-center">{disabledMessage}</p>
        </div>
      )}

      <div className="space-y-4">
        <input
          type="text"
          placeholder="Artist name"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          onKeyPress={handleKeyPress}
          className={`w-full border-2 rounded-xl p-3 focus:outline-none transition-colors ${
            disabled 
              ? preferences.darkMode
                ? 'border-gray-600 bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
              : preferences.darkMode
                ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
                : 'border-gray-200 focus:border-blue-500'
          }`}
          disabled={disabled}
        />
        <button
          type="submit"
          onClick={onSubmit}
          className={`w-full rounded-xl p-3 transition-all duration-200 font-medium ${
            disabled || loading
              ? preferences.darkMode
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700'
          }`}
          disabled={disabled || loading}
        >
          {loading ? "Searching..." : disabled ? "Configure Lidarr First" : "Browse Artist Releases"}
        </button>
      </div>
    </div>
  );
}