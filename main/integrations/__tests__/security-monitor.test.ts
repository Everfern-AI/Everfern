/**
 * Security Monitor Tests
 *
 * Unit tests for the security monitoring and logging system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecurityMonitor, SecurityAlertConfig, SecurityEvent, SecurityEventType, SecurityEventSeverity } from '../security-monitor';
import { ValidationResult } from '../input-validator';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock the notification service
vi.mock('../notification-service', () => ({
  getNotificationService: () => ({
    createNotification: vi.fn(),
    createErrorNotification: vi.fn(),
    createWarningNotification: vi.fn()
  })
}));

describe('SecurityMonitor', () => {
  let securityMonitor: SecurityMonitor;
  let testConfig: SecurityAlertConfig;
  let logDirectory: string;

  beforeEach(() => {
    testConfig = {
      enableEmailNotifications: false,
      adminEmails: ['admin@test.com'],
      minNotificationSeverity: 'medium',
      notificationRateLimit: {
        maxPerHour: 5,
        cooldownMinutes: 1
      },
      autoBlockThresholds: {
        failedAuthAttempts: 3,
        injectionAttempts: 2,
        timeWindowMinutes: 5
      }
    };

    securityMonitor = new SecurityMonitor(testConfig);
    logDirectory = path.join(os.homedir(), '.everfern', 'security-logs');
  });

  afterEach(async () => {
    // Clean up test logs
    try {
      const files = await fs.readdir(logDirectory);
      for (const file of files) {
        if (file.startsWith('security-') && file.endsWith('.log')) {
          await fs.unlink(path.join(logDirectory, file));
        }
      }
    } catch (error) {
      // Directory might not exist, ignore
    }
  });

  describe('logSecurityEvent', () => {
    it('should log a security event successfully', async () => {
      const event = await securityMonitor.logSecurityEvent(
        'authentication_failure',
        'medium',
        'telegram',
        'Test Event',
        'Test description',
        { testData: 'value' },
        'user123'
      );

      expect(event).toBeDefined();
      expect(event.type).toBe('authentication_failure');
      expect(event.severity).toBe('medium');
      expect(event.platform).toBe('telegram');
      expect(event.userId).toBe('user123');
      expect(event.title).toBe('Test Event');
      expect(event.description).toBe('Test description');
      expect(event.metadata.testData).toBe('value');
      expect(event.adminNotified).toBe(false);
      expect(event.resolved).toBe(false);
    });

    it('should emit security-event when logging', async () => {
      const eventListener = vi.fn();
      securityMonitor.on('security-event', eventListener);

      await securityMonitor.logSecurityEvent(
        'suspicious_activity',
        'high',
        'discord',
        'Suspicious Activity',
        'User behavior is suspicious'
      );

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
        type: 'suspicious_activity',
        severity: 'high',
        platform: 'discord'
      }));
    });

    it('should emit critical-alert for critical events', async () => {
      const criticalListener = vi.fn();
      securityMonitor.on('critical-alert', criticalListener);

      await securityMonitor.logSecurityEvent(
        'injection_attack_detected',
        'critical',
        'telegram',
        'SQL Injection Detected',
        'Potential SQL injection attack'
      );

      expect(criticalListener).toHaveBeenCalledTimes(1);
    });

    it('should write event to log file', async () => {
      const event = await securityMonitor.logSecurityEvent(
        'authentication_success',
        'low',
        'telegram',
        'Login Success',
        'User logged in successfully'
      );

      // Check if log file was created
      const logDate = event.timestamp.toISOString().split('T')[0];
      const logFile = path.join(logDirectory, `security-${logDate}.log`);

      // Wait a bit for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      const logExists = await fs.access(logFile).then(() => true).catch(() => false);
      expect(logExists).toBe(true);

      if (logExists) {
        const logContent = await fs.readFile(logFile, 'utf8');
        expect(logContent).toContain(event.id);
        expect(logContent).toContain('authentication_success');
        expect(logContent).toContain('Login Success');
      }
    });
  });

  describe('logAuthenticationAttempt', () => {
    it('should log successful authentication', async () => {
      const event = await securityMonitor.logAuthenticationAttempt(
        'telegram',
        'user123',
        true,
        { sourceIp: '192.168.1.1' }
      );

      expect(event.type).toBe('authentication_success');
      expect(event.severity).toBe('low');
      expect(event.userId).toBe('user123');
      expect(event.metadata.sourceIp).toBe('192.168.1.1');
    });

    it('should log failed authentication', async () => {
      const event = await securityMonitor.logAuthenticationAttempt(
        'discord',
        'user456',
        false,
        { sourceIp: '10.0.0.1' }
      );

      expect(event.type).toBe('authentication_failure');
      expect(event.severity).toBe('medium');
      expect(event.userId).toBe('user456');
    });
  });

  describe('logValidationFailure', () => {
    it('should log validation failure with correct severity mapping', async () => {
      const validationResult: ValidationResult = {
        valid: false,
        errors: ['SQL injection detected'],
        warnings: ['Suspicious pattern'],
        riskLevel: 'critical'
      };

      const event = await securityMonitor.logValidationFailure(
        'telegram',
        'user789',
        validationResult
      );

      expect(event.type).toBe('injection_attack_detected');
      expect(event.severity).toBe('critical');
      expect(event.userId).toBe('user789');
      expect(event.metadata.validationResult).toEqual(validationResult);
    });

    it('should determine correct event type from validation errors', async () => {
      const rateLimitResult: ValidationResult = {
        valid: false,
        errors: ['Rate limit exceeded'],
        warnings: [],
        riskLevel: 'high'
      };

      const event = await securityMonitor.logValidationFailure(
        'discord',
        'user999',
        rateLimitResult
      );

      expect(event.type).toBe('rate_limit_exceeded');
    });
  });

  describe('auto-blocking', () => {
    it('should auto-block user after failed auth threshold', async () => {
      const userBlockListener = vi.fn();
      securityMonitor.on('user-blocked', userBlockListener);

      // Log multiple failed authentication attempts
      for (let i = 0; i < 4; i++) {
        await securityMonitor.logAuthenticationAttempt('telegram', 'baduser', false);
      }

      expect(userBlockListener).toHaveBeenCalledWith('baduser', expect.stringContaining('authentication_failure'));
      expect(securityMonitor.isUserBlocked('baduser')).toBe(true);
    });

    it('should auto-block user after injection attempts threshold', async () => {
      const userBlockListener = vi.fn();
      securityMonitor.on('user-blocked', userBlockListener);

      // Log multiple injection attempts
      for (let i = 0; i < 3; i++) {
        await securityMonitor.logSecurityEvent(
          'injection_attack_detected',
          'critical',
          'telegram',
          'Injection Attack',
          'SQL injection detected',
          {},
          'hacker123'
        );
      }

      expect(userBlockListener).toHaveBeenCalledWith('hacker123', expect.stringContaining('injection_attack_detected'));
      expect(securityMonitor.isUserBlocked('hacker123')).toBe(true);
    });
  });

  describe('getSecurityEvents', () => {
    beforeEach(async () => {
      // Create test events
      await securityMonitor.logSecurityEvent('authentication_success', 'low', 'telegram', 'Login', 'Success', {}, 'user1');
      await securityMonitor.logSecurityEvent('authentication_failure', 'medium', 'discord', 'Login Failed', 'Failed', {}, 'user2');
      await securityMonitor.logSecurityEvent('injection_attack_detected', 'critical', 'telegram', 'Attack', 'SQL injection', {}, 'user3');
    });

    it('should return all events without filters', () => {
      const events = securityMonitor.getSecurityEvents();
      expect(events).toHaveLength(3);
    });

    it('should filter by severity', () => {
      const criticalEvents = securityMonitor.getSecurityEvents({ severity: ['critical'] });
      expect(criticalEvents).toHaveLength(1);
      expect(criticalEvents[0].severity).toBe('critical');
    });

    it('should filter by type', () => {
      const authEvents = securityMonitor.getSecurityEvents({
        type: ['authentication_success', 'authentication_failure']
      });
      expect(authEvents).toHaveLength(2);
    });

    it('should filter by platform', () => {
      const telegramEvents = securityMonitor.getSecurityEvents({ platform: ['telegram'] });
      expect(telegramEvents).toHaveLength(2);
    });

    it('should filter by user', () => {
      const user1Events = securityMonitor.getSecurityEvents({ userId: 'user1' });
      expect(user1Events).toHaveLength(1);
      expect(user1Events[0].userId).toBe('user1');
    });

    it('should limit results', () => {
      const limitedEvents = securityMonitor.getSecurityEvents({ limit: 2 });
      expect(limitedEvents).toHaveLength(2);
    });
  });

  describe('getSecurityMetrics', () => {
    beforeEach(async () => {
      // Create test events
      await securityMonitor.logSecurityEvent('authentication_failure', 'medium', 'telegram', 'Failed Login', 'Failed', {}, 'user1');
      await securityMonitor.logSecurityEvent('authentication_failure', 'medium', 'discord', 'Failed Login', 'Failed', {}, 'user2');
      await securityMonitor.logSecurityEvent('injection_attack_detected', 'critical', 'telegram', 'Attack', 'Blocked', {}, 'user3');
      await securityMonitor.logSecurityEvent('rate_limit_exceeded', 'high', 'discord', 'Rate Limit', 'Exceeded', {}, 'user4');
    });

    it('should calculate correct metrics', async () => {
      const metrics = await securityMonitor.getSecurityMetrics();

      expect(metrics.totalEvents).toBe(4);
      expect(metrics.eventsBySeverity.medium).toBe(2);
      expect(metrics.eventsBySeverity.critical).toBe(1);
      expect(metrics.eventsBySeverity.high).toBe(1);
      expect(metrics.failedAuthAttempts).toBe(2);
      expect(metrics.blockedAttacks).toBe(1);
      expect(metrics.rateLimitViolations).toBe(1);
    });

    it('should group events by platform', async () => {
      const metrics = await securityMonitor.getSecurityMetrics();

      expect(metrics.eventsByPlatform.telegram).toBe(2);
      expect(metrics.eventsByPlatform.discord).toBe(2);
    });

    it('should group events by type', async () => {
      const metrics = await securityMonitor.getSecurityMetrics();

      expect(metrics.eventsByType.authentication_failure).toBe(2);
      expect(metrics.eventsByType.injection_attack_detected).toBe(1);
      expect(metrics.eventsByType.rate_limit_exceeded).toBe(1);
    });
  });

  describe('user management', () => {
    it('should block and unblock users', async () => {
      expect(securityMonitor.isUserBlocked('testuser')).toBe(false);

      await securityMonitor.blockUser('testuser', 'Test block');
      expect(securityMonitor.isUserBlocked('testuser')).toBe(true);

      await securityMonitor.unblockUser('testuser', 'Test unblock');
      expect(securityMonitor.isUserBlocked('testuser')).toBe(false);
    });

    it('should emit user-blocked event', async () => {
      const userBlockListener = vi.fn();
      securityMonitor.on('user-blocked', userBlockListener);

      await securityMonitor.blockUser('testuser', 'Test reason');

      expect(userBlockListener).toHaveBeenCalledWith('testuser', 'Test reason');
    });
  });

  describe('resolveSecurityEvent', () => {
    it('should resolve security event', async () => {
      const event = await securityMonitor.logSecurityEvent(
        'suspicious_activity',
        'medium',
        'telegram',
        'Test Event',
        'Test description'
      );

      expect(event.resolved).toBe(false);

      const resolved = await securityMonitor.resolveSecurityEvent(event.id, 'Resolved by admin');
      expect(resolved).toBe(true);

      const events = securityMonitor.getSecurityEvents();
      const resolvedEvent = events.find(e => e.id === event.id);
      expect(resolvedEvent?.resolved).toBe(true);
      expect(resolvedEvent?.resolutionNotes).toBe('Resolved by admin');
    });

    it('should return false for non-existent event', async () => {
      const resolved = await securityMonitor.resolveSecurityEvent('nonexistent', 'Test');
      expect(resolved).toBe(false);
    });
  });

  describe('getSecurityDashboard', () => {
    beforeEach(async () => {
      // Create test events
      await securityMonitor.logSecurityEvent('authentication_failure', 'medium', 'telegram', 'Failed', 'Failed', {}, 'user1');
      await securityMonitor.logSecurityEvent('injection_attack_detected', 'critical', 'discord', 'Attack', 'Critical', {}, 'user2');
      await securityMonitor.blockUser('user3', 'Test block');
    });

    it('should return dashboard data', async () => {
      const dashboard = await securityMonitor.getSecurityDashboard();

      expect(dashboard.recentEvents).toBeDefined();
      expect(dashboard.metrics).toBeDefined();
      expect(dashboard.blockedUsers).toContain('user3');
      expect(dashboard.criticalAlerts).toBeDefined();
      expect(dashboard.systemHealth).toBeDefined();
    });

    it('should assess system health correctly', async () => {
      const dashboard = await securityMonitor.getSecurityDashboard();

      // Should be warning due to critical alert
      expect(dashboard.systemHealth.status).toBe('warning');
      expect(dashboard.systemHealth.issues.length).toBeGreaterThan(0);
    });
  });
});
