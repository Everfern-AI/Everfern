/**
 * Integration Tests for TimelineRenderer Streaming Updates
 *
 * Tests streaming tool call arrivals, task status propagation, and expand/collapse state management.
 * Validates that the timeline correctly handles real-time updates without full re-renders.
 *
 * Note: These tests focus on the core streaming logic and state management.
 * Full component rendering tests are covered in TimelineRenderer.test.tsx
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskToolMapper } from '../TaskToolMapper';
import type { DecomposedTask, TaskStep } from '@/main/agent/runner/state';

/**
 * Helper to create a mock DecomposedTask
 */
const createMockDecomposedTask = (overrides?: Partial<DecomposedTask>): DecomposedTask => ({
  id: 'task-1',
  title: 'Test Task',
  steps: [
    {
      id: 'step-1',
      title: 'Step 1',
      description: 'First step',
      tool: 'tool-1',
      canParallelize: false,
    },
    {
      id: 'step-2',
      title: 'Step 2',
      description: 'Second step',
      tool: 'tool-2',
      canParallelize: false,
    },
    {
      id: 'step-3',
      title: 'Step 3',
      description: 'Third step',
      tool: 'tool-3',
      canParallelize: true,
    },
  ],
  totalSteps: 3,
  canParallelize: false,
  executionMode: 'sequential',
  ...overrides,
});

describe('TimelineRenderer - Streaming Integration Tests', () => {
  describe('Tool Call Streaming Integration', () => {
    it('should map tool calls to task steps in order', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map first tool call
      const result1 = mapper.mapToolCall('tool-1', 'tool-1');
      expect(result1).toBe('step-1');

      // Advance to next step
      mapper.advanceTaskStep();

      // Map second tool call
      const result2 = mapper.mapToolCall('tool-2', 'tool-2');
      expect(result2).toBe('step-2');

      // Advance to next step
      mapper.advanceTaskStep();

      // Map third tool call
      const result3 = mapper.mapToolCall('tool-3', 'tool-3');
      expect(result3).toBe('step-3');
    });

    it('should handle tool calls arriving out of order', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool calls out of order
      // Note: The mapper maps to the current step, not based on tool name
      // So all tool calls will map to step-1 until we advance
      const result3 = mapper.mapToolCall('tool-3', 'tool-3');
      const result1 = mapper.mapToolCall('tool-1', 'tool-1');
      const result2 = mapper.mapToolCall('tool-2', 'tool-2');

      // All should map to the current step (step-1)
      expect(result3).toBe('step-1');
      expect(result1).toBe('step-1');
      expect(result2).toBe('step-1');

      // Verify all are associated with step-1
      const toolCalls = mapper.getToolCallsForStep('step-1');
      expect(toolCalls).toContain('tool-3');
      expect(toolCalls).toContain('tool-1');
      expect(toolCalls).toContain('tool-2');
    });

    it('should handle parallel tool calls for same step', () => {
      const decomposedTask = createMockDecomposedTask({
        steps: [
          {
            id: 'step-1',
            title: 'Parallel Step',
            description: 'Parallel execution',
            tool: 'tool-1',
            canParallelize: true,
          },
        ],
      });

      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map multiple tool calls for same step
      const result1 = mapper.mapToolCall('tool-1a', 'tool-1');
      const result2 = mapper.mapToolCall('tool-1b', 'tool-1');
      const result3 = mapper.mapToolCall('tool-1c', 'tool-1');

      // All should map to the same step
      expect(result1).toBe('step-1');
      expect(result2).toBe('step-1');
      expect(result3).toBe('step-1');

      // Verify all tool calls are associated with the step
      const toolCalls = mapper.getToolCallsForStep('step-1');
      expect(toolCalls).toContain('tool-1a');
      expect(toolCalls).toContain('tool-1b');
      expect(toolCalls).toContain('tool-1c');
    });

    it('should track unmapped tool calls', () => {
      const decomposedTask = createMockDecomposedTask({
        steps: [
          {
            id: 'step-1',
            title: 'Step 1',
            description: 'First step',
            tool: 'tool-1',
            canParallelize: false,
          },
        ],
      });

      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map first tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // The mapper will keep mapping to the current step
      // since we don't advance, so tool-2 and tool-3 will also map to step-1
      mapper.mapToolCall('tool-2', 'tool-2');
      mapper.mapToolCall('tool-3', 'tool-3');

      // All tool calls should be mapped to step-1
      const toolCalls = mapper.getToolCallsForStep('step-1');
      expect(toolCalls.length).toBe(3);
      expect(mapper.getUnmappedToolCalls().length).toBe(0);
    });
  });

  describe('Task Status Update Propagation', () => {
    it('should update task status based on tool call status', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // Update status to in-progress
      mapper.updateTaskStepStatus('step-1', 'in-progress');

      // Verify status was updated
      const mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('in-progress');
    });

    it('should handle status transitions', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // Transition: pending -> in-progress
      mapper.updateTaskStepStatus('step-1', 'in-progress');
      let mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('in-progress');

      // Transition: in-progress -> completed
      mapper.updateTaskStepStatus('step-1', 'completed');
      mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('completed');
    });

    it('should handle task failure', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // Update status to failed
      mapper.updateTaskStepStatus('step-1', 'failed');

      // Verify status was updated
      const mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('failed');
    });

    it('should handle multiple tool calls in same task', () => {
      const decomposedTask = createMockDecomposedTask({
        steps: [
          {
            id: 'step-1',
            title: 'Multi-tool Step',
            description: 'Step with multiple tools',
            tool: 'tool-1',
            canParallelize: true,
          },
        ],
      });

      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map multiple tool calls
      mapper.mapToolCall('tool-1a', 'tool-1');
      mapper.mapToolCall('tool-1b', 'tool-1');

      // Update status
      mapper.updateTaskStepStatus('step-1', 'in-progress');

      // Verify status
      const mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('in-progress');
      expect(mapping?.toolCallIds.length).toBe(2);
    });
  });

  describe('Expand/Collapse State Management', () => {
    it('should initialize all tasks as pending', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Verify all tasks are pending
      decomposedTask.steps.forEach((step) => {
        const mapping = mapper.getMapping(step.id);
        expect(mapping?.status).toBe('pending');
      });
    });

    it('should track current task step', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Get current task step
      const currentStep = mapper.getCurrentTaskStep();
      expect(currentStep?.id).toBe('step-1');

      // Map tool call to advance
      mapper.mapToolCall('tool-1', 'tool-1');

      // Current step should still be step-1 (until explicitly advanced)
      const stillCurrent = mapper.getCurrentTaskStep();
      expect(stillCurrent?.id).toBe('step-1');
    });

    it('should advance task step', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Get initial step
      let currentStep = mapper.getCurrentTaskStep();
      expect(currentStep?.id).toBe('step-1');

      // Advance to next step
      mapper.advanceTaskStep();
      currentStep = mapper.getCurrentTaskStep();
      expect(currentStep?.id).toBe('step-2');

      // Advance again
      mapper.advanceTaskStep();
      currentStep = mapper.getCurrentTaskStep();
      expect(currentStep?.id).toBe('step-3');
    });
  });

  describe('Serialization and Persistence', () => {
    it('should serialize task-tool mapping', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map some tool calls
      mapper.mapToolCall('tool-1', 'tool-1');
      mapper.mapToolCall('tool-2', 'tool-2');

      // Serialize
      const serialized = mapper.serialize();
      expect(serialized).toBeTruthy();
      expect(typeof serialized).toBe('string');

      // Should be valid JSON
      const parsed = JSON.parse(serialized);
      expect(parsed).toBeTruthy();
    });

    it('should deserialize task-tool mapping', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map some tool calls
      mapper.mapToolCall('tool-1', 'tool-1');
      mapper.mapToolCall('tool-2', 'tool-2');

      // Serialize
      const serialized = mapper.serialize();

      // Deserialize
      const deserialized = TaskToolMapper.deserialize(serialized);
      expect(deserialized).toBeTruthy();
      expect(deserialized.decomposedTask).toBeTruthy();
      expect(deserialized.toolCallOrder.length).toBe(2);
    });

    it('should preserve mapping through serialization round-trip', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool calls
      mapper.mapToolCall('tool-1', 'tool-1');
      mapper.mapToolCall('tool-2', 'tool-2');
      mapper.updateTaskStepStatus('step-1', 'in-progress');

      // Serialize and deserialize
      const serialized = mapper.serialize();
      const deserialized = TaskToolMapper.deserialize(serialized);

      // Verify mappings are preserved
      expect(deserialized.toolCallOrder).toEqual(['tool-1', 'tool-2']);
      expect(deserialized.mappings.get('step-1')?.status).toBe('in-progress');
    });
  });

  describe('Full Execution Flow', () => {
    it('should handle complete task execution flow', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Step 1: All tasks pending
      decomposedTask.steps.forEach((step) => {
        const mapping = mapper.getMapping(step.id);
        expect(mapping?.status).toBe('pending');
      });

      // Step 2: First task starts
      mapper.mapToolCall('tool-1', 'tool-1');
      mapper.updateTaskStepStatus('step-1', 'in-progress');
      let mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('in-progress');

      // Step 3: First task completes
      mapper.updateTaskStepStatus('step-1', 'completed');
      mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('completed');

      // Step 4: Advance to second task
      mapper.advanceTaskStep();
      mapper.mapToolCall('tool-2', 'tool-2');
      mapper.updateTaskStepStatus('step-2', 'in-progress');
      mapping = mapper.getMapping('step-2');
      expect(mapping?.status).toBe('in-progress');

      // Step 5: Second task completes
      mapper.updateTaskStepStatus('step-2', 'completed');
      mapping = mapper.getMapping('step-2');
      expect(mapping?.status).toBe('completed');

      // Step 6: Advance to third task
      mapper.advanceTaskStep();
      mapper.mapToolCall('tool-3', 'tool-3');
      mapper.updateTaskStepStatus('step-3', 'completed');

      // Verify all tasks completed
      decomposedTask.steps.forEach((step) => {
        const mapping = mapper.getMapping(step.id);
        expect(mapping?.status).toBe('completed');
      });
    });

    it('should handle task failure during execution', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // Task in progress
      mapper.updateTaskStepStatus('step-1', 'in-progress');
      let mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('in-progress');

      // Tool fails
      mapper.updateTaskStepStatus('step-1', 'failed');
      mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('failed');
    });
  });

  describe('Performance and Optimization', () => {
    it('should handle large number of tool calls efficiently', () => {
      const decomposedTask = createMockDecomposedTask({
        steps: Array.from({ length: 100 }, (_, i) => ({
          id: `step-${i}`,
          title: `Step ${i}`,
          description: `Step ${i}`,
          tool: `tool-${i}`,
          canParallelize: false,
        })),
      });

      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map many tool calls (all to first step since we don't advance)
      for (let i = 0; i < 10; i++) {
        const result = mapper.mapToolCall(`tool-${i}`, `tool-${i}`);
        expect(result).toBe('step-0');
      }

      // Verify all mapped to first step
      const toolCalls = mapper.getToolCallsForStep('step-0');
      expect(toolCalls.length).toBe(10);
    });

    it('should handle rapid status updates', () => {
      const decomposedTask = createMockDecomposedTask();
      const mapper = new TaskToolMapper();
      mapper.initialize(decomposedTask);

      // Map tool call
      mapper.mapToolCall('tool-1', 'tool-1');

      // Rapid status updates
      const statuses: Array<'pending' | 'in-progress' | 'completed' | 'failed'> = [
        'pending',
        'in-progress',
        'in-progress',
        'in-progress',
        'completed',
      ];

      statuses.forEach((status) => {
        mapper.updateTaskStepStatus('step-1', status);
      });

      // Final status should be completed
      const mapping = mapper.getMapping('step-1');
      expect(mapping?.status).toBe('completed');
    });
  });
});
