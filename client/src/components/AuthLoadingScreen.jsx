// client/src/components/AuthLoadingScreen.jsx

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function AuthLoadingScreen() {
  const { preferences } = usePreferences();

  return (
    <div className={`min-h-screen flex items-center justify-center transition-colors ${
      preferences.darkMode 
        ? 'bg-gray-900' 
        : 'bg-gradient-to-br from-blue-50 to-indigo-100'
    }`}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className={preferences.darkMode ? 'text-gray-300' : 'text-gray-600'}>
          Checking authentication...
        </p>
      </div>
    </div>
  );
}