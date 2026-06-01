/**
 * Type definitions for Task Decomposer Narrative UI
 *
 * This module defines all TypeScript interfaces and types used by the task decomposer
 * narrative UI feature, including task-to-tool mappings, component props, and state management.
 */

import type { DecomposedTask, TaskStep } from '../../../main/agent/runner/state';

/**
 * Display representation of a tool call in the UI
 */
export interface ToolCallDisplay {
  id: string;
  toolName: string;
  icon?: React.ReactNode;
  label?: string;
  color?: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  durationMs?: number;
  data?: any;
  base64Image?: string;
  args?: Record<string, unknown>;
  displayName?: string;
  description?: string;
  phase?: 'triage' | 'planning' | 'execution' | 'validation' | 'completion';
  thought?: string;
}

/**
 * Represents the mapping of a single task step to its tool calls
 */
export interface TaskToolMapping {
  taskStepId: string;
  toolCallIds: string[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  failureReason?: string;
}

/**
 * Complete state of the task-to-tool mapper
 */
export interface TaskToolMapperState {
  decomposedTask: DecomposedTask | null;
  mappings: Map<string, TaskToolMapping>;
  currentTaskStepIndex: number;
  toolCallOrder: string[];
  unmappedToolCalls: string[];
}

/**
 * Serializable version of TaskToolMapperState for persistence
 */
export interface SerializedTaskToolMapperState {
  decomposedTask: DecomposedTask | null;
  mappings: Array<[string, TaskToolMapping]>;
  currentTaskStepIndex: number;
  toolCallOrder: string[];
  unmappedToolCalls: string[];
}

/**
 * Props for TaskHeader component
 */
export interface TaskHeaderProps {
  task: TaskStep;
  toolCount: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  metadata?: {
    estimatedComplexity?: string;
    priority?: string;
    executionMode?: string;
  };
  isLast?: boolean;
}

/**
 * Props for TaskSection component
 */
export interface TaskSectionProps {
  task: TaskStep;
  toolCalls: ToolCallDisplay[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  isLast?: boolean;
  onToolCallClick?: (toolCall: ToolCallDisplay) => void;
}

/**
 * Props for ToolCallGroup component
 */
export interface ToolCallGroupProps {
  toolCalls: ToolCallDisplay[];
  isExpanded: boolean;
  canParallelize: boolean;
  isLast?: boolean;
  onToolCallClick?: (toolCall: ToolCallDisplay) => void;
}

/**
 * Props for TimelineRenderer component
 */
export interface TimelineRendererProps {
  toolCalls: ToolCallDisplay[];
  decomposedTask: DecomposedTask | null;
  thoughts?: Array<{ id: string; content: string }>;
  plans?: Array<{ steps: any[]; title?: string }>;
  isLive?: boolean;
  onPillClick?: (toolCall: ToolCallDisplay) => void;
}

/**
 * Task status type
 */
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

/**
 * Execution mode type
 */
export type ExecutionMode = 'sequential' | 'parallel' | 'hybrid';

/**
 * Complexity level type
 */
export type ComplexityLevel = 'simple' | 'moderate' | 'complex' | 'low' | 'medium' | 'high';

/**
 * Priority level type
 */
export type PriorityLevel = 'low' | 'normal' | 'critical';
