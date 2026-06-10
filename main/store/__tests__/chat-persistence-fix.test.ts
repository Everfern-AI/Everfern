/**
 * Test: Chat Message Persistence on Restart
 *
 * Verifies that all messages are preserved when restarting the app.
 * The fix ensures that partial saves (with isFullSave: false) do NOT
 * delete previous messages from the database.
 *
 * Bug: Previous behavior would delete all messages not in the current save
 * Fix: Only delete messages if isFullSave is explicitly NOT false
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatHistoryStore } from '../history';
import { databaseService } from '../database-service';

describe('Chat Message Persistence on Restart', () => {
  let historyStore: ChatHistoryStore;
  const testConvId = `test-conv-${Date.now()}`;

  beforeEach(async () => {
    historyStore = new ChatHistoryStore();
    await historyStore.init();
  });

  afterEach(async () => {
    // Cleanup
    try {
      await databaseService.run('DELETE FROM messages WHERE conversation_id = ?', [testConvId]);
      await databaseService.run('DELETE FROM conversations WHERE id = ?', [testConvId]);
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  /**
   * Test 1: Partial saves should NOT delete previous messages
   *
   * Scenario:
   * 1. Save conversation with 2 messages (user + assistant)
   * 2. Do a partial save with only updated assistant message (isFullSave: false)
   * 3. Load conversation
   * Expected: Both messages should still exist
   */
  it('should preserve all messages when doing partial saves (isFullSave: false)', async () => {
    // Step 1: Initial save with 2 messages
    const initialConversation = {
      id: testConvId,
      title: 'Test Conversation',
      provider: 'test',
      model: 'test-model',
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello, how are you?',
          createdAt: new Date().toISOString()
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'I am doing well, thank you!',
          createdAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saveResult1 = await historyStore.save(initialConversation as any);
    expect(saveResult1.success).toBe(true);

    // Verify initial save created 2 messages
    let loaded = await historyStore.load(testConvId);
    expect(loaded?.messages.length).toBe(2);
    expect(loaded?.messages[0].id).toBe('msg-1');
    expect(loaded?.messages[1].id).toBe('msg-2');

    // Step 2: Partial save with only updated assistant message (isFullSave: false)
    // This simulates what the agent runner does during real-time syncing
    const partialUpdate = {
      id: testConvId,
      messages: [
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'I am doing well, thank you! [updated by real-time sync]',
          createdAt: new Date().toISOString()
        }
      ],
      isFullSave: false, // CRITICAL: This flag tells save() to NOT delete other messages
      updatedAt: new Date().toISOString()
    };

    const saveResult2 = await historyStore.save(partialUpdate as any);
    expect(saveResult2.success).toBe(true);

    // Step 3: Load conversation - verify BOTH messages still exist
    loaded = await historyStore.load(testConvId);
    expect(loaded?.messages.length).toBe(2).withContext(
      'Partial save with isFullSave:false should NOT delete msg-1'
    );
    expect(loaded?.messages[0].id).toBe('msg-1');
    expect(loaded?.messages[0].content).toBe('Hello, how are you?');
    expect(loaded?.messages[1].id).toBe('msg-2');
    expect(loaded?.messages[1].content).toBe('I am doing well, thank you! [updated by real-time sync]');
  });

  /**
   * Test 2: Full saves SHOULD delete unspecified messages
   *
   * Scenario:
   * 1. Save conversation with 3 messages
   * 2. Do a full save with only 2 messages (isFullSave: true or undefined)
   * 3. Load conversation
   * Expected: Only 2 messages should exist (the 3rd was deleted as expected)
   */
  it('should delete messages not in full save (isFullSave: true or undefined)', async () => {
    // Step 1: Initial save with 3 messages
    const initialConversation = {
      id: testConvId,
      title: 'Test Conversation',
      provider: 'test',
      model: 'test-model',
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Message 1',
          createdAt: new Date().toISOString()
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'Message 2',
          createdAt: new Date().toISOString()
        },
        {
          id: 'msg-3',
          role: 'user' as const,
          content: 'Message 3',
          createdAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saveResult1 = await historyStore.save(initialConversation as any);
    expect(saveResult1.success).toBe(true);

    let loaded = await historyStore.load(testConvId);
    expect(loaded?.messages.length).toBe(3);

    // Step 2: Full save with only 2 messages (isFullSave defaults to true)
    const fullUpdate = {
      id: testConvId,
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Message 1',
          createdAt: new Date().toISOString()
        },
        {
          id: 'msg-2',
          role: 'assistant' as const,
          content: 'Message 2 [edited]',
          createdAt: new Date().toISOString()
        }
      ],
      // isFullSave is NOT set to false, so cleanup should happen
      updatedAt: new Date().toISOString()
    };

    const saveResult2 = await historyStore.save(fullUpdate as any);
    expect(saveResult2.success).toBe(true);

    // Step 3: Load conversation - verify msg-3 was deleted
    loaded = await historyStore.load(testConvId);
    expect(loaded?.messages.length).toBe(2).withContext(
      'Full save should delete msg-3 which was not included'
    );
    expect(loaded?.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2']);
  });

  /**
   * Test 3: App restart scenario
   *
   * Simulates the full flow:
   * 1. User sends 3 messages during conversation
   * 2. Agent does real-time syncs with partial saves
   * 3. App restarts and loads from DB
   * Expected: All 3 user messages should be present
   */
  it('should preserve all messages through app restart simulation', async () => {
    // Step 1: User sends message 1
    await historyStore.save({
      id: testConvId,
      title: 'Multi-turn Conversation',
      provider: 'test',
      model: 'test-model',
      messages: [{
        id: 'user-1',
        role: 'user' as const,
        content: 'First user message',
        createdAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any);

    // Step 2: Agent responds - real-time sync (partial save)
    await historyStore.save({
      id: testConvId,
      messages: [{
        id: 'ast-1',
        role: 'assistant' as const,
        content: 'First assistant response (partial)',
        createdAt: new Date().toISOString()
      }],
      isFullSave: false,
      updatedAt: new Date().toISOString()
    } as any);

    // Step 3: Agent does more thinking - real-time sync (partial save)
    await historyStore.save({
      id: testConvId,
      messages: [{
        id: 'ast-1',
        role: 'assistant' as const,
        content: 'First assistant response (final)',
        createdAt: new Date().toISOString()
      }],
      isFullSave: false,
      updatedAt: new Date().toISOString()
    } as any);

    // Step 4: User sends message 2
    await historyStore.save({
      id: testConvId,
      messages: [
        {
          id: 'user-1',
          role: 'user' as const,
          content: 'First user message',
          createdAt: new Date().toISOString()
        },
        {
          id: 'ast-1',
          role: 'assistant' as const,
          content: 'First assistant response (final)',
          createdAt: new Date().toISOString()
        },
        {
          id: 'user-2',
          role: 'user' as const,
          content: 'Second user message',
          createdAt: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    } as any);

    // Step 5: Agent responds again - real-time sync (partial save)
    await historyStore.save({
      id: testConvId,
      messages: [{
        id: 'ast-2',
        role: 'assistant' as const,
        content: 'Second assistant response (partial)',
        createdAt: new Date().toISOString()
      }],
      isFullSave: false,
      updatedAt: new Date().toISOString()
    } as any);

    // Step 6: APP RESTART - Load conversation from database
    const loaded = await historyStore.load(testConvId);

    // Verify all messages are still there
    expect(loaded?.messages.length).toBe(4).withContext(
      'After simulated app restart, all 4 messages should be present'
    );

    const messageIds = loaded?.messages.map(m => m.id) || [];
    expect(messageIds).toContain('user-1');
    expect(messageIds).toContain('ast-1');
    expect(messageIds).toContain('user-2');
    expect(messageIds).toContain('ast-2');

    // Verify message content is correct
    expect(loaded?.messages.find(m => m.id === 'ast-1')?.content).toBe('First assistant response (final)');
    expect(loaded?.messages.find(m => m.id === 'ast-2')?.content).toBe('Second assistant response (partial)');
  });

  it('should preserve nested sub-agent timeline events inside tool calls after reload', async () => {
    const progressEvent = {
      type: 'step',
      toolCallId: 'tool-1',
      timestamp: new Date().toISOString(),
      stepNumber: 1,
      totalSteps: 3,
      content: 'Task decomposer created a nested implementation step',
    };

    await historyStore.save({
      id: testConvId,
      title: 'Nested timeline conversation',
      provider: 'test',
      model: 'test-model',
      messages: [{
        id: 'ast-nested',
        role: 'assistant' as const,
        content: 'Done',
        toolCalls: [{
          id: 'tool-1',
          toolName: 'executePwsh',
          args: { command: 'echo hi' },
          status: 'done',
          subAgentProgress: [progressEvent],
          orderIndex: 0,
        }],
        missionTimeline: {
          steps: [{
            id: 'step-1',
            name: 'Implement feature',
            status: 'completed',
            toolCalls: ['executePwsh'],
          }],
        },
        createdAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const loaded = await historyStore.load(testConvId);
    const toolCall = loaded?.messages[0]?.toolCalls?.[0] as any;

    expect(toolCall?.subAgentProgress).toHaveLength(1);
    expect(toolCall?.subAgentProgress?.[0]?.toolCallId).toBe('tool-1');
    expect(toolCall?.subAgentProgress?.[0]?.content).toContain('Task decomposer');
    expect(loaded?.messages[0]?.missionTimeline?.steps?.[0]?.name).toBe('Implement feature');
  });
});
