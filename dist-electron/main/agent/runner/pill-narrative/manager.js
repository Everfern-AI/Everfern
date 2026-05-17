"use strict";
/**
 * Pill-Based Narrative Timeline Manager
 *
 * This module provides the core manager for pill-based narrative timelines.
 * It handles creation, updates, and event emission for task-based execution flows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PillNarrativeTimelineManager = void 0;
exports.createPillNarrativeTimelineManager = createPillNarrativeTimelineManager;
const validators_1 = require("./validators");
/**
 * PillNarrativeTimelineManager manages the complete lifecycle of a pill-based narrative timeline.
 */
class PillNarrativeTimelineManager {
    /** Map of mission IDs to their timelines */
    timelines = new Map();
    /** Timeline update callbacks */
    updateCallbacks = new Map();
    /** Pill status change callbacks */
    pillStatusCallbacks = new Map();
    /** Task status change callbacks */
    taskStatusCallbacks = new Map();
    /**
     * Create a new timeline
     */
    create(missionId, timeline) {
        if (this.timelines.has(missionId)) {
            throw new Error(`Timeline with missionId "${missionId}" already exists`);
        }
        // Validate the timeline
        const validation = (0, validators_1.validateTimeline)(timeline);
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
    getTimeline(missionId) {
        return this.timelines.get(missionId) || null;
    }
    /**
     * Get all timelines
     */
    getAllTimelines() {
        return Array.from(this.timelines.values());
    }
    /**
     * Update a pill's status
     */
    updatePillStatus(missionId, taskId, pillId, newStatus, result, error) {
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
        if (!(0, validators_1.isValidStatusTransition)(pill.status, newStatus)) {
            throw new Error(`Invalid status transition for pill ${pillId}: ${pill.status} → ${newStatus}`);
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
        const expectedTaskStatus = (0, validators_1.calculateTaskStatus)(task.pills);
        if (task.status !== expectedTaskStatus) {
            const previousTaskStatus = task.status;
            task.status = expectedTaskStatus;
            // Update timing
            if (expectedTaskStatus === 'in-progress' && !task.startTime) {
                task.startTime = Date.now();
            }
            if ((expectedTaskStatus === 'completed' ||
                expectedTaskStatus === 'failed' ||
                expectedTaskStatus === 'skipped') &&
                !task.endTime) {
                task.endTime = Date.now();
            }
            this.emitTaskStatusChange(missionId, taskId, expectedTaskStatus);
        }
        // Update timeline status
        const expectedTimelineStatus = (0, validators_1.calculateTimelineStatus)(timeline.tasks);
        if (timeline.status !== expectedTimelineStatus) {
            timeline.status = expectedTimelineStatus;
            // Update timing
            if (expectedTimelineStatus === 'in-progress' && !timeline.startTime) {
                timeline.startTime = Date.now();
            }
            if ((expectedTimelineStatus === 'completed' ||
                expectedTimelineStatus === 'failed' ||
                expectedTimelineStatus === 'skipped') &&
                !timeline.endTime) {
                timeline.endTime = Date.now();
            }
        }
        this.emitTimelineUpdate(missionId);
    }
    /**
     * Add a pill to a task
     */
    addPill(missionId, taskId, pill) {
        const timeline = this.getTimeline(missionId);
        if (!timeline) {
            throw new Error(`Timeline with missionId "${missionId}" not found`);
        }
        const task = timeline.tasks.find((t) => t.id === taskId);
        if (!task) {
            throw new Error(`Task with id "${taskId}" not found`);
        }
        // Validate the pill
        const errors = (0, validators_1.validatePill)(pill);
        if (errors.length > 0) {
            throw new Error(`Invalid pill: ${errors.map((e) => e.message).join(', ')}`);
        }
        task.pills.push(pill);
        this.emitTimelineUpdate(missionId);
    }
    /**
     * Add a task to a timeline
     */
    addTask(missionId, task) {
        const timeline = this.getTimeline(missionId);
        if (!timeline) {
            throw new Error(`Timeline with missionId "${missionId}" not found`);
        }
        // Validate the task
        const errors = (0, validators_1.validateTask)(task);
        if (errors.length > 0) {
            throw new Error(`Invalid task: ${errors.map((e) => e.message).join(', ')}`);
        }
        timeline.tasks.push(task);
        this.emitTimelineUpdate(missionId);
    }
    /**
     * Delete a timeline
     */
    delete(missionId) {
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
    validate(missionId) {
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
        return (0, validators_1.validateTimeline)(timeline);
    }
    /**
     * Subscribe to timeline updates
     */
    onUpdate(missionId, callback) {
        let callbacks = this.updateCallbacks.get(missionId);
        if (!callbacks) {
            callbacks = new Set();
            this.updateCallbacks.set(missionId, callbacks);
        }
        callbacks.add(callback);
        return () => {
            callbacks.delete(callback);
        };
    }
    /**
     * Subscribe to pill status changes
     */
    onPillStatusChange(missionId, callback) {
        let callbacks = this.pillStatusCallbacks.get(missionId);
        if (!callbacks) {
            callbacks = new Set();
            this.pillStatusCallbacks.set(missionId, callbacks);
        }
        callbacks.add(callback);
        return () => {
            callbacks.delete(callback);
        };
    }
    /**
     * Subscribe to task status changes
     */
    onTaskStatusChange(missionId, callback) {
        let callbacks = this.taskStatusCallbacks.get(missionId);
        if (!callbacks) {
            callbacks = new Set();
            this.taskStatusCallbacks.set(missionId, callbacks);
        }
        callbacks.add(callback);
        return () => {
            callbacks.delete(callback);
        };
    }
    /**
     * Emit timeline update
     */
    emitTimelineUpdate(missionId) {
        const timeline = this.timelines.get(missionId);
        if (!timeline) {
            return;
        }
        const callbacks = this.updateCallbacks.get(missionId);
        if (callbacks) {
            callbacks.forEach((callback) => {
                try {
                    callback(timeline);
                }
                catch (error) {
                    console.error('Error in timeline update callback:', error);
                }
            });
        }
    }
    /**
     * Emit pill status change
     */
    emitPillStatusChange(missionId, pillId, newStatus) {
        const callbacks = this.pillStatusCallbacks.get(missionId);
        if (callbacks) {
            callbacks.forEach((callback) => {
                try {
                    callback(pillId, newStatus);
                }
                catch (error) {
                    console.error('Error in pill status change callback:', error);
                }
            });
        }
    }
    /**
     * Emit task status change
     */
    emitTaskStatusChange(missionId, taskId, newStatus) {
        const callbacks = this.taskStatusCallbacks.get(missionId);
        if (callbacks) {
            callbacks.forEach((callback) => {
                try {
                    callback(taskId, newStatus);
                }
                catch (error) {
                    console.error('Error in task status change callback:', error);
                }
            });
        }
    }
}
exports.PillNarrativeTimelineManager = PillNarrativeTimelineManager;
/**
 * Factory function to create a new manager
 */
function createPillNarrativeTimelineManager() {
    return new PillNarrativeTimelineManager();
}
