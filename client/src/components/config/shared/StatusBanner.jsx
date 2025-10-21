// client/src/components/config/shared/StatusBanner.jsx

export default function StatusBanner({
  type = 'info',
  title,
  description = '',
  darkMode = false,
  icon = true
}) {
  const getStyles = () => {
    const baseStyles = 'p-4 rounded-xl border-2';
    
    switch (type) {
      case 'success':
        return `${baseStyles} ${
          darkMode 
            ? 'bg-green-900/50 border-green-700 text-green-300'
            : 'bg-green-50 border-green-200 text-green-800'
        }`;
      case 'warning':
        return `${baseStyles} ${
          darkMode
            ? 'bg-yellow-900/50 border-yellow-700 text-yellow-300'
            : 'bg-yellow-50 border-yellow-200 text-yellow-800'
        }`;
      case 'error':
        return `${baseStyles} ${
          darkMode
            ? 'bg-red-900/50 border-red-700 text-red-300'
            : 'bg-red-50 border-red-200 text-red-800'
        }`;
      case 'info':
      default:
        return `${baseStyles} ${
          darkMode
            ? 'bg-blue-900/50 border-blue-700 text-blue-300'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`;
    }
  };

  const getIcon = () => {
    if (!icon) return null;
    
    switch (type) {
      case 'success':
        return '✓';
      case 'warning':
        return '⚠️';
      case 'error':
        return '✗';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  const iconElement = getIcon();

  return (
    <div className={getStyles()}>
      <div className="flex items-start">
        {icon && iconElement && (
          <span className="mr-3 text-lg flex-shrink-0">
            {iconElement}
          </span>
        )}
        <div className="flex-1">
          <div className="font-medium">
            {title}
          </div>
          {description && (
            <p className={`text-sm mt-1 ${
              darkMode ? 'opacity-90' : 'opacity-80'
            }`}>
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}