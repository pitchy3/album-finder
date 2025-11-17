// client/src/components/AlbumCard.jsx

import { useState } from 'react';
import RootFolderModal from './RootFolderModal.jsx';

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function AlbumCard({ 
  album, 
  index, 
  onAddToLidarr, 
  showMatchScore = true,
  artistInLidarr = false
  }) {
  const { preferences } = usePreferences();
  const [showRootFolderModal, setShowRootFolderModal] = useState(false);

  const getReleaseTypeStyle = (releaseType) => {
    const baseStyles = {
      'album': preferences.darkMode ? 'bg-green-800/50 text-green-300 border-green-600' : 'bg-green-100 text-green-800',
      'single': preferences.darkMode ? 'bg-yellow-800/50 text-yellow-300 border-yellow-600' : 'bg-yellow-100 text-yellow-800',
      'ep': preferences.darkMode ? 'bg-orange-800/50 text-orange-300 border-orange-600' : 'bg-orange-100 text-orange-800',
      'compilation': preferences.darkMode ? 'bg-purple-800/50 text-purple-300 border-purple-600' : 'bg-purple-100 text-purple-800',
      'default': preferences.darkMode ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-800'
    };
    return baseStyles[releaseType] || baseStyles.default;
  };

  const isFullyDownloaded = album.inLidarr && album.fullyAvailable && album.percentComplete===100;

  const formatReleaseDate = (dateString) => {
    if (!dateString) return null;
    try {
      if (dateString.length === 4) {
        return dateString;
      } else if (dateString.length === 7) {
        const [year, month] = dateString.split('-');
        return new Date(year, month - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      } else {
        return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch (e) {
      return dateString;
    }
  };
  
  const handleAddClick = () => {  
    // Check if album is already in Lidarr
    if (isFullyDownloaded) {
      return; // Button should be disabled, but extra safety
    }
    
    if (artistInLidarr) {
      console.log('🎵 Artist exists in Lidarr - adding album directly (no modal)');
      console.log('  - Calling onAddToLidarr with null rootFolder');
      onAddToLidarr(album, null);
    } else {
      console.log('📁 New artist - showing root folder selection modal');
      setShowRootFolderModal(true);
    }
  };
  
  const handleRootFolderConfirm = async (album, rootFolder) => {
    setShowRootFolderModal(false);
    // Pass root folder to parent handler
    await onAddToLidarr(album, rootFolder);
  };

  const handleRootFolderCancel = () => {
    setShowRootFolderModal(false);
  };
  
  const getButtonState = () => {
	
    if (!album.inLidarr) {
      return {
        text: '➕ Add to Lidarr',
        disabled: false,
        className: 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 hover:shadow-lg'
      };
    }
    
    if (false) {
      return {
        text: '⏳ Added to Lidarr (Downloading...)',
        disabled: true,
        className: preferences.darkMode
          ? 'bg-yellow-700 text-yellow-300 cursor-not-allowed'
          : 'bg-yellow-200 text-yellow-800 cursor-not-allowed'
      };
    }
    
    if (album.inLidarr && album.fullyAvailable && album.percentComplete===100) {
      return {
        text: '✅ In Lidarr (Complete)',
        disabled: true,
        className: preferences.darkMode
          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
          : 'bg-gray-200 text-gray-500 cursor-not-allowed'
      };
    }
    
    return {
      text: '➕ Add to Lidarr',
      disabled: false,
      className: 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 hover:shadow-lg'
    };
  };

  return (
    <div className={`rounded-2xl shadow-lg p-6 transition-all duration-200 ${
      preferences.darkMode 
        ? 'bg-gray-800 hover:bg-gray-750 border border-gray-700' 
        : 'bg-white hover:shadow-xl'
    }`}>
      <div className="flex flex-col md:flex-row gap-6">
        {/* Album Cover */}
        <div className="flex-shrink-0">
          {album.coverUrl ? (
            <img
              src={album.coverUrl}
              alt={`${album.title} cover`}
              className="w-48 h-48 object-cover rounded-xl shadow-md mx-auto md:mx-0"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          ) : (
            <div className={`w-48 h-48 rounded-xl flex items-center justify-center mx-auto md:mx-0 ${
              preferences.darkMode 
                ? 'bg-gradient-to-br from-gray-700 to-gray-800' 
                : 'bg-gradient-to-br from-gray-200 to-gray-300'
            }`}>
              <span className={`text-4xl ${preferences.darkMode ? 'text-gray-500' : 'text-gray-500'}`}>🎵</span>
            </div>
          )}
        </div>

        {/* Album Info */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {showMatchScore && (
                <>
                  <span className={`text-sm font-medium px-2 py-1 rounded-full ${
                    preferences.darkMode ? 'bg-blue-800/50 text-blue-300' : 'bg-blue-100 text-blue-800'
                  }`}>
                    #{index + 1}
                  </span>
                  <span className={`text-sm ${preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Match: {Math.round(album.score * 100)}%
                  </span>
                </>
              )}
              {album.releaseType && (
                <span className={`text-xs font-medium px-2 py-1 rounded-full border ${getReleaseTypeStyle(album.releaseType)}`}>
                  {album.releaseType.toUpperCase()}
                </span>
              )}
              {album.releaseDate && (
                <span className={`text-xs px-2 py-1 rounded-full ${
                  preferences.darkMode 
                    ? 'text-gray-400 bg-gray-700' 
                    : 'text-gray-500 bg-gray-50'
                }`}>
                  {formatReleaseDate(album.releaseDate)}
                </span>
              )}
            </div>
            
            <h3 className={`text-xl font-bold mb-2 ${preferences.darkMode ? 'text-white' : 'text-gray-800'}`}>
              {album.title}
            </h3>
            <p className={`text-lg mb-3 ${preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {album.artist}
            </p>
            
            <div className={`text-sm space-y-1 ${preferences.darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <p><strong>MusicBrainz ID:</strong> {album.mbid}</p>
              {isFullyDownloaded && (
                <p className={`font-medium ${preferences.darkMode ? 'text-green-400' : 'text-green-600'}`}>
                  ✅ Already in Lidarr
                </p>
              )}
              {album.secondaryTypes && album.secondaryTypes.length > 0 && (
                <p><strong>Tags:</strong> {album.secondaryTypes.join(', ')}</p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex gap-3">
            {(() => {
              const buttonState = getButtonState();
              return (
                <button
                  onClick={handleAddClick}
                  disabled={buttonState.disabled}
                  className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${buttonState.className}`}
                >
                  {buttonState.text}
                </button>
              );
            })()}
            
            <a
              href={`https://musicbrainz.org/release-group/${album.mbid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-blue-700 transition-all duration-200 hover:shadow-lg"
            >
              🔗 View on MusicBrainz
            </a>
          </div>
		  
		  <RootFolderModal
            album={album}
            isOpen={showRootFolderModal}
            onConfirm={handleRootFolderConfirm}
            onCancel={handleRootFolderCancel}
          />
          
        </div>
      </div>
    </div>
  );
}
