// client/src/components/config/shared/ConfigSection.jsx

export default function ConfigSection({
  title = '',
  description = '',
  children,
  darkMode = false,
  className = ''
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className={`text-lg font-semibold mb-1 ${
              darkMode ? 'text-white' : 'text-gray-800'
            }`}>
              {title}
            </h3>
          )}
          {description && (
            <p className={`text-sm ${
              darkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {description}
            </p>
          )}
        </div>
      )}
      
      <div className="space-y-6">
        {children}
      </div>
    </div>
  );
}