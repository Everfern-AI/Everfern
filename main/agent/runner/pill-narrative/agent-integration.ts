/**
 * Pill-Based Narrative Timeline - Agent Runner Integration
 *
 * This module integrates the PillNarrativeTimelineManager with the agent execution flow.
 * It handles:
 * - Creating pill-based timelines from task decomposition
 * - Tracking tool execution and updating pill status
 * - Emitting timeline events for UI consumption
 * - Managing the lifecycle of timelines during agent execution
 */

import {
  PillNarrativeTimelineManager,
  createPillNarrativeTimelineManager,
} from './manager';
import {
  NarrativeTimeline,
  Task,
  ToolPill,
  ExecutionStatus,
} from './types';
import { PillBasedTaskDecomposer } from './decomposer';

// AIClient type - can be any object with chat method
export interface AIClient {
  chat(request: any): Promise<any>;
}

/**
 * Event emitted when timeline is created or updated
 */
export interface TimelineEvent {
  type: 'timeline_created' | 'timeline_updated' | 'pill_status_changed' | 'task_status_changed';
  missionId: string;
  timeline?: NarrativeTimeline;
  pillId?: string;
  taskId?: string;
  status?: ExecutionStatus;
}

/**
 * Callback for timeline events
 */
export type TimelineEventCallback = (event: TimelineEvent) => void;

/**
 * Integration layer for pill-based timeline with agent runner
 */
export class PillNarrativeTimelineIntegration {
  private manager: PillNarrativeTimelineManager;
  private decomposer: PillBasedTaskDecomposer;
  private eventCallbacks: Set<TimelineEventCallback> = new Set();
  private pillToToolCallMap: Map<string, string> = new Map(); // pill ID -> tool call ID
  private toolCallToPillMap: Map<string, string> = new Map(); // tool call ID -> pill ID

  constructor(client: AIClient) {
    this.manager = createPillNarrativeTimelineManager();
    this.decomposer = new PillBasedTaskDecomposer(client);
  }

  /**
   * Initialize a new timeline from a user request
   */
  async initializeTimeline(
    missionId: string,
    userRequest: string
  ): Promise<NarrativeTimeline> {
    try {
      // Generate pill-based structure from user request
      const timeline = await this.decomposer.decompose(userRequest, missionId);

      // Create timeline in manager
      this.manager.create(missionId, timeline);

      // Emit timeline created event
      this.emitEvent({
        type: 'timeline_created',
        missionId,
        timeline,
      });

      // Subscribe to updates
      this.manager.onUpdate(missionId, (updatedTimeline) => {
        this.emitEvent({
          type: 'timeline_updated',
          missionId,
          timeline: updatedTimeline,
        });
      });

      this.manager.onPillStatusChange(missionId, (pillId, status) => {
        this.emitEvent({
          type: 'pill_status_changed',
          missionId,
          pillId,
          status,
        });
      });

      this.manager.onTaskStatusChange(missionId, (taskId, status) => {
        this.emitEvent({
          type: 'task_status_changed',
          missionId,
          taskId,
          status,
        });
      });

      return timeline;
    } catch (error) {
      console.error('[PillNarrativeTimelineIntegration] Failed to initialize timeline:', error);
      throw error;
    }
  }

  /**
   * Track a tool call and associate it with a pill
   */
  trackToolCall(
    missionId: string,
    toolCallId: string,
    toolName: string,
    parameters?: Record<string, any>
  ): void {
    try {
      const timeline = this.manager.getTimeline(missionId);
      if (!timeline) {
        console.warn(`[PillNarrativeTimelineIntegration] Timeline not found for mission ${missionId}`);
        return;
      }

      // Find a matching pill by tool name
      let matchedPill: ToolPill | null = null;
      let taskId: string | null = null;

      for (const task of timeline.tasks) {
        for (const pill of task.pills) {
          // Match by tool name and status (pending or in-progress)
          if (
            pill.toolName === toolName &&
            (pill.status === 'pending' || pill.status === 'in-progress')
          ) {
            matchedPill = pill;
            taskId = task.id;
            break;
          }
        }
        if (matchedPill) break;
      }

      if (matchedPill && taskId) {
        // Create bidirectional mapping
        this.pillToToolCallMap.set(matchedPill.id, toolCallId);
        this.toolCallToPillMap.set(toolCallId, matchedPill.id);

        // Update pill status to in-progress
        this.manager.updatePillStatus(
          missionId,
          taskId,
          matchedPill.id,
          'in-progress'
        );

        // Store parameters
        if (parameters) {
          matchedPill.parameters = parameters;
        }
      }
    } catch (error) {
      console.error('[PillNarrativeTimelineIntegration] Failed to track tool call:', error);
    }
  }

  /**
   * Update pill status when tool execution completes
   */
  updatePillStatus(
    missionId: string,
    toolCallId: string,
    status: ExecutionStatus,
    result?: string,
    error?: string
  ): void {
    try {
      const pillId = this.toolCallToPillMap.get(toolCallId);
      if (!pillId) {
        console.warn(
          `[PillNarrativeTimelineIntegration] No pill found for tool call ${toolCallId}`
        );
        return;
      }

      const timeline = this.manager.getTimeline(missionId);
      if (!timeline) {
        console.warn(`[PillNarrativeTimelineIntegration] Timeline not found for mission ${missionId}`);
        return;
      }

      // Find task containing this pill
      let taskId: string | null = null;
      for (const task of timeline.tasks) {
        if (task.pills.some((p) => p.id === pillId)) {
          taskId = task.id;
          break;
        }
      }

      if (taskId) {
        this.manager.updatePillStatus(
          missionId,
          taskId,
          pillId,
          status,
          result,
          error
        );
      }
    } catch (error) {
      console.error('[PillNarrativeTimelineIntegration] Failed to update pill status:', error);
    }
  }

  /**
   * Get current timeline
   */
  getTimeline(missionId: string): NarrativeTimeline | null {
    return this.manager.getTimeline(missionId);
  }

  /**
   * Subscribe to timeline events
   */
  onTimelineEvent(callback: TimelineEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => {
      this.eventCallbacks.delete(callback);
    };
  }

  /**
   * Emit timeline event to all subscribers
   */
  private emitEvent(event: TimelineEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('[PillNarrativeTimelineIntegration] Error in event callback:', error);
      }
    }
  }

  /**
   * Clean up timeline when mission completes
   */
  cleanup(missionId: string): void {
    try {
      this.manager.delete(missionId);
      this.pillToToolCallMap.clear();
      this.toolCallToPillMap.clear();
    } catch (error) {
      console.error('[PillNarrativeTimelineIntegration] Failed to cleanup timeline:', error);
    }
  }
}

/**
 * Global integration instance (singleton)
 */
let globalIntegration: PillNarrativeTimelineIntegration | null = null;

/**
 * Get or create global integration instance
 */
export function getOrCreateIntegration(client: AIClient): PillNarrativeTimelineIntegration {
  if (!globalIntegration) {
    globalIntegration = new PillNarrativeTimelineIntegration(client);
  }
  return globalIntegration;
}

/**
 * Export for testing
 */
export function resetIntegration(): void {
  globalIntegration = null;
}
