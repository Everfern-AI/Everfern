/**
 * Input Validator Tests
 *
 * Comprehensive tests for the input validation system including
 * injection attack prevention, content filtering, and rate limiting.
 */

import { InputValidator, defaultContentFilterConfig, defaultWebhookConfig } from '../input-validator';
import { IncomingMessage, PlatformFile } from '../platform-interface';
import crypto from 'crypto';

describe('InputValidator', () => {
  let validator: InputValidator;
  let mockMessage: IncomingMessage;

  beforeEach(() => {
    validator = new InputValidator(
      {
        ...defaultContentFilterConfig,
        rateLimiting: {
          messagesPerMinute: 5,
          filesPerHour: 3,
          burstAllowance: 2
        }
      },
      {
        ...defaultWebhookConfig,
        secretKey: 'test-secret-key'
      }
    );

    mockMessage = {
      id: 'test-message-1',
      platform: 'telegram',
      user: {
        id: 'user123',
        name: 'Test User',
        avatar: 'https://example.com/avatar.jpg'
      },
      chat: {
        id: 'chat123',
        name: 'Test Chat',
        type: 'private'
      },
      content: {
        text: 'Hello, this is a test message',
        files: [],
        isMention: false
      },
      timestamp: new Date(),
      raw: {}
    };
  });

  describe('Message Validation', () => {
    it('should validate clean messages successfully', async () => {
      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.riskLevel).toBe('low');
      expect(result.sanitized).toBeDefined();
      expect(result.sanitized?.content.text).toBe('Hello, this is a test message');
    });

    it('should reject messages that are too long', async () => {
      mockMessage.content.text = 'a'.repeat(5000);

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Message too long');
      expect(result.riskLevel).toBe('medium');
    });

    it('should detect SQL injection attempts', async () => {
      mockMessage.content.text = "Hello'; DROP TABLE users; --";

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Potential injection attack detected');
      expect(result.warnings).toContain('SQL injection pattern detected');
      expect(result.riskLevel).toBe('critical');
    });

    it('should detect XSS attempts', async () => {
      mockMessage.content.text = 'Hello <script>alert("xss")</script>';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Potential injection attack detected');
      expect(result.warnings).toContain('XSS pattern detected');
      expect(result.riskLevel).toBe('critical');
    });

    it('should detect command injection attempts', async () => {
      mockMessage.content.text = 'Hello && rm -rf /';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Potential injection attack detected');
      expect(result.warnings).toContain('Command injection pattern detected');
      expect(result.riskLevel).toBe('critical');
    });

    it('should detect profanity when enabled', async () => {
      mockMessage.content.text = 'This is fucking terrible';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true); // Profanity is warning, not error
      expect(result.warnings).toContain('Profanity detected');
      expect(result.riskLevel).toBe('medium');
    });

    it('should detect spam patterns', async () => {
      mockMessage.content.text = 'BUY NOW!!! CLICK HERE!!! LIMITED TIME!!! AAAAAAAAAAAAA';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true); // Spam is warning, not error
      expect(result.warnings).toContain('Potential spam detected');
      expect(result.riskLevel).toBe('high');
    });

    it('should validate URLs and detect blocked domains', async () => {
      const validatorWithBlockedDomains = new InputValidator(
        {
          ...defaultContentFilterConfig,
          blockedDomains: ['malware.com', 'phishing.net']
        },
        defaultWebhookConfig
      );

      mockMessage.content.text = 'Check out this link: https://malware.com/bad-stuff';

      const result = await validatorWithBlockedDomains.validateMessage(mockMessage);

      expect(result.valid).toBe(true); // URL blocking is warning, not error
      expect(result.warnings).toContain('Blocked domain detected: malware.com');
      expect(result.riskLevel).toBe('high');
    });

    it('should sanitize text input properly', async () => {
      mockMessage.content.text = '  Hello\x00World\x01Test  ';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.content.text).toBe('HelloWorldTest');
    });
  });

  describe('File Validation', () => {
    let mockFile: PlatformFile;

    beforeEach(() => {
      mockFile = {
        id: 'file123',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 1024,
        url: 'https://example.com/file.txt',
        caption: 'Test file'
      };
    });

    it('should validate allowed file types', async () => {
      mockMessage.content.files = [mockFile];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.content.files).toHaveLength(1);
    });

    it('should reject files that are too large', async () => {
      mockFile.size = 30 * 1024 * 1024; // 30MB
      mockMessage.content.files = [mockFile];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('File too large');
      expect(result.riskLevel).toBe('high'); // File upload rate limit also triggers, making it high
    });

    it('should reject disallowed file types', async () => {
      mockFile.mimeType = 'application/x-executable';
      mockMessage.content.files = [mockFile];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File type not allowed: application/x-executable');
      expect(result.riskLevel).toBe('high');
    });

    it('should detect suspicious filenames', async () => {
      mockFile.name = 'innocent.txt.exe';
      mockMessage.content.files = [mockFile];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true); // Suspicious filename is warning, not error
      expect(result.warnings).toContain('Suspicious filename detected');
      expect(result.riskLevel).toBe('medium');
    });

    it('should sanitize filenames', async () => {
      mockFile.name = 'test<>file|name?.txt';
      mockMessage.content.files = [mockFile];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.content.files[0].name).toBe('testfilename.txt');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow messages within rate limit', async () => {
      // Send 3 messages (within limit of 5)
      for (let i = 0; i < 3; i++) {
        const result = await validator.validateMessage({
          ...mockMessage,
          id: `message-${i}`
        });
        expect(result.valid).toBe(true);
      }
    });

    it('should reject messages exceeding rate limit', async () => {
      // Send 6 messages (exceeds limit of 5)
      let lastResult;
      for (let i = 0; i < 6; i++) {
        lastResult = await validator.validateMessage({
          ...mockMessage,
          id: `message-${i}`
        });
      }

      expect(lastResult?.valid).toBe(false);
      expect(lastResult?.errors).toContain('Rate limit exceeded');
      expect(lastResult?.riskLevel).toBe('high');
    });

    it('should track file upload rate limits separately', async () => {
      const mockFile: PlatformFile = {
        id: 'file123',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 1024,
        url: 'https://example.com/file.txt'
      };

      // Send 4 files (exceeds limit of 3)
      let lastResult;
      for (let i = 0; i < 4; i++) {
        lastResult = await validator.validateMessage({
          ...mockMessage,
          id: `message-${i}`,
          content: {
            ...mockMessage.content,
            files: [{ ...mockFile, id: `file-${i}` }]
          }
        });
      }

      expect(lastResult?.valid).toBe(false);
      expect(lastResult?.errors).toContain('File upload rate limit exceeded');
    });

    it('should provide rate limit status', () => {
      const status = validator.getRateLimitStatus('user123');

      expect(status).toHaveProperty('messages');
      expect(status).toHaveProperty('files');
      expect(status).toHaveProperty('resetTime');
      expect(typeof status.messages).toBe('number');
      expect(typeof status.files).toBe('number');
      expect(typeof status.resetTime).toBe('number');
    });
  });

  describe('Webhook Signature Validation', () => {
    const testPayload = '{"test": "data"}';
    const testTimestamp = Math.floor(Date.now() / 1000).toString();

    it('should validate correct webhook signatures', () => {
      const hmac = crypto.createHmac('sha256', 'test-secret-key');
      hmac.update(`${testTimestamp}.${testPayload}`);
      const signature = `sha256=${hmac.digest('hex')}`;

      const result = validator.validateWebhookSignature(testPayload, signature, testTimestamp);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.riskLevel).toBe('low');
    });

    it('should reject invalid webhook signatures', () => {
      const invalidSignature = 'sha256=invalid-signature';

      const result = validator.validateWebhookSignature(testPayload, invalidSignature, testTimestamp);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid webhook signature');
      expect(result.riskLevel).toBe('critical');
    });

    it('should reject requests that are too old', () => {
      const oldTimestamp = Math.floor((Date.now() - 400000) / 1000).toString(); // 400 seconds ago
      const hmac = crypto.createHmac('sha256', 'test-secret-key');
      hmac.update(`${oldTimestamp}.${testPayload}`);
      const signature = `sha256=${hmac.digest('hex')}`;

      const result = validator.validateWebhookSignature(testPayload, signature, oldTimestamp);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Request too old');
    });

    it('should validate signatures without timestamp', () => {
      const hmac = crypto.createHmac('sha256', 'test-secret-key');
      hmac.update(testPayload);
      const signature = `sha256=${hmac.digest('hex')}`;

      const result = validator.validateWebhookSignature(testPayload, signature);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Text Sanitization', () => {
    it('should remove null bytes and control characters', () => {
      const dirtyText = 'Hello\x00World\x01Test\x7F';
      const sanitized = validator.sanitizeText(dirtyText);

      expect(sanitized).toBe('HelloWorldTest');
    });

    it('should normalize whitespace', () => {
      const dirtyText = '  Hello   World  \n\n  Test  ';
      const sanitized = validator.sanitizeText(dirtyText);

      expect(sanitized).toBe('Hello World Test');
    });

    it('should limit text length', () => {
      const longText = 'a'.repeat(5000);
      const sanitized = validator.sanitizeText(longText);

      expect(sanitized.length).toBe(defaultContentFilterConfig.maxMessageLength);
    });
  });

  describe('Configuration Updates', () => {
    it('should update content filter configuration', async () => {
      validator.updateContentFilterConfig({
        maxMessageLength: 1000,
        enableProfanityFilter: false
      });

      // Configuration update should be reflected in validation
      const longMessage = {
        ...mockMessage,
        content: { ...mockMessage.content, text: 'a'.repeat(1500) }
      };

      const result = await validator.validateMessage(longMessage);
      expect(result.errors[0]).toContain('Message too long');
    });

    it('should update webhook configuration', () => {
      validator.updateWebhookConfig({
        secretKey: 'new-secret-key',
        maxRequestAge: 600
      });

      // New configuration should be used for validation
      const testPayload = '{"test": "data"}';
      const hmac = crypto.createHmac('sha256', 'new-secret-key');
      hmac.update(testPayload);
      const signature = `sha256=${hmac.digest('hex')}`;

      const result = validator.validateWebhookSignature(testPayload, signature);
      expect(result.valid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
      // Create a message with invalid structure to trigger error
      const invalidMessage = {
        ...mockMessage,
        content: null as any
      };

      const result = await validator.validateMessage(invalidMessage);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation error occurred');
      expect(result.riskLevel).toBe('critical');
    });

    it('should handle webhook signature validation errors', () => {
      // Test with malformed signature
      const result = validator.validateWebhookSignature('test', 'malformed-signature');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid webhook signature');
      expect(result.riskLevel).toBe('critical');
    });
  });

  describe('Security Edge Cases', () => {
    it('should detect multiple injection types in one message', async () => {
      mockMessage.content.text = 'Hello <script>alert(1)</script> AND 1=1; rm -rf /';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(1);
      expect(result.riskLevel).toBe('critical');
    });

    it('should handle empty messages', async () => {
      mockMessage.content.text = '';
      mockMessage.content.files = [];

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.content.text).toBe('');
    });

    it('should handle unicode and special characters safely', async () => {
      mockMessage.content.text = 'Hello 🌍 世界 مرحبا';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.sanitized?.content.text).toBe('Hello 🌍 世界 مرحبا');
    });

    it('should detect URL shorteners as suspicious', async () => {
      mockMessage.content.text = 'Check this out: https://bit.ly/suspicious';

      const result = await validator.validateMessage(mockMessage);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Suspicious URL pattern detected');
    });
  });
});
