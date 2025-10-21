// client/src/components/config/shared/ConfigSelect.jsx

export default function ConfigSelect({
  label,
  value,
  onChange,
  options = [],
  helpText = '',
  required = false,
  darkMode = false,
  disabled = false,
  loading = false,
  placeholder = 'Select an option...',
  error = null
}) {
  const handleChange = (e) => {
    const selectedValue = e.target.value;
    // Try to parse as number if it looks like a number
    const parsedValue = !isNaN(selectedValue) && selectedValue !== '' 
      ? Number(selectedValue) 
      : selectedValue;
    onChange(parsedValue);
  };

  const selectClasses = `
    w-full border-2 rounded-xl p-3 
    focus:outline-none
    ${error 
      ? 'border-red-500 focus:border-red-600' 
      : darkMode 
        ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
        : 'border-gray-200 bg-white focus:border-blue-500'
    }
    ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className="space-y-2">
      <label className={`block text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      
      <select
        value={value}
        onChange={handleChange}
        disabled={disabled || loading}
        className={selectClasses}
      >
        <option value="">{loading ? 'Loading...' : placeholder}</option>
        {options.map((option, index) => (
          <option 
            key={option.value || index} 
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      
      {helpText && (
        <p className={`text-sm ${
          error 
            ? 'text-red-500' 
            : darkMode 
              ? 'text-gray-400' 
              : 'text-gray-500'
        }`}>
          {error || helpText}
        </p>
      )}
    </div>
  );
}