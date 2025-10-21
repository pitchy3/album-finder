// client/src/components/UserHeader.jsx - Fixed transition lag on dark mode toggle

import { useState, useEffect } from 'react';
import { secureApiCall } from '../services/apiService.js';
import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function UserHeader({ authStatus, onSettingsClick, onLogsClick, onSearchClick, currentPage }) {
  const { preferences } = usePreferences();
  const [csrfToken, setCsrfToken] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  useEffect(() => {
    // Get CSRF token when user is logged in
    if (authStatus.user) {
      loadCsrfToken();
    }
  }, [authStatus.user]);

  const loadCsrfToken = async () => {
    try {
      const response = await fetch('/api/csrf-token', { 
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCsrfToken(data.csrfToken);
      } else {
        console.error('Failed to get CSRF token:', response.status);
      }
    } catch (error) {
      console.error('Error loading CSRF token:', error);
    }
  };
  
  const handleLogout = async (e) => {
    e.preventDefault();
    
    if (isLoggingOut) return; // Prevent double-clicks
    setIsLoggingOut(true);
    
    try {
      // Ensure we have a CSRF token
      let tokenToUse = csrfToken;
      if (!tokenToUse) {
        console.log('No CSRF token available, fetching...');
        await loadCsrfToken();
        tokenToUse = csrfToken;
      }
      
      if (!tokenToUse) {
        console.error('Could not obtain CSRF token');
        // Still try the logout without token as fallback
      }

      console.log('Attempting logout with CSRF protection...');
      
      // Use secureApiCall which handles CSRF tokens properly
      const response = await secureApiCall('/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Logout response status:', response.status);
      
      // Handle successful logout or redirect
      if (response.ok || response.redirected) {
        console.log('Logout successful, redirecting...');
        window.location.href = '/';
      } else if (response.status === 302) {
        // Handle redirect response
        console.log('Logout redirect received');
        window.location.href = '/';
      } else {
        // Try to get error details
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('Logout failed:', response.status, errorText);
        
        // Even if logout "failed", redirect to home page as fallback
        // This handles cases where the server redirects but the fetch sees it as an error
        setTimeout(() => {
          window.location.href = '/';
        }, 1000);
      }
    } catch (error) {
      console.error('Logout error:', error);
      
      // Check if this is a CSRF error specifically
      if (error.message && error.message.includes('CSRF')) {
        console.log('CSRF error detected, trying to refresh token and retry...');
        try {
          await loadCsrfToken();
          // Could implement retry logic here, but for now just redirect
          window.location.href = '/';
        } catch (retryError) {
          console.error('Retry failed:', retryError);
          window.location.href = '/';
        }
      } else {
        // For other errors, still redirect to home as fallback
        window.location.href = '/';
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Navigation button helper - REMOVED transition-colors
  const NavButton = ({ onClick, isActive, children, icon, disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-3 py-1 rounded-lg ${
        isActive
          ? preferences.darkMode
            ? 'bg-blue-600 text-white'
            : 'bg-blue-500 text-white'
          : preferences.darkMode 
            ? 'text-gray-300 hover:text-white hover:bg-gray-700'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {icon} {children}
    </button>
  );

  return (
    <div
      className={`mb-4 text-sm relative flex flex-row items-center justify-between ${
        preferences.darkMode ? "text-gray-300" : "text-gray-600"
      }`}
    >
      {/* Left: User Info */}
      <div className="flex items-center gap-2">
        <span>
          {authStatus.user ? (
            <>
              <strong
                className={
                  preferences.darkMode ? "text-white" : "text-gray-800"
                }
              >
                {" "}
              </strong>
            </>
          ) : authStatus.authEnabled ? (
            <span
              className={
                preferences.darkMode
                  ? "text-orange-400"
                  : "text-orange-600"
              }
            >
              Authentication enabled - not logged in
            </span>
          ) : (
            <span
              className={
                preferences.darkMode
                  ? "text-yellow-400"
                  : "text-yellow-600"
              }
            >
              Authentication disabled
            </span>
          )}
        </span>
      </div>

      {/* Center: Navigation */}
      <div className="absolute left-1/2 -translate-x-1/2 flex gap-4">
        <NavButton
          onClick={onSearchClick}
          isActive={currentPage === "search"}
          icon="🔍"
        />
        <NavButton
          onClick={onLogsClick}
          isActive={currentPage === "logs"}
          icon="📊"
        />
        <NavButton
          onClick={onSettingsClick}
          isActive={currentPage === "config"}
          icon="⚙️"
        />
      </div>

      {/* Right: Logout Icon */}
      <div className="flex items-center">
        {authStatus.authEnabled && authStatus.user && (
          <NavButton
            onClick={handleLogout}
            disabled={isLoggingOut}
            icon="⏏"
          />
        )}
      </div>
    </div>
  );
}