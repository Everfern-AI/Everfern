/**
 * Utility functions for Task Decomposer Narrative UI
 *
 * This module provides helper functions used throughout the task decomposer feature,
 * including validation, formatting, and state management utilities.
 */

import type { DecomposedTask, TaskStep } from '@/main/agent/runner/state';
import type { ToolCallDisplay, TaskStatus } from './types';
import { ERROR_MESSAGES, PATTERNS } from './constants';

/**
 * Validate a decomposed task
 */
export function isValidDecomposedTask(task: any): task is DecomposedTask {
  if (!task || typeof task !== 'object') {
    return false;
  }

  const { id, title, steps, totalSteps, canParallelize, executionMode } = task;

  // Check required fields
  if (typeof id !== 'string' || !id.trim()) {
    return false;
  }

  if (typeof title !== 'string' || !title.trim()) {
    return false;
  }

  if (!Array.isArray(steps)) {
    return false;
  }

  if (typeof totalSteps !== 'number' || totalSteps < 0) {
    return false;
  }

  if (typeof canParallelize !== 'boolean') {
    return false;
  }

  if (typeof executionMode !== 'string' || !executionMode.trim()) {
    return false;
  }

  // Check that all steps are valid
  return steps.every(step => isValidTaskStep(step));
}

/**
 * Validate a task step
 */
export function isValidTaskStep(step: any): step is TaskStep {
  if (!step || typeof step !== 'object') {
    return false;
  }

  const { id, description, tool, canParallelize } = step;

  // Check required fields
  if (typeof id !== 'string' || !id.trim()) {
    return false;
  }

  if (typeof description !== 'string' || !description.trim()) {
    return false;
  }

  if (typeof tool !== 'string' || !tool.trim()) {
    return false;
  }

  if (typeof canParallelize !== 'boolean') {
    return false;
  }

  return true;
}

/**
 * Validate a tool call display
 */
export function isValidToolCall(toolCall: any): toolCall is ToolCallDisplay {
  if (!toolCall || typeof toolCall !== 'object') {
    return false;
  }

  const { id, toolName, status } = toolCall;

  // Check required fields
  if (typeof id !== 'string' || !id.trim()) {
    return false;
  }

  if (typeof toolName !== 'string' || !toolName.trim()) {
    return false;
  }

  if (!['running', 'done', 'error'].includes(status)) {
    return false;
  }

  return true;
}

/**
 * Validate a tool call ID
 */
export function isValidToolCallId(id: string): boolean {
  return typeof id === 'string' && PATTERNS.TOOL_CALL_ID.test(id);
}

/**
 * Validate a task step ID
 */
export function isValidTaskStepId(id: string): boolean {
  return typeof id === 'string' && PATTERNS.TASK_STEP_ID.test(id);
}

/**
 * Validate a tool name
 */
export function isValidToolName(name: string): boolean {
  return typeof name === 'string' && PATTERNS.TOOL_NAME.test(name);
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
}

/**
 * Get the status color for a task status
 */
export function getStatusColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    pending: '#f3f4f6',
    'in-progress': '#dbeafe',
    completed: '#dcfce7',
    failed: '#fee2e2',
  };

  return colors[status] || colors.pending;
}

/**
 * Get the status text color for a task status
 */
export function getStatusTextColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    pending: '#6b7280',
    'in-progress': '#0284c7',
    completed: '#16a34a',
    failed: '#dc2626',
  };

  return colors[status] || colors.pending;
}

/**
 * Get the status border color for a task status
 */
export function getStatusBorderColor(status: TaskStatus): string {
  const colors: Record<TaskStatus, string> = {
    pending: '#d1d5db',
    'in-progress': '#0284c7',
    completed: '#16a34a',
    failed: '#dc2626',
  };

  return colors[status] || colors.pending;
}

/**
 * Get a human-readable label for a task status
 */
export function getStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    pending: 'Pending',
    'in-progress': 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
  };

  return labels[status] || 'Unknown';
}

/**
 * Get a human-readable label for a complexity level
 */
export function getComplexityLabel(complexity?: string): string {
  if (!complexity) {
    return 'Unknown';
  }

  const labels: Record<string, string> = {
    simple: 'Simple',
    moderate: 'Moderate',
    complex: 'Complex',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };

  return labels[complexity] || complexity;
}

/**
 * Get a human-readable label for a priority level
 */
export function getPriorityLabel(priority?: string): string {
  if (!priority) {
    return 'Normal';
  }

  const labels: Record<string, string> = {
    low: 'Low',
    normal: 'Normal',
    critical: 'Critical',
  };

  return labels[priority] || priority;
}

/**
 * Get a human-readable label for an execution mode
 */
export function getExecutionModeLabel(mode?: string): string {
  if (!mode) {
    return 'Sequential';
  }

  const labels: Record<string, string> = {
    sequential: 'Sequential',
    parallel: 'Parallel',
    hybrid: 'Hybrid',
  };

  return labels[mode] || mode;
}

/**
 * Calculate the total number of tool calls for a decomposed task
 */
export function calculateTotalToolCalls(decomposedTask: DecomposedTask): number {
  return decomposedTask.steps.length;
}

/**
 * Calculate the number of completed tool calls
 */
export function calculateCompletedToolCalls(toolCalls: ToolCallDisplay[]): number {
  return toolCalls.filter(tc => tc.status === 'done').length;
}

/**
 * Calculate the number of failed tool calls
 */
export function calculateFailedToolCalls(toolCalls: ToolCallDisplay[]): number {
  return toolCalls.filter(tc => tc.status === 'error').length;
}

/**
 * Calculate the number of running tool calls
 */
export function calculateRunningToolCalls(toolCalls: ToolCallDisplay[]): number {
  return toolCalls.filter(tc => tc.status === 'running').length;
}

/**
 * Determine the overall status of a task based on its tool calls
 */
export function determineTaskStatus(toolCalls: ToolCallDisplay[]): TaskStatus {
  if (toolCalls.length === 0) {
    return 'pending';
  }

  const hasError = toolCalls.some(tc => tc.status === 'error');
  if (hasError) {
    return 'failed';
  }

  const hasRunning = toolCalls.some(tc => tc.status === 'running');
  if (hasRunning) {
    return 'in-progress';
  }

  const allDone = toolCalls.every(tc => tc.status === 'done');
  if (allDone) {
    return 'completed';
  }

  return 'pending';
}

/**
 * Create a summary string for a task with tool calls
 */
export function createTaskSummary(toolCalls: ToolCallDisplay[]): string {
  const completed = calculateCompletedToolCalls(toolCalls);
  const running = calculateRunningToolCalls(toolCalls);
  const failed = calculateFailedToolCalls(toolCalls);

  const parts: string[] = [];

  if (completed > 0) {
    parts.push(`${completed} done`);
  }

  if (running > 0) {
    parts.push(`${running} running`);
  }

  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  if (parts.length === 0) {
    return `${toolCalls.length} pending`;
  }

  return parts.join(', ');
}

/**
 * Deep clone a decomposed task
 */
export function cloneDecomposedTask(task: DecomposedTask): DecomposedTask {
  return {
    ...task,
    steps: task.steps.map(step => ({ ...step })),
  };
}

/**
 * Deep clone a tool call display
 */
export function cloneToolCall(toolCall: ToolCallDisplay): ToolCallDisplay {
  return {
    ...toolCall,
    args: toolCall.args ? { ...toolCall.args } : undefined,
    data: toolCall.data ? { ...toolCall.data } : undefined,
  };
}

/**
 * Merge two decomposed tasks (for combining results)
 */
export function mergeDecomposedTasks(
  task1: DecomposedTask,
  task2: DecomposedTask
): DecomposedTask {
  return {
    id: task1.id,
    title: task1.title,
    steps: [...task1.steps, ...task2.steps],
    totalSteps: task1.totalSteps + task2.totalSteps,
    canParallelize: task1.canParallelize && task2.canParallelize,
    executionMode: 'hybrid',
    estimatedDurationMs:
      (task1.estimatedDurationMs || 0) + (task2.estimatedDurationMs || 0),
  };
}

/**
 * Filter tool calls by status
 */
export function filterToolCallsByStatus(
  toolCalls: ToolCallDisplay[],
  status: ToolCallDisplay['status']
): ToolCallDisplay[] {
  return toolCalls.filter(tc => tc.status === status);
}

/**
 * Sort tool calls by duration (descending)
 */
export function sortToolCallsByDuration(toolCalls: ToolCallDisplay[]): ToolCallDisplay[] {
  return [...toolCalls].sort((a, b) => {
    const durationA = a.durationMs || 0;
    const durationB = b.durationMs || 0;
    return durationB - durationA;
  });
}

/**
 * Calculate total duration of all tool calls
 */
export function calculateTotalDuration(toolCalls: ToolCallDisplay[]): number {
  return toolCalls.reduce((total, tc) => total + (tc.durationMs || 0), 0);
}

/**
 * Calculate average duration of tool calls
 */
export function calculateAverageDuration(toolCalls: ToolCallDisplay[]): number {
  if (toolCalls.length === 0) {
    return 0;
  }

  return calculateTotalDuration(toolCalls) / toolCalls.length;
}

/**
 * Debug logging utility
 */
export function debugLog(message: string, data?: any) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[TaskDecomposer] ${message}`, data);
  }
}

/**
 * Debug warning utility
 */
export function debugWarn(message: string, data?: any) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[TaskDecomposer] ${message}`, data);
  }
}

/**
 * Debug error utility
 */
export function debugError(message: string, error?: any) {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[TaskDecomposer] ${message}`, error);
  }
}
