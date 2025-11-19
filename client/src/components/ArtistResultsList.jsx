// client/src/components/ArtistResultsList.jsx
import { useState } from 'react';
import AlbumCard from './AlbumCard.jsx';
import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function ArtistResultsList({ results, onAddToLidarr, progress, artistStatus, loading }) {
  const { preferences } = usePreferences();
  
  // Track which sections are expanded (all expanded by default)
  const [expandedSections, setExpandedSections] = useState({
    album: true,
    ep: true,
    single: true,
    unknown: true
  });

  // Toggle section expansion
  const toggleSection = (type) => {
    setExpandedSections(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

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
          
          {/* Expand/Collapse All button */}
          <button
            onClick={() => {
              const allExpanded = Object.values(expandedSections).every(v => v);
              const newState = typeOrder.reduce((acc, type) => {
                acc[type] = !allExpanded;
                return acc;
              }, {});
              setExpandedSections(newState);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              preferences.darkMode
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {Object.values(expandedSections).every(v => v) ? '🔽 Collapse All' : '▶️ Expand All'}
          </button>
        </div>
      )}
      
      {/* Grouped results with collapsible sections */}
      {typeOrder.map(type => {
        const albumsOfType = groupedResults[type];
        if (!albumsOfType || albumsOfType.length === 0) return null;

        const isExpanded = expandedSections[type];
        const downloadedCount = albumsOfType.filter(a => a.inLidarr && a.fullyAvailable && a.percentComplete === 100).length;
        const inLibraryCount = albumsOfType.filter(a => a.inLidarr).length;

        return (
          <div key={type} className="space-y-4">
            {/* Section Header - Collapsible */}
            <button
              onClick={() => toggleSection(type)}
              className={`w-full flex items-center justify-between p-4 rounded-xl transition-all ${
                preferences.darkMode 
                  ? 'bg-gray-800 hover:bg-gray-750 border border-gray-700' 
                  : 'bg-white hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">
                  {isExpanded ? '🔽' : '▶️'}
                </span>
                <h3 className={`text-lg font-semibold ${
                  preferences.darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {typeLabels[type]}
                </h3>
                <span className={`text-sm px-3 py-1 rounded-full ${
                  preferences.darkMode
                    ? 'bg-blue-900/50 text-blue-300'
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {albumsOfType.length}
                </span>
                {inLibraryCount > 0 && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    preferences.darkMode
                      ? 'bg-green-900/50 text-green-300'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {downloadedCount}/{inLibraryCount} in library
                  </span>
                )}
              </div>
              
              <div className={`text-sm ${
                preferences.darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                {isExpanded ? 'Click to collapse' : 'Click to expand'}
              </div>
            </button>
            
            {/* Albums List - Only show when expanded */}
            {isExpanded && (
              <div className="space-y-4 pl-4">
                {albumsOfType.map((album, index) => (
                  <AlbumCard
                    key={album.mbid}
                    album={album}
                    index={index}
                    onAddToLidarr={onAddToLidarr}
                    showMatchScore={false}
                    artistInLidarr={artistStatus?.artistInLidarr || false}
                  />
                ))}
              </div>
            )}
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
