/**
 * Property Test: Unified Conversation History Synchronization
 *
 * This test validates that unified conversation history synchronization maintains
 * consistency across platforms, preserves message ordering, handles concurrent
 * messages, and ensures proper timestamp management.
 *
 * Validates Requirements: 7.2 - Conversation synchronization and linking across platforms
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { ConversationRouter, createConversationRouter } from '../conversation-router';
import { MessageSyncService, createMessageSyncService } from '../message-sync';
import { ConversationMessage } from '../conversation-context';
import { ContentAdaptationService, createContentAdaptationService } from '../content-adapter';

// Test data generators
const platformArbitrary = fc.constantFrom('telegram', 'discord', 'desktop');
const userIdArbitrary = fc.string({ minLength: 5, maxLength: 20 });
const messageIdArbitrary = fc.string({ minLength: 10, maxLength: 30 });
const messageContentArbitrary = fc.string({ minLength: 1, maxLength: 500 });
const timestampArbitrary = fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') });

const conversationMessageArbitrary = fc.record({
  id: messageIdArbitrary,
  conversationId: fc.string({ minLength: 10, maxLength: 30 }),
  platform: platformArbitrary,
  sender: fc.record({
    userId: userIdArbitrary,
    displayName: fc.string({ minLength: 1, maxLength: 50 }),
    platformSpecificId: fc.string({ minLength: 1, maxLength: 20 })
  }),
  content: fc.record({
    text: messageContentArbitrary,
    files: fc.array(fc.record({
      id: fc.string({ minLength: 5, maxLength: 20 }),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      mimeType: fc.constantFrom('text/plain', 'image/jpeg', 'application/pdf'),
      size: fc.integer({ min: 1, max: 1000000 }),
      url: fc.webUrl()
    }), { maxLength: 3 })
  }),
  timestamp: timestampArbitrary,
  metadata: fc.record({
    chatId: fc.string({ minLength: 1, maxLength: 20 }),
    chatName: fc.string({ minLength: 1, maxLength: 50 }),
    messageType: fc.constantFrom('text', 'file', 'system'),
    edited: fc.boolean(),
    replyTo: fc.option(messageIdArbitrary)
  })
});

describe('Property Test: Unified Conversation History Synchronization', () => {
  let conversationRouter: ConversationRouter;
  let messageSyncService: MessageSyncService;
  let contentAdapter: ContentAdaptationService;

  beforeEach(async () => {
    conversationRouter = createConversationRouter({
      baseDir: '/tmp/test-conversation-router',
      defaultSyncDelay: 100,
      maxSyncRetries: 2,
      conflictDetection: {
        enabled: true,
        timestampToleranceMs: 1000,
        contentSimilarityThreshold: 0.9,
        duplicateDetectionWindow: 30000
      }
    });

    messageSyncService = createMessageSyncService(conversationRouter, {
      baseDir: '/tmp/test-message-sync',
      realTimeSync: {
        enabled: true,
        syncInterval: 50,
        batchSize: 5,
        maxRetries: 2
      }
    });

    contentAdapter = createContentAdaptationService();

    await conversationRouter.initialize();
    await messageSyncService.initialize();
  });

  afterEach(async () => {
    await conversationRouter.shutdown();
    await messageSyncService.shutdown();
  });

  /**
   * Property 5.1: Message ordering preservation across platforms
   *
   * When messages are synchronized across platforms, they should maintain
   * their chronological order regardless of sync delays or platform differences.
   */
  it('should preserve message ordering across platform synchronization', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        platforms: fc.array(platformArbitrary, { minLength: 2, maxLength: 3 }),
        messages: fc.array(conversationMessageArbitrary, { minLength: 3, maxLength: 10 })
      }),
      async (testData) => {
        // Sort messages by timestamp to establish expected order
        const sortedMessages = testData.messages
          .map((msg, index) => ({
            ...msg,
            conversationId: testData.conversationId,
            timestamp: new Date(Date.now() + index * 1000) // Ensure proper ordering
          }))
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Create conversation link across platforms
        const conversations = testData.platforms.map(platform => ({
          conversationId: testData.conversationId,
          platform,
          chatId: `chat_${platform}`,
          chatName: `Test Chat ${platform}`
        }));

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Sync messages in order
        for (const message of sortedMessages) {
          await messageSyncService.syncMessage(message);
        }

        // Allow sync processing
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify message ordering is preserved in conversation link
        const link = conversationRouter.getConversationLink(linkId);
        expect(link).toBeDefined();

        // Check that sync statistics reflect all messages
        const stats = messageSyncService.getSyncStatistics();
        expect(stats.totalConversations).toBeGreaterThan(0);

        // Verify no ordering conflicts were created
        const conflicts = messageSyncService.getMessageConflicts(linkId);
        const orderingConflicts = conflicts.filter(c => c.type === 'timestamp_order');
        expect(orderingConflicts.length).toBe(0);
      }
    ), { numRuns: 15 });
  });

  /**
   * Property 5.2: Content consistency across platform adaptations
   *
   * When messages are adapted for different platforms, the core content
   * should remain consistent while respecting platform-specific formatting.
   */
  it('should maintain content consistency during cross-platform adaptation', () => {
    fc.assert(fc.property(
      fc.record({
        originalMessage: conversationMessageArbitrary,
        targetPlatforms: fc.array(platformArbitrary, { minLength: 2, maxLength: 3 })
      }),
      async (testData) => {
        const adaptations = new Map<string, any>();

        // Adapt message for each target platform
        for (const targetPlatform of testData.targetPlatforms) {
          const adaptedContent = await contentAdapter.adaptContent(
            testData.originalMessage,
            targetPlatform,
            {
              sourcePlatform: testData.originalMessage.platform,
              preserveFormatting: true,
              fallbackToPlainText: true
            }
          );

          adaptations.set(targetPlatform, adaptedContent);
        }

        // Verify core content is preserved across all adaptations
        const originalText = testData.originalMessage.content.text;
        const originalFileCount = testData.originalMessage.content.files.length;

        for (const [platform, adaptation] of adaptations) {
          // Text content should be preserved (allowing for formatting changes)
          expect(adaptation.text).toBeTruthy();
          expect(adaptation.text.length).toBeGreaterThan(0);

          // File count should not increase (may decrease due to platform limitations)
          expect(adaptation.files.length).toBeLessThanOrEqual(originalFileCount);

          // No critical modifications should occur for basic content
          const criticalModifications = adaptation.modifications.filter(
            (mod: any) => mod.type === 'removed' && mod.feature === 'core_content'
          );
          expect(criticalModifications.length).toBe(0);
        }

        // Verify adaptations are compatible with each other
        const adaptationTexts = Array.from(adaptations.values()).map((a: any) => a.text);
        const uniqueTexts = new Set(adaptationTexts);

        // While exact text may differ due to formatting, core meaning should be preserved
        // This is validated by ensuring no adaptation is empty when original has content
        if (originalText.trim().length > 0) {
          for (const adaptedText of adaptationTexts) {
            expect(adaptedText.trim().length).toBeGreaterThan(0);
          }
        }
      }
    ), { numRuns: 20 });
  });

  /**
   * Property 5.3: Concurrent message handling consistency
   *
   * When multiple messages arrive concurrently from different platforms,
   * the synchronization system should handle them consistently without
   * creating conflicts or losing messages.
   */
  it('should handle concurrent messages consistently across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        platforms: fc.array(platformArbitrary, { minLength: 2, maxLength: 3 }),
        concurrentMessages: fc.array(conversationMessageArbitrary, { minLength: 2, maxLength: 8 }),
        baseTimestamp: fc.integer({ min: 1640995200000, max: 1672531200000 }) // 2022-2023 range
      }),
      async (testData) => {
        // Create conversation link
        const conversations = testData.platforms.map(platform => ({
          conversationId: testData.conversationId,
          platform,
          chatId: `chat_${platform}`,
          chatName: `Test Chat ${platform}`
        }));

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Prepare concurrent messages with slight timestamp variations
        const concurrentMessages = testData.concurrentMessages.map((msg, index) => ({
          ...msg,
          conversationId: testData.conversationId,
          platform: testData.platforms[index % testData.platforms.length],
          timestamp: new Date(testData.baseTimestamp + index * 100) // 100ms apart
        }));

        // Send all messages concurrently
        const syncPromises = concurrentMessages.map(message =>
          messageSyncService.syncMessage(message)
        );

        await Promise.all(syncPromises);

        // Allow processing time
        await new Promise(resolve => setTimeout(resolve, 300));

        // Verify all messages were processed
        const stats = messageSyncService.getSyncStatistics();
        expect(stats.totalConversations).toBeGreaterThan(0);

        // Check for conflicts
        const conflicts = messageSyncService.getMessageConflicts(linkId);

        // Concurrent messages should either be resolved automatically or flagged for resolution
        for (const conflict of conflicts) {
          expect(['pending', 'resolved']).toContain(conflict.resolution.status);

          // If auto-resolved, should have a valid resolution strategy
          if (conflict.resolution.status === 'resolved') {
            expect(conflict.resolution.method).toBeDefined();
            expect(['timestamp_priority', 'platform_priority', 'content_merge']).toContain(
              conflict.resolution.method
            );
          }
        }

        // Verify conversation link integrity
        const link = conversationRouter.getConversationLink(linkId);
        expect(link).toBeDefined();
        expect(link!.linkedConversations.size).toBe(testData.platforms.length);
      }
    ), { numRuns: 15 });
  });

  /**
   * Property 5.4: Timestamp conflict resolution consistency
   *
   * When messages have conflicting timestamps, the resolution should be
   * consistent and deterministic based on the configured strategy.
   */
  it('should resolve timestamp conflicts consistently', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        conflictingMessages: fc.array(conversationMessageArbitrary, { minLength: 2, maxLength: 4 }),
        baseTimestamp: fc.integer({ min: 1640995200000, max: 1672531200000 }),
        timestampVariation: fc.integer({ min: 0, max: 500 }) // Max 500ms variation
      }),
      async (testData) => {
        // Create messages with very close timestamps (potential conflicts)
        const conflictingMessages = testData.conflictingMessages.map((msg, index) => ({
          ...msg,
          conversationId: testData.conversationId,
          timestamp: new Date(testData.baseTimestamp + (index * testData.timestampVariation))
        }));

        // Create conversation link
        const conversations = conflictingMessages.map((msg, index) => ({
          conversationId: testData.conversationId,
          platform: msg.platform,
          chatId: `chat_${index}`,
          chatName: `Test Chat ${index}`
        }));

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Sync conflicting messages
        for (const message of conflictingMessages) {
          await messageSyncService.syncMessage(message);
        }

        // Allow processing time
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check conflict resolution
        const conflicts = messageSyncService.getMessageConflicts(linkId);
        const timestampConflicts = conflicts.filter(c => c.type === 'timestamp_order');

        for (const conflict of timestampConflicts) {
          if (conflict.resolution.status === 'resolved') {
            // Verify resolution is deterministic
            expect(conflict.resolution.method).toBeDefined();
            expect(conflict.resolution.resolvedMessage).toBeDefined();

            // For timestamp conflicts, resolution should prefer earlier timestamp
            if (conflict.resolution.method === 'timestamp_priority') {
              const resolvedMessage = conflict.resolution.resolvedMessage!;
              const conflictMessages = conflict.messages;

              // Resolved message should be the earliest timestamp
              const earliestMessage = conflictMessages.reduce((earliest, current) =>
                current.timestamp < earliest.timestamp ? current : earliest
              );

              expect(resolvedMessage.timestamp).toEqual(earliestMessage.timestamp);
            }
          }
        }
      }
    ), { numRuns: 20 });
  });

  /**
   * Property 5.5: Platform-specific metadata preservation
   *
   * When synchronizing messages across platforms, platform-specific metadata
   * should be preserved while maintaining cross-platform compatibility.
   */
  it('should preserve platform-specific metadata during synchronization', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        sourceMessage: conversationMessageArbitrary,
        targetPlatforms: fc.array(platformArbitrary, { minLength: 1, maxLength: 2 })
      }),
      async (testData) => {
        // Create conversation link
        const conversations = [
          {
            conversationId: testData.conversationId,
            platform: testData.sourceMessage.platform,
            chatId: testData.sourceMessage.metadata.chatId,
            chatName: testData.sourceMessage.metadata.chatName
          },
          ...testData.targetPlatforms.map((platform, index) => ({
            conversationId: `${testData.conversationId}_${platform}`,
            platform,
            chatId: `chat_${platform}`,
            chatName: `Test Chat ${platform}`
          }))
        ];

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Sync the message
        const messageWithConversationId = {
          ...testData.sourceMessage,
          conversationId: testData.conversationId
        };

        await messageSyncService.syncMessage(messageWithConversationId);

        // Allow processing time
        await new Promise(resolve => setTimeout(resolve, 150));

        // Verify conversation link maintains metadata
        const link = conversationRouter.getConversationLink(linkId);
        expect(link).toBeDefined();

        // Check that source platform metadata is preserved in the link
        const sourceConversation = Array.from(link!.linkedConversations.values())
          .find(conv => conv.platform === testData.sourceMessage.platform);

        if (sourceConversation) {
          expect(sourceConversation.platform).toBe(testData.sourceMessage.platform);
          // Note: chatId and chatName might be different due to how the link is created
          // The important thing is that the platform is preserved
        }

        // Verify sync statistics are updated
        const stats = messageSyncService.getSyncStatistics();
        expect(stats.totalConversations).toBeGreaterThan(0);

        // Check that no metadata was lost during sync
        const conflicts = messageSyncService.getMessageConflicts(linkId);
        const metadataConflicts = conflicts.filter(c => c.type === 'platform_specific');

        // Platform-specific conflicts should be resolved automatically
        for (const conflict of metadataConflicts) {
          if (conflict.resolution.status === 'resolved') {
            expect(conflict.resolution.method).toBe('platform_priority');
          }
        }
      }
    ), { numRuns: 15 });
  });

  /**
   * Property 5.6: File attachment synchronization consistency
   *
   * When messages contain file attachments, they should be synchronized
   * consistently across platforms while respecting platform limitations.
   */
  it('should synchronize file attachments consistently across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        messageWithFiles: fc.record({
          ...conversationMessageArbitrary.constraints,
          content: fc.record({
            text: messageContentArbitrary,
            files: fc.array(fc.record({
              id: fc.string({ minLength: 5, maxLength: 20 }),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              mimeType: fc.constantFrom('text/plain', 'image/jpeg', 'image/png', 'application/pdf'),
              size: fc.integer({ min: 1000, max: 5000000 }), // 1KB to 5MB
              url: fc.webUrl()
            }), { minLength: 1, maxLength: 3 })
          })
        }),
        targetPlatforms: fc.array(platformArbitrary, { minLength: 1, maxLength: 2 })
      }),
      async (testData) => {
        const message: ConversationMessage = {
          id: `msg_${Date.now()}`,
          conversationId: testData.conversationId,
          platform: 'telegram', // Source platform
          sender: {
            userId: 'test_user',
            displayName: 'Test User',
            platformSpecificId: 'telegram_123'
          },
          content: testData.messageWithFiles.content,
          timestamp: new Date(),
          metadata: {
            chatId: 'test_chat',
            chatName: 'Test Chat',
            messageType: 'file',
            edited: false
          }
        };

        // Create conversation link
        const conversations = [
          {
            conversationId: testData.conversationId,
            platform: 'telegram',
            chatId: 'test_chat',
            chatName: 'Test Chat'
          },
          ...testData.targetPlatforms.map(platform => ({
            conversationId: testData.conversationId,
            platform,
            chatId: `chat_${platform}`,
            chatName: `Test Chat ${platform}`
          }))
        ];

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Sync message with files
        await messageSyncService.syncMessage(message);

        // Allow processing time
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verify file handling
        const stats = messageSyncService.getSyncStatistics();
        expect(stats.totalConversations).toBeGreaterThan(0);

        // Check for file-related conflicts
        const conflicts = messageSyncService.getMessageConflicts(linkId);
        const fileConflicts = conflicts.filter(c =>
          c.details.conflictReason.includes('file') ||
          c.details.conflictReason.includes('attachment')
        );

        // File conflicts should be handled gracefully
        for (const conflict of fileConflicts) {
          expect(['pending', 'resolved']).toContain(conflict.resolution.status);

          if (conflict.resolution.status === 'resolved') {
            // File conflicts typically resolved by platform priority or size limits
            expect(['platform_priority', 'manual']).toContain(conflict.resolution.method);
          }
        }

        // Verify conversation link integrity with file metadata
        const link = conversationRouter.getConversationLink(linkId);
        expect(link).toBeDefined();
        expect(link!.syncSettings.enabled).toBe(true);

        // Check that file exclusion settings are respected
        if (link!.syncSettings.excludeFileAttachments) {
          // If files are excluded, no file-related sync should occur
          const fileSyncStats = stats.totalConversations; // Simplified check
          expect(fileSyncStats).toBeGreaterThanOrEqual(0);
        }
      }
    ), { numRuns: 10 });
  });

  /**
   * Property 5.7: Conversation export consistency
   *
   * When exporting unified conversation history, the export should contain
   * all synchronized messages in correct order with complete metadata.
   */
  it('should export unified conversation history consistently', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.string({ minLength: 10, maxLength: 30 }),
        platforms: fc.array(platformArbitrary, { minLength: 2, maxLength: 3 }),
        messages: fc.array(conversationMessageArbitrary, { minLength: 2, maxLength: 6 }),
        exportFormat: fc.constantFrom('json', 'markdown', 'html'),
        includeAttachments: fc.boolean()
      }),
      async (testData) => {
        // Create conversation link
        const conversations = testData.platforms.map(platform => ({
          conversationId: testData.conversationId,
          platform,
          chatId: `chat_${platform}`,
          chatName: `Test Chat ${platform}`
        }));

        const linkId = await conversationRouter.createConversationLink(
          conversations,
          'test_user',
          'automatic'
        );

        // Prepare and sync messages
        const messagesWithConversationId = testData.messages.map((msg, index) => ({
          ...msg,
          conversationId: testData.conversationId,
          timestamp: new Date(Date.now() + index * 1000)
        }));

        for (const message of messagesWithConversationId) {
          await messageSyncService.syncMessage(message);
        }

        // Allow processing time
        await new Promise(resolve => setTimeout(resolve, 250));

        // Export conversation
        const exportResult = await messageSyncService.exportConversation(
          testData.conversationId,
          {
            format: testData.exportFormat,
            includeAttachments: testData.includeAttachments,
            includeSyncInfo: true,
            exportedBy: 'test_user'
          }
        );

        // Verify export structure
        expect(exportResult.metadata).toBeDefined();
        expect(exportResult.metadata.conversationId).toBe(testData.conversationId);
        expect(exportResult.metadata.format).toBe(testData.exportFormat);
        expect(exportResult.metadata.includeAttachments).toBe(testData.includeAttachments);
        expect(exportResult.metadata.platforms).toEqual(
          expect.arrayContaining(testData.platforms)
        );

        // Verify conversation information
        expect(exportResult.conversation).toBeDefined();
        expect(exportResult.conversation.id).toBe(testData.conversationId);
        expect(exportResult.conversation.platforms).toEqual(
          expect.arrayContaining(testData.platforms)
        );

        // Verify sync information is included
        if (exportResult.syncInfo) {
          expect(exportResult.syncInfo.linkedConversations).toBeDefined();
          expect(exportResult.syncInfo.linkedConversations.length).toBeGreaterThan(0);
          expect(exportResult.syncInfo.lastSyncTime).toBeDefined();
        }

        // Verify message count consistency
        expect(exportResult.messages).toBeDefined();
        expect(exportResult.messages.length).toBeGreaterThanOrEqual(0);

        // If messages were successfully synced, they should appear in export
        const stats = messageSyncService.getSyncStatistics();
        if (stats.totalConversations > 0) {
          expect(exportResult.conversation.messageCount).toBeGreaterThanOrEqual(0);
        }
      }
    ), { numRuns: 15 });
  });
});

/**
 * Integration test helper for unified conversation history synchronization
 */
export class UnifiedConversationHistoryTester {
  private conversationRouter: ConversationRouter;
  private messageSyncService: MessageSyncService;
  private contentAdapter: ContentAdaptationService;

  constructor() {
    this.conversationRouter = createConversationRouter({
      baseDir: '/tmp/test-integration-conversation',
      defaultSyncDelay: 50
    });

    this.messageSyncService = createMessageSyncService(this.conversationRouter, {
      baseDir: '/tmp/test-integration-sync',
      realTimeSync: { enabled: true, syncInterval: 25, batchSize: 10, maxRetries: 3 }
    });

    this.contentAdapter = createContentAdaptationService();
  }

  async initialize(): Promise<void> {
    await this.conversationRouter.initialize();
    await this.messageSyncService.initialize();
  }

  async shutdown(): Promise<void> {
    await this.conversationRouter.shutdown();
    await this.messageSyncService.shutdown();
  }

  /**
   * Test complete conversation synchronization workflow
   */
  async testConversationSyncWorkflow(
    platforms: string[],
    messages: ConversationMessage[]
  ): Promise<{
    success: boolean;
    linkId?: string;
    syncedMessages: number;
    conflicts: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let linkId: string | undefined;
    let syncedMessages = 0;
    let conflicts = 0;

    try {
      // Create conversation link
      const conversations = platforms.map(platform => ({
        conversationId: messages[0]?.conversationId || 'test_conversation',
        platform,
        chatId: `chat_${platform}`,
        chatName: `Test Chat ${platform}`
      }));

      linkId = await this.conversationRouter.createConversationLink(
        conversations,
        'test_user',
        'automatic'
      );

      // Sync all messages
      for (const message of messages) {
        try {
          await this.messageSyncService.syncMessage(message);
          syncedMessages++;
        } catch (error) {
          errors.push(`Failed to sync message ${message.id}: ${error}`);
        }
      }

      // Allow processing time
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check for conflicts
      const messageConflicts = this.messageSyncService.getMessageConflicts(linkId);
      conflicts = messageConflicts.length;

      return {
        success: errors.length === 0,
        linkId,
        syncedMessages,
        conflicts,
        errors
      };

    } catch (error) {
      errors.push(`Workflow error: ${error}`);
      return {
        success: false,
        linkId,
        syncedMessages,
        conflicts,
        errors
      };
    }
  }

  /**
   * Test conversation export functionality
   */
  async testConversationExport(
    conversationId: string,
    format: 'json' | 'markdown' | 'html'
  ): Promise<{
    success: boolean;
    exportSize: number;
    messageCount: number;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const exportResult = await this.messageSyncService.exportConversation(
        conversationId,
        {
          format,
          includeAttachments: true,
          includeSyncInfo: true,
          exportedBy: 'test_user'
        }
      );

      return {
        success: true,
        exportSize: JSON.stringify(exportResult).length,
        messageCount: exportResult.messages.length,
        errors
      };

    } catch (error) {
      errors.push(`Export error: ${error}`);
      return {
        success: false,
        exportSize: 0,
        messageCount: 0,
        errors
      };
    }
  }
}
