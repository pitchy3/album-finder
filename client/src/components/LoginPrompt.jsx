// client/src/components/LoginPrompt.jsx

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function LoginPrompt() {
  const { preferences } = usePreferences();

  const handleLogin = () => {
    window.location.href = '/auth/login';
  };

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
          Authentication Required
        </h1>
        <p className={`mb-6 ${preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          You need to log in to access the Album Finder.
        </p>
        <button
          onClick={handleLogin}
          className="inline-block bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl px-6 py-3 hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium"
        >
          Log In
        </button>
      </div>
    </div>
  );
}