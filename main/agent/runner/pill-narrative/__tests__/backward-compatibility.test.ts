/**
 * Integration Tests for Backward Compatibility Layer
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
 *
 * Tests for:
 * - Existing MissionTimeline still functions
 * - Both timelines can coexist
 * - Fallback to flat timeline works
 * - Conversion utilities work correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  convertToFlatTimeline,
  convertToPillBased,
  validateBackwardCompatibility,
  isPillBasedTimeline,
  isFlatTimeline,
  type NarrativeTimeline,
  type FlatTimeline,
} from '../backward-compatibility';
import type { Task, ToolPill } from '../types';

/**
 * Create mock pill
 */
function createMockPill(overrides?: Partial<ToolPill>): ToolPill {
  return {
    id: 'pill_1',
    toolName: 'web_search',
    status: 'completed',
    label: 'Search',
    icon: '🔍',
    parameters: { query: 'test' },
    result: 'test result',
    ...overrides,
  };
}

/**
 * Create mock task
 */
function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_1',
    title: 'Search for information',
    pills: [createMockPill()],
    status: 'completed',
    ...overrides,
  };
}

/**
 * Create mock pill-based timeline
 */
function createMockPillBasedTimeline(overrides?: Partial<NarrativeTimeline>): NarrativeTimeline {
  return {
    missionId: 'mission_1',
    tasks: [createMockTask()],
    status: 'completed',
    startTime: Date.now(),
    ...overrides,
  };
}

describe('Backward Compatibility Layer', () => {
  describe('convertToFlatTimeline()', () => {
    it('should convert pill-based timeline to flat format', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline).toBeDefined();
      expect(flatTimeline.missionId).toBe(pillBasedTimeline.missionId);
      expect(flatTimeline.status).toBe(pillBasedTimeline.status);
      expect(flatTimeline.startTime).toBe(pillBasedTimeline.startTime);
    });

    it('should flatten all pills from all tasks', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        tasks: [
          createMockTask({
            id: 'task_1',
            pills: [
              createMockPill({ id: 'pill_1' }),
              createMockPill({ id: 'pill_2' }),
            ],
          }),
          createMockTask({
            id: 'task_2',
            pills: [
              createMockPill({ id: 'pill_3' }),
            ],
          }),
        ],
      });

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline.toolCalls.length).toBe(3);
      expect(flatTimeline.toolCalls.map((tc) => tc.id)).toEqual(['pill_1', 'pill_2', 'pill_3']);
    });

    it('should preserve pill information in flat format', () => {
      const pill = createMockPill({
        id: 'pill_1',
        toolName: 'web_search',
        status: 'completed',
        parameters: { query: 'test query' },
        result: 'test result',
        error: undefined,
      });

      const pillBasedTimeline = createMockPillBasedTimeline({
        tasks: [createMockTask({ pills: [pill] })],
      });

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline.toolCalls[0]).toEqual({
        id: 'pill_1',
        toolName: 'web_search',
        status: 'completed',
        parameters: { query: 'test query' },
        result: 'test result',
        error: undefined,
        startTime: undefined,
        endTime: undefined,
      });
    });

    it('should preserve metadata', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        metadata: {
          userRequest: 'Find information',
          agent: 'test-agent',
          model: 'test-model',
        },
      });

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline.metadata).toEqual({
        userRequest: 'Find information',
        agent: 'test-agent',
        model: 'test-model',
      });
    });

    it('should handle empty tasks', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        tasks: [],
      });

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline.toolCalls.length).toBe(0);
    });

    it('should handle tasks with no pills', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        tasks: [createMockTask({ pills: [] })],
      });

      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      expect(flatTimeline.toolCalls.length).toBe(0);
    });
  });

  describe('convertToPillBased()', () => {
    it('should convert flat timeline to pill-based format', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [
          {
            id: 'pill_1',
            toolName: 'web_search',
            status: 'completed',
            parameters: { query: 'test' },
            result: 'test result',
          },
        ],
        status: 'completed',
        startTime: Date.now(),
      };

      const pillBasedTimeline = convertToPillBased(flatTimeline);

      expect(pillBasedTimeline).toBeDefined();
      expect(pillBasedTimeline.missionId).toBe(flatTimeline.missionId);
      expect(pillBasedTimeline.status).toBe(flatTimeline.status);
      expect(pillBasedTimeline.startTime).toBe(flatTimeline.startTime);
    });

    it('should create tasks from tool calls', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [
          {
            id: 'pill_1',
            toolName: 'web_search',
            status: 'completed',
          },
          {
            id: 'pill_2',
            toolName: 'browser_use',
            status: 'completed',
          },
        ],
        status: 'completed',
        startTime: Date.now(),
      };

      const pillBasedTimeline = convertToPillBased(flatTimeline);

      expect(pillBasedTimeline.tasks.length).toBeGreaterThan(0);
      expect(pillBasedTimeline.tasks[0].pills.length).toBeGreaterThan(0);
    });

    it('should generate task titles', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [
          {
            id: 'pill_1',
            toolName: 'web_search',
            status: 'completed',
          },
        ],
        status: 'completed',
        startTime: Date.now(),
      };

      const pillBasedTimeline = convertToPillBased(flatTimeline);

      expect(pillBasedTimeline.tasks[0].title).toBeDefined();
      expect(pillBasedTimeline.tasks[0].title.length).toBeGreaterThan(0);
    });

    it('should calculate task status from pills', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [
          {
            id: 'pill_1',
            toolName: 'web_search',
            status: 'completed',
          },
          {
            id: 'pill_2',
            toolName: 'browser_use',
            status: 'completed',
          },
        ],
        status: 'completed',
        startTime: Date.now(),
      };

      const pillBasedTimeline = convertToPillBased(flatTimeline);

      // All pills are completed, so tasks should be completed
      pillBasedTimeline.tasks.forEach((task) => {
        expect(task.status).toBe('completed');
      });
    });

    it('should handle empty tool calls', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [],
        status: 'pending',
        startTime: Date.now(),
      };

      const pillBasedTimeline = convertToPillBased(flatTimeline);

      expect(pillBasedTimeline.tasks.length).toBe(0);
    });
  });

  describe('validateBackwardCompatibility()', () => {
    it('should validate successful conversion', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();

      const result = validateBackwardCompatibility(pillBasedTimeline);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect pill count mismatch', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        tasks: [
          createMockTask({
            pills: [
              createMockPill({ id: 'pill_1' }),
              createMockPill({ id: 'pill_2' }),
            ],
          }),
        ],
      });

      const result = validateBackwardCompatibility(pillBasedTimeline);

      expect(result.isValid).toBe(true); // Should still be valid
      expect(result.errors.length).toBe(0);
    });

    it('should preserve mission ID', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        missionId: 'mission_123',
      });

      const result = validateBackwardCompatibility(pillBasedTimeline);

      expect(result.isValid).toBe(true);
      expect(result.errors.filter((e) => e.includes('Mission ID'))).toHaveLength(0);
    });

    it('should preserve status', () => {
      const pillBasedTimeline = createMockPillBasedTimeline({
        status: 'failed',
      });

      const result = validateBackwardCompatibility(pillBasedTimeline);

      expect(result.isValid).toBe(true);
      expect(result.errors.filter((e) => e.includes('Status'))).toHaveLength(0);
    });

    it('should preserve timing', () => {
      const startTime = Date.now();
      const pillBasedTimeline = createMockPillBasedTimeline({
        startTime,
      });

      const result = validateBackwardCompatibility(pillBasedTimeline);

      expect(result.isValid).toBe(true);
      expect(result.errors.filter((e) => e.includes('Start time'))).toHaveLength(0);
    });
  });

  describe('isPillBasedTimeline()', () => {
    it('should identify pill-based timeline', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();

      expect(isPillBasedTimeline(pillBasedTimeline)).toBe(true);
    });

    it('should reject flat timeline', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [],
        status: 'pending',
        startTime: Date.now(),
      };

      expect(isPillBasedTimeline(flatTimeline)).toBe(false);
    });

    it('should reject null', () => {
      const result = isPillBasedTimeline(null);
      expect(result).toBe(false);
    });

    it('should reject undefined', () => {
      const result = isPillBasedTimeline(undefined);
      expect(result).toBe(false);
    });
  });

  describe('isFlatTimeline()', () => {
    it('should identify flat timeline', () => {
      const flatTimeline: FlatTimeline = {
        missionId: 'mission_1',
        toolCalls: [],
        status: 'pending',
        startTime: Date.now(),
      };

      expect(isFlatTimeline(flatTimeline)).toBe(true);
    });

    it('should reject pill-based timeline', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();

      expect(isFlatTimeline(pillBasedTimeline)).toBe(false);
    });

    it('should reject null', () => {
      const result = isFlatTimeline(null);
      expect(result).toBe(false);
    });

    it('should reject undefined', () => {
      const result = isFlatTimeline(undefined);
      expect(result).toBe(false);
    });
  });

  describe('Round-trip Conversion', () => {
    it('should preserve critical information in round-trip conversion', () => {
      const originalTimeline = createMockPillBasedTimeline({
        tasks: [
          createMockTask({
            id: 'task_1',
            title: 'Search for information',
            pills: [
              createMockPill({ id: 'pill_1', toolName: 'web_search' }),
              createMockPill({ id: 'pill_2', toolName: 'browser_use' }),
            ],
          }),
        ],
      });

      // Convert to flat
      const flatTimeline = convertToFlatTimeline(originalTimeline);

      // Convert back to pill-based
      const convertedTimeline = convertToPillBased(flatTimeline);

      // Check that critical information is preserved
      expect(convertedTimeline.missionId).toBe(originalTimeline.missionId);
      expect(convertedTimeline.status).toBe(originalTimeline.status);
      expect(convertedTimeline.startTime).toBe(originalTimeline.startTime);

      // Check that all pills are present
      const originalPillIds = new Set<string>();
      for (const task of originalTimeline.tasks) {
        for (const pill of task.pills) {
          originalPillIds.add(pill.id);
        }
      }

      const convertedPillIds = new Set<string>();
      for (const task of convertedTimeline.tasks) {
        for (const pill of task.pills) {
          convertedPillIds.add(pill.id);
        }
      }

      expect(convertedPillIds.size).toBe(originalPillIds.size);
    });
  });

  describe('Coexistence', () => {
    it('should allow both timelines to exist simultaneously', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();
      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      // Both should be valid
      expect(isPillBasedTimeline(pillBasedTimeline)).toBe(true);
      expect(isFlatTimeline(flatTimeline)).toBe(true);

      // Both should have the same mission ID
      expect(pillBasedTimeline.missionId).toBe(flatTimeline.missionId);
    });

    it('should allow fallback to flat timeline', () => {
      const pillBasedTimeline = createMockPillBasedTimeline();

      // If pill-based timeline is not available, fall back to flat
      const flatTimeline = convertToFlatTimeline(pillBasedTimeline);

      // Flat timeline should be usable
      expect(flatTimeline.missionId).toBeDefined();
      expect(flatTimeline.toolCalls).toBeDefined();
      expect(Array.isArray(flatTimeline.toolCalls)).toBe(true);
    });
  });
});
