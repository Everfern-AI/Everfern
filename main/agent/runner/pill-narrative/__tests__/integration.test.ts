/**
 * Integration Tests for Pill-Based Timeline with Agent Runner
 *
 * Tests the integration of PillNarrativeTimelineManager with the agent execution flow.
 * Validates that pill-based structures are generated, tracked, and updated correctly
 * during agent execution.
 *
 * **Validates: Requirements 1.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PillTimelineIntegration } from '../integration';
import { PillNarrativeTimelineManager } from '../manager';
import type { NarrativeTimeline, Task, ToolPill } from '../types';

/**
 * Mock AIClient for testing
 */
class MockAIClient {
  async chat(options: any) {
    // Return a mock task decomposition
    return {
      content: JSON.stringify([
        {
          title: 'Search for information',
          description: 'Search the web for relevant information',
          pills: [
            { toolName: 'web_search', label: 'Search', icon: '🔍' },
          ],
        },
      ]),
    };
  }
}

describe('PillTimelineIntegration', () => {
  let integration: PillTimelineIntegration;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    integration = new PillTimelineIntegration(mockClient as any);
  });

  afterEach(() => {
    integration.clearAll();
  });

  describe('Timeline Initialization', () => {
    it('should initialize a pill-based timeline from a user request', async () => {
      const missionId = 'mission_1';
      const userRequest = 'Search for Discord bots';

      const timeline = await integration.initializeTimeline(missionId, userRequest);

      expect(timeline).toBeDefined();
      expect(timeline.missionId).toBe(missionId);
      expect(timeline.tasks).toBeDefined();
      expect(timeline.tasks.length).toBeGreaterThan(0);
      expect(timeline.status).toBe('pending');
    });

    it('should create timeline in manager', async () => {
      const missionId = 'mission_2';
      const userRequest = 'Analyze data';

      await integration.initializeTimeline(missionId, userRequest);

      const retrieved = integration.getTimeline(missionId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.missionId).toBe(missionId);
    });

    it('should emit initialization event', async () => {
      const missionId = 'mission_3';
      const userRequest = 'Test request';
      const events: any[] = [];

      integration.onEvent((event) => {
        events.push(event);
      });

      await integration.initializeTimeline(missionId, userRequest);

      const initEvent = events.find((e) => e.type === 'pill-timeline-initialized');
      expect(initEvent).toBeDefined();
      expect(initEvent?.missionId).toBe(missionId);
    });
  });

  describe('Pill Status Updates', () => {
    let missionId: string;
    let taskId: string;
    let pillId: string;

    beforeEach(async () => {
      missionId = 'mission_4';
      const timeline = await integration.initializeTimeline(missionId, 'Test task');
      taskId = timeline.tasks[0].id;
      pillId = timeline.tasks[0].pills[0].id;
    });

    it('should update pill status from pending to in-progress', () => {
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.status).toBe('in-progress');
    });

    it('should update pill status from in-progress to completed', () => {
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      integration.updatePillStatus(missionId, taskId, pillId, 'completed', 'Result data');

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.status).toBe('completed');
      expect(pill?.result).toBe('Result data');
    });

    it('should update pill status to failed with error', () => {
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      integration.updatePillStatus(missionId, taskId, pillId, 'failed', undefined, 'Tool error');

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.status).toBe('failed');
      expect(pill?.error).toBe('Tool error');
    });

    it('should propagate pill status to task status', () => {
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');

      const timeline = integration.getTimeline(missionId);
      const task = timeline?.tasks[0];
      expect(task?.status).toBe('in-progress');
    });

    it('should emit status update event', () => {
      const events: any[] = [];
      integration.onEvent((event) => {
        events.push(event);
      });

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');

      const statusEvent = events.find((e) => e.type === 'pill-status-updated');
      expect(statusEvent).toBeDefined();
      expect(statusEvent?.status).toBe('in-progress');
    });
  });

  describe('Tool Call Tracking', () => {
    let missionId: string;
    let taskId: string;
    let pillId: string;

    beforeEach(async () => {
      missionId = 'mission_5';
      const timeline = await integration.initializeTimeline(missionId, 'Test task');
      taskId = timeline.tasks[0].id;
      pillId = timeline.tasks[0].pills[0].id;
    });

    it('should track tool call and associate with pill', () => {
      const toolCallId = 'tool_call_1';
      const parameters = { query: 'test query' };

      integration.trackToolCall(missionId, taskId, pillId, toolCallId, 'web_search', parameters);

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.parameters).toEqual(parameters);
    });

    it('should emit tool call tracking event', () => {
      const events: any[] = [];
      integration.onEvent((event) => {
        events.push(event);
      });

      const toolCallId = 'tool_call_2';
      integration.trackToolCall(missionId, taskId, pillId, toolCallId, 'web_search', {});

      const trackEvent = events.find((e) => e.type === 'tool-call-tracked');
      expect(trackEvent).toBeDefined();
      expect(trackEvent?.toolCallId).toBe(toolCallId);
    });

    it('should complete tool call and update pill status', () => {
      const toolCallId = 'tool_call_3';
      integration.trackToolCall(missionId, taskId, pillId, toolCallId, 'web_search', {});

      // Transition through in-progress first
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      integration.completeToolCall(toolCallId, 'Search results');

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.status).toBe('completed');
      expect(pill?.result).toBe('Search results');
    });

    it('should complete tool call with error', () => {
      const toolCallId = 'tool_call_4';
      integration.trackToolCall(missionId, taskId, pillId, toolCallId, 'web_search', {});

      // Transition through in-progress first
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      integration.completeToolCall(toolCallId, '', 'Network error');

      const timeline = integration.getTimeline(missionId);
      const pill = timeline?.tasks[0].pills[0];
      expect(pill?.status).toBe('failed');
      expect(pill?.error).toBe('Network error');
    });
  });

  describe('Status Propagation', () => {
    let missionId: string;

    beforeEach(async () => {
      missionId = 'mission_6';
      await integration.initializeTimeline(missionId, 'Multi-pill task');
    });

    it('should propagate pill status to task status', () => {
      const timeline = integration.getTimeline(missionId)!;
      const taskId = timeline.tasks[0].id;
      const pills = timeline.tasks[0].pills;

      // Start first pill
      integration.updatePillStatus(missionId, taskId, pills[0].id, 'in-progress');
      let task = integration.getTimeline(missionId)!.tasks[0];
      expect(task.status).toBe('in-progress');

      // Complete first pill
      integration.updatePillStatus(missionId, taskId, pills[0].id, 'completed');
      task = integration.getTimeline(missionId)!.tasks[0];
      // Task status depends on all pills
      expect(task.status).toBeDefined();
    });

    it('should propagate task status to timeline status', () => {
      const timeline = integration.getTimeline(missionId)!;
      const taskId = timeline.tasks[0].id;
      const pillId = timeline.tasks[0].pills[0].id;

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');

      const updatedTimeline = integration.getTimeline(missionId)!;
      expect(updatedTimeline.status).toBe('in-progress');
    });

    it('should mark task as failed if any pill fails', () => {
      const timeline = integration.getTimeline(missionId)!;
      const taskId = timeline.tasks[0].id;
      const pillId = timeline.tasks[0].pills[0].id;

      // Transition through in-progress first
      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      integration.updatePillStatus(missionId, taskId, pillId, 'failed', undefined, 'Error');

      const task = integration.getTimeline(missionId)!.tasks[0];
      expect(task.status).toBe('failed');
    });
  });

  describe('Event Subscriptions', () => {
    let missionId: string;
    let taskId: string;
    let pillId: string;

    beforeEach(async () => {
      missionId = 'mission_7';
      const timeline = await integration.initializeTimeline(missionId, 'Test task');
      taskId = timeline.tasks[0].id;
      pillId = timeline.tasks[0].pills[0].id;
    });

    it('should subscribe to timeline updates', (done) => {
      integration.onTimelineUpdate(missionId, (timeline) => {
        expect(timeline.missionId).toBe(missionId);
        done();
      });

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
    });

    it('should subscribe to pill status changes', (done) => {
      integration.onPillStatusChange(missionId, (pillId, status) => {
        expect(status).toBe('in-progress');
        done();
      });

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
    });

    it('should subscribe to task status changes', (done) => {
      integration.onTaskStatusChange(missionId, (taskId, status) => {
        expect(status).toBeDefined();
        done();
      });

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
    });

    it('should unsubscribe from events', () => {
      let callCount = 0;
      const unsubscribe = integration.onEvent(() => {
        callCount++;
      });

      integration.updatePillStatus(missionId, taskId, pillId, 'in-progress');
      expect(callCount).toBeGreaterThan(0);

      callCount = 0;
      unsubscribe();

      integration.updatePillStatus(missionId, taskId, pillId, 'completed');
      expect(callCount).toBe(0);
    });
  });

  describe('Timeline Management', () => {
    it('should get all timelines', async () => {
      await integration.initializeTimeline('mission_8', 'Task 1');
      await integration.initializeTimeline('mission_9', 'Task 2');

      const timelines = integration.getAllTimelines();
      expect(timelines.length).toBeGreaterThanOrEqual(2);
    });

    it('should delete a timeline', async () => {
      const missionId = 'mission_10';
      await integration.initializeTimeline(missionId, 'Task');

      const deleted = integration.deleteTimeline(missionId);
      expect(deleted).toBe(true);

      const retrieved = integration.getTimeline(missionId);
      expect(retrieved).toBeNull();
    });

    it('should clear all timelines', async () => {
      await integration.initializeTimeline('mission_11', 'Task 1');
      await integration.initializeTimeline('mission_12', 'Task 2');

      integration.clearAll();

      const timelines = integration.getAllTimelines();
      expect(timelines.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid mission ID gracefully', () => {
      expect(() => {
        integration.updatePillStatus('invalid_mission', 'task_1', 'pill_1', 'completed');
      }).not.toThrow();
    });

    it('should handle missing tool call mapping', () => {
      expect(() => {
        integration.completeToolCall('unknown_tool_call', 'result');
      }).not.toThrow();
    });

    it('should handle event callback errors', async () => {
      const missionId = 'mission_13';
      await integration.initializeTimeline(missionId, 'Task');

      integration.onEvent(() => {
        throw new Error('Callback error');
      });

      // Should not throw
      expect(() => {
        integration.updatePillStatus(missionId, missionId, 'pill_1', 'completed');
      }).not.toThrow();
    });
  });
});
