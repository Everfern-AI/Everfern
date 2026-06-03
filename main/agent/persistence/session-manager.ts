/**
 * Session Persistence Manager for Long-Running Agentic Tasks
 *
 * Central orchestrator for state capture and restoration. Responsible for
 * serializing LangGraph state, Navis browser sessions, and Computer Use Tool
 * actions to the database. Handles encryption of sensitive data.
 *
 * Requirements: 1.1, 1.2, 1.3, 11.1, 11.2
 */

import { CheckpointEngine, type Checkpoint } from './checkpoint-engine';
import { getEncryptionService, type EncryptedData } from './encryption-service';
import type { GraphStateType } from '../runner/state';
import { dbOps } from '../../lib/db';

// ── Public types ──────────────────────────────────────────────────────

/**
 * Navis browser session state snapshot
 *
 * Requirement 3: Navis Browser Session Persistence
 */
export interface NavisSessionSnapshot {
  id: string;
  taskId: string;
  cookies: EncryptedData; // Encrypted JSON
  tabs: TabState[];
  sessionStorage: Record<string, string>;
  localStorage: Record<string, string>;
  authTokens: EncryptedData; // Encrypted JSON
  formData: Record<string, string>;
  timestamp: number;
}

/**
 * Browser tab state for Navis session
 */
export interface TabState {
  url: string;
  title: string;
  scrollPosition: { x: number; y: number };
  index: number;
}

/**
 * Computer Use Tool GUI action
 *
 * Requirement 9: Computer Use Tool Enhancements
 */
export interface ComputerUseAction {
  id: string;
  taskId: string;
  stepNumber: number;
  action: string; // 'click', 'type', 'key', 'scroll'
  parameters: Record<string, unknown>;
  screenshotBefore: string | null; // Base64 or file path
  screenshotAfter: string | null;
  timestamp: number;
  reversible: boolean;
  reverseAction: string | null; // JSON of reverse operation
}

// ── Session Persistence Manager ───────────────────────────────────────

/**
 * Central orchestrator for session persistence and restoration.
 *
 * Manages serialization and storage of:
 * - LangGraph agent state (via CheckpointEngine)
 * - Navis browser sessions (with encryption)
 * - Computer Use Tool action history
 * - Sensitive data encryption/decryption
 *
 * Requirements: 1.1, 1.2, 1.3, 11.1, 11.2
 */
export class SessionPersistenceManager {
  private checkpointEngine: CheckpointEngine;
  private initialized = false;

  constructor() {
    this.checkpointEngine = new CheckpointEngine();
  }

  /**
   * Initialize the session manager
   *
   * Ensures checkpoint engine and encryption service are ready.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.checkpointEngine.initialize();
      const encryptionService = getEncryptionService();
      await encryptionService.initialize();
      this.initialized = true;
      console.log('[SessionPersistenceManager] Initialized successfully');
    } catch (error) {
      console.error('[SessionPersistenceManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Capture the complete agent state and create a checkpoint
   *
   * Serializes the LangGraph state to the checkpoint store with integrity hashing
   * and optional compression. On failure, creates a placeholder checkpoint to
   * ensure agent execution is never interrupted.
   *
   * Requirement 1.1: Capture the complete LangGraph_State
   * Requirement 2.1: Create checkpoint after every agent step completion
   * Requirement 2.5: Log error and continue on failure
   *
   * @param state - The current LangGraph state
   * @param taskId - Task identifier
   * @returns The created checkpoint
   */
  async captureState(state: GraphStateType, taskId: string): Promise<Checkpoint> {
    try {
      this.ensureInitialized();

      console.log(
        `[SessionPersistenceManager] Capturing state for task ${taskId} at step ${(state as unknown as { iterations?: number }).iterations ?? 0}`
      );

      // Create checkpoint using CheckpointEngine
      // Requirement 1.1: Capture complete state
      // Requirement 2.1: Create checkpoint after step completion
      const checkpoint = await this.checkpointEngine.createCheckpoint(state, taskId);

      // Check if we should implement incremental checkpointing
      // Requirement 12.4: After 10th checkpoint, use deltas
      const allCheckpoints = await this.checkpointEngine.listCheckpoints(taskId, 15);
      if (allCheckpoints.length >= 10 && !checkpoint.deltaOnly) {
        // Next checkpoint should be delta-based
        console.log(`[SessionPersistenceManager] Checkpoint ${allCheckpoints.length} for task ${taskId} — next will use incremental checkpointing`);
      }

      // Clean up old checkpoints to save space
      // Requirement 2.6: Implement automatic checkpoint cleanup retaining last 100
      await this.checkpointEngine.pruneOldCheckpoints(taskId, 100);

      return checkpoint;
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to capture state:', error);

      // Fallback: return placeholder checkpoint so execution continues
      // Requirement 2.5: Log error and continue execution
      return {
        id: `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        stepNumber: (state as unknown as { iterations?: number }).iterations ?? 0,
        timestamp: Date.now(),
        stateJson: '',
        stateHash: '',
        deltaOnly: false,
        previousCheckpointId: null,
        compressed: false,
      };
    }
  }

  /**
   * Restore the agent state from a checkpoint
   *
   * Retrieves and deserializes the state from the checkpoint store,
   * reconstructing the exact state before shutdown.
   *
   * Requirement 1.3: Restore the most recent LangGraph_State for active tasks
   * Requirement 1.4: Maintain conversation history across restarts
   * Requirement 1.5: Preserve tool call history and results across restarts
   * Requirement 1.6: Resume from exact state before shutdown
   * Requirement 11.2: Deserialize and restore complete state
   *
   * @param checkpointId - The checkpoint to restore from
   * @returns The restored GraphStateType
   * @throws Error if checkpoint cannot be found or deserialized
   */
  async restoreState(checkpointId: string): Promise<GraphStateType> {
    try {
      this.ensureInitialized();

      console.log(`[SessionPersistenceManager] Restoring state from checkpoint ${checkpointId}`);

      // Retrieve checkpoint from database
      const checkpoint = await this._getCheckpointById(checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointId} not found in store`);
      }

      // Deserialize state (handles delta checkpoints automatically)
      const state = await this.checkpointEngine.deserializeCheckpointState(checkpoint);

      // Requirement 1.4: Maintain conversation history
      console.log(
        `[SessionPersistenceManager] State restored successfully with ${state.messages?.length ?? 0} messages`
      );

      // Cast serialized state back to GraphStateType
      // The checkpoint engine returns SerializedState, which is compatible with GraphStateType
      return state as unknown as GraphStateType;
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to restore state:', error);
      throw new Error(
        `Failed to restore state from checkpoint: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Restore the most recent checkpoint for a task
   *
   * Convenience method that automatically finds and restores the latest checkpoint.
   *
   * Requirement 1.3: Restore the most recent LangGraph_State
   * Requirement 1.6: Resume from exact state before shutdown
   *
   * @param taskId - Task identifier
   * @returns The restored state, or null if no checkpoint exists
   */
  async restoreLatestCheckpoint(taskId: string): Promise<GraphStateType | null> {
    try {
      this.ensureInitialized();

      const checkpoint = await this.checkpointEngine.getLatestCheckpoint(taskId);
      if (!checkpoint) {
        return null;
      }

      return this.restoreState(checkpoint.id);
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to restore latest checkpoint:', error);
      return null;
    }
  }

  /**
   * Get list of available checkpoints for a task
   *
   * Useful for UI display and rollback selection.
   *
   * @param taskId - Task identifier
   * @param limit - Maximum number of checkpoints to return
   * @returns List of checkpoints, newest first
   */
  async listCheckpointsForTask(taskId: string, limit: number = 50): Promise<Checkpoint[]> {
    try {
      this.ensureInitialized();
      return await this.checkpointEngine.listCheckpoints(taskId, limit);
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to list checkpoints:', error);
      return [];
    }
  }

  /**
   * Capture a Navis browser session state
   *
   * Encrypts sensitive data (cookies, auth tokens) before storage.
   *
   * Requirement 3.1: Save browser cookies to SQLite_Database
   * Requirement 3.2: Preserve open tab URLs and their order
   * Requirement 3.3: Save authentication tokens and session storage
   * Requirement 3.4: Capture form field values for in-progress form submissions
   *
   * @param session - Navis session object (partial structure)
   * @param taskId - Task identifier
   * @returns Saved session snapshot
   */
  async captureNavisSession(
    session: {
      cookies?: Record<string, string>;
      tabs?: TabState[];
      sessionStorage?: Record<string, string>;
      localStorage?: Record<string, string>;
      authTokens?: Record<string, string>;
      formData?: Record<string, string>;
    },
    taskId: string
  ): Promise<NavisSessionSnapshot> {
    try {
      this.ensureInitialized();

      const encryptionService = getEncryptionService();

      // Encrypt sensitive data
      // Requirement 3.1: Save cookies
      const cookiesJson = JSON.stringify(session.cookies || {});
      const encryptedCookies = await encryptionService.encrypt(cookiesJson);

      // Requirement 3.3: Save authentication tokens
      const authTokensJson = JSON.stringify(session.authTokens || {});
      const encryptedAuthTokens = await encryptionService.encrypt(authTokensJson);

      // Create session snapshot
      const snapshot: NavisSessionSnapshot = {
        id: `navis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        cookies: encryptedCookies,
        tabs: session.tabs || [],
        sessionStorage: session.sessionStorage || {},
        localStorage: session.localStorage || {},
        authTokens: encryptedAuthTokens,
        formData: session.formData || {},
        timestamp: Date.now(),
      };

      // Store in database
      await dbOps.run(
        `INSERT INTO navis_sessions
         (id, task_id, cookies_encrypted, tabs_json, session_storage_json,
          local_storage_json, auth_tokens_encrypted, form_data_json, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.id,
          taskId,
          JSON.stringify(encryptedCookies),
          JSON.stringify(snapshot.tabs),
          JSON.stringify(snapshot.sessionStorage),
          JSON.stringify(snapshot.localStorage),
          JSON.stringify(encryptedAuthTokens),
          JSON.stringify(snapshot.formData),
          snapshot.timestamp,
        ]
      );

      console.log(
        `[SessionPersistenceManager] Navis session captured: id=${snapshot.id} task=${taskId}`
      );

      return snapshot;
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to capture Navis session:', error);
      throw error;
    }
  }

  /**
   * Restore a Navis browser session
   *
   * Decrypts sensitive data and reconstructs the browser session state.
   *
   * Requirement 3.5: Restore all open tabs with their previous state
   * Requirement 3.6: Re-authenticate sessions using stored cookies and tokens
   *
   * @param snapshotId - Session snapshot identifier
   * @returns Restored session data with decrypted cookies and tokens
   */
  async restoreNavisSession(
    snapshotId: string
  ): Promise<{
    cookies: Record<string, string>;
    tabs: TabState[];
    sessionStorage: Record<string, string>;
    localStorage: Record<string, string>;
    authTokens: Record<string, string>;
    formData: Record<string, string>;
  }> {
    try {
      this.ensureInitialized();

      // Retrieve from database
      const row = await dbOps.get(
        `SELECT * FROM navis_sessions WHERE id = ?`,
        [snapshotId]
      );

      if (!row) {
        throw new Error(`Navis session ${snapshotId} not found`);
      }

      const encryptionService = getEncryptionService();

      // Decrypt sensitive data
      const encryptedCookies = JSON.parse(row['cookies_encrypted'] as string) as EncryptedData;
      const decryptedCookiesJson = await encryptionService.decrypt(encryptedCookies);
      const cookies = JSON.parse(decryptedCookiesJson.toString('utf8')) as Record<string, string>;

      const encryptedAuthTokens = JSON.parse(row['auth_tokens_encrypted'] as string) as EncryptedData;
      const decryptedAuthTokensJson = await encryptionService.decrypt(encryptedAuthTokens);
      const authTokens = JSON.parse(decryptedAuthTokensJson.toString('utf8')) as Record<string, string>;

      // Retrieve unencrypted data
      const tabs = JSON.parse(row['tabs_json'] as string) as TabState[];
      const sessionStorage = JSON.parse(row['session_storage_json'] as string) as Record<string, string>;
      const localStorage = JSON.parse(row['local_storage_json'] as string) as Record<string, string>;
      const formData = JSON.parse(row['form_data_json'] as string) as Record<string, string>;

      console.log(
        `[SessionPersistenceManager] Navis session restored: id=${snapshotId} tabs=${tabs.length}`
      );

      return {
        cookies,
        tabs,
        sessionStorage,
        localStorage,
        authTokens,
        formData,
      };
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to restore Navis session:', error);
      throw error;
    }
  }

  /**
   * Capture Computer Use Tool action history
   *
   * Records GUI actions with metadata for rollback support.
   *
   * Requirement 9.1: Record each GUI action with screen coordinates and timestamp
   * Requirement 9.2: Capture screenshots before and after each GUI action
   * Requirement 9.5: Log GUI action history to the Checkpoint_Store
   *
   * @param actions - Array of GUI actions to capture
   * @param taskId - Task identifier
   */
  async captureComputerUseActions(
    actions: ComputerUseAction[],
    taskId: string
  ): Promise<void> {
    try {
      this.ensureInitialized();

      for (const action of actions) {
        await dbOps.run(
          `INSERT INTO computer_use_actions
           (id, task_id, step_number, action, parameters_json,
            screenshot_before, screenshot_after, reversible,
            reverse_action_json, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            action.id,
            taskId,
            action.stepNumber,
            action.action,
            JSON.stringify(action.parameters),
            action.screenshotBefore,
            action.screenshotAfter,
            action.reversible ? 1 : 0,
            action.reverseAction,
            action.timestamp,
          ]
        );
      }

      console.log(
        `[SessionPersistenceManager] Captured ${actions.length} Computer Use actions for task ${taskId}`
      );
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to capture Computer Use actions:', error);
      throw error;
    }
  }

  /**
   * Restore Computer Use Tool action history
   *
   * Retrieves all GUI actions for a task to restore context and enable rollback.
   *
   * Requirement 9.5: Log GUI action history to the Checkpoint_Store
   *
   * @param taskId - Task identifier
   * @returns Array of recorded GUI actions
   */
  async restoreComputerUseContext(taskId: string): Promise<ComputerUseAction[]> {
    try {
      this.ensureInitialized();

      const rows = await dbOps.all(
        `SELECT * FROM computer_use_actions
         WHERE task_id = ?
         ORDER BY step_number ASC, timestamp ASC`,
        [taskId]
      );

      const actions: ComputerUseAction[] = rows.map((row: Record<string, unknown>) => ({
        id: row['id'] as string,
        taskId: row['task_id'] as string,
        stepNumber: row['step_number'] as number,
        action: row['action'] as string,
        parameters: JSON.parse(row['parameters_json'] as string) as Record<string, unknown>,
        screenshotBefore: row['screenshot_before'] as string | null,
        screenshotAfter: row['screenshot_after'] as string | null,
        timestamp: row['timestamp'] as number,
        reversible: (row['reversible'] as number) === 1,
        reverseAction: row['reverse_action_json'] as string | null,
      }));

      console.log(
        `[SessionPersistenceManager] Restored ${actions.length} Computer Use actions for task ${taskId}`
      );

      return actions;
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to restore Computer Use context:', error);
      return [];
    }
  }

  /**
   * Encrypt sensitive data
   *
   * Requirement 17.1: Encrypt authentication tokens using AES-256 encryption
   * Requirement 17.2: Encrypt browser cookies
   *
   * @param data - Data to encrypt
   * @returns Encrypted data structure
   */
  async encryptSensitiveData(data: string): Promise<EncryptedData> {
    try {
      this.ensureInitialized();
      const encryptionService = getEncryptionService();
      return await encryptionService.encrypt(data);
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to encrypt sensitive data:', error);
      throw error;
    }
  }

  /**
   * Decrypt sensitive data
   *
   * Requirement 17.1: Decrypt stored authentication tokens
   * Requirement 17.2: Decrypt stored browser cookies
   *
   * @param encrypted - Encrypted data structure
   * @returns Decrypted data as string
   */
  async decryptSensitiveData(encrypted: EncryptedData): Promise<string> {
    try {
      this.ensureInitialized();
      const encryptionService = getEncryptionService();
      const decrypted = await encryptionService.decrypt(encrypted);
      return decrypted.toString('utf8');
    } catch (error) {
      console.error('[SessionPersistenceManager] Failed to decrypt sensitive data:', error);
      throw error;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Ensure the manager is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'SessionPersistenceManager not initialized. Call initialize() first.'
      );
    }
  }

  /**
   * Retrieve a checkpoint by ID (private helper)
   */
  private async _getCheckpointById(checkpointId: string): Promise<Checkpoint | null> {
    const row = await dbOps.get(
      `SELECT * FROM agent_checkpoints WHERE id = ?`,
      [checkpointId]
    );

    if (!row) return null;

    // Convert row to checkpoint
    return {
      id: row['id'] as string,
      taskId: row['task_id'] as string,
      stepNumber: row['step_number'] as number,
      timestamp: row['timestamp'] as number,
      stateJson: row['state_json'] as string,
      stateHash: row['state_hash'] as string,
      deltaOnly: (row['delta_only'] as number) === 1,
      previousCheckpointId: (row['previous_checkpoint_id'] as string) || null,
      compressed: (row['compressed'] as number) === 1,
    };
  }
}

/**
 * Singleton instance of the session persistence manager
 */
let sessionManagerInstance: SessionPersistenceManager | null = null;

/**
 * Get or create the singleton session persistence manager instance
 *
 * @returns The session persistence manager instance
 */
export function getSessionPersistenceManager(): SessionPersistenceManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionPersistenceManager();
  }
  return sessionManagerInstance;
}

/**
 * Initialize the global session persistence manager
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeSessionPersistenceManager(): Promise<SessionPersistenceManager> {
  const manager = getSessionPersistenceManager();
  await manager.initialize();
  return manager;
}
