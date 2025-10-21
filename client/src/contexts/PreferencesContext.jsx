// client/src/contexts/PreferencesContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const PreferencesContext = createContext();

// Default preferences
const getDefaultPreferences = () => ({
  darkMode: window.matchMedia("(prefers-color-scheme: dark)").matches,
  artistReleaseLimit: 50,
  artistReleaseCategories: {
    albums: true,
    eps: true,
    singles: true,
    other: true,
    all: false
  }
});

// Custom hook to use preferences
export const usePreferences = () => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};

// Preferences provider component
export const PreferencesProvider = ({ children }) => {
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem("albumfinder-preferences");
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...getDefaultPreferences(),
          ...parsed
        };
      }
      return getDefaultPreferences();
    } catch (error) {
      console.error('Error loading preferences:', error);
      return getDefaultPreferences();
    }
  });

  // Save to localStorage whenever preferences change
  useEffect(() => {
    try {
      localStorage.setItem('albumfinder-preferences', JSON.stringify(preferences));
	  const debug = false;
	  if (debug) {
        console.log('✅ Preferences saved:', preferences);
      }
    } catch (error) {
      console.error('❌ Error saving preferences:', error);
    }
  }, [preferences]);

  // Apply dark mode to DOM
  useEffect(() => {
    if (preferences.darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [preferences.darkMode]);

  // Auto-sync with OS theme if no manual override exists
  useEffect(() => {
    const saved = localStorage.getItem("albumfinder-preferences");
    if (saved) return; // User has manual preferences

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => {
      setPreferences(prev => ({ ...prev, darkMode: e.matches }));
    };

    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  // Preference update functions
  const updatePreference = (key, value) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      
      // Special handling for category selection
      if (key === 'artistReleaseCategories') {
        const categories = { ...prev.artistReleaseCategories, ...value };
        
        // If 'all' is being checked, check all others
        if (value.all === true) {
          categories.albums = true;
          categories.eps = true;
          categories.singles = true;
          categories.other = true;
        }
        // If any individual category is unchecked, uncheck 'all'
        else if (value.albums === false || value.eps === false || value.singles === false || value.other === false) {
          categories.all = false;
        }
        //// If all individual categories are checked, check 'all'
        //else if (categories.albums && categories.eps && categories.singles && categories.other && !categories.all) {
        //  categories.all = true;
        //}
        
        updated.artistReleaseCategories = categories;
      }
      
      return updated;
    });
  };

  const updatePreferences = (updates) => {
    setPreferences(prev => ({ ...prev, ...updates }));
  };

  const resetPreferences = () => {
    const defaults = getDefaultPreferences();
    setPreferences(defaults);
    localStorage.removeItem('albumfinder-preferences');
  };

  const value = {
    preferences,
    updatePreference,
    updatePreferences,
    resetPreferences,
    // Backward compatibility
    darkMode: preferences.darkMode,
    setDarkMode: (value) => updatePreference('darkMode', value)
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
};

export default PreferencesContext;
