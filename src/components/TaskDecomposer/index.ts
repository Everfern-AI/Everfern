/**
 * Task Decomposer Narrative UI - Main Export
 *
 * This module exports all types, interfaces, and components for the task decomposer
 * narrative UI feature.
 */

// Type exports
export type {
  ToolCallDisplay,
  TaskToolMapping,
  TaskToolMapperState,
  SerializedTaskToolMapperState,
  TaskHeaderProps,
  TaskSectionProps,
  ToolCallGroupProps,
  TimelineRendererProps,
  TaskStatus,
  ExecutionMode,
  ComplexityLevel,
  PriorityLevel,
} from './types';

// Interface exports
export type { ITaskToolMapper } from './TaskToolMapper.interface';

// Class exports
export { TaskToolMapper } from './TaskToolMapper';

// Component exports (will be added as components are implemented)
export { TaskHeader } from './TaskHeader';
export { TaskSection } from './TaskSection';
export { ToolCallGroup } from './ToolCallGroup';
export { TimelineRenderer } from './TimelineRenderer';

// Test utilities export
export {
  createMockTaskStep,
  createMockDecomposedTask,
  createMockToolCall,
  createMockTaskToolMapping,
  createMockToolCalls,
  createMockTaskSteps,
  waitFor,
  randomToolCallId,
  randomTaskStepId,
  randomToolName,
  randomStatus,
  randomComplexity,
  randomPriority,
} from './__tests__/test-utils';
