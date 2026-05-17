"use strict";
/**
 * Pill-Based Narrative Timeline - Serialization
 *
 * This module provides serialization and deserialization of pill-based structures
 * to/from JSON format, with validation and pretty-printing capabilities.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PillSerializer = void 0;
exports.createPillSerializer = createPillSerializer;
const validators_1 = require("./validators");
/**
 * PillSerializer handles serialization and deserialization of pill-based structures
 */
class PillSerializer {
    /**
     * Serialize a NarrativeTimeline to JSON string
     */
    static serialize(timeline) {
        return JSON.stringify(timeline, null, 2);
    }
    /**
     * Deserialize a JSON string to NarrativeTimeline
     */
    static deserialize(json) {
        try {
            const parsed = JSON.parse(json);
            const validation = (0, validators_1.validateTimeline)(parsed);
            if (!validation.isValid) {
                throw new Error(`Invalid timeline structure: ${validation.errors.map((e) => e.message).join(', ')}`);
            }
            return parsed;
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Validate a timeline structure
     */
    static validate(timeline) {
        return (0, validators_1.validateTimeline)(timeline);
    }
    /**
     * Pretty print a timeline structure
     */
    static prettyPrint(timeline) {
        return JSON.stringify(timeline, null, 2);
    }
    /**
     * Serialize a single task
     */
    static serializeTask(task) {
        return JSON.stringify(task, null, 2);
    }
    /**
     * Deserialize a single task
     */
    static deserializeTask(json) {
        try {
            const parsed = JSON.parse(json);
            const errors = (0, validators_1.validateTask)(parsed);
            if (errors.length > 0) {
                throw new Error(`Invalid task structure: ${errors.map((e) => e.message).join(', ')}`);
            }
            return parsed;
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Serialize a single pill
     */
    static serializePill(pill) {
        return JSON.stringify(pill, null, 2);
    }
    /**
     * Deserialize a single pill
     */
    static deserializePill(json) {
        try {
            const parsed = JSON.parse(json);
            const errors = (0, validators_1.validatePill)(parsed);
            if (errors.length > 0) {
                throw new Error(`Invalid pill structure: ${errors.map((e) => e.message).join(', ')}`);
            }
            return parsed;
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Convert timeline to compact format (for storage/transmission)
     */
    static toCompact(timeline) {
        return JSON.stringify(timeline);
    }
    /**
     * Convert compact format back to timeline
     */
    static fromCompact(compact) {
        return this.deserialize(compact);
    }
    /**
     * Get summary statistics about a timeline
     */
    static getSummary(timeline) {
        let taskCount = 0;
        let pillCount = 0;
        let completedPills = 0;
        let failedPills = 0;
        let pendingPills = 0;
        let inProgressPills = 0;
        let skippedPills = 0;
        for (const task of timeline.tasks) {
            taskCount++;
            for (const pill of task.pills) {
                pillCount++;
                switch (pill.status) {
                    case 'completed':
                        completedPills++;
                        break;
                    case 'failed':
                        failedPills++;
                        break;
                    case 'pending':
                        pendingPills++;
                        break;
                    case 'in-progress':
                        inProgressPills++;
                        break;
                    case 'skipped':
                        skippedPills++;
                        break;
                }
            }
        }
        return {
            taskCount,
            pillCount,
            completedPills,
            failedPills,
            pendingPills,
            inProgressPills,
            skippedPills,
        };
    }
}
exports.PillSerializer = PillSerializer;
/**
 * Factory function to create a new serializer
 */
function createPillSerializer() {
    return PillSerializer;
}
