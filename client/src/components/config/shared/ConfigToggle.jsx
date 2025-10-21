// client/src/components/config/shared/ConfigToggle.jsx

export default function ConfigToggle({
  label,
  description = '',
  checked,
  onChange,
  darkMode = false,
  disabled = false
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <label className={`block text-sm font-medium mb-1 ${
          darkMode ? 'text-gray-200' : 'text-gray-700'
        }`}>
          {label}
        </label>
        {description && (
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {description}
          </p>
        )}
      </div>
      
      <label className={`relative inline-flex items-center ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}>
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <div className={`
          w-11 h-6 rounded-full peer 
          peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300
          peer-checked:after:translate-x-full peer-checked:after:border-white
          after:content-[''] after:absolute after:top-[2px] after:left-[2px]
          after:bg-white after:border-gray-300 after:border after:rounded-full
          after:h-5 after:w-5 after:transition-all
          ${disabled ? 'bg-gray-300' : 'bg-gray-200'}
          peer-checked:bg-blue-600
        `.trim().replace(/\s+/g, ' ')}></div>
      </label>
    </div>
  );
}