/**
 * Security Event Monitoring and Logging System
 *
 * This module provides comprehensive security event logging, monitoring,
 * and administrator notification capabilities for the multi-platform
 * integration system.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { NotificationService, getNotificationService } from './notification-service';
import { ValidationResult } from './input-validator';

/**
 * Security event severity levels
 */
export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Security event types
 */
export type SecurityEventType =
  | 'authentication_attempt'
  | 'authentication_failure'
  | 'authentication_success'
  | 'authorization_failure'
  | 'injection_attack_detected'
  | 'suspicious_activity'
  | 'rate_limit_exceeded'
  | 'file_upload_blocked'
  | 'malicious_url_detected'
  | 'webhook_signature_invalid'
  | 'configuration_change'
  | 'integration_error'
  | 'data_breach_attempt'
  | 'privilege_escalation_attempt'
  | 'system_compromise_detected';

/**
 * Security event interface
 */
export interface SecurityEvent {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: SecurityEventType;
  /** Event severity */
  severity: SecurityEventSeverity;
  /** Event timestamp */
  timestamp: Date;
  /** Platform where event occurred */
  platform: string;
  /** User ID (if applicable) */
  userId?: string;
  /** Event title */
  title: string;
  /** Event description */
  description: string;
  /** Additional event metadata */
  metadata: {
    /** Source IP address */
    sourceIp?: string;
    /** User agent */
    userAgent?: string;
    /** Request details */
    requestDetails?: any;
    /** Validation results */
    validationResult?: ValidationResult;
    /** Error details */
    error?: string;
    /** Stack trace */
    stackTrace?: string;
    /** Additional context */
    context?: Record<string, any>;
  };
  /** Whether administrators have been notified */
  adminNotified: boolean;
  /** Whether event has been resolved */
  resolved: boolean;
  /** Resolution notes */
  resolutionNotes?: string;
}

/**
 * Security metrics interface
 */
export interface SecurityMetrics {
  /** Total events in time period */
  totalEvents: number;
  /** Events by severity */
  eventsBySeverity: Record<SecurityEventSeverity, number>;
  /** Events by type */
  eventsByType: Record<SecurityEventType, number>;
  /** Events by platform */
  eventsByPlatform: Record<string, number>;
  /** Failed authentication attempts */
  failedAuthAttempts: number;
  /** Blocked attacks */
  blockedAttacks: number;
  /** Rate limit violations */
  rateLimitViolations: number;
  /** Time period */
  timePeriod: {
    start: Date;
    end: Date;
  };
}

/**
 * Security alert configuration
 */
export interface SecurityAlertConfig {
  /** Enable email notifications */
  enableEmailNotifications: boolean;
  /** Administrator email addresses */
  adminEmails: string[];
  /** Minimum severity for notifications */
  minNotificationSeverity: SecurityEventSeverity;
  /** Rate limiting for notifications */
  notificationRateLimit: {
    /** Maximum notifications per hour */
    maxPerHour: number;
    /** Cooldown period in minutes */
    cooldownMinutes: number;
  };
  /** Auto-block thresholds */
  autoBlockThresholds: {
    /** Failed auth attempts before block */
    failedAuthAttempts: number;
    /** Injection attempts before block */
    injectionAttempts: number;
    /** Time window in minutes */
    timeWindowMinutes: number;
  };
}

/**
 * Security monitor events
 */
export interface SecurityMonitorEvents {
  'security-event': (event: SecurityEvent) => void;
  'critical-alert': (event: SecurityEvent) => void;
  'user-blocked': (userId: string, reason: string) => void;
  'metrics-updated': (metrics: SecurityMetrics) => void;
  'error': (error: Error) => void;
}

/**
 * Security event monitoring and logging system
 */
export class SecurityMonitor extends EventEmitter {
  private events: Map<string, SecurityEvent> = new Map();
  private blockedUsers: Set<string> = new Set();
  private notificationService: NotificationService;
  private alertConfig: SecurityAlertConfig;
  private logDirectory: string;
  private metricsCache: SecurityMetrics | null = null;
  private metricsCacheExpiry: number = 0;
  private notificationCounts: Map<string, number[]> = new Map();

  constructor(alertConfig: SecurityAlertConfig) {
    super();
    this.alertConfig = alertConfig;
    this.notificationService = getNotificationService();
    this.logDirectory = path.join(os.homedir(), '.everfern', 'security-logs');
    this.initializeLogDirectory();
    this.startPeriodicCleanup();
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(
    type: SecurityEventType,
    severity: SecurityEventSeverity,
    platform: string,
    title: string,
    description: string,
    metadata: SecurityEvent['metadata'] = {},
    userId?: string
  ): Promise<SecurityEvent> {
    const event: SecurityEvent = {
      id: this.generateEventId(),
      type,
      severity,
      timestamp: new Date(),
      platform,
      userId,
      title,
      description,
      metadata,
      adminNotified: false,
      resolved: false
    };

    // Store event in memory
    this.events.set(event.id, event);

    // Write to log file
    await this.writeEventToLog(event);

    // Emit event
    this.emit('security-event', event);

    // Check for critical alerts
    if (severity === 'critical' || this.isCriticalEvent(event)) {
      await this.handleCriticalAlert(event);
    }

    // Check for auto-block conditions
    if (userId && this.shouldAutoBlock(userId, type)) {
      await this.blockUser(userId, `Auto-blocked due to ${type}`);
    }

    // Send notifications if needed
    if (this.shouldNotifyAdmins(event)) {
      await this.notifyAdministrators(event);
    }

    // Invalidate metrics cache
    this.invalidateMetricsCache();

    return event;
  }

  /**
   * Log authentication attempt
   */
  async logAuthenticationAttempt(
    platform: string,
    userId: string,
    success: boolean,
    metadata: Record<string, any> = {}
  ): Promise<SecurityEvent> {
    const type: SecurityEventType = success ? 'authentication_success' : 'authentication_failure';
    const severity: SecurityEventSeverity = success ? 'low' : 'medium';
    const title = success ? 'Authentication Successful' : 'Authentication Failed';
    const description = success
      ? `User ${userId} successfully authenticated on ${platform}`
      : `Failed authentication attempt for user ${userId} on ${platform}`;

    return this.logSecurityEvent(type, severity, platform, title, description, metadata, userId);
  }

  /**
   * Log validation failure
   */
  async logValidationFailure(
    platform: string,
    userId: string,
    validationResult: ValidationResult,
    metadata: Record<string, any> = {}
  ): Promise<SecurityEvent> {
    const severity = this.mapRiskLevelToSeverity(validationResult.riskLevel);
    const type = this.determineEventTypeFromValidation(validationResult);
    const title = 'Input Validation Failed';
    const description = `Input validation failed for user ${userId}: ${validationResult.errors.join(', ')}`;

    return this.logSecurityEvent(
      type,
      severity,
      platform,
      title,
      description,
      { ...metadata, validationResult },
      userId
    );
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(
    platform: string,
    userId: string,
    activity: string,
    metadata: Record<string, any> = {}
  ): Promise<SecurityEvent> {
    return this.logSecurityEvent(
      'suspicious_activity',
      'high',
      platform,
      'Suspicious Activity Detected',
      `Suspicious activity detected for user ${userId}: ${activity}`,
      metadata,
      userId
    );
  }

  /**
   * Log system error
   */
  async logSystemError(
    platform: string,
    error: Error,
    metadata: Record<string, any> = {}
  ): Promise<SecurityEvent> {
    return this.logSecurityEvent(
      'integration_error',
      'medium',
      platform,
      'System Error',
      `System error occurred: ${error.message}`,
      {
        ...metadata,
        error: error.message,
        stackTrace: error.stack
      }
    );
  }

  /**
   * Get security events with filtering
   */
  getSecurityEvents(filters: {
    severity?: SecurityEventSeverity[];
    type?: SecurityEventType[];
    platform?: string[];
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    resolved?: boolean;
    limit?: number;
  } = {}): SecurityEvent[] {
    let events = Array.from(this.events.values());

    // Apply filters
    if (filters.severity) {
      events = events.filter(e => filters.severity!.includes(e.severity));
    }
    if (filters.type) {
      events = events.filter(e => filters.type!.includes(e.type));
    }
    if (filters.platform) {
      events = events.filter(e => filters.platform!.includes(e.platform));
    }
    if (filters.userId) {
      events = events.filter(e => e.userId === filters.userId);
    }
    if (filters.startDate) {
      events = events.filter(e => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      events = events.filter(e => e.timestamp <= filters.endDate!);
    }
    if (filters.resolved !== undefined) {
      events = events.filter(e => e.resolved === filters.resolved);
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (filters.limit) {
      events = events.slice(0, filters.limit);
    }

    return events;
  }

  /**
   * Get security metrics
   */
  async getSecurityMetrics(
    startDate: Date = new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    endDate: Date = new Date()
  ): Promise<SecurityMetrics> {
    // Check cache
    const now = Date.now();
    if (this.metricsCache && now < this.metricsCacheExpiry) {
      return this.metricsCache;
    }

    const events = this.getSecurityEvents({ startDate, endDate });

    const metrics: SecurityMetrics = {
      totalEvents: events.length,
      eventsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      eventsByType: {} as Record<SecurityEventType, number>,
      eventsByPlatform: {},
      failedAuthAttempts: 0,
      blockedAttacks: 0,
      rateLimitViolations: 0,
      timePeriod: { start: startDate, end: endDate }
    };

    // Calculate metrics
    for (const event of events) {
      metrics.eventsBySeverity[event.severity]++;

      if (!metrics.eventsByType[event.type]) {
        metrics.eventsByType[event.type] = 0;
      }
      metrics.eventsByType[event.type]++;

      if (!metrics.eventsByPlatform[event.platform]) {
        metrics.eventsByPlatform[event.platform] = 0;
      }
      metrics.eventsByPlatform[event.platform]++;

      if (event.type === 'authentication_failure') {
        metrics.failedAuthAttempts++;
      }
      if (event.type === 'injection_attack_detected' || event.type === 'malicious_url_detected') {
        metrics.blockedAttacks++;
      }
      if (event.type === 'rate_limit_exceeded') {
        metrics.rateLimitViolations++;
      }
    }

    // Cache metrics for 5 minutes
    this.metricsCache = metrics;
    this.metricsCacheExpiry = now + 5 * 60 * 1000;

    this.emit('metrics-updated', metrics);
    return metrics;
  }

  /**
   * Block a user
   */
  async blockUser(userId: string, reason: string): Promise<void> {
    this.blockedUsers.add(userId);

    await this.logSecurityEvent(
      'privilege_escalation_attempt',
      'high',
      'system',
      'User Blocked',
      `User ${userId} has been blocked: ${reason}`,
      { context: { reason } },
      userId
    );

    this.emit('user-blocked', userId, reason);

    // Notify administrators
    this.notificationService.createErrorNotification(
      'User Blocked',
      `User ${userId} has been automatically blocked due to: ${reason}`
    );
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string, reason: string): Promise<void> {
    this.blockedUsers.delete(userId);

    await this.logSecurityEvent(
      'authentication_attempt',
      'low',
      'system',
      'User Unblocked',
      `User ${userId} has been unblocked: ${reason}`,
      { context: { reason } },
      userId
    );
  }

  /**
   * Check if user is blocked
   */
  isUserBlocked(userId: string): boolean {
    return this.blockedUsers.has(userId);
  }

  /**
   * Resolve a security event
   */
  async resolveSecurityEvent(eventId: string, resolutionNotes: string): Promise<boolean> {
    const event = this.events.get(eventId);
    if (!event) {
      return false;
    }

    event.resolved = true;
    event.resolutionNotes = resolutionNotes;

    // Update log file
    await this.writeEventToLog(event);

    return true;
  }

  /**
   * Get security dashboard data
   */
  async getSecurityDashboard(): Promise<{
    recentEvents: SecurityEvent[];
    metrics: SecurityMetrics;
    blockedUsers: string[];
    criticalAlerts: SecurityEvent[];
    systemHealth: {
      status: 'healthy' | 'warning' | 'critical';
      issues: string[];
    };
  }> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentEvents = this.getSecurityEvents({
      startDate: last24Hours,
      limit: 50
    });

    const metrics = await this.getSecurityMetrics(last24Hours, now);

    const criticalAlerts = this.getSecurityEvents({
      severity: ['critical'],
      resolved: false,
      limit: 10
    });

    const systemHealth = this.assessSystemHealth(metrics, criticalAlerts);

    return {
      recentEvents,
      metrics,
      blockedUsers: Array.from(this.blockedUsers),
      criticalAlerts,
      systemHealth
    };
  }

  /**
   * Initialize log directory
   */
  private async initializeLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDirectory, { recursive: true });
    } catch (error) {
      console.error('Failed to create security log directory:', error);
    }
  }

  /**
   * Write event to log file
   */
  private async writeEventToLog(event: SecurityEvent): Promise<void> {
    try {
      const logDate = event.timestamp.toISOString().split('T')[0];
      const logFile = path.join(this.logDirectory, `security-${logDate}.log`);

      const logEntry = {
        ...event,
        timestamp: event.timestamp.toISOString()
      };

      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(logFile, logLine, 'utf8');
    } catch (error) {
      console.error('Failed to write security event to log:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `sec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Check if event is critical
   */
  private isCriticalEvent(event: SecurityEvent): boolean {
    const criticalTypes: SecurityEventType[] = [
      'injection_attack_detected',
      'data_breach_attempt',
      'system_compromise_detected',
      'privilege_escalation_attempt'
    ];

    return criticalTypes.includes(event.type) || event.severity === 'critical';
  }

  /**
   * Handle critical alert
   */
  private async handleCriticalAlert(event: SecurityEvent): Promise<void> {
    this.emit('critical-alert', event);

    // Create urgent notification
    this.notificationService.createNotification(
      'error',
      'Critical Security Alert',
      `${event.title}: ${event.description}`,
      {
        persistent: true,
        actions: [
          {
            id: 'view-details',
            label: 'View Details',
            type: 'primary',
            handler: () => console.log('View security event details:', event.id)
          },
          {
            id: 'resolve',
            label: 'Mark Resolved',
            type: 'secondary',
            handler: async () => { await this.resolveSecurityEvent(event.id, 'Resolved by administrator'); }
          }
        ],
        metadata: { securityEventId: event.id }
      }
    );
  }

  /**
   * Check if user should be auto-blocked
   */
  private shouldAutoBlock(userId: string, eventType: SecurityEventType): boolean {
    const now = Date.now();
    const timeWindow = this.alertConfig.autoBlockThresholds.timeWindowMinutes * 60 * 1000;
    const cutoff = now - timeWindow;

    const recentEvents = this.getSecurityEvents({
      userId,
      startDate: new Date(cutoff)
    });

    // Count relevant events
    let failedAuthCount = 0;
    let injectionCount = 0;

    for (const event of recentEvents) {
      if (event.type === 'authentication_failure') {
        failedAuthCount++;
      }
      if (event.type === 'injection_attack_detected') {
        injectionCount++;
      }
    }

    // Check thresholds
    if (failedAuthCount >= this.alertConfig.autoBlockThresholds.failedAuthAttempts) {
      return true;
    }
    if (injectionCount >= this.alertConfig.autoBlockThresholds.injectionAttempts) {
      return true;
    }

    return false;
  }

  /**
   * Check if administrators should be notified
   */
  private shouldNotifyAdmins(event: SecurityEvent): boolean {
    // Check severity threshold
    const severityLevels = ['low', 'medium', 'high', 'critical'];
    const eventSeverityIndex = severityLevels.indexOf(event.severity);
    const minSeverityIndex = severityLevels.indexOf(this.alertConfig.minNotificationSeverity);

    if (eventSeverityIndex < minSeverityIndex) {
      return false;
    }

    // Check rate limiting
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const notificationKey = `${event.type}_${event.severity}`;

    let notifications = this.notificationCounts.get(notificationKey) || [];
    notifications = notifications.filter(time => time > hourAgo);

    if (notifications.length >= this.alertConfig.notificationRateLimit.maxPerHour) {
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
  private async notifyAdministrators(event: SecurityEvent): Promise<void> {
    try {
      // Mark as notified
      event.adminNotified = true;

      // Create notification
      this.notificationService.createNotification(
        event.severity === 'critical' ? 'error' : 'warning',
        `Security Alert: ${event.title}`,
        event.description,
        {
          persistent: event.severity === 'critical' || event.severity === 'high',
          metadata: { securityEventId: event.id }
        }
      );

      // TODO: Implement email notifications if configured
      if (this.alertConfig.enableEmailNotifications && this.alertConfig.adminEmails.length > 0) {
        // Email notification implementation would go here
        console.log(`Would send email notification to: ${this.alertConfig.adminEmails.join(', ')}`);
      }
    } catch (error) {
      console.error('Failed to notify administrators:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Map validation risk level to security severity
   */
  private mapRiskLevelToSeverity(riskLevel: ValidationResult['riskLevel']): SecurityEventSeverity {
    switch (riskLevel) {
      case 'low': return 'low';
      case 'medium': return 'medium';
      case 'high': return 'high';
      case 'critical': return 'critical';
      default: return 'medium';
    }
  }

  /**
   * Determine event type from validation result
   */
  private determineEventTypeFromValidation(result: ValidationResult): SecurityEventType {
    if (result.errors.some(e => e.includes('injection'))) {
      return 'injection_attack_detected';
    }
    if (result.errors.some(e => e.includes('rate limit'))) {
      return 'rate_limit_exceeded';
    }
    if (result.errors.some(e => e.includes('file'))) {
      return 'file_upload_blocked';
    }
    if (result.warnings.some(w => w.includes('URL'))) {
      return 'malicious_url_detected';
    }
    return 'suspicious_activity';
  }

  /**
   * Assess system health
   */
  private assessSystemHealth(
    metrics: SecurityMetrics,
    criticalAlerts: SecurityEvent[]
  ): { status: 'healthy' | 'warning' | 'critical'; issues: string[] } {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check critical alerts
    if (criticalAlerts.length > 0) {
      status = 'critical';
      issues.push(`${criticalAlerts.length} unresolved critical alerts`);
    }

    // Check failed authentication rate
    if (metrics.failedAuthAttempts > 50) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`High number of failed authentication attempts: ${metrics.failedAuthAttempts}`);
    }

    // Check blocked attacks
    if (metrics.blockedAttacks > 10) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`Multiple attack attempts blocked: ${metrics.blockedAttacks}`);
    }

    // Check rate limit violations
    if (metrics.rateLimitViolations > 20) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push(`High rate limit violations: ${metrics.rateLimitViolations}`);
    }

    if (issues.length === 0) {
      issues.push('All systems operating normally');
    }

    return { status, issues };
  }

  /**
   * Invalidate metrics cache
   */
  private invalidateMetricsCache(): void {
    this.metricsCache = null;
    this.metricsCacheExpiry = 0;
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    // Clean up old events every hour
    setInterval(() => {
      this.cleanupOldEvents();
      this.cleanupNotificationCounts();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up old events from memory
   */
  private cleanupOldEvents(): void {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const [id, event] of this.events) {
      if (event.timestamp.getTime() < sevenDaysAgo) {
        this.events.delete(id);
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
 * Default security alert configuration
 */
export const defaultSecurityAlertConfig: SecurityAlertConfig = {
  enableEmailNotifications: false,
  adminEmails: [],
  minNotificationSeverity: 'medium',
  notificationRateLimit: {
    maxPerHour: 10,
    cooldownMinutes: 5
  },
  autoBlockThresholds: {
    failedAuthAttempts: 5,
    injectionAttempts: 3,
    timeWindowMinutes: 15
  }
};

/**
 * Global security monitor instance
 */
let globalSecurityMonitor: SecurityMonitor | null = null;

/**
 * Get or create global security monitor
 */
export function getSecurityMonitor(config?: SecurityAlertConfig): SecurityMonitor {
  if (!globalSecurityMonitor) {
    globalSecurityMonitor = new SecurityMonitor(config || defaultSecurityAlertConfig);
  }
  return globalSecurityMonitor;
}

/**
 * Create a security monitor instance
 */
export function createSecurityMonitor(config: SecurityAlertConfig): SecurityMonitor {
  return new SecurityMonitor(config);
}
