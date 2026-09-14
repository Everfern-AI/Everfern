/**
 * End-to-End Encryption Service
 *
 * Provides encryption capabilities for sensitive data in the multi-platform
 * integration system, including message encryption, key management, and
 * secure data storage.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { SecurityLogger, SecurityEventType, SecurityEventSeverity } from './security-logger';

export interface EncryptionConfig {
  algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  keyDerivation: 'pbkdf2' | 'scrypt';
  keyLength: number;
  ivLength: number;
  tagLength: number;
  saltLength: number;
  iterations: number;
}

export interface EncryptedData {
  algorithm: string;
  iv: string;
  salt: string;
  tag?: string;
  data: string;
  timestamp: number;
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
  algorithm: 'rsa' | 'ed25519';
  keySize: number;
  createdAt: Date;
}

export interface EncryptionKey {
  id: string;
  name: string;
  algorithm: string;
  keyData: string;
  createdAt: Date;
  expiresAt?: Date;
  usage: 'encryption' | 'signing' | 'both';
  active: boolean;
}

/**
 * Encryption Service for secure data handling
 */
export class EncryptionService {
  private config: EncryptionConfig;
  private securityLogger: SecurityLogger;
  private keyStore: Map<string, EncryptionKey> = new Map();
  private keyStoreFile: string;
  private masterKey?: Buffer;

  constructor(securityLogger: SecurityLogger) {
    this.securityLogger = securityLogger;

    // Default encryption configuration
    this.config = {
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      keyLength: 32, // 256 bits
      ivLength: 16,  // 128 bits
      tagLength: 16, // 128 bits
      saltLength: 32, // 256 bits
      iterations: 100000
    };

    this.keyStoreFile = path.join(homedir(), '.everfern', 'encryption', 'keystore.json');
  }

  /**
   * Initialize the encryption service
   */
  async initialize(masterPassword?: string): Promise<void> {
    try {
      const encryptionDir = path.dirname(this.keyStoreFile);
      await fs.mkdir(encryptionDir, { recursive: true });

      // Initialize or load master key
      if (masterPassword) {
        this.masterKey = await this.deriveMasterKey(masterPassword);
      } else {
        // Generate a random master key (for development/testing)
        this.masterKey = crypto.randomBytes(this.config.keyLength);
      }

      await this.loadKeyStore();

      await this.securityLogger.logEvent(
        SecurityEventType.CONFIGURATION_CHANGE,
        SecurityEventSeverity.LOW,
        'encryption-service',
        'Encryption service initialized',
        { algorithm: this.config.algorithm }
      );

      console.log('Encryption service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize encryption service:', error);

      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.CRITICAL,
        'encryption-service',
        'Failed to initialize encryption service',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Encrypt data using symmetric encryption
   */
  async encryptData(data: string | Buffer, keyId?: string): Promise<EncryptedData> {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const key = keyId ? await this.getEncryptionKey(keyId) : this.masterKey;

      if (!key) {
        throw new Error('No encryption key available');
      }

      const salt = crypto.randomBytes(this.config.saltLength);
      const iv = crypto.randomBytes(this.config.ivLength);

      let cipher: crypto.CipherGCM | crypto.Cipher;
      let encrypted: Buffer;
      let tag: Buffer | undefined;

      if (this.config.algorithm === 'aes-256-gcm') {
        cipher = crypto.createCipher('aes-256-gcm', key) as crypto.CipherGCM;
        (cipher as crypto.CipherGCM).setAAD(salt); // Use salt as additional authenticated data
        encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
        tag = (cipher as crypto.CipherGCM).getAuthTag();
      } else {
        cipher = crypto.createCipher('aes-256-cbc', key);
        encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
      }

      const result: EncryptedData = {
        algorithm: this.config.algorithm,
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        data: encrypted.toString('base64'),
        timestamp: Date.now()
      };

      if (tag) {
        result.tag = tag.toString('base64');
      }

      return result;
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to encrypt data',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Decrypt data using symmetric encryption
   */
  async decryptData(encryptedData: EncryptedData, keyId?: string): Promise<Buffer> {
    try {
      const key = keyId ? await this.getEncryptionKey(keyId) : this.masterKey;

      if (!key) {
        throw new Error('No decryption key available');
      }

      const iv = Buffer.from(encryptedData.iv, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const data = Buffer.from(encryptedData.data, 'base64');

      let decipher: crypto.DecipherGCM | crypto.Decipher;
      let decrypted: Buffer;

      if (encryptedData.algorithm === 'aes-256-gcm') {
        if (!encryptedData.tag) {
          throw new Error('Authentication tag missing for GCM mode');
        }

        decipher = crypto.createDecipher('aes-256-gcm', key) as crypto.DecipherGCM;
        (decipher as crypto.DecipherGCM).setAAD(salt);
        (decipher as crypto.DecipherGCM).setAuthTag(Buffer.from(encryptedData.tag, 'base64'));
        decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      } else {
        decipher = crypto.createDecipher('aes-256-cbc', key);
        decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      }

      return decrypted;
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to decrypt data',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Generate a new encryption key pair for asymmetric encryption
   */
  async generateKeyPair(algorithm: 'rsa' | 'ed25519' = 'rsa', keySize: number = 2048): Promise<KeyPair> {
    try {
      let keyPair: crypto.KeyPairSyncResult<string, string>;

      if (algorithm === 'rsa') {
        keyPair = crypto.generateKeyPairSync('rsa', {
          modulusLength: keySize,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
      } else {
        keyPair = crypto.generateKeyPairSync('ed25519', {
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
      }

      const result: KeyPair = {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        algorithm,
        keySize,
        createdAt: new Date()
      };

      await this.securityLogger.logEvent(
        SecurityEventType.CONFIGURATION_CHANGE,
        SecurityEventSeverity.LOW,
        'encryption-service',
        `Generated new ${algorithm} key pair`,
        { algorithm, keySize }
      );

      return result;
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to generate key pair',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Encrypt data using public key (asymmetric encryption)
   */
  async encryptWithPublicKey(data: string | Buffer, publicKey: string): Promise<string> {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const encrypted = crypto.publicEncrypt(publicKey, dataBuffer);
      return encrypted.toString('base64');
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to encrypt with public key',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Decrypt data using private key (asymmetric encryption)
   */
  async decryptWithPrivateKey(encryptedData: string, privateKey: string): Promise<Buffer> {
    try {
      const data = Buffer.from(encryptedData, 'base64');
      const decrypted = crypto.privateDecrypt(privateKey, data);
      return decrypted;
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to decrypt with private key',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Sign data using private key
   */
  async signData(data: string | Buffer, privateKey: string, algorithm: string = 'sha256'): Promise<string> {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const sign = crypto.createSign(algorithm);
      sign.update(dataBuffer);
      const signature = sign.sign(privateKey, 'base64');
      return signature;
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.HIGH,
        'encryption-service',
        'Failed to sign data',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Verify signature using public key
   */
  async verifySignature(data: string | Buffer, signature: string, publicKey: string, algorithm: string = 'sha256'): Promise<boolean> {
    try {
      const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      const verify = crypto.createVerify(algorithm);
      verify.update(dataBuffer);
      return verify.verify(publicKey, signature, 'base64');
    } catch (error) {
      await this.securityLogger.logEvent(
        SecurityEventType.ENCRYPTION_FAILURE,
        SecurityEventSeverity.MEDIUM,
        'encryption-service',
        'Failed to verify signature',
        { error: error instanceof Error ? error.message : String(error) }
      );

      return false;
    }
  }

  /**
   * Generate a secure hash of data
   */
  generateHash(data: string | Buffer, algorithm: string = 'sha256'): string {
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const hash = crypto.createHash(algorithm);
    hash.update(dataBuffer);
    return hash.digest('hex');
  }

  /**
   * Generate a secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Create an encryption key and store it
   */
  async createEncryptionKey(name: string, usage: 'encryption' | 'signing' | 'both' = 'encryption', expiresAt?: Date): Promise<string> {
    const keyId = this.generateKeyId();
    const keyData = crypto.randomBytes(this.config.keyLength);

    const encryptionKey: EncryptionKey = {
      id: keyId,
      name,
      algorithm: this.config.algorithm,
      keyData: keyData.toString('base64'),
      createdAt: new Date(),
      expiresAt,
      usage,
      active: true
    };

    this.keyStore.set(keyId, encryptionKey);
    await this.saveKeyStore();

    await this.securityLogger.logEvent(
      SecurityEventType.CONFIGURATION_CHANGE,
      SecurityEventSeverity.LOW,
      'encryption-service',
      `Created new encryption key: ${name}`,
      { keyId, usage }
    );

    return keyId;
  }

  /**
   * Get encryption key by ID
   */
  private async getEncryptionKey(keyId: string): Promise<Buffer | null> {
    const key = this.keyStore.get(keyId);
    if (!key || !key.active) {
      return null;
    }

    // Check if key has expired
    if (key.expiresAt && key.expiresAt < new Date()) {
      key.active = false;
      await this.saveKeyStore();
      return null;
    }

    return Buffer.from(key.keyData, 'base64');
  }

  /**
   * Derive master key from password
   */
  private async deriveMasterKey(password: string): Promise<Buffer> {
    const salt = crypto.randomBytes(this.config.saltLength);

    if (this.config.keyDerivation === 'pbkdf2') {
      return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, this.config.iterations, this.config.keyLength, 'sha256', (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        });
      });
    } else {
      return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, this.config.keyLength, (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        });
      });
    }
  }

  /**
   * Generate unique key ID
   */
  private generateKeyId(): string {
    return `key_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Load key store from file
   */
  private async loadKeyStore(): Promise<void> {
    try {
      const fileExists = await fs.access(this.keyStoreFile).then(() => true).catch(() => false);
      if (fileExists) {
        const content = await fs.readFile(this.keyStoreFile, 'utf8');
        const keyStoreData = JSON.parse(content);

        // Decrypt the key store if it's encrypted
        if (keyStoreData.encrypted && this.masterKey) {
          const decryptedData = await this.decryptData(keyStoreData.data);
          const keys = JSON.parse(decryptedData.toString('utf8'));

          for (const [keyId, keyData] of Object.entries(keys)) {
            this.keyStore.set(keyId, keyData as EncryptionKey);
          }
        } else if (!keyStoreData.encrypted) {
          // Unencrypted key store (for development)
          for (const [keyId, keyData] of Object.entries(keyStoreData)) {
            this.keyStore.set(keyId, keyData as EncryptionKey);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load key store:', error);
      // Continue with empty key store
    }
  }

  /**
   * Save key store to file
   */
  private async saveKeyStore(): Promise<void> {
    try {
      const keyStoreData: Record<string, EncryptionKey> = {};

      for (const [keyId, keyData] of this.keyStore.entries()) {
        keyStoreData[keyId] = keyData;
      }

      let fileContent: any;

      if (this.masterKey) {
        // Encrypt the key store
        const encryptedData = await this.encryptData(JSON.stringify(keyStoreData));
        fileContent = {
          encrypted: true,
          data: encryptedData
        };
      } else {
        // Store unencrypted (for development)
        fileContent = keyStoreData;
      }

      await fs.writeFile(this.keyStoreFile, JSON.stringify(fileContent, null, 2));
    } catch (error) {
      console.error('Failed to save key store:', error);
    }
  }

  /**
   * Get encryption configuration
   */
  getConfig(): EncryptionConfig {
    return { ...this.config };
  }

  /**
   * Update encryption configuration
   */
  async updateConfig(updates: Partial<EncryptionConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };

    await this.securityLogger.logEvent(
      SecurityEventType.CONFIGURATION_CHANGE,
      SecurityEventSeverity.MEDIUM,
      'encryption-service',
      'Encryption configuration updated',
      { updates }
    );
  }

  /**
   * List available encryption keys
   */
  listKeys(): EncryptionKey[] {
    return Array.from(this.keyStore.values()).map(key => ({
      ...key,
      keyData: '[REDACTED]' // Don't expose actual key data
    })) as EncryptionKey[];
  }

  /**
   * Deactivate an encryption key
   */
  async deactivateKey(keyId: string): Promise<void> {
    const key = this.keyStore.get(keyId);
    if (key) {
      key.active = false;
      await this.saveKeyStore();

      await this.securityLogger.logEvent(
        SecurityEventType.CONFIGURATION_CHANGE,
        SecurityEventSeverity.MEDIUM,
        'encryption-service',
        `Deactivated encryption key: ${key.name}`,
        { keyId }
      );
    }
  }
}

// Export the encryption service
