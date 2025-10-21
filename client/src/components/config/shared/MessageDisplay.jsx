// client/src/components/config/shared/MessageDisplay.jsx
import { useEffect, useState } from 'react';

export default function MessageDisplay({
  message,
  onDismiss = null,
  darkMode = false,
  autoHide = 0 // 0 means no auto-hide, otherwise time in ms
}) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!message) {
      setIsVisible(false);
      return;
    }
    
    setIsVisible(true);

    if (autoHide > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        if (onDismiss) {
          setTimeout(onDismiss, 300); // Wait for fade animation
        }
      }, autoHide);

      return () => clearTimeout(timer);
    }
  }, [message, autoHide, onDismiss]);

  if (!message || !message.text) {
    return null;
  }

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismiss) {
      setTimeout(onDismiss, 300); // Wait for fade animation
    }
  };

  const messageClasses = `
    p-4 rounded-xl mb-6 border-2 transition-opacity duration-300
    ${isVisible ? 'opacity-100' : 'opacity-0'}
    ${message.type === 'success'
      ? darkMode
        ? 'bg-green-900/50 border-green-700 text-green-300'
        : 'bg-green-50 border-green-200 text-green-700'
      : darkMode
        ? 'bg-red-900/50 border-red-700 text-red-300'
        : 'bg-red-50 border-red-200 text-red-700'
    }
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className={messageClasses}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {message.text}
        </div>
        {onDismiss && (
          <button
            onClick={handleDismiss}
            className={`ml-4 flex-shrink-0 ${
              darkMode ? 'hover:text-white' : 'hover:text-gray-900'
            }`}
            aria-label="Dismiss message"
          >
            <svg 
              className="w-5 h-5" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M6 18L18 6M6 6l12 12" 
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}