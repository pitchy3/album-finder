// client/src/components/LoginPrompt.jsx - Updated with auto-detection
import { useState, useEffect } from 'react';
import { usePreferences } from "../contexts/PreferencesContext.jsx";
import { secureApiCall } from '../services/apiService.js';

export default function LoginPrompt() {
  const { preferences } = usePreferences();
  const [authType, setAuthType] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Auto-detect auth type
    const detectAuthType = async () => {
      try {
        const response = await fetch('/api/auth/user', { credentials: 'include' });
        const data = await response.json();
        setAuthType(data.authType);
      } catch (err) {
        console.error('Failed to detect auth type:', err);
      }
    };
    detectAuthType();
  }, []);

  const handleOIDCLogin = () => {
    window.location.href = '/auth/login';
  };

  const handleBasicAuthLogin = async (e) => {
    e.preventDefault();
    
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }
  
    setLoading(true);
    setError(null);
  
    try {
      const response = await secureApiCall('/auth/login/basicauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
  
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }
  
      const data = await response.json();
      
      if (data.success) {
        // Verify session before redirecting
        console.log('Login successful, verifying session...');
        
        // Small delay to ensure session is set
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verify session is actually set
        try {
          const verifyResponse = await fetch('/api/auth/user', { 
            credentials: 'include' 
          });
          const verifyData = await verifyResponse.json();
          
          if (verifyData.loggedIn) {
            console.log('Session verified, redirecting...');
            window.location.href = '/';
          } else {
            throw new Error('Session not established');
          }
        } catch (verifyError) {
          console.error('Session verification failed:', verifyError);
          setError('Login succeeded but session failed. Please try again.');
          setLoading(false);
        }
      } else {
        setError('Login failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
      setLoading(false);
    }
  };

  if (authType === null) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-6 transition-colors ${
        preferences.darkMode 
          ? 'bg-gray-900' 
          : 'bg-gradient-to-br from-blue-50 to-indigo-100'
      }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className={preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex items-center justify-center p-6 transition-colors ${
      preferences.darkMode 
        ? 'bg-gray-900' 
        : 'bg-gradient-to-br from-blue-50 to-indigo-100'
    }`}>
      <div className={`rounded-2xl shadow-xl p-8 max-w-md w-full text-center ${
        preferences.darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'
      }`}>
        <h1 className={`text-2xl font-bold mb-4 ${preferences.darkMode ? 'text-white' : 'text-gray-800'}`}>
          🎵 Album Finder
        </h1>
        
        <h2 className={`text-xl font-semibold mb-2 ${preferences.darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
          Authentication Required
        </h2>
        
        <p className={`mb-6 ${preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          You need to log in to access the application.
        </p>

        {/* OIDC Login */}
        {authType === 'oidc' && (
          <button
            onClick={handleOIDCLogin}
            className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl px-6 py-3 hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium"
          >
            Sign In with SSO
          </button>
        )}

        {/* BasicAuth Login */}
        {authType === 'basicauth' && (
          <form onSubmit={handleBasicAuthLogin} className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className={`w-full border-2 rounded-xl p-3 focus:outline-none transition-colors ${
                preferences.darkMode
                  ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
                  : 'border-gray-200 bg-white focus:border-blue-500'
              }`}
            />
            
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={`w-full border-2 rounded-xl p-3 focus:outline-none transition-colors ${
                preferences.darkMode
                  ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
                  : 'border-gray-200 bg-white focus:border-blue-500'
              }`}
            />

            {error && (
              <div className={`p-3 rounded-xl ${
                preferences.darkMode ? 'bg-red-900/50 border border-red-700' : 'bg-red-50 border border-red-200'
              }`}>
                <p className={`text-sm ${
                  preferences.darkMode ? 'text-red-300' : 'text-red-700'
                }`}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl px-6 py-3 hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}