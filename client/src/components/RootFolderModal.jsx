import { useState, useEffect } from 'react';
import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function RootFolderModal({ 
  album, 
  onConfirm, 
  onCancel, 
  isOpen 
}) {
  const { preferences } = usePreferences();
  const [rootFolders, setRootFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadRootFolders();
    }
  }, [isOpen]);

  const loadRootFolders = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/config/lidarr/rootfolders', {  // ✅ Updated endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ useSavedApiKey: true })  // ✅ Use saved credentials
      });
      
      if (!response.ok) {
        throw new Error('Failed to load root folders');
      }
      
      const folders = await response.json();
      setRootFolders(folders.rootFolders);  // ✅ Extract from response object
      
      // Pre-select default folder
      const defaultFolder = folders.find(f => f.isDefault);
      if (defaultFolder) {
        setSelectedFolder(defaultFolder.path);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return 'N/A';
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(1)} GB`;
  };

  const handleConfirm = () => {
    if (selectedFolder) {
      onConfirm(album, selectedFolder);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`max-w-2xl w-full rounded-2xl shadow-2xl p-6 ${
        preferences.darkMode ? 'bg-gray-800' : 'bg-white'
      }`}>
        <h3 className={`text-xl font-bold mb-4 ${
          preferences.darkMode ? 'text-white' : 'text-gray-800'
        }`}>
          📁 Select Root Folder
        </h3>
        
        <p className={`mb-4 text-sm ${
          preferences.darkMode ? 'text-gray-300' : 'text-gray-600'
        }`}>
          Choose where to store <strong>{album.title}</strong> by <strong>{album.artist}</strong>
        </p>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className={`p-4 rounded-xl mb-4 ${
            preferences.darkMode 
              ? 'bg-red-900/50 text-red-300 border border-red-700' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
            {rootFolders.map((folder) => (
              <button
                key={folder.path}
                onClick={() => setSelectedFolder(folder.path)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                  selectedFolder === folder.path
                    ? preferences.darkMode
                      ? 'border-blue-500 bg-blue-900/30'
                      : 'border-blue-500 bg-blue-50'
                    : preferences.darkMode
                      ? 'border-gray-600 hover:border-gray-500'
                      : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm ${
                        preferences.darkMode ? 'text-blue-300' : 'text-blue-700'
                      }`}>
                        {folder.path}
                      </span>
                      {folder.isDefault && (
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          preferences.darkMode
                            ? 'bg-green-800/50 text-green-300'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          Default
                        </span>
                      )}
                    </div>
                    
                    <div className={`text-xs mt-1 ${
                      preferences.darkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      Free: {formatBytes(folder.freeSpace)} / Total: {formatBytes(folder.totalSpace)}
                    </div>
                  </div>
                  
                  {selectedFolder === folder.path && (
                    <div className="ml-3">
                      <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className={`flex-1 px-6 py-3 rounded-xl font-medium transition-all ${
              preferences.darkMode
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Cancel
          </button>
          
          <button
            onClick={handleConfirm}
            disabled={!selectedFolder || loading}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Add to Lidarr
          </button>
        </div>
      </div>
    </div>
  );
}