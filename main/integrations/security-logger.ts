/**
 * Security Event Logger and Monitoring System
 *
 * Provides comprehensive audit logging for security events, administrator notifications,
 * and security event monitoring dashboard functionality.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export enum SecurityEventType {
  AUTHENTICATION_SUCCESS = 'auth_success',
  AUTHENTICATION_FAILURE = 'auth_failure',
  AUTHORIZATION_DENIED = 'auth_denied',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  CONFIGURATION_CHANGE = 'config_change',
  PLATFORM_CONNECTION_FAILURE = 'platform_connection_failure',
  INPUT_VALIDATION_FAILURE = 'input_validation_failure',
  ENCRYPTION_FAILURE = 'encryption_failure',
  DATA_ACCESS_VIOLATION = 'data_access_violation'
}

export enum SecurityEventSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: SecurityEventType;
  severity: SecurityEventSeverity;
  source: string; // platform or component that generated the event
  userId?: string;
  platformId?: string;
  message: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface SecurityEventFilter {
  type?: SecurityEventType[];
  severity?: SecurityEventSeverity[];
  source?: string[];
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsBySeverity: Record<SecurityEventSeverity, number>;
  eventsByType: Record<SecurityEventType, number>;
  recentEvents: SecurityEvent[];
  suspiciousActivityCount: number;
  failedAuthenticationCount: number;
}

/**
 * Security Event Logger - handles logging, storage, and monitoring of security events
 */
export class SecurityLogger extends EventEmitter {
  private logDirectory: string;
  private logFile: string;
  private metricsFile: string;
  private events: SecurityEvent[] = [];
  private maxEventsInMemory = 1000;
  private adminNotificationThresholds: Map<SecurityEventType, number> = new Map();

  constructor() {
    super();
    this.logDirectory = path.join(homedir(), '.everfern', 'security');
    this.logFile = path.join(this.logDirectory, 'security-events.jsonl');
    this.metricsFile = path.join(this.logDirectory, 'security-metrics.json');

    // Set default notification thresholds
    this.adminNotificationThresholds.set(SecurityEventType.AUTHENTICATION_FAILURE, 5);
    this.adminNotificationThresholds.set(SecurityEventType.RATE_LIMIT_EXCEEDED, 10);
    this.adminNotificationThresholds.set(SecurityEventType.SUSPICIOUS_ACTIVITY, 1);
    this.adminNotificationThresholds.set(SecurityEventType.DATA_ACCESS_VIOLATION, 1);
  }

  /**
   * Initialize the security logger
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.logDirectory, { recursive: true });
      await this.loadRecentEvents();
    } catch (error) {
      console.error('Failed to initialize security logger:', error);
      throw error;
    }
  }

  /**
   * Log a security event
   */
  async logEvent(
    type: SecurityEventType,
    severity: SecurityEventSeverity,
    source: string,
    message: string,
    details: Record<string, any> = {},
    userId?: string,
    platformId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const event: SecurityEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      type,
      severity,
      source,
      message,
      details,
      userId,
      platformId,
      ipAddress,
      userAgent
    };

    try {
      // Add to in-memory storage
      this.events.push(event);
      if (this.events.length > this.maxEventsInMemory) {
        this.events.shift(); // Remove oldest event
      }

      // Persist to file
      await this.persistEvent(event);

      // Emit event for real-time monitoring
      this.emit('securityEvent', event);

      // Check for admin notification triggers
      await this.checkAdminNotificationTriggers(event);

      console.log(`Security event logged: ${type} - ${severity} - ${message}`);
    } catch (error) {
      console.error('Failed to log security event:', error);
      // Don't throw - security logging should not break the application
    }
  }

  /**
   * Get security events with optional filtering
   */
  async getEvents(filter: SecurityEventFilter = {}): Promise<SecurityEvent[]> {
    let filteredEvents = [...this.events];

    // Apply filters
    if (filter.type && filter.type.length > 0) {
      filteredEvents = filteredEvents.filter(event => filter.type!.includes(event.type));
    }

    if (filter.severity && filter.severity.length > 0) {
      filteredEvents = filteredEvents.filter(event => filter.severity!.includes(event.severity));
    }

    if (filter.source && filter.source.length > 0) {
      filteredEvents = filteredEvents.filter(event => filter.source!.includes(event.source));
    }

    if (filter.userId) {
      filteredEvents = filteredEvents.filter(event => event.userId === filter.userId);
    }

    if (filter.startDate) {
      filteredEvents = filteredEvents.filter(event => event.timestamp >= filter.startDate!);
    }

    if (filter.endDate) {
      filteredEvents = filteredEvents.filter(event => event.timestamp <= filter.endDate!);
    }

    // Sort by timestamp (newest first)
    filteredEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (filter.limit && filter.limit > 0) {
      filteredEvents = filteredEvents.slice(0, filter.limit);
    }

    return filteredEvents;
  }

  /**
   * Get security metrics and statistics
   */
  async getMetrics(): Promise<SecurityMetrics> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentEvents = this.events.filter(event => event.timestamp >= last24Hours);

    const eventsBySeverity: Record<SecurityEventSeverity, number> = {
      [SecurityEventSeverity.LOW]: 0,
      [SecurityEventSeverity.MEDIUM]: 0,
      [SecurityEventSeverity.HIGH]: 0,
      [SecurityEventSeverity.CRITICAL]: 0
    };

    const eventsByType: Record<SecurityEventType, number> = Object.values(SecurityEventType)
      .reduce((acc, type) => ({ ...acc, [type]: 0 }), {} as Record<SecurityEventType, number>);

    let suspiciousActivityCount = 0;
    let failedAuthenticationCount = 0;

    recentEvents.forEach(event => {
      eventsBySeverity[event.severity]++;
      eventsByType[event.type]++;

      if (event.type === SecurityEventType.SUSPICIOUS_ACTIVITY) {
        suspiciousActivityCount++;
      }
      if (event.type === SecurityEventType.AUTHENTICATION_FAILURE) {
        failedAuthenticationCount++;
      }
    });

    return {
      totalEvents: recentEvents.length,
      eventsBySeverity,
      eventsByType,
      recentEvents: recentEvents.slice(0, 10), // Last 10 events
      suspiciousActivityCount,
      failedAuthenticationCount
    };
  }

  /**
   * Set admin notification threshold for a specific event type
   */
  setNotificationThreshold(eventType: SecurityEventType, threshold: number): void {
    this.adminNotificationThresholds.set(eventType, threshold);
  }

  /**
   * Clear old security events (data retention)
   */
  async clearOldEvents(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const initialCount = this.events.length;
    this.events = this.events.filter(event => event.timestamp >= cutoffDate);
    const removedCount = initialCount - this.events.length;

    if (removedCount > 0) {
      await this.logEvent(
        SecurityEventType.CONFIGURATION_CHANGE,
        SecurityEventSeverity.LOW,
        'security-logger',
        `Cleared ${removedCount} old security events`,
        { retentionDays, removedCount }
      );
    }

    return removedCount;
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Persist event to file
   */
  private async persistEvent(event: SecurityEvent): Promise<void> {
    const eventLine = JSON.stringify(event) + '\n';
    await fs.appendFile(this.logFile, eventLine, 'utf8');
  }

  /**
   * Load recent events from file on startup
   */
  private async loadRecentEvents(): Promise<void> {
    try {
      const fileExists = await fs.access(this.logFile).then(() => true).catch(() => false);
      if (!fileExists) {
        return;
      }

      const content = await fs.readFile(this.logFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Load last 1000 events
      const recentLines = lines.slice(-this.maxEventsInMemory);

      this.events = recentLines.map(line => {
        try {
          const event = JSON.parse(line);
          event.timestamp = new Date(event.timestamp);
          return event;
        } catch (error) {
          console.error('Failed to parse security event line:', error);
          return null;
        }
      }).filter(event => event !== null) as SecurityEvent[];

    } catch (error) {
      console.error('Failed to load recent security events:', error);
      // Continue with empty events array
    }
  }

  /**
   * Check if admin notification should be triggered
   */
  private async checkAdminNotificationTriggers(event: SecurityEvent): Promise<void> {
    const threshold = this.adminNotificationThresholds.get(event.type);
    if (!threshold) {
      return;
    }

    // Count recent events of the same type (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSimilarEvents = this.events.filter(e =>
      e.type === event.type &&
      e.timestamp >= oneHourAgo
    );

    if (recentSimilarEvents.length >= threshold) {
      this.emit('adminNotification', {
        type: 'security_threshold_exceeded',
        eventType: event.type,
        count: recentSimilarEvents.length,
        threshold,
        latestEvent: event
      });
    }

    // Always notify for critical events
    if (event.severity === SecurityEventSeverity.CRITICAL) {
      this.emit('adminNotification', {
        type: 'critical_security_event',
        event
      });
    }
  }
}

/**
 * Security Event Dashboard - provides monitoring interface
 */
export class SecurityDashboard {
  private securityLogger: SecurityLogger;

  constructor(securityLogger: SecurityLogger) {
    this.securityLogger = securityLogger;
  }

  /**
   * Get dashboard data for security monitoring
   */
  async getDashboardData(): Promise<{
    metrics: SecurityMetrics;
    alerts: SecurityEvent[];
    trends: Record<string, number[]>;
  }> {
    const metrics = await this.securityLogger.getMetrics();

    // Get high and critical severity events as alerts
    const alerts = await this.securityLogger.getEvents({
      severity: [SecurityEventSeverity.HIGH, SecurityEventSeverity.CRITICAL],
      limit: 20
    });

    // Generate trend data (events per hour for last 24 hours)
    const trends = await this.generateTrendData();

    return {
      metrics,
      alerts,
      trends
    };
  }

  /**
   * Generate trend data for the dashboard
   */
  private async generateTrendData(): Promise<Record<string, number[]>> {
    const now = new Date();
    const trends: Record<string, number[]> = {};

    // Initialize trend arrays for each event type
    Object.values(SecurityEventType).forEach(type => {
      trends[type] = new Array(24).fill(0);
    });

    // Get events from last 24 hours
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentEvents = await this.securityLogger.getEvents({
      startDate: last24Hours
    });

    // Count events per hour
    recentEvents.forEach(event => {
      const hoursDiff = Math.floor((now.getTime() - event.timestamp.getTime()) / (60 * 60 * 1000));
      const hourIndex = 23 - hoursDiff; // Reverse order (most recent = index 23)

      if (hourIndex >= 0 && hourIndex < 24) {
        trends[event.type][hourIndex]++;
      }
    });

    return trends;
  }
}

// Export singleton instance
export const securityLogger = new SecurityLogger();
export const securityDashboard = new SecurityDashboard(securityLogger);
