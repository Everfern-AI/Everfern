/**
 * Security Integration Service
 *
 * This module integrates the security monitoring system with the existing
 * multi-platform integration components, providing centralized security
 * event handling and monitoring.
 */

import { EventEmitter } from 'events';
import { SecurityMonitor, getSecurityMonitor, SecurityAlertConfig, defaultSecurityAlertConfig } from './security-monitor';
import { SecurityDashboardManager } from './security-dashboard';
import { InputValidator, createInputValidator, ContentFilterConfig, WebhookConfig } from './input-validator';
import { NotificationService, getNotificationService } from './notification-service';
import { IncomingMessage, PlatformFile } from './platform-interface';

/**
 * Security integration configuration
 */
export interface SecurityIntegrationConfig {
  /** Security alert configuration */
  alerts: SecurityAlertConfig;
  /** Content filter configuration */
  contentFilter: ContentFilterConfig;
  /** Webhook security configuration */
  webhook: WebhookConfig;
  /** Enable real-time monitoring */
  enableRealTimeMonitoring: boolean;
  /** Enable automatic threat response */
  enableAutoResponse: boolean;
}

/**
 * Security integration events
 */
export interface SecurityIntegrationEvents {
  'security-event': (event: any) => void;
  'critical-alert': (event: any) => void;
  'user-blocked': (userId: string, reason: string) => void;
  'threat-detected': (threat: any) => void;
  'system-health-changed': (status: string, issues: string[]) => void;
  'error': (error: Error) => void;
}

/**
 * Security integration service
 */
export class SecurityIntegrationService extends EventEmitter {
  private securityMonitor!: SecurityMonitor;
  private securityDashboard!: SecurityDashboardManager | null;
  private inputValidator!: InputValidator;
  private notificationService: NotificationService;
  private config: SecurityIntegrationConfig;
  private isInitialized = false;

  constructor(config: SecurityIntegrationConfig) {
    super();
    this.config = config;
    this.notificationService = getNotificationService();
  }

  /**
   * Initialize the security integration service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize security monitor
      this.securityMonitor = getSecurityMonitor(this.config.alerts);

      // Initialize security dashboard (temporarily disabled until fully implemented)
      this.securityDashboard = null; // Placeholder

      // Initialize input validator
      this.inputValidator = createInputValidator(
        this.config.contentFilter,
        this.config.webhook
      );

      // Setup event listeners
      this.setupEventListeners();

      // Log initialization
      await this.securityMonitor.logSecurityEvent(
        'configuration_change',
        'low',
        'system',
        'Security System Initialized',
        'Security monitoring and integration system has been initialized',
        {
          context: {
            enableRealTimeMonitoring: this.config.enableRealTimeMonitoring,
            enableAutoResponse: this.config.enableAutoResponse,
            alertsEnabled: this.config.alerts.enableEmailNotifications
          }
        }
      );

      this.isInitialized = true;
      console.log('Security integration service initialized successfully');

    } catch (error) {
      console.error('Failed to initialize security integration service:', error);
      throw error;
    }
  }

  /**
   * Validate incoming message with security monitoring
   */
  async validateMessage(
    message: IncomingMessage,
    metadata: Record<string, any> = {}
  ): Promise<{
    valid: boolean;
    sanitized?: IncomingMessage;
    errors: string[];
    warnings: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    securityEventId?: string;
  }> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    try {
      // Validate message using input validator
      const validationResult = await this.inputValidator.validateMessage(message, metadata);

      // If validation failed with high/critical risk, log additional security event
      if (!validationResult.valid && (validationResult.riskLevel === 'high' || validationResult.riskLevel === 'critical')) {
        const securityEvent = await this.securityMonitor.logValidationFailure(
          message.platform,
          message.user.id,
          validationResult,
          metadata
        );

        return {
          ...validationResult,
          securityEventId: securityEvent.id
        };
      }

      // Log successful validation for audit trail (low severity)
      if (validationResult.valid && validationResult.warnings.length === 0) {
        await this.securityMonitor.logSecurityEvent(
          'authentication_success',
          'low',
          message.platform,
          'Message Validation Successful',
          `Message from user ${message.user.id} passed validation`,
          {
            ...metadata,
            context: {
              messageLength: message.content.text.length,
              fileCount: message.content.files.length
            }
          },
          message.user.id
        );
      }

      return validationResult;

    } catch (error) {
      // Log system error
      await this.securityMonitor.logSystemError(message.platform, error as Error, metadata);
      throw error;
    }
  }

  /**
   * Validate webhook signature with security monitoring
   */
  async validateWebhook(
    payload: string,
    signature: string,
    timestamp?: string,
    platform: string = 'webhook'
  ): Promise<{
    valid: boolean;
    securityEventId?: string;
  }> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    try {
      const validationResult = await this.inputValidator.validateWebhookSignature(payload, signature, timestamp);

      if (!validationResult.valid) {
        const securityEvent = await this.securityMonitor.logSecurityEvent(
          'webhook_signature_invalid',
          'critical',
          platform,
          'Webhook Signature Validation Failed',
          'Invalid webhook signature detected - potential security breach',
          {
            context: {
              signatureProvided: signature,
              payloadLength: payload.length,
              timestamp: timestamp,
              errors: validationResult.errors
            }
          }
        );

        return {
          valid: false,
          securityEventId: securityEvent.id
        };
      }

      return { valid: true };

    } catch (error) {
      await this.securityMonitor.logSystemError(platform, error as Error);
      throw error;
    }
  }

  /**
   * Log authentication attempt
   */
  async logAuthenticationAttempt(
    platform: string,
    userId: string,
    success: boolean,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    await this.securityMonitor.logAuthenticationAttempt(platform, userId, success, metadata);
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(
    platform: string,
    userId: string,
    activity: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    await this.securityMonitor.logSuspiciousActivity(platform, userId, activity, metadata);
  }

  /**
   * Get security dashboard data
   */
  async getSecurityDashboard(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    if (!this.securityDashboard) {
      throw new Error('Security dashboard not available');
    }

    return this.securityDashboard.getDashboardData();
  }

  /**
   * Get security metrics
   */
  async getSecurityMetrics(startDate?: Date, endDate?: Date): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    return this.securityMonitor.getSecurityMetrics(startDate, endDate);
  }

  /**
   * Block user
   */
  async blockUser(userId: string, reason: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    await this.securityMonitor.blockUser(userId, reason);
  }

  /**
   * Unblock user
   */
  async unblockUser(userId: string, reason: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    await this.securityMonitor.unblockUser(userId, reason);
  }

  /**
   * Check if user is blocked
   */
  isUserBlocked(userId: string): boolean {
    if (!this.isInitialized) {
      return false;
    }

    return this.securityMonitor.isUserBlocked(userId);
  }

  /**
   * Resolve security event
   */
  async resolveSecurityEvent(eventId: string, resolutionNotes: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    return this.securityMonitor.resolveSecurityEvent(eventId, resolutionNotes);
  }

  /**
   * Export security report
   */
  async exportSecurityReport(format: 'json' | 'csv', filters?: any): Promise<{ data: string; filename: string }> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    if (!this.securityDashboard) {
      throw new Error('Security dashboard not available');
    }

    const dashboardData = await this.securityDashboard.getDashboardData();

    if (format === 'json') {
      return {
        data: JSON.stringify(dashboardData, null, 2),
        filename: `security-report-${Date.now()}.json`
      };
    } else {
      // RFC 4180 compliant CSV export
      const escapeCsvCell = (val: any): string => {
        const str = String(val ?? '');
        if (/[",\n\r]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const rows: string[] = [
        ['Category', 'Identifier / Metric', 'Severity / Type', 'Status', 'Timestamp / Description', 'Value'].map(escapeCsvCell).join(',')
      ];

      // Export System Metrics
      if (dashboardData.metrics) {
        for (const [key, value] of Object.entries(dashboardData.metrics)) {
          rows.push(['Metric', key, 'N/A', 'ACTIVE', new Date().toISOString(), String(value)].map(escapeCsvCell).join(','));
        }
      }

      // Export Recent Security Events
      const events = (dashboardData as any).recentEvents || dashboardData.recentActivity;
      if (Array.isArray(events)) {
        for (const evt of events) {
          rows.push([
            'Security Event',
            evt.id || 'N/A',
            evt.severity || evt.type || 'INFO',
            evt.status || 'LOGGED',
            evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString(),
            evt.description || evt.message || JSON.stringify((evt as any).details || {})
          ].map(escapeCsvCell).join(','));
        }
      }

      // Export Threat Indicators / Alerts
      const threats = (dashboardData as any).activeThreats || dashboardData.alerts;
      if (Array.isArray(threats)) {
        for (const threat of threats) {
          rows.push([
            'Active Threat',
            threat.id || (threat as any).source || 'N/A',
            threat.severity || 'HIGH',
            (threat as any).status || 'ACTIVE',
            (threat as any).detectedAt || threat.timestamp ? new Date((threat as any).detectedAt || threat.timestamp).toISOString() : new Date().toISOString(),
            (threat as any).summary || threat.description || threat.title || 'Threat detected'
          ].map(escapeCsvCell).join(','));
        }
      }

      return {
        data: rows.join('\n'),
        filename: `security-report-${Date.now()}.csv`
      };
    }
  }

  /**
   * Update security configuration
   */
  async updateConfiguration(newConfig: Partial<SecurityIntegrationConfig>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // Update input validator configuration
    if (newConfig.contentFilter) {
      this.inputValidator.updateContentFilterConfig(newConfig.contentFilter);
    }

    if (newConfig.webhook) {
      this.inputValidator.updateWebhookConfig(newConfig.webhook);
    }

    // Log configuration change
    await this.securityMonitor.logSecurityEvent(
      'configuration_change',
      'medium',
      'system',
      'Security Configuration Updated',
      'Security system configuration has been updated',
      {
        context: {
          oldConfig: this.sanitizeConfig(oldConfig),
          newConfig: this.sanitizeConfig(this.config),
          changedFields: Object.keys(newConfig)
        }
      }
    );

    // Notify administrators
    this.notificationService.createNotification(
      'info',
      'Security Configuration Updated',
      'Security monitoring configuration has been updated successfully.',
      { persistent: false }
    );
  }

  /**
   * Get current security status
   */
  async getSecurityStatus(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    activeThreats: number;
    blockedUsers: number;
    lastUpdate: Date;
    systemHealth: {
      status: 'healthy' | 'warning' | 'critical';
      issues: string[];
    };
  }> {
    if (!this.isInitialized) {
      throw new Error('Security integration service not initialized');
    }

    const dashboardOverview = await this.securityMonitor.getSecurityDashboard();

    if (!this.securityDashboard) {
      return {
        status: dashboardOverview.systemHealth.status,
        activeThreats: 0,
        blockedUsers: 0,
        lastUpdate: new Date(),
        systemHealth: dashboardOverview.systemHealth
      };
    }

    // Get system health from dashboard
    const systemHealth = await this.securityDashboard.getSystemHealth();

    return {
      status: systemHealth.status,
      activeThreats: this.securityDashboard.getActiveAlerts().length,
      blockedUsers: 0, // Would need to track this separately
      lastUpdate: systemHealth.lastUpdate,
      systemHealth
    };
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Security monitor events
    this.securityMonitor.on('security-event', (event) => {
      this.emit('security-event', event);
    });

    this.securityMonitor.on('critical-alert', (event) => {
      this.emit('critical-alert', event);

      // Create urgent notification
      this.notificationService.createNotification(
        'error',
        'Critical Security Alert',
        `${event.title}: ${event.description}`,
        {
          persistent: true,
          metadata: { securityEventId: event.id }
        }
      );
    });

    this.securityMonitor.on('user-blocked', (userId, reason) => {
      this.emit('user-blocked', userId, reason);

      // Create notification
      this.notificationService.createWarningNotification(
        'User Blocked',
        `User ${userId} has been blocked: ${reason}`
      );
    });

    this.securityMonitor.on('error', (error) => {
      this.emit('error', error);
      console.error('Security monitor error:', error);
    });

    // Security dashboard events (temporarily disabled until fully implemented)
    if (this.securityDashboard) {
      this.securityDashboard.on('health-changed', (status: string, issues: string[]) => {
        this.emit('system-health-changed', status, issues);

        if (status === 'critical') {
          this.notificationService.createErrorNotification(
            'System Health Critical',
            `Security system health is critical: ${issues.join(', ')}`
          );
        } else if (status === 'warning') {
          this.notificationService.createWarningNotification(
            'System Health Warning',
            `Security system health warning: ${issues.join(', ')}`
          );
        }
      });

      this.securityDashboard.on('error', (error: Error) => {
        this.emit('error', error);
        console.error('Security dashboard error:', error);
      });
    }
  }

  /**
   * Sanitize configuration for logging (remove sensitive data)
   */
  private sanitizeConfig(config: SecurityIntegrationConfig): any {
    return {
      alerts: {
        ...config.alerts,
        adminEmails: config.alerts.adminEmails.map(() => '[REDACTED]')
      },
      contentFilter: {
        ...config.contentFilter,
        // Content filter config is not sensitive
      },
      webhook: {
        ...config.webhook,
        secretKey: '[REDACTED]'
      },
      enableRealTimeMonitoring: config.enableRealTimeMonitoring,
      enableAutoResponse: config.enableAutoResponse
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.securityDashboard) {
      this.securityDashboard.stopMonitoring();
    }

    this.removeAllListeners();
    this.isInitialized = false;

    if (this.securityMonitor) {
      await this.securityMonitor.logSecurityEvent(
        'configuration_change',
        'low',
        'system',
        'Security System Shutdown',
        'Security monitoring and integration system has been shut down',
        {}
      );
    }
  }
}

/**
 * Default security integration configuration
 */
export const defaultSecurityIntegrationConfig: SecurityIntegrationConfig = {
  alerts: defaultSecurityAlertConfig,
  contentFilter: {
    enableProfanityFilter: true,
    enableSpamDetection: true,
    maxMessageLength: 4000,
    maxFileSize: 25 * 1024 * 1024, // 25MB
    allowedFileTypes: [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ],
    blockedDomains: [],
    rateLimiting: {
      messagesPerMinute: 30,
      filesPerHour: 10,
      burstAllowance: 5
    }
  },
  webhook: {
    secretKey: '', // Must be set by application
    signatureHeader: 'X-Hub-Signature-256',
    hashAlgorithm: 'sha256',
    maxRequestAge: 300
  },
  enableRealTimeMonitoring: true,
  enableAutoResponse: true
};

/**
 * Global security integration service instance
 */
let globalSecurityIntegration: SecurityIntegrationService | null = null;

/**
 * Get or create global security integration service
 */
export function getSecurityIntegration(config?: SecurityIntegrationConfig): SecurityIntegrationService {
  if (!globalSecurityIntegration) {
    globalSecurityIntegration = new SecurityIntegrationService(config || defaultSecurityIntegrationConfig);
  }
  return globalSecurityIntegration;
}

/**
 * Create a security integration service instance
 */
export function createSecurityIntegration(config: SecurityIntegrationConfig): SecurityIntegrationService {
  return new SecurityIntegrationService(config);
}
