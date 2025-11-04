// client/src/components/AuthConfirmationPage.jsx - Re-authentication confirmation
import { useState } from 'react';
import { usePreferences } from "../contexts/PreferencesContext.jsx";
import { secureApiCall } from '../services/apiService.js';

export default function AuthConfirmationPage({ action, targetAuthType, onCancel, onConfirm }) {
  const { preferences } = usePreferences();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const getActionTitle = () => {
    if (action === 'disable') return 'Disable Authentication';
    if (action === 'change') return `Switch to ${targetAuthType?.toUpperCase()}`;
    return 'Confirm Action';
  };

  const getActionDescription = () => {
    if (action === 'disable') {
      return 'You are about to disable authentication. This will allow unrestricted access to the application.';
    }
    if (action === 'change') {
      return `You are about to change authentication from your current method to ${targetAuthType?.toUpperCase()}.`;
    }
    return 'Please confirm this action.';
  };

  const handleBasicAuthConfirm = async () => {
    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await secureApiCall('/api/config/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Password verification failed');
      }

      const data = await response.json();
      
      if (data.success) {
        onConfirm();
      } else {
        setError('Invalid password');
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOIDCConfirm = () => {
    // For OIDC users, just proceed with logout/relogin flow
    onConfirm();
  };

  // Detect current auth type from user session
  const [currentAuthType, setCurrentAuthType] = useState(null);
  
  useState(() => {
    const checkAuthType = async () => {
      try {
        const response = await fetch('/api/auth/user', { credentials: 'include' });
        const data = await response.json();
        setCurrentAuthType(data.user?.authType);
      } catch (err) {
        console.error('Failed to detect auth type:', err);
      }
    };
    checkAuthType();
  }, []);

  const isBasicAuth = currentAuthType === 'basicauth';

  return (
    <div className={`min-h-screen flex items-center justify-center p-6 ${
      preferences.darkMode 
        ? 'bg-gray-900' 
        : 'bg-gradient-to-br from-blue-50 to-indigo-100'
    }`}>
      <div className={`rounded-2xl shadow-xl p-8 max-w-md w-full ${
        preferences.darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'
      }`}>
        {/* Warning Icon */}
        <div className="flex justify-center mb-6">
          <div className={`rounded-full p-4 ${
            preferences.darkMode ? 'bg-yellow-900/50' : 'bg-yellow-100'
          }`}>
            <svg className={`w-12 h-12 ${
              preferences.darkMode ? 'text-yellow-400' : 'text-yellow-600'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className={`text-2xl font-bold text-center mb-4 ${
          preferences.darkMode ? 'text-white' : 'text-gray-800'
        }`}>
          {getActionTitle()}
        </h2>

        {/* Description */}
        <p className={`text-center mb-6 ${
          preferences.darkMode ? 'text-gray-300' : 'text-gray-600'
        }`}>
          {getActionDescription()}
        </p>

        {/* Re-authentication method */}
        {isBasicAuth ? (
          <div className="space-y-4 mb-6">
            <div className={`p-4 rounded-xl ${
              preferences.darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'
            }`}>
              <p className={`text-sm ${
                preferences.darkMode ? 'text-blue-300' : 'text-blue-700'
              }`}>
                Please enter your current password to confirm this action.
              </p>
            </div>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={`w-full border-2 rounded-xl p-3 focus:outline-none ${
                preferences.darkMode
                  ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
                  : 'border-gray-200 bg-white focus:border-blue-500'
              }`}
              onKeyPress={(e) => e.key === 'Enter' && handleBasicAuthConfirm()}
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
          </div>
        ) : (
          <div className="mb-6">
            <div className={`p-4 rounded-xl ${
              preferences.darkMode ? 'bg-orange-900/30 border border-orange-700' : 'bg-orange-50 border border-orange-200'
            }`}>
              <p className={`text-sm ${
                preferences.darkMode ? 'text-orange-300' : 'text-orange-700'
              }`}>
                You will be logged out and need to sign in again to continue.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className={`flex-1 px-6 py-3 rounded-xl font-medium transition-colors ${
              preferences.darkMode
                ? 'bg-gray-700 text-white hover:bg-gray-600'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={isBasicAuth ? handleBasicAuthConfirm : handleOIDCConfirm}
            disabled={loading || (isBasicAuth && !password)}
            className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl px-6 py-3 hover:from-blue-600 hover:to-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Verifying...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}