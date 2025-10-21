// client/src/hooks/index.js
// Centralized exports for configuration hooks

export { useConfigForm } from './useConfigForm.js';
export { useLidarrConfig } from './useLidarrConfig.js';
export { useAuthConfig } from './useAuthConfig.js';

// Note: useConfigForm is still exported for potential future use in other components
// but is no longer used by useLidarrConfig or useAuthConfig
