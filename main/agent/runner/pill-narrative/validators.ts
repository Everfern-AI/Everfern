/**
 * Validators for Pill-Based Narrative Timeline
 *
 * This module provides validation functions for narrative structures,
 * ensuring data integrity and consistency.
 */

import {
  ExecutionStatus,
  ToolPill,
  Task,
  NarrativeTimeline,
  ValidationError,
  ValidationResult,
} from './types';

/**
 * Valid status transitions in the state machine
 */
const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  pending: ['in-progress', 'skipped'],
  'in-progress': ['completed', 'failed'],
  completed: [],
  failed: [],
  skipped: [],
};

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  currentStatus: ExecutionStatus,
  newStatus: ExecutionStatus
): boolean {
  if (currentStatus === newStatus) {
    return true; // No-op transitions are always valid
  }
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

/**
 * Validate a single tool pill
 */
export function validatePill(pill: ToolPill): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check required fields
  if (!pill.id) {
    errors.push({
      type: 'missing_field',
      message: 'Pill must have an id',
      elementId: pill.id,
    });
  }

  if (!pill.toolName || pill.toolName.trim().length === 0) {
    errors.push({
      type: 'missing_field',
      message: 'Pill must have a toolName',
      elementId: pill.id,
    });
  }

  // Check status is valid
  const validStatuses: ExecutionStatus[] = ['pending', 'in-progress', 'completed', 'failed', 'skipped'];
  if (!validStatuses.includes(pill.status)) {
    errors.push({
      type: 'invalid_status',
      message: `Invalid status: ${pill.status}`,
      elementId: pill.id,
    });
  }

  return errors;
}

/**
 * Validate a task
 */
export function validateTask(task: Task): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check required fields
  if (!task.id) {
    errors.push({
      type: 'missing_field',
      message: 'Task must have an id',
      elementId: task.id,
    });
  }

  if (!task.title || task.title.trim().length === 0) {
    errors.push({
      type: 'missing_field',
      message: 'Task must have a non-empty title',
      elementId: task.id,
    });
  }

  // Check status is valid
  const validStatuses: ExecutionStatus[] = ['pending', 'in-progress', 'completed', 'failed', 'skipped'];
  if (!validStatuses.includes(task.status)) {
    errors.push({
      type: 'invalid_status',
      message: `Invalid status: ${task.status}`,
      elementId: task.id,
    });
  }

  // Validate all pills in the task
  for (const pill of task.pills) {
    const pillErrors = validatePill(pill);
    errors.push(...pillErrors);
  }

  // Check for circular dependencies
  const circularDeps = findCircularDependencies(task.pills);
  errors.push(...circularDeps);

  return errors;
}

/**
 * Validate a complete narrative timeline
 */
export function validateTimeline(timeline: NarrativeTimeline): ValidationResult {
  const errors: ValidationError[] = [];

  // Check required fields
  if (!timeline.missionId) {
    errors.push({
      type: 'missing_field',
      message: 'Timeline must have a missionId',
    });
  }

  // Check status is valid
  const validStatuses: ExecutionStatus[] = ['pending', 'in-progress', 'completed', 'failed', 'skipped'];
  if (!validStatuses.includes(timeline.status)) {
    errors.push({
      type: 'invalid_status',
      message: `Invalid status: ${timeline.status}`,
    });
  }

  // Validate all tasks
  for (const task of timeline.tasks) {
    const taskErrors = validateTask(task);
    errors.push(...taskErrors);
  }

  // Validate status consistency
  const statusErrors = validateStatusConsistency(timeline);
  errors.push(...statusErrors);

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Find circular dependencies in pills
 */
function findCircularDependencies(pills: ToolPill[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(pillId: string): boolean {
    visited.add(pillId);
    recursionStack.add(pillId);

    const pill = pills.find((p) => p.id === pillId);
    if (!pill || !pill.dependsOn) {
      recursionStack.delete(pillId);
      return false;
    }

    for (const depId of pill.dependsOn) {
      if (!visited.has(depId)) {
        if (hasCycle(depId)) {
          return true;
        }
      } else if (recursionStack.has(depId)) {
        return true;
      }
    }

    recursionStack.delete(pillId);
    return false;
  }

  for (const pill of pills) {
    if (!visited.has(pill.id)) {
      if (hasCycle(pill.id)) {
        errors.push({
          type: 'circular_dependency',
          message: `Circular dependency detected involving pill ${pill.id}`,
          elementId: pill.id,
        });
      }
    }
  }

  return errors;
}

/**
 * Validate that status is consistent with children
 */
function validateStatusConsistency(timeline: NarrativeTimeline): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const task of timeline.tasks) {
    const expectedStatus = calculateTaskStatus(task.pills);
    if (task.status !== expectedStatus) {
      errors.push({
        type: 'invalid_status',
        message: `Task ${task.id} status mismatch: expected ${expectedStatus}, got ${task.status}`,
        elementId: task.id,
      });
    }
  }

  return errors;
}

/**
 * Calculate the expected status of a task based on its pills
 */
export function calculateTaskStatus(pills: ToolPill[]): ExecutionStatus {
  if (pills.length === 0) {
    return 'pending';
  }

  const statuses = pills.map((p) => p.status);

  // If any pill failed, task fails
  if (statuses.some((s) => s === 'failed')) {
    return 'failed';
  }

  // If any pill is in-progress, task is in-progress
  if (statuses.some((s) => s === 'in-progress')) {
    return 'in-progress';
  }

  // If all pills are completed, task is completed
  if (statuses.every((s) => s === 'completed')) {
    return 'completed';
  }

  // If all pills are skipped, task is skipped
  if (statuses.every((s) => s === 'skipped')) {
    return 'skipped';
  }

  // Otherwise, task is pending
  return 'pending';
}

/**
 * Calculate the expected status of a timeline based on its tasks
 */
export function calculateTimelineStatus(tasks: Task[]): ExecutionStatus {
  if (tasks.length === 0) {
    return 'pending';
  }

  const statuses = tasks.map((t) => t.status);

  // If any task failed, timeline fails
  if (statuses.some((s) => s === 'failed')) {
    return 'failed';
  }

  // If any task is in-progress, timeline is in-progress
  if (statuses.some((s) => s === 'in-progress')) {
    return 'in-progress';
  }

  // If all tasks are completed, timeline is completed
  if (statuses.every((s) => s === 'completed')) {
    return 'completed';
  }

  // If all tasks are skipped, timeline is skipped
  if (statuses.every((s) => s === 'skipped')) {
    return 'skipped';
  }

  // Otherwise, timeline is pending
  return 'pending';
}

/**
 * Check if all pills in a task have completed
 */
export function allPillsCompleted(pills: ToolPill[]): boolean {
  return pills.length > 0 && pills.every((p) => p.status === 'completed');
}

/**
 * Check if any pill in a task has failed
 */
export function anyPillFailed(pills: ToolPill[]): boolean {
  return pills.some((p) => p.status === 'failed');
}

/**
 * Get parallelizable pills (those with no dependencies)
 */
export function getParallelizablePills(pills: ToolPill[]): ToolPill[] {
  return pills.filter((p) => !p.dependsOn || p.dependsOn.length === 0);
}

/**
 * Check if a pill can execute (all dependencies completed)
 */
export function canExecutePill(pill: ToolPill, allPills: ToolPill[]): boolean {
  if (!pill.dependsOn || pill.dependsOn.length === 0) {
    return true;
  }

  return pill.dependsOn.every((depId) => {
    const depPill = allPills.find((p) => p.id === depId);
    return depPill && depPill.status === 'completed';
  });
}
