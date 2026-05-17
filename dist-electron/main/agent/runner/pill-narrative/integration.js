"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PillTimelineIntegration = void 0;
exports.getPillTimelineIntegration = getPillTimelineIntegration;
exports.initializePillTimelineIntegration = initializePillTimelineIntegration;
exports.resetPillTimelineIntegration = resetPillTimelineIntegration;
const manager_1 = require("./manager");
const decomposer_1 = require("./decomposer");
/**
 * Integration manager for pill-based timeline with agent runner
 */
class PillTimelineIntegration {
    manager;
    decomposer;
    currentMissionId = null;
    toolCallToPillMap = new Map();
    eventCallbacks = [];
    constructor(client) {
        this.manager = new manager_1.PillNarrativeTimelineManager();
        this.decomposer = new decomposer_1.PillBasedTaskDecomposer(client);
    }
    /**
     * Initialize a pill-based timeline from a user request
     */
    async initializeTimeline(missionId, userRequest) {
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
    updatePillStatus(missionId, taskId, pillId, status, result, error) {
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
        }
        catch (err) {
            console.error('[PillTimelineIntegration] Failed to update pill status:', err);
        }
    }
    /**
     * Track a tool call and associate it with a pill
     */
    trackToolCall(missionId, taskId, pillId, toolCallId, toolName, parameters) {
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
    completeToolCall(toolCallId, result, error) {
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
    getTimeline(missionId) {
        return this.manager.getTimeline(missionId);
    }
    /**
     * Get all timelines
     */
    getAllTimelines() {
        return this.manager.getAllTimelines();
    }
    /**
     * Subscribe to timeline updates
     */
    onTimelineUpdate(missionId, callback) {
        return this.manager.onUpdate(missionId, callback);
    }
    /**
     * Subscribe to pill status changes
     */
    onPillStatusChange(missionId, callback) {
        return this.manager.onPillStatusChange(missionId, callback);
    }
    /**
     * Subscribe to task status changes
     */
    onTaskStatusChange(missionId, callback) {
        return this.manager.onTaskStatusChange(missionId, callback);
    }
    /**
     * Subscribe to integration events
     */
    onEvent(callback) {
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
    emitEvent(event) {
        this.eventCallbacks.forEach((callback) => {
            try {
                callback(event);
            }
            catch (err) {
                console.error('[PillTimelineIntegration] Error in event callback:', err);
            }
        });
    }
    /**
     * Delete a timeline
     */
    deleteTimeline(missionId) {
        return this.manager.delete(missionId);
    }
    /**
     * Clear all timelines
     */
    clearAll() {
        this.manager.getAllTimelines().forEach((timeline) => {
            this.manager.delete(timeline.missionId);
        });
        this.toolCallToPillMap.clear();
        this.currentMissionId = null;
    }
}
exports.PillTimelineIntegration = PillTimelineIntegration;
/**
 * Global integration instance
 */
let globalIntegration = null;
/**
 * Get or create the global integration instance
 */
function getPillTimelineIntegration(client) {
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
function initializePillTimelineIntegration(client) {
    globalIntegration = new PillTimelineIntegration(client);
    return globalIntegration;
}
/**
 * Reset the global integration instance
 */
function resetPillTimelineIntegration() {
    if (globalIntegration) {
        globalIntegration.clearAll();
    }
    globalIntegration = null;
}
