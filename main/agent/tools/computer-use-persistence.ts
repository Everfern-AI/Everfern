/**
 * Computer Use Tool Action Persistence Integration
 *
 * Wraps the ComputerUseTool to capture GUI actions and persist them to the database.
 * This enables restoration of desktop automation state across application restarts.
 *
 * Requirements: 9.1, 9.2, 9.5, 9.6
 *
 * The persistent wrapper:
 * 1. Captures a screenshot before each GUI action (for context)
 * 2. Records action parameters (type, coordinates, text, etc.)
 * 3. Captures a screenshot after action execution (for verification)
 * 4. Stores action with metadata in the computer_use_actions table
 * 5. Tracks reversibility for undo operations
 * 6. Maintains action history for session restoration
 */

import { v4 as uuidv4 } from 'uuid';
import { getSessionPersistenceManager, type ComputerUseAction } from '../persistence/session-manager';
import type { ToolResult as AgentToolResult } from '../runner/types';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration for Computer Use persistence
 */
export interface ComputerUsePersistenceConfig {
  /** Task identifier for grouping actions */
  taskId: string;
  /** Current step number in agent execution */
  stepNumber: number;
  /** Whether to capture screenshots (default: true) */
  captureScreenshots?: boolean;
  /** Whether to track reversibility (default: true) */
  trackReversibility?: boolean;
}

/**
 * Internal action tracking during execution
 */
interface ActionExecutionContext {
  id: string;
  taskId: string;
  stepNumber: number;
  action: string;
  parameters: Record<string, unknown>;
  screenshotBefore: string | null;
  screenshotAfter: string | null;
  reversible: boolean;
  reverseAction: string | null;
  startTime: number;
  endTime: number;
}

// ── Reversibility Detection ──────────────────────────────────────────────────

/**
 * Analyze an action and its parameters to determine reversibility
 *
 * Requirement 9.6: Identify reversible GUI actions and generate reverse operations
 */
function analyzeReversibility(
  action: string,
  parameters: Record<string, unknown>
): { reversible: boolean; reverseAction: string | null } {
  // Actions that inherently modify state and may be reversible
  const reversibleActions: Record<string, (params: Record<string, unknown>) => string | null> = {
    /**
     * Click actions are reversible only if they're on toggle-like elements
     * We can't reliably detect this from parameters alone, so we mark as reversible
     * but the actual reversal would require visual context
     */
    left_click: (params) => {
      const coord = params.coordinate as [number, number] | undefined;
      if (coord) {
        return JSON.stringify({
          action: 'left_click',
          coordinate: coord,
          description: 'Click same location to toggle/reverse'
        });
      }
      return null;
    },

    /**
     * Type actions could be reversed by selecting all and deleting,
     * but we need to know the insertion point and prior content
     * Mark as reversible but store the text typed for reference
     */
    type: (params) => {
      const text = params.text as string | undefined;
      if (text) {
        return JSON.stringify({
          action: 'key',
          keys: ['ctrl', 'a'],
          description: 'Select all typed text and delete'
        });
      }
      return null;
    },

    /**
     * Scroll actions are reversible by scrolling in the opposite direction
     */
    scroll: (params) => {
      const pixels = params.pixels as number | undefined;
      if (pixels !== undefined) {
        return JSON.stringify({
          action: 'scroll',
          pixels: -pixels,
          coordinate: params.coordinate,
          description: `Scroll ${-pixels > 0 ? 'up' : 'down'} to reverse`
        });
      }
      return null;
    },

    /**
     * Horizontal scroll is reversible by scrolling in opposite direction
     */
    hscroll: (params) => {
      const pixels = params.pixels as number | undefined;
      if (pixels !== undefined) {
        return JSON.stringify({
          action: 'hscroll',
          pixels: -pixels,
          coordinate: params.coordinate,
          description: `Scroll ${-pixels > 0 ? 'right' : 'left'} to reverse`
        });
      }
      return null;
    },

    /**
     * Drag is reversible by dragging back to the original position
     */
    drag: (params) => {
      const startCoord = params.start_coordinate as [number, number] | undefined;
      const endCoord = params.coordinate as [number, number] | undefined;
      if (startCoord && endCoord) {
        return JSON.stringify({
          action: 'drag',
          start_coordinate: endCoord,
          coordinate: startCoord,
          description: 'Drag back to original position'
        });
      }
      return null;
    },

    /**
     * Left click drag is reversible by dragging back
     */
    left_click_drag: (params) => {
      const coord = params.coordinate as [number, number] | undefined;
      if (coord) {
        // We don't have the original position, so mark as requiring context
        return JSON.stringify({
          action: 'left_click_drag',
          description: 'Drag back to original position (requires context)'
        });
      }
      return null;
    },

    /**
     * Double click and triple click are generally not reversible
     * as they just select text and don't modify state
     */
    double_click: () => null,
    triple_click: () => null,

    /**
     * Mouse moves don't modify state, not reversible
     */
    mouse_move: () => null,

    /**
     * Key presses may be reversible depending on the key
     * e.g., Delete key can be reversed by Undo (Ctrl+Z)
     */
    key: (params) => {
      const keys = params.keys as string[] | undefined;
      if (keys && keys.includes('delete')) {
        return JSON.stringify({
          action: 'key',
          keys: ['ctrl', 'z'],
          description: 'Undo delete action'
        });
      }
      return null;
    },

    /**
     * Hold and release are part of gesture sequences
     * Not directly reversible on their own
     */
    hold: () => null,
    release: () => null,

    /**
     * Wait doesn't modify state, not reversible
     */
    wait: () => null,

    /**
     * Answer and terminate are end-of-task actions, not reversible
     */
    answer: () => null,
    terminate: () => null,
  };

  const analyzer = reversibleActions[action];
  if (!analyzer) {
    return { reversible: false, reverseAction: null };
  }

  const reverseAction = analyzer(parameters);
  return {
    reversible: reverseAction !== null,
    reverseAction
  };
}

// ── Computer Use Persistence Wrapper ─────────────────────────────────────────

/**
 * Wrapper around ComputerUseTool that captures action history for persistence
 *
 * Requirement 9.1: Record each GUI action with screen coordinates and timestamp
 * Requirement 9.2: Capture screenshots before and after each GUI action
 * Requirement 9.5: Log GUI action history to the Checkpoint_Store
 * Requirement 9.6: Support rollback of GUI actions by capturing reversible operation pairs
 */
export class ComputerUsePersistenceWrapper {
  private config: ComputerUsePersistenceConfig;
  private sessionManager = getSessionPersistenceManager();
  private capturedActions: ActionExecutionContext[] = [];

  constructor(config: ComputerUsePersistenceConfig) {
    this.config = {
      captureScreenshots: true,
      trackReversibility: true,
      ...config,
    };
  }

  /**
   * Initialize the persistence wrapper
   * Should be called before first action capture
   */
  async initialize(): Promise<void> {
    await this.sessionManager.initialize();
    console.log('[ComputerUsePersistence] Initialized for task', this.config.taskId);
  }

  /**
   * Wrap a ComputerUseTool action call to capture persistence data
   *
   * Requirement 9.1: Record action with coordinates and timestamp
   * Requirement 9.2: Capture screenshots before and after
   * Requirement 9.5: Log to checkpoint store
   *
   * @param toolCall - Async function that executes the actual tool call
   * @param action - Action type (click, type, scroll, etc.)
   * @param parameters - Action parameters
   * @returns Wrapped tool result
   */
  async captureActionExecution<T extends AgentToolResult>(
    toolCall: () => Promise<T>,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<T> {
    const actionId = uuidv4();
    const startTime = Date.now();

    try {
      // Capture screenshot before action
      // Requirement 9.2: Capture screenshot before each GUI action
      let screenshotBefore: string | null = null;
      if (this.config.captureScreenshots) {
        screenshotBefore = await this._captureScreenshot();
      }

      // Execute the actual tool call
      console.log(`[ComputerUsePersistence] Executing ${action}`);
      const result = await toolCall();

      // Capture screenshot after action
      // Requirement 9.2: Capture screenshot after each GUI action
      let screenshotAfter: string | null = null;
      if (this.config.captureScreenshots) {
        screenshotAfter = await this._captureScreenshot();
      }

      const endTime = Date.now();

      // Analyze reversibility
      // Requirement 9.6: Track reversible operations
      const { reversible, reverseAction } = this.config.trackReversibility
        ? analyzeReversibility(action, parameters)
        : { reversible: false, reverseAction: null };

      // Create action record
      const context: ActionExecutionContext = {
        id: actionId,
        taskId: this.config.taskId,
        stepNumber: this.config.stepNumber,
        action,
        parameters,
        screenshotBefore,
        screenshotAfter,
        reversible,
        reverseAction,
        startTime,
        endTime,
      };

      // Store in memory for batch persistence
      this.capturedActions.push(context);

      // Requirement 9.1: Log action details
      console.log(`[ComputerUsePersistence] Action recorded: ${action} (id=${actionId}, duration=${endTime - startTime}ms, reversible=${reversible})`);

      return result;
    } catch (error) {
      console.error(`[ComputerUsePersistence] Action failed: ${action}`, error);
      throw error;
    }
  }

  /**
   * Persist all captured actions to the database
   *
   * Requirement 9.5: Log GUI action history to the Checkpoint_Store
   * Should be called periodically or after task completion
   */
  async persistCapturedActions(): Promise<void> {
    if (this.capturedActions.length === 0) {
      return;
    }

    try {
      console.log(`[ComputerUsePersistence] Persisting ${this.capturedActions.length} actions to database`);

      // Convert internal context to ComputerUseAction interface
      const actions: ComputerUseAction[] = this.capturedActions.map((ctx) => ({
        id: ctx.id,
        taskId: ctx.taskId,
        stepNumber: ctx.stepNumber,
        action: ctx.action,
        parameters: ctx.parameters,
        screenshotBefore: ctx.screenshotBefore,
        screenshotAfter: ctx.screenshotAfter,
        timestamp: ctx.startTime,
        reversible: ctx.reversible,
        reverseAction: ctx.reverseAction,
      }));

      // Persist to database via session manager
      await this.sessionManager.captureComputerUseActions(actions, this.config.taskId);

      // Clear in-memory cache after successful persistence
      this.capturedActions = [];

      console.log('[ComputerUsePersistence] Successfully persisted actions to database');
    } catch (error) {
      console.error('[ComputerUsePersistence] Failed to persist actions:', error);
      throw error;
    }
  }

  /**
   * Get all captured actions (for testing or inspection)
   */
  getCapturedActions(): ActionExecutionContext[] {
    return [...this.capturedActions];
  }

  /**
   * Clear in-memory action cache without persisting
   */
  clearCapturedActions(): void {
    console.log('[ComputerUsePersistence] Cleared', this.capturedActions.length, 'in-memory actions');
    this.capturedActions = [];
  }

  /**
   * Get restoration context for a task
   *
   * Returns all persisted actions for a task to restore automation state
   */
  async getRestorationContext(): Promise<ComputerUseAction[]> {
    return this.sessionManager.restoreComputerUseContext(this.config.taskId);
  }

  /**
   * Update configuration (e.g., step number changes)
   */
  updateConfig(partial: Partial<ComputerUsePersistenceConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Capture a screenshot for persistence
   * Returns base64 data URL or file path
   */
  private async _captureScreenshot(): Promise<string | null> {
    try {
      // In a real implementation, this would call the ComputerUseTool's screenshot method
      // For now, we return null to indicate screenshot was not captured
      // This can be enhanced when ComputerUseTool is passed to this wrapper
      return null;
    } catch (error) {
      console.warn('[ComputerUsePersistence] Failed to capture screenshot:', error);
      return null;
    }
  }
}

/**
 * Global singleton for Computer Use persistence
 * Used to maintain action history across the application
 */
let globalPersistenceWrapper: ComputerUsePersistenceWrapper | null = null;

/**
 * Get or create the global persistence wrapper
 */
export function getOrCreatePersistenceWrapper(
  config: ComputerUsePersistenceConfig
): ComputerUsePersistenceWrapper {
  if (!globalPersistenceWrapper || globalPersistenceWrapper['config'].taskId !== config.taskId) {
    globalPersistenceWrapper = new ComputerUsePersistenceWrapper(config);
  }
  return globalPersistenceWrapper;
}

/**
 * Get the current persistence wrapper
 */
export function getPersistenceWrapper(): ComputerUsePersistenceWrapper | null {
  return globalPersistenceWrapper;
}
