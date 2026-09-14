/**
 * Administrator Notification System
 *
 * Handles critical error notifications and security alerts for administrators.
 * Supports multiple notification channels and escalation policies.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { SecurityEvent, SecurityEventType, SecurityEventSeverity } from './security-logger';

export enum NotificationChannel {
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  DESKTOP = 'desktop',
  LOG = 'log'
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface NotificationConfig {
  enabled: boolean;
  channels: NotificationChannel[];
  emailConfig?: {
    smtpHost: string;
    smtpPort: number;
    username: string;
    password: string;
    fromAddress: string;
    toAddresses: string[];
  };
  webhookConfig?: {
    url: string;
    headers?: Record<string, string>;
    retryAttempts: number;
  };
  desktopConfig?: {
    enabled: boolean;
    soundEnabled: boolean;
  };
}

export interface AdminNotification {
  id: string;
  timestamp: Date;
  type: string;
  priority: NotificationPriority;
  title: string;
  message: string;
  details: Record<string, any>;
  channels: NotificationChannel[];
  sent: boolean;
  sentAt?: Date;
  retryCount: number;
  maxRetries: number;
}

/**
 * Administrator Notification Manager
 */
export class AdminNotificationManager extends EventEmitter {
  private configFile: string;
  private notificationLog: string;
  private config: NotificationConfig;
  private pendingNotifications: AdminNotification[] = [];
  private notificationHistory: AdminNotification[] = [];
  private maxHistorySize = 1000;

  constructor() {
    super();
    const configDir = path.join(homedir(), '.everfern', 'admin');
    this.configFile = path.join(configDir, 'notification-config.json');
    this.notificationLog = path.join(configDir, 'notifications.jsonl');

    // Default configuration
    this.config = {
      enabled: true,
      channels: [NotificationChannel.LOG, NotificationChannel.DESKTOP],
      desktopConfig: {
        enabled: true,
        soundEnabled: true
      }
    };
  }

  /**
   * Initialize the notification manager
   */
  async initialize(): Promise<void> {
    try {
      const configDir = path.dirname(this.configFile);
      await fs.mkdir(configDir, { recursive: true });

      await this.loadConfiguration();
      await this.loadNotificationHistory();

      // Start processing pending notifications
      this.startNotificationProcessor();

    } catch (error) {
      console.error('Failed to initialize admin notification manager:', error);
      throw error;
    }
  }

  /**
   * Send an admin notification
   */
  async sendNotification(
    type: string,
    priority: NotificationPriority,
    title: string,
    message: string,
    details: Record<string, any> = {},
    channels?: NotificationChannel[]
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const notification: AdminNotification = {
      id: this.generateNotificationId(),
      timestamp: new Date(),
      type,
      priority,
      title,
      message,
      details,
      channels: channels || this.config.channels,
      sent: false,
      retryCount: 0,
      maxRetries: this.getMaxRetries(priority)
    };

    this.pendingNotifications.push(notification);
    this.emit('notificationQueued', notification);

    console.log(`Admin notification queued: ${priority} - ${title}`);
  }

  /**
   * Send security event notification
   */
  async sendSecurityNotification(event: SecurityEvent): Promise<void> {
    const priority = this.mapSeverityToPriority(event.severity);
    const title = `Security Alert: ${event.type}`;
    const message = `${event.message}\nSource: ${event.source}\nTime: ${event.timestamp.toISOString()}`;

    const details = {
      eventId: event.id,
      eventType: event.type,
      severity: event.severity,
      source: event.source,
      userId: event.userId,
      platformId: event.platformId,
      ...event.details
    };

    await this.sendNotification(
      'security_event',
      priority,
      title,
      message,
      details
    );
  }

  /**
   * Send critical error notification
   */
  async sendCriticalError(
    component: string,
    error: Error,
    context: Record<string, any> = {}
  ): Promise<void> {
    const title = `Critical Error in ${component}`;
    const message = `A critical error occurred in ${component}:\n${error.message}\n\nStack trace:\n${error.stack}`;

    const details = {
      component,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      context
    };

    await this.sendNotification(
      'critical_error',
      NotificationPriority.CRITICAL,
      title,
      message,
      details,
      [NotificationChannel.LOG, NotificationChannel.DESKTOP, NotificationChannel.WEBHOOK]
    );
  }

  /**
   * Get notification history
   */
  async getNotificationHistory(limit: number = 100): Promise<AdminNotification[]> {
    return this.notificationHistory.slice(0, limit);
  }

  /**
   * Get pending notifications
   */
  getPendingNotifications(): AdminNotification[] {
    return [...this.pendingNotifications];
  }

  /**
   * Update notification configuration
   */
  async updateConfiguration(config: Partial<NotificationConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await this.saveConfiguration();
    this.emit('configurationUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfiguration(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Test notification system
   */
  async testNotification(channel: NotificationChannel): Promise<boolean> {
    try {
      const testNotification: AdminNotification = {
        id: this.generateNotificationId(),
        timestamp: new Date(),
        type: 'test',
        priority: NotificationPriority.LOW,
        title: 'Test Notification',
        message: 'This is a test notification to verify the system is working correctly.',
        details: { test: true },
        channels: [channel],
        sent: false,
        retryCount: 0,
        maxRetries: 1
      };

      const success = await this.sendNotificationToChannel(testNotification, channel);
      return success;
    } catch (error) {
      console.error(`Failed to send test notification to ${channel}:`, error);
      return false;
    }
  }

  /**
   * Generate unique notification ID
   */
  private generateNotificationId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Map security event severity to notification priority
   */
  private mapSeverityToPriority(severity: SecurityEventSeverity): NotificationPriority {
    switch (severity) {
      case SecurityEventSeverity.LOW:
        return NotificationPriority.LOW;
      case SecurityEventSeverity.MEDIUM:
        return NotificationPriority.MEDIUM;
      case SecurityEventSeverity.HIGH:
        return NotificationPriority.HIGH;
      case SecurityEventSeverity.CRITICAL:
        return NotificationPriority.CRITICAL;
      default:
        return NotificationPriority.MEDIUM;
    }
  }

  /**
   * Get maximum retry attempts based on priority
   */
  private getMaxRetries(priority: NotificationPriority): number {
    switch (priority) {
      case NotificationPriority.CRITICAL:
        return 5;
      case NotificationPriority.HIGH:
        return 3;
      case NotificationPriority.MEDIUM:
        return 2;
      case NotificationPriority.LOW:
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Start the notification processor
   */
  private startNotificationProcessor(): void {
    setInterval(async () => {
      await this.processPendingNotifications();
    }, 5000); // Process every 5 seconds
  }

  /**
   * Process pending notifications
   */
  private async processPendingNotifications(): Promise<void> {
    const notifications = [...this.pendingNotifications];
    this.pendingNotifications = [];

    for (const notification of notifications) {
      try {
        const success = await this.processNotification(notification);

        if (success) {
          notification.sent = true;
          notification.sentAt = new Date();
          this.addToHistory(notification);
        } else {
          notification.retryCount++;
          if (notification.retryCount < notification.maxRetries) {
            // Re-queue for retry
            this.pendingNotifications.push(notification);
          } else {
            // Max retries reached, log failure
            console.error(`Failed to send notification after ${notification.maxRetries} attempts:`, notification.title);
            notification.sent = false;
            this.addToHistory(notification);
          }
        }
      } catch (error) {
        console.error('Error processing notification:', error);
        notification.retryCount++;
        if (notification.retryCount < notification.maxRetries) {
          this.pendingNotifications.push(notification);
        }
      }
    }
  }

  /**
   * Process a single notification
   */
  private async processNotification(notification: AdminNotification): Promise<boolean> {
    let allSuccessful = true;

    for (const channel of notification.channels) {
      try {
        const success = await this.sendNotificationToChannel(notification, channel);
        if (!success) {
          allSuccessful = false;
        }
      } catch (error) {
        console.error(`Failed to send notification to ${channel}:`, error);
        allSuccessful = false;
      }
    }

    return allSuccessful;
  }

  /**
   * Send notification to a specific channel
   */
  private async sendNotificationToChannel(
    notification: AdminNotification,
    channel: NotificationChannel
  ): Promise<boolean> {
    switch (channel) {
      case NotificationChannel.LOG:
        return this.sendLogNotification(notification);

      case NotificationChannel.DESKTOP:
        return this.sendDesktopNotification(notification);

      case NotificationChannel.WEBHOOK:
        return this.sendWebhookNotification(notification);

      case NotificationChannel.EMAIL:
        return this.sendEmailNotification(notification);

      default:
        console.warn(`Unknown notification channel: ${channel}`);
        return false;
    }
  }

  /**
   * Send log notification
   */
  private async sendLogNotification(notification: AdminNotification): Promise<boolean> {
    try {
      const logEntry = {
        timestamp: notification.timestamp.toISOString(),
        level: 'ADMIN_NOTIFICATION',
        priority: notification.priority,
        title: notification.title,
        message: notification.message,
        details: notification.details
      };

      console.log(`[ADMIN NOTIFICATION] ${notification.priority.toUpperCase()}: ${notification.title}`);
      console.log(`Message: ${notification.message}`);

      // Also write to notification log file
      await fs.appendFile(this.notificationLog, JSON.stringify(logEntry) + '\n', 'utf8');

      return true;
    } catch (error) {
      console.error('Failed to send log notification:', error);
      return false;
    }
  }

  /**
   * Send desktop notification
   */
  private async sendDesktopNotification(notification: AdminNotification): Promise<boolean> {
    try {
      if (!this.config.desktopConfig?.enabled) {
        return true; // Consider it successful if disabled
      }

      // Emit event for the main process to handle desktop notification
      this.emit('desktopNotification', {
        title: notification.title,
        body: notification.message,
        priority: notification.priority,
        sound: this.config.desktopConfig.soundEnabled
      });

      return true;
    } catch (error) {
      console.error('Failed to send desktop notification:', error);
      return false;
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(notification: AdminNotification): Promise<boolean> {
    try {
      if (!this.config.webhookConfig?.url) {
        return true; // Consider it successful if not configured
      }

      const payload = {
        id: notification.id,
        timestamp: notification.timestamp.toISOString(),
        type: notification.type,
        priority: notification.priority,
        title: notification.title,
        message: notification.message,
        details: notification.details
      };

      // Note: In a real implementation, you would use fetch or axios here
      // For now, we'll just log the webhook attempt
      console.log(`Webhook notification would be sent to: ${this.config.webhookConfig.url}`);
      console.log('Payload:', JSON.stringify(payload, null, 2));

      return true;
    } catch (error) {
      console.error('Failed to send webhook notification:', error);
      return false;
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(notification: AdminNotification): Promise<boolean> {
    try {
      if (!this.config.emailConfig) {
        return true; // Consider it successful if not configured
      }

      // Note: In a real implementation, you would use nodemailer or similar
      // For now, we'll just log the email attempt
      console.log(`Email notification would be sent to: ${this.config.emailConfig.toAddresses.join(', ')}`);
      console.log(`Subject: ${notification.title}`);
      console.log(`Body: ${notification.message}`);

      return true;
    } catch (error) {
      console.error('Failed to send email notification:', error);
      return false;
    }
  }

  /**
   * Add notification to history
   */
  private addToHistory(notification: AdminNotification): void {
    this.notificationHistory.unshift(notification);
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory = this.notificationHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * Load configuration from file
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const fileExists = await fs.access(this.configFile).then(() => true).catch(() => false);
      if (fileExists) {
        const content = await fs.readFile(this.configFile, 'utf8');
        const savedConfig = JSON.parse(content);
        this.config = { ...this.config, ...savedConfig };
      }
    } catch (error) {
      console.error('Failed to load notification configuration:', error);
      // Continue with default configuration
    }
  }

  /**
   * Save configuration to file
   */
  private async saveConfiguration(): Promise<void> {
    try {
      await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save notification configuration:', error);
    }
  }

  /**
   * Load notification history from file
   */
  private async loadNotificationHistory(): Promise<void> {
    try {
      const fileExists = await fs.access(this.notificationLog).then(() => true).catch(() => false);
      if (!fileExists) {
        return;
      }

      const content = await fs.readFile(this.notificationLog, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Load last 1000 notifications
      const recentLines = lines.slice(-this.maxHistorySize);

      this.notificationHistory = recentLines.map(line => {
        try {
          const data = JSON.parse(line);
          // Convert log entry back to notification format
          return {
            id: `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(data.timestamp),
            type: 'historical',
            priority: data.priority,
            title: data.title,
            message: data.message,
            details: data.details,
            channels: [NotificationChannel.LOG],
            sent: true,
            sentAt: new Date(data.timestamp),
            retryCount: 0,
            maxRetries: 1
          };
        } catch (error) {
          console.error('Failed to parse notification history line:', error);
          return null;
        }
      }).filter(notification => notification !== null) as AdminNotification[];

    } catch (error) {
      console.error('Failed to load notification history:', error);
      // Continue with empty history
    }
  }
}

// Export singleton instance
export const adminNotificationManager = new AdminNotificationManager();
