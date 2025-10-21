// client/src/components/ErrorDisplay.jsx

import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function ErrorDisplay({ error }) {
  const { preferences } = usePreferences();

  if (!error) return null;

  // Clean up error message - remove technical details
  let displayMessage = error;
  
  // Handle common error patterns
  if (error.includes("Connection closed unexpectedly")) {
    // Extract the actual error if it's embedded
    const match = error.match(/No artist found matching "([^"]+)"/);
    if (match) {
      displayMessage = `No artist found matching "${match[1]}". Please check the spelling and try again.`;
    } else {
      displayMessage = "The search was interrupted. Please try again.";
    }
  } else if (error.includes("No artist found")) {
    // Clean message for artist not found
    displayMessage = error.replace(/^Error:\s*/i, '');
  } else if (error.includes("timeout")) {
    displayMessage = "The search took too long. Please try again or use a more specific search term.";
  } else if (error.includes("network") || error.includes("fetch")) {
    displayMessage = "Network error. Please check your connection and try again.";
  }

  return (
    <div className={`border-2 rounded-xl p-4 mb-6 ${
      preferences.darkMode 
        ? 'bg-red-900/50 border-red-700 text-red-300' 
        : 'bg-red-50 border-red-200'
    }`}>
      <p className={`font-medium ${preferences.darkMode ? 'text-red-300' : 'text-red-700'}`}>
        {displayMessage}
      </p>
    </div>
  );
}