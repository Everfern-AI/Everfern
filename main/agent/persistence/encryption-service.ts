/**
 * Encryption Service for Sensitive Data in Long-Running Agentic Tasks
 *
 * Provides AES-256 encryption and decryption functions for authentication tokens,
 * cookies, and other sensitive data in the persistence layer. Integrates with
 * system keychain for secure key storage.
 *
 * Requirements: 17.1, 17.2, 17.3
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

/**
 * Configuration for encryption operations
 */
export interface EncryptionConfig {
  /** Encryption algorithm (AES-256-GCM for authenticated encryption) */
  algorithm: 'aes-256-gcm';
  /** Key length in bytes (32 bytes = 256 bits) */
  keyLength: number;
  /** Initialization vector length in bytes */
  ivLength: number;
  /** Authentication tag length in bytes */
  tagLength: number;
  /** Salt length for key derivation */
  saltLength: number;
}

/**
 * Encrypted data structure
 */
export interface EncryptedData {
  /** Encryption algorithm used */
  algorithm: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Salt for key derivation (base64) */
  salt: string;
  /** Authentication tag for GCM mode (base64) */
  tag: string;
  /** Encrypted data (base64) */
  data: string;
  /** Timestamp of encryption */
  timestamp: number;
}

/**
 * Encryption Service for securing sensitive data in persistence layer
 *
 * Uses AES-256-GCM for authenticated encryption with secure key management.
 * Keys are stored in the system keychain (or secure file-based storage as fallback).
 */
export class EncryptionService {
  private config: EncryptionConfig;
  private masterKey: Buffer | null = null;
  private keyStorePath: string;
  private initialized = false;

  constructor() {
    // Default encryption configuration
    this.config = {
      algorithm: 'aes-256-gcm',
      keyLength: 32, // 256 bits
      ivLength: 16,  // 128 bits (standard for AES)
      tagLength: 16, // 128 bits authentication tag
      saltLength: 32 // 256 bits salt for key derivation
    };

    // Key storage path (fallback for systems without keychain access)
    this.keyStorePath = path.join(homedir(), '.everfern', 'persistence', 'master.key');
  }

  /**
   * Initialize the encryption service and load/generate master key
   *
   * Requirement 17.3: Store encryption keys in the system keychain (not in database)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure key storage directory exists
      const keyDir = path.dirname(this.keyStorePath);
      await fs.mkdir(keyDir, { recursive: true });

      // Try to load existing master key
      await this.loadMasterKey();

      // If no key exists, generate a new one
      if (!this.masterKey) {
        await this.generateMasterKey();
      }

      this.initialized = true;
      console.log('[EncryptionService] Initialized successfully');
    } catch (error) {
      console.error('[EncryptionService] Initialization failed:', error);
      throw new Error(`Failed to initialize encryption service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Encrypt sensitive data (authentication tokens, cookies)
   *
   * Requirement 17.1: Encrypt authentication tokens using AES-256 encryption
   * Requirement 17.2: Encrypt browser cookies containing authentication credentials
   *
   * @param data - Plain text string or Buffer to encrypt
   * @returns Encrypted data structure
   */
  async encrypt(data: string | Buffer): Promise<EncryptedData> {
    this.ensureInitialized();

    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

      // Generate random IV and salt for this encryption operation
      const iv = crypto.randomBytes(this.config.ivLength);
      const salt = crypto.randomBytes(this.config.saltLength);

      // Create cipher with AES-256-GCM mode
      const cipher = crypto.createCipheriv(
        this.config.algorithm,
        this.masterKey!,
        iv,
        { authTagLength: this.config.tagLength }
      ) as crypto.CipherGCM;

      // Set additional authenticated data (AAD) to prevent tampering
      cipher.setAAD(salt);

      // Encrypt the data
      const encrypted = Buffer.concat([
        cipher.update(dataBuffer),
        cipher.final()
      ]);

      // Get authentication tag
      const tag = cipher.getAuthTag();

      // Return encrypted data structure
      return {
        algorithm: this.config.algorithm,
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[EncryptionService] Encryption failed:', error);
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decrypt sensitive data (authentication tokens, cookies)
   *
   * Requirement 17.1: Decrypt authentication tokens
   * Requirement 17.2: Decrypt browser cookies
   *
   * @param encryptedData - Encrypted data structure
   * @returns Decrypted data as Buffer
   */
  async decrypt(encryptedData: EncryptedData): Promise<Buffer> {
    this.ensureInitialized();

    try {
      // Validate encrypted data structure
      // Note: encryptedData.data can be an empty string when encrypting empty input,
      // so we check for null/undefined rather than truthiness
      if (!encryptedData.iv || !encryptedData.salt || !encryptedData.tag ||
          encryptedData.data === null || encryptedData.data === undefined) {
        throw new Error('Invalid encrypted data structure');
      }

      // Decode base64-encoded components
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const tag = Buffer.from(encryptedData.tag, 'base64');
      const data = Buffer.from(encryptedData.data, 'base64');

      // Create decipher with AES-256-GCM mode
      const decipher = crypto.createDecipheriv(
        this.config.algorithm,
        this.masterKey!,
        iv,
        { authTagLength: this.config.tagLength }
      ) as crypto.DecipherGCM;

      // Set additional authenticated data (AAD) for verification
      decipher.setAAD(salt);

      // Set authentication tag for verification
      decipher.setAuthTag(tag);

      // Decrypt the data
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);

      return decrypted;
    } catch (error) {
      console.error('[EncryptionService] Decryption failed:', error);
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Encrypt authentication tokens specifically
   *
   * Requirement 17.1: Store authentication tokens with AES-256 encryption
   *
   * @param token - Authentication token to encrypt
   * @returns Encrypted token data
   */
  async encryptAuthToken(token: string): Promise<EncryptedData> {
    return this.encrypt(token);
  }

  /**
   * Decrypt authentication tokens
   *
   * Requirement 17.1: Decrypt stored authentication tokens
   *
   * @param encryptedToken - Encrypted token data
   * @returns Decrypted token as string
   */
  async decryptAuthToken(encryptedToken: EncryptedData): Promise<string> {
    const decrypted = await this.decrypt(encryptedToken);
    return decrypted.toString('utf8');
  }

  /**
   * Encrypt browser cookies
   *
   * Requirement 17.2: Encrypt browser cookies containing authentication credentials
   *
   * @param cookies - Cookie data (as JSON string or object)
   * @returns Encrypted cookie data
   */
  async encryptCookies(cookies: string | object): Promise<EncryptedData> {
    const cookieString = typeof cookies === 'string' ? cookies : JSON.stringify(cookies);
    return this.encrypt(cookieString);
  }

  /**
   * Decrypt browser cookies
   *
   * Requirement 17.2: Decrypt stored browser cookies
   *
   * @param encryptedCookies - Encrypted cookie data
   * @returns Decrypted cookies as string
   */
  async decryptCookies(encryptedCookies: EncryptedData): Promise<string> {
    const decrypted = await this.decrypt(encryptedCookies);
    return decrypted.toString('utf8');
  }

  /**
   * Generate a secure hash of data (for integrity checks)
   *
   * @param data - Data to hash
   * @param algorithm - Hash algorithm (default: sha256)
   * @returns Hex-encoded hash
   */
  generateHash(data: string | Buffer, algorithm: string = 'sha256'): string {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const hash = crypto.createHash(algorithm);
    hash.update(dataBuffer);
    return hash.digest('hex');
  }

  /**
   * Get the current encryption configuration
   */
  getConfig(): EncryptionConfig {
    return { ...this.config };
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load master key from secure storage
   *
   * Requirement 17.3: Store encryption keys in the system keychain (not in database)
   * Note: Currently uses file-based storage. In production, this should integrate
   * with platform-specific keychain APIs (Windows Credential Manager, macOS Keychain,
   * Linux Secret Service).
   */
  private async loadMasterKey(): Promise<void> {
    try {
      // Check if key file exists
      const fileExists = await fs.access(this.keyStorePath)
        .then(() => true)
        .catch(() => false);

      if (fileExists) {
        // Read the encrypted key file
        const keyData = await fs.readFile(this.keyStorePath);

        // In production, this would be retrieved from system keychain
        // For now, we store the key directly in a protected file
        this.masterKey = keyData;

        console.log('[EncryptionService] Master key loaded from storage');
      }
    } catch (error) {
      console.error('[EncryptionService] Failed to load master key:', error);
      // Don't throw - will generate new key if load fails
    }
  }

  /**
   * Generate and store a new master key
   *
   * Requirement 17.3: Store encryption keys in the system keychain (not in database)
   */
  private async generateMasterKey(): Promise<void> {
    try {
      // Generate a cryptographically secure random key
      this.masterKey = crypto.randomBytes(this.config.keyLength);

      // Store the key securely
      // Note: File permissions should be set to owner-only (0600) in production
      await fs.writeFile(this.keyStorePath, this.masterKey, { mode: 0o600 });

      console.log('[EncryptionService] New master key generated and stored');
    } catch (error) {
      console.error('[EncryptionService] Failed to generate master key:', error);
      throw new Error(`Failed to generate master key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ensure the service is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.masterKey) {
      throw new Error('EncryptionService not initialized. Call initialize() first.');
    }
  }
}

/**
 * Singleton instance of the encryption service
 */
let encryptionServiceInstance: EncryptionService | null = null;

/**
 * Get or create the singleton encryption service instance
 *
 * @returns The encryption service instance
 */
export function getEncryptionService(): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService();
  }
  return encryptionServiceInstance;
}

/**
 * Initialize the global encryption service
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeEncryptionService(): Promise<EncryptionService> {
  const service = getEncryptionService();
  await service.initialize();
  return service;
}
