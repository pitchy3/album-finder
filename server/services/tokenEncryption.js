// server/services/tokenEncryption.js - Secure token encryption/decryption
const crypto = require('crypto');

/**
 * Encrypts sensitive tokens using AES-256-GCM with proper key derivation
 * 
 * @param {string} token - The token to encrypt
 * @param {string} masterKey - Master encryption key (session secret)
 * @returns {string} JSON string containing encrypted data and metadata
 */
function encryptToken(token, masterKey) {
  if (!token) {
    throw new Error('Token is required for encryption');
  }
  
  if (!masterKey || masterKey.length < 32) {
    throw new Error('Master key must be at least 32 characters');
  }
  
  // Generate random IV (Initialization Vector) for this encryption
  const iv = crypto.randomBytes(16);
  
  // Generate random salt for key derivation
  const salt = crypto.randomBytes(32);
  
  // Derive encryption key using scrypt (better than PBKDF2 for this use case)
  const key = crypto.scryptSync(masterKey, salt, 32, {
    N: 16384,  // CPU/memory cost parameter (2^14)
    r: 8,      // Block size parameter
    p: 1,      // Parallelization parameter
    maxmem: 33554432 // 32MB max memory
  });
  
  // Use AES-256-GCM for authenticated encryption
  // GCM provides both confidentiality AND integrity
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  // Encrypt the token
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get authentication tag (crucial for integrity)
  const authTag = cipher.getAuthTag();
  
  // Return all components needed for decryption
  // Version allows for future algorithm upgrades
  return JSON.stringify({
    version: '1',
    algorithm: 'aes-256-gcm',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    encrypted: encrypted,
    authTag: authTag.toString('hex'),
    timestamp: Date.now() // For key rotation tracking
  });
}

/**
 * Decrypts tokens encrypted with encryptToken()
 * 
 * @param {string} encryptedData - JSON string from encryptToken()
 * @param {string} masterKey - Master encryption key (must match encryption key)
 * @returns {string} Decrypted token
 * @throws {Error} If decryption fails or data is tampered
 */
function decryptToken(encryptedData, masterKey) {
  if (!encryptedData || !masterKey) {
    throw new Error('Encrypted data and master key are required');
  }
  
  let data;
  try {
    data = JSON.parse(encryptedData);
  } catch (error) {
    throw new Error('Invalid encrypted data format');
  }
  
  // Verify version for future compatibility
  if (data.version !== '1') {
    throw new Error(`Unsupported encryption version: ${data.version}`);
  }
  
  // Verify algorithm
  if (data.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported encryption algorithm: ${data.algorithm}`);
  }
  
  // Reconstruct the encryption key using same parameters
  const key = crypto.scryptSync(
    masterKey,
    Buffer.from(data.salt, 'hex'),
    32,
    {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 33554432
    }
  );
  
  // Create decipher
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(data.iv, 'hex')
  );
  
  // Set authentication tag BEFORE attempting to decrypt
  // This ensures integrity check happens first
  decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
  
  try {
    // Decrypt the token
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // This will throw if:
    // 1. Authentication tag doesn't match (data tampered)
    // 2. Wrong key used
    // 3. Data corrupted
    throw new Error('Decryption failed - data may be corrupted or tampered');
  }
}

/**
 * Check if encrypted token is expired (for key rotation)
 * 
 * @param {string} encryptedData - JSON string from encryptToken()
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {boolean} True if token should be re-encrypted
 */
function isTokenExpired(encryptedData, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  try {
    const data = JSON.parse(encryptedData);
    if (!data.timestamp) return false; // Old format, assume not expired
    
    const age = Date.now() - data.timestamp;
    return age > maxAgeMs;
  } catch (error) {
    return true; // If we can't parse, consider it expired
  }
}

/**
 * Migrate old token format to new secure format
 * Handles tokens encrypted with old insecure method
 * 
 * @param {string} oldEncryptedToken - Token in old format (iv:encrypted)
 * @param {string} masterKey - Master key
 * @returns {string} Token in new secure format
 */
function migrateOldToken(oldEncryptedToken, masterKey) {
  try {
    // Old format: "iv:encrypted"
    const [ivHex, encryptedHex] = oldEncryptedToken.split(':');
    
    if (!ivHex || !encryptedHex) {
      throw new Error('Invalid old token format');
    }
    
    // Old method used hardcoded 'salt'
    const oldKey = crypto.scryptSync(masterKey, 'salt', 32);
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      oldKey,
      Buffer.from(ivHex, 'hex')
    );
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Re-encrypt with new secure method
    return encryptToken(decrypted, masterKey);
    
  } catch (error) {
    throw new Error('Failed to migrate old token: ' + error.message);
  }
}

/**
 * Validate master key strength
 * 
 * @param {string} masterKey - Key to validate
 * @returns {object} Validation result with issues array
 */
function validateMasterKey(masterKey) {
  const issues = [];
  
  if (!masterKey) {
    issues.push('Master key is required');
    return { valid: false, issues };
  }
  
  if (masterKey.length < 32) {
    issues.push(`Master key too short (${masterKey.length} chars, minimum 32 required)`);
  }
  
  // Check character diversity
  const uniqueChars = new Set(masterKey).size;
  if (uniqueChars < 16) {
    issues.push(`Master key lacks entropy (${uniqueChars} unique characters, recommend 20+)`);
  }
  
  // Check for repeated characters
  if (/^(.)\1+$/.test(masterKey)) {
    issues.push('Master key contains only repeated characters');
  }
  
  // Check for sequential patterns
  if (/^(012|123|234|abc|bcd|qwe)/i.test(masterKey)) {
    issues.push('Master key contains sequential patterns');
  }
  
  // Check for common weak strings
  const weakPatterns = ['password', 'secret', 'key', '123456', 'qwerty'];
  for (const pattern of weakPatterns) {
    if (masterKey.toLowerCase().includes(pattern)) {
      issues.push(`Master key contains weak pattern: ${pattern}`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

module.exports = {
  encryptToken,
  decryptToken,
  isTokenExpired,
  migrateOldToken,
  validateMasterKey
};
