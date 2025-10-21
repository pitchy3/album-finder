// client/src/hooks/useAuth.js

import { useState, useEffect } from "react";

export function useAuth() {
  const [authStatus, setAuthStatus] = useState({
    loading: true,
    loggedIn: false,
    authEnabled: false,
    user: null
  });

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/user', {
        credentials: 'include' // Important: include cookies
      });
      
      if (response.ok) {
        const data = await response.json();
        setAuthStatus({
          loading: false,
          loggedIn: data.loggedIn,
          authEnabled: data.authEnabled,
          user: data.user || null
        });
      } else {
        // If auth status check fails, assume not logged in
        setAuthStatus({
          loading: false,
          loggedIn: false,
          authEnabled: true, // Assume auth is enabled if we can't check
          user: null
        });
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      // On error, assume auth is disabled (safe default)
      setAuthStatus({
        loading: false,
        loggedIn: false,
        authEnabled: false,
        user: null
      });
    }
  };

  // Global error handler for 401 responses
  const handleApiError = (response) => {
    if (response.status === 401 && authStatus.authEnabled) {
      console.log('Received 401, redirecting to login');
      // Redirect to login if we get a 401 and auth is enabled
      window.location.href = '/auth/login';
      return true; // Indicates we handled the error
    }
    return false; // Indicates the caller should handle the error
  };

  // Enhanced fetch wrapper that handles auth errors
  const authenticatedFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      credentials: 'include' // Always include cookies
    });

    // Check for 401 and handle appropriately
    if (response.status === 401) {
      const handled = handleApiError(response);
      if (handled) {
        // Return a rejected promise to stop further processing
        throw new Error('Authentication required - redirecting to login');
      }
    }

    return response;
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  return {
    ...authStatus,
    refreshAuth: checkAuthStatus,
    authenticatedFetch,
    handleApiError
  };
}