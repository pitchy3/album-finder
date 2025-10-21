// client/src/components/config/shared/ConfigInput.jsx
import { useState } from 'react';

export default function ConfigInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder = '',
  helpText = '',
  required = false,
  darkMode = false,
  disabled = false,
  className = '',
  error = null
}) {
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = (e) => {
    const newValue = type === 'number' ? Number(e.target.value) : e.target.value;
    onChange(newValue);
  };

  const inputClasses = `
    w-full border-2 rounded-xl p-3 
    focus:outline-none
    ${type === 'password' ? 'font-mono' : ''}
    ${error 
      ? 'border-red-500 focus:border-red-600' 
      : darkMode 
        ? 'border-gray-600 bg-gray-700 text-white focus:border-blue-500'
        : 'border-gray-200 bg-white focus:border-blue-500'
    }
    ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
    ${className}
  `.trim().replace(/\s+/g, ' ');

  return (
    <div className="space-y-2">
      <label className={`block text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      
      <input
        type={type}
        value={value}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
      />
      
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