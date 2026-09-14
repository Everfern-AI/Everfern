/**
 * Input Validator Integration Tests
 *
 * Tests the integration of the input validator with the bot manager
 * to ensure proper message validation and sanitization.
 */

import { BotIntegrationManager, defaultBotIntegrationConfig } from '../bot-manager';
import { IncomingMessage } from '../platform-interface';

describe('Input Validator Integration', () => {
  let botManager: BotIntegrationManager;
  let mockMessage: IncomingMessage;

  beforeEach(() => {
    // Create bot manager with validation enabled
    const config = {
      ...defaultBotIntegrationConfig,
      validation: {
        enabled: true,
        contentFilter: {
          enableProfanityFilter: true,
          enableSpamDetection: true,
          maxMessageLength: 100, // Short for testing
          rateLimiting: {
            messagesPerMinute: 2,
            filesPerHour: 1,
            burstAllowance: 1
          }
        },
        webhook: {
          secretKey: 'test-secret',
          signatureHeader: 'X-Hub-Signature-256',
          hashAlgorithm: 'sha256',
          maxRequestAge: 300
        }
      }
    };

    botManager = new BotIntegrationManager(config);

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

  describe('Message Validation Integration', () => {
    it('should validate clean messages and emit messageReceived', (done) => {
      botManager.on('messageReceived', (context) => {
        expect(context.message.content.text).toBe('Hello, this is a test message');
        expect(context.metadata.validated).toBe(true);
        done();
      });

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(mockMessage);
    });

    it('should reject messages that are too long and emit validationError', (done) => {
      mockMessage.content.text = 'a'.repeat(200); // Exceeds 100 char limit

      botManager.on('validationError', (message, validationResult) => {
        expect(validationResult.valid).toBe(false);
        expect(validationResult.errors[0]).toContain('Message too long');
        done();
      });

      // Should not emit messageReceived
      botManager.on('messageReceived', () => {
        done(new Error('Should not emit messageReceived for invalid message'));
      });

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(mockMessage);
    });

    it('should detect injection attacks and emit validationError', (done) => {
      mockMessage.content.text = "Hello'; DROP TABLE users; --";

      botManager.on('validationError', (message, validationResult) => {
        expect(validationResult.valid).toBe(false);
        expect(validationResult.errors).toContain('Potential injection attack detected');
        expect(validationResult.riskLevel).toBe('critical');
        done();
      });

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(mockMessage);
    });

    it('should emit warnings for profanity but still process message', (done) => {
      mockMessage.content.text = 'This is fucking bad';

      let warningEmitted = false;
      let messageReceived = false;

      botManager.on('validationWarning', (message, validationResult) => {
        expect(validationResult.warnings).toContain('Profanity detected');
        warningEmitted = true;
        checkComplete();
      });

      botManager.on('messageReceived', (context) => {
        expect(context.message.content.text).toBe('This is fucking bad');
        messageReceived = true;
        checkComplete();
      });

      function checkComplete() {
        if (warningEmitted && messageReceived) {
          done();
        }
      }

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(mockMessage);
    });

    it('should handle rate limiting and emit validationError', (done) => {
      let messageCount = 0;
      let errorEmitted = false;

      botManager.on('messageReceived', () => {
        messageCount++;
      });

      botManager.on('validationError', (message, validationResult) => {
        expect(validationResult.errors).toContain('Rate limit exceeded');
        errorEmitted = true;
        expect(messageCount).toBe(2); // First 2 messages should pass
        done();
      });

      // Send 3 messages rapidly (limit is 2 per minute)
      (botManager as any).handleIncomingMessage({ ...mockMessage, id: 'msg1' });
      (botManager as any).handleIncomingMessage({ ...mockMessage, id: 'msg2' });
      (botManager as any).handleIncomingMessage({ ...mockMessage, id: 'msg3' });
    });
  });

  describe('Webhook Validation Integration', () => {
    it('should validate webhook signatures correctly', () => {
      const payload = '{"test": "data"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // This should work with the bot manager's validateWebhookRequest method
      const isValid = botManager.validateWebhookRequest(payload, 'invalid-signature', timestamp);
      expect(isValid).toBe(false);
    });

    it('should provide rate limit status for users', () => {
      const status = botManager.getUserRateLimitStatus('user123');
      expect(status).toHaveProperty('messages');
      expect(status).toHaveProperty('files');
      expect(status).toHaveProperty('resetTime');
    });
  });

  describe('Configuration Updates', () => {
    it('should update validation configuration', () => {
      const newConfig = {
        validation: {
          enabled: false,
          contentFilter: {
            maxMessageLength: 200
          },
          webhook: {
            secretKey: 'new-secret'
          }
        }
      };

      botManager.updateConfig(newConfig);

      // Configuration should be updated
      const config = (botManager as any).config;
      expect(config.validation.enabled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', (done) => {
      // Create message with invalid structure
      const invalidMessage = {
        ...mockMessage,
        content: null as any
      };

      botManager.on('validationError', (message, validationResult) => {
        expect(validationResult.valid).toBe(false);
        expect(validationResult.riskLevel).toBe('critical');
        done();
      });

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(invalidMessage);
    });

    it('should continue processing when validation is disabled', (done) => {
      // Disable validation
      botManager.updateConfig({
        validation: { enabled: false }
      });

      // Send message that would normally fail validation
      mockMessage.content.text = 'a'.repeat(200);

      botManager.on('messageReceived', (context) => {
        expect(context.message.content.text.length).toBe(200);
        expect(context.metadata.validated).toBe(false);
        done();
      });

      // Simulate incoming message
      (botManager as any).handleIncomingMessage(mockMessage);
    });
  });
});
