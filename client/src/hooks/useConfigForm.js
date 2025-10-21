// client/src/hooks/useConfigForm.js
import { useState, useCallback, useRef } from 'react';

/**
 * Generic form state management hook
 * Tracks form values, changes, and provides reset functionality
 */
export function useConfigForm(initialValues = {}) {
  const [values, setValues] = useState(initialValues);
  const [originalValues, setOriginalValues] = useState(initialValues);
  const initialValuesRef = useRef(initialValues);

  /**
   * Set a single field value
   */
  const setValue = useCallback((key, value) => {
    setValues(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  /**
   * Set multiple field values at once
   */
  const setMultipleValues = useCallback((newValues) => {
    setValues(prev => ({
      ...prev,
      ...newValues
    }));
  }, []);

  /**
   * Reset form to original values
   */
  const reset = useCallback(() => {
    setValues(originalValues);
  }, [originalValues]);

  /**
   * Check if form has been modified
   */
  const isDirty = () => {
    return JSON.stringify(values) !== JSON.stringify(originalValues);
  };

  /**
   * Update the "original" values (useful after successful save)
   */
  const updateOriginalValues = useCallback((newOriginalValues) => {
    const valuesToSet = newOriginalValues || values;
    setOriginalValues(valuesToSet);
  }, [values]);

  return {
    values,
    setValue,
    setValues: setMultipleValues,
    isDirty: isDirty(),
    reset,
    originalValues,
    updateOriginalValues
  };
}