/**
 * Pill-Based Narrative Timeline - Serialization
 *
 * This module provides serialization and deserialization of pill-based structures
 * to/from JSON format, with validation and pretty-printing capabilities.
 */

import {
  NarrativeTimeline,
  Task,
  ToolPill,
  ValidationResult,
  ValidationError,
} from './types';
import {
  validateTimeline,
  validateTask,
  validatePill,
} from './validators';

/**
 * PillSerializer handles serialization and deserialization of pill-based structures
 */
export class PillSerializer {
  /**
   * Serialize a NarrativeTimeline to JSON string
   */
  static serialize(timeline: NarrativeTimeline): string {
    return JSON.stringify(timeline, null, 2);
  }

  /**
   * Deserialize a JSON string to NarrativeTimeline
   */
  static deserialize(json: string): NarrativeTimeline {
    try {
      const parsed = JSON.parse(json);
      const validation = validateTimeline(parsed);

      if (!validation.isValid) {
        throw new Error(
          `Invalid timeline structure: ${validation.errors.map((e) => e.message).join(', ')}`
        );
      }

      return parsed as NarrativeTimeline;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate a timeline structure
   */
  static validate(timeline: NarrativeTimeline): ValidationResult {
    return validateTimeline(timeline);
  }

  /**
   * Pretty print a timeline structure
   */
  static prettyPrint(timeline: NarrativeTimeline): string {
    return JSON.stringify(timeline, null, 2);
  }

  /**
   * Serialize a single task
   */
  static serializeTask(task: Task): string {
    return JSON.stringify(task, null, 2);
  }

  /**
   * Deserialize a single task
   */
  static deserializeTask(json: string): Task {
    try {
      const parsed = JSON.parse(json);
      const errors = validateTask(parsed);

      if (errors.length > 0) {
        throw new Error(
          `Invalid task structure: ${errors.map((e: any) => e.message).join(', ')}`
        );
      }

      return parsed as Task;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Serialize a single pill
   */
  static serializePill(pill: ToolPill): string {
    return JSON.stringify(pill, null, 2);
  }

  /**
   * Deserialize a single pill
   */
  static deserializePill(json: string): ToolPill {
    try {
      const parsed = JSON.parse(json);
      const errors = validatePill(parsed);

      if (errors.length > 0) {
        throw new Error(
          `Invalid pill structure: ${errors.map((e: any) => e.message).join(', ')}`
        );
      }

      return parsed as ToolPill;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Convert timeline to compact format (for storage/transmission)
   */
  static toCompact(timeline: NarrativeTimeline): string {
    return JSON.stringify(timeline);
  }

  /**
   * Convert compact format back to timeline
   */
  static fromCompact(compact: string): NarrativeTimeline {
    return this.deserialize(compact);
  }

  /**
   * Get summary statistics about a timeline
   */
  static getSummary(timeline: NarrativeTimeline): {
    taskCount: number;
    pillCount: number;
    completedPills: number;
    failedPills: number;
    pendingPills: number;
    inProgressPills: number;
    skippedPills: number;
  } {
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

/**
 * Factory function to create a new serializer
 */
export function createPillSerializer(): typeof PillSerializer {
  return PillSerializer;
}
