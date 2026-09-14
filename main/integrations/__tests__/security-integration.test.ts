/**
 * Security Integration Service Tests
 *
 * Unit tests for the security integration service that ties together
 * all security monitoring components.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecurityIntegrationService, SecurityIntegrationConfig, defaultSecurityIntegrationConfig } from '../security-integration';
import { IncomingMessage } from '../platform-interface';

// Mock dependencies
vi.mock('../security-monitor', () => ({
  getSecurityMonitor: vi.fn(() => ({
    logSecurityEvent: vi.fn(),
    logAuthenticationAttempt: vi.fn(),
    logValidationFailure: vi.fn(),
    logSuspiciousActivity: vi.fn(),
    logSystemError: vi.fn(),
    getSecurityMetrics: vi.fn(),
    getSecurityDashboard: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    isUserBlocked: vi.fn(),
    resolveSecurityEvent: vi.fn(),
    on: vi.fn(),
    emit: vi.fn()
  }))
}));

vi.mock('../security-dashboard', () => ({
  createSecurityDashboard: vi.fn(() => ({
    getDashboardData: vi.fn(),
    getSecurityStatus: vi.fn(),
    exportSecurityReport: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn()
  }))
}));

vi.mock('../input-validator', () => ({
  createInputValidator: vi.fn(() => ({
    validateMessage: vi.fn(),
    validateWebhookSignature: vi.fn(),
    updateContentFilterConfig: vi.fn(),
    updateWebhookConfig: vi.fn()
  }))
}));

vi.mock('../notification-service', () => ({
  getNotificationService: vi.fn(() => ({
    createNotification: vi.fn(),
    createErrorNotification: vi.fn(),
    createWarningNotification: vi.fn()
  }))
}));

describe('SecurityIntegrationService', () => {
  let securityIntegration: SecurityIntegrationService;
  let testConfig: SecurityIntegrationConfig;

  beforeEach(() => {
    testConfig = {
      ...defaultSecurityIntegrationConfig,
      webhook: {
        ...defaultSecurityIntegrationConfig.webhook,
        secretKey: 'test-secret-key'
      }
    };

    securityIntegration = new SecurityIntegrationService(testConfig);
  });

  afterEach(async () => {
    await securityIntegration.destroy();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(securityIntegration.initialize()).resolves.not.toThrow();
    });

    it('should not initialize twice', async () => {
      await securityIntegration.initialize();
      await expect(securityIntegration.initialize()).resolves.not.toThrow();
    });

    it('should throw error when using methods before initialization', async () => {
      const testMessage: IncomingMessage = {
        id: 'msg1',
        platform: 'telegram',
        user: { id: 'user1', name: 'Test User' },
        chat: { id: 'chat1', name: 'Test Chat', type: 'private' },
        content: { text: 'Hello', files: [], isMention: false },
        timestamp: new Date(),
        raw: {}
      };

      await expect(securityIntegration.validateMessage(testMessage)).rejects.toThrow('not initialized');
    });
  });

  describe('message validation', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should validate message successfully', async () => {
      const testMessage: IncomingMessage = {
        id: 'msg1',
        platform: 'telegram',
        user: { id: 'user1', name: 'Test User' },
        chat: { id: 'chat1', name: 'Test Chat', type: 'private' },
        content: { text: 'Hello world', files: [], isMention: false },
        timestamp: new Date(),
        raw: {}
      };

      // Mock successful validation
      const mockValidator = require('../input-validator').createInputValidator();
      mockValidator.validateMessage.mockResolvedValue({
        valid: true,
        sanitized: testMessage,
        errors: [],
        warnings: [],
        riskLevel: 'low'
      });

      const result = await securityIntegration.validateMessage(testMessage);

      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('low');
      expect(mockValidator.validateMessage).toHaveBeenCalledWith(testMessage, {});
    });

    it('should handle validation failure with security event', async () => {
      const testMessage: IncomingMessage = {
        id: 'msg2',
        platform: 'discord',
        user: { id: 'user2', name: 'Bad User' },
        chat: { id: 'chat2', name: 'Test Chat', type: 'private' },
        content: { text: 'SELECT * FROM users', files: [], isMention: false },
        timestamp: new Date(),
        raw: {}
      };

      // Mock validation failure
      const mockValidator = require('../input-validator').createInputValidator();
      mockValidator.validateMessage.mockResolvedValue({
        valid: false,
        errors: ['SQL injection detected'],
        warnings: [],
        riskLevel: 'critical'
      });

      // Mock security monitor
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      mockSecurityMonitor.logValidationFailure.mockResolvedValue({
        id: 'event123',
        type: 'injection_attack_detected',
        severity: 'critical'
      });

      const result = await securityIntegration.validateMessage(testMessage);

      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('critical');
      expect(result.securityEventId).toBe('event123');
      expect(mockSecurityMonitor.logValidationFailure).toHaveBeenCalledWith(
        'discord',
        'user2',
        expect.objectContaining({ riskLevel: 'critical' }),
        {}
      );
    });

    it('should log successful validation for audit trail', async () => {
      const testMessage: IncomingMessage = {
        id: 'msg3',
        platform: 'telegram',
        user: { id: 'user3', name: 'Good User' },
        chat: { id: 'chat3', name: 'Test Chat', type: 'private' },
        content: { text: 'Normal message', files: [], isMention: false },
        timestamp: new Date(),
        raw: {}
      };

      // Mock successful validation
      const mockValidator = require('../input-validator').createInputValidator();
      mockValidator.validateMessage.mockResolvedValue({
        valid: true,
        sanitized: testMessage,
        errors: [],
        warnings: [],
        riskLevel: 'low'
      });

      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await securityIntegration.validateMessage(testMessage);

      expect(mockSecurityMonitor.logSecurityEvent).toHaveBeenCalledWith(
        'authentication_success',
        'low',
        'telegram',
        'Message Validation Successful',
        expect.stringContaining('user3'),
        expect.objectContaining({
          messageLength: 14,
          fileCount: 0
        }),
        'user3'
      );
    });
  });

  describe('webhook validation', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should validate webhook signature successfully', async () => {
      const mockValidator = require('../input-validator').createInputValidator();
      mockValidator.validateWebhookSignature.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
        riskLevel: 'low'
      });

      const result = await securityIntegration.validateWebhook(
        'test payload',
        'valid-signature',
        '1234567890',
        'telegram'
      );

      expect(result.valid).toBe(true);
      expect(result.securityEventId).toBeUndefined();
    });

    it('should handle invalid webhook signature', async () => {
      const mockValidator = require('../input-validator').createInputValidator();
      mockValidator.validateWebhookSignature.mockReturnValue({
        valid: false,
        errors: ['Invalid signature'],
        warnings: [],
        riskLevel: 'critical'
      });

      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      mockSecurityMonitor.logSecurityEvent.mockResolvedValue({
        id: 'webhook-event-123'
      });

      const result = await securityIntegration.validateWebhook(
        'test payload',
        'invalid-signature',
        '1234567890',
        'telegram'
      );

      expect(result.valid).toBe(false);
      expect(result.securityEventId).toBe('webhook-event-123');
      expect(mockSecurityMonitor.logSecurityEvent).toHaveBeenCalledWith(
        'webhook_signature_invalid',
        'critical',
        'telegram',
        'Webhook Signature Validation Failed',
        expect.stringContaining('potential security breach'),
        expect.objectContaining({
          signatureProvided: 'invalid-signature',
          payloadLength: 12
        })
      );
    });
  });

  describe('authentication logging', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should log authentication attempt', async () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await securityIntegration.logAuthenticationAttempt(
        'discord',
        'user123',
        true,
        { sourceIp: '192.168.1.1' }
      );

      expect(mockSecurityMonitor.logAuthenticationAttempt).toHaveBeenCalledWith(
        'discord',
        'user123',
        true,
        { sourceIp: '192.168.1.1' }
      );
    });

    it('should not log when not initialized', async () => {
      const uninitializedService = new SecurityIntegrationService(testConfig);
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await uninitializedService.logAuthenticationAttempt('telegram', 'user456', false);

      expect(mockSecurityMonitor.logAuthenticationAttempt).not.toHaveBeenCalled();
    });
  });

  describe('user management', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should block user', async () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await securityIntegration.blockUser('baduser', 'Malicious activity');

      expect(mockSecurityMonitor.blockUser).toHaveBeenCalledWith('baduser', 'Malicious activity');
    });

    it('should unblock user', async () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await securityIntegration.unblockUser('user123', 'Appeal approved');

      expect(mockSecurityMonitor.unblockUser).toHaveBeenCalledWith('user123', 'Appeal approved');
    });

    it('should check if user is blocked', () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      mockSecurityMonitor.isUserBlocked.mockReturnValue(true);

      const isBlocked = securityIntegration.isUserBlocked('blockeduser');

      expect(isBlocked).toBe(true);
      expect(mockSecurityMonitor.isUserBlocked).toHaveBeenCalledWith('blockeduser');
    });

    it('should return false for blocked check when not initialized', () => {
      const uninitializedService = new SecurityIntegrationService(testConfig);
      const isBlocked = uninitializedService.isUserBlocked('anyuser');
      expect(isBlocked).toBe(false);
    });
  });

  describe('dashboard and metrics', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should get security dashboard data', async () => {
      const mockDashboard = require('../security-dashboard').createSecurityDashboard();
      const mockDashboardData = {
        summary: { totalEvents: 10, criticalEvents: 2 },
        recentEvents: [],
        metrics: {}
      };
      mockDashboard.getDashboardData.mockResolvedValue(mockDashboardData);

      const dashboardData = await securityIntegration.getSecurityDashboard();

      expect(dashboardData).toEqual(mockDashboardData);
      expect(mockDashboard.getDashboardData).toHaveBeenCalled();
    });

    it('should get security metrics', async () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      const mockMetrics = { totalEvents: 5, eventsBySeverity: {} };
      mockSecurityMonitor.getSecurityMetrics.mockResolvedValue(mockMetrics);

      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-02');

      const metrics = await securityIntegration.getSecurityMetrics(startDate, endDate);

      expect(metrics).toEqual(mockMetrics);
      expect(mockSecurityMonitor.getSecurityMetrics).toHaveBeenCalledWith(startDate, endDate);
    });

    it('should export security report', async () => {
      const mockDashboard = require('../security-dashboard').createSecurityDashboard();
      const mockReport = { data: 'csv,data', filename: 'report.csv' };
      mockDashboard.exportSecurityReport.mockResolvedValue(mockReport);

      const report = await securityIntegration.exportSecurityReport('csv', { timeRange: '24h' });

      expect(report).toEqual(mockReport);
      expect(mockDashboard.exportSecurityReport).toHaveBeenCalledWith('csv', { timeRange: '24h' });
    });
  });

  describe('configuration management', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should update configuration', async () => {
      const mockValidator = require('../input-validator').createInputValidator();
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      const newConfig = {
        contentFilter: {
          ...testConfig.contentFilter,
          maxMessageLength: 5000
        }
      };

      await securityIntegration.updateConfiguration(newConfig);

      expect(mockValidator.updateContentFilterConfig).toHaveBeenCalledWith(newConfig.contentFilter);
      expect(mockSecurityMonitor.logSecurityEvent).toHaveBeenCalledWith(
        'configuration_change',
        'medium',
        'system',
        'Security Configuration Updated',
        expect.stringContaining('updated'),
        expect.objectContaining({
          changedFields: ['contentFilter']
        })
      );
    });

    it('should sanitize sensitive configuration data in logs', async () => {
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      const newConfig = {
        webhook: {
          ...testConfig.webhook,
          secretKey: 'new-secret-key'
        }
      };

      await securityIntegration.updateConfiguration(newConfig);

      const logCall = mockSecurityMonitor.logSecurityEvent.mock.calls.find(
        call => call[0] === 'configuration_change'
      );

      expect(logCall[5].oldConfig.webhook.secretKey).toBe('[REDACTED]');
      expect(logCall[5].newConfig.webhook.secretKey).toBe('[REDACTED]');
    });
  });

  describe('security status', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should get security status', async () => {
      const mockDashboard = require('../security-dashboard').createSecurityDashboard();
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      const mockStatus = {
        status: 'healthy' as const,
        activeThreats: 0,
        blockedUsers: 1,
        lastUpdate: new Date()
      };

      const mockSystemHealth = {
        systemHealth: {
          status: 'healthy' as const,
          issues: []
        }
      };

      mockDashboard.getSecurityStatus.mockResolvedValue(mockStatus);
      mockSecurityMonitor.getSecurityDashboard.mockResolvedValue(mockSystemHealth);

      const status = await securityIntegration.getSecurityStatus();

      expect(status.status).toBe('healthy');
      expect(status.activeThreats).toBe(0);
      expect(status.blockedUsers).toBe(1);
      expect(status.systemHealth).toEqual(mockSystemHealth.systemHealth);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await securityIntegration.initialize();
    });

    it('should handle validation errors gracefully', async () => {
      const testMessage: IncomingMessage = {
        id: 'msg1',
        platform: 'telegram',
        user: { id: 'user1', name: 'Test User' },
        chat: { id: 'chat1', name: 'Test Chat', type: 'private' },
        content: { text: 'Hello', files: [], isMention: false },
        timestamp: new Date(),
        raw: {}
      };

      const mockValidator = require('../input-validator').createInputValidator();
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      const testError = new Error('Validation failed');

      mockValidator.validateMessage.mockRejectedValue(testError);

      await expect(securityIntegration.validateMessage(testMessage)).rejects.toThrow('Validation failed');
      expect(mockSecurityMonitor.logSystemError).toHaveBeenCalledWith('telegram', testError, {});
    });

    it('should handle webhook validation errors gracefully', async () => {
      const mockValidator = require('../input-validator').createInputValidator();
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();
      const testError = new Error('Webhook validation failed');

      mockValidator.validateWebhookSignature.mockImplementation(() => {
        throw testError;
      });

      await expect(securityIntegration.validateWebhook('payload', 'signature')).rejects.toThrow('Webhook validation failed');
      expect(mockSecurityMonitor.logSystemError).toHaveBeenCalledWith('webhook', testError);
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources on destroy', async () => {
      await securityIntegration.initialize();
      const mockDashboard = require('../security-dashboard').createSecurityDashboard();
      const mockSecurityMonitor = require('../security-monitor').getSecurityMonitor();

      await securityIntegration.destroy();

      expect(mockDashboard.destroy).toHaveBeenCalled();
      expect(mockSecurityMonitor.logSecurityEvent).toHaveBeenCalledWith(
        'configuration_change',
        'low',
        'system',
        'Security System Shutdown',
        expect.stringContaining('shut down'),
        {}
      );
    });
  });
});
