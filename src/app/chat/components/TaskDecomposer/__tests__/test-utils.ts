/**
 * Test utilities for Task Decomposer Narrative UI
 *
 * This module provides helper functions and factories for creating test data
 * and utilities for testing task decomposer components.
 */

import type { DecomposedTask, TaskStep } from '@/main/agent/runner/state';
import type { ToolCallDisplay, TaskToolMapping } from '../types';

/**
 * Create a mock TaskStep for testing
 */
export function createMockTaskStep(overrides?: Partial<TaskStep>): TaskStep {
  return {
    id: `step-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Task Step',
    description: 'A test task step',
    tool: 'test-tool',
    canParallelize: false,
    priority: 'normal',
    estimatedComplexity: 'simple',
    dependsOn: [],
    ...overrides,
  };
}

/**
 * Create a mock DecomposedTask for testing
 */
export function createMockDecomposedTask(
  stepCount: number = 3,
  overrides?: Partial<DecomposedTask>
): DecomposedTask {
  const steps = Array.from({ length: stepCount }, (_, i) =>
    createMockTaskStep({
      id: `step-${i}`,
      title: `Step ${i + 1}`,
      tool: `tool-${i}`,
    })
  );

  return {
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Decomposed Task',
    steps,
    totalSteps: stepCount,
    canParallelize: false,
    executionMode: 'sequential',
    estimatedDurationMs: 5000,
    ...overrides,
  };
}

/**
 * Create a mock ToolCallDisplay for testing
 */
export function createMockToolCall(overrides?: Partial<ToolCallDisplay>): ToolCallDisplay {
  return {
    id: `tool-call-${Math.random().toString(36).substr(2, 9)}`,
    toolName: 'test-tool',
    label: 'Test Tool',
    status: 'done',
    durationMs: 1000,
    ...overrides,
  };
}

/**
 * Create a mock TaskToolMapping for testing
 */
export function createMockTaskToolMapping(
  overrides?: Partial<TaskToolMapping>
): TaskToolMapping {
  return {
    taskStepId: `step-${Math.random().toString(36).substr(2, 9)}`,
    toolCallIds: [],
    status: 'pending',
    ...overrides,
  };
}

/**
 * Create multiple mock tool calls
 */
export function createMockToolCalls(count: number): ToolCallDisplay[] {
  return Array.from({ length: count }, (_, i) =>
    createMockToolCall({
      id: `tool-call-${i}`,
      toolName: `tool-${i}`,
      label: `Tool ${i}`,
    })
  );
}

/**
 * Create multiple mock task steps
 */
export function createMockTaskSteps(count: number): TaskStep[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTaskStep({
      id: `step-${i}`,
      title: `Step ${i + 1}`,
      tool: `tool-${i}`,
    })
  );
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout: number = 1000,
  interval: number = 50
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Create a random tool call ID
 */
export function randomToolCallId(): string {
  return `tool-call-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a random task step ID
 */
export function randomTaskStepId(): string {
  return `step-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a random tool name
 */
export function randomToolName(): string {
  const tools = ['web-search', 'code-execution', 'file-write', 'screenshot', 'computer-use'];
  return tools[Math.floor(Math.random() * tools.length)];
}

/**
 * Create a random status
 */
export function randomStatus(): 'pending' | 'in-progress' | 'completed' | 'failed' {
  const statuses: Array<'pending' | 'in-progress' | 'completed' | 'failed'> = [
    'pending',
    'in-progress',
    'completed',
    'failed',
  ];
  return statuses[Math.floor(Math.random() * statuses.length)];
}

/**
 * Create a random complexity level
 */
export function randomComplexity(): 'simple' | 'moderate' | 'complex' {
  const levels: Array<'simple' | 'moderate' | 'complex'> = ['simple', 'moderate', 'complex'];
  return levels[Math.floor(Math.random() * levels.length)];
}

/**
 * Create a random priority level
 */
export function randomPriority(): 'low' | 'normal' | 'critical' {
  const levels: Array<'low' | 'normal' | 'critical'> = ['low', 'normal', 'critical'];
  return levels[Math.floor(Math.random() * levels.length)];
}
