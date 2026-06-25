/**
 * Integration Tests for Bot Manager
 *
 * These tests validate the complete integration of the BotIntegrationManager
 * with platforms, file handling, and conversation context management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { BotIntegrationManager, BotIntegrationConfig } from '../bot-manager';
import { FileManager } from '../file-manager';
import { ConversationContextManager } from '../conversation-context';
import { MessagePlatform, IncomingMessage, PlatformFile, SendOptions, PlatformStatus } from '../platform-interface';

// Mock platform implementation for testing
class MockPlatform extends MessagePlatform {
  private messages: Array<{ text: string; options: SendOptions }> = [];
  private shouldFail = false;
  private connectionStatus = true;

  constructor(name: string) {
    super(name, { enabled: true, config: {} });
  }

  async initialize(): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Mock initialization failure');
    }
  }

  async disconnect(): Promise<void> {
    this.connectionStatus = false;
  }

  async sendMessage(text: string, options: SendOptions): Promise<string> {
    if (this.shouldFail) {
      throw new Error('Mock send failure');
    }

    this.messages.push({ text, options });
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async sendTyping(chatId: string): Promise<void> {
    // Mock typing
  }

  async getStatus(): Promise<PlatformStatus> {
    return {
      connected: this.connectionStatus && !this.shouldFail,
      lastConnected: this.connectionStatus ? new Date() : undefined,
      error: this.shouldFail ? 'Mock error' : undefined
    };
  }

  async testConnection(): Promise<boolean> {
    return this.connectionStatus && !this.shouldFail;
  }

  async downloadFile(file: PlatformFile, localPath: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Mock download failure');
    }
    // Mock file download
  }

  async getUserInfo(userId: string) {
    return {
      id: userId,
      name: `Mock User ${userId}`,
      isBot: false
    };
  }

  protected formatText(text: string): string {
    return text;
  }

  protected isBotMentioned(message: any): boolean {
    return message.content?.text?.includes('@bot') || false;
  }

  // Test helpers
  simulateIncomingMessage(message: Partial<IncomingMessage>): void {
    const fullMessage: IncomingMessage = {
      id: message.id || `msg_${Date.now()}`,
      platform: this.getPlatformName(),
      user: message.user || { id: 'user1', name: 'Test User' },
      chat: message.chat || { id: 'chat1', name: 'Test Chat', type: 'private' },
      content: {
        text: message.content?.text || 'Test message',
        files: message.content?.files || [],
        isMention: message.content?.isMention || false,
        ...message.content
      },
      timestamp: message.timestamp || new Date(),
      raw: message.raw || {}
    };

    this.emitMessage(fullMessage);
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  getSentMessages(): Array<{ text: string; options: SendOptions }> {
    return [...this.messages];
  }

  clearSentMessages(): void {
    this.messages.length = 0;
  }
}

describe('BotIntegrationManager Integration Tests', () => {
  let botManager: BotIntegrationManager;
  let fileManager: FileManager;
  let contextManager: ConversationContextManager;
  let mockTelegram: MockPlatform;
  let mockDiscord: MockPlatform;

  const testConfig: BotIntegrationConfig = {
    enabled: true,
    platforms: {},
    settings: {
      maxMessageLength: 4000,
      formatToolOutputs: true,
      streamingChunkSize: 500,
      responseTimeout: 5000,
      enableCrossSync: true
    }
  };

  beforeEach(async () => {
    // Clean up directories to ensure test isolation
    try {
      fs.rmSync('/tmp/test-attachments', { recursive: true, force: true });
      fs.rmSync('/tmp/test-conversations', { recursive: true, force: true });
    } catch (e) {
      // ignore
    }

    // Create managers
    botManager = new BotIntegrationManager(testConfig);
    fileManager = new FileManager({
      baseDir: '/tmp/test-attachments',
      maxFileSize: 10 * 1024 * 1024,
      retentionDays: 1
    });
    contextManager = new ConversationContextManager({
      baseDir: '/tmp/test-conversations',
      maxContextMessages: 10,
      saveInterval: 1000
    });

    // Create mock platforms
    mockTelegram = new MockPlatform('telegram');
    mockDiscord = new MockPlatform('discord');

    // Initialize managers
    await botManager.initialize();
    await fileManager.initialize();
    await contextManager.initialize();

    // Register platforms
    botManager.registerPlatform('telegram', mockTelegram);
    botManager.registerPlatform('discord', mockDiscord);
    fileManager.registerPlatform('telegram', mockTelegram);
    fileManager.registerPlatform('discord', mockDiscord);
    contextManager.registerPlatform('telegram', mockTelegram);
    contextManager.registerPlatform('discord', mockDiscord);

    // Connect bot manager to context manager
    botManager.on('messageReceived', async (context) => {
      await contextManager.processMessage(context.message);
    });
  });

  afterEach(async () => {
    await botManager.shutdown();
    await fileManager.initialize(); // Clean up files
    await contextManager.shutdown();
  });

  describe('Platform Integration', () => {
    it('should register and manage multiple platforms', async () => {
      const platforms = botManager.getPlatforms();
      expect(platforms.size).toBe(2);
      expect(platforms.has('telegram')).toBe(true);
      expect(platforms.has('discord')).toBe(true);

      const telegramPlatform = botManager.getPlatform('telegram');
      expect(telegramPlatform).toBeDefined();
      expect(telegramPlatform?.getPlatformName()).toBe('telegram');
    });

    it('should get platform statuses', async () => {
      const statuses = await botManager.getPlatformStatuses();
      expect(statuses.size).toBe(2);

      const telegramStatus = statuses.get('telegram');
      expect(telegramStatus?.connected).toBe(true);

      const discordStatus = statuses.get('discord');
      expect(discordStatus?.connected).toBe(true);
    });

    it('should handle platform failures gracefully', async () => {
      mockTelegram.setShouldFail(true);

      const statuses = await botManager.getPlatformStatuses();
      const telegramStatus = statuses.get('telegram');

      expect(telegramStatus?.connected).toBe(false);
      expect(telegramStatus?.error).toContain('Mock error');
    });

    it('should unregister platforms', async () => {
      await botManager.unregisterPlatform('telegram');

      const platforms = botManager.getPlatforms();
      expect(platforms.size).toBe(1);
      expect(platforms.has('telegram')).toBe(false);
      expect(platforms.has('discord')).toBe(true);
    });
  });

  describe('Message Routing and Processing', () => {
    it('should route incoming messages to context manager', async () => {
      const messageReceived = vi.fn();
      botManager.on('messageReceived', messageReceived);

      // Simulate incoming message
      mockTelegram.simulateIncomingMessage({
        id: 'test_msg_1',
        user: { id: 'user1', name: 'Test User' },
        content: { text: 'Hello bot!', files: [], isMention: true }
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messageReceived).toHaveBeenCalledOnce();
      const [context] = messageReceived.mock.calls[0];
      expect(context.message.content.text).toBe('Hello bot!');
      expect(context.conversationId).toBe('telegram:chat1');
    });

    it('should send messages to multiple platforms', async () => {
      const results = await botManager.sendMessage(
        'Test response',
        ['telegram', 'discord'],
        { chatId: 'chat1' }
      );

      expect(results.size).toBe(2);
      expect(results.get('telegram')).toMatch(/^msg_/);
      expect(results.get('discord')).toMatch(/^msg_/);

      const telegramMessages = mockTelegram.getSentMessages();
      const discordMessages = mockDiscord.getSentMessages();

      expect(telegramMessages).toHaveLength(1);
      expect(discordMessages).toHaveLength(1);
      expect(telegramMessages[0].text).toBe('Test response');
      expect(discordMessages[0].text).toBe('Test response');
    });

    it('should handle partial platform failures during message sending', async () => {
      mockTelegram.setShouldFail(true);

      const results = await botManager.sendMessage(
        'Test message',
        ['telegram', 'discord'],
        { chatId: 'chat1' }
      );

      expect(results.size).toBe(2);
      expect(results.get('telegram')).toBeInstanceOf(Error);
      expect(results.get('discord')).toMatch(/^msg_/);

      const discordMessages = mockDiscord.getSentMessages();
      expect(discordMessages).toHaveLength(1);
    });
  });

  describe('Response Streaming', () => {
    it('should start and manage response streams', async () => {
      const streamIds = await botManager.startResponseStream(
        ['telegram', 'discord'],
        'chat1',
        'Initial message'
      );

      expect(streamIds.size).toBe(2);
      expect(streamIds.has('telegram')).toBe(true);
      expect(streamIds.has('discord')).toBe(true);

      const activeStreams = botManager.getActiveStreams();
      expect(activeStreams.size).toBe(2);

      // Verify initial messages were sent
      const telegramMessages = mockTelegram.getSentMessages();
      const discordMessages = mockDiscord.getSentMessages();

      expect(telegramMessages).toHaveLength(1);
      expect(discordMessages).toHaveLength(1);
      expect(telegramMessages[0].text).toBe('Initial message');
      expect(discordMessages[0].text).toBe('Initial message');
    });

    it('should update response streams', async () => {
      const streamIds = await botManager.startResponseStream(
        ['telegram'],
        'chat1',
        'Initial'
      );

      const telegramStreamId = streamIds.get('telegram')!;

      // Update stream
      await botManager.updateResponseStream(telegramStreamId, 'Initial updated text');

      const activeStreams = botManager.getActiveStreams();
      const stream = activeStreams.get(telegramStreamId);

      expect(stream?.text).toBe('Initial updated text');
      expect(stream?.complete).toBe(false);
    });

    it('should complete response streams', async () => {
      const streamIds = await botManager.startResponseStream(['telegram'], 'chat1');
      const telegramStreamId = streamIds.get('telegram')!;

      await botManager.completeResponseStream(telegramStreamId, 'Final message');

      const activeStreams = botManager.getActiveStreams();
      const stream = activeStreams.get(telegramStreamId);

      expect(stream?.text).toBe('Final message');
      expect(stream?.complete).toBe(true);
    });
  });

  describe('Tool Output Formatting', () => {
    it('should format tool outputs for different platforms', () => {
      const toolOutput = { result: 'success', data: [1, 2, 3] };

      const telegramFormat = botManager.formatToolOutput('test_tool', toolOutput, {
        platform: 'telegram',
        useMarkdown: true,
        maxLength: 1000,
        includeMetadata: true
      });

      const discordFormat = botManager.formatToolOutput('test_tool', toolOutput, {
        platform: 'discord',
        useMarkdown: false,
        maxLength: 500,
        includeMetadata: false
      });

      expect(telegramFormat).toContain('**🔧 test_tool**');
      expect(telegramFormat).toContain('```json');
      expect(discordFormat).not.toContain('**🔧 test_tool**');
      expect(discordFormat).not.toContain('```json');
    });

    it('should truncate long tool outputs', () => {
      const longOutput = 'x'.repeat(2000);

      const formatted = botManager.formatToolOutput('test_tool', longOutput, {
        platform: 'telegram',
        useMarkdown: false,
        maxLength: 100,
        includeMetadata: false
      });

      expect(formatted.length).toBeLessThanOrEqual(100);
      expect(formatted.endsWith('...')).toBe(true);
    });
  });

  describe('File Handling Integration', () => {
    it('should process messages with file attachments', async () => {
      const testFile: PlatformFile = {
        id: 'file_123',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 1024,
        url: 'https://example.com/file_123'
      };

      mockTelegram.simulateIncomingMessage({
        id: 'msg_with_file',
        content: {
          text: 'Here is a file',
          files: [testFile],
          isMention: false
        }
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify message was processed with file
      const conversation = contextManager.getConversation('telegram_chat1');
      expect(conversation).toBeDefined();

      const messages = contextManager.getConversationContext('telegram_chat1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content.files).toHaveLength(1);
      expect(messages[0].content.files[0].name).toBe('test.txt');
    });
  });

  describe('Cross-Platform Synchronization', () => {
    it('should sync conversations across platforms when enabled', async () => {
      // Create conversation first by processing an initial message
      mockTelegram.simulateIncomingMessage({
        id: 'initial_sync_msg',
        content: { text: 'Initial message', files: [], isMention: false }
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Enable cross-platform sync
      contextManager.updateSyncSettings('telegram_chat1', {
        enabled: true,
        syncPlatforms: ['discord']
      });

      const messageSynced = vi.fn();
      contextManager.on('messageSynced', messageSynced);

      // Send message from Telegram
      mockTelegram.simulateIncomingMessage({
        id: 'sync_test_msg',
        content: { text: 'Sync test message', files: [], isMention: false }
      });

      // Wait for sync processing
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify sync event was emitted
      expect(messageSynced).toHaveBeenCalled();
    });
  });

  describe('Stop Command Handling', () => {
    it('should handle stop commands and propagate across platforms', async () => {
      // Create conversation first
      mockTelegram.simulateIncomingMessage({
        id: 'initial_msg',
        content: { text: 'Start conversation', files: [], isMention: false }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const stopCommandReceived = vi.fn();
      contextManager.on('stopCommandReceived', stopCommandReceived);

      // Issue stop command
      const stopCommand = await contextManager.handleStopCommand(
        'telegram_chat1',
        'user1',
        'telegram'
      );

      expect(stopCommand).toBeDefined();
      expect(stopCommand.conversationId).toBe('telegram_chat1');
      expect(stopCommand.platform).toBe('telegram');
      expect(stopCommandReceived).toHaveBeenCalledWith(stopCommand);

      // Verify conversation is marked as stopped
      const conversation = contextManager.getConversation('telegram_chat1');
      expect(conversation?.stopRequested).toBe(true);
      expect(conversation?.status).toBe('stopped');
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle platform initialization failures', async () => {
      const failingPlatform = new MockPlatform('failing');
      failingPlatform.setShouldFail(true);

      // Should not throw when registering a failing platform
      expect(() => {
        botManager.registerPlatform('failing', failingPlatform);
      }).not.toThrow();

      const status = await failingPlatform.getStatus();
      expect(status.connected).toBe(false);
    });

    it('should continue operating when one platform fails', async () => {
      mockTelegram.setShouldFail(true);

      // Discord should still work
      const results = await botManager.sendMessage(
        'Test message',
        ['telegram', 'discord'],
        { chatId: 'chat1' }
      );

      expect(results.get('telegram')).toBeInstanceOf(Error);
      expect(results.get('discord')).toMatch(/^msg_/);

      const discordMessages = mockDiscord.getSentMessages();
      expect(discordMessages).toHaveLength(1);
    });

    it('should handle message processing errors gracefully', async () => {
      const messageError = vi.fn();
      botManager.on('messageError', messageError);

      // Simulate a malformed message that might cause processing errors
      try {
        mockTelegram.simulateIncomingMessage({
          id: null as any, // Invalid ID
          user: null as any, // Invalid user
          content: { text: 'Bad message', files: [], isMention: false }
        });
      } catch (error) {
        // Expected to handle gracefully
      }

      // Wait for error handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not crash the system
      const platforms = botManager.getPlatforms();
      expect(platforms.size).toBe(2);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration dynamically', () => {
      const configUpdated = vi.fn();
      botManager.on('configUpdated', configUpdated);

      const newConfig = {
        settings: {
          ...testConfig.settings,
          maxMessageLength: 2000,
          enableCrossSync: false
        }
      };

      botManager.updateConfig(newConfig);

      expect(configUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            maxMessageLength: 2000,
            enableCrossSync: false
          })
        })
      );
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent messages', async () => {
      const messagePromises: Promise<void>[] = [];

      // Send 10 concurrent messages
      for (let i = 0; i < 10; i++) {
        const promise = new Promise<void>((resolve) => {
          mockTelegram.simulateIncomingMessage({
            id: `concurrent_msg_${i}`,
            content: { text: `Message ${i}`, files: [], isMention: false }
          });
          setTimeout(resolve, 10);
        });
        messagePromises.push(promise);
      }

      await Promise.all(messagePromises);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify all messages were processed
      const conversation = contextManager.getConversation('telegram_chat1');
      expect(conversation).toBeDefined();

      const messages = contextManager.getConversationContext('telegram_chat1');
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should handle rapid response streaming updates', async () => {
      const streamIds = await botManager.startResponseStream(['telegram'], 'chat1');
      const streamId = streamIds.get('telegram')!;

      // Rapid updates
      const updatePromises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        updatePromises.push(
          botManager.updateResponseStream(streamId, `Update ${i}`)
        );
      }

      await Promise.all(updatePromises);

      const activeStreams = botManager.getActiveStreams();
      const stream = activeStreams.get(streamId);

      expect(stream?.text).toContain('Update');
      expect(stream?.complete).toBe(false);
    });
  });
});

/**
 * End-to-end integration test scenarios
 */
describe('End-to-End Integration Scenarios', () => {
  let botManager: BotIntegrationManager;
  let fileManager: FileManager;
  let contextManager: ConversationContextManager;
  let mockTelegram: MockPlatform;
  let mockDiscord: MockPlatform;

  beforeEach(async () => {
    // Clean up directories to ensure test isolation
    try {
      fs.rmSync('/tmp/test-attachments', { recursive: true, force: true });
      fs.rmSync('/tmp/test-conversations', { recursive: true, force: true });
    } catch (e) {
      // ignore
    }

    // Set up complete integration environment
    botManager = new BotIntegrationManager({
      enabled: true,
      platforms: {},
      settings: {
        maxMessageLength: 4000,
        formatToolOutputs: true,
        streamingChunkSize: 500,
        responseTimeout: 5000,
        enableCrossSync: true
      }
    });

    fileManager = new FileManager({
      baseDir: '/tmp/test-attachments',
      maxFileSize: 10 * 1024 * 1024,
      retentionDays: 1
    });
    contextManager = new ConversationContextManager({
      baseDir: '/tmp/test-conversations',
      maxContextMessages: 10,
      saveInterval: 1000
    });
    mockTelegram = new MockPlatform('telegram');
    mockDiscord = new MockPlatform('discord');

    await Promise.all([
      botManager.initialize(),
      fileManager.initialize(),
      contextManager.initialize()
    ]);

    // Wire up all integrations
    botManager.registerPlatform('telegram', mockTelegram);
    botManager.registerPlatform('discord', mockDiscord);
    fileManager.registerPlatform('telegram', mockTelegram);
    fileManager.registerPlatform('discord', mockDiscord);
    contextManager.registerPlatform('telegram', mockTelegram);
    contextManager.registerPlatform('discord', mockDiscord);

    // Connect bot manager to context manager
    botManager.on('messageReceived', async (context) => {
      await contextManager.processMessage(context.message);
    });
  });

  afterEach(async () => {
    await Promise.all([
      botManager.shutdown(),
      contextManager.shutdown()
    ]);
  });

  it('should handle complete conversation flow with file sharing', async () => {
    // 1. User sends initial message with file
    const testFile: PlatformFile = {
      id: 'file_e2e',
      name: 'document.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      url: 'https://example.com/document.pdf'
    };

    mockTelegram.simulateIncomingMessage({
      id: 'e2e_msg_1',
      user: { id: 'user_e2e', name: 'E2E User' },
      content: {
        text: 'Please analyze this document',
        files: [testFile],
        isMention: true
      }
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // 2. Verify conversation was created and message processed
    const conversation = contextManager.getConversation('telegram_chat1');
    expect(conversation).toBeDefined();
    expect(conversation!.participants.size).toBe(1);
    expect(conversation!.platforms.has('telegram')).toBe(true);

    const messages = contextManager.getConversationContext('telegram_chat1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content.files).toHaveLength(1);

    // 3. Bot responds with streaming
    const streamIds = await botManager.startResponseStream(
      ['telegram'],
      'chat1',
      'Analyzing document...'
    );

    expect(streamIds.has('telegram')).toBe(true);

    // 4. Update stream with analysis progress
    const streamId = streamIds.get('telegram')!;
    await botManager.updateResponseStream(streamId, 'Analyzing document... 50% complete');
    await botManager.updateResponseStream(streamId, 'Analyzing document... Analysis complete!');
    await botManager.completeResponseStream(streamId, 'Document analysis finished. The document contains...');

    // 5. Verify final state
    const finalMessages = mockTelegram.getSentMessages();
    expect(finalMessages.length).toBeGreaterThan(0);
    expect(finalMessages[0].text).toBe('Analyzing document...');

    const activeStreams = botManager.getActiveStreams();
    const stream = activeStreams.get(streamId);
    expect(stream?.complete).toBe(true);
    expect(stream?.text).toContain('Document analysis finished');
  });

  it('should handle cross-platform conversation synchronization', async () => {
    // 1. Enable cross-platform sync
    contextManager.updateSyncSettings('telegram_chat1', {
      enabled: true,
      syncPlatforms: ['discord']
    });

    // 2. User sends message on Telegram
    mockTelegram.simulateIncomingMessage({
      id: 'sync_msg_1',
      user: { id: 'sync_user', name: 'Sync User' },
      content: { text: 'Start cross-platform conversation', files: [], isMention: false }
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // 3. Bot responds to both platforms
    await botManager.sendMessage(
      'Response synced across platforms',
      ['telegram', 'discord'],
      { chatId: 'chat1' }
    );

    // 4. Verify messages sent to both platforms
    const telegramMessages = mockTelegram.getSentMessages();
    const discordMessages = mockDiscord.getSentMessages();

    expect(telegramMessages).toHaveLength(1);
    expect(discordMessages).toHaveLength(1);
    expect(telegramMessages[0].text).toBe('Response synced across platforms');
    expect(discordMessages[0].text).toBe('Response synced across platforms');

    // 5. Verify conversation context is maintained
    const conversation = contextManager.getConversation('telegram_chat1');
    expect(conversation?.platforms.has('telegram')).toBe(true);
    expect(conversation?.syncSettings.enabled).toBe(true);
  });

  it('should handle stop command propagation across platforms', async () => {
    // 1. Start conversation
    mockTelegram.simulateIncomingMessage({
      id: 'stop_test_msg',
      user: { id: 'stop_user', name: 'Stop User' },
      content: { text: 'Start conversation', files: [], isMention: false }
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // 2. Enable cross-platform sync
    contextManager.updateSyncSettings('telegram_chat1', {
      enabled: true,
      syncPlatforms: ['discord']
    });

    // 3. Issue stop command
    const stopCommand = await contextManager.handleStopCommand(
      'telegram_chat1',
      'stop_user',
      'telegram'
    );

    // 4. Verify stop command was processed
    expect(stopCommand.conversationId).toBe('telegram_chat1');
    expect(stopCommand.platform).toBe('telegram');

    // 5. Verify conversation is stopped
    const conversation = contextManager.getConversation('telegram_chat1');
    expect(conversation?.stopRequested).toBe(true);
    expect(conversation?.status).toBe('stopped');

    // 6. Verify system message was added
    const messages = contextManager.getConversationContext('telegram_chat1');
    const systemMessages = messages.filter(m => m.isSystem);
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0].content.text).toContain('Stop command issued');
  });
});
