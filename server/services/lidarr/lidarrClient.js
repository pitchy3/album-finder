/**
 * Low-level HTTP client for Lidarr API
 * Handles authentication, timeouts, and error handling consistently
 * 
 * @module services/lidarr/LidarrClient
 */

const config = require('../../config');
const lidarrConfig = require('../../config/lidarr');
const { getDecryptedLidarrApiKey } = require('../configEncryption');

class LidarrClient {
  constructor() {
    this.baseUrl = config.lidarr.url.replace(/\/$/, "");
    this.getApiKey = () => getDecryptedLidarrApiKey(config);
  }

  /**
   * Build full API URL with query parameters
   * @param {string} endpoint - API endpoint path
   * @param {Object} params - Query parameters
   * @returns {string} Complete URL with API key
   */
  buildUrl(endpoint, params = {}) {
    const queryParams = new URLSearchParams({
      ...params,
      apikey: this.getApiKey()
    });
    return `${this.baseUrl}/api/v1/${endpoint}?${queryParams}`;
  }

  /**
   * Redact API key from URLs for safe logging
   * @param {string} url - URL potentially containing API key
   * @returns {string} URL with redacted API key
   */
  static redactUrl(url) {
    try {
      const u = new URL(url);
      if (u.searchParams.has('apikey')) {
        const key = u.searchParams.get('apikey');
        const redacted = key.length > 3 ? `***${key.slice(-3)}` : '***';
        u.searchParams.set('apikey', redacted);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  /**
   * Make HTTP request to Lidarr with timeout and error handling
   * @param {string} endpoint - API endpoint path
   * @param {Object} options - Request options
   * @param {string} options.method - HTTP method (GET, POST, PUT, DELETE)
   * @param {Object} options.body - Request body for POST/PUT
   * @param {Object} options.params - Query parameters
   * @param {number} options.timeout - Request timeout in milliseconds
   * @param {boolean} options.includeApiKeyInUrl - Whether to include API key in URL (default: true)
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If request fails or times out
   */
  async request(endpoint, options = {}) {
    const {
      method = 'GET',
      body = null,
      params = {},
      timeout = lidarrConfig.timeouts.standard,
      includeApiKeyInUrl = true
    } = options;

    // Build URL
    const url = includeApiKeyInUrl 
      ? this.buildUrl(endpoint, params)
      : `${this.baseUrl}/api/v1/${endpoint}`;

    // Setup headers
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Add API key to header if not in URL
    if (!includeApiKeyInUrl) {
      headers['X-Api-Key'] = this.getApiKey();
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Lidarr API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
        );
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error(`Lidarr API timeout after ${timeout}ms for ${endpoint}`);
      }

      throw error;
    }
  }

  /**
   * Perform GET request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @param {number} timeout - Optional timeout override
   * @returns {Promise<Object>} Response data
   */
  async get(endpoint, params = {}, timeout) {
    return this.request(endpoint, { params, timeout });
  }

  /**
   * Perform POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @param {number} timeout - Optional timeout override
   * @returns {Promise<Object>} Response data
   */
  async post(endpoint, body, timeout) {
    return this.request(endpoint, { 
      method: 'POST', 
      body, 
      timeout 
    });
  }

  /**
   * Perform PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body
   * @param {number} timeout - Optional timeout override
   * @returns {Promise<Object>} Response data
   */
  async put(endpoint, body, timeout) {
    return this.request(endpoint, { 
      method: 'PUT', 
      body, 
      timeout 
    });
  }

  /**
   * Perform DELETE request
   * @param {string} endpoint - API endpoint
   * @param {number} timeout - Optional timeout override
   * @returns {Promise<Object>} Response data
   */
  async delete(endpoint, timeout) {
    return this.request(endpoint, { 
      method: 'DELETE', 
      timeout 
    });
  }

  /**
   * Validate Lidarr configuration
   * @throws {Error} If URL or API key not configured
   */
  static validateConfig() {
    if (!config.lidarr.url || !config.lidarr.apiKey) {
      throw new Error('Lidarr URL/API key not configured');
    }
  }
}

module.exports = { LidarrClient };