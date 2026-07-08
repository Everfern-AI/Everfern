/**
 * Unit Tests for ConfigManager
 *
 * Tests secure configuration storage, encryption, validation, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager, IntegrationConfig } from '../config-manager';

// Mock crypto module
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from('mock-random-bytes-32-chars-long')),
    pbkdf2Sync: vi.fn(() => Buffer.from('mock-derived-key-32-chars-long')),
    createCipher: vi.fn(() => ({
      update: vi.fn(() => 'encrypted-data'),
      final: vi.fn(() => '-final')
    })),
    createDecipher: vi.fn(() => ({
      update: vi.fn(() => 'decrypted-data'),
      final: vi.fn(() => '')
    })),
    randomUUID: vi.fn(() => 'mock-uuid-1234-5678-9012')
  };
});

// Mock file system operations
const mockedFs = vi.hoisted(() => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    unlink: vi.fn(),
    chmod: vi.fn()
  },
  watch: vi.fn()
}));

vi.mock('fs', () => ({
  ...mockedFs,
  default: mockedFs
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home'),
  default: {
    homedir: vi.fn(() => '/mock/home')
  }
}));

const p = (str: string) => str.replace(/\//g, path.sep);

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const mockFs = fs as any;
  const mockHomedir = '/mock/home';

  beforeEach(() => {
    vi.clearAllMocks();

    // Set default filesystem mock behaviors
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.chmod.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);

    // Simulate non-existent files by default
    const enoent = new Error('ENOENT: no such file or directory');
    (enoent as any).code = 'ENOENT';
    mockFs.access.mockRejectedValue(enoent);
    mockFs.readFile.mockRejectedValue(enoent);

    configManager = new ConfigManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found')); // Config doesn't exist
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);

      await expect(configManager.initialize()).resolves.not.toThrow();

      // Should create directories
      expect(mockFs.mkdir).toHaveBeenCalledWith(p(`${mockHomedir}/.everfern`), { recursive: true });
      expect(mockFs.mkdir).toHaveBeenCalledWith(p(`${mockHomedir}/.everfern/integrations`), { recursive: true });
      expect(mockFs.mkdir).toHaveBeenCalledWith(p(`${mockHomedir}/.everfern/integrations/backups`), { recursive: true });
    });

    it('should handle initialization errors gracefully', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(configManager.initialize()).rejects.toThrow('Permission denied');
    });

    it('should emit config-loaded event on successful initialization', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);

      const eventSpy = vi.fn();
      configManager.on('config-loaded', eventSpy);

      await configManager.initialize();

      expect(eventSpy).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('configuration management', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should return default configuration initially', () => {
      const config = configManager.getConfig();

      expect(config).toMatchObject({
        autoStart: {
          enabled: false,
          minimizeToTray: true
        },
        integrations: {
          telegram: {
            enabled: false,
            groupSettings: {
              requireMention: true
            }
          },
          discord: {
            enabled: false,
            serverSettings: {
              requireMention: true,
              respondInDMs: true
            }
          }
        },
        security: {
          encryptionEnabled: true
        }
      });
    });

    it('should update configuration successfully', async () => {
      const updates: Partial<IntegrationConfig> = {
        autoStart: {
          enabled: true,
          minimizeToTray: false
        }
      };

      const eventSpy = vi.fn();
      configManager.on('config-saved', eventSpy);

      await configManager.updateConfig(updates);

      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(true);
      expect(config.autoStart.minimizeToTray).toBe(false);
      expect(eventSpy).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should reject invalid configuration updates', async () => {
      const invalidUpdates = {
        security: {
          rateLimits: {
            messagesPerHour: -1, // Invalid: negative value
            toolCallsPerDay: 1000
          }
        }
      } as any;

      await expect(configManager.updateConfig(invalidUpdates))
        .rejects.toThrow('Configuration validation failed');
    });
  });

  describe('bot token management', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should store bot token securely', async () => {
      const token = 'test-telegram-token';
      const eventSpy = vi.fn();
      configManager.on('credential-stored', eventSpy);

      await configManager.storeBotToken('telegram', token);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        p(`${mockHomedir}/.everfern/integrations/telegram.key`),
        expect.stringContaining('encrypted'),
        'utf-8'
      );
      expect(mockFs.chmod).toHaveBeenCalledWith(
        p(`${mockHomedir}/.everfern/integrations/telegram.key`),
        0o600
      );
      expect(eventSpy).toHaveBeenCalledWith('telegram');
    });

    it('should retrieve bot token successfully', async () => {
      const originalToken = 'test-telegram-token';

      // First store the token
      await configManager.storeBotToken('telegram', originalToken);

      // Get the encrypted data that was written
      const writeCall = mockFs.writeFile.mock.calls.find(call =>
        call[0].includes('telegram.key')
      );
      const encryptedData = writeCall[1];

      // Mock reading the encrypted data
      mockFs.access.mockResolvedValue(undefined); // File exists
      mockFs.readFile.mockResolvedValue(encryptedData);

      const eventSpy = vi.fn();
      configManager.on('credential-retrieved', eventSpy);

      const retrievedToken = await configManager.retrieveBotToken('telegram');

      expect(retrievedToken).toBe(originalToken);
      expect(eventSpy).toHaveBeenCalledWith('telegram');
    });

    it('should return null for non-existent token', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const token = await configManager.retrieveBotToken('discord');

      expect(token).toBeNull();
    });

    it('should delete bot token successfully', async () => {
      await configManager.deleteBotToken('telegram');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        p(`${mockHomedir}/.everfern/integrations/telegram.key`)
      );
    });

    it('should handle deletion of non-existent token gracefully', async () => {
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      mockFs.unlink.mockRejectedValue(error);

      await expect(configManager.deleteBotToken('telegram')).resolves.not.toThrow();
    });
  });

  describe('configuration validation', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should validate valid configuration', () => {
      const config = configManager.getConfig();
      const result = configManager.validateConfiguration(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid Telegram file size', () => {
      const config = configManager.getConfig();
      config.integrations.telegram.enabled = true;
      config.integrations.telegram.fileHandling.maxFileSize = 0;

      const result = configManager.validateConfiguration(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Telegram max file size must be greater than 0');
    });

    it('should detect Discord file size exceeding limit', () => {
      const config = configManager.getConfig();
      config.integrations.discord.enabled = true;
      config.integrations.discord.fileHandling.maxFileSize = 30; // Exceeds 25MB limit

      const result = configManager.validateConfiguration(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Discord max file size cannot exceed 25MB (Discord limit)');
    });

    it('should detect invalid rate limits', () => {
      const config = configManager.getConfig();
      config.security.rateLimits.messagesPerHour = -1;
      config.security.rateLimits.toolCallsPerDay = 0;

      const result = configManager.validateConfiguration(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Messages per hour rate limit must be greater than 0');
      expect(result.errors).toContain('Tool calls per day rate limit must be greater than 0');
    });

    it('should generate warnings for potential issues', () => {
      const config = configManager.getConfig();
      config.integrations.telegram.enabled = true;
      config.integrations.telegram.fileHandling.maxFileSize = 60; // Exceeds recommended limit
      config.integrations.telegram.fileHandling.allowedTypes = []; // No allowed types

      const result = configManager.validateConfiguration(config);

      expect(result.warnings).toContain('Telegram max file size exceeds recommended limit of 50MB');
      expect(result.warnings).toContain('No allowed file types specified for Telegram');
    });

    it('should emit config-validated event', () => {
      const config = configManager.getConfig();
      const eventSpy = vi.fn();
      configManager.on('config-validated', eventSpy);

      configManager.validateConfiguration(config);

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        valid: expect.any(Boolean),
        errors: expect.any(Array),
        warnings: expect.any(Array)
      }));
    });
  });

  describe('configuration reset', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should reset configuration to defaults', async () => {
      // First modify the configuration
      await configManager.updateConfig({
        autoStart: { enabled: true, minimizeToTray: false }
      });

      const eventSpy = vi.fn();
      configManager.on('config-saved', eventSpy);

      // Reset configuration
      await configManager.resetConfiguration();

      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(false);
      expect(config.autoStart.minimizeToTray).toBe(true);
      expect(eventSpy).toHaveBeenCalled();

      // Should delete stored tokens
      expect(mockFs.unlink).toHaveBeenCalledWith(p(`${mockHomedir}/.everfern/integrations/telegram.key`));
      expect(mockFs.unlink).toHaveBeenCalledWith(p(`${mockHomedir}/.everfern/integrations/discord.key`));
    });
  });

  describe('configuration export/import', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should export configuration without sensitive data', async () => {
      const exported = await configManager.exportConfiguration();
      const exportedConfig = JSON.parse(exported);

      expect(exportedConfig.integrations.telegram.botToken).toBeUndefined();
      expect(exportedConfig.integrations.discord.botToken).toBeUndefined();
      expect(exportedConfig.autoStart).toBeDefined();
      expect(exportedConfig.security).toBeDefined();
    });

    it('should import valid configuration', async () => {
      const importConfig = {
        autoStart: { enabled: true, minimizeToTray: false },
        integrations: {
          telegram: {
            enabled: true,
            groupSettings: { requireMention: false },
            fileHandling: {
              maxFileSize: 40,
              allowedTypes: ['image/jpeg'],
              uploadEnabled: true,
              downloadEnabled: true
            }
          },
          discord: {
            enabled: false,
            serverSettings: {
              requireMention: true,
              respondInDMs: false
            },
            fileHandling: {
              maxFileSize: 20,
              allowedTypes: ['image/png'],
              uploadEnabled: false,
              downloadEnabled: true
            }
          }
        },
        security: {
          allowedUsers: ['user1'],
          rateLimits: { messagesPerHour: 50, toolCallsPerDay: 500 },
          encryptionEnabled: true
        }
      };

      const eventSpy = vi.fn();
      configManager.on('config-saved', eventSpy);

      await configManager.importConfiguration(JSON.stringify(importConfig));

      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(true);
      expect(config.integrations.telegram.enabled).toBe(true);
      expect(config.integrations.telegram.groupSettings.requireMention).toBe(false);
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should reject invalid imported configuration', async () => {
      const invalidConfig = {
        security: {
          rateLimits: { messagesPerHour: -1, toolCallsPerDay: 0 }
        }
      };

      await expect(configManager.importConfiguration(JSON.stringify(invalidConfig)))
        .rejects.toThrow('Invalid configuration');
    });

    it('should handle malformed JSON during import', async () => {
      await expect(configManager.importConfiguration('invalid json'))
        .rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should emit error events on failures', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const errorSpy = vi.fn();
      configManager.on('error', errorSpy);

      await expect(configManager.initialize()).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle encryption key initialization failure', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Read error'));
      mockFs.writeFile.mockRejectedValue(new Error('Write error'));

      await expect(configManager.initialize()).rejects.toThrow();
    });

    it('should handle token storage failure', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();

      // Mock failure during token storage
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      const errorSpy = vi.fn();
      configManager.on('error', errorSpy);

      await expect(configManager.storeBotToken('telegram', 'token'))
        .rejects.toThrow('Write failed');
      expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('encryption/decryption', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      await configManager.initialize();
    });

    it('should encrypt and decrypt tokens correctly', async () => {
      const originalToken = 'test-token-12345';

      // Store token (encrypts)
      await configManager.storeBotToken('telegram', originalToken);

      // Get the encrypted data
      const writeCall = mockFs.writeFile.mock.calls.find(call =>
        call[0].includes('telegram.key')
      );
      const encryptedData = writeCall[1];

      // Verify it's actually encrypted (not plain text)
      expect(encryptedData).not.toContain(originalToken);
      expect(encryptedData).toContain('encrypted');
      expect(encryptedData).toContain('algorithm');

      // Mock reading the encrypted data
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(encryptedData);

      // Retrieve token (decrypts)
      const retrievedToken = await configManager.retrieveBotToken('telegram');

      expect(retrievedToken).toBe(originalToken);
    });

    it('should handle decryption of corrupted data', async () => {
      configManager.on('error', () => {});
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('corrupted data');

      const token = await configManager.retrieveBotToken('telegram');

      expect(token).toBeNull();
    });
  });

  describe('configuration backup and restore', () => {
    beforeEach(async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockRejectedValue(new Error('File not found'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);
      await configManager.initialize();
    });

    it('should create configuration backup with metadata', async () => {
      const description = 'Test backup';
      const eventSpy = vi.fn();
      configManager.on('config-backup-created', eventSpy);

      const backupPath = await configManager.createBackup(description);

      expect(backupPath).toContain(p(`${mockHomedir}/.everfern/integrations/backups/backup-`));
      expect(backupPath).toMatch(/\.json$/);

      // Verify backup file was written
      const backupWriteCall = mockFs.writeFile.mock.calls.find(call =>
        call[0].includes(p('backups/backup-'))
      );
      expect(backupWriteCall).toBeDefined();

      const backupData = JSON.parse(backupWriteCall[1]);
      expect(backupData.metadata).toMatchObject({
        description,
        version: '1.0.0',
        platforms: [],
        size: expect.any(Number)
      });
      expect(backupData.config).toBeDefined();
      expect(backupData.config.integrations.telegram.botToken).toBeUndefined();
      expect(backupData.config.integrations.discord.botToken).toBeUndefined();

      expect(mockFs.chmod).toHaveBeenCalledWith(backupPath, 0o600);
      expect(eventSpy).toHaveBeenCalledWith(backupPath, expect.any(Object));
    });

    it('should create backup with enabled platforms in metadata', async () => {
      // Enable platforms
      await configManager.updateConfig({
        integrations: {
          telegram: { ...configManager.getConfig().integrations.telegram, enabled: true },
          discord: { ...configManager.getConfig().integrations.discord, enabled: true }
        }
      });

      await configManager.createBackup('Platform test');

      // Find the backup write call
      const backupWriteCalls = mockFs.writeFile.mock.calls.filter(call =>
        call[0].includes(p('backups/backup-'))
      );
      expect(backupWriteCalls.length).toBeGreaterThan(0);

      const backupData = JSON.parse(backupWriteCalls[backupWriteCalls.length - 1][1]);
      expect(backupData.metadata.platforms).toEqual(['telegram', 'discord']);
    });

    it('should list available backups sorted by timestamp', async () => {
      const mockBackups = [
        'backup-2024-01-01T10-00-00-000Z.json',
        'backup-2024-01-02T10-00-00-000Z.json',
        'backup-2024-01-01T12-00-00-000Z.json'
      ];

      mockFs.readdir.mockResolvedValue(mockBackups);

      // Mock reading backup files
      mockFs.readFile.mockImplementation((filePath: string) => {
        const filename = path.basename(filePath as string);
                const dateStr = filename.replace('backup-', '').replace('.json', '');
        const parts = dateStr.split('T');
        let timestamp = dateStr;
        if (parts.length === 2) {
          const datePart = parts[0];
          const timePart = parts[1].replace('Z', '').replace(/-/g, ':');
          const lastColon = timePart.lastIndexOf(':');
          const timeWithMillis = lastColon !== -1
            ? timePart.slice(0, lastColon) + '.' + timePart.slice(lastColon + 1)
            : timePart;
          timestamp = `${datePart}T${timeWithMillis}Z`;
        }

        return Promise.resolve(JSON.stringify({
          metadata: {
            timestamp,
            version: '1.0.0',
            description: `Backup ${filename}`,
            platforms: [],
            size: 1000
          },
          config: {}
        }));
      });

      const backups = await configManager.listBackups();

      expect(backups).toHaveLength(3);
      // Should be sorted by timestamp (newest first)
      expect(new Date(backups[0].timestamp).getTime()).toBeGreaterThan(
        new Date(backups[1].timestamp).getTime()
      );
    });

    it('should handle corrupted backup files gracefully', async () => {
      mockFs.readdir.mockResolvedValue(['backup-valid.json', 'backup-corrupted.json']);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes('corrupted')) {
          return Promise.resolve('invalid json');
        }
        return Promise.resolve(JSON.stringify({
          metadata: {
            timestamp: '2024-01-01T10:00:00.000Z',
            version: '1.0.0',
            description: 'Valid backup',
            platforms: [],
            size: 1000
          },
          config: {}
        }));
      });

      const backups = await configManager.listBackups();

      expect(backups).toHaveLength(1);
      expect(backups[0].description).toBe('Valid backup');
    });

    it('should restore configuration from backup', async () => {
      const backupConfig = {
        autoStart: { enabled: true, minimizeToTray: false },
        integrations: {
          telegram: {
            enabled: true,
            groupSettings: { requireMention: false },
            fileHandling: {
              maxFileSize: 40,
              allowedTypes: ['image/jpeg'],
              uploadEnabled: true,
              downloadEnabled: true
            }
          },
          discord: {
            enabled: false,
            serverSettings: { requireMention: true, respondInDMs: false },
            fileHandling: {
              maxFileSize: 20,
              allowedTypes: ['image/png'],
              uploadEnabled: false,
              downloadEnabled: true
            }
          }
        },
        security: {
          allowedUsers: ['user1'],
          rateLimits: { messagesPerHour: 50, toolCallsPerDay: 500 },
          encryptionEnabled: true
        }
      };

      const backupData = {
        metadata: {
          timestamp: '2024-01-01T10:00:00.000Z',
          version: '1.0.0',
          description: 'Test restore',
          platforms: ['telegram'],
          size: 1000
        },
        config: backupConfig
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(backupData));

      const eventSpy = vi.fn();
      configManager.on('config-restored', eventSpy);

      const backupPath = '/mock/backup/path.json';
      await configManager.restoreFromBackup(backupPath);

      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(true);
      expect(config.integrations.telegram.enabled).toBe(true);
      expect(config.integrations.telegram.groupSettings.requireMention).toBe(false);

      expect(eventSpy).toHaveBeenCalledWith(backupPath, backupData.metadata);
    });

    it('should create pre-restore backup before restoring', async () => {
      const backupData = {
        metadata: {
          timestamp: '2024-01-01T10:00:00.000Z',
          version: '1.0.0',
          description: 'Test restore',
          platforms: [],
          size: 1000
        },
        config: configManager.getConfig()
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(backupData));

      await configManager.restoreFromBackup('/mock/backup/path.json');

      // Should have created a pre-restore backup
      const preRestoreBackupCall = mockFs.writeFile.mock.calls.find(call =>
        call[0].includes(p('backups/backup-')) &&
        JSON.parse(call[1]).metadata.description === 'Pre-restore backup'
      );
      expect(preRestoreBackupCall).toBeDefined();
    });

    it('should reject invalid backup configuration', async () => {
      const invalidBackupData = {
        metadata: {
          timestamp: '2024-01-01T10:00:00.000Z',
          version: '1.0.0',
          description: 'Invalid backup',
          platforms: [],
          size: 1000
        },
        config: {
          security: {
            rateLimits: { messagesPerHour: -1, toolCallsPerDay: 0 }
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidBackupData));

      await expect(configManager.restoreFromBackup('/mock/backup/path.json'))
        .rejects.toThrow('Invalid backup configuration');
    });

    it('should delete backup file', async () => {
      const backupPath = '/mock/backup/path.json';

      await configManager.deleteBackup(backupPath);

      expect(mockFs.unlink).toHaveBeenCalledWith(backupPath);
    });

    it('should clean old backups keeping specified count', async () => {
      const mockBackups = Array.from({ length: 15 }, (_, i) =>
        `backup-2024-01-${String(i + 1).padStart(2, '0')}T10-00-00-000Z.json`
      );

      mockFs.readdir.mockResolvedValue(mockBackups);
      mockFs.readFile.mockImplementation((filePath: string) => {
        const filename = path.basename(filePath as string);
        const dayMatch = filename.match(/backup-2024-01-(\d+)T/);
        const day = dayMatch ? parseInt(dayMatch[1]) : 1;

        return Promise.resolve(JSON.stringify({
          metadata: {
            timestamp: `2024-01-${String(day).padStart(2, '0')}T10:00:00.000Z`,
            version: '1.0.0',
            description: `Backup ${day}`,
            platforms: [],
            size: 1000
          },
          config: {}
        }));
      });

      await configManager.cleanOldBackups(5);

      // Should delete 10 old backups (keep only 5 most recent)
      expect(mockFs.unlink).toHaveBeenCalledTimes(10);
    });

    it('should not clean backups if count is within limit', async () => {
      const mockBackups = [
        'backup-2024-01-01T10-00-00-000Z.json',
        'backup-2024-01-02T10-00-00-000Z.json'
      ];

      mockFs.readdir.mockResolvedValue(mockBackups);
      mockFs.readFile.mockImplementation(() =>
        Promise.resolve(JSON.stringify({
          metadata: {
            timestamp: '2024-01-01T10:00:00.000Z',
            version: '1.0.0',
            description: 'Test backup',
            platforms: [],
            size: 1000
          },
          config: {}
        }))
      );

      await configManager.cleanOldBackups(5);

      expect(mockFs.unlink).not.toHaveBeenCalled();
    });
  });

  describe('configuration loading with validation', () => {
    it('should handle corrupted configuration file gracefully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockResolvedValue(undefined); // Config exists
      mockFs.readFile.mockResolvedValue('invalid json');
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]); // No backups

      const eventSpy = vi.fn();
      configManager.on('config-loading-failed', eventSpy);

      await configManager.initialize();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.any(Error),
        true // fallback used
      );

      // Should use default configuration
      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(false);
    });

    it('should restore from backup when main config is invalid', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockResolvedValue(undefined); // Config exists
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes('config.json')) {
          return Promise.resolve('invalid json');
        }
        if (filePath.includes(p('backups/backup-'))) {
          return Promise.resolve(JSON.stringify({
            metadata: {
              timestamp: '2024-01-01T10:00:00.000Z',
              version: '1.0.0',
              description: 'Recovery backup',
              platforms: [],
              size: 1000
            },
            config: {
              autoStart: { enabled: true, minimizeToTray: false },
              integrations: {
                telegram: {
                  enabled: false,
                  groupSettings: { requireMention: true },
                  fileHandling: {
                    maxFileSize: 50,
                    allowedTypes: ['image/jpeg'],
                    uploadEnabled: true,
                    downloadEnabled: true
                  }
                },
                discord: {
                  enabled: false,
                  serverSettings: { requireMention: true, respondInDMs: true },
                  fileHandling: {
                    maxFileSize: 25,
                    allowedTypes: ['image/png'],
                    uploadEnabled: true,
                    downloadEnabled: true
                  }
                }
              },
              security: {
                allowedUsers: [],
                rateLimits: { messagesPerHour: 100, toolCallsPerDay: 1000 },
                encryptionEnabled: true
              }
            }
          }));
        }
        return Promise.reject(new Error('File not found'));
      });

      mockFs.readdir.mockResolvedValue(['backup-2024-01-01T10-00-00-000Z.json']);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);

      const eventSpy = vi.fn();
      configManager.on('config-loading-failed', eventSpy);

      await configManager.initialize();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.any(Error),
        true // fallback used
      );

      // Should use backup configuration
      const config = configManager.getConfig();
      expect(config.autoStart.enabled).toBe(true);
    });

    it('should validate configuration on startup', async () => {
      const invalidConfig = {
        autoStart: { enabled: false, minimizeToTray: true },
        integrations: {
          telegram: {
            enabled: true,
            fileHandling: { maxFileSize: -1 } // Invalid
          }
        },
        security: {
          rateLimits: { messagesPerHour: 0, toolCallsPerDay: 1000 } // Invalid
        }
      };

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.access.mockResolvedValue(undefined); // Config exists
      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidConfig));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]); // No backups

      const eventSpy = vi.fn();
      configManager.on('config-loading-failed', eventSpy);

      await configManager.initialize();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Configuration validation failed')
        }),
        true // fallback used
      );
    });
  });
});
