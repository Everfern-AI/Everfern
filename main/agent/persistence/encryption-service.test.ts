/**
 * Unit Tests for Encryption Service
 *
 * Tests encryption/decryption functionality, auth token handling,
 * cookie encryption, and keychain integration.
 *
 * Requirements: 17.1, 17.2, 17.3
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { EncryptionService, getEncryptionService, initializeEncryptionService } from './encryption-service';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const testKeyPath = path.join(homedir(), '.everfern', 'persistence', 'master.key');

  beforeAll(async () => {
    // Clean up any existing test key
    try {
      await fs.unlink(testKeyPath);
    } catch {
      // File doesn't exist, that's fine
    }

    // Initialize the service
    service = new EncryptionService();
    await service.initialize();
  });

  afterAll(async () => {
    // Clean up test key after all tests
    try {
      await fs.unlink(testKeyPath);
    } catch {
      // Ignore errors
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newService = new EncryptionService();
      await newService.initialize();
      expect(newService.isInitialized()).toBe(true);
    });

    it('should create master key file on first initialization', async () => {
      const fileExists = await fs.access(testKeyPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should load existing master key on subsequent initialization', async () => {
      const newService = new EncryptionService();
      await newService.initialize();
      expect(newService.isInitialized()).toBe(true);
    });

    it('should throw error when using uninitialized service', async () => {
      const uninitializedService = new EncryptionService();
      await expect(uninitializedService.encrypt('test')).rejects.toThrow('not initialized');
    });
  });

  describe('Basic Encryption and Decryption', () => {
    it('should encrypt string data', async () => {
      const plaintext = 'sensitive data';
      const encrypted = await service.encrypt(plaintext);

      expect(encrypted).toHaveProperty('algorithm');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('data');
      expect(encrypted).toHaveProperty('timestamp');
      expect(encrypted.algorithm).toBe('aes-256-gcm');
    });

    it('should encrypt Buffer data', async () => {
      const plaintext = Buffer.from('sensitive buffer data');
      const encrypted = await service.encrypt(plaintext);

      expect(encrypted).toHaveProperty('data');
      expect(encrypted.algorithm).toBe('aes-256-gcm');
    });

    it('should decrypt encrypted data correctly', async () => {
      const plaintext = 'test message';
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should produce different encrypted output for same input (due to random IV)', async () => {
      const plaintext = 'same message';
      const encrypted1 = await service.encrypt(plaintext);
      const encrypted2 = await service.encrypt(plaintext);

      expect(encrypted1.data).not.toBe(encrypted2.data);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);

      // Both should decrypt to the same plaintext
      const decrypted1 = await service.decrypt(encrypted1);
      const decrypted2 = await service.decrypt(encrypted2);
      expect(decrypted1.toString('utf8')).toBe(plaintext);
      expect(decrypted2.toString('utf8')).toBe(plaintext);
    });

    it('should handle empty string encryption', async () => {
      const plaintext = '';
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should handle Unicode characters', async () => {
      const plaintext = '测试中文 🚀 émojis and spëcial çhars';
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should fail decryption with tampered data', async () => {
      const plaintext = 'sensitive data';
      const encrypted = await service.encrypt(plaintext);

      // Tamper with the encrypted data
      const tamperedData = { ...encrypted, data: encrypted.data.slice(0, -4) + 'XXXX' };

      await expect(service.decrypt(tamperedData)).rejects.toThrow();
    });

    it('should fail decryption with tampered authentication tag', async () => {
      const plaintext = 'sensitive data';
      const encrypted = await service.encrypt(plaintext);

      // Tamper with the authentication tag
      const tamperedTag = { ...encrypted, tag: encrypted.tag.slice(0, -4) + 'YYYY' };

      await expect(service.decrypt(tamperedTag)).rejects.toThrow();
    });

    it('should fail decryption with invalid structure', async () => {
      const invalidData = {
        algorithm: 'aes-256-gcm',
        iv: '',
        salt: '',
        tag: '',
        data: '',
        timestamp: Date.now()
      };

      await expect(service.decrypt(invalidData)).rejects.toThrow('Invalid encrypted data structure');
    });
  });

  describe('Authentication Token Encryption (Requirement 17.1)', () => {
    it('should encrypt authentication tokens', async () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token';
      const encrypted = await service.encryptAuthToken(token);

      expect(encrypted).toHaveProperty('data');
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.data).not.toContain(token);
    });

    it('should decrypt authentication tokens', async () => {
      const token = 'bearer_token_12345_secret';
      const encrypted = await service.encryptAuthToken(token);
      const decrypted = await service.decryptAuthToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('should handle long JWT tokens', async () => {
      const longToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      const encrypted = await service.encryptAuthToken(longToken);
      const decrypted = await service.decryptAuthToken(encrypted);

      expect(decrypted).toBe(longToken);
    });

    it('should encrypt different tokens differently', async () => {
      const token1 = 'token_user_123';
      const token2 = 'token_user_456';

      const encrypted1 = await service.encryptAuthToken(token1);
      const encrypted2 = await service.encryptAuthToken(token2);

      expect(encrypted1.data).not.toBe(encrypted2.data);
    });
  });

  describe('Cookie Encryption (Requirement 17.2)', () => {
    it('should encrypt cookie string', async () => {
      const cookies = 'session_id=abc123; auth_token=xyz789';
      const encrypted = await service.encryptCookies(cookies);

      expect(encrypted).toHaveProperty('data');
      expect(encrypted.data).not.toContain('session_id');
    });

    it('should encrypt cookie object', async () => {
      const cookies = {
        session_id: 'abc123',
        auth_token: 'xyz789',
        user_pref: 'dark_mode'
      };

      const encrypted = await service.encryptCookies(cookies);
      expect(encrypted).toHaveProperty('data');
    });

    it('should decrypt cookie string', async () => {
      const cookies = 'session_id=test123; path=/; secure';
      const encrypted = await service.encryptCookies(cookies);
      const decrypted = await service.decryptCookies(encrypted);

      expect(decrypted).toBe(cookies);
    });

    it('should decrypt cookie object', async () => {
      const cookies = {
        session_id: 'test123',
        csrf_token: 'csrf_xyz',
        remember_me: 'true'
      };

      const encrypted = await service.encryptCookies(cookies);
      const decrypted = await service.decryptCookies(encrypted);

      expect(JSON.parse(decrypted)).toEqual(cookies);
    });

    it('should handle complex cookie structures', async () => {
      const cookies = {
        auth: {
          access_token: 'access_123',
          refresh_token: 'refresh_456',
          expires_at: 1234567890
        },
        preferences: {
          theme: 'dark',
          language: 'en'
        }
      };

      const encrypted = await service.encryptCookies(cookies);
      const decrypted = await service.decryptCookies(encrypted);

      expect(JSON.parse(decrypted)).toEqual(cookies);
    });
  });

  describe('Hash Generation', () => {
    it('should generate SHA-256 hash by default', () => {
      const data = 'test data for hashing';
      const hash = service.generateHash(data);

      expect(hash).toHaveLength(64); // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate consistent hashes for same input', () => {
      const data = 'consistent data';
      const hash1 = service.generateHash(data);
      const hash2 = service.generateHash(data);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const data1 = 'data one';
      const data2 = 'data two';
      const hash1 = service.generateHash(data1);
      const hash2 = service.generateHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('should support different hash algorithms', () => {
      const data = 'test data';
      const sha256Hash = service.generateHash(data, 'sha256');
      const sha512Hash = service.generateHash(data, 'sha512');

      expect(sha256Hash).toHaveLength(64);
      expect(sha512Hash).toHaveLength(128);
    });

    it('should hash Buffer data', () => {
      const data = Buffer.from('buffer data');
      const hash = service.generateHash(data);

      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('Configuration', () => {
    it('should return encryption configuration', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('algorithm');
      expect(config).toHaveProperty('keyLength');
      expect(config).toHaveProperty('ivLength');
      expect(config).toHaveProperty('tagLength');
      expect(config).toHaveProperty('saltLength');
      expect(config.algorithm).toBe('aes-256-gcm');
      expect(config.keyLength).toBe(32);
    });

    it('should not allow external modification of config', () => {
      const config = service.getConfig();
      config.keyLength = 16; // Try to modify

      const actualConfig = service.getConfig();
      expect(actualConfig.keyLength).toBe(32); // Should still be original value
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getEncryptionService', () => {
      const instance1 = getEncryptionService();
      const instance2 = getEncryptionService();

      expect(instance1).toBe(instance2);
    });

    it('should initialize singleton instance', async () => {
      const instance = await initializeEncryptionService();
      expect(instance.isInitialized()).toBe(true);
    });
  });

  describe('Large Data Handling', () => {
    it('should handle encryption of large strings', async () => {
      const largeData = 'x'.repeat(100000); // 100KB of data
      const encrypted = await service.encrypt(largeData);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe(largeData);
    });

    it('should handle encryption of large buffers', async () => {
      const largeBuffer = Buffer.alloc(100000, 'a'); // 100KB buffer
      const encrypted = await service.encrypt(largeBuffer);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.equals(largeBuffer)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in tokens', async () => {
      const token = 'token!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const encrypted = await service.encryptAuthToken(token);
      const decrypted = await service.decryptAuthToken(encrypted);

      expect(decrypted).toBe(token);
    });

    it('should handle newlines and whitespace', async () => {
      const data = 'line1\nline2\r\nline3\ttabbed  spaces';
      const encrypted = await service.encrypt(data);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted.toString('utf8')).toBe(data);
    });

    it('should include timestamp in encrypted data', async () => {
      const beforeTime = Date.now();
      const encrypted = await service.encrypt('test');
      const afterTime = Date.now();

      expect(encrypted.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(encrypted.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });
});
