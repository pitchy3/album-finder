// client/src/App.jsx - Updated with BasicAuth support and re-authentication
import { useState, useEffect } from "react";
import { useAuth } from "./hooks/useAuth.js";
import { useAlbumSearch } from "./hooks/useAlbumSearch.js";
import { useArtistSearchStream } from "./hooks/useArtistSearchStream.js";
import { addToLidarr } from "./services/lidarrService.js";
import { usePreferences } from "./contexts/PreferencesContext.jsx";
import { PreferencesProvider } from "./contexts/PreferencesContext.jsx";

// Import components...
import AuthLoadingScreen from "./components/AuthLoadingScreen.jsx";
import LoginPrompt from "./components/LoginPrompt.jsx";
import UserHeader from "./components/UserHeader.jsx";
import LidarrSetupBanner from "./components/LidarrSetupBanner.jsx";
import SearchForm from "./components/SearchForm.jsx";
import ArtistSearchForm from "./components/ArtistSearchForm.jsx";
import ErrorDisplay from "./components/ErrorDisplay.jsx";
import ResultsList from "./components/ResultsList.jsx";
import ArtistResultsList from "./components/ArtistResultsList.jsx";
import ConfigPage from "./components/ConfigPage.jsx";
import LogsPage from './components/LogsPage.jsx';
import AuthConfirmationPage from './components/AuthConfirmationPage.jsx';

// Main app component that uses preferences
function AppContent() {
  const [track, setTrack] = useState("");
  const [artist, setArtist] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [currentPage, setCurrentPage] = useState("search");
  const [searchMode, setSearchMode] = useState("artist");
  const [lidarrConfigured, setLidarrConfigured] = useState(null);
  const [showHooksDemo, setShowHooksDemo] = useState(false);
  
  // Re-authentication state
  const [reauthAction, setReauthAction] = useState(null); // 'disable', 'change'
  const [reauthTargetType, setReauthTargetType] = useState(null); // 'oidc', 'basicauth'
  
  // ✅ Use preferences context instead of local state
  const { preferences } = usePreferences();
  
  const authStatus = useAuth();
  const { loading: songLoading, results: songResults, error: songError, searchAlbums, updateAlbumLidarrStatus } = useAlbumSearch();
  const { 
    loading: artistLoading, 
    results: artistResults, 
    error: artistError, 
    progress: artistProgress,
    artistStatus,
    searchArtistReleases,
    cancelSearch: cancelArtistSearch,
    updateArtistAlbumLidarrStatus 
  } = useArtistSearchStream();

  const checkLidarrConfig = async () => {
    try {
      const response = await fetch('/api/config/lidarr');
      if (response.ok) {
        const data = await response.json();
        const configured = !!(data.url && data.apiKey && data.apiKey !== '' && data.rootFolder && data.qualityProfileId);
        setLidarrConfigured(configured);
      } else {
        setLidarrConfigured(false);
      }
    } catch (error) {
      setLidarrConfigured(false);
    }
  };

  const handleSettingsClick = () => {
    setCurrentPage("config");
  };

  const handleBackToSearch = () => {
    setCurrentPage("search");
    setLidarrConfigured(null);
    checkLidarrConfig();
    
    // ✅ CLEAN SOLUTION - No localStorage manipulation or page reload needed
    // Preferences are automatically synced via context
    if (authStatus.refreshAuth) {
      authStatus.refreshAuth();
    }
  };

  const handleLogsClick = () => {
    setCurrentPage("logs");
  };

  // Handle re-authentication requests
  const handleRequestReauth = (action, targetType) => {
    setReauthAction(action);
    setReauthTargetType(targetType);
  };

  const handleReauthCancel = () => {
    setReauthAction(null);
    setReauthTargetType(null);
  };

  const handleReauthConfirm = async () => {
    // For OIDC users switching auth or disabling, force logout
    if (authStatus.user?.authType === 'oidc') {
      // Perform logout
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          credentials: 'include'
        });
        // Redirect will happen automatically
        window.location.href = '/';
      } catch (error) {
        console.error('Logout failed:', error);
        window.location.href = '/';
      }
    } else {
      // For BasicAuth, password was already verified, just proceed
      setReauthAction(null);
      setReauthTargetType(null);
      // Refresh the page to apply changes
      window.location.reload();
    }
  };

  // Show loading spinner while checking auth
  if (authStatus.loading) {
    return <AuthLoadingScreen />;
  }

  // If auth is enabled but user is not logged in, show login prompt
  if (authStatus.authEnabled && !authStatus.loggedIn) {
    return <LoginPrompt />;
  }

  const handleSongSearch = async (e) => {
    e.preventDefault();
    
    if (lidarrConfigured === null) {
      await checkLidarrConfig();
    }
    
    await searchAlbums(track, artist);
  };

  const handleArtistSearch = async (e) => {
    e.preventDefault();
    
    if (lidarrConfigured === null) {
      await checkLidarrConfig();
    }
    
    // ✅ Use preferences from context
    await searchArtistReleases(artistQuery, preferences);
  };

  const handleAddToLidarr = async (album) => {
    if (lidarrConfigured === null) {
      await checkLidarrConfig();
    }
    
    const result = await addToLidarr(album);
    if (result.success) {
      if (searchMode === "song") {
        updateAlbumLidarrStatus(album.mbid, true);
      } else {
        updateArtistAlbumLidarrStatus(album.mbid, true);
      }
    }
  };

  const currentLoading = searchMode === "song" ? songLoading : artistLoading;
  const currentResults = searchMode === "song" ? songResults : artistResults;
  const currentError = searchMode === "song" ? songError : artistError;

  // Show re-authentication page if needed
  if (reauthAction) {
    return (
      <AuthConfirmationPage
        action={reauthAction}
        targetAuthType={reauthTargetType}
        onCancel={handleReauthCancel}
        onConfirm={handleReauthConfirm}
      />
    );
  }

  return (
    <div className={`min-h-screen transition-colors ${preferences.darkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-blue-50 to-indigo-100'}`}>
      {/* Universal Header - shown on all pages */}
      <div className="p-4">
        <UserHeader
          authStatus={authStatus}
          onSettingsClick={handleSettingsClick}
          onLogsClick={handleLogsClick}
          onSearchClick={handleBackToSearch}
          currentPage={currentPage}
        />
      </div>
  
      {/* Config page */}
      {currentPage === "config" && (
        <ConfigPage onBack={handleBackToSearch} onRequestReauth={handleRequestReauth} />
      )}
  
      {/* Logs page */}
      {currentPage === "logs" && (
        <LogsPage onBack={handleBackToSearch} />
      )}
  
      {/* Search page */}
      {currentPage === "search" && (
        <div className="px-4">
          <div className={`min-h-screen p-6 ${preferences.darkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-blue-50 to-indigo-100'}`}>
            <div className="max-w-4xl mx-auto">
              {lidarrConfigured === false && (
                <LidarrSetupBanner onSettingsClick={handleSettingsClick} />
              )}
    
              {/* Search Mode Toggle */}
              <div className={`rounded-2xl shadow-xl p-6 mb-6 ${preferences.darkMode ? 'bg-gray-800' : 'bg-white'}`}>
                <div className="flex justify-center mb-4">
                  <div className={`rounded-xl p-1 flex ${preferences.darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <button
                      onClick={() => setSearchMode("artist")}
                      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                        searchMode === "artist" 
                          ? "bg-blue-500 text-white shadow-md" 
                          : preferences.darkMode 
                            ? "text-gray-300 hover:text-white"
                            : "text-gray-600 hover:text-gray-800"
                      }`}
                    >
                      🎤 Browse Artist
                    </button>
					<button
                      onClick={() => setSearchMode("song")}
                      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                        searchMode === "song" 
                          ? "bg-blue-500 text-white shadow-md" 
                          : preferences.darkMode 
                            ? "text-gray-300 hover:text-white"
                            : "text-gray-600 hover:text-gray-800"
                      }`}
                    >
                      🎵 Find by Song
                    </button>
                  </div>
                </div>
    
                {/* Conditional Search Forms */}
                {searchMode === "song" ? (
                  <div>
				    <SearchForm
                      track={track}
                      setTrack={setTrack}
                      artist={artist}
                      setArtist={setArtist}
                      onSubmit={handleSongSearch}
                      loading={songLoading}
                      showTitle={false}
                    />
					
					{/* ✅ Use preferences from context */}
					{(track || artist) && (
                      <div className={`mt-4 p-3 rounded-lg text-sm ${
                        preferences.darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-50 text-gray-600'
                      }`}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span>
                            <strong>Search settings:</strong> Top 3 matches
                          </span>
                          <span>
                            <strong>Categories:</strong> {
                              preferences.artistReleaseCategories.all ? 'All' : 
                              [
                                preferences.artistReleaseCategories.albums && 'Albums',
                                preferences.artistReleaseCategories.eps && 'EPs', 
                                preferences.artistReleaseCategories.singles && 'Singles',
                                preferences.artistReleaseCategories.other && 'Other'
                              ].filter(Boolean).join(', ')
                            }
                          </span>
                          <span>
                            Cannot change in settings
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <ArtistSearchForm
                      artist={artistQuery}
                      setArtist={setArtistQuery}
                      onSubmit={handleArtistSearch}
                      loading={artistLoading}
                    />
                    
                    {/* ✅ Use preferences from context */}
                    {artistQuery && (
                      <div className={`mt-4 p-3 rounded-lg text-sm ${
                        preferences.darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-50 text-gray-600'
                      }`}>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span>
                            <strong>Search settings:</strong> {preferences.artistReleaseLimit === 'all' ? 'All releases' : `${preferences.artistReleaseLimit} releases`}
                          </span>
                          <span>
                            <strong>Categories:</strong> {
                              preferences.artistReleaseCategories.all ? 'All' : 
                              [
                                preferences.artistReleaseCategories.albums && 'Albums',
                                preferences.artistReleaseCategories.eps && 'EPs', 
                                preferences.artistReleaseCategories.singles && 'Singles',
                                preferences.artistReleaseCategories.other && 'Other'
                              ].filter(Boolean).join(', ')
                            }
                          </span>
                          <button 
                            onClick={handleSettingsClick}
                            className={`text-xs underline ${preferences.darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                          >
                            Change in Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
    
              <ErrorDisplay error={currentError} />
              
              {/* Conditional Results Display */}
              {searchMode === "song" ? (
                <ResultsList
                  results={songResults}
                  onAddToLidarr={handleAddToLidarr}
                />
              ) : (
                <ArtistResultsList
                  results={artistResults}
                  onAddToLidarr={handleAddToLidarr}
                  progress={artistProgress}
                  artistStatus={artistStatus}
                  loading={artistLoading}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Root App component with provider
export default function App() {
  return (
    <PreferencesProvider>
      <AppContent />
    </PreferencesProvider>
  );
}