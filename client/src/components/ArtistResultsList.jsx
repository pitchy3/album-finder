import AlbumCard from './AlbumCard.jsx';
import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function ArtistResultsList({ results, onAddToLidarr, progress, artistStatus, loading }) {
  const { preferences } = usePreferences();

  // Group results by type
  const groupedResults = results.reduce((acc, album) => {
    const type = album.releaseType || 'unknown';
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(album);
    return acc;
  }, {});

  const typeLabels = {
    'album': '💿 Albums',
    'ep': '🎵 EPs',
    'single': '🎤 Singles',
    'unknown': '❓ Other Releases'
  };

  const typeOrder = ['album', 'ep', 'single', 'unknown'];

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      {loading && (
        <div className={`rounded-xl p-4 ${
          preferences.darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`font-medium ${preferences.darkMode ? 'text-blue-300' : 'text-blue-700'}`}>
              Loading releases...
            </span>
            <span className={`text-sm ${preferences.darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
              {progress.loaded} / {progress.total || '?'}
            </span>
          </div>
          
          {/* Progress bar */}
          {progress.total > 0 && (
            <div className={`w-full h-2 rounded-full overflow-hidden ${
              preferences.darkMode ? 'bg-gray-700' : 'bg-gray-200'
            }`}>
              <div 
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
              />
            </div>
          )}
          
          {/* Artist status message */}
          {artistStatus && (
            <p className={`text-xs mt-2 ${preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {artistStatus.message}
            </p>
          )}
        </div>
      )}
      
      {/* Results header */}
      {results.length > 0 && (
        <div className="flex items-center justify-between">
          <h2 className={`text-2xl font-bold ${preferences.darkMode ? 'text-white' : 'text-gray-800'}`}>
            {results.length} Release{results.length > 1 ? 's' : ''} Found
            {loading && ' (loading more...)'}
          </h2>
        </div>
      )}
      
      {/* Grouped results */}
      {typeOrder.map(type => {
        const albumsOfType = groupedResults[type];
        if (!albumsOfType || albumsOfType.length === 0) return null;

        return (
          <div key={type} className="space-y-4">
            <h3 className={`text-lg font-semibold pb-2 ${
              preferences.darkMode 
                ? 'text-gray-300 border-b border-gray-700' 
                : 'text-gray-700 border-b border-gray-200'
            }`}>
              {typeLabels[type]} ({albumsOfType.length})
            </h3>
            
            {albumsOfType.map((album, index) => (
              <AlbumCard
                key={album.mbid}
                album={album}
                index={index}
                onAddToLidarr={onAddToLidarr}
                showMatchScore={false}
              />
            ))}
          </div>
        );
      })}
      
      {/* Loading indicator at bottom */}
      {loading && results.length > 0 && (
        <div className="text-center py-8">
          <div className="inline-flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className={preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}>
              Loading more releases...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}