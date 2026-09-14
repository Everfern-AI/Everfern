/**
 * Comprehensive Error Logging System
 *
 * Provides detailed error logging with context information, error categorization,
 * severity levels, and administrator notification capabilities for the multi-platform
 * integration system.
 *
 * Requirements: 9.6, 9.7
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getSecurityMonitor } from './security-monitor';
import { adminNotificationManager } from './admin-notification';

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error categories
 */
export enum ErrorCategory {
  // Platform-specific errors
  PLATFORM_CONNECTION = 'platform_connection',
  PLATFORM_API = 'platform_api',
  PLATFORM_AUTHENTICATION = 'platform_authentication',
  PLATFORM_RATE_LIMIT = 'platform_rate_limit',

  // Integration errors
  MESSAGE_DELIVERY = 'message_delivery',
  MESSAGE_PROCESSING = 'message_processing',
  FILE_TRANSFER = 'file_transfer',
  CONVERSATION_SYNC = 'conversation_sync',

  // System errors
  DATABASE = 'database',
  FILE_SYSTEM = 'file_system',
  CONFIGURATION = 'configuration',
  ENCRYPTION = 'encryption',

  // Security errors
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  INPUT_VALIDATION = 'input_validation',
  SECURITY_VIOLATION = 'security_violation',

  // Application errors
  AGENT_EXECUTION = 'agent_execution',
  TOOL_EXECUTION = 'tool_execution',
  STATE_MANAGEMENT = 'state_management',
  UNKNOWN = 'unknown'
}

/**
 * Error context information
 */
export interface ErrorContext {
  /** Platform where error occurred */
  platform?: string;
  /** User ID associated with error */
  userId?: string;
  /** Conversation ID */
  conversationId?: string;
  /** Message ID */
  messageId?: string;
  /** Component or module name */
  component: string;
  /** Operation being performed */
  operation: string;
  /** Request/operation metadata */
  metadata?: Record<string, any>;
  /** Environment information */
  environment?: {
    nodeVersion?: string;
    platform?: string;
    arch?: string;
    memory?: {
      used: number;
      total: number;
    };
  };
}

/**
 * Comprehensive error log entry
 */
export interface ErrorLogEntry {
  /** Unique error ID */
  id: string;
  /** Error timestamp */
  timestamp: Date;
  /** Error severity */
  severity: ErrorSeverity;
  /** Error category */
  category: ErrorCategory;
  /** Error message */
  message: string;
  /** Original error object */
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  /** Error context */
  context: ErrorContext;
  /** Whether administrators were notified */
  adminNotified: boolean;
  /** Retry information */
  retry?: {
    attempt: number;
    maxAttempts: number;
    nextRetryAt?: Date;
  };
  /** Resolution information */
  resolution?: {
    resolved: boolean;
    resolvedAt?: Date;
    resolvedBy?: string;
    notes?: string;
  };
}

/**
 * Error statistics and analytics
 */
export interface ErrorStatistics {
  /** Total errors in time period */
  totalErrors: number;
  /** Errors by severity */
  bySeverity: Record<ErrorSeverity, number>;
  /** Errors by category */
  byCategory: Record<ErrorCategory, number>;
  /** Errors by platform */
  byPlatform: Record<string, number>;
  /** Errors by component */
  byComponent: Record<string, number>;
  /** Error rate (errors per hour) */
  errorRate: number;
  /** Most common errors */
  topErrors: Array<{
    message: string;
    count: number;
    category: ErrorCategory;
  }>;
  /** Time period */
  timePeriod: {
    start: Date;
    end: Date;
  };
}

/**
 * Error notification configuration
 */
export interface ErrorNotificationConfig {
  /** Enable notifications */
  enabled: boolean;
  /** Minimum severity for notifications */
  minSeverity: ErrorSeverity;
  /** Categories that always trigger notifications */
  criticalCategories: ErrorCategory[];
  /** Rate limiting */
  rateLimit: {
    maxPerHour: number;
    cooldownMinutes: number;
  };
}

/**
 * Comprehensive Error Logger
 */
export class ErrorLogger extends EventEmitter {
  private errors: Map<string, ErrorLogEntry> = new Map();
  private logDirectory: string;
  private notificationConfig: ErrorNotificationConfig;
  private notificationCounts: Map<string, number[]> = new Map();
  private securityMonitor = getSecurityMonitor();

  constructor(config?: Partial<ErrorNotificationConfig>) {
    super();
    this.logDirectory = path.join(os.homedir(), '.everfern', 'error-logs');
    this.notificationConfig = {
      enabled: true,
      minSeverity: ErrorSeverity.MEDIUM,
      criticalCategories: [
        ErrorCategory.SECURITY_VIOLATION,
        ErrorCategory.DATABASE,
        ErrorCategory.ENCRYPTION
      ],
      rateLimit: {
        maxPerHour: 20,
        cooldownMinutes: 5
      },
      ...config
    };

    this.initializeLogDirectory();
    this.startPeriodicCleanup();
  }

  /**
   * Log an error with full context
   */
  async logError(
    error: Error,
    severity: ErrorSeverity,
    category: ErrorCategory,
    context: ErrorContext,
    retry?: ErrorLogEntry['retry']
  ): Promise<ErrorLogEntry> {
    const entry: ErrorLogEntry = {
      id: this.generateErrorId(),
      timestamp: new Date(),
      severity,
      category,
      message: error.message,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      context: {
        ...context,
        environment: this.captureEnvironment()
      },
      adminNotified: false,
      retry
    };

    // Store error
    this.errors.set(entry.id, entry);

    // Write to log file
    await this.writeErrorToLog(entry);

    // Emit event
    this.emit('error-logged', entry);

    // Check for admin notification
    if (this.shouldNotifyAdmins(entry)) {
      await this.notifyAdministrators(entry);
    }

    // Log to security monitor if security-related
    if (this.isSecurityRelated(category)) {
      await this.logToSecurityMonitor(entry);
    }

    return entry;
  }

  /**
   * Log platform connection error
   */
  async logPlatformError(
    platform: string,
    error: Error,
    operation: string,
    metadata?: Record<string, any>
  ): Promise<ErrorLogEntry> {
    const severity = this.determineSeverity(error, ErrorCategory.PLATFORM_CONNECTION);
    return this.logError(
      error,
      severity,
      ErrorCategory.PLATFORM_CONNECTION,
      {
        platform,
        component: `${platform}-platform`,
        operation,
        metadata
      }
    );
  }

  /**
   * Log message delivery error
   */
  async logMessageError(
    platform: string,
    userId: string,
    error: Error,
    messageId?: string,
    conversationId?: string,
    retry?: ErrorLogEntry['retry']
  ): Promise<ErrorLogEntry> {
    return this.logError(
      error,
      ErrorSeverity.MEDIUM,
      ErrorCategory.MESSAGE_DELIVERY,
      {
        platform,
        userId,
        messageId,
        conversationId,
        component: 'bot-manager',
        operation: 'send_message'
      },
      retry
    );
  }

  /**
   * Log file transfer error
   */
  async logFileTransferError(
    platform: string,
    userId: string,
    error: Error,
    filename: string,
    operation: 'upload' | 'download'
  ): Promise<ErrorLogEntry> {
    return this.logError(
      error,
      ErrorSeverity.MEDIUM,
      ErrorCategory.FILE_TRANSFER,
      {
        platform,
        userId,
        component: 'file-manager',
        operation,
        metadata: { filename }
      }
    );
  }

  /**
   * Log database error
   */
  async logDatabaseError(
    error: Error,
    operation: string,
    metadata?: Record<string, any>
  ): Promise<ErrorLogEntry> {
    return this.logError(
      error,
      ErrorSeverity.HIGH,
      ErrorCategory.DATABASE,
      {
        component: 'database',
        operation,
        metadata
      }
    );
  }

  /**
   * Log security error
   */
  async logSecurityError(
    error: Error,
    category: ErrorCategory,
    context: ErrorContext
  ): Promise<ErrorLogEntry> {
    return this.logError(
      error,
      ErrorSeverity.CRITICAL,
      category,
      context
    );
  }

  /**
   * Get error logs with filtering
   */
  getErrors(filters: {
    severity?: ErrorSeverity[];
    category?: ErrorCategory[];
    platform?: string[];
    component?: string[];
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    resolved?: boolean;
    limit?: number;
  } = {}): ErrorLogEntry[] {
    let errors = Array.from(this.errors.values());

    // Apply filters
    if (filters.severity) {
      errors = errors.filter(e => filters.severity!.includes(e.severity));
    }
    if (filters.category) {
      errors = errors.filter(e => filters.category!.includes(e.category));
    }
    if (filters.platform) {
      errors = errors.filter(e => e.context.platform && filters.platform!.includes(e.context.platform));
    }
    if (filters.component) {
      errors = errors.filter(e => filters.component!.includes(e.context.component));
    }
    if (filters.userId) {
      errors = errors.filter(e => e.context.userId === filters.userId);
    }
    if (filters.startDate) {
      errors = errors.filter(e => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      errors = errors.filter(e => e.timestamp <= filters.endDate!);
    }
    if (filters.resolved !== undefined) {
      errors = errors.filter(e => e.resolution?.resolved === filters.resolved);
    }

    // Sort by timestamp (newest first)
    errors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (filters.limit) {
      errors = errors.slice(0, filters.limit);
    }

    return errors;
  }

  /**
   * Get error statistics
   */
  async getStatistics(
    startDate: Date = new Date(Date.now() - 24 * 60 * 60 * 1000),
    endDate: Date = new Date()
  ): Promise<ErrorStatistics> {
    const errors = this.getErrors({ startDate, endDate });

    const stats: ErrorStatistics = {
      totalErrors: errors.length,
      bySeverity: {
        [ErrorSeverity.LOW]: 0,
        [ErrorSeverity.MEDIUM]: 0,
        [ErrorSeverity.HIGH]: 0,
        [ErrorSeverity.CRITICAL]: 0
      },
      byCategory: {} as Record<ErrorCategory, number>,
      byPlatform: {},
      byComponent: {},
      errorRate: 0,
      topErrors: [],
      timePeriod: { start: startDate, end: endDate }
    };

    // Initialize category counts
    Object.values(ErrorCategory).forEach(cat => {
      stats.byCategory[cat] = 0;
    });

    // Count errors by various dimensions
    const errorMessages = new Map<string, number>();

    for (const error of errors) {
      stats.bySeverity[error.severity]++;
      stats.byCategory[error.category]++;

      if (error.context.platform) {
        stats.byPlatform[error.context.platform] = (stats.byPlatform[error.context.platform] || 0) + 1;
      }

      stats.byComponent[error.context.component] = (stats.byComponent[error.context.component] || 0) + 1;

      // Track error messages for top errors
      const key = `${error.category}:${error.message}`;
      errorMessages.set(key, (errorMessages.get(key) || 0) + 1);
    }

    // Calculate error rate (errors per hour)
    const hours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    stats.errorRate = hours > 0 ? errors.length / hours : 0;

    // Get top 10 errors
    stats.topErrors = Array.from(errorMessages.entries())
      .map(([key, count]) => {
        const [category, message] = key.split(':');
        return { message, count, category: category as ErrorCategory };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return stats;
  }

  /**
   * Resolve an error
   */
  async resolveError(
    errorId: string,
    resolvedBy: string,
    notes?: string
  ): Promise<boolean> {
    const error = this.errors.get(errorId);
    if (!error) {
      return false;
    }

    error.resolution = {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy,
      notes
    };

    // Update log file
    await this.writeErrorToLog(error);

    this.emit('error-resolved', error);
    return true;
  }

  /**
   * Get error analytics dashboard data
   */
  async getAnalytics(): Promise<{
    statistics: ErrorStatistics;
    recentErrors: ErrorLogEntry[];
    criticalErrors: ErrorLogEntry[];
    unresolvedErrors: ErrorLogEntry[];
    errorTrends: Record<string, number[]>;
  }> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const statistics = await this.getStatistics(last24Hours, now);
    const recentErrors = this.getErrors({ startDate: last24Hours, limit: 50 });
    const criticalErrors = this.getErrors({
      severity: [ErrorSeverity.CRITICAL, ErrorSeverity.HIGH],
      resolved: false,
      limit: 20
    });
    const unresolvedErrors = this.getErrors({ resolved: false, limit: 100 });
    const errorTrends = this.calculateErrorTrends(last24Hours, now);

    return {
      statistics,
      recentErrors,
      criticalErrors,
      unresolvedErrors,
      errorTrends
    };
  }

  /**
   * Initialize log directory
   */
  private async initializeLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDirectory, { recursive: true });
    } catch (error) {
      console.error('Failed to create error log directory:', error);
    }
  }

  /**
   * Write error to log file
   */
  private async writeErrorToLog(entry: ErrorLogEntry): Promise<void> {
    try {
      const logDate = entry.timestamp.toISOString().split('T')[0];
      const logFile = path.join(this.logDirectory, `errors-${logDate}.log`);

      const logEntry = {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        resolution: entry.resolution ? {
          ...entry.resolution,
          resolvedAt: entry.resolution.resolvedAt?.toISOString()
        } : undefined,
        retry: entry.retry ? {
          ...entry.retry,
          nextRetryAt: entry.retry.nextRetryAt?.toISOString()
        } : undefined
      };

      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(logFile, logLine, 'utf8');
    } catch (error) {
      console.error('Failed to write error to log:', error);
      this.emit('logging-error', error);
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Capture environment information
   */
  private captureEnvironment(): ErrorContext['environment'] {
    const memUsage = process.memoryUsage();
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal
      }
    };
  }

  /**
   * Determine error severity based on error type and category
   */
  private determineSeverity(error: Error, category: ErrorCategory): ErrorSeverity {
    // Critical categories
    if ([
      ErrorCategory.SECURITY_VIOLATION,
      ErrorCategory.DATABASE,
      ErrorCategory.ENCRYPTION
    ].includes(category)) {
      return ErrorSeverity.CRITICAL;
    }

    // Check error codes
    const errorCode = (error as any).code;
    if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT') {
      return ErrorSeverity.HIGH;
    }

    // Default to medium
    return ErrorSeverity.MEDIUM;
  }

  /**
   * Check if error category is security-related
   */
  private isSecurityRelated(category: ErrorCategory): boolean {
    return [
      ErrorCategory.AUTHENTICATION,
      ErrorCategory.AUTHORIZATION,
      ErrorCategory.INPUT_VALIDATION,
      ErrorCategory.SECURITY_VIOLATION,
      ErrorCategory.ENCRYPTION
    ].includes(category);
  }

  /**
   * Log to security monitor
   */
  private async logToSecurityMonitor(entry: ErrorLogEntry): Promise<void> {
    try {
      await this.securityMonitor.logSecurityEvent(
        'integration_error',
        entry.severity as any,
        entry.context.platform || 'system',
        `Error: ${entry.message}`,
        entry.message,
        {
          error: entry.error.message,
          stackTrace: entry.error.stack,
          context: entry.context
        },
        entry.context.userId
      );
    } catch (error) {
      console.error('Failed to log to security monitor:', error);
    }
  }

  /**
   * Check if administrators should be notified
   */
  private shouldNotifyAdmins(entry: ErrorLogEntry): boolean {
    if (!this.notificationConfig.enabled) {
      return false;
    }

    // Always notify for critical categories
    if (this.notificationConfig.criticalCategories.includes(entry.category)) {
      return true;
    }

    // Check severity threshold
    const severityLevels = [ErrorSeverity.LOW, ErrorSeverity.MEDIUM, ErrorSeverity.HIGH, ErrorSeverity.CRITICAL];
    const entrySeverityIndex = severityLevels.indexOf(entry.severity);
    const minSeverityIndex = severityLevels.indexOf(this.notificationConfig.minSeverity);

    if (entrySeverityIndex < minSeverityIndex) {
      return false;
    }

    // Check rate limiting
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const notificationKey = `${entry.category}_${entry.severity}`;

    let notifications = this.notificationCounts.get(notificationKey) || [];
    notifications = notifications.filter(time => time > hourAgo);

    if (notifications.length >= this.notificationConfig.rateLimit.maxPerHour) {
      return false;
    }

    // Update notification count
    notifications.push(now);
    this.notificationCounts.set(notificationKey, notifications);

    return true;
  }

  /**
   * Notify administrators
   */
  private async notifyAdministrators(entry: ErrorLogEntry): Promise<void> {
    try {
      entry.adminNotified = true;

      const priority = this.mapSeverityToPriority(entry.severity);
      const title = `Error: ${entry.category}`;
      const message = `${entry.message}\n\nComponent: ${entry.context.component}\nOperation: ${entry.context.operation}`;

      const details = {
        errorId: entry.id,
        severity: entry.severity,
        category: entry.category,
        platform: entry.context.platform,
        component: entry.context.component,
        operation: entry.context.operation,
        error: entry.error,
        context: entry.context
      };

      await adminNotificationManager.sendNotification(
        'error',
        priority,
        title,
        message,
        details
      );
    } catch (error) {
      console.error('Failed to notify administrators:', error);
      this.emit('notification-error', error);
    }
  }

  /**
   * Map error severity to notification priority
   */
  private mapSeverityToPriority(severity: ErrorSeverity): any {
    const { NotificationPriority } = require('./admin-notification');
    switch (severity) {
      case ErrorSeverity.LOW: return NotificationPriority.LOW;
      case ErrorSeverity.MEDIUM: return NotificationPriority.MEDIUM;
      case ErrorSeverity.HIGH: return NotificationPriority.HIGH;
      case ErrorSeverity.CRITICAL: return NotificationPriority.CRITICAL;
      default: return NotificationPriority.MEDIUM;
    }
  }

  /**
   * Calculate error trends over time
   */
  private calculateErrorTrends(startDate: Date, endDate: Date): Record<string, number[]> {
    const hours = 24;
    const trends: Record<string, number[]> = {};

    // Initialize trend arrays for each category
    Object.values(ErrorCategory).forEach(cat => {
      trends[cat] = new Array(hours).fill(0);
    });

    const errors = this.getErrors({ startDate, endDate });

    // Count errors per hour
    for (const error of errors) {
      const hoursDiff = Math.floor((endDate.getTime() - error.timestamp.getTime()) / (60 * 60 * 1000));
      const hourIndex = hours - 1 - hoursDiff;

      if (hourIndex >= 0 && hourIndex < hours) {
        trends[error.category][hourIndex]++;
      }
    }

    return trends;
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    // Clean up old errors every hour
    setInterval(() => {
      this.cleanupOldErrors();
      this.cleanupNotificationCounts();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up old errors from memory
   */
  private cleanupOldErrors(): void {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const [id, error] of this.errors) {
      if (error.timestamp.getTime() < sevenDaysAgo) {
        this.errors.delete(id);
      }
    }
  }

  /**
   * Clean up old notification counts
   */
  private cleanupNotificationCounts(): void {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;

    for (const [key, notifications] of this.notificationCounts) {
      const filtered = notifications.filter(time => time > hourAgo);
      if (filtered.length === 0) {
        this.notificationCounts.delete(key);
      } else {
        this.notificationCounts.set(key, filtered);
      }
    }
  }
}

/**
 * Default error notification configuration
 */
export const defaultErrorNotificationConfig: ErrorNotificationConfig = {
  enabled: true,
  minSeverity: ErrorSeverity.MEDIUM,
  criticalCategories: [
    ErrorCategory.SECURITY_VIOLATION,
    ErrorCategory.DATABASE,
    ErrorCategory.ENCRYPTION
  ],
  rateLimit: {
    maxPerHour: 20,
    cooldownMinutes: 5
  }
};

/**
 * Global error logger instance
 */
let globalErrorLogger: ErrorLogger | null = null;

/**
 * Get or create global error logger
 */
export function getErrorLogger(config?: Partial<ErrorNotificationConfig>): ErrorLogger {
  if (!globalErrorLogger) {
    globalErrorLogger = new ErrorLogger(config);
  }
  return globalErrorLogger;
}

/**
 * Create an error logger instance
 */
export function createErrorLogger(config?: Partial<ErrorNotificationConfig>): ErrorLogger {
  return new ErrorLogger(config);
}
