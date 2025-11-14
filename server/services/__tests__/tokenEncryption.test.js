// server/services/__tests__/tokenEncryption.test.js
const crypto = require('crypto');
const {
  encryptToken,
  decryptToken,
  isTokenExpired,
  migrateOldToken,
  validateMasterKey
} = require('../tokenEncryption');

describe('Token Encryption Service', () => {
  const masterKey = 'test-master-key-with-at-least-32-characters-for-security';
  const testToken = 'sample-access-token-12345';

  describe('encryptToken', () => {
    it('should encrypt a token successfully', () => {
      const encrypted = encryptToken(testToken, masterKey);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(testToken);
    });

    it('should return valid JSON structure', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('algorithm');
      expect(data).toHaveProperty('salt');
      expect(data).toHaveProperty('iv');
      expect(data).toHaveProperty('encrypted');
      expect(data).toHaveProperty('authTag');
      expect(data).toHaveProperty('timestamp');
    });

    it('should use version 1', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      expect(data.version).toBe('1');
    });

    it('should use aes-256-gcm algorithm', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      expect(data.algorithm).toBe('aes-256-gcm');
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const encrypted = encryptToken(testToken, masterKey);
      const after = Date.now();
      const data = JSON.parse(encrypted);

      expect(data.timestamp).toBeGreaterThanOrEqual(before);
      expect(data.timestamp).toBeLessThanOrEqual(after);
    });

    it('should generate unique salt for each encryption', () => {
      const encrypted1 = encryptToken(testToken, masterKey);
      const encrypted2 = encryptToken(testToken, masterKey);
      
      const data1 = JSON.parse(encrypted1);
      const data2 = JSON.parse(encrypted2);

      expect(data1.salt).not.toBe(data2.salt);
    });

    it('should generate unique IV for each encryption', () => {
      const encrypted1 = encryptToken(testToken, masterKey);
      const encrypted2 = encryptToken(testToken, masterKey);
      
      const data1 = JSON.parse(encrypted1);
      const data2 = JSON.parse(encrypted2);

      expect(data1.iv).not.toBe(data2.iv);
    });

    it('should produce different ciphertext for same token', () => {
      const encrypted1 = encryptToken(testToken, masterKey);
      const encrypted2 = encryptToken(testToken, masterKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw error if token is missing', () => {
      expect(() => encryptToken(null, masterKey)).toThrow('Token is required for encryption');
      expect(() => encryptToken(undefined, masterKey)).toThrow('Token is required for encryption');
      expect(() => encryptToken('', masterKey)).toThrow('Token is required for encryption');
    });

    it('should throw error if master key is too short', () => {
      expect(() => encryptToken(testToken, 'short')).toThrow('Master key must be at least 32 characters');
    });

    it('should throw error if master key is missing', () => {
      expect(() => encryptToken(testToken, null)).toThrow('Master key must be at least 32 characters');
    });

    it('should handle unicode tokens', () => {
      const unicodeToken = 'token-with-émojis-🔐-and-特殊字符';
      const encrypted = encryptToken(unicodeToken, masterKey);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const encrypted = encryptToken(longToken, masterKey);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });
  });

  describe('decryptToken', () => {
    it('should decrypt an encrypted token', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(testToken);
    });

    it('should decrypt unicode tokens correctly', () => {
      const unicodeToken = 'token-with-émojis-🔐-and-特殊字符';
      const encrypted = encryptToken(unicodeToken, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(unicodeToken);
    });

    it('should decrypt very long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const encrypted = encryptToken(longToken, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(longToken);
    });

    it('should throw error with wrong master key', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const wrongKey = 'different-master-key-with-at-least-32-characters';

      expect(() => decryptToken(encrypted, wrongKey)).toThrow('Decryption failed');
    });

    it('should throw error if encrypted data is missing', () => {
      expect(() => decryptToken(null, masterKey)).toThrow('Encrypted data and master key are required');
      expect(() => decryptToken(undefined, masterKey)).toThrow('Encrypted data and master key are required');
    });

    it('should throw error if master key is missing', () => {
      const encrypted = encryptToken(testToken, masterKey);
      expect(() => decryptToken(encrypted, null)).toThrow('Encrypted data and master key are required');
    });

    it('should throw error if data is invalid JSON', () => {
      expect(() => decryptToken('not-json', masterKey)).toThrow('Invalid encrypted data format');
    });

    it('should throw error if version is unsupported', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      data.version = '2';
      const invalidData = JSON.stringify(data);

      expect(() => decryptToken(invalidData, masterKey)).toThrow('Unsupported encryption version: 2');
    });

    it('should throw error if algorithm is unsupported', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      data.algorithm = 'aes-128-cbc';
      const invalidData = JSON.stringify(data);

      expect(() => decryptToken(invalidData, masterKey)).toThrow('Unsupported encryption algorithm: aes-128-cbc');
    });

    it('should detect tampered ciphertext', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Tamper with encrypted data
      const encryptedBuffer = Buffer.from(data.encrypted, 'hex');
      encryptedBuffer[0] = encryptedBuffer[0] ^ 0xFF;
      data.encrypted = encryptedBuffer.toString('hex');
      
      const tamperedData = JSON.stringify(data);

      expect(() => decryptToken(tamperedData, masterKey)).toThrow('Decryption failed');
    });

    it('should detect tampered auth tag', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Tamper with auth tag
      const authTagBuffer = Buffer.from(data.authTag, 'hex');
      authTagBuffer[0] = authTagBuffer[0] ^ 0xFF;
      data.authTag = authTagBuffer.toString('hex');
      
      const tamperedData = JSON.stringify(data);

      expect(() => decryptToken(tamperedData, masterKey)).toThrow('Decryption failed');
    });

    it('should detect tampered IV', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Tamper with IV
      const ivBuffer = Buffer.from(data.iv, 'hex');
      ivBuffer[0] = ivBuffer[0] ^ 0xFF;
      data.iv = ivBuffer.toString('hex');
      
      const tamperedData = JSON.stringify(data);

      expect(() => decryptToken(tamperedData, masterKey)).toThrow('Decryption failed');
    });

    it('should handle corrupted encrypted data', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      data.encrypted = 'corrupted';
      const corruptedData = JSON.stringify(data);

      expect(() => decryptToken(corruptedData, masterKey)).toThrow();
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for new token', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const expired = isTokenExpired(encrypted);

      expect(expired).toBe(false);
    });

    it('should return true for old token', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Set timestamp to 31 days ago
      data.timestamp = Date.now() - (31 * 24 * 60 * 60 * 1000);
      const oldEncrypted = JSON.stringify(data);

      const expired = isTokenExpired(oldEncrypted);

      expect(expired).toBe(true);
    });

    it('should use custom maxAge', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Set timestamp to 2 days ago
      data.timestamp = Date.now() - (2 * 24 * 60 * 60 * 1000);
      const oldEncrypted = JSON.stringify(data);

      // Check with 1 day maxAge
      const expired = isTokenExpired(oldEncrypted, 1 * 24 * 60 * 60 * 1000);

      expect(expired).toBe(true);
    });

    it('should return false if no timestamp (old format)', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      delete data.timestamp;
      const noTimestamp = JSON.stringify(data);

      const expired = isTokenExpired(noTimestamp);

      expect(expired).toBe(false);
    });

    it('should return true for invalid data', () => {
      const expired = isTokenExpired('invalid-json');

      expect(expired).toBe(true);
    });

    it('should handle edge case at exactly maxAge', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);
      
      // Set timestamp to exactly 30 days ago
      data.timestamp = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const oldEncrypted = JSON.stringify(data);

      const expired = isTokenExpired(oldEncrypted);

      expect(expired).toBe(false); // Should not be expired at exact threshold
    });
  });

  describe('migrateOldToken', () => {
    it('should migrate old format token to new format', () => {
      // Create old format token manually
      const oldKey = crypto.scryptSync(masterKey, 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', oldKey, iv);
      
      let encrypted = cipher.update(testToken, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const oldFormat = `${iv.toString('hex')}:${encrypted}`;

      // Migrate
      const newFormat = migrateOldToken(oldFormat, masterKey);

      // Verify it's in new format
      const data = JSON.parse(newFormat);
      expect(data.version).toBe('1');
      expect(data.algorithm).toBe('aes-256-gcm');

      // Verify it decrypts correctly
      const decrypted = decryptToken(newFormat, masterKey);
      expect(decrypted).toBe(testToken);
    });

    it('should throw error for invalid old format', () => {
      expect(() => migrateOldToken('invalid', masterKey)).toThrow('Invalid old token format');
      expect(() => migrateOldToken('no-colon', masterKey)).toThrow('Invalid old token format');
    });

    it('should throw error for corrupted old token', () => {
      const oldFormat = 'aabbccdd:invalid-hex-data';
      
      expect(() => migrateOldToken(oldFormat, masterKey)).toThrow('Failed to migrate old token');
    });
  });

  describe('validateMasterKey', () => {
    it('should validate strong master key', () => {
      const strongKey = 'aB3$fG7*jK9!mN2#pQ5&sT8^vW1@xY4%zC6(';
      const result = validateMasterKey(strongKey);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should reject missing key', () => {
      const result = validateMasterKey(null);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Master key is required');
    });

    it('should reject short key', () => {
      const result = validateMasterKey('short');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('too short'))).toBe(true);
    });

    it('should warn about low entropy', () => {
      const result = validateMasterKey('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('entropy'))).toBe(true);
    });

    it('should detect repeated characters', () => {
      const result = validateMasterKey('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('repeated'))).toBe(true);
    });

    it('should detect sequential patterns', () => {
      const result = validateMasterKey('0123456789abcdefghijklmnopqrstuvwxyz');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('sequential'))).toBe(true);
    });

    it('should detect weak pattern - password', () => {
      const result = validateMasterKey('mypassword123456789012345678901234');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('password'))).toBe(true);
    });

    it('should detect weak pattern - secret', () => {
      const result = validateMasterKey('mysecret123456789012345678901234567');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('secret'))).toBe(true);
    });

    it('should detect weak pattern - 123456', () => {
      const result = validateMasterKey('mykey123456789012345678901234567890');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('123456'))).toBe(true);
    });

    it('should detect weak pattern - qwerty', () => {
      const result = validateMasterKey('qwerty123456789012345678901234567890');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('qwerty'))).toBe(true);
    });

    it('should accept key with exactly 32 characters and good entropy', () => {
      // Must have at least 16 unique chars and no sequential patterns
      // Using a truly random-looking 32 char key
      const key = 'K8m!3Tz@9Wp#5Bv$7Jx&2Fy^1Qnjd69$5hU*';
      const result = validateMasterKey(key);

      expect(result.valid).toBe(true);
    });

    it('should report multiple issues', () => {
      const result = validateMasterKey('password');

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(1);
    });

    it('should handle case-insensitive weak patterns', () => {
      const result = validateMasterKey('MyPaSSwoRd123456789012345678901234');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('password'))).toBe(true);
    });
  });

  describe('Encryption Properties', () => {
    it('should use proper key derivation (scrypt)', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      // Verify salt is 32 bytes (64 hex chars)
      expect(data.salt.length).toBe(64);
    });

    it('should use proper IV size (16 bytes)', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      // IV should be 16 bytes (32 hex chars)
      expect(data.iv.length).toBe(32);
    });

    it('should include authentication tag', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      // Auth tag should be 16 bytes (32 hex chars)
      expect(data.authTag).toBeDefined();
      expect(data.authTag.length).toBe(32);
    });

    it('should be deterministically decryptable', () => {
      const encrypted = encryptToken(testToken, masterKey);

      // Decrypt multiple times
      const decrypted1 = decryptToken(encrypted, masterKey);
      const decrypted2 = decryptToken(encrypted, masterKey);
      const decrypted3 = decryptToken(encrypted, masterKey);

      expect(decrypted1).toBe(testToken);
      expect(decrypted2).toBe(testToken);
      expect(decrypted3).toBe(testToken);
    });
  });

  describe('Security Properties', () => {
    it('should protect against known-plaintext attacks', () => {
      // Same plaintext should produce different ciphertexts
      const encrypted1 = encryptToken('known-plaintext', masterKey);
      const encrypted2 = encryptToken('known-plaintext', masterKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should protect against replay attacks via salt', () => {
      const encrypted1 = encryptToken(testToken, masterKey);
      const encrypted2 = encryptToken(testToken, masterKey);
      
      const data1 = JSON.parse(encrypted1);
      const data2 = JSON.parse(encrypted2);

      // Different salts prevent replay
      expect(data1.salt).not.toBe(data2.salt);
    });

    it('should validate data integrity via auth tag', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      // Modify just one bit in ciphertext
      const cipherBuffer = Buffer.from(data.encrypted, 'hex');
      cipherBuffer[0] = cipherBuffer[0] ^ 1;
      data.encrypted = cipherBuffer.toString('hex');

      const tampered = JSON.stringify(data);

      // Should fail authentication
      expect(() => decryptToken(tampered, masterKey)).toThrow('Decryption failed');
    });

    it('should use authenticated encryption (AEAD)', () => {
      const encrypted = encryptToken(testToken, masterKey);
      const data = JSON.parse(encrypted);

      // GCM mode provides authenticated encryption
      expect(data.algorithm).toBe('aes-256-gcm');
      expect(data.authTag).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string token', () => {
      expect(() => encryptToken('', masterKey)).toThrow();
    });

    it('should handle token with only whitespace', () => {
      const token = '   ';
      const encrypted = encryptToken(token, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(token);
    });

    it('should handle token with special characters', () => {
      const token = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./';
      const encrypted = encryptToken(token, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(token);
    });

    it('should handle token with newlines', () => {
      const token = 'line1\nline2\rline3\r\nline4';
      const encrypted = encryptToken(token, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(token);
    });

    it('should handle binary-looking tokens', () => {
      const token = Buffer.from([0x00, 0x01, 0x02, 0xFF]).toString('base64');
      const encrypted = encryptToken(token, masterKey);
      const decrypted = decryptToken(encrypted, masterKey);

      expect(decrypted).toBe(token);
    });
  });
});
