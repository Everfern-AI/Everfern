/**
 * Frontend type definitions for sub-agent progress streaming
 *
 * These types mirror the backend types defined in main/agent/tools/computer-use.ts
 * to ensure type safety across the IPC boundary.
 */

/**
 * Sub-agent progress event types
 */
export type SubAgentProgressEventType =
  | 'step'       // New step started
  | 'reasoning'  // Agent reasoning/thinking
  | 'action'     // Action execution
  | 'screenshot' // Screenshot captured
  | 'complete'   // Sub-agent completed
  | 'abort'      // Sub-agent aborted
  | 'error'      // Sub-agent error
  | 'branch_start'    // Timeline branch started
  | 'branch_update'   // Timeline branch progress update
  | 'branch_complete' // Timeline branch completed
  | 'branch_abort';   // Timeline branch aborted

/**
 * Sub-agent progress event
 */
export interface SubAgentProgressEvent {
  /** Event type */
  type: SubAgentProgressEventType;

  /** Tool call ID (unique identifier for this sub-agent execution) */
  toolCallId: string;

  /** Timestamp (ISO 8601) */
  timestamp: string;

  /** Current step number (1-indexed) */
  stepNumber?: number;

  /** Total steps (max turns) */
  totalSteps?: number;

  /** Event content/payload */
  content?: string;

  /** Action details (for action events) */
  action?: {
    type: string;           // e.g., "left_click", "type", "scroll"
    params: Record<string, unknown>;
    description: string;    // Human-readable description
  };

  /** Screenshot data (for screenshot events) */
  screenshot?: {
    base64: string;         // Base64-encoded image
    width: number;
    height: number;
    /** Absolute path to the saved screenshot file on disk (for persistence across page refresh) */
    screenshotPath?: string;
  };

  /** Absolute path to the saved screenshot file on disk (top-level alias, for persistence) */
  screenshotPath?: string;

  /** Metadata */
  metadata?: {
    model?: string;
    provider?: string;
    [key: string]: unknown;
  };

  /** Timeline branch metadata for visualization */
  timelineBranch?: {
    /** Parent agent/tool call ID that spawned this subagent */
    parentId?: string;
    /** Parent session key for nesting hierarchy */
    parentSessionKey?: string;
    /** Agent type for visual styling */
    agentType?: 'web-explorer' | 'navis' | 'computer-use' | 'research' | 'coding-specialist' | 'data-analyst';
    /** Branch level in hierarchy (0 = root, 1 = first level subagent, etc.) */
    branchLevel?: number;
    /** Visual position hint for UI rendering */
    visualPosition?: { x: number; y: number };
    /** Branch status for timeline visualization */
    branchStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
    /** Task description for branch labeling */
    taskDescription?: string;
    /** Subagent session ID for grouping related events */
    sessionId?: string;
  };
}

/**
 * Buffered progress event batch
 */
export interface SubAgentProgressBatch {
  toolCallId: string;
  events: SubAgentProgressEvent[];
  timestamp: string;
}
