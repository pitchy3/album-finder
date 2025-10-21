// client/src/components/LogsPage.jsx - Updated with retry functionality and removed success banners
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Clock, User, Globe, Activity, Music, Album, Search, Plus, Database, RefreshCw } from 'lucide-react';
import { usePreferences } from "../contexts/PreferencesContext.jsx";
import { secureApiCall } from '../services/apiService.js';

// Constants
const FILTER_OPTIONS = [
  { value: 'queries', label: 'User Searches', icon: Search },
  { value: 'albums', label: 'All Albums Added', icon: Album },
  { value: 'albums-downloaded', label: 'Albums Downloaded', icon: Album },
  { value: 'albums-pending', label: 'Albums Pending', icon: Album },
  { value: 'artists', label: 'Artists Added', icon: User },
  { value: 'auth-events', label: 'Authentication Events', icon: User }
];

const ENDPOINT_MAP = {
  'auth-events': '/api/logs/auth-events',
  'artists': '/api/logs/artists',
  'albums': '/api/logs/albums',
  'albums-downloaded': '/api/logs/albums/downloaded',
  'albums-pending': '/api/logs/albums/pending',
  'queries': '/api/logs/queries'
};

const AUTH_EVENT_LABELS = {
  'login_success': '✅ Login Success',
  'login_failure': '❌ Login Failed',
  'logout': '🚪 Logout'
};

// Custom hooks
const useApi = () => {
  const handleApiResponse = useCallback(async (response, endpoint) => {
    console.log(`API Response for ${endpoint}:`, {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      url: response.url
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`API Error for ${endpoint}:`, text);
      
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        throw new Error(`Authentication required - please refresh the page and log in again`);
      }
      
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`Non-JSON response for ${endpoint}:`, text);
      throw new Error(`Server returned non-JSON response: ${contentType || 'unknown'}`);
    }

    try {
      return await response.json();
    } catch (parseError) {
      const text = await response.text();
      console.error(`JSON parse error for ${endpoint}:`, parseError, 'Response:', text);
      throw new Error(`Failed to parse server response as JSON`);
    }
  }, []);

  const apiCall = useCallback(async (endpoint) => {
    const response = await fetch(endpoint, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    return handleApiResponse(response, endpoint);
  }, [handleApiResponse]);

  return { apiCall };
};

// Utility functions
const createTimestampFormatter = (timezoneInfo) => (timestamp) => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    }
    
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezoneInfo?.timezone || 'UTC',
      timeZoneName: 'short'
    }).format(date);
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return 'Unknown time';
  }
};

const createStatusColorGetter = (darkMode) => (status, success) => {
  const colors = {
    success: darkMode ? 'bg-green-900/50 text-green-300 border-green-700' : 'bg-green-100 text-green-800 border-green-200',
    error: darkMode ? 'bg-red-900/50 text-red-300 border-red-700' : 'bg-red-100 text-red-800 border-red-200',
    warning: darkMode ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700' : 'bg-yellow-100 text-yellow-800 border-yellow-200',
    default: darkMode ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-800 border-gray-200'
  };

  if (success === false) return colors.error;
  if (status >= 200 && status < 300) return colors.success;
  if (status >= 300 && status < 400) return colors.warning;
  if (status >= 400) return colors.error;
  return colors.default;
};

const getRequestIcon = (filterType, endpoint, method) => {
  if (filterType === 'artists') return User;
  if (filterType === 'albums') return Album;
  if (filterType === 'searches' || filterType === 'user-searches') return Search;
  if (endpoint?.includes('musicbrainz')) return Database;
  if (endpoint?.includes('lidarr')) return Music;
  if (method === 'POST') return Plus;
  return Search;
};

const getAuthEventType = (log) => AUTH_EVENT_LABELS[log.event_type] || log.event_type;

const getAuthEventColor = (eventType, darkMode) => {
  const colors = {
    'login_success': darkMode ? 'bg-green-900/50 text-green-300 border-green-700' : 'bg-green-100 text-green-800 border-green-200',
    'login_failure': darkMode ? 'bg-red-900/50 text-red-300 border-red-700' : 'bg-red-100 text-red-800 border-red-200',
    'logout': darkMode ? 'bg-blue-900/50 text-blue-300 border-blue-700' : 'bg-blue-100 text-blue-800 border-blue-200',
    'default': darkMode ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-800 border-gray-200'
  };
  return colors[eventType] || colors.default;
};

// Components
const LoadingSpinner = ({ darkMode, message = "Loading..." }) => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
    <span className={`ml-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{message}</span>
  </div>
);

const EmptyState = ({ darkMode, title, description }) => (
  <div className="text-center py-12">
    <Activity className={`w-16 h-16 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
    <h3 className={`text-xl font-semibold mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{title}</h3>
    <p className={darkMode ? 'text-gray-500' : 'text-gray-500'}>{description}</p>
  </div>
);

const StatusBadge = ({ log, selectedFilter, darkMode, getStatusColor, getAuthEventType, getAuthEventColor }) => {
  const isAuthEvent = selectedFilter === 'auth-events';
  const isAlbumAddition = ['albums', 'albums-downloaded', 'albums-pending'].includes(selectedFilter);
  const isArtistAddition = selectedFilter === 'artists';

  if (isAuthEvent) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getAuthEventColor(log.event_type, darkMode)}`}>
        {getAuthEventType(log)}
      </span>
    );
  }

  // Only show failure status for album additions, hide success banners
  if (isAlbumAddition && log.success === false) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(log.response_status, log.success)}`}>
        Failed
      </span>
    );
  }

  // Show success/failed status for artist additions
  if (isArtistAddition && log.success !== undefined) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(log.response_status, log.success)}`}>
        {log.success ? 'Success' : 'Failed'}
      </span>
    );
  }

  // Show response status for queries
  if (log.response_status && !isAlbumAddition) {
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(log.response_status, log.success)}`}>
        {log.response_status}
      </span>
    );
  }

  return null;
};

const RetryButton = ({ log, onRetry, darkMode, retrying }) => {
  const canRetry = log.lidarr_album_id && (log.success !== false || !log.downloaded);
  
  if (!canRetry) return null;

  return (
    <button
      onClick={() => onRetry(log)}
      disabled={retrying}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        darkMode
          ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400'
          : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500'
      } disabled:cursor-not-allowed`}
    >
      <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
      {retrying ? 'Retrying...' : 'Retry Download'}
    </button>
  );
};

const DetailSection = ({ log, selectedFilter, darkMode, lidarrUrl, onRetry, retrying }) => {
  const isAddition = ['artists', 'albums', 'albums-downloaded', 'albums-pending'].includes(selectedFilter);
  const isAuthEvent = selectedFilter === 'auth-events';
  const isAlbumAddition = ['albums', 'albums-pending'].includes(selectedFilter);
  
  const DetailItem = ({ label, value, mono = false }) => (
    <div>
      <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{label}:</span>
      <span className={`ml-2 ${mono ? 'font-mono text-xs' : ''} ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );

  const LinkItem = ({ label, url, text, icon }) => (
    <div>
      <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{label}:</span>
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className={`ml-2 inline-flex items-center gap-1 underline hover:no-underline ${
          darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
        }`}
      >
        {text} {icon}
      </a>
    </div>
  );

  const ErrorMessage = ({ message }) => (
    <div className={`mt-3 p-2 rounded border ${
      darkMode ? 'bg-red-500/10 border-red-500/20' : 'bg-red-50 border-red-200'
    }`}>
      <span className={`text-sm ${darkMode ? 'text-red-400' : 'text-red-700'}`}>{message}</span>
    </div>
  );

  if (isAuthEvent) {
    return (
      <div className={`pt-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {log.email && <DetailItem label="Email" value={log.email} />}
          {log.oidc_subject && <DetailItem label="OIDC Subject" value={log.oidc_subject} mono />}
          {log.session_id && <DetailItem label="Session" value={`${log.session_id.substring(0, 12)}...`} mono />}
        </div>
        {log.error_message && <ErrorMessage message={log.error_message} />}
      </div>
    );
  }

  if (isAddition) {
    return (
      <div className={`pt-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-3">
          {/* MusicBrainz Link */}
          {log.album_mbid && (
            <LinkItem 
              label="MusicBrainz" 
              url={`https://musicbrainz.org/release-group/${log.album_mbid}`}
              text="View Album"
              icon="🔗"
            />
          )}
          {log.artist_mbid && !log.album_mbid && (
            <LinkItem 
              label="MusicBrainz" 
              url={`https://musicbrainz.org/artist/${log.artist_mbid}`}
              text="View Artist"
              icon="🔗"
            />
          )}
          
          {/* Lidarr Link */}
          {lidarrUrl && log.album_mbid && (
            <LinkItem 
              label="Lidarr" 
              url={`${lidarrUrl}/album/${log.album_mbid}`}
              text="View Album"
              icon="💿"
            />
          )}
          {lidarrUrl && log.artist_mbid && !log.album_mbid && (
            <LinkItem 
              label="Lidarr" 
              url={`${lidarrUrl}/artist/${log.artist_mbid}`}
              text="View Artist"
              icon="🎤"
            />
          )}
          
          {log.monitored !== undefined && (
            <div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Monitored:</span>
              <span className={`ml-2 ${log.monitored ? 'text-green-400' : 'text-red-400'}`}>
                {log.monitored ? 'Yes' : 'No'}
              </span>
            </div>
          )}
          {log.downloaded !== undefined && (
            <div>
              <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>Downloaded:</span>
              <span className={`ml-2 ${log.downloaded ? 'text-green-400' : 'text-red-400'}`}>
                {log.downloaded ? 'Yes' : 'No'}
              </span>
            </div>
          )}
        </div>

        {/* Retry Button for Albums */}
        {(isAlbumAddition && !log.downloaded) && (
          <div className="flex items-center justify-between">
            <div className="flex-grow">
              {log.error_message && <ErrorMessage message={log.error_message} />}
            </div>
            <div className="ml-4">
              <RetryButton log={log} onRetry={onRetry} darkMode={darkMode} retrying={retrying} />
            </div>
          </div>
        )}

        {/* Error message for non-album additions */}
        {!isAlbumAddition && log.error_message && <ErrorMessage message={log.error_message} />}
      </div>
    );
  }

  if (selectedFilter === 'queries' && (log.artist || log.album || log.search_term)) {
    return (
      <div className={`pt-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {log.search_term && <DetailItem label="Search Term" value={log.displaySearchTerm || log.search_term} />}
          {log.artist && <DetailItem label="Artist" value={log.displayArtist || log.artist} />}
        </div>
      </div>
    );
  }

  return null;
};

const LogCard = ({ log, index, selectedFilter, darkMode, formatTimestamp, getStatusColor, Icon, lidarrUrl, onRetry, retryingItems }) => {
  const isAddition = ['artists', 'albums', 'albums-downloaded', 'albums-pending'].includes(selectedFilter);
  const isAuthEvent = selectedFilter === 'auth-events';
  const retrying = retryingItems.has(log.id);

  const getTitle = () => {
    if (isAuthEvent) {
      return `${log.username || log.user_id || 'Unknown User'} - ${getAuthEventType(log)}`;
    }
    if (isAddition) {
      return selectedFilter === 'artists' ? log.artist_name : log.album_title;
    }
    if (selectedFilter === 'queries') {
      return log.displayTitle;
    }
    return log.search_term || log.artist || log.album || 'Search Query';
  };

  const getSubtitle = () => {
    if (isAuthEvent) return log.email || 'Authentication Event';
    if (isAddition) return selectedFilter === 'artists' ? 'Artist Addition' : `by ${log.artist_name}`;
    return 'MusicBrainz Recording Search';
  };

  return (
    <div key={log.id || index} className={`rounded-xl p-6 transition-colors ${
      darkMode ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-gray-50'
    } shadow-lg`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${darkMode ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
            <Icon className={`w-5 h-5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          </div>
          <div>
            <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {getTitle()}
            </h3>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {getSubtitle()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <StatusBadge 
            log={log} 
            selectedFilter={selectedFilter} 
            darkMode={darkMode}
            getStatusColor={getStatusColor}
            getAuthEventType={getAuthEventType}
            getAuthEventColor={getAuthEventColor}
          />
          
          {log.cache_hit === 1 && selectedFilter === 'queries' && (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'
            }`}>
              Cached
            </span>
          )}
        </div>
      </div>

      {/* Request Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className={`flex items-center space-x-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <Calendar className="w-4 h-4" />
          <span>{formatTimestamp(log.timestamp)}</span>
        </div>
        
        <div className={`flex items-center space-x-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <User className="w-4 h-4" />
          <span>{log.username || log.user_id || 'Anonymous'}</span>
        </div>

        {log.response_time_ms && selectedFilter === 'queries' && (
          <div className={`flex items-center space-x-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <Clock className="w-4 h-4" />
            <span>{log.response_time_ms}ms</span>
          </div>
        )}

        {log.ip_address && (
          <div className={`flex items-center space-x-2 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <Globe className="w-4 h-4" />
            <span>{log.ip_address}</span>
          </div>
        )}
      </div>

      <DetailSection 
        log={log} 
        selectedFilter={selectedFilter} 
        darkMode={darkMode} 
        lidarrUrl={lidarrUrl} 
        onRetry={onRetry}
        retrying={retrying}
      />
    </div>
  );
};

const Pagination = ({ pagination, page, setPage, darkMode }) => {
  if (!pagination || pagination.pages <= 1) return null;

  return (
    <div className="flex items-center justify-center space-x-4">
      <button
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page === 1}
        className={`px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
          darkMode 
            ? 'bg-gray-700 text-white hover:bg-gray-600'
            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
        }`}
      >
        Previous
      </button>
      
      <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
        Page {page} of {pagination.pages} ({pagination.total} total)
      </span>
      
      <button
        onClick={() => setPage(Math.min(pagination.pages, page + 1))}
        disabled={page === pagination.pages}
        className={`px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
          darkMode 
            ? 'bg-gray-700 text-white hover:bg-gray-600'
            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
        }`}
      >
        Next
      </button>
    </div>
  );
};

// Main component
const LogsPage = ({ onBack }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('queries');
  const [sortBy, setSortBy] = useState('timestamp');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [timezoneInfo, setTimezoneInfo] = useState(null);
  const [lidarrUrl, setLidarrUrl] = useState(null);
  const [retryingItems, setRetryingItems] = useState(new Set());
  
  const { preferences } = usePreferences();
  const { apiCall } = useApi();

  // Memoized utility functions
  const formatTimestamp = useMemo(() => createTimestampFormatter(timezoneInfo), [timezoneInfo]);
  const getStatusColor = useMemo(() => createStatusColorGetter(preferences.darkMode), [preferences.darkMode]);

  // Load data functions
  const loadTimezoneInfo = useCallback(async () => {
    try {
      const data = await apiCall('/api/timezone-info');
      setTimezoneInfo(data);
    } catch (err) {
      console.error('Error loading timezone info:', err);
    }
  }, [apiCall]);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = ENDPOINT_MAP[selectedFilter] || ENDPOINT_MAP.queries;
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        days: '30'
      });

      const fullUrl = `${endpoint}?${params}`;
      console.log('Loading logs from:', fullUrl);

      const data = await apiCall(fullUrl);
      
      const processedLogs = (data.logs || []).map(log => ({
        ...log,
        displaySearchTerm: log.search_term,
        displayArtist: log.artist,
        displayTitle: log.search_term && log.artist
          ? `${log.search_term} by ${log.artist}`
          : log.artist
            ? `Artist Search: ${log.artist}`
            : (log.search_term || log.album || 'Search Query')
      }));
      
      setLogs(processedLogs);
      setPagination(data.pagination);
    } catch (err) {
      console.error('Error loading logs:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedFilter, page, apiCall]);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiCall('/api/logs/stats');
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, [apiCall]);

  const loadLidarrUrl = useCallback(async () => {
    try {
      const data = await apiCall('/api/config/lidarr');
      setLidarrUrl(data.url);
    } catch (err) {
      console.error('Error loading Lidarr URL:', err);
      // Don't show error to user, just log it
    }
  }, [apiCall]);

  // Retry download function
  const handleRetryDownload = useCallback(async (log) => {
    if (retryingItems.has(log.id)) return; // Prevent double-clicks
    
    setRetryingItems(prev => new Set(prev).add(log.id));
    
    try {
      console.log('Retrying album download for:', log);
      
      const response = await secureApiCall('/api/lidarr/retry-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          logId: log.id,
          albumTitle: log.album_title,
          artistName: log.artist_name,
          albumMbid: log.album_mbid,
          lidarrAlbumId: log.lidarr_album_id
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Retry successful:', result);
        
        // Show success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: fixed; top: 20px; right: 20px; z-index: 10000;
          background: #efe; border: 2px solid #cfc; border-radius: 8px;
          padding: 16px; max-width: 400px; font-family: sans-serif;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        notification.innerHTML = `
          <h4 style="margin: 0 0 8px 0; color: #060;">Download Retry Triggered!</h4>
          <p style="margin: 4px 0;">"${log.album_title}" download has been triggered in Lidarr</p>
          <button onclick="this.parentElement.remove()" style="margin-top: 8px; padding: 4px 8px; background: #060; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
          if (notification.parentElement) {
            notification.remove();
          }
        }, 5000);
        
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Retry failed');
      }
      
    } catch (err) {
      console.error('Error retrying download:', err);
      
      // Show error notification
      const errorNotification = document.createElement('div');
      errorNotification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        background: #fee; border: 2px solid #fcc; border-radius: 8px;
        padding: 16px; max-width: 400px; font-family: monospace;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      `;
      errorNotification.innerHTML = `
        <h4 style="margin: 0 0 8px 0; color: #c00;">Download Retry Failed</h4>
        <p style="margin: 4px 0;">${err.message}</p>
        <button onclick="this.parentElement.remove()" style="margin-top: 8px; padding: 4px 8px; background: #c00; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      `;
      document.body.appendChild(errorNotification);
      
      setTimeout(() => {
        if (errorNotification.parentElement) {
          errorNotification.remove();
        }
      }, 10000);
    } finally {
      setRetryingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(log.id);
        return newSet;
      });
    }
  }, [retryingItems]);

  useEffect(() => {
    loadLogs();
    loadStats();
    loadTimezoneInfo();
    loadLidarrUrl();
  }, [selectedFilter, page, sortBy, loadLogs, loadStats, loadTimezoneInfo, loadLidarrUrl]);

  const handleFilterChange = useCallback((newFilter) => {
    setSelectedFilter(newFilter);
    setPage(1);
  }, []);

  return (
    <div className={`min-h-screen p-6 transition-colors ${preferences.darkMode ? 'bg-gray-900 text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-100 text-gray-900'}`}>
      <div className="max-w-4xl mx-auto">
        {/* Header Card */}
        <div className={`rounded-2xl shadow-xl p-6 mb-6 ${preferences.darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className={`text-3xl font-bold ${preferences.darkMode ? 'text-white' : 'text-gray-900'}`}>Activity Logs</h1>
            </div>

            {/* Stats */}
            {stats && (
              <div className="flex items-center space-x-6 text-sm">
                <div className="text-center">
                  <div className={`text-xl font-bold ${preferences.darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{stats.totalQueries || 0}</div>
                  <div className={preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}>Recording Searches</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${preferences.darkMode ? 'text-green-400' : 'text-green-600'}`}>{stats.totalArtists || 0}</div>
                  <div className={preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}>Artists Added</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${preferences.darkMode ? 'text-purple-400' : 'text-purple-600'}`}>{stats.totalAlbums || 0}</div>
                  <div className={preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}>Albums Added</div>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* Filter Dropdown */}
              <div className="relative">
                <select
                  value={selectedFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className={`rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-8 ${
                    preferences.darkMode
                      ? 'bg-gray-700 border border-gray-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-900'
                  }`}
                >
                  {FILTER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className={`w-4 h-4 ${preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Sort Dropdown */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-8 ${
                    preferences.darkMode
                      ? 'bg-gray-700 border border-gray-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-900'
                  }`}
                >
                  <option value="timestamp">Most Recent</option>
                  <option value="response_time">Response Time</option>
                  <option value="user_id">User</option>
                </select>
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none">
                  <svg className={`w-4 h-4 ${preferences.darkMode ? 'text-gray-400' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Card */}
        <div className={`rounded-2xl shadow-xl p-6 ${preferences.darkMode ? 'bg-gray-800 text-white' : 'bg-white'}`}>
          {/* Error */}
          {error && (
            <div className={`rounded-lg p-4 mb-6 border ${
              preferences.darkMode 
                ? 'bg-red-500/10 border-red-500/20' 
                : 'bg-red-50 border-red-200'
            }`}>
              <p className={preferences.darkMode ? 'text-red-400' : 'text-red-700'}>Error loading logs: {error}</p>
              <button 
                onClick={loadLogs}
                className={`mt-2 px-4 py-2 rounded transition-colors ${
                  preferences.darkMode 
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-red-500 text-white hover:bg-red-600'
                }`}
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading / Empty / Logs */}
          {loading ? (
            <LoadingSpinner darkMode={preferences.darkMode} message="Loading logs..." />
          ) : logs.length === 0 ? (
            <EmptyState 
              darkMode={preferences.darkMode} 
              title="No logs found" 
              description="No activity matches your current filter criteria." 
            />
          ) : (
            <>
              {/* Logs Grid */}
              <div className="space-y-4 mb-8">
                {logs.map((log, index) => (
                  <LogCard
                    key={log.id || index}
                    log={log}
                    index={index}
                    selectedFilter={selectedFilter}
                    darkMode={preferences.darkMode}
                    formatTimestamp={formatTimestamp}
                    getStatusColor={getStatusColor}
                    Icon={getRequestIcon(selectedFilter, log.endpoint, log.method)}
                    lidarrUrl={lidarrUrl}
                    onRetry={handleRetryDownload}
                    retryingItems={retryingItems}
                  />
                ))}
              </div>

              <Pagination 
                pagination={pagination} 
                page={page} 
                setPage={setPage} 
                darkMode={preferences.darkMode} 
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogsPage;
