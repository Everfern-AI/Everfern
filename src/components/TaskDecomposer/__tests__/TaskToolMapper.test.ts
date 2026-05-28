/**
 * Unit tests for TaskToolMapper class
 *
 * Tests cover:
 * - Initialization with decomposed tasks
 * - Tool call mapping to task steps
 * - Task step advancement
 * - Query methods (getToolCallsForStep, getTaskStepForToolCall)
 * - Status updates
 * - Serialization/deserialization
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskToolMapper } from '../TaskToolMapper';
import {
  createMockDecomposedTask,
  createMockTaskStep,
  createMockToolCall,
} from './test-utils';

describe('TaskToolMapper', () => {
  let mapper: TaskToolMapper;

  beforeEach(() => {
    mapper = new TaskToolMapper();
  });

  describe('initialization', () => {
    it('should initialize with a valid decomposed task', () => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);

      expect(mapper.getCurrentTaskStepIndex()).toBe(0);
      expect(mapper.getCurrentTaskStep()).toEqual(task.steps[0]);
      expect(mapper.getUnmappedToolCalls()).toHaveLength(0);
    });

    it('should throw error when initializing with null decomposed task', () => {
      expect(() => mapper.initialize(null as any)).toThrow('DecomposedTask cannot be null');
    });

    it('should throw error when initializing with empty steps', () => {
      const task = createMockDecomposedTask(0);
      expect(() => mapper.initialize(task)).toThrow('DecomposedTask must have at least one step');
    });

    it('should create mappings for all task steps', () => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);

      const mappings = mapper.getAllMappings();
      expect(mappings.size).toBe(3);

      for (const step of task.steps) {
        const mapping = mappings.get(step.id);
        expect(mapping).toBeDefined();
        expect(mapping?.status).toBe('pending');
        expect(mapping?.toolCallIds).toHaveLength(0);
      }
    });

    it('should reset state when re-initializing', () => {
      const task1 = createMockDecomposedTask(2);
      mapper.initialize(task1);
      mapper.mapToolCall('tool-1', 'test-tool');

      const task2 = createMockDecomposedTask(3);
      mapper.initialize(task2);

      expect(mapper.getCurrentTaskStepIndex()).toBe(0);
      expect(mapper.getUnmappedToolCalls()).toHaveLength(0);
      expect(mapper.getAllMappings().size).toBe(3);
    });
  });

  describe('mapToolCall', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should map tool call to current task step', () => {
      const stepId = mapper.mapToolCall('tool-1', 'test-tool');

      expect(stepId).toBe(mapper.getCurrentTaskStep()?.id);
      expect(mapper.isToolCallMapped('tool-1')).toBe(true);
    });

    it('should add tool call to task step mapping', () => {
      const currentStep = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');

      const toolCalls = mapper.getToolCallsForStep(currentStep!.id);
      expect(toolCalls).toContain('tool-1');
    });

    it('should update task step status to in-progress', () => {
      const currentStep = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');

      const mapping = mapper.getMapping(currentStep!.id);
      expect(mapping?.status).toBe('in-progress');
    });

    it('should handle multiple tool calls for same step', () => {
      const currentStep = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.mapToolCall('tool-2', 'test-tool');

      const toolCalls = mapper.getToolCallsForStep(currentStep!.id);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls).toContain('tool-1');
      expect(toolCalls).toContain('tool-2');
    });

    it('should not remap already mapped tool call', () => {
      const currentStep = mapper.getCurrentTaskStep();
      const stepId1 = mapper.mapToolCall('tool-1', 'test-tool');
      const stepId2 = mapper.mapToolCall('tool-1', 'test-tool');

      expect(stepId1).toBe(stepId2);
      const toolCalls = mapper.getToolCallsForStep(currentStep!.id);
      expect(toolCalls).toHaveLength(1);
    });

    it('should add to unmapped when not initialized', () => {
      const newMapper = new TaskToolMapper();
      const result = newMapper.mapToolCall('tool-1', 'test-tool');

      expect(result).toBeNull();
      expect(newMapper.getUnmappedToolCalls()).toContain('tool-1');
    });

    it('should preserve tool call order', () => {
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.mapToolCall('tool-2', 'test-tool');
      mapper.mapToolCall('tool-3', 'test-tool');

      const state = mapper.getState();
      expect(state.toolCallOrder).toEqual(['tool-1', 'tool-2', 'tool-3']);
    });
  });

  describe('advanceTaskStep', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should advance to next task step', () => {
      const initialIndex = mapper.getCurrentTaskStepIndex();
      mapper.advanceTaskStep();

      expect(mapper.getCurrentTaskStepIndex()).toBe(initialIndex + 1);
    });

    it('should mark previous step as completed', () => {
      const currentStep = mapper.getCurrentTaskStep();
      mapper.advanceTaskStep();

      const mapping = mapper.getMapping(currentStep!.id);
      expect(mapping?.status).toBe('completed');
      expect(mapping?.endTime).toBeDefined();
    });

    it('should throw error when advancing past last step', () => {
      const task = mapper.getState().decomposedTask;
      const stepCount = task?.steps.length || 0;

      for (let i = 0; i < stepCount - 1; i++) {
        mapper.advanceTaskStep();
      }

      expect(() => mapper.advanceTaskStep()).toThrow('Already at the last task step');
    });

    it('should throw error when not initialized', () => {
      const newMapper = new TaskToolMapper();
      expect(() => newMapper.advanceTaskStep()).toThrow('TaskToolMapper not initialized');
    });

    it('should allow mapping tool calls to new step after advance', () => {
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.advanceTaskStep();

      const stepId = mapper.mapToolCall('tool-2', 'test-tool');
      expect(stepId).toBe(mapper.getCurrentTaskStep()?.id);
    });
  });

  describe('getToolCallsForStep', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should return empty array for step with no tool calls', () => {
      const step = mapper.getCurrentTaskStep();
      const toolCalls = mapper.getToolCallsForStep(step!.id);

      expect(toolCalls).toEqual([]);
    });

    it('should return all tool calls for a step', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.mapToolCall('tool-2', 'test-tool');

      const toolCalls = mapper.getToolCallsForStep(step!.id);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls).toContain('tool-1');
      expect(toolCalls).toContain('tool-2');
    });

    it('should return copy of tool calls array', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');

      const toolCalls1 = mapper.getToolCallsForStep(step!.id);
      const toolCalls2 = mapper.getToolCallsForStep(step!.id);

      expect(toolCalls1).toEqual(toolCalls2);
      expect(toolCalls1).not.toBe(toolCalls2);
    });

    it('should return empty array for non-existent step', () => {
      const toolCalls = mapper.getToolCallsForStep('non-existent-step');
      expect(toolCalls).toEqual([]);
    });
  });

  describe('getTaskStepForToolCall', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should return task step for mapped tool call', () => {
      mapper.mapToolCall('tool-1', 'test-tool');
      const step = mapper.getTaskStepForToolCall('tool-1');

      expect(step).toBeDefined();
      expect(step?.id).toBe(mapper.getCurrentTaskStep()?.id);
    });

    it('should return null for unmapped tool call', () => {
      const step = mapper.getTaskStepForToolCall('non-existent-tool');
      expect(step).toBeNull();
    });

    it('should return null when not initialized', () => {
      const newMapper = new TaskToolMapper();
      const step = newMapper.getTaskStepForToolCall('tool-1');
      expect(step).toBeNull();
    });

    it('should return correct step after advancing', () => {
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.advanceTaskStep();
      mapper.mapToolCall('tool-2', 'test-tool');

      const step1 = mapper.getTaskStepForToolCall('tool-1');
      const step2 = mapper.getTaskStepForToolCall('tool-2');

      expect(step1?.id).not.toBe(step2?.id);
    });
  });

  describe('updateTaskStepStatus', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should update task step status', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.updateTaskStepStatus(step!.id, 'in-progress');

      const mapping = mapper.getMapping(step!.id);
      expect(mapping?.status).toBe('in-progress');
    });

    it('should set startTime when transitioning to in-progress', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.updateTaskStepStatus(step!.id, 'in-progress');

      const mapping = mapper.getMapping(step!.id);
      expect(mapping?.startTime).toBeDefined();
      expect(typeof mapping?.startTime).toBe('number');
    });

    it('should set endTime when transitioning to completed', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.updateTaskStepStatus(step!.id, 'completed');

      const mapping = mapper.getMapping(step!.id);
      expect(mapping?.endTime).toBeDefined();
      expect(typeof mapping?.endTime).toBe('number');
    });

    it('should set endTime and failureReason when transitioning to failed', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.updateTaskStepStatus(step!.id, 'failed', 'Tool execution failed');

      const mapping = mapper.getMapping(step!.id);
      expect(mapping?.status).toBe('failed');
      expect(mapping?.endTime).toBeDefined();
      expect(mapping?.failureReason).toBe('Tool execution failed');
    });

    it('should not update non-existent step', () => {
      mapper.updateTaskStepStatus('non-existent-step', 'completed');
      // Should not throw, just silently fail
      expect(true).toBe(true);
    });

    it('should not set startTime multiple times', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.updateTaskStepStatus(step!.id, 'in-progress');
      const mapping1 = mapper.getMapping(step!.id);
      const startTime1 = mapping1?.startTime;

      mapper.updateTaskStepStatus(step!.id, 'in-progress');
      const mapping2 = mapper.getMapping(step!.id);
      const startTime2 = mapping2?.startTime;

      expect(startTime1).toBe(startTime2);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize empty mapper', () => {
      const task = createMockDecomposedTask(2);
      mapper.initialize(task);

      const json = mapper.serialize();
      const state = TaskToolMapper.deserialize(json);

      expect(state.decomposedTask).toEqual(task);
      expect(state.currentTaskStepIndex).toBe(0);
      expect(state.mappings.size).toBe(2);
      expect(state.toolCallOrder).toHaveLength(0);
      expect(state.unmappedToolCalls).toHaveLength(0);
    });

    it('should serialize and deserialize with mapped tool calls', () => {
      const task = createMockDecomposedTask(2);
      mapper.initialize(task);
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.mapToolCall('tool-2', 'test-tool');

      const json = mapper.serialize();
      const state = TaskToolMapper.deserialize(json);

      expect(state.toolCallOrder).toEqual(['tool-1', 'tool-2']);
      const mapping = state.mappings.get(task.steps[0].id);
      expect(mapping?.toolCallIds).toContain('tool-1');
      expect(mapping?.toolCallIds).toContain('tool-2');
    });

    it('should serialize and deserialize with status updates', () => {
      const task = createMockDecomposedTask(2);
      mapper.initialize(task);
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.updateTaskStepStatus(task.steps[0].id, 'completed');

      const json = mapper.serialize();
      const state = TaskToolMapper.deserialize(json);

      const mapping = state.mappings.get(task.steps[0].id);
      expect(mapping?.status).toBe('completed');
      expect(mapping?.endTime).toBeDefined();
    });

    it('should serialize and deserialize with advanced task step', () => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.advanceTaskStep();
      mapper.mapToolCall('tool-2', 'test-tool');

      const json = mapper.serialize();
      const state = TaskToolMapper.deserialize(json);

      expect(state.currentTaskStepIndex).toBe(1);
      expect(state.toolCallOrder).toEqual(['tool-1', 'tool-2']);
    });

    it('should throw error on invalid JSON', () => {
      expect(() => TaskToolMapper.deserialize('invalid json')).toThrow();
    });

    it('should throw error on missing required fields', () => {
      const invalidJson = JSON.stringify({
        decomposedTask: null,
        // missing mappings
        currentTaskStepIndex: 0,
      });

      expect(() => TaskToolMapper.deserialize(invalidJson)).toThrow();
    });

    it('should preserve unmapped tool calls during serialization', () => {
      const newMapper = new TaskToolMapper();
      newMapper.mapToolCall('tool-1', 'test-tool');

      const json = newMapper.serialize();
      const state = TaskToolMapper.deserialize(json);

      expect(state.unmappedToolCalls).toContain('tool-1');
    });
  });

  describe('query methods', () => {
    beforeEach(() => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
    });

    it('should return current task step', () => {
      const step = mapper.getCurrentTaskStep();
      expect(step).toBeDefined();
      expect(step?.id).toBe(mapper.getState().decomposedTask?.steps[0].id);
    });

    it('should return current task step index', () => {
      expect(mapper.getCurrentTaskStepIndex()).toBe(0);
      mapper.advanceTaskStep();
      expect(mapper.getCurrentTaskStepIndex()).toBe(1);
    });

    it('should check if tool call is mapped', () => {
      mapper.mapToolCall('tool-1', 'test-tool');

      expect(mapper.isToolCallMapped('tool-1')).toBe(true);
      expect(mapper.isToolCallMapped('tool-2')).toBe(false);
    });

    it('should return unmapped tool calls', () => {
      const newMapper = new TaskToolMapper();
      newMapper.mapToolCall('tool-1', 'test-tool');
      newMapper.mapToolCall('tool-2', 'test-tool');

      const unmapped = newMapper.getUnmappedToolCalls();
      expect(unmapped).toContain('tool-1');
      expect(unmapped).toContain('tool-2');
    });

    it('should return state', () => {
      mapper.mapToolCall('tool-1', 'test-tool');
      const state = mapper.getState();

      expect(state.decomposedTask).toBeDefined();
      expect(state.mappings).toBeInstanceOf(Map);
      expect(state.currentTaskStepIndex).toBe(0);
      expect(state.toolCallOrder).toContain('tool-1');
    });

    it('should return mapping for step', () => {
      const step = mapper.getCurrentTaskStep();
      mapper.mapToolCall('tool-1', 'test-tool');

      const mapping = mapper.getMapping(step!.id);
      expect(mapping).toBeDefined();
      expect(mapping?.toolCallIds).toContain('tool-1');
    });

    it('should return all mappings', () => {
      const mappings = mapper.getAllMappings();
      expect(mappings).toBeInstanceOf(Map);
      expect(mappings.size).toBe(3);
    });
  });

  describe('reset', () => {
    it('should reset mapper to initial state', () => {
      const task = createMockDecomposedTask(3);
      mapper.initialize(task);
      mapper.mapToolCall('tool-1', 'test-tool');
      mapper.advanceTaskStep();

      mapper.reset();

      expect(mapper.getCurrentTaskStep()).toBeNull();
      expect(mapper.getCurrentTaskStepIndex()).toBe(0);
      expect(mapper.getUnmappedToolCalls()).toHaveLength(0);
      expect(mapper.getAllMappings().size).toBe(0);
    });

    it('should allow re-initialization after reset', () => {
      const task1 = createMockDecomposedTask(2);
      mapper.initialize(task1);
      mapper.reset();

      const task2 = createMockDecomposedTask(3);
      mapper.initialize(task2);

      expect(mapper.getCurrentTaskStepIndex()).toBe(0);
      expect(mapper.getAllMappings().size).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle single step task', () => {
      const task = createMockDecomposedTask(1);
      mapper.initialize(task);

      mapper.mapToolCall('tool-1', 'test-tool');
      expect(mapper.isToolCallMapped('tool-1')).toBe(true);

      expect(() => mapper.advanceTaskStep()).toThrow('Already at the last task step');
    });

    it('should handle large number of tool calls', () => {
      const task = createMockDecomposedTask(1);
      mapper.initialize(task);

      for (let i = 0; i < 1000; i++) {
        mapper.mapToolCall(`tool-${i}`, 'test-tool');
      }

      const toolCalls = mapper.getToolCallsForStep(task.steps[0].id);
      expect(toolCalls).toHaveLength(1000);
    });

    it('should handle large number of task steps', () => {
      const task = createMockDecomposedTask(100);
      mapper.initialize(task);

      for (let i = 0; i < 99; i++) {
        mapper.advanceTaskStep();
      }

      expect(mapper.getCurrentTaskStepIndex()).toBe(99);
      expect(() => mapper.advanceTaskStep()).toThrow();
    });

    it('should handle rapid status updates', () => {
      const task = createMockDecomposedTask(1);
      mapper.initialize(task);
      const step = task.steps[0];

      mapper.updateTaskStepStatus(step.id, 'pending');
      mapper.updateTaskStepStatus(step.id, 'in-progress');
      mapper.updateTaskStepStatus(step.id, 'completed');

      const mapping = mapper.getMapping(step.id);
      expect(mapping?.status).toBe('completed');
    });
  });
});
