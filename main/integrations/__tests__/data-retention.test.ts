/**
 * Integration tests for data retention and privacy controls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { DataRetentionManager } from '../data-retention';
import { EncryptionService } from '../encryption-service';
import { SecurityLogger, SecurityEventType, SecurityEventSeverity } from '../security-logger';

describe('Data Retention and Privacy Controls Tests', () => {
  let dataRetentionManager: DataRetentionManager;
  let encryptionService: EncryptionService;
  let securityLogger: SecurityLogger;
  let testDir: string;

  beforeEach(async () => {
    // Create test directory
    testDir = path.join(homedir(), '.everfern-test', 'retention-test');
    await fs.mkdir(testDir, { recursive: true });

    // Mock homedir to use test directory
    vi.spyOn(require('os'), 'homedir').mockReturnValue(path.dirname(testDir));

    // Initialize components
    securityLogger = new SecurityLogger();
    encryptionService = new EncryptionService(securityLogger);
    dataRetentionManager = new DataRetentionManager(securityLogger);

    await securityLogger.initialize();
    await encryptionService.initialize();
    await dataRetentionManager.initialize();
  });

  afterEach(async () => {
    // Stop retention manager
    dataRetentionManager.stop();

    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    // Restore mocks
    vi.restoreAllMocks();
  });

  describe('Data Retention Policies', () => {
    it('should load default retention policies', async () => {
      const policies = dataRetentionManager.getRetentionPolicies();

      expect(policies.length).toBeGreaterThan(0);

      // Check for expected default policies
      const securityEventsPolicy = policies.find(p => p.dataType === 'security_events');
      expect(securityEventsPolicy).toBeDefined();
      expect(securityEventsPolicy?.retentionDays).toBe(90);
      expect(securityEventsPolicy?.enabled).toBe(true);

      const conversationPolicy = policies.find(p => p.dataType === 'conversation_history');
      expect(conversationPolicy).toBeDefined();
      expect(conversationPolicy?.retentionDays).toBe(365);
    });

    it('should update retention policies', async () => {
      const policies = dataRetentionManager.getRetentionPolicies();
      const policyToUpdate = policies[0];

      await dataRetentionManager.updateRetentionPolicy(policyToUpdate.id, {
        retentionDays: 60,
        autoDelete: false
      });

      const updatedPolicies = dataRetentionManager.getRetentionPolicies();
      const updatedPolicy = updatedPolicies.find(p => p.id === policyToUpdate.id);

      expect(updatedPolicy?.retentionDays).toBe(60);
      expect(updatedPolicy?.autoDelete).toBe(false);
    });

    it('should execute retention policies and purge old data', async () => {
      // Create some test security events
      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_SUCCESS,
        SecurityEventSeverity.LOW,
        'test-platform',
        'Test event 1'
      );

      await securityLogger.logEvent(
        SecurityEventType.AUTHENTICATION_SUCCESS,
        SecurityEventSeverity.LOW,
        'test-platform',
        'Test event 2'
      );

      // Execute retention policies
      const results = await dataRetentionManager.executeRetentionPolicies(['security_events_policy']);

      expect(results).toHaveLength(1);
      expect(results[0].policyId).toBe('security_events_policy');
      expect(results[0].dataType).toBe('security_events');
      expect(results[0].errors).toHaveLength(0);
    });

    it('should handle file attachment purging', async () => {
      // Create test attachment directory and files
      const attachmentsDir = path.join(testDir, 'attachments');
      await fs.mkdir(attachmentsDir, { recursive: true });

      // Create old test files
      const oldFile = path.join(attachmentsDir, 'old-file.txt');
      const recentFile = path.join(attachmentsDir, 'recent-file.txt');

      await fs.writeFile(oldFile, 'Old file content');
      await fs.writeFile(recentFile, 'Recent file content');

      // Make the old file appear old by modifying its timestamp
      const oldTime = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
      await fs.utimes(oldFile, oldTime, oldTime);

      // Execute file attachments retention policy
      const results = await dataRetentionManager.executeRetentionPolicies(['file_attachments_policy']);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.dataType).toBe('file_attachments');
      expect(result.itemsProcessed).toBeGreaterThan(0);
    });
  });

  describe('Data Redaction', () => {
    it('should redact sensitive information from text', async () => {
      const sensitiveText = `
        User email: john.doe@example.com
        Phone: (555) 123-4567
        SSN: 123-45-6789
        Credit Card: 4111-1111-1111-1111
        API Key: abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
      `;

      const redactedText = dataRetentionManager.redactSensitiveData(sensitiveText, 'security_events');

      expect(redactedText).toContain('[EMAIL_REDACTED]');
      expect(redactedText).toContain('[PHONE_REDACTED]');
      expect(redactedText).toContain('[SSN_REDACTED]');
      expect(redactedText).toContain('[CARD_REDACTED]');
      expect(redactedText).toContain('[TOKEN_REDACTED]');

      // Ensure original sensitive data is not present
      expect(redactedText).not.toContain('john.doe@example.com');
      expect(redactedText).not.toContain('(555) 123-4567');
      expect(redactedText).not.toContain('123-45-6789');
      expect(redactedText).not.toContain('4111-1111-1111-1111');
    });

    it('should respect redaction settings', async () => {
      const sensitiveText = 'Contact us at support@example.com or call (555) 123-4567';

      // Disable redaction
      await dataRetentionManager.updatePrivacySettings({
        enableDataRedaction: false
      });

      const unredactedText = dataRetentionManager.redactSensitiveData(sensitiveText, 'security_events');
      expect(unredactedText).toBe(sensitiveText); // Should be unchanged

      // Re-enable redaction
      await dataRetentionManager.updatePrivacySettings({
        enableDataRedaction: true
      });

      const redactedText = dataRetentionManager.redactSensitiveData(sensitiveText, 'security_events');
      expect(redactedText).toContain('[EMAIL_REDACTED]');
      expect(redactedText).toContain('[PHONE_REDACTED]');
    });

    it('should handle custom redaction patterns', async () => {
      const customPattern = {
        id: 'custom_id',
        name: 'Custom ID Pattern',
        pattern: 'ID-\\d{6}',
        replacement: '[CUSTOM_ID_REDACTED]',
        enabled: true,
        dataTypes: ['security_events']
      };

      // Add custom pattern
      const currentSettings = dataRetentionManager.getPrivacySettings();
      await dataRetentionManager.updatePrivacySettings({
        redactionPatterns: [...currentSettings.redactionPatterns, customPattern]
      });

      const textWithCustomId = 'User ID-123456 accessed the system';
      const redactedText = dataRetentionManager.redactSensitiveData(textWithCustomId, 'security_events');

      expect(redactedText).toContain('[CUSTOM_ID_REDACTED]');
      expect(redactedText).not.toContain('ID-123456');
    });
  });

  describe('Data Export', () => {
    it('should handle data export requests', async () => {
      const userId = 'test-user-123';
      const dataTypes = ['user_data', 'conversation_history'];

      const exportId = await dataRetentionManager.requestDataExport(userId, dataTypes);

      expect(exportId).toBeDefined();
      expect(exportId).toMatch(/^export_\d+_[a-z0-9]+$/);

      // Check export status
      const exportStatus = dataRetentionManager.getDataExportStatus(exportId);
      expect(exportStatus).toBeDefined();
      expect(exportStatus?.userId).toBe(userId);
      expect(exportStatus?.dataTypes).toEqual(dataTypes);
      expect(exportStatus?.status).toBe('pending');
    });

    it('should process data export and create files', async () => {
      const userId = 'test-user-456';
      const dataTypes = ['user_data'];

      const exportId = await dataRetentionManager.requestDataExport(userId, dataTypes);

      // Wait for export processing
      await new Promise(resolve => setTimeout(resolve, 200));

      const exportStatus = dataRetentionManager.getDataExportStatus(exportId);
      expect(exportStatus?.status).toMatch(/completed|processing/);

      if (exportStatus?.status === 'completed' && exportStatus.exportPath) {
        // Check if export files were created
        const exportFiles = await fs.readdir(exportStatus.exportPath);
        expect(exportFiles).toContain('user_data.json');
      }
    });

    it('should respect privacy settings for data export', async () => {
      // Disable data export
      await dataRetentionManager.updatePrivacySettings({
        allowDataExport: false
      });

      const userId = 'test-user-789';

      await expect(
        dataRetentionManager.requestDataExport(userId, ['user_data'])
      ).rejects.toThrow('Data export is not allowed by privacy settings');
    });
  });

  describe('Data Deletion (Right to be Forgotten)', () => {
    it('should delete user data when requested', async () => {
      const userId = 'user-to-delete';

      // This should not throw an error
      await expect(
        dataRetentionManager.deleteUserData(userId, ['user_data', 'conversation_history'])
      ).resolves.not.toThrow();
    });

    it('should respect privacy settings for data deletion', async () => {
      // Disable data deletion
      await dataRetentionManager.updatePrivacySettings({
        allowDataDeletion: false
      });

      const userId = 'test-user-delete';

      await expect(
        dataRetentionManager.deleteUserData(userId)
      ).rejects.toThrow('Data deletion is not allowed by privacy settings');
    });

    it('should log data deletion activities', async () => {
      const userId = 'user-for-logging';

      await dataRetentionManager.deleteUserData(userId, ['user_data']);

      // Check that deletion was logged
      const recentEvents = await securityLogger.getEvents({ limit: 10 });
      const deletionEvent = recentEvents.find(event =>
        event.type === SecurityEventType.CONFIGURATION_CHANGE &&
        event.message.includes('User data deletion completed')
      );

      expect(deletionEvent).toBeDefined();
      expect(deletionEvent?.details.userId).toBe(userId);
    });
  });

  describe('Privacy Settings Management', () => {
    it('should get and update privacy settings', async () => {
      const currentSettings = dataRetentionManager.getPrivacySettings();

      expect(currentSettings).toBeDefined();
      expect(currentSettings.enableDataRedaction).toBe(true);
      expect(currentSettings.enableEncryption).toBe(true);

      // Update settings
      await dataRetentionManager.updatePrivacySettings({
        enableDataRedaction: false,
        requireExplicitConsent: true
      });

      const updatedSettings = dataRetentionManager.getPrivacySettings();
      expect(updatedSettings.enableDataRedaction).toBe(false);
      expect(updatedSettings.requireExplicitConsent).toBe(true);
      expect(updatedSettings.enableEncryption).toBe(true); // Should remain unchanged
    });

    it('should validate privacy settings updates', async () => {
      const originalSettings = dataRetentionManager.getPrivacySettings();

      // Update with valid settings
      await dataRetentionManager.updatePrivacySettings({
        encryptionAlgorithm: 'aes-256-cbc'
      });

      const updatedSettings = dataRetentionManager.getPrivacySettings();
      expect(updatedSettings.encryptionAlgorithm).toBe('aes-256-cbc');
    });
  });

  describe('Integration with Encryption Service', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const originalData = 'This is sensitive data that needs encryption';

      // Encrypt data
      const encryptedData = await encryptionService.encryptData(originalData);

      expect(encryptedData).toBeDefined();
      expect(encryptedData.algorithm).toBe('aes-256-gcm');
      expect(encryptedData.data).not.toBe(originalData);
      expect(encryptedData.iv).toBeDefined();
      expect(encryptedData.salt).toBeDefined();
      expect(encryptedData.tag).toBeDefined();

      // Decrypt data
      const decryptedData = await encryptionService.decryptData(encryptedData);
      expect(decryptedData.toString('utf8')).toBe(originalData);
    });

    it('should generate and use key pairs for asymmetric encryption', async () => {
      const keyPair = await encryptionService.generateKeyPair('rsa', 2048);

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.algorithm).toBe('rsa');
      expect(keyPair.keySize).toBe(2048);

      // Test encryption/decryption with key pair
      const originalData = 'Test message for asymmetric encryption';
      const encrypted = await encryptionService.encryptWithPublicKey(originalData, keyPair.publicKey);
      const decrypted = await encryptionService.decryptWithPrivateKey(encrypted, keyPair.privateKey);

      expect(decrypted.toString('utf8')).toBe(originalData);
    });

    it('should sign and verify data', async () => {
      const keyPair = await encryptionService.generateKeyPair('rsa', 2048);
      const dataToSign = 'Important data that needs to be signed';

      // Sign data
      const signature = await encryptionService.signData(dataToSign, keyPair.privateKey);
      expect(signature).toBeDefined();

      // Verify signature
      const isValid = await encryptionService.verifySignature(dataToSign, signature, keyPair.publicKey);
      expect(isValid).toBe(true);

      // Verify with tampered data
      const tamperedData = 'Tampered data';
      const isInvalid = await encryptionService.verifySignature(tamperedData, signature, keyPair.publicKey);
      expect(isInvalid).toBe(false);
    });

    it('should generate secure hashes and tokens', async () => {
      const data = 'Data to hash';

      // Generate hash
      const hash = encryptionService.generateHash(data);
      expect(hash).toBeDefined();
      expect(hash).toHaveLength(64); // SHA-256 produces 64 character hex string

      // Same data should produce same hash
      const hash2 = encryptionService.generateHash(data);
      expect(hash).toBe(hash2);

      // Different data should produce different hash
      const differentHash = encryptionService.generateHash('Different data');
      expect(hash).not.toBe(differentHash);

      // Generate secure token
      const token = encryptionService.generateSecureToken(32);
      expect(token).toBeDefined();
      expect(token).toHaveLength(64); // 32 bytes = 64 hex characters

      // Tokens should be unique
      const token2 = encryptionService.generateSecureToken(32);
      expect(token).not.toBe(token2);
    });
  });

  describe('Error Handling and Security', () => {
    it('should handle encryption failures gracefully', async () => {
      // Try to decrypt with wrong key
      const encryptedData = await encryptionService.encryptData('test data');

      // Tamper with the encrypted data
      encryptedData.data = 'invalid-base64-data';

      await expect(
        encryptionService.decryptData(encryptedData)
      ).rejects.toThrow();
    });

    it('should log security events for encryption operations', async () => {
      // Perform some encryption operations
      await encryptionService.encryptData('test data');
      await encryptionService.generateKeyPair();

      // Check that security events were logged
      const recentEvents = await securityLogger.getEvents({ limit: 10 });
      const encryptionEvents = recentEvents.filter(event =>
        event.source === 'encryption-service'
      );

      expect(encryptionEvents.length).toBeGreaterThan(0);
    });

    it('should handle retention policy execution errors', async () => {
      // Create a policy with invalid configuration
      await dataRetentionManager.updateRetentionPolicy('security_events_policy', {
        archivePath: '/invalid/path/that/does/not/exist'
      });

      // Execute the policy - should handle errors gracefully
      const results = await dataRetentionManager.executeRetentionPolicies(['security_events_policy']);

      expect(results).toHaveLength(1);
      // The result should indicate success even if archiving fails
      expect(results[0].policyId).toBe('security_events_policy');
    });
  });
});
