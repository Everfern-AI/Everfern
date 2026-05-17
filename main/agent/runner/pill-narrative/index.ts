/**
 * Pill-Based Narrative Timeline Module
 *
 * Exports all public APIs for the pill-based narrative timeline system.
 */

// Core types
export type {
  NarrativeTimeline,
  Task,
  ToolPill,
  ExecutionStatus,
  ValidationError,
  ValidationResult,
} from './types';

// Core classes
export { PillNarrativeTimelineManager } from './manager';
export { PillBasedTaskDecomposer } from './decomposer';

// Validators
export {
  validateTimeline,
  validateTask,
  validatePill,
  isValidStatusTransition,
  calculateTaskStatus,
  calculateTimelineStatus,
} from './validators';

// Serialization
export { PillSerializer } from './serializer';

// Integration
export {
  PillTimelineIntegration,
  getPillTimelineIntegration,
  initializePillTimelineIntegration,
  resetPillTimelineIntegration,
} from './integration';
