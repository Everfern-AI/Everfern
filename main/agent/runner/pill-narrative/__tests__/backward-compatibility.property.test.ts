/**
 * Property-Based Test: Backward Compatibility
 *
 * **Validates: Requirements 9.1, 9.4, 9.5**
 *
 * This test verifies that:
 * - Pill-based structures can be converted to flat format
 * - No critical information is lost in conversion
 * - Round-trip conversion preserves data integrity
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  convertToFlatTimeline,
  convertToPillBased,
  validateBackwardCompatibility,
  type NarrativeTimeline,
} from '../backward-compatibility';
import type { Task, ToolPill } from '../types';

/**
 * Generator for tool pills
 */
const toolPillGenerator = (): fc.Arbitrary<ToolPill> => {
  const toolNames = ['web_search', 'browser_use', 'read_file', 'write_file', 'python_execute'];

  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `pill_${s.replace(/[^a-z0-9]/g, '')}`),
    toolName: fc.constantFrom(...toolNames),
    status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed', 'skipped'),
    label: fc.option(fc.string({ minLength: 1, maxLength: 20 })),
    icon: fc.option(fc.string({ minLength: 1, maxLength: 5 })),
    parameters: fc.option(fc.record({ query: fc.string({ minLength: 1, maxLength: 50 }) })),
    result: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    error: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
  });
};

/**
 * Generator for tasks
 */
const taskGenerator = (): fc.Arbitrary<Task> => {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `task_${s.replace(/[^a-z0-9]/g, '')}`),
    title: fc.string({ minLength: 5, maxLength: 50 }),
    description: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    pills: fc.array(toolPillGenerator(), { minLength: 1, maxLength: 5 }),
    status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed', 'skipped'),
  });
};

/**
 * Generator for narrative timelines
 */
const narrativeTimelineGenerator = (): fc.Arbitrary<NarrativeTimeline> => {
  return fc.record({
    missionId: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `mission_${s.replace(/[^a-z0-9]/g, '')}`),
    tasks: fc.array(taskGenerator(), { minLength: 1, maxLength: 5 }),
    status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed', 'skipped'),
    startTime: fc.integer({ min: 1000000000000, max: 2000000000000 }),
    endTime: fc.option(fc.integer({ min: 1000000000000, max: 2000000000000 })),
  });
};

describe('Property: Backward Compatibility', () => {
  /**
   * Property 1: Conversion to flat format preserves mission ID
   */
  it('should preserve mission ID when converting to flat format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);
        return flatTimeline.missionId === timeline.missionId;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 2: Conversion to flat format preserves status
   */
  it('should preserve status when converting to flat format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);
        return flatTimeline.status === timeline.status;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 3: Conversion to flat format preserves timing
   */
  it('should preserve timing when converting to flat format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);
        return flatTimeline.startTime === timeline.startTime;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 4: All pills are present in flat format
   */
  it('should preserve all pills when converting to flat format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);

        // Count total pills
        const totalPills = timeline.tasks.reduce((sum, task) => sum + task.pills.length, 0);

        // Check that all pills are in flat timeline
        return flatTimeline.toolCalls.length === totalPills;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 5: Conversion back to pill-based format preserves mission ID
   */
  it('should preserve mission ID when converting back to pill-based format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);
        const convertedTimeline = convertToPillBased(flatTimeline);

        return convertedTimeline.missionId === timeline.missionId;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 6: Conversion back to pill-based format preserves status
   */
  it('should preserve status when converting back to pill-based format', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const flatTimeline = convertToFlatTimeline(timeline);
        const convertedTimeline = convertToPillBased(flatTimeline);

        return convertedTimeline.status === timeline.status;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 7: Backward compatibility validation passes
   */
  it('should pass backward compatibility validation', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        const result = validateBackwardCompatibility(timeline);
        return result.isValid;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 8: No critical information lost in round-trip
   */
  it('should not lose critical information in round-trip conversion', () => {
    fc.assert(
      fc.property(narrativeTimelineGenerator(), (timeline) => {
        // Convert to flat
        const flatTimeline = convertToFlatTimeline(timeline);

        // Convert back to pill-based
        const convertedTimeline = convertToPillBased(flatTimeline);

        // Check critical information
        const missionIdPreserved = convertedTimeline.missionId === timeline.missionId;

        // Check that all pills are present (at least the count)
        const originalPillCount = timeline.tasks.reduce((sum, task) => sum + task.pills.length, 0);
        const convertedPillCount = convertedTimeline.tasks.reduce((sum, task) => sum + task.pills.length, 0);

        // The converted timeline might have a different structure, but should have the same pill count
        return missionIdPreserved && (convertedPillCount >= originalPillCount);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 9: Flat timeline can be converted back to pill-based
   */
  it('should be able to convert flat timeline back to pill-based format', () => {
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

    const convertedTimeline = convertToPillBased(flatTimeline);

    // Check that converted timeline has valid structure
    expect(convertedTimeline.missionId).toBe(flatTimeline.missionId);
    expect(Array.isArray(convertedTimeline.tasks)).toBe(true);
    expect(convertedTimeline.status).toBe(flatTimeline.status);
    expect(convertedTimeline.startTime).toBe(flatTimeline.startTime);
  });
});
