/**
 * Checkpoint Engine for Long-Running Agentic Tasks
 *
 * Automatic checkpointing system that captures agent state after every step.
 * Implements SHA-256 integrity hashing, async database I/O, and checkpoint
 * retrieval methods.
 *
 * Note: Uses the `agent_checkpoints` table to avoid conflicts with the
 * existing LangGraph `checkpoints` table (different schema).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2
 */

import * as crypto from 'crypto';
import { dbOps } from '../../lib/db';
import {
  serializeStateToJson,
  deserializeStateFromJsonAsync,
  serializeState,
  compressState,
  type SerializedState,
  type SerializedMessage,
} from './state-serializer';
import type { GraphStateType } from '../runner/state';

// ── Public types ──────────────────────────────────────────────────────

/**
 * A stored checkpoint representing a complete or delta agent state snapshot.
 *
 * Requirement 2.3: Store checkpoints in the Checkpoint_Store with unique identifiers
 * Requirement 2.4: Include timestamp, step number, and delta changes in each checkpoint
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint (UUID v4 format) */
  id: string;
  /** Task that owns this checkpoint */
  taskId: string;
  /** Agent step number when this checkpoint was created */
  stepNumber: number;
  /** Unix timestamp (ms) when this checkpoint was created */
  timestamp: number;
  /** Serialized GraphStateType (possibly gzip-compressed base64) */
  stateJson: string;
  /** SHA-256 hash of stateJson for integrity verification */
  stateHash: string;
  /** True for delta-only checkpoints (after the 10th checkpoint per task) */
  deltaOnly: boolean;
  /** ID of the previous checkpoint in the chain (null for full checkpoints) */
  previousCheckpointId: string | null;
  /** Whether stateJson is gzip-compressed */
  compressed: boolean;
}

/**
 * A failed checkpoint placeholder that preserves execution continuity.
 *
 * Requirement 2.5: When checkpoint creation fails, log error and continue execution
 */
export interface FailedCheckpoint extends Checkpoint {
  failed: true;
}

/**
 * Represents the changes between two checkpoints (delta format).
 * Used for incremental checkpointing to reduce storage requirements.
 *
 * Requirement 12.4: Implement incremental checkpointing storing only state deltas
 */
export interface CheckpointDelta {
  messagesAdded: SerializedMessage[];
  messagesRemoved: string[]; // IDs of messages that were removed
  stateFieldsChanged: Record<string, unknown>;
}

/**
 * A checkpoint stored in delta format (after the 10th checkpoint per task).
 * References the previous checkpoint and stores only the changes.
 *
 * Requirement 12.4: Implement incremental checkpointing storing only state deltas
 */
export interface IncrementalCheckpoint {
  checkpointId: string;
  previousCheckpointId: string;
  delta: CheckpointDelta;
  timestamp: number;
}

// ── Table name ────────────────────────────────────────────────────────

/**
 * Table name for agent checkpoints.
 *
 * Uses `agent_checkpoints` instead of `checkpoints` to avoid conflicts with
 * the existing LangGraph checkpoints table (different schema).
 */
export const AGENT_CHECKPOINTS_TABLE = 'agent_checkpoints';

// ── Schema initializer ────────────────────────────────────────────────

/**
 * Ensure the agent_checkpoints table exists.
 * Safe to call multiple times (idempotent).
 *
 * Requirement 2.1: Create checkpoint storage in the Checkpoint_Store
 */
export async function ensureAgentCheckpointsTable(): Promise<void> {
  await dbOps.exec(`
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      delta_only BOOLEAN DEFAULT 0,
      previous_checkpoint_id TEXT,
      compressed BOOLEAN DEFAULT 0,
      FOREIGN KEY (previous_checkpoint_id)
        REFERENCES agent_checkpoints(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_task_id
      ON agent_checkpoints(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_step
      ON agent_checkpoints(task_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_timestamp
      ON agent_checkpoints(timestamp);
  `);
}

// ── CheckpointEngine ──────────────────────────────────────────────────

/**
 * Engine for creating and retrieving agent state checkpoints.
 *
 * The engine is lightweight and stateless between calls; all persistent state
 * lives in the SQLite database.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2
 */
export class CheckpointEngine {
  /**
   * Whether the engine has been initialized (schema verified/created).
   */
  private initialized = false;

  /**
   * Initialize the engine, ensuring the database table exists.
   * Called lazily before the first write operation.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureAgentCheckpointsTable();
    this.initialized = true;
    console.log('[CheckpointEngine] Initialized — agent_checkpoints table ready');
  }

  // ── Core checkpoint creation ────────────────────────────────────────

  /**
   * Create a full checkpoint for the given agent state.
   *
   * Serializes the state to JSON (with optional gzip compression), computes
   * a SHA-256 hash for integrity verification, and persists to the database
   * using asynchronous I/O.
   *
   * On failure, logs the error and returns a placeholder checkpoint so that
   * agent execution is never interrupted.
   *
   * Requirement 2.1: Create a checkpoint after every agent step completion
   * Requirement 2.2: Create checkpoint within 200ms of tool call completion
   * Requirement 2.3: Store with unique identifiers
   * Requirement 2.4: Include timestamp, step number
   * Requirement 2.5: Log error and continue on failure
   * Requirement 12.2: Use asynchronous I/O for database writes
   */
  async createCheckpoint(
    state: GraphStateType,
    taskId: string
  ): Promise<Checkpoint | FailedCheckpoint> {
    try {
      return await this._serializeAndStore(state, taskId, false, null);
    } catch (error) {
      // Requirement 2.5: Log error but DO NOT throw — agent execution must continue
      console.error('[CheckpointEngine] Failed to create checkpoint:', error);

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
        failed: true,
      } satisfies FailedCheckpoint;
    }
  }

  /**
   * Create a delta checkpoint that only stores changes from the previous checkpoint.
   *
   * This method is used after the 10th checkpoint to reduce storage overhead.
   * It compares the current state with the previous checkpoint and stores only the delta.
   *
   * Requirement 12.4: Implement incremental checkpointing storing only state deltas
   * Requirement 2.4: Include timestamp and step number in each checkpoint
   */
  async createDeltaCheckpoint(
    state: GraphStateType,
    previousCheckpoint: Checkpoint,
    taskId: string
  ): Promise<Checkpoint | FailedCheckpoint> {
    try {
      await this.initialize();

      // Deserialize the previous checkpoint to compare
      const previousState = await this.deserializeCheckpointState(previousCheckpoint);

      // Calculate the delta between previous and current states
      const delta = this._calculateDelta(previousState, state);

      // Serialize the delta to JSON
      const deltaJson = JSON.stringify(delta, null, 2);

      // Compute hash of delta for integrity verification
      const stateHash = computeHash(deltaJson);

      // Generate checkpoint ID
      const id = generateCheckpointId();
      const stepNumber = (state as unknown as { iterations?: number }).iterations ?? 0;
      const timestamp = Date.now();

      // Store delta checkpoint in database (marked as deltaOnly: true)
      await dbOps.run(
        `INSERT INTO ${AGENT_CHECKPOINTS_TABLE}
           (id, task_id, step_number, timestamp, state_json, state_hash,
            delta_only, previous_checkpoint_id, compressed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          taskId,
          stepNumber,
          timestamp,
          deltaJson,
          stateHash,
          1, // deltaOnly = true
          previousCheckpoint.id,
          0, // not compressed for now (delta is usually small)
        ]
      );

      console.log(
        `[CheckpointEngine] Delta checkpoint created: id=${id} task=${taskId} step=${stepNumber} previous=${previousCheckpoint.id}`
      );

      return {
        id,
        taskId,
        stepNumber,
        timestamp,
        stateJson: deltaJson,
        stateHash,
        deltaOnly: true,
        previousCheckpointId: previousCheckpoint.id,
        compressed: false,
      };
    } catch (error) {
      // Requirement 2.5: Log error but DO NOT throw — agent execution must continue
      console.error('[CheckpointEngine] Failed to create delta checkpoint:', error);

      return {
        id: `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        stepNumber: (state as unknown as { iterations?: number }).iterations ?? 0,
        timestamp: Date.now(),
        stateJson: '',
        stateHash: '',
        deltaOnly: false,
        previousCheckpointId: previousCheckpoint.id,
        compressed: false,
        failed: true,
      } satisfies FailedCheckpoint;
    }
  }

  /**
   * Reconstruct full state from a delta checkpoint by applying all deltas
   * from the most recent full checkpoint.
   *
   * Walks the checkpoint chain backwards to find the last full checkpoint,
   * then applies all deltas forward to reconstruct the requested checkpoint.
   *
   * Requirement 12.4: Implement full state reconstruction from deltas
   */
  async reconstructStateFromDelta(
    checkpoint: Checkpoint
  ): Promise<SerializedState> {
    // If this is not a delta checkpoint, deserialize normally
    if (!checkpoint.deltaOnly) {
      return this.deserializeCheckpointState(checkpoint);
    }

    // Walk backwards to find the last full checkpoint
    let current = checkpoint;
    const deltaCheckpoints: Checkpoint[] = [];

    while (current.deltaOnly && current.previousCheckpointId) {
      deltaCheckpoints.push(current);
      const prev = await this.getCheckpointById(current.previousCheckpointId);
      if (!prev) {
        throw new Error(
          `[CheckpointEngine] Broken delta chain: cannot find checkpoint ${current.previousCheckpointId}`
        );
      }
      current = prev;
    }

    // current is now a full checkpoint
    let state = await this.deserializeCheckpointState(current);

    // Apply all deltas forward (we collected them backwards, so reverse)
    for (let i = deltaCheckpoints.length - 1; i >= 0; i--) {
      const deltaCheckpoint = deltaCheckpoints[i];
      const deltaJson = deltaCheckpoint.stateJson;
      const delta = JSON.parse(deltaJson) as CheckpointDelta;
      state = this._applyDelta(state, delta);
    }

    return state;
  }

  // ── Private helpers for delta calculation ─────────────────────────

  /**
   * Calculate the delta between two SerializedState objects.
   * Returns only the changes (added/removed messages and modified fields).
   */
  private _calculateDelta(
    previousState: SerializedState,
    currentState: GraphStateType
  ): CheckpointDelta {
    // Serialize current state for comparison
    const currentStateSerialized = serializeState(currentState);

    // Calculate message changes
    const previousMessageIds = new Set(previousState.messages.map((m: SerializedMessage) => m.id));
    const currentMessageIds = new Set(
      currentStateSerialized.messages.map((m: SerializedMessage) => m.id)
    );

    // Messages added: in current but not in previous
    const messagesAdded = currentStateSerialized.messages.filter(
      (m: SerializedMessage) => !previousMessageIds.has(m.id)
    );

    // Messages removed: in previous but not in current
    const messagesRemoved = Array.from(previousMessageIds).filter(
      (id) => !currentMessageIds.has(id)
    );

    // Calculate state field changes
    const stateFieldsChanged: Record<string, unknown> = {};

    // Check all fields that might have changed
    const fieldsToCheck = [
      'currentIntent',
      'intentConfidence',
      'decomposedTask',
      'taskPhase',
      'pendingToolCalls',
      'toolCallRecords',
      'activeAgent',
      'completionSignal',
      'routingDecision',
      'webExplorerComplete',
      'navisInvoked',
      'searchInvoked',
      'codingComplete',
      'missionId',
      'missionTimeline',
      'missionSteps',
      'agiHints',
      'pauseGeneration',
      'iterations',
      'validationResult',
      'shouldContinueIteration',
      'hitlApprovalResult',
      'currentStepId',
      'webExplorerSelfLoopCount',
      'dataAnalysisComplete',
      'computerUseComplete',
      'deepResearchComplete',
      'deepResearchSelfLoopCount',
      'subagentSpawned',
      'completedSteps',
      'decompositionAttempts',
      'brainToolsInFlight',
      'returningFromSpecialist',
      'debateResult',
      'toolCallHistory',
      'userConfirmation',
      'finalResponse',
    ] as const;

    for (const field of fieldsToCheck) {
      const prev = previousState[field as keyof SerializedState];
      const curr = currentStateSerialized[field as keyof SerializedState];
      if (!this._deepEqual(prev, curr)) {
        stateFieldsChanged[field] = curr;
      }
    }

    return {
      messagesAdded,
      messagesRemoved,
      stateFieldsChanged,
    };
  }

  /**
   * Apply a delta to a serialized state to produce the modified state.
   * Used during state reconstruction from delta checkpoints.
   */
  private _applyDelta(
    state: SerializedState,
    delta: CheckpointDelta
  ): SerializedState {
    // Apply message changes
    let messages = state.messages.filter(
      (m) => !delta.messagesRemoved.includes(m.id)
    );
    messages = [...messages, ...delta.messagesAdded];

    // Apply state field changes
    const updated = { ...state, messages };
    for (const [field, value] of Object.entries(delta.stateFieldsChanged)) {
      (updated as Record<string, unknown>)[field] = value;
    }

    return updated;
  }

  /**
   * Deep equality check for state objects.
   * Used to detect which fields have actually changed.
   */
  private _deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false;
      if (!this._deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Helper to retrieve a checkpoint by ID.
   * Used during delta reconstruction.
   */
  private async getCheckpointById(checkpointId: string): Promise<Checkpoint | null> {
    const row = await dbOps.get(
      `SELECT * FROM ${AGENT_CHECKPOINTS_TABLE} WHERE id = ?`,
      [checkpointId]
    );

    return row ? rowToCheckpoint(row) : null;
  }

  // ── Checkpoint compression ─────────────────────────────────────────

  /**
   * Compress a checkpoint's state JSON using gzip compression.
   *
   * If the checkpoint state is already compressed, returns as-is.
   * Updates the database record to mark the checkpoint as compressed.
   *
   * Requirement 12.3: Automatic compression when storage exceeds 1GB
   * Task 2.5: Add compressCheckpoint method using gzip
   */
  async compressCheckpoint(checkpoint: Checkpoint): Promise<Checkpoint> {
    if (checkpoint.compressed) {
      return checkpoint; // Already compressed
    }

    try {
      const compressed = await this._compressStateJson(checkpoint.stateJson);

      // Update database to mark as compressed
      await dbOps.run(
        `UPDATE ${AGENT_CHECKPOINTS_TABLE}
         SET state_json = ?, compressed = 1
         WHERE id = ?`,
        [compressed, checkpoint.id]
      );

      console.log(`[CheckpointEngine] Checkpoint ${checkpoint.id} compressed`);

      return {
        ...checkpoint,
        stateJson: compressed,
        compressed: true,
      };
    } catch (error) {
      console.error(`[CheckpointEngine] Failed to compress checkpoint ${checkpoint.id}:`, error);
      return checkpoint; // Return uncompressed on failure
    }
  }

  // ── Checkpoint retrieval ────────────────────────────────────────────

  /**
   * Retrieve the most recent checkpoint for a task.
   *
   * Returns null if no checkpoint exists.
   *
   * Requirement 2.3: Retrieve checkpoints from the Checkpoint_Store
   */
  async getLatestCheckpoint(taskId: string): Promise<Checkpoint | null> {
    await this.initialize();

    const row = await dbOps.get(
      `SELECT * FROM ${AGENT_CHECKPOINTS_TABLE}
       WHERE task_id = ?
       ORDER BY step_number DESC, timestamp DESC
       LIMIT 1`,
      [taskId]
    );

    return row ? rowToCheckpoint(row) : null;
  }

  /**
   * Retrieve the checkpoint recorded at a specific step number for a task.
   *
   * Returns null if no checkpoint exists for that step.
   *
   * Requirement 2.4: Include step number in each checkpoint
   */
  async getCheckpointAtStep(
    taskId: string,
    stepNumber: number
  ): Promise<Checkpoint | null> {
    await this.initialize();

    const row = await dbOps.get(
      `SELECT * FROM ${AGENT_CHECKPOINTS_TABLE}
       WHERE task_id = ? AND step_number = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [taskId, stepNumber]
    );

    return row ? rowToCheckpoint(row) : null;
  }

  /**
   * List checkpoints for a task, ordered from newest to oldest.
   *
   * @param taskId  - Task identifier to query
   * @param limit   - Maximum number of checkpoints to return (default: 50)
   *
   * Requirement 2.3: Retrieve checkpoints from the Checkpoint_Store
   */
  async listCheckpoints(
    taskId: string,
    limit: number = 50
  ): Promise<Checkpoint[]> {
    await this.initialize();

    const rows = await dbOps.all(
      `SELECT * FROM ${AGENT_CHECKPOINTS_TABLE}
       WHERE task_id = ?
       ORDER BY step_number DESC, timestamp DESC
       LIMIT ?`,
      [taskId, limit]
    );

    return rows.map(rowToCheckpoint);
  }

  // ── Checkpoint cleanup ──────────────────────────────────────────────

  /**
   * Remove old checkpoints for a task, keeping only the most recent N.
   *
   * Requirement 2.6: Implement automatic checkpoint cleanup retaining the last 100 checkpoints per task
   * Task 2.5: Implement pruneOldCheckpoints method (keep last 100)
   *
   * @param taskId     - Task identifier to prune
   * @param keepCount  - Number of most recent checkpoints to retain (default: 100)
   * @returns Number of checkpoints deleted
   */
  async pruneOldCheckpoints(taskId: string, keepCount: number = 100): Promise<number> {
    await this.initialize();

    try {
      // Get checkpoints to delete (all except last N ordered by step_number DESC, timestamp DESC)
      const oldCheckpoints = await dbOps.all(
        `SELECT id FROM ${AGENT_CHECKPOINTS_TABLE}
         WHERE task_id = ?
         ORDER BY step_number DESC, timestamp DESC
         LIMIT -1 OFFSET ?`,
        [taskId, keepCount]
      );

      if (oldCheckpoints.length === 0) {
        return 0;
      }

      const idsToDelete = oldCheckpoints.map((c: Record<string, unknown>) => c['id']);

      // Delete old checkpoints
      await dbOps.run(
        `DELETE FROM ${AGENT_CHECKPOINTS_TABLE}
         WHERE id IN (${idsToDelete.map(() => '?').join(',')})`,
        idsToDelete
      );

      console.log(
        `[CheckpointEngine] Pruned ${idsToDelete.length} old checkpoints for task ${taskId}, keeping last ${keepCount}`
      );

      return idsToDelete.length;
    } catch (error) {
      console.error(`[CheckpointEngine] Failed to prune checkpoints for task ${taskId}:`, error);
      return 0;
    }
  }

  // ── Storage management ──────────────────────────────────────────────

  /**
   * Get the approximate total storage size of checkpoints for a task (in bytes).
   *
   * Requirement 12.3: Automatic compression when storage exceeds 1GB
   */
  private async _getCheckpointStorageSize(taskId: string): Promise<number> {
    const result = await dbOps.get(
      `SELECT COALESCE(SUM(LENGTH(state_json)), 0) as total_bytes
       FROM ${AGENT_CHECKPOINTS_TABLE}
       WHERE task_id = ?`,
      [taskId]
    );

    return result?.['total_bytes'] as number || 0;
  }

  /**
   * Check if total checkpoint storage exceeds threshold and compress oldest checkpoints if needed.
   *
   * Compresses uncompressed checkpoints starting from oldest until storage is below threshold.
   * Does not delete checkpoints — only compresses them.
   *
   * Requirement 12.3: Automatic compression when storage exceeds 1GB
   * Task 2.5: Implement automatic compression when storage exceeds 1GB
   *
   * @param taskId             - Task identifier
   * @param thresholdBytes     - Storage threshold in bytes (default: 1GB)
   * @returns Number of checkpoints compressed
   */
  async compressCheckpointsIfNeeded(
    taskId: string,
    thresholdBytes: number = 1024 * 1024 * 1024 // 1GB
  ): Promise<number> {
    await this.initialize();

    try {
      const currentSize = await this._getCheckpointStorageSize(taskId);

      if (currentSize <= thresholdBytes) {
        return 0; // Below threshold, no compression needed
      }

      console.log(
        `[CheckpointEngine] Checkpoint storage for task ${taskId} exceeds ${thresholdBytes} bytes (current: ${currentSize}), compressing...`
      );

      // Get oldest uncompressed checkpoints
      const uncompressedCheckpoints = await dbOps.all(
        `SELECT * FROM ${AGENT_CHECKPOINTS_TABLE}
         WHERE task_id = ? AND compressed = 0
         ORDER BY timestamp ASC`,
        [taskId]
      );

      let compressed = 0;

      for (const row of uncompressedCheckpoints) {
        const checkpoint = rowToCheckpoint(row);
        await this.compressCheckpoint(checkpoint);
        compressed++;

        // Recheck size after each compression
        const newSize = await this._getCheckpointStorageSize(taskId);
        if (newSize <= thresholdBytes) {
          console.log(
            `[CheckpointEngine] Storage reduced to ${newSize} bytes after ${compressed} compressions`
          );
          break;
        }
      }

      return compressed;
    } catch (error) {
      console.error(
        `[CheckpointEngine] Failed to compress checkpoints for task ${taskId}:`,
        error
      );
      return 0;
    }
  }

  // ── Batch operations ────────────────────────────────────────────────

  /**
   * Create multiple checkpoints in rapid succession using a batch write operation.
   *
   * Useful for checkpoint sequences during rapid agent iterations or state updates.
   * This uses a single transaction for efficiency.
   *
   * Requirement 12.5: Batch write functionality for rapid checkpoint sequences
   * Task 2.5: Add batch write functionality for rapid checkpoint sequences
   *
   * @param states   - Array of agent states to checkpoint
   * @param taskId   - Task identifier
   * @returns Array of created checkpoints in the same order as input states
   */
  async batchCreateCheckpoints(
    states: GraphStateType[],
    taskId: string
  ): Promise<(Checkpoint | FailedCheckpoint)[]> {
    await this.initialize();

    const checkpoints: (Checkpoint | FailedCheckpoint)[] = [];

    try {
      // Begin transaction for batch write
      await dbOps.run('BEGIN TRANSACTION');

      for (const state of states) {
        try {
          const checkpoint = await this._serializeAndStore(state, taskId, false, null);
          checkpoints.push(checkpoint);
        } catch (error) {
          console.error('[CheckpointEngine] Failed to create checkpoint in batch:', error);
          checkpoints.push({
            id: `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            taskId,
            stepNumber: (state as unknown as { iterations?: number }).iterations ?? 0,
            timestamp: Date.now(),
            stateJson: '',
            stateHash: '',
            deltaOnly: false,
            previousCheckpointId: null,
            compressed: false,
            failed: true,
          } satisfies FailedCheckpoint);
        }
      }

      // Commit transaction
      await dbOps.run('COMMIT');

      console.log(
        `[CheckpointEngine] Batch created ${checkpoints.length} checkpoints for task ${taskId}`
      );
    } catch (error) {
      console.error('[CheckpointEngine] Batch write transaction failed:', error);
      await dbOps.run('ROLLBACK').catch(() => {
        // Ignore rollback errors
      });
    }

    return checkpoints;
  }

  // ── Integrity verification ──────────────────────────────────────────

  /**
   * Verify the integrity of a stored checkpoint by recomputing its hash.
   *
   * Returns true when the stored hash matches the recomputed hash.
   *
   * Requirement 12.2: SHA-256 hashing for checkpoint integrity verification
   */
  verifyCheckpointIntegrity(checkpoint: Checkpoint): boolean {
    if (!checkpoint.stateJson || !checkpoint.stateHash) return false;
    const expected = computeHash(checkpoint.stateJson);
    return expected === checkpoint.stateHash;
  }

  /**
   * Deserialize the state from a checkpoint back into a SerializedState object.
   *
   * Handles both plain JSON and gzip-compressed states transparently.
   */
  async deserializeCheckpointState(
    checkpoint: Checkpoint
  ): Promise<SerializedState> {
    return deserializeStateFromJsonAsync(checkpoint.stateJson);
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Core serialization and database write logic.
   *
   * Requirement 12.2: Asynchronous I/O for database writes
   */
  private async _serializeAndStore(
    state: GraphStateType,
    taskId: string,
    deltaOnly: boolean,
    previousCheckpointId: string | null
  ): Promise<Checkpoint> {
    await this.initialize();

    const stepNumber =
      (state as unknown as { iterations?: number }).iterations ?? 0;

    // Serialize the state (with optional gzip compression for large states)
    const { json: stateJson, compressed } = await serializeStateToJson(state);

    // Compute SHA-256 hash for integrity verification
    // Requirement 12.2: SHA-256 hashing
    const stateHash = computeHash(stateJson);

    // Generate a unique checkpoint ID
    const id = generateCheckpointId();
    const timestamp = Date.now();

    // Persist to database asynchronously (non-blocking relative to agent execution)
    // Requirement 12.2: Asynchronous I/O for database writes
    await dbOps.run(
      `INSERT INTO ${AGENT_CHECKPOINTS_TABLE}
         (id, task_id, step_number, timestamp, state_json, state_hash,
          delta_only, previous_checkpoint_id, compressed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        taskId,
        stepNumber,
        timestamp,
        stateJson,
        stateHash,
        deltaOnly ? 1 : 0,
        previousCheckpointId,
        compressed ? 1 : 0,
      ]
    );

    console.log(
      `[CheckpointEngine] Checkpoint created: id=${id} task=${taskId} step=${stepNumber} compressed=${compressed}`
    );

    return {
      id,
      taskId,
      stepNumber,
      timestamp,
      stateJson,
      stateHash,
      deltaOnly,
      previousCheckpointId,
      compressed,
    };
  }

  /**
   * Compress a state JSON string using gzip.
   *
   * Task 2.5: Add compressCheckpoint method using gzip
   */
  private async _compressStateJson(stateJson: string): Promise<string> {
    // Use the compression utilities from state-serializer
    return compressState(stateJson);
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hex digest of a string.
 *
 * Requirement 12.2 / design.md: SHA-256 hashing for checkpoint integrity
 */
export function computeHash(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Generate a unique checkpoint identifier.
 *
 * Uses a combination of timestamp and random bytes for guaranteed uniqueness
 * even under rapid sequential calls.
 *
 * Requirement 2.3: Store checkpoints with unique identifiers
 */
export function generateCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `ckpt-${timestamp}-${random}`;
}

/**
 * Map a raw SQLite row object to a typed Checkpoint.
 */
function rowToCheckpoint(row: Record<string, unknown>): Checkpoint {
  return {
    id: String(row['id']),
    taskId: String(row['task_id']),
    stepNumber: Number(row['step_number']),
    timestamp: Number(row['timestamp']),
    stateJson: String(row['state_json']),
    stateHash: String(row['state_hash']),
    deltaOnly: Boolean(row['delta_only']),
    previousCheckpointId:
      row['previous_checkpoint_id'] != null
        ? String(row['previous_checkpoint_id'])
        : null,
    compressed: Boolean(row['compressed']),
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _instance: CheckpointEngine | null = null;

/**
 * Get (or create) the singleton CheckpointEngine instance.
 */
export function getCheckpointEngine(): CheckpointEngine {
  if (!_instance) {
    _instance = new CheckpointEngine();
  }
  return _instance;
}
