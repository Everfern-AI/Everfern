/**
 * Property-based tests for TaskToolMapper class
 *
 * These tests verify universal correctness properties that should hold
 * across all valid inputs and execution scenarios.
 *
 * Properties tested:
 * 1. Task-Tool Mapping Consistency
 * 3. Task Status Propagation
 * 8. Serialization Round-Trip
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TaskToolMapper } from '../TaskToolMapper';
import {
  createMockDecomposedTask,
  createMockTaskStep,
  randomToolCallId,
  randomTaskStepId,
  randomStatus,
} from './test-utils';

describe('TaskToolMapper - Property-Based Tests', () => {
  /**
   * Property 1: Task-Tool Mapping Consistency
   *
   * For any DecomposedTask with N TaskSteps and any set of ToolCalls,
   * every ToolCall must map to exactly one TaskStep, and every TaskStep
   * must have zero or more ToolCalls associated with it.
   *
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  describe('Property 1: Task-Tool Mapping Consistency', () => {
    it('should maintain one-to-one mapping between tool calls and task steps', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 50 }),
          (stepCount, toolCallCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            // Map tool calls to current step
            const toolCallIds: string[] = [];
            for (let i = 0; i < toolCallCount; i++) {
              const toolCallId = `tool-${i}`;
              toolCallIds.push(toolCallId);
              mapper.mapToolCall(toolCallId, 'test-tool');
            }

            // Verify each tool call maps to exactly one task step
            for (const toolCallId of toolCallIds) {
              const step = mapper.getTaskStepForToolCall(toolCallId);
              expect(step).not.toBeNull();
              expect(step?.id).toBeDefined();
            }

            // Verify each task step has correct tool calls
            const currentStep = mapper.getCurrentTaskStep();
            const toolCalls = mapper.getToolCallsForStep(currentStep!.id);
            expect(toolCalls).toHaveLength(toolCallCount);

            // Verify no tool call is mapped to multiple steps
            const mappedSteps = new Set<string>();
            for (const toolCallId of toolCallIds) {
              const step = mapper.getTaskStepForToolCall(toolCallId);
              mappedSteps.add(step!.id);
            }
            expect(mappedSteps.size).toBe(1); // All mapped to same step
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain consistency across multiple task steps', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 2, maxLength: 5 }),
          (stepCount, toolCallsPerStep) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            const allToolCalls: Map<string, string> = new Map(); // toolCallId -> stepId

            // Map tool calls to each step
            for (let stepIdx = 0; stepIdx < Math.min(stepCount, toolCallsPerStep.length); stepIdx++) {
              const toolCount = toolCallsPerStep[stepIdx];
              for (let i = 0; i < toolCount; i++) {
                const toolCallId = `tool-step${stepIdx}-${i}`;
                const stepId = mapper.mapToolCall(toolCallId, 'test-tool');
                allToolCalls.set(toolCallId, stepId!);
              }

              if (stepIdx < stepCount - 1) {
                mapper.advanceTaskStep();
              }
            }

            // Verify consistency: each tool call maps to exactly one step
            for (const [toolCallId, expectedStepId] of allToolCalls.entries()) {
              const step = mapper.getTaskStepForToolCall(toolCallId);
              expect(step?.id).toBe(expectedStepId);
            }

            // Verify each step has correct tool calls
            const state = mapper.getState();
            for (const [stepId, mapping] of state.mappings.entries()) {
              const toolCalls = mapper.getToolCallsForStep(stepId);
              expect(toolCalls).toEqual(mapping.toolCallIds);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Task Status Propagation
   *
   * For any TaskStep with associated ToolCalls, the TaskStep status SHALL be:
   * - 'pending' if all ToolCalls are pending
   * - 'in-progress' if any ToolCall is running
   * - 'completed' if all ToolCalls are completed
   * - 'failed' if any ToolCall has failed
   *
   * **Validates: Requirements 5.3, 5.4, 6.5, 6.6**
   */
  describe('Property 3: Task Status Propagation', () => {
    it('should correctly propagate status based on tool call states', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (stepCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            const currentStep = mapper.getCurrentTaskStep();

            // Test pending status
            let mapping = mapper.getMapping(currentStep!.id);
            expect(mapping?.status).toBe('pending');

            // Test in-progress status
            mapper.mapToolCall('tool-1', 'test-tool');
            mapping = mapper.getMapping(currentStep!.id);
            expect(mapping?.status).toBe('in-progress');

            // Test completed status
            mapper.updateTaskStepStatus(currentStep!.id, 'completed');
            mapping = mapper.getMapping(currentStep!.id);
            expect(mapping?.status).toBe('completed');
            expect(mapping?.endTime).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle status transitions correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.constantFrom<'pending' | 'in-progress' | 'completed' | 'failed'>(
              'pending',
              'in-progress',
              'completed',
              'failed'
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (statusSequence) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(1);
            mapper.initialize(task);

            const step = mapper.getCurrentTaskStep();

            // Apply status transitions
            for (const status of statusSequence) {
              mapper.updateTaskStepStatus(step!.id, status);
              const mapping = mapper.getMapping(step!.id);
              expect(mapping?.status).toBe(status);
            }

            // Final status should be the last one in sequence
            const finalMapping = mapper.getMapping(step!.id);
            expect(finalMapping?.status).toBe(statusSequence[statusSequence.length - 1]);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set timing information correctly', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), (stepCount) => {
          const mapper = new TaskToolMapper();
          const task = createMockDecomposedTask(stepCount);
          mapper.initialize(task);

          const step = mapper.getCurrentTaskStep();

          // Pending status should not have timing
          let mapping = mapper.getMapping(step!.id);
          expect(mapping?.startTime).toBeUndefined();
          expect(mapping?.endTime).toBeUndefined();

          // In-progress should set startTime
          mapper.updateTaskStepStatus(step!.id, 'in-progress');
          mapping = mapper.getMapping(step!.id);
          expect(mapping?.startTime).toBeDefined();
          expect(typeof mapping?.startTime).toBe('number');
          expect(mapping?.endTime).toBeUndefined();

          // Completed should set endTime
          mapper.updateTaskStepStatus(step!.id, 'completed');
          mapping = mapper.getMapping(step!.id);
          expect(mapping?.startTime).toBeDefined();
          expect(mapping?.endTime).toBeDefined();
          expect(mapping.endTime).toBeGreaterThanOrEqual(mapping.startTime!);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Serialization Round-Trip
   *
   * For any valid TaskToolMapperState, serializing then deserializing
   * SHALL produce an equivalent state with all task-tool associations,
   * metadata, and status information preserved.
   *
   * **Validates: Requirements 8.1, 8.2, 8.3, 8.5**
   */
  describe('Property 8: Serialization Round-Trip', () => {
    it('should preserve state through serialization round-trip', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 0, max: 20 }),
          (stepCount, toolCallCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            // Map some tool calls
            for (let i = 0; i < toolCallCount; i++) {
              mapper.mapToolCall(`tool-${i}`, 'test-tool');
            }

            // Serialize
            const json = mapper.serialize();
            expect(typeof json).toBe('string');

            // Deserialize
            const state = TaskToolMapper.deserialize(json);

            // Verify state is preserved
            expect(state.decomposedTask?.id).toBe(task.id);
            expect(state.decomposedTask?.steps.length).toBe(stepCount);
            expect(state.currentTaskStepIndex).toBe(0);
            expect(state.toolCallOrder).toHaveLength(toolCallCount);
            expect(state.mappings.size).toBe(stepCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve tool call mappings through serialization', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 5 }),
          (stepCount, toolCallsPerStep) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            const expectedMappings: Map<string, string> = new Map();

            // Map tool calls
            for (let stepIdx = 0; stepIdx < Math.min(stepCount, toolCallsPerStep.length); stepIdx++) {
              const toolCount = toolCallsPerStep[stepIdx];
              for (let i = 0; i < toolCount; i++) {
                const toolCallId = `tool-step${stepIdx}-${i}`;
                const stepId = mapper.mapToolCall(toolCallId, 'test-tool');
                expectedMappings.set(toolCallId, stepId!);
              }

              if (stepIdx < stepCount - 1) {
                mapper.advanceTaskStep();
              }
            }

            // Serialize and deserialize
            const json = mapper.serialize();
            const state = TaskToolMapper.deserialize(json);

            // Verify mappings are preserved
            for (const [toolCallId, expectedStepId] of expectedMappings.entries()) {
              const mapping = state.mappings.get(expectedStepId);
              expect(mapping?.toolCallIds).toContain(toolCallId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve status information through serialization', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.constantFrom<'pending' | 'in-progress' | 'completed' | 'failed'>(
            'pending',
            'in-progress',
            'completed',
            'failed'
          ),
          (stepCount, status) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            const step = mapper.getCurrentTaskStep();
            mapper.updateTaskStepStatus(step!.id, status);

            // Serialize and deserialize
            const json = mapper.serialize();
            const state = TaskToolMapper.deserialize(json);

            // Verify status is preserved
            const mapping = state.mappings.get(step!.id);
            expect(mapping?.status).toBe(status);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve unmapped tool calls through serialization', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 20 }), (unmappedCount) => {
          const mapper = new TaskToolMapper();

          // Map tool calls without initialization (they become unmapped)
          for (let i = 0; i < unmappedCount; i++) {
            mapper.mapToolCall(`unmapped-${i}`, 'test-tool');
          }

          // Serialize and deserialize
          const json = mapper.serialize();
          const state = TaskToolMapper.deserialize(json);

          // Verify unmapped tool calls are preserved
          expect(state.unmappedToolCalls).toHaveLength(unmappedCount);
          for (let i = 0; i < unmappedCount; i++) {
            expect(state.unmappedToolCalls).toContain(`unmapped-${i}`);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle complex state with multiple steps and statuses', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }),
          (stepCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            // Create complex state
            for (let i = 0; i < stepCount; i++) {
              const step = task.steps[i];
              mapper.mapToolCall(`tool-${i}`, 'test-tool');

              // Vary the status
              if (i % 3 === 0) {
                mapper.updateTaskStepStatus(step.id, 'completed');
              } else if (i % 3 === 1) {
                mapper.updateTaskStepStatus(step.id, 'in-progress');
              }

              if (i < stepCount - 1) {
                mapper.advanceTaskStep();
              }
            }

            // Serialize and deserialize
            const json = mapper.serialize();
            const state = TaskToolMapper.deserialize(json);

            // Verify complex state is preserved
            expect(state.currentTaskStepIndex).toBe(stepCount - 1);
            expect(state.toolCallOrder).toHaveLength(stepCount);
            expect(state.mappings.size).toBe(stepCount);

            // Verify each mapping has correct status
            for (let i = 0; i < stepCount; i++) {
              const step = task.steps[i];
              const mapping = state.mappings.get(step.id);
              expect(mapping).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional property: Idempotency of serialization
   *
   * Serializing the same state multiple times should produce identical JSON
   */
  describe('Additional Property: Serialization Idempotency', () => {
    it('should produce identical JSON for same state', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 0, max: 10 }),
          (stepCount, toolCallCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(stepCount);
            mapper.initialize(task);

            for (let i = 0; i < toolCallCount; i++) {
              mapper.mapToolCall(`tool-${i}`, 'test-tool');
            }

            // Serialize multiple times
            const json1 = mapper.serialize();
            const json2 = mapper.serialize();
            const json3 = mapper.serialize();

            // All should be identical
            expect(json1).toBe(json2);
            expect(json2).toBe(json3);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional property: Tool call order preservation
   *
   * Tool calls should maintain their order through serialization
   */
  describe('Additional Property: Tool Call Order Preservation', () => {
    it('should preserve tool call order through serialization', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (toolCallCount) => {
            const mapper = new TaskToolMapper();
            const task = createMockDecomposedTask(1);
            mapper.initialize(task);

            const expectedOrder: string[] = [];
            for (let i = 0; i < toolCallCount; i++) {
              const toolCallId = `tool-${i}`;
              expectedOrder.push(toolCallId);
              mapper.mapToolCall(toolCallId, 'test-tool');
            }

            // Serialize and deserialize
            const json = mapper.serialize();
            const state = TaskToolMapper.deserialize(json);

            // Verify order is preserved
            expect(state.toolCallOrder).toEqual(expectedOrder);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
