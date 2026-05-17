/**
 * Pill-Based Narrative Timeline Integration
 *
 * This module integrates the PillNarrativeTimelineManager with the agent execution flow.
 * It handles:
 * - Creating pill-based timelines from decomposed tasks
 * - Tracking tool execution and updating pill status
 * - Emitting timeline events for UI consumption
 * - Managing the lifecycle of pill-based structures during agent execution
 */

import { PillNarrativeTimelineManager } from './manager';
import { PillBasedTaskDecomposer } from './decomposer';
import {
  NarrativeTimeline,
  Task,
  ToolPill,
  ExecutionStatus,
} from './types';
import type { DecomposedTask, TaskStep } from '../state';
import type { AIClient } from '../../../lib/ai-client';

/**
 * Integration manager for pill-based timeline with agent runner
 */
export class PillTimelineIntegration {
  private manager: PillNarrativeTimelineManager;
  private decomposer: PillBasedTaskDecomposer;
  private currentMissionId: string | null = null;
  private toolCallToPillMap: Map<string, { missionId: string; taskId: string; pillId: string }> = new Map();
  private eventCallbacks: Array<(event: any) => void> = [];

  constructor(client: AIClient) {
    this.manager = new PillNarrativeTimelineManager();
    this.decomposer = new PillBasedTaskDecomposer(client);
  }

  /**
   * Initialize a pill-based timeline from a user request
   */
  async initializeTimeline(
    missionId: string,
    userRequest: string
  ): Promise<NarrativeTimeline> {
    this.currentMissionId = missionId;

    // Generate pill-based structure from user request
    const timeline = await this.decomposer.decompose(userRequest, missionId);

    // Create the timeline in the manager
    this.manager.create(missionId, timeline);

    // Emit initialization event
    this.emitEvent({
      type: 'pill-timeline-initialized',
      missionId,
      timeline,
    });

    return timeline;
  }

  /**
   * Update pill status during tool execution
   */
  updatePillStatus(
    missionId: string,
    taskId: string,
    pillId: string,
    status: ExecutionStatus,
    result?: string,
    error?: string
  ): void {
    try {
      this.manager.updatePillStatus(missionId, taskId, pillId, status, result, error);

      // Emit status update event
      this.emitEvent({
        type: 'pill-status-updated',
        missionId,
        taskId,
        pillId,
        status,
      });
    } catch (err) {
      console.error('[PillTimelineIntegration] Failed to update pill status:', err);
    }
  }

  /**
   * Track a tool call and associate it with a pill
   */
  trackToolCall(
    missionId: string,
    taskId: string,
    pillId: string,
    toolCallId: string,
    toolName: string,
    parameters: Record<string, any>
  ): void {
    // Store the mapping
    this.toolCallToPillMap.set(toolCallId, { missionId, taskId, pillId });

    // Update pill with parameters
    const timeline = this.manager.getTimeline(missionId);
    if (timeline) {
      const task = timeline.tasks.find((t) => t.id === taskId);
      if (task) {
        const pill = task.pills.find((p) => p.id === pillId);
        if (pill) {
          pill.parameters = parameters;
        }
      }
    }

    // Emit tracking event
    this.emitEvent({
      type: 'tool-call-tracked',
      missionId,
      taskId,
      pillId,
      toolCallId,
      toolName,
    });
  }

  /**
   * Complete a tool call and update the associated pill
   */
  completeToolCall(
    toolCallId: string,
    result: string,
    error?: string
  ): void {
    const mapping = this.toolCallToPillMap.get(toolCallId);
    if (!mapping) {
      console.warn(`[PillTimelineIntegration] No pill mapping found for tool call ${toolCallId}`);
      return;
    }

    const { missionId, taskId, pillId } = mapping;
    const status = error ? 'failed' : 'completed';

    this.updatePillStatus(missionId, taskId, pillId, status, result, error);

    // Clean up mapping
    this.toolCallToPillMap.delete(toolCallId);
  }

  /**
   * Get the current timeline
   */
  getTimeline(missionId: string): NarrativeTimeline | null {
    return this.manager.getTimeline(missionId);
  }

  /**
   * Get all timelines
   */
  getAllTimelines(): NarrativeTimeline[] {
    return this.manager.getAllTimelines();
  }

  /**
   * Subscribe to timeline updates
   */
  onTimelineUpdate(missionId: string, callback: (timeline: NarrativeTimeline) => void): () => void {
    return this.manager.onUpdate(missionId, callback);
  }

  /**
   * Subscribe to pill status changes
   */
  onPillStatusChange(
    missionId: string,
    callback: (pillId: string, status: ExecutionStatus) => void
  ): () => void {
    return this.manager.onPillStatusChange(missionId, callback);
  }

  /**
   * Subscribe to task status changes
   */
  onTaskStatusChange(
    missionId: string,
    callback: (taskId: string, status: ExecutionStatus) => void
  ): () => void {
    return this.manager.onTaskStatusChange(missionId, callback);
  }

  /**
   * Subscribe to integration events
   */
  onEvent(callback: (event: any) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit an integration event
   */
  private emitEvent(event: any): void {
    this.eventCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (err) {
        console.error('[PillTimelineIntegration] Error in event callback:', err);
      }
    });
  }

  /**
   * Delete a timeline
   */
  deleteTimeline(missionId: string): boolean {
    return this.manager.delete(missionId);
  }

  /**
   * Clear all timelines
   */
  clearAll(): void {
    this.manager.getAllTimelines().forEach((timeline) => {
      this.manager.delete(timeline.missionId);
    });
    this.toolCallToPillMap.clear();
    this.currentMissionId = null;
  }
}

/**
 * Global integration instance
 */
let globalIntegration: PillTimelineIntegration | null = null;

/**
 * Get or create the global integration instance
 */
export function getPillTimelineIntegration(client?: AIClient): PillTimelineIntegration {
  if (!globalIntegration && client) {
    globalIntegration = new PillTimelineIntegration(client);
  }
  if (!globalIntegration) {
    throw new Error('PillTimelineIntegration not initialized. Provide an AIClient.');
  }
  return globalIntegration;
}

/**
 * Initialize the global integration instance
 */
export function initializePillTimelineIntegration(client: AIClient): PillTimelineIntegration {
  globalIntegration = new PillTimelineIntegration(client);
  return globalIntegration;
}

/**
 * Reset the global integration instance
 */
export function resetPillTimelineIntegration(): void {
  if (globalIntegration) {
    globalIntegration.clearAll();
  }
  globalIntegration = null;
}
