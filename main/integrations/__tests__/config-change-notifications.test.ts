/**
 * Tests for configuration change notifications functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConfigManager, ConfigChange, ConfigDiff } from '../config-manager';
import { NotificationService } from '../notification-service';
import { RestartCoordinator } from '../restart-coordinator';
import { IntegrationService } from '../integration-service';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    access: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn()
  },
  watch: vi.fn()
}));

const mockFs = fs as any;

describe('ConfigManager - Configuration Change Notifications', () => {
  let configManager: ConfigManager;
  let testConfigDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    testConfigDir = path.join(os.tmpdir(), 'everfern-test-config');
    configManager = new ConfigManager();

    // Mock successful directory creation and file operations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.chmod.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('{}');
    mockFs.access.mockRejectedValue(new Error('File not found'));
    mockFs.readdir.mockResolvedValue([]);
  });

  describe('detectConfigurationChanges', () => {
    it('should detect no changes when configurations are identical', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();

      const diff = configManager.detectConfigurationChanges(currentConfig);

      expect(diff.hasChanges).toBe(false);
      expect(diff.changes).toHaveLength(0);
      expect(diff.requiresRestart).toBe(false);
    });

    it('should detect simple property changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            enabled: !currentConfig.integrations.telegram.enabled
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0]).toEqual({
        path: 'integrations.telegram.enabled',
        oldValue: currentConfig.integrations.telegram.enabled,
        newValue: newConfig.integrations.telegram.enabled,
        type: 'modified'
      });
    });

    it('should detect nested object changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            groupSettings: {
              ...currentConfig.integrations.telegram.groupSettings,
              requireMention: !currentConfig.integrations.telegram.groupSettings.requireMention
            }
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].path).toBe('integrations.telegram.groupSettings.requireMention');
    });

    it('should detect array changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            allowedUsers: ['user1', 'user2']
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0].path).toBe('integrations.telegram.allowedUsers');
    });

    it('should detect added properties', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            newProperty: 'new value'
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig as any);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0]).toEqual({
        path: 'integrations.telegram.newProperty',
        oldValue: undefined,
        newValue: 'new value',
        type: 'added'
      });
    });

    it('should detect removed properties', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram
          }
        }
      };
      delete (newConfig.integrations.telegram as any).allowedUsers;

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changes).toHaveLength(1);
      expect(diff.changes[0]).toEqual({
        path: 'integrations.telegram.allowedUsers',
        oldValue: currentConfig.integrations.telegram.allowedUsers,
        newValue: undefined,
        type: 'removed'
      });
    });

    it('should determine restart requirement for critical changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            enabled: !currentConfig.integrations.telegram.enabled
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.requiresRestart).toBe(true);
    });

    it('should not require restart for non-critical changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            fileHandling: {
              ...currentConfig.integrations.telegram.fileHandling,
              maxFileSize: 100
            }
          }
        }
      };

      const diff = configManager.detectConfigurationChanges(newConfig);

      expect(diff.requiresRestart).toBe(false);
    });
  });

  describe('applyConfigurationChanges', () => {
    it('should emit config-changed event for successful changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            fileHandling: {
              ...currentConfig.integrations.telegram.fileHandling,
              maxFileSize: 100
            }
          }
        }
      };

      const configChangedSpy = vi.fn();
      configManager.on('config-changed', configChangedSpy);

      await configManager.applyConfigurationChanges(newConfig);

      expect(configChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'config-changed',
          changes: expect.any(Array),
          requiresRestart: false
        })
      );
    });

    it('should emit integration-restart-required event for critical changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            enabled: !currentConfig.integrations.telegram.enabled
          }
        }
      };

      const restartRequiredSpy = vi.fn();
      configManager.on('integration-restart-required', restartRequiredSpy);

      await configManager.applyConfigurationChanges(newConfig);

      expect(restartRequiredSpy).toHaveBeenCalledWith('telegram', 'Configuration changes require restart');
    });

    it('should create backup before applying changes', async () => {
      await configManager.initialize();
      const currentConfig = configManager.getConfig();
      const newConfig = {
        ...currentConfig,
        integrations: {
          ...currentConfig.integrations,
          telegram: {
            ...currentConfig.integrations.telegram,
            enabled: !currentConfig.integrations.telegram.enabled
          }
        }
      };

      const createBackupSpy = vi.spyOn(configManager, 'createBackup');
      createBackupSpy.mockResolvedValue('/path/to/backup');

      await configManager.applyConfigurationChanges(newConfig);

      expect(createBackupSpy).toHaveBeenCalledWith('Pre-change backup (user)');
    });

    it('should reject invalid configuration changes', async () => {
      await configManager.initialize();
      const invalidConfig = {
        integrations: {
          telegram: {
            enabled: 'invalid' // Should be boolean
          }
        }
      } as any;

      await expect(configManager.applyConfigurationChanges(invalidConfig))
        .rejects.toThrow('Configuration validation failed');
    });
  });
});

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = new NotificationService();
  });

  describe('createConfigChangeNotification', () => {
    it('should create notification for config changes', () => {
      const configNotification = {
        type: 'config-changed' as const,
        platform: 'telegram' as const,
        changes: [{
          path: 'integrations.telegram.enabled',
          oldValue: false,
          newValue: true,
          type: 'modified' as const
        }],
        timestamp: new Date(),
        requiresRestart: false,
        message: 'Configuration updated successfully'
      };

      const notification = notificationService.createConfigChangeNotification(configNotification);

      expect(notification.type).toBe('success');
      expect(notification.title).toBe('Telegram Configuration Updated');
      expect(notification.message).toBe('Configuration updated successfully');
      expect(notification.persistent).toBe(false);
    });

    it('should create persistent notification for restart-required changes', () => {
      const configNotification = {
        type: 'integration-restart-required' as const,
        platform: 'discord' as const,
        changes: [{
          path: 'integrations.discord.enabled',
          oldValue: false,
          newValue: true,
          type: 'modified' as const
        }],
        timestamp: new Date(),
        requiresRestart: true,
        message: 'Integration restart required'
      };

      const notification = notificationService.createConfigChangeNotification(configNotification);

      expect(notification.type).toBe('restart-required');
      expect(notification.title).toBe('Discord Restart Required');
      expect(notification.persistent).toBe(true);
      expect(notification.actions).toHaveLength(2);
    });
  });

  describe('notification management', () => {
    it('should auto-dismiss non-persistent notifications', (done) => {
      const notification = notificationService.createNotification(
        'info',
        'Test',
        'Test message',
        { persistent: false }
      );

      expect(notificationService.getNotifications()).toHaveLength(1);

      // Wait for auto-dismiss (5 seconds + buffer)
      setTimeout(() => {
        expect(notificationService.getNotifications()).toHaveLength(0);
        done();
      }, 100); // Use shorter timeout for testing
    }, 10000);

    it('should keep persistent notifications', () => {
      const notification = notificationService.createNotification(
        'warning',
        'Test',
        'Test message',
        { persistent: true }
      );

      expect(notificationService.getNotifications()).toHaveLength(1);
      expect(notificationService.getNotifications()[0].persistent).toBe(true);
    });

    it('should dismiss notifications by type', () => {
      notificationService.createNotification('info', 'Info', 'Info message');
      notificationService.createNotification('warning', 'Warning', 'Warning message');
      notificationService.createNotification('info', 'Info 2', 'Info message 2');

      expect(notificationService.getNotifications()).toHaveLength(3);

      notificationService.dismissNotificationsByType('info');

      const remaining = notificationService.getNotifications();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].type).toBe('warning');
    });
  });
});

describe('RestartCoordinator', () => {
  let restartCoordinator: RestartCoordinator;

  beforeEach(() => {
    restartCoordinator = new RestartCoordinator();
  });

  describe('integration management', () => {
    it('should register and track integrations', () => {
      restartCoordinator.registerIntegration('telegram');
      restartCoordinator.registerIntegration('discord');

      const statuses = restartCoordinator.getAllIntegrationStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map(s => s.platform)).toEqual(['telegram', 'discord']);
    });

    it('should update integration status', () => {
      restartCoordinator.registerIntegration('telegram');

      const statusChangedSpy = vi.fn();
      restartCoordinator.on('integration-status-changed', statusChangedSpy);

      restartCoordinator.updateIntegrationStatus('telegram', 'running');

      expect(statusChangedSpy).toHaveBeenCalledWith('telegram', 'running');

      const status = restartCoordinator.getIntegrationStatus('telegram');
      expect(status?.status).toBe('running');
      expect(status?.lastStarted).toBeInstanceOf(Date);
    });

    it('should track integration errors', () => {
      restartCoordinator.registerIntegration('telegram');

      restartCoordinator.updateIntegrationStatus('telegram', 'error', 'Connection failed');

      const status = restartCoordinator.getIntegrationStatus('telegram');
      expect(status?.status).toBe('error');
      expect(status?.error).toBe('Connection failed');
    });
  });

  describe('restart operations', () => {
    it('should track restart operations', async () => {
      restartCoordinator.registerIntegration('telegram');

      // Mock the restart process
      const restartPromise = restartCoordinator.restartIntegration('telegram');

      const activeOps = restartCoordinator.getActiveRestartOperations();
      expect(activeOps).toHaveLength(1);
      expect(activeOps[0].platforms).toEqual(['telegram']);
      expect(activeOps[0].status).toBe('in-progress');

      // Simulate successful restart by updating status
      setTimeout(() => {
        restartCoordinator.updateIntegrationStatus('telegram', 'stopped');
        setTimeout(() => {
          restartCoordinator.updateIntegrationStatus('telegram', 'running');
        }, 100);
      }, 50);

      await restartPromise;
    });

    it('should clean up old restart operations', () => {
      // Create multiple completed operations
      for (let i = 0; i < 15; i++) {
        const operation = {
          id: `op-${i}`,
          platforms: ['telegram'],
          status: 'completed' as const,
          startedAt: new Date(Date.now() - i * 1000),
          completedAt: new Date()
        };
        (restartCoordinator as any).restartOperations.set(operation.id, operation);
      }

      restartCoordinator.cleanupRestartOperations();

      const operations = Array.from((restartCoordinator as any).restartOperations.values());
      expect(operations.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('IntegrationService', () => {
  let integrationService: IntegrationService;
  let configManager: ConfigManager;
  let notificationService: NotificationService;
  let restartCoordinator: RestartCoordinator;

  beforeEach(() => {
    configManager = new ConfigManager();
    notificationService = new NotificationService();
    restartCoordinator = new RestartCoordinator();
    integrationService = new IntegrationService(configManager, notificationService, restartCoordinator);

    // Mock fs operations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.chmod.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('{}');
    mockFs.access.mockRejectedValue(new Error('File not found'));
    mockFs.readdir.mockResolvedValue([]);
  });

  describe('initialization', () => {
    it('should initialize all services', async () => {
      const serviceInitializedSpy = vi.fn();
      integrationService.on('service-initialized', serviceInitializedSpy);

      await integrationService.initialize();

      expect(serviceInitializedSpy).toHaveBeenCalled();

      // Check that integrations are registered
      const statuses = integrationService.getAllIntegrationStatuses();
      expect(statuses.map(s => s.platform)).toEqual(['telegram', 'discord']);
    });
  });

  describe('configuration management', () => {
    it('should handle configuration updates with notifications', async () => {
      await integrationService.initialize();

      const notificationCreatedSpy = vi.fn();
      integrationService.on('notification-created', notificationCreatedSpy);

      await integrationService.updateConfiguration({
        integrations: {
          telegram: { enabled: true },
          discord: { enabled: false }
        }
      } as any);

      expect(notificationCreatedSpy).toHaveBeenCalled();
    });

    it('should create error notifications for failed updates', async () => {
      await integrationService.initialize();

      // Mock validation failure
      vi.spyOn(configManager, 'updateConfig').mockRejectedValue(new Error('Validation failed'));

      await expect(integrationService.updateConfiguration({} as any))
        .rejects.toThrow('Validation failed');

      const notifications = integrationService.getNotifications();
      const errorNotification = notifications.find(n => n.type === 'error');
      expect(errorNotification).toBeDefined();
      expect(errorNotification?.title).toBe('Configuration Update Failed');
    });
  });

  describe('token management', () => {
    it('should create success notifications for token storage', async () => {
      await integrationService.initialize();

      vi.spyOn(configManager, 'storeBotToken').mockResolvedValue();

      await integrationService.storeBotToken('telegram', 'test-token');

      const notifications = integrationService.getNotifications();
      const successNotification = notifications.find(n => n.type === 'success');
      expect(successNotification).toBeDefined();
      expect(successNotification?.title).toBe('Bot Token Stored');
    });

    it('should create error notifications for token storage failures', async () => {
      await integrationService.initialize();

      vi.spyOn(configManager, 'storeBotToken').mockRejectedValue(new Error('Storage failed'));

      await expect(integrationService.storeBotToken('telegram', 'test-token'))
        .rejects.toThrow('Storage failed');

      const notifications = integrationService.getNotifications();
      const errorNotification = notifications.find(n => n.type === 'error');
      expect(errorNotification).toBeDefined();
      expect(errorNotification?.title).toBe('Token Storage Failed');
    });
  });
});
