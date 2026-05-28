/**
 * Constants for Task Decomposer Narrative UI
 *
 * This module defines constants used throughout the task decomposer feature,
 * including styling values, animation durations, and configuration defaults.
 */

/**
 * Visual styling constants
 */
export const STYLING = {
  // Indentation for nested tool calls
  TOOL_CALL_INDENTATION_PX: 24,

  // Task header styling
  TASK_HEADER_PADDING_PX: 16,
  TASK_HEADER_MIN_HEIGHT_PX: 48,

  // Tool call group styling
  TOOL_CALL_GROUP_PADDING_PX: 12,

  // Border radius
  BORDER_RADIUS_PX: 8,

  // Status colors
  STATUS_COLORS: {
    pending: '#f3f4f6', // light gray
    'in-progress': '#dbeafe', // light blue
    completed: '#dcfce7', // light green
    failed: '#fee2e2', // light red
  },

  // Status text colors
  STATUS_TEXT_COLORS: {
    pending: '#6b7280', // gray
    'in-progress': '#0284c7', // blue
    completed: '#16a34a', // green
    failed: '#dc2626', // red
  },

  // Status border colors
  STATUS_BORDER_COLORS: {
    pending: '#d1d5db', // gray
    'in-progress': '#0284c7', // blue
    completed: '#16a34a', // green
    failed: '#dc2626', // red
  },
};

/**
 * Animation constants
 */
export const ANIMATIONS = {
  // Expand/collapse animation duration (ms)
  EXPAND_COLLAPSE_DURATION_MS: 200,

  // Status update animation duration (ms)
  STATUS_UPDATE_DURATION_MS: 300,

  // Fade in/out animation duration (ms)
  FADE_DURATION_MS: 150,

  // Easing functions
  EASING: {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  },
};

/**
 * Component configuration constants
 */
export const CONFIG = {
  // Maximum number of tool calls to display before showing "more" indicator
  MAX_VISIBLE_TOOL_CALLS: 5,

  // Debounce delay for rapid status updates (ms)
  STATUS_UPDATE_DEBOUNCE_MS: 100,

  // Batch update delay for streaming tool calls (ms)
  BATCH_UPDATE_DELAY_MS: 50,

  // Maximum number of unmapped tool calls to display
  MAX_UNMAPPED_TOOL_CALLS: 10,

  // Enable debug logging
  DEBUG_LOGGING: false,
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  INVALID_DECOMPOSED_TASK: 'Invalid or null decomposed task',
  INVALID_TOOL_CALL_ID: 'Invalid tool call ID',
  INVALID_TASK_STEP_ID: 'Invalid task step ID',
  TOOL_CALL_NOT_MAPPED: 'Tool call could not be mapped to any task step',
  TASK_STEP_NOT_FOUND: 'Task step not found',
  SERIALIZATION_ERROR: 'Failed to serialize task-tool mapper state',
  DESERIALIZATION_ERROR: 'Failed to deserialize task-tool mapper state',
  INVALID_JSON: 'Invalid JSON format',
};

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  TOOL_CALL_MAPPED: 'Tool call successfully mapped to task step',
  TASK_STEP_ADVANCED: 'Advanced to next task step',
  STATUS_UPDATED: 'Task step status updated',
  STATE_SERIALIZED: 'Task-tool mapper state serialized',
  STATE_DESERIALIZED: 'Task-tool mapper state deserialized',
};

/**
 * CSS class names
 */
export const CLASS_NAMES = {
  TASK_SECTION: 'task-section',
  TASK_HEADER: 'task-header',
  TASK_HEADER_EXPANDED: 'task-header--expanded',
  TASK_HEADER_COLLAPSED: 'task-header--collapsed',
  TASK_HEADER_PENDING: 'task-header--pending',
  TASK_HEADER_IN_PROGRESS: 'task-header--in-progress',
  TASK_HEADER_COMPLETED: 'task-header--completed',
  TASK_HEADER_FAILED: 'task-header--failed',
  TOOL_CALL_GROUP: 'tool-call-group',
  TOOL_CALL_GROUP_PARALLEL: 'tool-call-group--parallel',
  TOOL_CALL_ROW: 'tool-call-row',
  TOOL_CALL_ROW_NESTED: 'tool-call-row--nested',
  TIMELINE_RENDERER: 'timeline-renderer',
  TIMELINE_RENDERER_HIERARCHICAL: 'timeline-renderer--hierarchical',
  TIMELINE_RENDERER_FLAT: 'timeline-renderer--flat',
  UNMAPPED_SECTION: 'unmapped-section',
};

/**
 * Data attributes for testing
 */
export const DATA_ATTRIBUTES = {
  TASK_SECTION: 'data-task-section',
  TASK_HEADER: 'data-task-header',
  TASK_HEADER_TITLE: 'data-task-header-title',
  TASK_HEADER_EXPAND_BUTTON: 'data-task-header-expand-button',
  TOOL_CALL_GROUP: 'data-tool-call-group',
  TOOL_CALL_ROW: 'data-tool-call-row',
  TIMELINE_RENDERER: 'data-timeline-renderer',
  UNMAPPED_SECTION: 'data-unmapped-section',
};

/**
 * Default values
 */
export const DEFAULTS = {
  // Default task status
  DEFAULT_TASK_STATUS: 'pending' as const,

  // Default execution mode
  DEFAULT_EXECUTION_MODE: 'sequential' as const,

  // Default complexity level
  DEFAULT_COMPLEXITY: 'moderate' as const,

  // Default priority level
  DEFAULT_PRIORITY: 'normal' as const,

  // Default expand state for tasks
  DEFAULT_EXPANDED: true,

  // Default animation enabled
  DEFAULT_ANIMATION_ENABLED: true,
};

/**
 * Regex patterns for validation
 */
export const PATTERNS = {
  // Valid tool call ID pattern
  TOOL_CALL_ID: /^[a-zA-Z0-9_-]+$/,

  // Valid task step ID pattern
  TASK_STEP_ID: /^[a-zA-Z0-9_-]+$/,

  // Valid tool name pattern
  TOOL_NAME: /^[a-zA-Z0-9_-]+$/,
};

/**
 * Feature flags
 */
export const FEATURE_FLAGS = {
  // Enable hierarchical rendering
  ENABLE_HIERARCHICAL_RENDERING: true,

  // Enable backward compatibility mode
  ENABLE_BACKWARD_COMPATIBILITY: true,

  // Enable animations
  ENABLE_ANIMATIONS: true,

  // Enable debug logging
  ENABLE_DEBUG_LOGGING: false,

  // Enable performance monitoring
  ENABLE_PERFORMANCE_MONITORING: false,
};
