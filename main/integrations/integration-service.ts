/**
 * Integration Service Manager
 *
 * Manages the lifecycle of all integration services including bot platforms,
 * security monitoring, and cross-platform synchronization.
 */

import { EventEmitter } from 'events';
import { BotIntegrationManager } from './bot-manager';
import { TelegramPlatform } from './telegram-platform';
import { DiscordPlatform } from './discord-platform';
import { UserAuthenticationService } from './user-auth';
import { UserPermissionManager } from './user-permissions';
import { ConversationRouter } from './conversation-router';
import { MessageSyncService } from './message-sync';
import { ContentAdaptationService } from './content-adapter';
import { ConfigManager } from './config-manager';
import { NotificationService } from './notification-service';
import { RestartCoordinator } from './restart-coordinator';
import { SecurityLogger } from './security-logger';
import { AdminNotificationManager } from './admin-notification';
import { DataRetentionManager } from './data-retention';

export interface IntegrationServiceConfig {
  telegram: {
    enabled: boolean;
    botToken: string;
    webhookUrl?: string;
    connected?: boolean;
    model?: string;
    provider?: string;
  };
  discord: {
    enabled: boolean;
    botToken: string;
    applicationId: string;
    webhookUrl?: string;
    connected?: boolean;
    model?: string;
    provider?: string;
  };
  security: {
    enableMonitoring: boolean;
    enableDataRetention: boolean;
    retentionDays: number;
  };
  notifications: {
    enabled: boolean;
    channels: string[];
  };
}

export interface ServiceStatus {
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  error?: string;
  lastStarted?: Date;
  uptime?: number;
}

/**
 * Main integration service manager that coordinates all integration components
 */
export class IntegrationService extends EventEmitter {
  private config: IntegrationServiceConfig;
  private services: Map<string, any> = new Map();
  private serviceStatuses: Map<string, ServiceStatus> = new Map();
  private isInitialized = false;
  private isStarted = false;
  private monitoringInterval?: NodeJS.Timeout;

  // Core services
  private securityLogger?: SecurityLogger;
  private adminNotificationManager?: AdminNotificationManager;
  private dataRetentionManager?: DataRetentionManager;
  private configManager?: ConfigManager;
  private notificationService?: NotificationService;
  private restartCoordinator?: RestartCoordinator;

  // Integration services
  private botIntegrationManager?: BotIntegrationManager;
  private userAuthService?: UserAuthenticationService;
  private userPermissionManager?: UserPermissionManager;
  private conversationRouter?: ConversationRouter;
  private messageSyncService?: MessageSyncService;
  private contentAdaptationService?: ContentAdaptationService;

  constructor(config?: Partial<IntegrationServiceConfig>) {
    super();

    // Default configuration
    this.config = {
      telegram: {
        enabled: false,
        botToken: ''
      },
      discord: {
        enabled: false,
        botToken: '',
        applicationId: '',
        webhookUrl: ''
      },
      security: {
        enableMonitoring: true,
        enableDataRetention: true,
        retentionDays: 90
      },
      notifications: {
        enabled: true,
        channels: ['desktop', 'log']
      },
      ...config
    };
  }

  /**
   * Initialize all integration services
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('[IntegrationService] Initializing integration services...');

      // Initialize core services first
      await this.initializeCoreServices();

      // Initialize integration-specific services
      await this.initializeIntegrationServices();

      // Set up service monitoring
      this.setupServiceMonitoring();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('[IntegrationService] All services initialized successfully');
    } catch (error) {
      console.error('[IntegrationService] Failed to initialize services:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start all enabled services
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isStarted) {
      return;
    }

    try {
      console.log('[IntegrationService] Starting integration services...');

      // Start services in dependency order
      const startOrder = [
        'security-logger',
        'admin-notification-manager',
        'data-retention-manager',
        'config-manager',
        'notification-service',
        'user-auth-service',
        'user-permission-manager',
        'content-adaptation-service',
        'conversation-router',
        'message-sync-service',
        'bot-integration-manager',
        'restart-coordinator'
      ];

      for (const serviceName of startOrder) {
        await this.startService(serviceName);
      }

      this.isStarted = true;
      this.emit('started');

      console.log('[IntegrationService] All services started successfully');
    } catch (error) {
      console.error('[IntegrationService] Failed to start services:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop all services
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      console.log('[IntegrationService] Stopping integration services...');

      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

      // Stop services in reverse dependency order
      const stopOrder = [
        'restart-coordinator',
        'bot-integration-manager',
        'message-sync-service',
        'conversation-router',
        'content-adaptation-service',
        'user-permission-manager',
        'user-auth-service',
        'notification-service',
        'config-manager',
        'data-retention-manager',
        'admin-notification-manager',
        'security-logger'
      ];

      for (const serviceName of stopOrder) {
        await this.stopService(serviceName);
      }

      this.isStarted = false;
      this.emit('stopped');

      console.log('[IntegrationService] All services stopped successfully');
    } catch (error) {
      console.error('[IntegrationService] Error stopping services:', error);
      this.emit('error', error);
    }
  }

  /**
   * Restart all services
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Get service status
   */
  getServiceStatus(serviceName?: string): ServiceStatus | ServiceStatus[] {
    if (serviceName) {
      return this.serviceStatuses.get(serviceName) || {
        name: serviceName,
        status: 'stopped'
      };
    }

    return Array.from(this.serviceStatuses.values());
  }

  /**
   * Get overall system status
   */
  getSystemStatus(): {
    initialized: boolean;
    started: boolean;
    servicesRunning: number;
    servicesTotal: number;
    errors: string[];
  } {
    const statuses = Array.from(this.serviceStatuses.values());
    const running = statuses.filter(s => s.status === 'running').length;
    const errors = statuses.filter(s => s.status === 'error').map(s => s.error || 'Unknown error');

    return {
      initialized: this.isInitialized,
      started: this.isStarted,
      servicesRunning: running,
      servicesTotal: statuses.length,
      errors
    };
  }

  /**
   * Update service configuration
   */
  async updateConfig(newConfig: Partial<IntegrationServiceConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    try {
      // Save configuration
      if (this.configManager) {
        // Note: ConfigManager doesn't have a public save method for arbitrary configs
        // The config is automatically saved when updateConfig is called
        console.log('[IntegrationService] Configuration updated in memory');
      }

      // Restart affected services
      await this.handleConfigChange(oldConfig, this.config);

      this.emit('configUpdated', this.config);
    } catch (error) {
      // Rollback configuration on error
      this.config = oldConfig;
      console.error('[IntegrationService] Failed to update configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): IntegrationServiceConfig {
    return { ...this.config };
  }

  /**
   * Get service instance by name
   */
  getService<T = any>(serviceName: string): T | undefined {
    return this.services.get(serviceName);
  }

  /**
   * Initialize core services
   */
  private async initializeCoreServices(): Promise<void> {
    // Security Logger
    this.securityLogger = new SecurityLogger();
    await this.securityLogger.initialize();
    this.services.set('security-logger', this.securityLogger);
    this.updateServiceStatus('security-logger', 'running');

    // Admin Notification Manager
    this.adminNotificationManager = new AdminNotificationManager();
    await this.adminNotificationManager.initialize();
    this.services.set('admin-notification-manager', this.adminNotificationManager);
    this.updateServiceStatus('admin-notification-manager', 'running');

    // Data Retention Manager
    this.dataRetentionManager = new DataRetentionManager(this.securityLogger);
    await this.dataRetentionManager.initialize();
    this.services.set('data-retention-manager', this.dataRetentionManager);
    this.updateServiceStatus('data-retention-manager', 'running');

    // Config Manager
    this.configManager = new ConfigManager();
    await this.configManager.initialize();
    this.services.set('config-manager', this.configManager);
    this.updateServiceStatus('config-manager', 'running');

    // Notification Service
    this.notificationService = new NotificationService();
    // Note: NotificationService doesn't have initialize method, it's ready to use
    this.services.set('notification-service', this.notificationService);
    this.updateServiceStatus('notification-service', 'running');

    // Restart Coordinator
    this.restartCoordinator = new RestartCoordinator();
    this.services.set('restart-coordinator', this.restartCoordinator);
    this.updateServiceStatus('restart-coordinator', 'running');
  }

  /**
   * Initialize integration-specific services
   */
  private async initializeIntegrationServices(): Promise<void> {
    // User Authentication Service
    this.userAuthService = new UserAuthenticationService();
    await this.userAuthService.initialize();
    this.services.set('user-auth-service', this.userAuthService);
    this.updateServiceStatus('user-auth-service', 'running');

    // User Permission Manager
    this.userPermissionManager = new UserPermissionManager(this.userAuthService);
    await this.userPermissionManager.initialize();
    this.services.set('user-permission-manager', this.userPermissionManager);
    this.updateServiceStatus('user-permission-manager', 'running');

    // Content Adaptation Service
    this.contentAdaptationService = new ContentAdaptationService();
    this.services.set('content-adaptation-service', this.contentAdaptationService);
    this.updateServiceStatus('content-adaptation-service', 'running');

    // Conversation Router
    this.conversationRouter = new ConversationRouter();
    await this.conversationRouter.initialize();
    this.services.set('conversation-router', this.conversationRouter);
    this.updateServiceStatus('conversation-router', 'running');

    // Message Sync Service
    this.messageSyncService = new MessageSyncService(this.conversationRouter);
    await this.messageSyncService.initialize();
    this.services.set('message-sync-service', this.messageSyncService);
    this.updateServiceStatus('message-sync-service', 'running');

    // Bot Integration Manager
    this.botIntegrationManager = new BotIntegrationManager({
      enabled: true,
      platforms: {},
      settings: {
        maxMessageLength: 4000,
        formatToolOutputs: true,
        streamingChunkSize: 500,
        responseTimeout: 30000,
        enableCrossSync: true
      },
      validation: {
        enabled: true,
        contentFilter: {
          maxFileSize: 10 * 1024 * 1024, // 10MB
          rateLimiting: {
            messagesPerMinute: 30,
            filesPerHour: 10,
            burstAllowance: 5
          }
        },
        webhook: {
          secretKey: '',
          signatureHeader: 'X-Hub-Signature-256',
          hashAlgorithm: 'sha256',
          maxRequestAge: 300
        }
      }
    });
    await this.botIntegrationManager.initialize();
    this.services.set('bot-integration-manager', this.botIntegrationManager);
    this.updateServiceStatus('bot-integration-manager', 'running');

    // Configure platforms if enabled
    await this.configurePlatforms();
  }

  /**
   * Configure bot platforms based on current configuration
   */
  private async configurePlatforms(): Promise<void> {
    if (!this.botIntegrationManager) {
      return;
    }

    // Configure Telegram if enabled
    if (this.config.telegram.enabled && this.config.telegram.botToken) {
      try {
        const telegramPlatform = new TelegramPlatform({
          enabled: true,
          config: {
            botToken: this.config.telegram.botToken,
            respondToGroups: true,
            groupMentionOnly: true
          }
        });
        await telegramPlatform.initialize();

        this.botIntegrationManager.registerPlatform('telegram', telegramPlatform);
        console.log('[IntegrationService] Telegram platform configured');
      } catch (error) {
        console.error('[IntegrationService] Failed to configure Telegram platform:', error);
        this.updateServiceStatus('telegram-platform', 'error', error instanceof Error ? error.message : String(error));
      }
    }

    // Configure Discord if enabled
    if (this.config.discord.enabled && this.config.discord.botToken && this.config.discord.applicationId) {
      try {
        const discordPlatform = new DiscordPlatform({
          enabled: true,
          config: {
            botToken: this.config.discord.botToken,
            applicationId: this.config.discord.applicationId,
            respondToDMs: true,
            respondToGuilds: true,
            guildMentionOnly: true
          }
        });
        await discordPlatform.initialize();

        this.botIntegrationManager.registerPlatform('discord', discordPlatform);
        console.log('[IntegrationService] Discord platform configured');
      } catch (error) {
        console.error('[IntegrationService] Failed to configure Discord platform:', error);
        this.updateServiceStatus('discord-platform', 'error', error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Start a specific service
   */
  private async startService(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName);
    if (!service) {
      console.warn(`[IntegrationService] Service not found: ${serviceName}`);
      return;
    }

    try {
      this.updateServiceStatus(serviceName, 'starting');

      // Call start method if it exists
      if (typeof service.start === 'function') {
        await service.start();
      }

      this.updateServiceStatus(serviceName, 'running');
      console.log(`[IntegrationService] Service started: ${serviceName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateServiceStatus(serviceName, 'error', errorMessage);
      console.error(`[IntegrationService] Failed to start service ${serviceName}:`, error);
      throw error;
    }
  }

  /**
   * Stop a specific service
   */
  private async stopService(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName);
    if (!service) {
      return;
    }

    try {
      // Call stop method if it exists, or fallback to shutdown
      if (typeof service.stop === 'function') {
        await service.stop();
      } else if (typeof service.shutdown === 'function') {
        await service.shutdown();
      }

      this.updateServiceStatus(serviceName, 'stopped');
      console.log(`[IntegrationService] Service stopped: ${serviceName}`);
    } catch (error) {
      console.error(`[IntegrationService] Error stopping service ${serviceName}:`, error);
    }
  }

  /**
   * Update service status
   */
  private updateServiceStatus(serviceName: string, status: ServiceStatus['status'], error?: string): void {
    const currentStatus = this.serviceStatuses.get(serviceName);
    const now = new Date();

    const newStatus: ServiceStatus = {
      name: serviceName,
      status,
      error,
      lastStarted: status === 'running' ? now : currentStatus?.lastStarted,
      uptime: status === 'running' && currentStatus?.lastStarted
        ? now.getTime() - currentStatus.lastStarted.getTime()
        : undefined
    };

    this.serviceStatuses.set(serviceName, newStatus);
    this.emit('serviceStatusChanged', newStatus);
  }

  /**
   * Set up service monitoring
   */
  private setupServiceMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    // Monitor service health every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.checkServiceHealth();
    }, 30000);

    // Set up error handlers for services
    this.setupServiceErrorHandlers();
  }

  /**
   * Check health of all services
   */
  private checkServiceHealth(): void {
    for (const [serviceName, service] of this.services.entries()) {
      try {
        // Call health check method if it exists
        if (typeof service.healthCheck === 'function') {
          const isHealthy = service.healthCheck();
          if (!isHealthy) {
            this.updateServiceStatus(serviceName, 'error', 'Health check failed');
          }
        }
      } catch (error) {
        this.updateServiceStatus(serviceName, 'error', error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Set up error handlers for services
   */
  private setupServiceErrorHandlers(): void {
    for (const [serviceName, service] of this.services.entries()) {
      if (service instanceof EventEmitter) {
        service.on('error', (error) => {
          console.error(`[IntegrationService] Service error in ${serviceName}:`, error);
          this.updateServiceStatus(serviceName, 'error', error instanceof Error ? error.message : String(error));
          this.emit('serviceError', { serviceName, error });
        });
      }
    }
  }

  /**
   * Handle configuration changes
   */
  private async handleConfigChange(oldConfig: IntegrationServiceConfig, newConfig: IntegrationServiceConfig): Promise<void> {
    // Check if platform configurations changed
    const telegramChanged =
      oldConfig.telegram.enabled !== newConfig.telegram.enabled ||
      oldConfig.telegram.botToken !== newConfig.telegram.botToken;

    const discordChanged =
      oldConfig.discord.enabled !== newConfig.discord.enabled ||
      oldConfig.discord.botToken !== newConfig.discord.botToken ||
      oldConfig.discord.applicationId !== newConfig.discord.applicationId ||
      oldConfig.discord.webhookUrl !== newConfig.discord.webhookUrl;

    // Reconfigure platforms if needed
    if (telegramChanged || discordChanged) {
      await this.configurePlatforms();
    }

    // Handle security configuration changes
    if (oldConfig.security.enableMonitoring !== newConfig.security.enableMonitoring) {
      // Update security monitoring
      if (this.securityLogger) {
        // Security logger configuration update would go here
      }
    }

    // Handle notification configuration changes
    if (oldConfig.notifications.enabled !== newConfig.notifications.enabled ||
        JSON.stringify(oldConfig.notifications.channels) !== JSON.stringify(newConfig.notifications.channels)) {
      // Update notification service
      if (this.notificationService) {
        // Notification service configuration update would go here
      }
    }
  }
}

// Export singleton instance
export const integrationService = new IntegrationService();
