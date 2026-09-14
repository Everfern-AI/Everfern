/**
 * Integration tests for security event logging and monitoring system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { SecurityLogger, SecurityEventType, SecurityEventSeverity } from '../security-logger';
import { AdminNotificationManager, NotificationChannel, NotificationPriority } from '../admin-notification';
import { SecurityDashboardManager } from '../security-dashboard';

describe('Security Monitoring Integration Tests', () => {
  let securityLogger: SecurityLogger;
  let adminNotificationManager: AdminNotificationManager;
  let securityDashboard: SecurityDashboardManager;
  let testDir: string;

  beforeEach(async () => {
    // Create test directory
    testDir = path.join(homedir(), '.everfern-test', 'security-test');
    await fs.mkdir(testDir, { recursive: true });

    // Mock homedir to use test directory
    vi.spyOn(require('os'), 'homedir').mockReturnValue(path.dirname(testDir));

    // Initialize components
    securityLogger = new SecurityLogger();
    adminNotificationManager = new AdminNotificationManager();
    securityDashboard = new SecurityDashboardManager(securityLogger, adminNotificationManager);

    await securityLogger.initialize();
    await adminNotificationManager.initialize();
    await securityDashboard.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    // Stop monitoring
    securityDashboard.stopMonitoring();

    // Restore mocks
    vi.restoreAllMocks();
  });

  describe('Security Event Logging', () => {
    it('should log security events and persist to file', async () => {
      // Log a security event
      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_FAILURE,
        SecurityEventSeverity.MEDIUM,
        'telegram-platform',
        'Failed authentication attempt',
        { userId: 'test-user', ipAddress: '192.168.1.1' },
        'test-user',
        'telegram'
      );

      // Verify event is in memory
      const events = await securityLogger.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(SecurityEventType.AUTHENTICATION_FAILURE);
      expect(events[0].severity).toBe(SecurityEventSeverity.MEDIUM);
      expect(events[0].source).toBe('telegram-platform');
      expect(events[0].userId).toBe('test-user');

      // Verify event is persisted to file
      const logFile = path.join(testDir, 'security', 'security-events.jsonl');
      const fileContent = await fs.readFile(logFile, 'utf8');
      const loggedEvent = JSON.parse(fileContent.trim());
      expect(loggedEvent.type).toBe(SecurityEventType.AUTHENTICATION_FAILURE);
      expect(loggedEvent.message).toBe('Failed authentication attempt');
    });

    it('should filter events by type and severity', async () => {
      // Log multiple events
      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_FAILURE,
        SecurityEventSeverity.HIGH,
        'telegram-platform',
        'Critical auth failure'
      );

      await securityLogger.logEvent(
        SecurityEventType.RATE_LIMIT_EXCEEDED,
        SecurityEventSeverity.MEDIUM,
        'discord-platform',
        'Rate limit hit'
      );

      await securityLogger.logEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        SecurityEventSeverity.CRITICAL,
        'bot-manager',
        'Suspicious behavior detected'
      );

      // Filter by type
      const authEvents = await securityLogger.getEvents({
        type: [SecurityEventType.AUTHENTICATION_FAILURE]
      });
      expect(authEvents).toHaveLength(1);
      expect(authEvents[0].type).toBe(SecurityEventType.AUTHENTICATION_FAILURE);

      // Filter by severity
      const criticalEvents = await securityLogger.getEvents({
        severity: [SecurityEventSeverity.CRITICAL]
      });
      expect(criticalEvents).toHaveLength(1);
      expect(criticalEvents[0].severity).toBe(SecurityEventSeverity.CRITICAL);

      // Filter by multiple criteria
      const highAndCritical = await securityLogger.getEvents({
        severity: [SecurityEventSeverity.HIGH, SecurityEventSeverity.CRITICAL]
      });
      expect(highAndCritical).toHaveLength(2);
    });

    it('should generate security metrics correctly', async () => {
      // Log various events
      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_FAILURE,
        SecurityEventSeverity.HIGH,
        'telegram-platform',
        'Auth failure 1'
      );

      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_FAILURE,
        SecurityEventSeverity.MEDIUM,
        'discord-platform',
        'Auth failure 2'
      );

      await securityLogger.logEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        SecurityEventSeverity.CRITICAL,
        'bot-manager',
        'Suspicious activity'
      );

      const metrics = await securityLogger.getMetrics();

      expect(metrics.totalEvents).toBe(3);
      expect(metrics.eventsBySeverity[SecurityEventSeverity.HIGH]).toBe(1);
      expect(metrics.eventsBySeverity[SecurityEventSeverity.MEDIUM]).toBe(1);
      expect(metrics.eventsBySeverity[SecurityEventSeverity.CRITICAL]).toBe(1);
      expect(metrics.eventsByType[SecurityEventType.AUTHENTICATION_FAILURE]).toBe(2);
      expect(metrics.eventsByType[SecurityEventType.SUSPICIOUS_ACTIVITY]).toBe(1);
      expect(metrics.failedAuthenticationCount).toBe(2);
      expect(metrics.suspiciousActivityCount).toBe(1);
    });
  });

  describe('Admin Notification System', () => {
    it('should send notifications through configured channels', async () => {
      const notifications: any[] = [];

      // Mock notification sending
      adminNotificationManager.on('desktopNotification', (notification) => {
        notifications.push({ channel: 'desktop', ...notification });
      });

      // Send a test notification
      await adminNotificationManager.sendNotification(
        'test_notification',
        NotificationPriority.HIGH,
        'Test Alert',
        'This is a test notification',
        { testData: true },
        [NotificationChannel.DESKTOP, NotificationChannel.LOG]
      );

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify notification was sent
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('Test Alert');
      expect(notifications[0].priority).toBe(NotificationPriority.HIGH);
    });

    it('should handle notification retries on failure', async () => {
      // Configure webhook that will fail
      await adminNotificationManager.updateConfiguration({
        enabled: true,
        channels: [NotificationChannel.WEBHOOK],
        webhookConfig: {
          url: 'http://invalid-url-that-will-fail',
          retryAttempts: 2
        }
      });

      // Send notification
      await adminNotificationManager.sendNotification(
        'test_retry',
        NotificationPriority.MEDIUM,
        'Retry Test',
        'Testing retry mechanism'
      );

      // Wait for processing and retries
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify notification history shows the attempt
      const history = await adminNotificationManager.getNotificationHistory(10);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should send security event notifications', async () => {
      const notifications: any[] = [];

      adminNotificationManager.on('desktopNotification', (notification) => {
        notifications.push(notification);
      });

      // Create a critical security event
      const criticalEvent = {
        id: 'test-event-1',
        timestamp: new Date(),
        type: SecurityEventType.DATA_ACCESS_VIOLATION,
        severity: SecurityEventSeverity.CRITICAL,
        source: 'file-manager',
        message: 'Unauthorized data access attempt',
        details: { file: '/sensitive/data.json' }
      };

      await adminNotificationManager.sendSecurityNotification(criticalEvent as any);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toContain('Security Alert');
      expect(notifications[0].priority).toBe(NotificationPriority.CRITICAL);
    });
  });

  describe('Security Dashboard', () => {
    it('should generate dashboard data with metrics and alerts', async () => {
      // Log some security events
      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_FAILURE,
        SecurityEventSeverity.HIGH,
        'telegram-platform',
        'Multiple auth failures'
      );

      await securityLogger.logEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        SecurityEventSeverity.CRITICAL,
        'bot-manager',
        'Suspicious pattern detected'
      );

      // Wait for dashboard to process events
      await new Promise(resolve => setTimeout(resolve, 100));

      const dashboardData = await securityDashboard.getDashboardData();

      expect(dashboardData.metrics).toBeDefined();
      expect(dashboardData.metrics.totalEvents).toBeGreaterThan(0);
      expect(dashboardData.alerts).toBeDefined();
      expect(dashboardData.trends).toBeDefined();
      expect(dashboardData.systemHealth).toBeDefined();
      expect(dashboardData.recentActivity).toBeDefined();
    });

    it('should create alerts for threshold violations', async () => {
      // Simulate multiple authentication failures to trigger threshold
      for (let i = 0; i < 12; i++) {
        await securityLogger.logEvent(
          SecurityEventType.AUTHENTICATION_FAILURE,
          SecurityEventSeverity.MEDIUM,
          'telegram-platform',
          `Auth failure ${i + 1}`,
          { attempt: i + 1 }
        );
      }

      // Wait for alert processing
      await new Promise(resolve => setTimeout(resolve, 200));

      const alerts = securityDashboard.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);

      const thresholdAlert = alerts.find(alert => alert.type === 'threshold_exceeded');
      expect(thresholdAlert).toBeDefined();
      expect(thresholdAlert?.title).toContain('Authentication Failure');
    });

    it('should detect suspicious patterns', async () => {
      const userId = 'suspicious-user';

      // Simulate suspicious pattern: multiple failures from same user
      for (let i = 0; i < 6; i++) {
        await securityLogger.logEvent(
          SecurityEventType.AUTHENTICATION_FAILURE,
          SecurityEventSeverity.MEDIUM,
          'telegram-platform',
          `Failed login attempt ${i + 1}`,
          { attempt: i + 1 },
          userId
        );
      }

      // Trigger pattern analysis
      await securityDashboard.performSecurityAnalysis();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = securityDashboard.getActiveAlerts();
      const patternAlert = alerts.find(alert =>
        alert.type === 'suspicious_pattern' &&
        alert.title.includes('Multiple Authentication Failures')
      );

      expect(patternAlert).toBeDefined();
      expect(patternAlert?.description).toContain(userId);
    });

    it('should acknowledge alerts correctly', async () => {
      // Create a critical event to generate an alert
      await securityLogger.logEvent(
        SecurityEventType.DATA_ACCESS_VIOLATION,
        SecurityEventSeverity.CRITICAL,
        'file-manager',
        'Critical security violation'
      );

      // Wait for alert creation
      await new Promise(resolve => setTimeout(resolve, 100));

      const alerts = securityDashboard.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);

      const alertToAcknowledge = alerts[0];
      const acknowledged = await securityDashboard.acknowledgeAlert(
        alertToAcknowledge.id,
        'admin-user'
      );

      expect(acknowledged).toBe(true);

      // Verify alert is no longer active
      const activeAlerts = securityDashboard.getActiveAlerts();
      const stillActive = activeAlerts.find(alert => alert.id === alertToAcknowledge.id);
      expect(stillActive).toBeUndefined();

      // Verify alert is in all alerts with acknowledgment info
      const allAlerts = securityDashboard.getAllAlerts();
      const acknowledgedAlert = allAlerts.find(alert => alert.id === alertToAcknowledge.id);
      expect(acknowledgedAlert?.acknowledged).toBe(true);
      expect(acknowledgedAlert?.acknowledgedBy).toBe('admin-user');
      expect(acknowledgedAlert?.acknowledgedAt).toBeDefined();
    });

    it('should generate security trends correctly', async () => {
      // Log events across different time periods
      const now = new Date();

      // Recent events
      await securityLogger.logEvent(
        SecurityEventType.RATE_LIMIT_EXCEEDED,
        SecurityEventSeverity.MEDIUM,
        'telegram-platform',
        'Recent rate limit'
      );

      const trends = await securityDashboard.generateTrends();

      expect(trends).toHaveLength(4); // Last Hour, 6 Hours, 24 Hours, 7 Days
      expect(trends[0].timeframe).toBe('Last Hour');
      expect(trends[1].timeframe).toBe('Last 6 Hours');
      expect(trends[2].timeframe).toBe('Last 24 Hours');
      expect(trends[3].timeframe).toBe('Last 7 Days');

      // Verify trend data structure
      trends.forEach(trend => {
        expect(trend.eventCounts).toBeDefined();
        expect(trend.severityCounts).toBeDefined();
        expect(trend.totalEvents).toBeGreaterThanOrEqual(0);
        expect(trend.anomalies).toBeDefined();
      });
    });
  });

  describe('Integration Flow', () => {
    it('should handle complete security event flow from logging to notification', async () => {
      const notifications: any[] = [];

      // Set up notification listener
      adminNotificationManager.on('desktopNotification', (notification) => {
        notifications.push(notification);
      });

      // Configure admin notifications for critical events
      await adminNotificationManager.updateConfiguration({
        enabled: true,
        channels: [NotificationChannel.DESKTOP, NotificationChannel.LOG]
      });

      // Log a critical security event
      await securityLogger.logEvent(
        SecurityEventType.DATA_ACCESS_VIOLATION,
        SecurityEventSeverity.CRITICAL,
        'file-manager',
        'Unauthorized access to sensitive data',
        {
          file: '/etc/passwd',
          userId: 'malicious-user',
          ipAddress: '192.168.1.100'
        },
        'malicious-user',
        'telegram'
      );

      // Wait for all processing to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify event was logged
      const events = await securityLogger.getEvents({ limit: 1 });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(SecurityEventType.DATA_ACCESS_VIOLATION);

      // Verify alert was created
      const alerts = securityDashboard.getActiveAlerts();
      const criticalAlert = alerts.find(alert => alert.severity === SecurityEventSeverity.CRITICAL);
      expect(criticalAlert).toBeDefined();

      // Verify notification was sent
      expect(notifications.length).toBeGreaterThan(0);
      const securityNotification = notifications.find(n => n.title.includes('Security Alert'));
      expect(securityNotification).toBeDefined();

      // Verify dashboard reflects the event
      const dashboardData = await securityDashboard.getDashboardData();
      expect(dashboardData.metrics.totalEvents).toBeGreaterThan(0);
      expect(dashboardData.systemHealth.status).toBe('critical');
    });

    it('should handle data retention and cleanup', async () => {
      // Log multiple events
      for (let i = 0; i < 5; i++) {
        await securityLogger.logEvent(
          SecurityEventType.AUTHENTICATION_SUCCESS,
          SecurityEventSeverity.LOW,
          'test-platform',
          `Test event ${i + 1}`
        );
      }

      // Verify events are logged
      let events = await securityLogger.getEvents();
      expect(events).toHaveLength(5);

      // Clear old events (use 0 days to clear all)
      const removedCount = await securityLogger.clearOldEvents(0);
      expect(removedCount).toBe(5);

      // Verify events are cleared
      events = await securityLogger.getEvents();
      expect(events).toHaveLength(1); // Only the cleanup event should remain
      expect(events[0].type).toBe(SecurityEventType.CONFIGURATION_CHANGE);
      expect(events[0].message).toContain('Cleared 5 old security events');
    });
  });
});
