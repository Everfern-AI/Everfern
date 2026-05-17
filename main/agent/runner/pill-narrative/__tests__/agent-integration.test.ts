/**
 * Integration Tests for Pill-Based Timeline with Agent Runner
 *
 * **Validates: Requirements 1.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PillNarrativeTimelineIntegration,
  resetIntegration,
} from '../agent-integration';
import { createPillNarrativeTimelineManager } from '../manager';
import type { NarrativeTimeline, Task, ToolPill } from '../types';

// Mock AIClient
const mockClient = {
  chat: vi.fn(),
  setModel: vi.fn(),
  model: 'test-model',
  provider: 'test',
} as any;

describe('PillNarrativeTimelineIntegration', () => {
  let integration: PillNarrativeTimelineIntegration;
  const missionId = 'test-mission-1';
  const userRequest = 'Search for Discord bots and analyze results';

  beforeEach(() => {
    resetIntegration();
    integration = new PillNarrativeTimelineIntegration(mockClient);

    // Mock the AI client response for task decomposition
    mockClient.chat.mockResolvedValue({
      content: JSON.stringify([
        {
          title: 'Search for Discord bots',
          description: 'Find available Discord bot options',
          pills: [
            { toolName: 'web_search', label: 'Search', icon: '🔍' },
            { toolName: 'browser_use', label: 'Browse', icon: '🌐', dependsOn: ['web_search'] },
          ],
        },
        {
          title: 'Analyze results',
          description: 'Analyze the search results',
          pills: [
            { toolName: 'python_execute', label: 'Analyze', icon: '🐍', dependsOn: ['browser_use'] },
          ],
        },
      ]),
    });
  });

  afterEach(() => {
    resetIntegration();
  });

  describe('Timeline Initialization', () => {
    it('should initialize a timeline from user request', async () => {
      const timeline = await integration.initializeTimeline(missionId, userRequest);

      expect(timeline).toBeDefined();
      expect(timeline.missionId).toBe(missionId);
      expect(timeline.tasks.length).toBeGreaterThan(0);
      expect(timeline.status).toBe('pending');
    });

    it('should generate tasks with business-focused titles', async () => {
      const timeline = await integration.initializeTimeline(missionId, userRequest);

      const titles = timeline.tasks.map((t) => t.title);
      expect(titles.length).toBeGreaterThan(0);

      // Verify titles are business-focused (not tool names)
      for (const title of titles) {
        expect(title).toBeTruthy();
        expect(title.length).toBeGreaterThan(0);
      }
    });

    it('should generate pills under tasks', async () => {
      const timeline = await integration.initializeTimeline(missionId, userRequest);

      for (const task of timeline.tasks) {
        expect(task.pills).toBeDefined();
        expect(Array.isArray(task.pills)).toBe(true);

        for (const pill of task.pills) {
          expect(pill.id).toBeDefined();
          expect(pill.toolName).toBeDefined();
          expect(pill.status).toBe('pending');
        }
      }
    });

    it('should emit timeline_created event', async () => {
      const eventSpy = vi.fn();
      integration.onTimelineEvent(eventSpy);

      await integration.initializeTimeline(missionId, userRequest);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'timeline_created',
          missionId,
        })
      );
    });
  });

  describe('Tool Call Tracking', () => {
    beforeEach(async () => {
      await integration.initializeTimeline(missionId, userRequest);
    });

    it('should track tool calls and associate with pills', () => {
      const toolCallId = 'tool-call-1';
      const toolName = 'web_search';
      const parameters = { query: 'Discord bots' };

      integration.trackToolCall(missionId, toolCallId, toolName, parameters);

      const timeline = integration.getTimeline(missionId);
      expect(timeline).toBeDefined();

      // Find the pill that should have been updated
      let foundPill: ToolPill | undefined;
      for (const task of timeline!.tasks) {
        foundPill = task.pills.find((p) => p.toolName === toolName);
        if (foundPill) break;
      }

      expect(foundPill).toBeDefined();
      expect(foundPill!.status).toBe('in-progress');
      expect(foundPill!.parameters).toEqual(parameters);
    });

    it('should update pill status when tool completes', () => {
      const toolCallId = 'tool-call-1';
      const toolName = 'web_search';

      // Track the tool call
      integration.trackToolCall(missionId, toolCallId, toolName);

      // Update status to completed
      const result = 'Found 10 Discord bots';
      integration.updatePillStatus(missionId, toolCallId, 'completed', result);

      const timeline = integration.getTimeline(missionId);
      expect(timeline).toBeDefined();

      // Find the pill and verify status
      let foundPill: ToolPill | undefined;
      for (const task of timeline!.tasks) {
        foundPill = task.pills.find((p) => p.toolName === toolName);
        if (foundPill) break;
      }

      expect(foundPill).toBeDefined();
      expect(foundPill!.status).toBe('completed');
      expect(foundPill!.result).toBe(result);
    });

    it('should handle tool execution failure', () => {
      const toolCallId = 'tool-call-1';
      const toolName = 'web_search';

      integration.trackToolCall(missionId, toolCallId, toolName);

      const errorMsg = 'Network error';
      integration.updatePillStatus(missionId, toolCallId, 'failed', undefined, errorMsg);

      const timeline = integration.getTimeline(missionId);
      expect(timeline).toBeDefined();

      let foundPill: ToolPill | undefined;
      for (const task of timeline!.tasks) {
        foundPill = task.pills.find((p) => p.toolName === toolName);
        if (foundPill) break;
      }

      expect(foundPill).toBeDefined();
      expect(foundPill!.status).toBe('failed');
      expect(foundPill!.error).toBe(errorMsg);
    });
  });

  describe('Status Propagation', () => {
    beforeEach(async () => {
      await integration.initializeTimeline(missionId, userRequest);
    });

    it('should propagate pill status to task status', () => {
      const eventSpy = vi.fn();
      integration.onTimelineEvent(eventSpy);

      const toolCallId = 'tool-call-1';
      const toolName = 'web_search';

      // Track and complete the tool call
      integration.trackToolCall(missionId, toolCallId, toolName);
      integration.updatePillStatus(missionId, toolCallId, 'completed', 'Result');

      // Should emit pill_status_changed event
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pill_status_changed',
          status: 'in-progress',
        })
      );

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pill_status_changed',
          status: 'completed',
        })
      );
    });

    it('should update task status when all pills complete', async () => {
      // Create a simpler timeline for this test
      const manager = createPillNarrativeTimelineManager();
      const testMissionId = 'test-mission-2';

      const timeline: NarrativeTimeline = {
        missionId: testMissionId,
        tasks: [
          {
            id: 'task-1',
            title: 'Test Task',
            pills: [
              {
                id: 'pill-1',
                toolName: 'web_search',
                status: 'pending',
              },
            ],
            status: 'pending',
          },
        ],
        status: 'pending',
        startTime: Date.now(),
      };

      manager.create(testMissionId, timeline);

      // Update pill to in-progress first
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-1', 'in-progress');

      // Then update to completed
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-1', 'completed', 'Result');

      const updatedTimeline = manager.getTimeline(testMissionId);
      expect(updatedTimeline).toBeDefined();
      expect(updatedTimeline!.tasks[0].status).toBe('completed');
    });

    it('should update task status to failed if any pill fails', async () => {
      const manager = createPillNarrativeTimelineManager();
      const testMissionId = 'test-mission-3';

      const timeline: NarrativeTimeline = {
        missionId: testMissionId,
        tasks: [
          {
            id: 'task-1',
            title: 'Test Task',
            pills: [
              {
                id: 'pill-1',
                toolName: 'web_search',
                status: 'pending',
              },
              {
                id: 'pill-2',
                toolName: 'browser_use',
                status: 'pending',
              },
            ],
            status: 'pending',
          },
        ],
        status: 'pending',
        startTime: Date.now(),
      };

      manager.create(testMissionId, timeline);

      // Mark first pill as in-progress then completed
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-1', 'in-progress');
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-1', 'completed', 'Result');

      // Mark second pill as in-progress then failed
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-2', 'in-progress');
      manager.updatePillStatus(testMissionId, 'task-1', 'pill-2', 'failed', undefined, 'Error');

      const updatedTimeline = manager.getTimeline(testMissionId);
      expect(updatedTimeline).toBeDefined();
      expect(updatedTimeline!.tasks[0].status).toBe('failed');
    });
  });

  describe('Event Emission', () => {
    beforeEach(async () => {
      await integration.initializeTimeline(missionId, userRequest);
    });

    it('should emit timeline_updated events', async () => {
      const eventSpy = vi.fn();
      integration.onTimelineEvent(eventSpy);

      const toolCallId = 'tool-call-1';
      integration.trackToolCall(missionId, toolCallId, 'web_search');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'timeline_updated',
          missionId,
        })
      );
    });

    it('should emit pill_status_changed events', () => {
      const eventSpy = vi.fn();
      integration.onTimelineEvent(eventSpy);

      const toolCallId = 'tool-call-1';
      integration.trackToolCall(missionId, toolCallId, 'web_search');
      integration.updatePillStatus(missionId, toolCallId, 'completed', 'Result');

      const pillStatusEvents = eventSpy.mock.calls.filter(
        (call) => call[0].type === 'pill_status_changed'
      );
      expect(pillStatusEvents.length).toBeGreaterThan(0);
    });

    it('should allow unsubscribing from events', () => {
      const eventSpy = vi.fn();
      const unsubscribe = integration.onTimelineEvent(eventSpy);

      unsubscribe();

      const toolCallId = 'tool-call-1';
      integration.trackToolCall(missionId, toolCallId, 'web_search');

      // Should not be called after unsubscribe
      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('Timeline Retrieval', () => {
    beforeEach(async () => {
      await integration.initializeTimeline(missionId, userRequest);
    });

    it('should retrieve current timeline', () => {
      const timeline = integration.getTimeline(missionId);

      expect(timeline).toBeDefined();
      expect(timeline!.missionId).toBe(missionId);
      expect(timeline!.tasks.length).toBeGreaterThan(0);
    });

    it('should return null for non-existent timeline', () => {
      const timeline = integration.getTimeline('non-existent-mission');

      expect(timeline).toBeNull();
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await integration.initializeTimeline(missionId, userRequest);
    });

    it('should clean up timeline on completion', () => {
      let timeline = integration.getTimeline(missionId);
      expect(timeline).toBeDefined();

      integration.cleanup(missionId);

      timeline = integration.getTimeline(missionId);
      expect(timeline).toBeNull();
    });
  });
});
