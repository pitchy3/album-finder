// client/src/services/apiService.js

// Create centralized API service with CSRF handling
let csrfToken = null;

// Allow tests to reset CSRF cache between runs
export function __resetCsrfToken() {
  csrfToken = null;
}

// Get CSRF token with retry logic
async function getCsrfToken(forceRefresh = false) {
  if (!csrfToken || forceRefresh) {
    try {
      console.log('Fetching CSRF token...');
      const response = await fetch('/api/csrf-token', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get CSRF token: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      csrfToken = data.csrfToken;
      console.log('CSRF token obtained successfully');
    } catch (error) {
      console.error('Failed to get CSRF token:', error);
      csrfToken = null;
      throw error;
    }
  }
  return csrfToken;
}

// Enhanced fetch wrapper with CSRF protection and retry logic
export async function secureApiCall(url, options = {}) {
  let token = null;
  
  // Get CSRF token for state-changing operations
  if (options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
    try {
      token = await getCsrfToken();
    } catch (error) {
      console.warn('Could not obtain CSRF token, proceeding without it:', error.message);
    }
  }
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  // Add CSRF token if we have one
  if (token) {
    headers['csrf-token'] = token;
  }
  
  const requestOptions = {
    ...options,
    headers,
    credentials: 'include'
  };
  
  console.log(`Making ${options.method || 'GET'} request to ${url}${token ? ' (with CSRF token)' : ' (no CSRF token)'}`);
  
  try {
    const response = await fetch(url, requestOptions);
    
    // Handle CSRF token errors specifically
    if (response.status === 403) {
      const responseText = await response.text().catch(() => '');
      
      // Check if it's a CSRF error
      if (responseText.includes('csrf') || responseText.includes('CSRF')) {
        console.warn('CSRF token validation failed, attempting to refresh token...');
        
        // Always clear cached token before retry
        csrfToken = null;

        // Only retry once to avoid infinite loops
        if (!options._csrfRetried) {
          try {
            // Force refresh the CSRF token
            token = await getCsrfToken(true);

            // Update headers with new token
            const retryHeaders = {
              ...headers,
              'csrf-token': token
            };

            console.log('Retrying request with refreshed CSRF token...');

            // Retry the request with new token
            const retryResponse = await fetch(url, {
              ...requestOptions,
              headers: retryHeaders,
              _csrfRetried: true // Prevent infinite retry loop
            });

            // If retry also fails, throw
            if (!retryResponse.ok) {
              throw new Error(`CSRF retry failed with status ${retryResponse.status}`);
            }

            return retryResponse;
          } catch (retryError) {
            console.error('CSRF token refresh failed:', retryError);
            throw retryError;
          }
        }
      }
    }

    return response;

  } catch (fetchError) {
    console.error(`Request to ${url} failed:`, fetchError);
    throw fetchError;
  }
}

// Handle API errors with specific CSRF error handling
export function handleApiError(response) {
  if (response.status === 403) {
    // Reset CSRF token on 403 errors
    console.log('403 error received, clearing CSRF token cache');
    csrfToken = null;
  }
  return response;
}

// Manual CSRF token refresh function (for components that need it)
export async function refreshCsrfToken() {
  return await getCsrfToken(true);
}

// Check if we have a valid CSRF token
export function hasCsrfToken() {
  return !!csrfToken;
}