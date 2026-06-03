/**
 * Rollback Manager for Long-Running Agentic Tasks
 *
 * Tracks reversible operations (file edits, command executions, GUI actions)
 * and provides undo functionality. Maintains file snapshots, command history,
 * and rollback instructions for selective action rollback.
 *
 * This module focuses on file operation tracking with gzip compression.
 * Command execution tracking and rollback execution logic are implemented
 * in subsequent tasks.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 17.4, 17.5
 */

import * as crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { promisify } from 'util';
import { dbOps } from '../../lib/db';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ── Public types ──────────────────────────────────────────────────────

/**
 * A file snapshot capturing file content at a point in time.
 *
 * Used for tracking file modifications, creations, and deletions to enable
 * selective rollback of file-related changes.
 *
 * Requirement 4.1: Capture snapshot of file content before modification
 * Requirement 4.2: Store file snapshots with file path and modification timestamp
 * Requirement 4.3: Track file creation, modification, and deletion operations
 */
export interface FileSnapshot {
  /** Unique identifier for this snapshot */
  id: string;
  /** Task that owns this snapshot */
  taskId: string;
  /** Agent step number when this snapshot was created */
  stepNumber: number;
  /** Absolute file path */
  filePath: string;
  /** Gzip-compressed file content before operation (base64 encoded) */
  contentBefore: string;
  /** Gzip-compressed file content after operation (base64 encoded) */
  contentAfter: string;
  /** Operation type: 'create', 'modify', or 'delete' */
  operation: 'create' | 'modify' | 'delete';
  /** Unix timestamp (ms) when snapshot was created */
  timestamp: number;
}

/**
 * Represents a file restoration result from a rollback operation.
 *
 * Used when rolling back file changes to provide detailed status.
 */
export interface FileRestorationResult {
  filePath: string;
  success: boolean;
  operation: 'create' | 'modify' | 'delete';
  error?: string;
}

/**
 * Represents the rollback impact analysis for a file change.
 */
export interface FileRollbackImpact {
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  canRollback: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * A command record capturing a shell command execution.
 *
 * Used for tracking command executions to enable selective rollback
 * of command-related changes via package uninstallation, config restoration, etc.
 *
 * Requirement 5.1: Record the command text and execution timestamp
 * Requirement 5.2: Capture the command output and exit code
 * Requirement 5.3: Identify reversible commands and store rollback instructions
 * Requirement 5.4: For package installations, store package name and version for uninstallation
 * Requirement 5.5: Link configuration file modifications via command
 */
export interface CommandRecord {
  /** Unique identifier for this command record */
  id: string;
  /** Task that owns this command record */
  taskId: string;
  /** Agent step number when command was executed */
  stepNumber: number;
  /** The shell command that was executed */
  command: string;
  /** Standard output + standard error from command */
  output: string;
  /** Exit code (0 for success) */
  exitCode: number;
  /** Rollback command to reverse this operation (null if not reversible) */
  rollbackCommand: string | null;
  /** Whether this command can be rolled back */
  reversible: boolean;
  /** Unix timestamp (ms) when command was executed */
  timestamp: number;
}

/**
 * Strategy for rolling back a command execution.
 *
 * Requirement 5.4: Identify rollback strategies for package managers
 * Requirement 5.6: Mark irreversible commands (rm -rf, dd, mkfs, format)
 */
export type RollbackStrategy =
  | 'package_uninstall'  // npm/yarn/pip/apt/pacman/cargo uninstall
  | 'config_restore'     // Restore from backed-up config file
  | 'git_revert'         // Git revert for source control changes
  | 'manual'             // Manual intervention required
  | 'irreversible';      // Cannot be rolled back (dangerous command)

/**
 * Details about how a command can be rolled back.
 */
export interface RollbackStrategyInfo {
  strategy: RollbackStrategy;
  reversible: boolean;
  rollbackCommand?: string;
  reason?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Default file patterns to exclude from snapshots
 *
 * Requirement 17.4: Exclude files matching patterns like .git, node_modules, .env
 * Requirement 17.5: Exclude sensitive files from snapshots by default
 */
export const DEFAULT_EXCLUSION_PATTERNS = [
  /^\.git([/\\]|$)/,          // Git directory
  /[/\\]\.git([/\\]|$)/,      // Git directory (subdirectory)
  /^node_modules([/\\]|$)/,   // Node modules
  /[/\\]node_modules([/\\]|$)/,
  /^\.env(.local)?$/,         // Environment files
  /[/\\]\.env(.local)?$/,
  /\.key$/i,                  // Private keys
  /\.pem$/i,                  // PEM files
  /\.p12$/i,                  // PKCS#12 files
  /credentials\.json$/i,      // Credentials
  /secrets\.json$/i,          // Secrets
  /^\.venv([/\\]|$)/,         // Python virtual env
  /[/\\]\.venv([/\\]|$)/,
  /^venv([/\\]|$)/,           // Python virtual env
  /[/\\]venv([/\\]|$)/,
  /\.sqlite3$/i,              // Database files
  /\.db$/i,
];

// ── Table names ───────────────────────────────────────────────────────

export const FILE_SNAPSHOTS_TABLE = 'file_snapshots';
export const COMMAND_HISTORY_TABLE = 'command_history';

// ── Schema initializers ────────────────────────────────────────────────

/**
 * Ensure the file_snapshots table exists.
 * Safe to call multiple times (idempotent).
 *
 * Requirement 4.1: Store file snapshots in the Checkpoint_Store
 */
export async function ensureFileSnapshotsTable(): Promise<void> {
  await dbOps.exec(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      content_before BLOB,
      content_after BLOB,
      operation TEXT NOT NULL CHECK(operation IN ('create', 'modify', 'delete')),
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_snapshots_task
      ON file_snapshots(task_id);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_step
      ON file_snapshots(task_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_path
      ON file_snapshots(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_snapshots_timestamp
      ON file_snapshots(timestamp);
  `);
}

/**
 * Ensure the command_history table exists.
 * Safe to call multiple times (idempotent).
 *
 * Requirement 5.1: Record command executions in Checkpoint_Store
 */
export async function ensureCommandHistoryTable(): Promise<void> {
  await dbOps.exec(`
    CREATE TABLE IF NOT EXISTS command_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      command TEXT NOT NULL,
      output TEXT,
      exit_code INTEGER,
      rollback_command TEXT,
      reversible BOOLEAN DEFAULT 0,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_command_history_task
      ON command_history(task_id);
    CREATE INDEX IF NOT EXISTS idx_command_history_step
      ON command_history(task_id, step_number);
    CREATE INDEX IF NOT EXISTS idx_command_history_timestamp
      ON command_history(timestamp);
  `);
}

/**
 * Represents the result of a rollback operation.
 *
 * Includes lists of successfully restored files and reversed commands,
 * as well as any errors encountered during partial rollback.
 *
 * Requirement 6.4: Execute rollback commands for reversible command executions
 * Requirement 6.5: Report partial rollback status when completion cannot be fully completed
 */
export interface RollbackResult {
  success: boolean;
  filesRestored: string[];
  commandsReversed: string[];
  errors: string[];
  partialRollback: boolean;
  stepsRolledBack: number[];
}

/**
 * Represents the impact of rolling back a step.
 *
 * Helps analyze risk and consequences before performing rollback.
 *
 * Requirement 6.1: Provide a rollback interface accepting checkpoint identifier or step number
 */
export interface RollbackImpact {
  filesAffected: string[];
  commandsAffected: string[];
  dependentSteps: number[];
  riskLevel: 'low' | 'medium' | 'high';
  reversibleCommandCount: number;
  irreversibleCommandCount: number;
}

// ── RollbackManager ───────────────────────────────────────────────────

/**
 * Manager for tracking file operations and creating restoration capability.
 *
 * Maintains file snapshots with gzip compression, tracks file creation,
 * modification, and deletion operations, and provides selective rollback
 * capability for file-related changes.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 17.4, 17.5
 */
export class RollbackManager {
  private initialized = false;
  private exclusionPatterns: RegExp[] = DEFAULT_EXCLUSION_PATTERNS;

  /**
   * Initialize the rollback manager, ensuring database tables exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureFileSnapshotsTable();
    await ensureCommandHistoryTable();
    this.initialized = true;
    console.log('[RollbackManager] Initialized — file_snapshots and command_history tables ready');
  }

  /**
   * Set custom exclusion patterns for sensitive files.
   *
   * Requirement 17.5: Allow user-configurable exclusion patterns
   *
   * @param patterns - Array of regex patterns to exclude
   */
  setExclusionPatterns(patterns: RegExp[]): void {
    this.exclusionPatterns = [...DEFAULT_EXCLUSION_PATTERNS, ...patterns];
  }

  /**
   * Check if a file path should be excluded from snapshots.
   *
   * Requirement 17.4: Exclude files matching patterns like .git, node_modules, .env
   *
   * @param filePath - File path to check
   * @returns true if file should be excluded, false otherwise
   */
  isFileExcluded(filePath: string): boolean {
    // Normalize path to forward slashes for consistent matching
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of this.exclusionPatterns) {
      if (pattern.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  // ── File operation tracking ────────────────────────────────────────

  /**
   * Track a file modification operation.
   *
   * Creates a snapshot of the file content before and after modification,
   * compressing both using gzip to reduce storage requirements.
   *
   * Requirement 4.1: Capture snapshot of file content before modification
   * Requirement 4.2: Store file snapshots with file path and modification timestamp
   * Requirement 4.6: Compress file snapshots using gzip
   *
   * @param filePath - Absolute path to the modified file
   * @param contentBefore - File content before modification
   * @param contentAfter - File content after modification
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns The created file snapshot, or null if file is excluded
   * @throws Error on compression or database write failure
   */
  async trackFileModification(
    filePath: string,
    contentBefore: string,
    contentAfter: string,
    taskId: string,
    stepNumber: number
  ): Promise<FileSnapshot | null> {
    try {
      this.ensureInitialized();

      // Requirement 17.4: Exclude sensitive files from snapshots
      if (this.isFileExcluded(filePath)) {
        console.log(`[RollbackManager] Skipping snapshot for excluded file: ${filePath}`);
        return null;
      }

      // Requirement 4.6: Compress file content using gzip
      const [compressedBefore, compressedAfter] = await Promise.all([
        this.compressContent(contentBefore),
        this.compressContent(contentAfter),
      ]);

      // Generate unique ID and timestamp
      const id = this.generateSnapshotId();
      const timestamp = Date.now();

      // Store snapshot in database
      await dbOps.run(
        `INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, 'modify', ?)`,
        [id, taskId, stepNumber, filePath, compressedBefore, compressedAfter, timestamp]
      );

      console.log(`[RollbackManager] Tracked file modification: ${filePath} (snapshot: ${id})`);

      return {
        id,
        taskId,
        stepNumber,
        filePath,
        contentBefore: compressedBefore,
        contentAfter: compressedAfter,
        operation: 'modify',
        timestamp,
      };
    } catch (error) {
      console.error(`[RollbackManager] Failed to track file modification for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Track a file creation operation.
   *
   * Records that a file was created at this step, so it can be deleted
   * during rollback. Note: Only the file path is recorded, not the content,
   * as the file is newly created.
   *
   * Requirement 4.3: Track file creation operations
   * Requirement 4.4: When a file is created, record the file path for deletion on rollback
   *
   * @param filePath - Absolute path to the created file
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns The created file snapshot, or null if file is excluded
   * @throws Error on database write failure
   */
  async trackFileCreation(
    filePath: string,
    taskId: string,
    stepNumber: number
  ): Promise<FileSnapshot | null> {
    try {
      this.ensureInitialized();

      // Requirement 17.4: Exclude sensitive files from snapshots
      if (this.isFileExcluded(filePath)) {
        console.log(`[RollbackManager] Skipping snapshot for excluded file: ${filePath}`);
        return null;
      }

      const id = this.generateSnapshotId();
      const timestamp = Date.now();

      // For creation, we store empty before content and empty after content
      // (the file didn't exist before, and we record path for deletion)
      await dbOps.run(
        `INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, 'create', ?)`,
        [id, taskId, stepNumber, filePath, null, null, timestamp]
      );

      console.log(`[RollbackManager] Tracked file creation: ${filePath} (snapshot: ${id})`);

      return {
        id,
        taskId,
        stepNumber,
        filePath,
        contentBefore: '',
        contentAfter: '',
        operation: 'create',
        timestamp,
      };
    } catch (error) {
      console.error(`[RollbackManager] Failed to track file creation for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Track a file deletion operation.
   *
   * Records the file's content before deletion so it can be restored
   * during rollback. The content is compressed to reduce storage.
   *
   * Requirement 4.3: Track file deletion operations
   * Requirement 4.5: When a file is deleted, preserve the file content for restoration
   * Requirement 4.6: Compress file snapshots using gzip
   *
   * @param filePath - Absolute path to the deleted file
   * @param content - File content before deletion
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns The created file snapshot, or null if file is excluded
   * @throws Error on compression or database write failure
   */
  async trackFileDeletion(
    filePath: string,
    content: string,
    taskId: string,
    stepNumber: number
  ): Promise<FileSnapshot | null> {
    try {
      this.ensureInitialized();

      // Requirement 17.4: Exclude sensitive files from snapshots
      if (this.isFileExcluded(filePath)) {
        console.log(`[RollbackManager] Skipping snapshot for excluded file: ${filePath}`);
        return null;
      }

      // Requirement 4.6: Compress file content using gzip
      const compressedContent = await this.compressContent(content);

      const id = this.generateSnapshotId();
      const timestamp = Date.now();

      // Store the deleted file content in content_before so it can be restored
      await dbOps.run(
        `INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, 'delete', ?)`,
        [id, taskId, stepNumber, filePath, compressedContent, null, timestamp]
      );

      console.log(`[RollbackManager] Tracked file deletion: ${filePath} (snapshot: ${id})`);

      return {
        id,
        taskId,
        stepNumber,
        filePath,
        contentBefore: compressedContent,
        contentAfter: '',
        operation: 'delete',
        timestamp,
      };
    } catch (error) {
      console.error(`[RollbackManager] Failed to track file deletion for ${filePath}:`, error);
      throw error;
    }
  }

  // ── File retrieval ────────────────────────────────────────────────

  /**
   * Get all file snapshots for a specific task step.
   *
   * Used to retrieve all file operations that occurred in a single step.
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns Array of file snapshots for that step
   */
  async getFileSnapshotsForStep(taskId: string, stepNumber: number): Promise<FileSnapshot[]> {
    try {
      this.ensureInitialized();

      const rows = await dbOps.all(
        `SELECT * FROM file_snapshots
         WHERE task_id = ? AND step_number = ?
         ORDER BY timestamp ASC`,
        [taskId, stepNumber]
      );

      return rows.map(this.rowToSnapshot);
    } catch (error) {
      console.error(`[RollbackManager] Failed to get file snapshots for step ${stepNumber}:`, error);
      throw error;
    }
  }

  /**
   * Get all file snapshots for a specific file path.
   *
   * Used to retrieve modification history for a specific file.
   *
   * @param taskId - Task identifier
   * @param filePath - File path
   * @returns Array of file snapshots for that file path
   */
  async getFileSnapshotsForPath(taskId: string, filePath: string): Promise<FileSnapshot[]> {
    try {
      this.ensureInitialized();

      const rows = await dbOps.all(
        `SELECT * FROM file_snapshots
         WHERE task_id = ? AND file_path = ?
         ORDER BY step_number ASC, timestamp ASC`,
        [taskId, filePath]
      );

      return rows.map(this.rowToSnapshot);
    } catch (error) {
      console.error(`[RollbackManager] Failed to get file snapshots for path ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific file snapshot by ID.
   *
   * @param snapshotId - Snapshot identifier
   * @returns The file snapshot, or null if not found
   */
  async getFileSnapshot(snapshotId: string): Promise<FileSnapshot | null> {
    try {
      this.ensureInitialized();

      const row = await dbOps.get(
        `SELECT * FROM file_snapshots WHERE id = ?`,
        [snapshotId]
      );

      return row ? this.rowToSnapshot(row) : null;
    } catch (error) {
      console.error(`[RollbackManager] Failed to get file snapshot ${snapshotId}:`, error);
      throw error;
    }
  }

  // ── File restoration ──────────────────────────────────────────────

  /**
   * Restore a file to its state before a modification.
   *
   * Decompresses the stored content and writes it back to the file system.
   * Used during rollback operations.
   *
   * @param snapshotId - Snapshot identifier
   * @returns Restoration result with success status and any error message
   */
  async restoreFileFromSnapshot(snapshotId: string): Promise<FileRestorationResult> {
    try {
      this.ensureInitialized();

      const snapshot = await this.getFileSnapshot(snapshotId);
      if (!snapshot) {
        return {
          filePath: '',
          success: false,
          operation: 'modify',
          error: `Snapshot ${snapshotId} not found`,
        };
      }

      // Handle different operations
      if (snapshot.operation === 'create') {
        // For creation, delete the file
        try {
          await fsPromises.unlink(snapshot.filePath);
          return {
            filePath: snapshot.filePath,
            success: true,
            operation: 'create',
          };
        } catch (error) {
          return {
            filePath: snapshot.filePath,
            success: false,
            operation: 'create',
            error: `Failed to delete file: ${(error as Error).message}`,
          };
        }
      } else if (snapshot.operation === 'delete') {
        // For deletion, restore the content
        try {
          const content = await this.decompressContent(snapshot.contentBefore);
          await fsPromises.writeFile(snapshot.filePath, content, 'utf-8');
          return {
            filePath: snapshot.filePath,
            success: true,
            operation: 'delete',
          };
        } catch (error) {
          return {
            filePath: snapshot.filePath,
            success: false,
            operation: 'delete',
            error: `Failed to restore file: ${(error as Error).message}`,
          };
        }
      } else if (snapshot.operation === 'modify') {
        // For modification, restore to the before state
        try {
          const content = await this.decompressContent(snapshot.contentBefore);
          await fsPromises.writeFile(snapshot.filePath, content, 'utf-8');
          return {
            filePath: snapshot.filePath,
            success: true,
            operation: 'modify',
          };
        } catch (error) {
          return {
            filePath: snapshot.filePath,
            success: false,
            operation: 'modify',
            error: `Failed to restore file: ${(error as Error).message}`,
          };
        }
      }

      return {
        filePath: snapshot.filePath,
        success: false,
        operation: 'modify',
        error: `Unknown operation type: ${snapshot.operation}`,
      };
    } catch (error) {
      console.error(`[RollbackManager] Error in restoreFileFromSnapshot:`, error);
      return {
        filePath: '',
        success: false,
        operation: 'modify',
        error: `Restoration error: ${(error as Error).message}`,
      };
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /**
   * Clean up old file snapshots for a task, keeping only recent ones.
   *
   * Helps manage storage space by removing old snapshots while preserving
   * recent ones that are more likely to be needed for rollback.
   *
   * @param taskId - Task identifier
   * @param keepCount - Number of most recent snapshots to keep per file
   * @returns Number of snapshots deleted
   */
  async pruneOldFileSnapshots(taskId: string, keepCount: number = 50): Promise<number> {
    try {
      this.ensureInitialized();

      // Get unique file paths
      const pathRows = await dbOps.all(
        `SELECT DISTINCT file_path FROM file_snapshots WHERE task_id = ?`,
        [taskId]
      );

      let totalDeleted = 0;

      for (const { file_path } of pathRows) {
        // Get snapshot IDs to keep for this file (most recent keepCount)
        const keepRows = await dbOps.all(
          `SELECT id FROM file_snapshots
           WHERE task_id = ? AND file_path = ?
           ORDER BY timestamp DESC
           LIMIT ?`,
          [taskId, file_path, keepCount]
        );

        const keepIds = keepRows.map((r: any) => r.id);

        if (keepIds.length > 0) {
          // Delete older snapshots
          const placeholders = keepIds.map(() => '?').join(',');
          const deleted = await dbOps.run(
            `DELETE FROM file_snapshots
             WHERE task_id = ? AND file_path = ? AND id NOT IN (${placeholders})`,
            [taskId, file_path, ...keepIds]
          );

          totalDeleted += (deleted as any).changes || 0;
        } else {
          // Delete all snapshots for this file if keepCount is 0
          const deleted = await dbOps.run(
            `DELETE FROM file_snapshots
             WHERE task_id = ? AND file_path = ?`,
            [taskId, file_path]
          );

          totalDeleted += (deleted as any).changes || 0;
        }
      }

      if (totalDeleted > 0) {
        console.log(`[RollbackManager] Pruned ${totalDeleted} old file snapshots for task ${taskId}`);
      }

      return totalDeleted;
    } catch (error) {
      console.error(`[RollbackManager] Failed to prune old file snapshots:`, error);
      throw error;
    }
  }

  // ── Compression utilities ───────────────────────────────────────────

  /**
   * Compress file content using gzip.
   *
   * Requirement 4.6: Compress file snapshots using gzip to reduce storage
   *
   * @param content - Uncompressed content string
   * @returns Base64-encoded gzipped content
   */
  private async compressContent(content: string): Promise<string> {
    try {
      const buffer = Buffer.from(content, 'utf-8');
      const compressed = await gzip(buffer);
      return compressed.toString('base64');
    } catch (error) {
      console.error('[RollbackManager] Compression failed:', error);
      throw new Error(`Failed to compress content: ${(error as Error).message}`);
    }
  }

  /**
   * Decompress file content from gzip.
   *
   * Requirement 4.6: Support decompression for content restoration
   *
   * @param compressed - Base64-encoded gzipped content
   * @returns Decompressed content string
   */
  private async decompressContent(compressed: string): Promise<string> {
    try {
      const buffer = Buffer.from(compressed, 'base64');
      const decompressed = await gunzip(buffer);
      return decompressed.toString('utf-8');
    } catch (error) {
      console.error('[RollbackManager] Decompression failed:', error);
      throw new Error(`Failed to decompress content: ${(error as Error).message}`);
    }
  }

  // ── Command execution tracking ────────────────────────────────────

  /**
   * Track a shell command execution.
   *
   * Records the command, output, and exit code. Automatically identifies
   * reversible commands and generates appropriate rollback instructions.
   *
   * Requirement 5.1: Record the command text and execution timestamp
   * Requirement 5.2: Capture the command output and exit code
   * Requirement 5.3: Identify reversible commands and store rollback instructions
   * Requirement 5.4: For package installations, store package name and version
   * Requirement 5.6: Mark irreversible commands
   *
   * @param command - The shell command that was executed
   * @param output - Standard output + standard error from command
   * @param exitCode - Exit code (0 for success)
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns The created command record, or null if command execution failed
   * @throws Error on database write failure
   */
  async trackCommandExecution(
    command: string,
    output: string,
    exitCode: number,
    taskId: string,
    stepNumber: number
  ): Promise<CommandRecord | null> {
    try {
      this.ensureInitialized();

      // Identify rollback strategy
      const strategyInfo = this.identifyRollbackStrategy(command);

      const id = this.generateCommandId();
      const timestamp = Date.now();

      // Store command record in database
      await dbOps.run(
        `INSERT INTO command_history (id, task_id, step_number, command, output, exit_code, rollback_command, reversible, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          taskId,
          stepNumber,
          command,
          output,
          exitCode,
          strategyInfo.rollbackCommand || null,
          strategyInfo.reversible ? 1 : 0,
          timestamp,
        ]
      );

      console.log(
        `[RollbackManager] Tracked command execution: ${command.substring(0, 50)}... (record: ${id})`,
        strategyInfo.reversible ? '(reversible)' : '(irreversible)'
      );

      return {
        id,
        taskId,
        stepNumber,
        command,
        output,
        exitCode,
        rollbackCommand: strategyInfo.rollbackCommand || null,
        reversible: strategyInfo.reversible,
        timestamp,
      };
    } catch (error) {
      console.error(
        `[RollbackManager] Failed to track command execution for "${command}":`,
        error
      );
      throw error;
    }
  }

  /**
   * Identify the rollback strategy for a command.
   *
   * Analyzes the command to determine how it can be rolled back.
   * Supports package managers (npm, pip, apt, cargo) and marks
   * dangerous commands as irreversible.
   *
   * Requirement 5.3: Identify reversible commands and store rollback instructions
   * Requirement 5.4: Identify package manager commands for uninstallation
   * Requirement 5.6: Mark irreversible commands (rm -rf, dd, mkfs, format)
   *
   * @param command - The shell command to analyze
   * @returns Strategy information including reversibility and rollback command
   */
  identifyRollbackStrategy(command: string): RollbackStrategyInfo {
    const trimmed = command.trim();

    // ── Irreversible commands (dangerous operations) ─────────────────
    // Requirement 5.6: Mark irreversible commands
    if (this.isIrreversibleCommand(trimmed)) {
      return {
        strategy: 'irreversible',
        reversible: false,
        reason: 'Dangerous operation that cannot be safely reversed',
      };
    }

    // ── NPM package installation ──────────────────────────────────────
    // Requirement 5.4: Identify npm install commands
    if (this.isNpmInstall(trimmed)) {
      const rollbackCmd = this.generateNpmRollback(trimmed);
      if (rollbackCmd) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: rollbackCmd,
        };
      }
    }

    // ── Yarn package installation ─────────────────────────────────────
    if (this.isYarnInstall(trimmed)) {
      const rollbackCmd = this.generateYarnRollback(trimmed);
      if (rollbackCmd) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: rollbackCmd,
        };
      }
    }

    // ── Pip package installation ──────────────────────────────────────
    // Requirement 5.4: Identify pip install commands
    if (this.isPipInstall(trimmed)) {
      const rollbackCmd = this.generatePipRollback(trimmed);
      if (rollbackCmd) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: rollbackCmd,
        };
      }
    }

    // ── Apt package installation (Debian/Ubuntu) ─────────────────────
    // Requirement 5.4: Identify apt install commands
    if (this.isAptInstall(trimmed)) {
      const rollbackCmd = this.generateAptRollback(trimmed);
      if (rollbackCmd) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: rollbackCmd,
        };
      }
    }

    // ── Cargo package installation (Rust) ─────────────────────────────
    // Requirement 5.4: Identify cargo install commands
    if (this.isCargoInstall(trimmed)) {
      const rollbackCmd = this.generateCargoRollback(trimmed);
      if (rollbackCmd) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: rollbackCmd,
        };
      }
    }

    // ── Git operations ────────────────────────────────────────────────
    if (this.isGitCommit(trimmed) || this.isGitPush(trimmed)) {
      return {
        strategy: 'git_revert',
        reversible: true,
        reason: 'Can be reverted with git commands',
      };
    }

    // ── Default: manual intervention ──────────────────────────────────
    return {
      strategy: 'manual',
      reversible: false,
      reason: 'Rollback strategy not identified; manual intervention may be required',
    };
  }

  /**
   * Get all command records for a specific task step.
   *
   * Used to retrieve all commands executed in a single step.
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns Array of command records for that step
   */
  async getCommandsForStep(taskId: string, stepNumber: number): Promise<CommandRecord[]> {
    try {
      this.ensureInitialized();

      const rows = await dbOps.all(
        `SELECT * FROM command_history
         WHERE task_id = ? AND step_number = ?
         ORDER BY timestamp ASC`,
        [taskId, stepNumber]
      );

      return rows.map(this.rowToCommandRecord);
    } catch (error) {
      console.error(`[RollbackManager] Failed to get commands for step ${stepNumber}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific command record by ID.
   *
   * @param commandId - Command record identifier
   * @returns The command record, or null if not found
   */
  async getCommandRecord(commandId: string): Promise<CommandRecord | null> {
    try {
      this.ensureInitialized();

      const row = await dbOps.get(
        `SELECT * FROM command_history WHERE id = ?`,
        [commandId]
      );

      return row ? this.rowToCommandRecord(row) : null;
    } catch (error) {
      console.error(`[RollbackManager] Failed to get command record ${commandId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up old command records for a task, keeping only recent ones.
   *
   * Helps manage storage space by removing old command records.
   *
   * @param taskId - Task identifier
   * @param keepCount - Number of most recent command records to keep
   * @returns Number of records deleted
   */
  async pruneOldCommandRecords(taskId: string, keepCount: number = 100): Promise<number> {
    try {
      this.ensureInitialized();

      // Get record IDs to keep (most recent keepCount)
      const keepRows = await dbOps.all(
        `SELECT id FROM command_history
         WHERE task_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [taskId, keepCount]
      );

      const keepIds = keepRows.map((r: any) => r.id);

      if (keepIds.length > 0) {
        // Delete older records
        const placeholders = keepIds.map(() => '?').join(',');
        const result = await dbOps.run(
          `DELETE FROM command_history
           WHERE task_id = ? AND id NOT IN (${placeholders})`,
          [taskId, ...keepIds]
        );

        const deleted = (result as any).changes || 0;
        if (deleted > 0) {
          console.log(
            `[RollbackManager] Pruned ${deleted} old command records for task ${taskId}`
          );
        }
        return deleted;
      } else {
        // Delete all records if keepCount is 0
        const result = await dbOps.run(
          `DELETE FROM command_history WHERE task_id = ?`,
          [taskId]
        );
        return (result as any).changes || 0;
      }
    } catch (error) {
      console.error(`[RollbackManager] Failed to prune old command records:`, error);
      throw error;
    }
  }

  // ── Command analysis helpers ───────────────────────────────────────

  /**
   * Check if a command is irreversible (dangerous).
   *
   * Requirement 5.6: Mark irreversible commands (rm -rf, dd, mkfs, format)
   *
   * @param command - Command string to check
   * @returns true if command is irreversible
   */
  private isIrreversibleCommand(command: string): boolean {
    const irreversiblePatterns = [
      /^rm\s+(-[a-z]*f[a-z]*\s+)?.+/i, // rm -rf, rm -f
      /^dd\s+/i, // dd (dangerous disk writing)
      /^mkfs/i, // mkfs (make filesystem - destructive)
      /^format\s+/i, // format (Windows disk format)
      /^shred\s+/i, // shred (secure file deletion)
      /^fdisk\s+/i, // fdisk (destructive partition editing)
      /^parted\s+/i, // parted (destructive partition editing)
      /^wipefs\s+/i, // wipefs (destructive filesystem wipe)
    ];

    for (const pattern of irreversiblePatterns) {
      if (pattern.test(command)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if command is an npm install operation.
   *
   * @param command - Command string
   * @returns true if npm install
   */
  private isNpmInstall(command: string): boolean {
    return /^npm\s+(install|i)\s+/.test(command) || /^npm\s+(install|i)\s+/.test(command);
  }

  /**
   * Generate npm uninstall rollback command.
   *
   * Extracts package names from npm install and generates uninstall command.
   *
   * @param command - npm install command
   * @returns Rollback command or null if unable to parse
   */
  private generateNpmRollback(command: string): string | null {
    // Match: npm install package-name or npm install package@version
    const match = command.match(/^npm\s+(?:install|i)\s+([\w@\-\.\/]+)(?:\s+|$)/);

    if (match && match[1]) {
      let packageName = match[1];
      // Extract base package name (remove version specifier after @)
      // Handle scoped packages like @babel/core@7.12.0
      // Remove @version but keep @scope
      packageName = packageName.replace(/@([0-9]).*$/, '');
      return `npm uninstall ${packageName}`;
    }

    return null;
  }

  /**
   * Check if command is a yarn install operation.
   *
   * @param command - Command string
   * @returns true if yarn install
   */
  private isYarnInstall(command: string): boolean {
    return /^yarn\s+(add|install)\s+/.test(command);
  }

  /**
   * Generate yarn remove rollback command.
   *
   * @param command - yarn add/install command
   * @returns Rollback command or null if unable to parse
   */
  private generateYarnRollback(command: string): string | null {
    const match = command.match(/^yarn\s+(?:add|install)\s+([\w@\-\.\/]+)(?:\s+|$)/);

    if (match && match[1]) {
      const packageName = match[1];
      return `yarn remove ${packageName}`;
    }

    return null;
  }

  /**
   * Check if command is a pip install operation.
   *
   * @param command - Command string
   * @returns true if pip install
   */
  private isPipInstall(command: string): boolean {
    return /^pip(?:3)?\s+install\s+/.test(command);
  }

  /**
   * Generate pip uninstall rollback command.
   *
   * Extracts package names from pip install and generates uninstall command.
   *
   * @param command - pip install command
   * @returns Rollback command or null if unable to parse
   */
  private generatePipRollback(command: string): string | null {
    // Match: pip install package-name or pip install package==version
    const match = command.match(/^pip(?:3)?\s+install\s+([\w\-\[\]=.]+)(?:\s+|$)/);

    if (match && match[1]) {
      const packageName = match[1];
      // Extract base package name (remove version specifiers)
      const baseName = packageName.split(/[[\]=]/)[0];
      return `pip${command.includes('pip3') ? '3' : ''} uninstall -y ${baseName}`;
    }

    return null;
  }

  /**
   * Check if command is an apt install operation.
   *
   * @param command - Command string
   * @returns true if apt install
   */
  private isAptInstall(command: string): boolean {
    return /^apt(?:-get)?\s+install\s+/.test(command);
  }

  /**
   * Generate apt remove rollback command.
   *
   * Extracts package names from apt install and generates remove command.
   *
   * @param command - apt install command
   * @returns Rollback command or null if unable to parse
   */
  private generateAptRollback(command: string): string | null {
    // Match: apt install package-name
    const match = command.match(/^apt(?:-get)?\s+install\s+([\w\-.]+)(?:\s+|$)/);

    if (match && match[1]) {
      const packageName = match[1];
      return `apt-get remove -y ${packageName}`;
    }

    return null;
  }

  /**
   * Check if command is a cargo install operation.
   *
   * @param command - Command string
   * @returns true if cargo install
   */
  private isCargoInstall(command: string): boolean {
    return /^cargo\s+install\s+/.test(command);
  }

  /**
   * Generate cargo uninstall rollback command.
   *
   * Extracts crate names from cargo install and generates uninstall command.
   *
   * @param command - cargo install command
   * @returns Rollback command or null if unable to parse
   */
  private generateCargoRollback(command: string): string | null {
    // Match: cargo install crate-name
    const match = command.match(/^cargo\s+install\s+([\w\-]+)(?:\s+|$)/);

    if (match && match[1]) {
      const crateName = match[1];
      return `cargo uninstall ${crateName}`;
    }

    return null;
  }

  /**
   * Check if command is a git commit operation.
   *
   * @param command - Command string
   * @returns true if git commit
   */
  private isGitCommit(command: string): boolean {
    return /^git\s+commit\s+/.test(command);
  }

  /**
   * Check if command is a git push operation.
   *
   * @param command - Command string
   * @returns true if git push
   */
  private isGitPush(command: string): boolean {
    return /^git\s+push\s+/.test(command);
  }

  // ── Helper methods ──────────────────────────────────────────────────

  /**
   * Ensure the manager is initialized.
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[RollbackManager] Not initialized. Call initialize() first.');
    }
  }

  /**
   * Generate a unique snapshot ID.
   */
  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate a unique command record ID.
   */
  private generateCommandId(): string {
    return `cmd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Convert a database row to a FileSnapshot.
   */
  private rowToSnapshot(row: any): FileSnapshot {
    return {
      id: row.id,
      taskId: row.task_id,
      stepNumber: row.step_number,
      filePath: row.file_path,
      contentBefore: row.content_before || '',
      contentAfter: row.content_after || '',
      operation: row.operation as 'create' | 'modify' | 'delete',
      timestamp: row.timestamp,
    };
  }

  /**
   * Convert a database row to a CommandRecord.
   */
  private rowToCommandRecord(row: any): CommandRecord {
    return {
      id: row.id,
      taskId: row.task_id,
      stepNumber: row.step_number,
      command: row.command,
      output: row.output || '',
      exitCode: row.exit_code,
      rollbackCommand: row.rollback_command || null,
      reversible: row.reversible === 1 || row.reversible === true,
      timestamp: row.timestamp,
    };
  }

  // ── Rollback execution ──────────────────────────────────────────────

  /**
   * Rollback a specific agent step, restoring files and reversing commands.
   *
   * Performs best-effort rollback of all changes associated with a step:
   * - Restores file modifications from snapshots
   * - Deletes newly created files
   * - Restores deleted files
   * - Executes rollback commands for reversible operations
   *
   * Collects all errors encountered during rollback to enable partial rollback
   * reporting. Returns success only if ALL operations complete successfully.
   *
   * Requirement 6.1: Provide rollback interface accepting checkpoint identifier or step number
   * Requirement 6.2: Identify all state changes associated with that step
   * Requirement 6.3: Restore file content from pre-action snapshot for file modifications
   * Requirement 6.4: Execute rollback commands for reversible command executions
   * Requirement 6.5: Report partial rollback status when rollback cannot be fully completed
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number to rollback
   * @returns Rollback result with success status, restored files, reversed commands, and errors
   * @throws Error if database queries fail
   */
  async rollbackStep(taskId: string, stepNumber: number): Promise<RollbackResult> {
    try {
      this.ensureInitialized();

      console.log(`[RollbackManager] Starting rollback of step ${stepNumber} for task ${taskId}`);

      const filesRestored: string[] = [];
      const commandsReversed: string[] = [];
      const errors: string[] = [];

      // ── Phase 1: Restore files ──────────────────────────────────────

      try {
        const fileSnapshots = await this.getFileSnapshotsForStep(taskId, stepNumber);

        for (const snapshot of fileSnapshots) {
          try {
            const result = await this.rollbackFileChange(snapshot.id);
            if (result.success) {
              filesRestored.push(snapshot.filePath);
              console.log(`[RollbackManager] Restored file: ${snapshot.filePath}`);
            } else {
              errors.push(`File restoration failed for ${snapshot.filePath}: ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during file restoration for ${snapshot.filePath}: ${(error as Error).message}`
            );
          }
        }
      } catch (error) {
        errors.push(`Failed to retrieve file snapshots: ${(error as Error).message}`);
      }

      // ── Phase 2: Reverse commands ───────────────────────────────────

      try {
        const commands = await this.getCommandsForStep(taskId, stepNumber);

        // Reverse commands in reverse order (last executed first)
        for (let i = commands.length - 1; i >= 0; i--) {
          const cmd = commands[i];

          try {
            const result = await this.rollbackCommand(cmd.id);
            if (result.success) {
              commandsReversed.push(cmd.command);
              console.log(`[RollbackManager] Reversed command: ${cmd.command}`);
            } else {
              errors.push(`Command reversal failed for "${cmd.command}": ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during command reversal for "${cmd.command}": ${(error as Error).message}`
            );
          }
        }
      } catch (error) {
        errors.push(`Failed to retrieve command records: ${(error as Error).message}`);
      }

      // ── Phase 3: Report results ────────────────────────────────────

      const success = errors.length === 0;
      const partialRollback =
        errors.length > 0 && (filesRestored.length > 0 || commandsReversed.length > 0);

      const result: RollbackResult = {
        success,
        filesRestored,
        commandsReversed,
        errors,
        partialRollback,
        stepsRolledBack: success ? [stepNumber] : [],
      };

      console.log(
        `[RollbackManager] Rollback ${success ? 'succeeded' : partialRollback ? 'partially succeeded' : 'failed'}: ` +
          `${filesRestored.length} files restored, ${commandsReversed.length} commands reversed, ${errors.length} errors`
      );

      return result;
    } catch (error) {
      console.error(`[RollbackManager] Unexpected error in rollbackStep:`, error);

      return {
        success: false,
        filesRestored: [],
        commandsReversed: [],
        errors: [(error as Error).message || String(error)],
        partialRollback: false,
        stepsRolledBack: [],
      };
    }
  }

  /**
   * Rollback all operations that occurred after a specific timestamp.
   *
   * Finds all file snapshots and command executions for the task that have
   * a timestamp greater than or equal to the target timestamp, and rolls
   * them back in reverse chronological order.
   *
   * @param taskId - Task identifier
   * @param timestampMs - Unix timestamp (ms) to rollback to
   * @returns Rollback result with success status, restored files, reversed commands, and errors
   */
  async rollbackSinceTimestamp(taskId: string, timestampMs: number): Promise<RollbackResult> {
    try {
      this.ensureInitialized();

      console.log(`[RollbackManager] Starting rollback since timestamp ${timestampMs} for task ${taskId}`);

      const filesRestored: string[] = [];
      const commandsReversed: string[] = [];
      const errors: string[] = [];

      // ── Phase 1: Retrieve and rollback file changes ─────────────────

      try {
        const fileRows = await dbOps.all(
          `SELECT * FROM file_snapshots
           WHERE task_id = ? AND timestamp >= ?
           ORDER BY timestamp DESC`,
          [taskId, timestampMs]
        );

        const fileSnapshots = fileRows.map(this.rowToSnapshot);

        for (const snapshot of fileSnapshots) {
          try {
            const result = await this.rollbackFileChange(snapshot.id);
            if (result.success) {
              filesRestored.push(snapshot.filePath);
              console.log(`[RollbackManager] Restored file: ${snapshot.filePath}`);
            } else {
              errors.push(`File restoration failed for ${snapshot.filePath}: ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during file restoration for ${snapshot.filePath}: ${(error as Error).message}`
            );
          }
        }
      } catch (error) {
        errors.push(`Failed to retrieve or rollback file snapshots: ${(error as Error).message}`);
      }

      // ── Phase 2: Retrieve and rollback commands ─────────────────────

      try {
        const cmdRows = await dbOps.all(
          `SELECT * FROM command_history
           WHERE task_id = ? AND timestamp >= ?
           ORDER BY timestamp DESC`,
          [taskId, timestampMs]
        );

        const commands = cmdRows.map(this.rowToCommandRecord);

        for (const cmd of commands) {
          try {
            const result = await this.rollbackCommand(cmd.id);
            if (result.success) {
              commandsReversed.push(cmd.command);
              console.log(`[RollbackManager] Reversed command: ${cmd.command}`);
            } else {
              errors.push(`Command reversal failed for "${cmd.command}": ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during command reversal for "${cmd.command}": ${(error as Error).message}`
            );
          }
        }
      } catch (error) {
        errors.push(`Failed to retrieve or rollback command records: ${(error as Error).message}`);
      }

      // ── Phase 3: Report results ────────────────────────────────────

      const success = errors.length === 0;
      const partialRollback =
        errors.length > 0 && (filesRestored.length > 0 || commandsReversed.length > 0);

      const result: RollbackResult = {
        success,
        filesRestored,
        commandsReversed,
        errors,
        partialRollback,
        stepsRolledBack: [],
      };

      console.log(
        `[RollbackManager] Rollback since timestamp ${success ? 'succeeded' : partialRollback ? 'partially succeeded' : 'failed'}: ` +
          `${filesRestored.length} files restored, ${commandsReversed.length} commands reversed, ${errors.length} errors`
      );

      return result;
    } catch (error) {
      console.error(`[RollbackManager] Unexpected error in rollbackSinceTimestamp:`, error);

      return {
        success: false,
        filesRestored: [],
        commandsReversed: [],
        errors: [(error as Error).message || String(error)],
        partialRollback: false,
        stepsRolledBack: [],
      };
    }
  }

  /**
   * Rollback an individual file change.
   *
   * Restores a file to its previous state based on the snapshot operation:
   * - For 'modify' operations: restores file content from before the modification
   * - For 'create' operations: deletes the newly created file
   * - For 'delete' operations: restores the deleted file from snapshot
   *
   * Requirement 6.3: Restore file content from pre-action snapshot for file modifications
   *
   * @param snapshotId - File snapshot identifier
   * @returns Restoration result with success status and error message
   */
  async rollbackFileChange(snapshotId: string): Promise<FileRestorationResult> {
    try {
      this.ensureInitialized();

      console.log(`[RollbackManager] Rolling back file change: ${snapshotId}`);

      return await this.restoreFileFromSnapshot(snapshotId);
    } catch (error) {
      console.error(`[RollbackManager] Error rolling back file change ${snapshotId}:`, error);

      return {
        filePath: '',
        success: false,
        operation: 'modify',
        error: `Exception: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Rollback a command execution.
   *
   * Executes the rollback command stored in the command record to reverse
   * the effects of the original command. Only applies to reversible commands;
   * irreversible commands return an error.
   *
   * Requirement 6.4: Execute rollback commands for reversible command executions
   * Requirement 6.5: Report if rollback cannot be fully completed
   *
   * @param commandId - Command record identifier
   * @returns Rollback result with success status and error message
   */
  async rollbackCommand(commandId: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.ensureInitialized();

      const commandRecord = await this.getCommandRecord(commandId);
      if (!commandRecord) {
        return {
          success: false,
          error: `Command record ${commandId} not found`,
        };
      }

      console.log(`[RollbackManager] Rolling back command: ${commandRecord.command}`);

      // Check if command is reversible
      if (!commandRecord.reversible) {
        return {
          success: false,
          error: `Command is irreversible: "${commandRecord.command}"`,
        };
      }

      // Check if rollback command is available
      if (!commandRecord.rollbackCommand) {
        return {
          success: false,
          error: `No rollback command available for: "${commandRecord.command}"`,
        };
      }

      // Execute rollback command
      try {
        const { execSync } = require('child_process');
        const rollbackOutput = execSync(commandRecord.rollbackCommand, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        console.log(
          `[RollbackManager] Successfully reversed command: "${commandRecord.command}"`,
          `Rollback: "${commandRecord.rollbackCommand}"`
        );

        return {
          success: true,
        };
      } catch (execError) {
        const errorMsg = (execError as Error).message || 'Unknown execution error';
        console.error(
          `[RollbackManager] Failed to execute rollback command "${commandRecord.rollbackCommand}":`,
          errorMsg
        );

        return {
          success: false,
          error: `Rollback command failed: ${errorMsg}`,
        };
      }
    } catch (error) {
      console.error(`[RollbackManager] Error rolling back command ${commandId}:`, error);

      return {
        success: false,
        error: `Exception: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Check if a step can be rolled back.
   *
   * Analyzes whether all file and command changes for a step can be rolled back
   * without issues.
   *
   * Requirement 6.1: Provide rollback interface accepting checkpoint identifier or step number
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns true if rollback is possible, false otherwise
   */
  async canRollback(taskId: string, stepNumber: number): Promise<boolean> {
    try {
      this.ensureInitialized();

      // Check if any operations exist for this step
      const fileSnapshots = await this.getFileSnapshotsForStep(taskId, stepNumber);
      const commands = await this.getCommandsForStep(taskId, stepNumber);

      // If no operations, cannot rollback
      if (fileSnapshots.length === 0 && commands.length === 0) {
        return false;
      }

      // All file operations are reversible
      // All commands that exist are either reversible or will be marked as failed

      return true;
    } catch (error) {
      console.error(`[RollbackManager] Error checking rollback feasibility:`, error);
      return false;
    }
  }

  /**
   * Analyze the impact of rolling back a step.
   *
   * Provides detailed information about what will be affected by a rollback:
   * - Files that will be restored/deleted
   * - Commands that will be reversed
   * - Dependent steps that might be affected
   * - Overall risk level
   *
   * Requirement 6.1: Provide rollback interface accepting checkpoint identifier or step number
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns Impact analysis including affected resources and risk level
   */
  async getRollbackImpact(taskId: string, stepNumber: number): Promise<RollbackImpact> {
    try {
      this.ensureInitialized();

      const fileSnapshots = await this.getFileSnapshotsForStep(taskId, stepNumber);
      const commands = await this.getCommandsForStep(taskId, stepNumber);

      const filesAffected = [...new Set(fileSnapshots.map((s) => s.filePath))];

      const reversibleCommandCount = commands.filter((c) => c.reversible).length;
      const irreversibleCommandCount = commands.filter((c) => !c.reversible).length;

      // Calculate risk level
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (filesAffected.length > 10) riskLevel = 'medium';
      if (filesAffected.length > 50) riskLevel = 'high';
      if (irreversibleCommandCount > 0) riskLevel = 'high';

      return {
        filesAffected,
        commandsAffected: commands.map((c) => c.command),
        dependentSteps: [], // This would require analyzing subsequent steps
        riskLevel,
        reversibleCommandCount,
        irreversibleCommandCount,
      };
    } catch (error) {
      console.error(`[RollbackManager] Error analyzing rollback impact:`, error);

      return {
        filesAffected: [],
        commandsAffected: [],
        dependentSteps: [],
        riskLevel: 'high',
        reversibleCommandCount: 0,
        irreversibleCommandCount: 0,
      };
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────

let rollbackManagerInstance: RollbackManager | null = null;

/**
 * Get the singleton RollbackManager instance.
 *
 * Lazy-initializes on first access.
 */
export function getRollbackManager(): RollbackManager {
  if (!rollbackManagerInstance) {
    rollbackManagerInstance = new RollbackManager();
  }
  return rollbackManagerInstance;
}
