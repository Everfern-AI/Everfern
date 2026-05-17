/**
 * Pill-Based Narrative Timeline Manager
 *
 * This module provides the core manager for pill-based narrative timelines.
 * It handles creation, updates, and event emission for task-based execution flows.
 */

import {
  NarrativeTimeline,
  ToolPill,
  Task,
  ExecutionStatus,
  ValidationResult,
} from './types';
import {
  validateTimeline,
  validatePill,
  validateTask,
  isValidStatusTransition,
  calculateTaskStatus,
  calculateTimelineStatus,
} from './validators';

/**
 * Callback types for timeline events
 */
export type TimelineUpdateCallback = (timeline: NarrativeTimeline) => void;
export type PillStatusChangeCallback = (pillId: string, newStatus: ExecutionStatus) => void;
export type TaskStatusChangeCallback = (taskId: string, newStatus: ExecutionStatus) => void;

/**
 * PillNarrativeTimelineManager manages the complete lifecycle of a pill-based narrative timeline.
 */
export class PillNarrativeTimelineManager {
  /** Map of mission IDs to their timelines */
  private timelines: Map<string, NarrativeTimeline> = new Map();

  /** Timeline update callbacks */
  private updateCallbacks: Map<string, Set<TimelineUpdateCallback>> = new Map();

  /** Pill status change callbacks */
  private pillStatusCallbacks: Map<string, Set<PillStatusChangeCallback>> = new Map();

  /** Task status change callbacks */
  private taskStatusCallbacks: Map<string, Set<TaskStatusChangeCallback>> = new Map();

  /**
   * Create a new timeline
   */
  create(missionId: string, timeline: NarrativeTimeline): void {
    if (this.timelines.has(missionId)) {
      throw new Error(`Timeline with missionId "${missionId}" already exists`);
    }

    // Validate the timeline
    const validation = validateTimeline(timeline);
    if (!validation.isValid) {
      throw new Error(`Invalid timeline: ${validation.errors.map((e) => e.message).join(', ')}`);
    }

    this.timelines.set(missionId, timeline);
    this.updateCallbacks.set(missionId, new Set());
    this.pillStatusCallbacks.set(missionId, new Set());
    this.taskStatusCallbacks.set(missionId, new Set());

    this.emitTimelineUpdate(missionId);
  }

  /**
   * Get a timeline
   */
  getTimeline(missionId: string): NarrativeTimeline | null {
    return this.timelines.get(missionId) || null;
  }

  /**
   * Get all timelines
   */
  getAllTimelines(): NarrativeTimeline[] {
    return Array.from(this.timelines.values());
  }

  /**
   * Update a pill's status
   */
  updatePillStatus(
    missionId: string,
    taskId: string,
    pillId: string,
    newStatus: ExecutionStatus,
    result?: string,
    error?: string
  ): void {
    const timeline = this.getTimeline(missionId);
    if (!timeline) {
      throw new Error(`Timeline with missionId "${missionId}" not found`);
    }

    const task = timeline.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task with id "${taskId}" not found`);
    }

    const pill = task.pills.find((p) => p.id === pillId);
    if (!pill) {
      throw new Error(`Pill with id "${pillId}" not found`);
    }

    // Validate status transition
    if (!isValidStatusTransition(pill.status, newStatus)) {
      throw new Error(
        `Invalid status transition for pill ${pillId}: ${pill.status} → ${newStatus}`
      );
    }

    const previousStatus = pill.status;
    pill.status = newStatus;

    // Update result/error
    if (result !== undefined) {
      pill.result = result;
    }
    if (error !== undefined) {
      pill.error = error;
    }

    // Update timing
    if (newStatus === 'in-progress' && !pill.startTime) {
      pill.startTime = Date.now();
    }
    if ((newStatus === 'completed' || newStatus === 'failed' || newStatus === 'skipped') && !pill.endTime) {
      pill.endTime = Date.now();
    }

    // Emit pill status change
    this.emitPillStatusChange(missionId, pillId, newStatus);

    // Update task status
    const expectedTaskStatus = calculateTaskStatus(task.pills);
    if (task.status !== expectedTaskStatus) {
      const previousTaskStatus = task.status;
      task.status = expectedTaskStatus;

      // Update timing
      if (expectedTaskStatus === 'in-progress' && !task.startTime) {
        task.startTime = Date.now();
      }
      if (
        (expectedTaskStatus === 'completed' ||
          expectedTaskStatus === 'failed' ||
          expectedTaskStatus === 'skipped') &&
        !task.endTime
      ) {
        task.endTime = Date.now();
      }

      this.emitTaskStatusChange(missionId, taskId, expectedTaskStatus);
    }

    // Update timeline status
    const expectedTimelineStatus = calculateTimelineStatus(timeline.tasks);
    if (timeline.status !== expectedTimelineStatus) {
      timeline.status = expectedTimelineStatus;

      // Update timing
      if (expectedTimelineStatus === 'in-progress' && !timeline.startTime) {
        timeline.startTime = Date.now();
      }
      if (
        (expectedTimelineStatus === 'completed' ||
          expectedTimelineStatus === 'failed' ||
          expectedTimelineStatus === 'skipped') &&
        !timeline.endTime
      ) {
        timeline.endTime = Date.now();
      }
    }

    this.emitTimelineUpdate(missionId);
  }

  /**
   * Add a pill to a task
   */
  addPill(missionId: string, taskId: string, pill: ToolPill): void {
    const timeline = this.getTimeline(missionId);
    if (!timeline) {
      throw new Error(`Timeline with missionId "${missionId}" not found`);
    }

    const task = timeline.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task with id "${taskId}" not found`);
    }

    // Validate the pill
    const errors = validatePill(pill);
    if (errors.length > 0) {
      throw new Error(`Invalid pill: ${errors.map((e) => e.message).join(', ')}`);
    }

    task.pills.push(pill);
    this.emitTimelineUpdate(missionId);
  }

  /**
   * Add a task to a timeline
   */
  addTask(missionId: string, task: Task): void {
    const timeline = this.getTimeline(missionId);
    if (!timeline) {
      throw new Error(`Timeline with missionId "${missionId}" not found`);
    }

    // Validate the task
    const errors = validateTask(task);
    if (errors.length > 0) {
      throw new Error(`Invalid task: ${errors.map((e) => e.message).join(', ')}`);
    }

    timeline.tasks.push(task);
    this.emitTimelineUpdate(missionId);
  }

  /**
   * Delete a timeline
   */
  delete(missionId: string): boolean {
    const deleted = this.timelines.delete(missionId);
    if (deleted) {
      this.updateCallbacks.delete(missionId);
      this.pillStatusCallbacks.delete(missionId);
      this.taskStatusCallbacks.delete(missionId);
    }
    return deleted;
  }

  /**
   * Validate a timeline
   */
  validate(missionId: string): ValidationResult {
    const timeline = this.getTimeline(missionId);
    if (!timeline) {
      return {
        isValid: false,
        errors: [
          {
            type: 'missing_field',
            message: `Timeline with missionId "${missionId}" not found`,
          },
        ],
      };
    }

    return validateTimeline(timeline);
  }

  /**
   * Subscribe to timeline updates
   */
  onUpdate(missionId: string, callback: TimelineUpdateCallback): () => void {
    let callbacks = this.updateCallbacks.get(missionId);
    if (!callbacks) {
      callbacks = new Set();
      this.updateCallbacks.set(missionId, callbacks);
    }

    callbacks.add(callback);

    return () => {
      callbacks!.delete(callback);
    };
  }

  /**
   * Subscribe to pill status changes
   */
  onPillStatusChange(missionId: string, callback: PillStatusChangeCallback): () => void {
    let callbacks = this.pillStatusCallbacks.get(missionId);
    if (!callbacks) {
      callbacks = new Set();
      this.pillStatusCallbacks.set(missionId, callbacks);
    }

    callbacks.add(callback);

    return () => {
      callbacks!.delete(callback);
    };
  }

  /**
   * Subscribe to task status changes
   */
  onTaskStatusChange(missionId: string, callback: TaskStatusChangeCallback): () => void {
    let callbacks = this.taskStatusCallbacks.get(missionId);
    if (!callbacks) {
      callbacks = new Set();
      this.taskStatusCallbacks.set(missionId, callbacks);
    }

    callbacks.add(callback);

    return () => {
      callbacks!.delete(callback);
    };
  }

  /**
   * Emit timeline update
   */
  private emitTimelineUpdate(missionId: string): void {
    const timeline = this.timelines.get(missionId);
    if (!timeline) {
      return;
    }

    const callbacks = this.updateCallbacks.get(missionId);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(timeline);
        } catch (error) {
          console.error('Error in timeline update callback:', error);
        }
      });
    }
  }

  /**
   * Emit pill status change
   */
  private emitPillStatusChange(missionId: string, pillId: string, newStatus: ExecutionStatus): void {
    const callbacks = this.pillStatusCallbacks.get(missionId);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(pillId, newStatus);
        } catch (error) {
          console.error('Error in pill status change callback:', error);
        }
      });
    }
  }

  /**
   * Emit task status change
   */
  private emitTaskStatusChange(missionId: string, taskId: string, newStatus: ExecutionStatus): void {
    const callbacks = this.taskStatusCallbacks.get(missionId);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(taskId, newStatus);
        } catch (error) {
          console.error('Error in task status change callback:', error);
        }
      });
    }
  }
}

/**
 * Factory function to create a new manager
 */
export function createPillNarrativeTimelineManager(): PillNarrativeTimelineManager {
  return new PillNarrativeTimelineManager();
}
