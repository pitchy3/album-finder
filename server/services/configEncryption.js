// server/services/configEncryption.js - Encrypt sensitive config at rest
const { encryptToken, decryptToken } = require('./tokenEncryption');
const config = require('../config');

/**
 * Fields that should be encrypted in config.json
 */
const ENCRYPTED_FIELDS = {
  lidarr: ['apiKey'],
  oidc: ['clientSecret'],
  basicAuth: ['passwordHash']
};

/**
 * Get the master key for config encryption
 * Priority: CONFIG_ENCRYPTION_KEY env var, then SESSION_SECRET
 */
function getConfigEncryptionKey() {
  const key = process.env.CONFIG_ENCRYPTION_KEY || config.session.secret;
  
  if (!key || key.length < 32) {
    throw new Error('Config encryption key is too weak or missing');
  }
  
  return key;
}

/**
 * Encrypt sensitive fields in a config object
 * 
 * @param {object} configData - Raw config data
 * @returns {object} Config with encrypted sensitive fields
 */
function encryptConfig(configData) {
  const key = getConfigEncryptionKey();
  const encrypted = JSON.parse(JSON.stringify(configData)); // Deep clone
  
  encrypted._encrypted = true;
  encrypted._version = '1';
  encrypted._timestamp = Date.now();
  
  // Encrypt each sensitive field
  for (const [section, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    if (!encrypted[section]) continue;
    
    for (const field of fields) {
      const value = encrypted[section][field];
      
      // Only encrypt if value exists and is not already encrypted
      if (value && typeof value === 'string' && !value.startsWith('{"version"')) {
        try {
          encrypted[section][field] = encryptToken(value, key);
          console.log(`🔒 Encrypted ${section}.${field}`);
        } catch (error) {
          console.error(`❌ Failed to encrypt ${section}.${field}:`, error.message);
          throw error;
        }
      }
    }
  }
  
  return encrypted;
}

/**
 * Decrypt sensitive fields in a config object
 * 
 * @param {object} encryptedConfig - Config with encrypted fields
 * @returns {object} Config with decrypted sensitive fields
 */
function decryptConfig(encryptedConfig) {
  const key = getConfigEncryptionKey();
  const decrypted = JSON.parse(JSON.stringify(encryptedConfig)); // Deep clone
  
  // Check if this config is encrypted
  if (!encryptedConfig._encrypted) {
    console.log('ℹ️  Config is not encrypted, returning as-is');
    return encryptedConfig;
  }
  
  // Verify version
  if (encryptedConfig._version !== '1') {
    throw new Error(`Unsupported config encryption version: ${encryptedConfig._version}`);
  }
  
  // Remove metadata fields from decrypted config
  delete decrypted._encrypted;
  delete decrypted._version;
  delete decrypted._timestamp;
  
  // Decrypt each sensitive field
  for (const [section, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    if (!decrypted[section]) continue;
    
    for (const field of fields) {
      const value = decrypted[section][field];
      
      // Only decrypt if value exists and looks encrypted
      if (value && typeof value === 'string' && value.startsWith('{"version"')) {
        try {
          decrypted[section][field] = decryptToken(value, key);
          console.log(`🔓 Decrypted ${section}.${field}`);
        } catch (error) {
          console.error(`❌ Failed to decrypt ${section}.${field}:`, error.message);
          throw new Error(`Failed to decrypt ${section}.${field} - config may be corrupted or key changed`);
        }
      }
    }
  }
  
  return decrypted;
}

/**
 * Decrypt only the Lidarr API key from an encrypted config
 * 
 * @param {object} encryptedConfig - Config containing encrypted lidarr.apiKey
 * @returns {string|null} Decrypted API key, or null if unavailable
 */
function getDecryptedLidarrApiKey(encryptedConfig) {
  try {
    const key = getConfigEncryptionKey();

    if (!encryptedConfig?.lidarr?.apiKey) {
      console.warn('⚠️  No Lidarr API key found in config');
      return null;
    }

    const value = encryptedConfig.lidarr.apiKey;

    // If not encrypted, return as-is
    if (typeof value === 'string' && !value.startsWith('{"version"')) {
      console.log('ℹ️  Lidarr API key appears unencrypted');
      return value;
    }

    // Decrypt the single field
    const decrypted = decryptToken(value, key);
    console.log('🔓 Decrypted Lidarr API key');
    return decrypted;
  } catch (error) {
    console.error('❌ Failed to decrypt Lidarr API key:', error.message);
    return null;
  }
}


/**
 * Check if a config object has encrypted fields
 * 
 * @param {object} configData - Config to check
 * @returns {boolean} True if config is encrypted
 */
function isConfigEncrypted(configData) {
  return !!(configData && configData._encrypted === true);
}

/**
 * Migrate unencrypted config to encrypted format
 * 
 * @param {object} plainConfig - Unencrypted config
 * @returns {object} Encrypted config
 */
function migrateToEncryptedConfig(plainConfig) {
  console.log('🔄 Migrating config to encrypted format...');
  
  // Check if any sensitive fields exist
  let hasSensitiveData = false;
  
  for (const [section, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    if (plainConfig[section]) {
      for (const field of fields) {
        if (plainConfig[section][field]) {
          hasSensitiveData = true;
          break;
        }
      }
    }
  }
  
  if (!hasSensitiveData) {
    console.log('ℹ️  No sensitive data to encrypt');
    return plainConfig;
  }
  
  // Encrypt the config
  const encrypted = encryptConfig(plainConfig);
  
  console.log('✅ Config migrated to encrypted format');
  return encrypted;
}

/**
 * Validate config encryption key
 * 
 * @returns {object} Validation result
 */
function validateConfigEncryptionKey() {
  try {
    const key = getConfigEncryptionKey();
    
    if (key.length < 32) {
      return {
        valid: false,
        error: 'Config encryption key is too short (minimum 32 characters)'
      };
    }
    
    // Test encryption/decryption
    const testValue = 'test-encryption-' + Date.now();
    const encrypted = encryptToken(testValue, key);
    const decrypted = decryptToken(encrypted, key);
    
    if (decrypted !== testValue) {
      return {
        valid: false,
        error: 'Config encryption key validation failed - encrypt/decrypt mismatch'
      };
    }
    
    return {
      valid: true,
      keySource: process.env.CONFIG_ENCRYPTION_KEY ? 'CONFIG_ENCRYPTION_KEY' : 'SESSION_SECRET'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Create backup of config before encryption
 * 
 * @param {object} configData - Config to backup
 * @param {string} backupPath - Where to save backup
 */
async function backupConfig(configData, backupPath) {
  const fs = require('fs').promises;
  const path = require('path');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `config-backup-${timestamp}.json`;
  const fullPath = path.join(backupPath, filename);
  
  try {
    await fs.mkdir(backupPath, { recursive: true, mode: 0o700 });
    await fs.writeFile(fullPath, JSON.stringify(configData, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    
    console.log(`💾 Config backup saved: ${fullPath}`);
    return fullPath;
  } catch (error) {
    console.error('❌ Failed to backup config:', error.message);
    throw error;
  }
}

/**
 * Obfuscate sensitive values for display (e.g., in API responses)
 * 
 * @param {object} configData - Config to obfuscate
 * @returns {object} Config with obfuscated sensitive fields
 */
function obfuscateConfig(configData) {
  const obfuscated = JSON.parse(JSON.stringify(configData));
  
  // Remove encryption metadata
  delete obfuscated._encrypted;
  delete obfuscated._version;
  delete obfuscated._timestamp;
  
  // Obfuscate sensitive fields
  for (const [section, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    if (!obfuscated[section]) continue;
    
    for (const field of fields) {
      const value = obfuscated[section][field];
      
      if (value && typeof value === 'string') {
        // Show last 4 chars for verification
        if (value.length > 4) {
          obfuscated[section][field] = '***' + value.slice(-4);
        } else {
          obfuscated[section][field] = '***';
        }
      }
    }
  }
  
  return obfuscated;
}

module.exports = {
  encryptConfig,
  decryptConfig,
  isConfigEncrypted,
  migrateToEncryptedConfig,
  validateConfigEncryptionKey,
  backupConfig,
  obfuscateConfig,
  getDecryptedLidarrApiKey,
  ENCRYPTED_FIELDS
};