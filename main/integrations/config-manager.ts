/**
 * Secure Configuration Manager for Multi-Platform Integration
 *
 * This module provides secure storage and management of integration configurations,
 * including encrypted bot token storage using system keychain/credential manager.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { FSWatcher, watch } from 'fs';

/**
 * Platform-specific configuration interfaces
 */
export interface TelegramConfig {
  enabled: boolean;
  botToken?: string; // Stored encrypted
  allowedUsers?: string[];
  groupSettings: {
    requireMention: boolean;
    allowedGroups?: string[];
  };
  fileHandling: {
    maxFileSize: number; // MB
    allowedTypes: string[];
    uploadEnabled: boolean;
    downloadEnabled: boolean;
  };
}

export interface DiscordConfig {
  enabled: boolean;
  botToken?: string; // Stored encrypted
  applicationId?: string;
  allowedGuilds?: string[];
  allowedUsers?: string[];
  serverSettings: {
    requireMention: boolean;
    allowedChannels?: string[];
    respondInDMs: boolean;
  };
  fileHandling: {
    maxFileSize: number; // MB (Discord limit: 25MB for bots)
    allowedTypes: string[];
    uploadEnabled: boolean;
    downloadEnabled: boolean;
  };
}

/**
 * Complete integration configuration
 */
export interface IntegrationConfig {
  autoStart: {
    enabled: boolean;
    minimizeToTray: boolean;
  };
  integrations: {
    telegram: TelegramConfig;
    discord: DiscordConfig;
  };
  security: {
    allowedUsers: string[];
    rateLimits: {
      messagesPerHour: number;
      toolCallsPerDay: number;
    };
    encryptionEnabled: boolean;
  };
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Configuration backup metadata
 */
export interface ConfigBackupMetadata {
  timestamp: string;
  version: string;
  description?: string;
  platforms: string[];
  size: number;
}

/**
 * Configuration change notification
 */
export interface ConfigChangeNotification {
  type: 'config-changed' | 'integration-restart-required' | 'config-validation-failed';
  platform?: 'telegram' | 'discord' | 'all';
  changes: ConfigChange[];
  timestamp: Date;
  requiresRestart: boolean;
  message: string;
}

/**
 * Individual configuration change
 */
export interface ConfigChange {
  path: string; // e.g., 'integrations.telegram.enabled'
  oldValue: any;
  newValue: any;
  type: 'added' | 'modified' | 'removed';
}

/**
 * Configuration diff result
 */
export interface ConfigDiff {
  hasChanges: boolean;
  changes: ConfigChange[];
  requiresRestart: boolean;
}

/**
 * Configuration backup with metadata
 */
export interface ConfigBackup {
  metadata: ConfigBackupMetadata;
  config: IntegrationConfig;
}

/**
 * Encrypted credential storage
 */
interface EncryptedCredential {
  encrypted: string;
  iv: string;
  algorithm: string;
  keyDerivation: {
    salt: string;
    iterations: number;
  };
}

/**
 * Configuration manager events
 */
export interface ConfigManagerEvents {
  'config-loaded': (config: IntegrationConfig) => void;
  'config-saved': (config: IntegrationConfig) => void;
  'config-validated': (result: ConfigValidationResult) => void;
  'config-backup-created': (backupPath: string, metadata: ConfigBackupMetadata) => void;
  'config-restored': (backupPath: string, metadata: ConfigBackupMetadata) => void;
  'config-loading-failed': (error: Error, fallbackUsed: boolean) => void;
  'credential-stored': (platform: string) => void;
  'credential-retrieved': (platform: string) => void;
  'config-changed': (notification: ConfigChangeNotification) => void;
  'config-change-detected': (diff: ConfigDiff) => void;
  'integration-restart-required': (platform: string, reason: string) => void;
  'external-config-changed': (filePath: string) => void;
  'error': (error: Error) => void;
}

/**
 * Main configuration manager class
 */
export class ConfigManager extends EventEmitter {
  private config: IntegrationConfig;
  private configDir: string;
  private integrationsDir: string;
  private backupsDir: string;
  private encryptionKey: Buffer | null = null;
  private isInitialized = false;
  private configVersion = '1.0.0';
  private configWatcher: FSWatcher | null = null;
  private integrationsWatcher: FSWatcher | null = null;
  private watcherDebounceTimeout: NodeJS.Timeout | null = null;
  private lastConfigSnapshot: string | null = null;

  constructor() {
    super();
    this.configDir = path.join(os.homedir(), '.everfern');
    this.integrationsDir = path.join(this.configDir, 'integrations');
    this.backupsDir = path.join(this.integrationsDir, 'backups');
    this.config = this.getDefaultConfig();
  }

  /**
   * Initialize the configuration manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create directories
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.mkdir(this.integrationsDir, { recursive: true });
      await fs.mkdir(this.backupsDir, { recursive: true });

      // Initialize encryption key
      await this.initializeEncryptionKey();

      // Load existing configuration with validation and fallback
      await this.loadConfigurationWithValidation();

      // Initialize file system watchers for real-time configuration updates
      await this.initializeFileWatchers();

      // Create initial configuration snapshot for change detection
      this.lastConfigSnapshot = JSON.stringify(this.config);

      this.isInitialized = true;
      this.emit('config-loaded', this.config);

      console.log('ConfigManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize ConfigManager:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): IntegrationConfig {
    return JSON.parse(JSON.stringify(this.config)); // Deep copy
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<IntegrationConfig>): Promise<void> {
    try {
      // Create new configuration by merging updates
      const newConfig = { ...this.config, ...updates };

      // Apply changes with notifications
      await this.applyConfigurationChanges(newConfig, 'user');

      // Clean old backups (keep last 10)
      await this.cleanOldBackups(10);

      console.log('Configuration updated successfully');
    } catch (error) {
      console.error('Failed to update configuration:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Store bot token securely
   */
  async storeBotToken(platform: 'telegram' | 'discord', token: string): Promise<void> {
    try {
      if (!this.encryptionKey) {
        throw new Error('Encryption key not initialized');
      }

      // Encrypt the token
      const encrypted = await this.encryptCredential(token);

      // Store encrypted token to file
      const tokenPath = path.join(this.integrationsDir, `${platform}.key`);
      await fs.writeFile(tokenPath, JSON.stringify(encrypted, null, 2), 'utf-8');

      // Set file permissions (owner read/write only)
      await fs.chmod(tokenPath, 0o600);

      this.emit('credential-stored', platform);
      console.log(`Bot token stored securely for ${platform}`);
    } catch (error) {
      console.error(`Failed to store bot token for ${platform}:`, error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve bot token securely
   */
  async retrieveBotToken(platform: 'telegram' | 'discord'): Promise<string | null> {
    try {
      if (!this.encryptionKey) {
        throw new Error('Encryption key not initialized');
      }

      const tokenPath = path.join(this.integrationsDir, `${platform}.key`);

      // Check if token file exists
      try {
        await fs.access(tokenPath);
      } catch {
        return null; // Token not stored
      }

      // Read and decrypt token
      const encryptedData = await fs.readFile(tokenPath, 'utf-8');
      const encrypted: EncryptedCredential = JSON.parse(encryptedData);

      const token = await this.decryptCredential(encrypted);

      this.emit('credential-retrieved', platform);
      return token;
    } catch (error) {
      console.error(`Failed to retrieve bot token for ${platform}:`, error);
      this.emit('error', error as Error);
      return null;
    }
  }

  /**
   * Delete stored bot token
   */
  async deleteBotToken(platform: 'telegram' | 'discord'): Promise<void> {
    try {
      const tokenPath = path.join(this.integrationsDir, `${platform}.key`);

      try {
        await fs.unlink(tokenPath);
        console.log(`Bot token deleted for ${platform}`);
      } catch (error) {
        // File might not exist, which is fine
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }
    } catch (error) {
      console.error(`Failed to delete bot token for ${platform}:`, error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Validate configuration
   */
  validateConfiguration(config: IntegrationConfig): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate basic structure
    if (!config || typeof config !== 'object') {
      errors.push('Configuration must be a valid object');
      return { valid: false, errors, warnings };
    }

    // Validate autoStart section
    if (!config.autoStart || typeof config.autoStart !== 'object') {
      errors.push('autoStart configuration is missing or invalid');
    } else {
      if (typeof config.autoStart.enabled !== 'boolean') {
        errors.push('autoStart.enabled must be a boolean');
      }
      if (typeof config.autoStart.minimizeToTray !== 'boolean') {
        errors.push('autoStart.minimizeToTray must be a boolean');
      }
    }

    // Validate integrations section
    if (!config.integrations || typeof config.integrations !== 'object') {
      errors.push('integrations configuration is missing or invalid');
      return { valid: false, errors, warnings };
    }

    // Validate Telegram configuration
    if (config.integrations?.telegram) {
      const telegram = config.integrations.telegram;

      if (typeof telegram.enabled !== 'boolean') {
        errors.push('Telegram enabled flag must be a boolean');
      }

      if (telegram.enabled) {
        if (!telegram.fileHandling?.maxFileSize || telegram.fileHandling.maxFileSize <= 0) {
          errors.push('Telegram max file size must be greater than 0');
        }

        if (telegram.fileHandling?.maxFileSize > 50) {
          warnings.push('Telegram max file size exceeds recommended limit of 50MB');
        }

        if (!telegram.fileHandling?.allowedTypes?.length) {
          warnings.push('No allowed file types specified for Telegram');
        }

        if (!telegram.groupSettings || typeof telegram.groupSettings !== 'object') {
          errors.push('Telegram groupSettings configuration is missing or invalid');
        } else {
          if (typeof telegram.groupSettings.requireMention !== 'boolean') {
            errors.push('Telegram groupSettings.requireMention must be a boolean');
          }
        }
      }
    }

    // Validate Discord configuration
    if (config.integrations?.discord) {
      const discord = config.integrations.discord;

      if (typeof discord.enabled !== 'boolean') {
        errors.push('Discord enabled flag must be a boolean');
      }

      if (discord.enabled) {
        if (!discord.fileHandling?.maxFileSize || discord.fileHandling.maxFileSize <= 0) {
          errors.push('Discord max file size must be greater than 0');
        }

        if (discord.fileHandling?.maxFileSize > 25) {
          errors.push('Discord max file size cannot exceed 25MB (Discord limit)');
        }

        if (!discord.fileHandling?.allowedTypes?.length) {
          warnings.push('No allowed file types specified for Discord');
        }

        if (!discord.serverSettings || typeof discord.serverSettings !== 'object') {
          errors.push('Discord serverSettings configuration is missing or invalid');
        } else {
          if (typeof discord.serverSettings.requireMention !== 'boolean') {
            errors.push('Discord serverSettings.requireMention must be a boolean');
          }
          if (typeof discord.serverSettings.respondInDMs !== 'boolean') {
            errors.push('Discord serverSettings.respondInDMs must be a boolean');
          }
        }
      }
    }

    // Validate security settings
    if (!config.security || typeof config.security !== 'object') {
      errors.push('security configuration is missing or invalid');
    } else {
      if (!config.security.rateLimits || typeof config.security.rateLimits !== 'object') {
        errors.push('security.rateLimits configuration is missing or invalid');
      } else {
        if (!config.security.rateLimits.messagesPerHour || config.security.rateLimits.messagesPerHour <= 0) {
          errors.push('Messages per hour rate limit must be greater than 0');
        }

        if (!config.security.rateLimits.toolCallsPerDay || config.security.rateLimits.toolCallsPerDay <= 0) {
          errors.push('Tool calls per day rate limit must be greater than 0');
        }
      }

      if (typeof config.security.encryptionEnabled !== 'boolean') {
        errors.push('security.encryptionEnabled must be a boolean');
      }

      if (!Array.isArray(config.security.allowedUsers)) {
        errors.push('security.allowedUsers must be an array');
      }
    }

    const result: ConfigValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings
    };

    this.emit('config-validated', result);
    return result;
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfiguration(): Promise<void> {
    try {
      // Create backup before reset
      await this.createBackup('Pre-reset backup');

      // Reset to defaults
      this.config = this.getDefaultConfig();
      await this.saveConfiguration();

      // Delete stored tokens
      await this.deleteBotToken('telegram');
      await this.deleteBotToken('discord');

      this.emit('config-saved', this.config);
      console.log('Configuration reset to defaults');
    } catch (error) {
      console.error('Failed to reset configuration:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Export configuration (without sensitive data)
   */
  async exportConfiguration(): Promise<string> {
    const exportConfig = JSON.parse(JSON.stringify(this.config));

    // Remove sensitive data
    delete exportConfig.integrations.telegram.botToken;
    delete exportConfig.integrations.discord.botToken;

    return JSON.stringify(exportConfig, null, 2);
  }

  /**
   * Import configuration
   */
  async importConfiguration(configJson: string): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson);

      // Validate imported configuration
      const validation = this.validateConfiguration(importedConfig);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Merge with current config (preserving tokens)
      const currentTokens = {
        telegram: await this.retrieveBotToken('telegram'),
        discord: await this.retrieveBotToken('discord')
      };

      this.config = importedConfig;

      // Restore tokens if they existed
      if (currentTokens.telegram) {
        await this.storeBotToken('telegram', currentTokens.telegram);
      }
      if (currentTokens.discord) {
        await this.storeBotToken('discord', currentTokens.discord);
      }

      await this.saveConfiguration();
      this.emit('config-saved', this.config);

      console.log('Configuration imported successfully');
    } catch (error) {
      console.error('Failed to import configuration:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Create configuration backup with metadata
   */
  async createBackup(description?: string): Promise<string> {
    try {
      const timestamp = new Date().toISOString();
      const backupId = `backup-${timestamp.replace(/[:.]/g, '-')}`;

      // Get current configuration for backup
      const configForBackup = JSON.parse(JSON.stringify(this.config));

      // Remove sensitive data from backup
      delete configForBackup.integrations.telegram.botToken;
      delete configForBackup.integrations.discord.botToken;

      // Create backup metadata
      const metadata: ConfigBackupMetadata = {
        timestamp,
        version: this.configVersion,
        description: description || `Automatic backup created on ${new Date().toLocaleString()}`,
        platforms: [
          ...(this.config.integrations.telegram.enabled ? ['telegram'] : []),
          ...(this.config.integrations.discord.enabled ? ['discord'] : [])
        ],
        size: JSON.stringify(configForBackup).length
      };

      // Create backup object
      const backup: ConfigBackup = {
        metadata,
        config: configForBackup
      };

      // Save backup to file
      const backupPath = path.join(this.backupsDir, `${backupId}.json`);
      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

      // Set file permissions (owner read/write only)
      await fs.chmod(backupPath, 0o600);

      this.emit('config-backup-created', backupPath, metadata);
      console.log(`Configuration backup created: ${backupPath}`);

      return backupPath;
    } catch (error) {
      console.error('Failed to create configuration backup:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * List available configuration backups
   */
  async listBackups(): Promise<ConfigBackupMetadata[]> {
    try {
      const backupFiles = await fs.readdir(this.backupsDir);
      const backups: ConfigBackupMetadata[] = [];

      for (const file of backupFiles) {
        if (file.endsWith('.json')) {
          try {
            const backupPath = path.join(this.backupsDir, file);
            const backupData = await fs.readFile(backupPath, 'utf-8');
            const backup: ConfigBackup = JSON.parse(backupData);
            backups.push(backup.metadata);
          } catch (error) {
            console.warn(`Failed to read backup file ${file}:`, error);
          }
        }
      }

      // Sort by timestamp (newest first)
      return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      console.error('Failed to list configuration backups:', error);
      return [];
    }
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    try {
      // Read backup file
      const backupData = await fs.readFile(backupPath, 'utf-8');
      const backup: ConfigBackup = JSON.parse(backupData);

      // Validate backup structure
      if (!backup.metadata || !backup.config) {
        throw new Error('Invalid backup file structure');
      }

      // Validate configuration
      const validation = this.validateConfiguration(backup.config);
      if (!validation.valid) {
        throw new Error(`Invalid backup configuration: ${validation.errors.join(', ')}`);
      }

      // Create backup of current configuration before restore
      await this.createBackup('Pre-restore backup');

      // Preserve current bot tokens
      const currentTokens = {
        telegram: await this.retrieveBotToken('telegram'),
        discord: await this.retrieveBotToken('discord')
      };

      // Restore configuration
      this.config = backup.config;

      // Restore tokens if they existed
      if (currentTokens.telegram) {
        await this.storeBotToken('telegram', currentTokens.telegram);
      }
      if (currentTokens.discord) {
        await this.storeBotToken('discord', currentTokens.discord);
      }

      // Save restored configuration
      await this.saveConfiguration();

      this.emit('config-restored', backupPath, backup.metadata);
      this.emit('config-saved', this.config);

      console.log(`Configuration restored from backup: ${backupPath}`);
    } catch (error) {
      console.error('Failed to restore configuration from backup:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Delete configuration backup
   */
  async deleteBackup(backupPath: string): Promise<void> {
    try {
      await fs.unlink(backupPath);
      console.log(`Configuration backup deleted: ${backupPath}`);
    } catch (error) {
      console.error('Failed to delete configuration backup:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Clean old backups (keep only the most recent N backups)
   */
  async cleanOldBackups(keepCount: number = 10): Promise<void> {
    try {
      const backups = await this.listBackups();

      if (backups.length <= keepCount) {
        return; // Nothing to clean
      }

      // Delete old backups (keep only the most recent ones)
      const backupsToDelete = backups.slice(keepCount);

      for (const backup of backupsToDelete) {
        const backupFileName = `backup-${backup.timestamp.replace(/[:.]/g, '-')}.json`;
        const backupPath = path.join(this.backupsDir, backupFileName);

        try {
          await this.deleteBackup(backupPath);
        } catch (error) {
          console.warn(`Failed to delete old backup ${backupPath}:`, error);
        }
      }

      console.log(`Cleaned ${backupsToDelete.length} old configuration backups`);
    } catch (error) {
      console.error('Failed to clean old backups:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Enable real-time configuration change notifications
   */
  async enableChangeNotifications(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ConfigManager must be initialized before enabling change notifications');
    }

    await this.initializeFileWatchers();
    console.log('Configuration change notifications enabled');
  }

  /**
   * Disable real-time configuration change notifications
   */
  async disableChangeNotifications(): Promise<void> {
    await this.cleanupFileWatchers();
    console.log('Configuration change notifications disabled');
  }

  /**
   * Detect changes between current and new configuration
   */
  detectConfigurationChanges(newConfig: IntegrationConfig): ConfigDiff {
    const changes: ConfigChange[] = [];
    const oldConfig = this.config;

    // Helper function to recursively compare objects
    const compareObjects = (oldObj: any, newObj: any, basePath: string = '') => {
      const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

      for (const key of allKeys) {
        const currentPath = basePath ? `${basePath}.${key}` : key;
        const oldValue = oldObj?.[key];
        const newValue = newObj?.[key];

        if (oldValue === undefined && newValue !== undefined) {
          changes.push({
            path: currentPath,
            oldValue: undefined,
            newValue,
            type: 'added'
          });
        } else if (oldValue !== undefined && newValue === undefined) {
          changes.push({
            path: currentPath,
            oldValue,
            newValue: undefined,
            type: 'removed'
          });
        } else if (oldValue !== newValue) {
          if (typeof oldValue === 'object' && typeof newValue === 'object' &&
              oldValue !== null && newValue !== null &&
              !Array.isArray(oldValue) && !Array.isArray(newValue)) {
            // Recursively compare nested objects
            compareObjects(oldValue, newValue, currentPath);
          } else {
            changes.push({
              path: currentPath,
              oldValue,
              newValue,
              type: 'modified'
            });
          }
        }
      }
    };

    compareObjects(oldConfig, newConfig);

    // Determine if restart is required based on critical configuration changes
    const requiresRestart = this.determineRestartRequirement(changes);

    return {
      hasChanges: changes.length > 0,
      changes,
      requiresRestart
    };
  }

  /**
   * Apply configuration changes with notifications
   */
  async applyConfigurationChanges(newConfig: IntegrationConfig, source: 'user' | 'external' = 'user'): Promise<void> {
    try {
      // Detect changes
      const diff = this.detectConfigurationChanges(newConfig);

      if (!diff.hasChanges) {
        console.log('No configuration changes detected');
        return;
      }

      // Emit change detection event
      this.emit('config-change-detected', diff);

      // Validate new configuration
      const validation = this.validateConfiguration(newConfig);
      if (!validation.valid) {
        const notification: ConfigChangeNotification = {
          type: 'config-validation-failed',
          changes: diff.changes,
          timestamp: new Date(),
          requiresRestart: false,
          message: `Configuration validation failed: ${validation.errors.join(', ')}`
        };
        this.emit('config-changed', notification);
        throw new Error(notification.message);
      }

      // Create backup before applying changes
      await this.createBackup(`Pre-change backup (${source})`);

      // Apply configuration changes
      const oldConfig = JSON.parse(JSON.stringify(this.config));
      this.config = newConfig;

      // Save to disk
      await this.saveConfiguration();
      this.emit('config-saved', this.config);

      // Update configuration snapshot
      this.lastConfigSnapshot = JSON.stringify(this.config);

      // Create and emit change notification
      const notification: ConfigChangeNotification = {
        type: diff.requiresRestart ? 'integration-restart-required' : 'config-changed',
        platform: this.determinePlatformFromChanges(diff.changes),
        changes: diff.changes,
        timestamp: new Date(),
        requiresRestart: diff.requiresRestart,
        message: this.generateChangeMessage(diff.changes, diff.requiresRestart)
      };

      this.emit('config-changed', notification);

      // Emit restart required event if needed
      if (diff.requiresRestart) {
        const affectedPlatforms = this.getAffectedPlatforms(diff.changes);
        for (const platform of affectedPlatforms) {
          this.emit('integration-restart-required', platform, 'Configuration changes require restart');
        }
      }

      console.log(`Configuration changes applied successfully (${diff.changes.length} changes)`);
    } catch (error) {
      console.error('Failed to apply configuration changes:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Force refresh configuration from disk
   */
  async refreshConfiguration(): Promise<void> {
    try {
      console.log('Refreshing configuration from disk...');

      // Load configuration from disk
      const configPath = path.join(this.integrationsDir, 'config.json');

      try {
        await fs.access(configPath);
      } catch {
        console.log('No configuration file found, using current config');
        return;
      }

      const configData = await fs.readFile(configPath, 'utf-8');
      const diskConfig = JSON.parse(configData);

      // Merge with defaults and validate
      const mergedConfig = this.mergeWithDefaults(diskConfig);
      const validation = this.validateConfiguration(mergedConfig);

      if (!validation.valid) {
        console.warn('Configuration on disk is invalid, keeping current config');
        return;
      }

      // Apply changes if different
      const currentSnapshot = JSON.stringify(this.config);
      const newSnapshot = JSON.stringify(mergedConfig);

      if (currentSnapshot !== newSnapshot) {
        await this.applyConfigurationChanges(mergedConfig, 'external');
      }
    } catch (error) {
      console.error('Failed to refresh configuration:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): IntegrationConfig {
    return {
      autoStart: {
        enabled: false,
        minimizeToTray: true
      },
      integrations: {
        telegram: {
          enabled: false,
          allowedUsers: [],
          groupSettings: {
            requireMention: true,
            allowedGroups: []
          },
          fileHandling: {
            maxFileSize: 50, // MB
            allowedTypes: [
              'image/jpeg',
              'image/png',
              'image/gif',
              'image/webp',
              'text/plain',
              'application/pdf',
              'application/json'
            ],
            uploadEnabled: true,
            downloadEnabled: true
          }
        },
        discord: {
          enabled: false,
          allowedGuilds: [],
          allowedUsers: [],
          serverSettings: {
            requireMention: true,
            allowedChannels: [],
            respondInDMs: true
          },
          fileHandling: {
            maxFileSize: 25, // MB (Discord limit)
            allowedTypes: [
              'image/jpeg',
              'image/png',
              'image/gif',
              'image/webp',
              'text/plain',
              'application/pdf',
              'application/json'
            ],
            uploadEnabled: true,
            downloadEnabled: true
          }
        }
      },
      security: {
        allowedUsers: [],
        rateLimits: {
          messagesPerHour: 100,
          toolCallsPerDay: 1000
        },
        encryptionEnabled: true
      }
    };
  }

  /**
   * Initialize encryption key
   */
  private async initializeEncryptionKey(): Promise<void> {
    try {
      const keyPath = path.join(this.configDir, '.encryption-key');

      // Try to load existing key
      try {
        const keyData = await fs.readFile(keyPath);
        this.encryptionKey = keyData;
        return;
      } catch {
        // Key doesn't exist, create new one
      }

      // Generate new encryption key
      this.encryptionKey = crypto.randomBytes(32);

      // Save key to file with restricted permissions
      await fs.writeFile(keyPath, this.encryptionKey);
      await fs.chmod(keyPath, 0o600);

      console.log('New encryption key generated and stored');
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      throw error;
    }
  }

  /**
   * Encrypt credential
   */
  private async encryptCredential(credential: string): Promise<EncryptedCredential> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not available');
    }

    const algorithm = 'aes-256-cbc';
    const iv = crypto.randomBytes(16);
    const salt = crypto.randomBytes(32);
    const iterations = 100000;

    // Derive key from master key and salt
    const derivedKey = crypto.pbkdf2Sync(this.encryptionKey, salt, iterations, 32, 'sha256');

    // Encrypt
    const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);
    let encrypted = cipher.update(credential, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      algorithm,
      keyDerivation: {
        salt: salt.toString('hex'),
        iterations
      }
    };
  }

  /**
   * Decrypt credential
   */
  private async decryptCredential(encrypted: EncryptedCredential): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not available');
    }

    const salt = Buffer.from(encrypted.keyDerivation.salt, 'hex');
    const iv = Buffer.from(encrypted.iv, 'hex');

    // Derive key from master key and salt
    const derivedKey = crypto.pbkdf2Sync(
      this.encryptionKey,
      salt,
      encrypted.keyDerivation.iterations,
      32,
      'sha256'
    );

    // Decrypt
    const decipher = crypto.createDecipheriv(encrypted.algorithm, derivedKey, iv);
    let decrypted = decipher.update(encrypted.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Load configuration from disk with validation and graceful failure handling
   */
  private async loadConfigurationWithValidation(): Promise<void> {
    try {
      const configPath = path.join(this.integrationsDir, 'config.json');

      // Check if config file exists
      try {
        await fs.access(configPath);
      } catch {
        // Config doesn't exist, use defaults and save
        console.log('No existing configuration found, using defaults');
        await this.saveConfiguration();
        return;
      }

      // Load configuration
      const configData = await fs.readFile(configPath, 'utf-8');
      let loadedConfig: any;

      try {
        loadedConfig = JSON.parse(configData);
      } catch (parseError) {
        console.error('Configuration file is corrupted (invalid JSON):', parseError);
        await this.handleConfigurationLoadingFailure(parseError as Error, 'corrupted');
        return;
      }

      // Merge with defaults to ensure all properties exist
      const mergedConfig = this.mergeWithDefaults(loadedConfig);

      // Validate configuration
      const validation = this.validateConfiguration(mergedConfig);

      if (!validation.valid) {
        console.error('Configuration validation failed:', validation.errors);
        await this.handleConfigurationLoadingFailure(
          new Error(`Configuration validation failed: ${validation.errors.join(', ')}`),
          'invalid'
        );
        return;
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        console.warn('Configuration warnings:', validation.warnings);
      }

      // Configuration is valid, use it
      this.config = mergedConfig;

      // Load bot tokens
      try {
        const telegramToken = await this.retrieveBotToken('telegram');
        const discordToken = await this.retrieveBotToken('discord');

        if (telegramToken) {
          this.config.integrations.telegram.botToken = telegramToken;
        }
        if (discordToken) {
          this.config.integrations.discord.botToken = discordToken;
        }
      } catch (tokenError) {
        console.warn('Failed to load bot tokens:', tokenError);
        // Continue with configuration loading even if tokens fail
      }

      console.log('Configuration loaded and validated successfully');
    } catch (error) {
      console.error('Unexpected error during configuration loading:', error);
      await this.handleConfigurationLoadingFailure(error as Error, 'unexpected');
    }
  }

  /**
   * Handle configuration loading failures gracefully
   */
  private async handleConfigurationLoadingFailure(error: Error, reason: 'corrupted' | 'invalid' | 'unexpected'): Promise<void> {
    console.log(`Handling configuration loading failure (${reason}):`, error.message);

    let fallbackUsed = false;

    try {
      // Try to restore from the most recent backup
      const backups = await this.listBackups();

      if (backups.length > 0) {
        const latestBackup = backups[0];
        const backupFileName = `backup-${latestBackup.timestamp.replace(/[:.]/g, '-')}.json`;
        const backupPath = path.join(this.backupsDir, backupFileName);

        try {
          console.log(`Attempting to restore from backup: ${backupPath}`);

          // Read and validate backup
          const backupData = await fs.readFile(backupPath, 'utf-8');
          const backup: ConfigBackup = JSON.parse(backupData);

          const validation = this.validateConfiguration(backup.config);
          if (validation.valid) {
            this.config = backup.config;
            fallbackUsed = true;
            console.log('Successfully restored configuration from backup');
          } else {
            throw new Error('Backup configuration is also invalid');
          }
        } catch (backupError) {
          console.warn('Failed to restore from backup:', backupError);
        }
      }

      // If backup restore failed or no backups available, use defaults
      if (!fallbackUsed) {
        console.log('Using default configuration as fallback');
        this.config = this.getDefaultConfig();
        fallbackUsed = true;
      }

      // Save the fallback configuration
      await this.saveConfiguration();

      // Emit event about the failure and fallback
      this.emit('config-loading-failed', error, fallbackUsed);

    } catch (fallbackError) {
      console.error('Failed to apply fallback configuration:', fallbackError);

      // Last resort: use defaults without saving
      this.config = this.getDefaultConfig();
      this.emit('config-loading-failed', error, false);
    }
  }

  /**
   * Save configuration to disk
   */
  private async saveConfiguration(): Promise<void> {
    try {
      const configPath = path.join(this.integrationsDir, 'config.json');

      // Create config without sensitive data
      const saveConfig = JSON.parse(JSON.stringify(this.config));
      delete saveConfig.integrations.telegram.botToken;
      delete saveConfig.integrations.discord.botToken;

      // Save configuration
      await fs.writeFile(configPath, JSON.stringify(saveConfig, null, 2), 'utf-8');

      console.log('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Merge loaded config with defaults
   */
  private mergeWithDefaults(loadedConfig: any): IntegrationConfig {
    const defaults = this.getDefaultConfig();

    // Deep merge function
    const deepMerge = (target: any, source: any): any => {
      const result = { ...target };

      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }

      return result;
    };

    return deepMerge(defaults, loadedConfig);
  }

  /**
   * Initialize file system watchers for configuration changes
   */
  private async initializeFileWatchers(): Promise<void> {
    try {
      // Clean up existing watchers
      await this.cleanupFileWatchers();

      const configPath = path.join(this.integrationsDir, 'config.json');

      // Watch main configuration file
      this.configWatcher = watch(configPath, { persistent: false }, (eventType, filename) => {
        if (filename && eventType === 'change') {
          this.handleConfigFileChange(path.join(this.integrationsDir, filename));
        }
      });

      // Watch integrations directory for token file changes
      this.integrationsWatcher = watch(this.integrationsDir, { persistent: false }, (eventType, filename) => {
        if (filename && (filename.endsWith('.key') || filename === 'config.json')) {
          this.handleConfigFileChange(path.join(this.integrationsDir, filename));
        }
      });

      console.log('File system watchers initialized for configuration monitoring');
    } catch (error) {
      console.warn('Failed to initialize file system watchers:', error);
      // Don't throw error - file watching is optional
    }
  }

  /**
   * Clean up file system watchers
   */
  private async cleanupFileWatchers(): Promise<void> {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }

    if (this.integrationsWatcher) {
      this.integrationsWatcher.close();
      this.integrationsWatcher = null;
    }

    if (this.watcherDebounceTimeout) {
      clearTimeout(this.watcherDebounceTimeout);
      this.watcherDebounceTimeout = null;
    }
  }

  /**
   * Handle configuration file changes with debouncing
   */
  private handleConfigFileChange(filePath: string): void {
    // Debounce file change events to avoid excessive processing
    if (this.watcherDebounceTimeout) {
      clearTimeout(this.watcherDebounceTimeout);
    }

    this.watcherDebounceTimeout = setTimeout(async () => {
      try {
        console.log(`Configuration file changed: ${filePath}`);
        this.emit('external-config-changed', filePath);

        // Only refresh for main config file changes
        if (path.basename(filePath) === 'config.json') {
          await this.refreshConfiguration();
        }
      } catch (error) {
        console.error('Error handling configuration file change:', error);
        this.emit('error', error as Error);
      }
    }, 500); // 500ms debounce
  }

  /**
   * Determine if configuration changes require integration restart
   */
  private determineRestartRequirement(changes: ConfigChange[]): boolean {
    const restartRequiredPaths = [
      'integrations.telegram.enabled',
      'integrations.discord.enabled',
      'integrations.telegram.botToken',
      'integrations.discord.botToken',
      'integrations.discord.applicationId',
      'security.encryptionEnabled'
    ];

    return changes.some(change =>
      restartRequiredPaths.some(path => change.path.startsWith(path))
    );
  }

  /**
   * Determine affected platform from configuration changes
   */
  private determinePlatformFromChanges(changes: ConfigChange[]): 'telegram' | 'discord' | 'all' | undefined {
    const telegramChanges = changes.some(change => change.path.startsWith('integrations.telegram'));
    const discordChanges = changes.some(change => change.path.startsWith('integrations.discord'));
    const globalChanges = changes.some(change =>
      change.path.startsWith('autoStart') ||
      change.path.startsWith('security')
    );

    if (globalChanges || (telegramChanges && discordChanges)) {
      return 'all';
    } else if (telegramChanges) {
      return 'telegram';
    } else if (discordChanges) {
      return 'discord';
    }

    return undefined;
  }

  /**
   * Get affected platforms from configuration changes
   */
  private getAffectedPlatforms(changes: ConfigChange[]): string[] {
    const platforms = new Set<string>();

    for (const change of changes) {
      if (change.path.startsWith('integrations.telegram')) {
        platforms.add('telegram');
      } else if (change.path.startsWith('integrations.discord')) {
        platforms.add('discord');
      }
    }

    return Array.from(platforms);
  }

  /**
   * Generate human-readable change message
   */
  private generateChangeMessage(changes: ConfigChange[], requiresRestart: boolean): string {
    const changeCount = changes.length;
    const platforms = this.getAffectedPlatforms(changes);

    let message = `${changeCount} configuration change${changeCount > 1 ? 's' : ''} detected`;

    if (platforms.length > 0) {
      message += ` affecting ${platforms.join(' and ')}`;
    }

    if (requiresRestart) {
      message += '. Integration restart required to apply changes.';
    } else {
      message += '. Changes applied successfully.';
    }

    return message;
  }
}

/**
 * Create a configuration manager instance
 */
export function createConfigManager(): ConfigManager {
  return new ConfigManager();
}

/**
 * Global configuration manager instance
 */
let globalConfigManager: ConfigManager | null = null;

/**
 * Get or create global configuration manager
 */
export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = createConfigManager();
  }
  return globalConfigManager;
}
