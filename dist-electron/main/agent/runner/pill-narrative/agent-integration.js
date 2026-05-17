"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PillNarrativeTimelineIntegration = void 0;
exports.getOrCreateIntegration = getOrCreateIntegration;
exports.resetIntegration = resetIntegration;
const manager_1 = require("./manager");
const decomposer_1 = require("./decomposer");
/**
 * Integration layer for pill-based timeline with agent runner
 */
class PillNarrativeTimelineIntegration {
    manager;
    decomposer;
    eventCallbacks = new Set();
    pillToToolCallMap = new Map(); // pill ID -> tool call ID
    toolCallToPillMap = new Map(); // tool call ID -> pill ID
    constructor(client) {
        this.manager = (0, manager_1.createPillNarrativeTimelineManager)();
        this.decomposer = new decomposer_1.PillBasedTaskDecomposer(client);
    }
    /**
     * Initialize a new timeline from a user request
     */
    async initializeTimeline(missionId, userRequest) {
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
        }
        catch (error) {
            console.error('[PillNarrativeTimelineIntegration] Failed to initialize timeline:', error);
            throw error;
        }
    }
    /**
     * Track a tool call and associate it with a pill
     */
    trackToolCall(missionId, toolCallId, toolName, parameters) {
        try {
            const timeline = this.manager.getTimeline(missionId);
            if (!timeline) {
                console.warn(`[PillNarrativeTimelineIntegration] Timeline not found for mission ${missionId}`);
                return;
            }
            // Find a matching pill by tool name
            let matchedPill = null;
            let taskId = null;
            for (const task of timeline.tasks) {
                for (const pill of task.pills) {
                    // Match by tool name and status (pending or in-progress)
                    if (pill.toolName === toolName &&
                        (pill.status === 'pending' || pill.status === 'in-progress')) {
                        matchedPill = pill;
                        taskId = task.id;
                        break;
                    }
                }
                if (matchedPill)
                    break;
            }
            if (matchedPill && taskId) {
                // Create bidirectional mapping
                this.pillToToolCallMap.set(matchedPill.id, toolCallId);
                this.toolCallToPillMap.set(toolCallId, matchedPill.id);
                // Update pill status to in-progress
                this.manager.updatePillStatus(missionId, taskId, matchedPill.id, 'in-progress');
                // Store parameters
                if (parameters) {
                    matchedPill.parameters = parameters;
                }
            }
        }
        catch (error) {
            console.error('[PillNarrativeTimelineIntegration] Failed to track tool call:', error);
        }
    }
    /**
     * Update pill status when tool execution completes
     */
    updatePillStatus(missionId, toolCallId, status, result, error) {
        try {
            const pillId = this.toolCallToPillMap.get(toolCallId);
            if (!pillId) {
                console.warn(`[PillNarrativeTimelineIntegration] No pill found for tool call ${toolCallId}`);
                return;
            }
            const timeline = this.manager.getTimeline(missionId);
            if (!timeline) {
                console.warn(`[PillNarrativeTimelineIntegration] Timeline not found for mission ${missionId}`);
                return;
            }
            // Find task containing this pill
            let taskId = null;
            for (const task of timeline.tasks) {
                if (task.pills.some((p) => p.id === pillId)) {
                    taskId = task.id;
                    break;
                }
            }
            if (taskId) {
                this.manager.updatePillStatus(missionId, taskId, pillId, status, result, error);
            }
        }
        catch (error) {
            console.error('[PillNarrativeTimelineIntegration] Failed to update pill status:', error);
        }
    }
    /**
     * Get current timeline
     */
    getTimeline(missionId) {
        return this.manager.getTimeline(missionId);
    }
    /**
     * Subscribe to timeline events
     */
    onTimelineEvent(callback) {
        this.eventCallbacks.add(callback);
        return () => {
            this.eventCallbacks.delete(callback);
        };
    }
    /**
     * Emit timeline event to all subscribers
     */
    emitEvent(event) {
        for (const callback of this.eventCallbacks) {
            try {
                callback(event);
            }
            catch (error) {
                console.error('[PillNarrativeTimelineIntegration] Error in event callback:', error);
            }
        }
    }
    /**
     * Clean up timeline when mission completes
     */
    cleanup(missionId) {
        try {
            this.manager.delete(missionId);
            this.pillToToolCallMap.clear();
            this.toolCallToPillMap.clear();
        }
        catch (error) {
            console.error('[PillNarrativeTimelineIntegration] Failed to cleanup timeline:', error);
        }
    }
}
exports.PillNarrativeTimelineIntegration = PillNarrativeTimelineIntegration;
/**
 * Global integration instance (singleton)
 */
let globalIntegration = null;
/**
 * Get or create global integration instance
 */
function getOrCreateIntegration(client) {
    if (!globalIntegration) {
        globalIntegration = new PillNarrativeTimelineIntegration(client);
    }
    return globalIntegration;
}
/**
 * Export for testing
 */
function resetIntegration() {
    globalIntegration = null;
}
