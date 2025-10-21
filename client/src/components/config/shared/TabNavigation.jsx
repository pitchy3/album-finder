// client/src/components/config/shared/TabNavigation.jsx
import { useEffect } from 'react';

export default function TabNavigation({
  activeTab,
  onTabChange,
  tabs = [],
  darkMode = false
}) {
  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Alt/Option + number keys to switch tabs
      if ((e.altKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < tabs.length) {
          e.preventDefault();
          onTabChange(tabs[tabIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [tabs, onTabChange]);

  const getTabClasses = (tab) => {
    const isActive = activeTab === tab.id;
    const baseClasses = 'flex-1 px-6 py-4 text-center font-medium';
    
    // First tab gets left rounded corners, last tab gets right rounded corners
    const isFirst = tabs[0]?.id === tab.id;
    const isLast = tabs[tabs.length - 1]?.id === tab.id;
    const roundingClasses = isFirst ? 'rounded-tl-2xl' : isLast ? 'rounded-tr-2xl' : '';

    if (isActive) {
      return `${baseClasses} ${roundingClasses} ${
        darkMode
          ? 'bg-gray-700 text-blue-400 border-b-2 border-blue-500'
          : 'bg-blue-50 text-blue-700 border-b-2 border-blue-500'
      }`;
    }

    return `${baseClasses} ${roundingClasses} ${
      darkMode
        ? 'text-gray-300 hover:text-white hover:bg-gray-700'
        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
    }`;
  };

  return (
    <div className={`rounded-2xl shadow-xl mb-6 ${
      darkMode ? 'bg-gray-800' : 'bg-white'
    }`}>
      <div className="flex border-b border-gray-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={getTabClasses(tab)}
            aria-label={`Switch to ${tab.label} tab (Alt+${index + 1})`}
            title={`Alt+${index + 1}`}
          >
            <span className="flex items-center justify-center gap-2">
              {tab.label}
              {tab.badge && (
                <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                  {tab.badge}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}