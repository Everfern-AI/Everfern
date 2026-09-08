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
import * as fsSync from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fg from 'fast-glob';
import { dbOps } from '../../lib/db';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const execFileAsync = promisify(execFile);

// Short-lived per-turn cache for `git status --porcelain` output, keyed by cwd (AG-PERF-04).
const GIT_STATUS_CACHE_TTL_MS = 1500;
const gitStatusCache = new Map<string, { ts: number; out: string }>();

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
interface FileRestorationResult {
  filePath: string;
  success: boolean;
  operation: 'create' | 'modify' | 'delete';
  error?: string;
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
interface CommandRecord {
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
  /** Rollback command to reverse this operation (null if not reversible).
   *  LEGACY free-text field (AG-SAF-01): stored for display only. Rollback
   *  execution uses {@link rollbackPayload}; free-text is NEVER executed. */
  rollbackCommand: string | null;
  /** Structured rollback execution payload (AG-SAF-01). When present, this is
   *  the ONLY form honored by rollbackCommand(); executed via spawn argv
   *  with shell:false. */
  rollbackPayload?: RollbackPayload | null;
  /** Working directory recorded at capture time; passed to spawn on rollback */
  cwd?: string | null;
  /** Whether this command can be rolled back */
  reversible: boolean;
  /** Unix timestamp (ms) when command was executed */
  timestamp: number;
}

/**
 * Structured rollback execution payload (AG-SAF-01).
 *
 * Rollback commands are re-derived from the original command by the inverse
 * generators and stored as an argv array — never as a free-text shell string.
 * Executed with spawn(program, args, { shell: false, timeout }).
 *
 * Argv form is a security requirement, not a style choice: each element is
 * passed to the OS as a single literal argument, so metacharacters in the
 * original command (spaces, quotes, `;`, `|`, `&`, globs, `$()` …) can never
 * be re-interpreted by a shell at rollback time. A free-text rollback string
 * would effectively grant a second, unreviewed shell execution.
 */
interface RollbackPayload {
  /** Executable program name (e.g. 'npm', 'pip3', 'apt-get', 'brew', 'git') */
  program: string;
  /** Argument vector (e.g. ['uninstall', 'lodash']) */
  args: string[];
  /** Optional cwd recorded at payload creation time */
  cwd?: string;
}

/**
 * Confirmation request presented before executing rollback commands (AG-SAF-01).
 */
interface RollbackConfirmationRequest {
  /** Exact argv arrays that will be executed */
  commands: RollbackPayload[];
  /** File operations that are part of the same rollback */
  fileOperations: Array<{ filePath: string; operation: 'create' | 'modify' | 'delete' }>;
}

/**
 * Handler that approves or denies execution of rollback commands.
 * Return true to approve, false (or throw) to deny (fail-closed).
 */
type RollbackConfirmationHandler = (
  request: RollbackConfirmationRequest
) => Promise<boolean> | boolean;

/**
 * Strategy for rolling back a command execution.
 *
 * Requirement 5.4: Identify rollback strategies for package managers
 * Requirement 5.6: Mark irreversible commands (rm -rf, dd, mkfs, format)
 */
type RollbackStrategy =
  | 'package_uninstall'  // npm/yarn/pip/apt/pacman/cargo uninstall
  | 'config_restore'     // Restore from backed-up config file
  | 'git_revert'         // Git revert for source control changes
  | 'file_restore'       // File content captured before destructive operation
  | 'manual'             // Manual intervention required
  | 'irreversible';      // Cannot be rolled back (dangerous command)

/**
 * Details about how a command can be rolled back.
 */
interface RollbackStrategyInfo {
  strategy: RollbackStrategy;
  reversible: boolean;
  rollbackCommand?: string;
  /** AG-SAF-01: structured rollback payload — the only form executed at rollback time */
  rollbackPayload?: RollbackPayload | null;
  /** True when every operand of the original command has an inverse */
  partial?: boolean;
  reason?: string;
}

/**
 * Parsed info about a destructive shell command.
 * Covers file deletion (rm/rd/erase), move/rename (mv/ren),
 * copy/overwrite (cp), in-place edit (sed -i),
 * pipe-to-file (tee), raw write (dd of=), and truncation.
 */
interface DestructiveCommandInfo {
  /** The operation type */
  operation: 'rm' | 'mv' | 'cp' | 'sed' | 'tee' | 'dd' | 'truncate' | 'sponge' | 'sort' | 'install' | 'rsync' | 'git' | 'download';
  /** File/directory targets to delete or source paths for mv/cp */
  targets: Array<{ original: string; resolved: string; recursive: boolean }>;
  /** Destination path for mv/cp operations */
  destination?: string;
  /** Whether force flag (-f) was used */
  force: boolean;
  /** Files captured from shell redirections (> file, 2> file, &> file) */
  redirectFiles?: string[];
}

/**
 * Summary of captured file state before a destructive operation.
 */
interface CaptureSummary {
  snapshotIds: string[];
  fileCount: number;
  totalSizeBytes: number;
  paths: string[];
  warnings: string[];
}

/**
 * Preview of what will be restored during a rollback.
 */
interface RollbackPreviewItem {
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  contentSizeBytes: number;
  willRestore: boolean;
  warning?: string;
  lastModified?: string;
}

/**
 * Full rollback preview for a step.
 */
export interface RollbackPreview {
  stepNumber: number;
  files: RollbackPreviewItem[];
  commands: Array<{
    command: string;
    reversible: boolean;
    rollbackCommand?: string;
    linkedSnapshots: number;
  }>;
  totalFilesToRestore: number;
  totalSizeBytes: number;
  hasIrreversibleCommands: boolean;
  hasUnrestorableFiles: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Result of linking snapshots to a command record.
 */
interface LinkSnapshotsResult {
  commandId: string;
  snapshotIds: string[];
  linked: number;
}

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Basename-based secret/credential file exclusions (case-insensitive).
 * Matched against the final path segment only, via full equality.
 *
 * Requirement 17.5: Exclude sensitive files from snapshots by default
 */
const SECRET_BASENAMES = new Set<string>([
  '.env',
  '.env.production',
  'secrets.yaml',
  'secrets.yml',
  'secrets.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'known_hosts',
  'authorized_keys',
  'htpasswd',
  '.npmrc',
  '.netrc',
  'credentials', // .aws/credentials
]);

/**
 * Suffix (extension/ending) based secret exclusions, matched case-insensitively
 * against the basename.
 */
const SECRET_BASENAME_SUFFIXES: RegExp[] = [
  /^\.env\./i,          // .env.production, .env.staging, ...
  /^id_rsa([.\-_].*)?$/i,   // id_rsa, id_rsa.pem, id_rsa-old
  /^id_ed25519([.\-_].*)?$/i,
  /^id_ecdsa([.\-_].*)?$/i,
  /^service-account.*\.json$/i, // service-account*.json
  /_rsa$/i,            // *_rsa
  /\.ppk$/i,           // PuTTY private keys
  /\.kdbx$/i,          // KeePass databases
  /\.keystore$/i,      // Java keystores
  /\.jks$/i,           // Java keystores
  /\.htpasswd$/i,      // htpasswd files
];

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
  /^\.env\.[^/\\]+$/,         // .env.production, .env.staging, ...
  /[/\\]\.env\.[^/\\]+$/,
  /\.key$/i,                  // Private keys
  /\.pem$/i,                  // PEM files
  /\.p12$/i,                  // PKCS#12 files
  /credentials\.json$/i,      // Credentials
  /secrets\.json$/i,          // Secrets
  /secrets\.ya?ml$/i,         // secrets.yaml / secrets.yml
  /^\.venv([/\\]|$)/,         // Python virtual env
  /[/\\]\.venv([/\\]|$)/,
  /^venv([/\\]|$)/,           // Python virtual env
  /[/\\]venv([/\\]|$)/,
  /\.sqlite3$/i,              // Database files
  /\.db$/i,
  // AG-SAF-05: anchored secrets — path-suffix forms for the basename set
  /[/\\]id_rsa([.\-_][^/\\]*)?$/i,
  /[/\\]id_ed25519([.\-_][^/\\]*)?$/i,
  /[/\\]id_ecdsa([.\-_][^/\\]*)?$/i,
  /[/\\]known_hosts$/i,
  /[/\\]authorized_keys$/i,
  /[/\\]htpasswd$/i,
  /[/\\]\.npmrc$/i,
  /[/\\]\.netrc$/i,
  /[/\\]\.aws[/\\]credentials$/i,
  /[/\\]\.ppk$/i,
  /[/\\]\.kdbx$/i,
  /[/\\]\.keystore$/i,
  /[/\\]\.jks$/i,
  /[/\\]\.htpasswd$/i,
  /[/\\]service-account[^/\\]*\.json$/i,
  /[/\\][^/\\]*_rsa$/i,
];

// ── Table names ───────────────────────────────────────────────────────

// ── Schema initializers ────────────────────────────────────────────────

/**
 * Ensure the file_snapshots table exists.
 * Safe to call multiple times (idempotent).
 *
 * Requirement 4.1: Store file snapshots in the Checkpoint_Store
 */
async function ensureFileSnapshotsTable(): Promise<void> {
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
async function ensureCommandHistoryTable(): Promise<void> {
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

  // AG-SAF-01: add structured rollback payload + cwd columns (idempotent migration)
  try {
    await dbOps.exec(`ALTER TABLE command_history ADD COLUMN rollback_payload TEXT`);
  } catch { /* column already exists */ }
  try {
    await dbOps.exec(`ALTER TABLE command_history ADD COLUMN cwd TEXT`);
  } catch { /* column already exists */ }
}

/**
 * Ensure the command_file_links table exists.
 * Links destructive commands to the file snapshots captured before execution.
 */
async function ensureCommandFileLinksTable(): Promise<void> {
  await dbOps.exec(`
    CREATE TABLE IF NOT EXISTS command_file_links (
      command_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      PRIMARY KEY (command_id, snapshot_id),
      FOREIGN KEY (command_id) REFERENCES command_history(id),
      FOREIGN KEY (snapshot_id) REFERENCES file_snapshots(id)
    );

    CREATE INDEX IF NOT EXISTS idx_command_file_links_command
      ON command_file_links(command_id);
    CREATE INDEX IF NOT EXISTS idx_command_file_links_snapshot
      ON command_file_links(snapshot_id);
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
  private allowedRoots: string[] = [];
  /** Injected confirmation handler for rollback command execution (tests). */
  private rollbackConfirmationHandler: RollbackConfirmationHandler | null = null;
  /** When set, a consolidated approval already covered these payloads/file ops
   *  (AG-SAF-01: ONE confirmation per rollback operation, not per command). */
  private batchRollbackApproval: RollbackConfirmationRequest | null = null;

  /**
   * Initialize the rollback manager, ensuring database tables exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureFileSnapshotsTable();
    await ensureCommandHistoryTable();
    await ensureCommandFileLinksTable();
    this.initialized = true;
    console.log('[RollbackManager] Initialized — tables ready (file_snapshots, command_history, command_file_links)');
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
   * Set the workspace-root allowlist for snapshot ingestion (AG-SAF-05).
   *
   * When set (non-empty), file snapshots are only accepted for files whose
   * realpath resolves inside one of the allowed roots. Files outside the
   * allowlist are skipped with a note.
   *
   * @param roots - Absolute directory paths allowed for snapshots
   */
  setAllowedRoots(roots: string[]): void {
    // Resolve each root (including through symlinks, e.g. /var → /private/var
    // on macOS) so realpath-resolved targets compare correctly.
    // Resolving BOTH sides through realpath also defeats symlink-based
    // escapes: a target that symlinks outside the roots is rejected even
    // when its lexical path looks inside.
    this.allowedRoots = roots
      .map((r) => {
        try {
          return fsSync.realpathSync(path.resolve(r));
        } catch {
          // Root itself doesn't exist (yet) — fall back to lexical resolve
          return path.resolve(r);
        }
      })
      .filter((r) => typeof r === 'string' && r.length > 0);
  }

  /**
   * Check if a file path is within one of the allowed workspace roots
   * (AG-SAF-05 root containment).
   *
   * @param filePath - Absolute path to check
   * @returns true if within an allowed root (or allowlist not configured)
   */
  isPathWithinAllowedRoots(filePath: string): boolean {
    if (!this.allowedRoots || this.allowedRoots.length === 0) {
      return true;
    }
    try {
      const resolved = fsSync.realpathSync(filePath);
      for (const root of this.allowedRoots) {
        // path.relative containment idiom: a result starting with '..' (or
        // absolute, e.g. across Windows drives) means the file resolves
        // OUTSIDE this root; '' means the file IS the root itself.
        const rel = path.relative(root, resolved);
        if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
          return true;
        }
      }
      return false;
    } catch {
      // realpath cannot be resolved (file missing, symlink loop, permission...)
      // Fail-closed: an unverifiable path counts as outside so it can never
      // be snapshotted (and thus never written during restore).
      return false;
    }
  }

  /**
   * Check if a file path should be excluded from snapshots.
   *
   * Requirement 17.4: Exclude files matching patterns like .git, node_modules, .env
   * Requirement 17.5: Exclude sensitive files (anchored basename + suffix match)
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

    // AG-SAF-05: anchored basename equality (case-insensitive) + basename suffix match
    const base = path.posix.basename(normalized).toLowerCase();
    if (base) {
      if (SECRET_BASENAMES.has(base)) return true;
      for (const suffixRe of SECRET_BASENAME_SUFFIXES) {
        if (suffixRe.test(base)) return true;
      }
    }

    return false;
  }

  /**
   * Heuristic detection of secret material in file content (AG-SAF-05).
   *
   * Scans the first N KB of a small text file for high-entropy secret markers:
   * private key headers, api_key/token/password/secret assignments.
   *
   * @returns true if the content looks like it contains secrets
   */
  private contentLooksLikeSecrets(buffer: Buffer): boolean {
    const SAMPLE = 64 * 1024; // first 64 KB
    const sample = buffer.subarray(0, SAMPLE);
    // Binary check: any NUL byte → not a small text config, skip heuristic
    if (sample.includes(0)) return false;
    const text = sample.toString('utf-8');
    if (/-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/.test(text)) return true;
    if (/(^|[\n\r])\s*(api[_-]?key|apikey|token|password|secret)\s*[:=]\s*\S/i.test(text)) return true;
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

      // AG-SAF-05: root containment — skip paths outside allowed workspace roots
      if (!this.isPathWithinAllowedRoots(filePath)) {
        console.warn(`[RollbackManager] Skipped: path outside allowed roots: ${filePath}`);
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

      // AG-SAF-05: root containment — skip paths outside allowed workspace roots
      if (!this.isPathWithinAllowedRoots(filePath)) {
        console.warn(`[RollbackManager] Skipped: path outside allowed roots: ${filePath}`);
        return null;
      }

      // AG-SAF-03: pre-existence refusal — NEVER record a create for a path
      // that already exists. A create-record would unlink the pre-existing
      // file on rollback (data loss). stat success → refuse; ENOENT → good.
      try {
        await fsPromises.stat(filePath);
        console.warn('[RollbackManager] Refusing to record create for existing file:', filePath);
        return null;
      } catch (statErr: any) {
        if (statErr?.code !== 'ENOENT') {
          // ENOTDIR/EACCES/... — path inaccessible or invalid; an
          // inaccessible path must not be recorded as creatable either.
          console.warn('[RollbackManager] Refusing to record create for inaccessible path:', filePath, statErr?.code);
          return null;
        }
        // ENOENT = file absent — proceed to record creation.
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

      // AG-SAF-05: root containment — skip paths outside allowed workspace roots
      if (!this.isPathWithinAllowedRoots(filePath)) {
        console.warn(`[RollbackManager] Skipped: path outside allowed roots: ${filePath}`);
        return null;
      }

      // AG-SAF-05: secrets heuristic — skip content that looks like secrets
      if (typeof content === 'string' && content.length > 0) {
        if (this.contentLooksLikeSecrets(Buffer.from(content, 'utf-8'))) {
          console.warn(`[RollbackManager] Skipped: content matched secret heuristics: ${filePath}`);
          return null;
        }
      } else if (Buffer.isBuffer(content) && content.length > 0) {
        if (this.contentLooksLikeSecrets(content)) {
          console.warn(`[RollbackManager] Skipped: content matched secret heuristics: ${filePath}`);
          return null;
        }
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
   * Restore-safety contract: content_before IS the backup — captured before
   * the destructive operation, so restore works even if the on-disk file is
   * gone. Writes are direct (no temp+rename atomicity): a crash mid-write can
   * leave a truncated file, but the snapshot row is never deleted on restore,
   * so re-running the rollback repairs it. Failures are returned, never
   * thrown, so a multi-file rollback continues past one bad file. The 'create'
   * branch additionally refuses to unlink unless the file plausibly belongs to
   * the agent (AG-SAF-03, see inline).
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
        // For creation, delete the file — but only if it is plausibly the
        // agent's own file (AG-SAF-03). Create-snapshots store no content
        // (null before/after), so the only ownership evidence is freshness:
        // if the on-disk mtime predates the recorded creation by more than
        // the 2s clock-skew tolerance, the file existed BEFORE the agent's
        // "creation" (bad record or race) — refuse to unlink.
        try {
          const st = await fsPromises.stat(snapshot.filePath);
          if (st.mtimeMs < snapshot.timestamp - 2000) {
            console.warn(
              `[RollbackManager] refusing to delete pre-existing/modified file: ${snapshot.filePath} ` +
              `(mtime ${st.mtimeMs} predates recorded creation ${snapshot.timestamp})`
            );
            return {
              filePath: snapshot.filePath,
              success: false,
              operation: 'create',
              error: 'Refused to delete pre-existing/modified file (AG-SAF-03): file predates recorded creation',
            };
          }
        } catch (statError: any) {
          if (statError?.code === 'ENOENT') {
            // Already deleted — treat as success without error.
            return {
              filePath: snapshot.filePath,
              success: true,
              operation: 'create',
            };
          }
          // Other stat failures (EACCES, ENOTDIR, ...) — cannot verify
          // ownership → do NOT unlink (fail-closed; blocks the data-loss path
          // even if a bad create-record slipped through).
          console.warn(`[RollbackManager] refusing to delete unverifiable file: ${snapshot.filePath}`, statError);
          return {
            filePath: snapshot.filePath,
            success: false,
            operation: 'create',
            error: `Refused to delete unverifiable file (AG-SAF-03): ${(statError as Error).message}`,
          };
        }

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
        // content_before holds the full pre-deletion bytes, so this
        // resurrects the file even though it no longer exists on disk.
        try {
          const content = await this.decompressContent(snapshot.contentBefore);
          await fsPromises.writeFile(snapshot.filePath, content);
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
        // This overwrites whatever is on disk now; the preview layer warns
        // beforehand if the file drifted from content_after since capture.
        try {
          const content = await this.decompressContent(snapshot.contentBefore);
          await fsPromises.writeFile(snapshot.filePath, content);
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
   * Retention invariant: the newest `keepCount` snapshots PER FILE PATH are
   * kept (retention is scoped per path, not per task) so rolling back the
   * most recent steps always finds its pre-capture snapshots intact.
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
   * @param content - Uncompressed content string or Buffer
   * @returns Base64-encoded gzipped content
   */
  private async compressContent(content: string | Buffer): Promise<string> {
    try {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
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
   * @returns Decompressed content Buffer
   */
  private async decompressContent(compressed: string): Promise<Buffer> {
    try {
      const buffer = Buffer.from(compressed, 'base64');
      const decompressed = await gunzip(buffer);
      return decompressed;
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
    stepNumber: number,
    cwd?: string
  ): Promise<CommandRecord | null> {
    try {
      this.ensureInitialized();

      // Identify rollback strategy
      const strategyInfo = this.identifyRollbackStrategy(command);

      const id = this.generateCommandId();
      const timestamp = Date.now();

      // AG-SAF-01: record the cwd at capture time so rollback spawns in the
      // same directory; fall back to process cwd if not provided.
      const recordedCwd = cwd || process.cwd();

      // Store command record in database
      await dbOps.run(
        `INSERT INTO command_history (id, task_id, step_number, command, output, exit_code, rollback_command, rollback_payload, cwd, reversible, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          taskId,
          stepNumber,
          command,
          output,
          exitCode,
          strategyInfo.rollbackCommand || null,
          strategyInfo.rollbackPayload ? JSON.stringify(strategyInfo.rollbackPayload) : null,
          recordedCwd,
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
        rollbackPayload: strategyInfo.rollbackPayload || null,
        cwd: recordedCwd,
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
    if (!command) {
      return {
        strategy: 'manual',
        reversible: false,
        reason: 'Command is empty or undefined',
      };
    }
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

    // ── Harmless / read-only commands ─────────────────────────────────
    if (/^(?:git\s+(status|diff|log|show|branch|tag|rev-parse|remote|config)|test-path|resolve-path|get-command|get-help|get-location|pwd)(?:\s+|$)/i.test(trimmed)) {
      return {
        strategy: 'manual',
        reversible: true,
        reason: 'Read-only or harmless query command',
        rollbackCommand: 'echo "Read-only command - no rollback required"',
        rollbackPayload: null,
        partial: false,
      };
    }

    // ── git add ───────────────────────────────────────────────────────
    if (/^git\s+add\s+/i.test(trimmed)) {
      return {
        strategy: 'git_revert',
        reversible: true,
        reason: 'Can be reverted by resetting staged changes',
        rollbackCommand: 'git reset HEAD',
        rollbackPayload: { program: 'git', args: ['reset', 'HEAD'] },
        partial: false,
      };
    }

    // ── File operations (rm, mv, cp, sed, tee, dd, truncate, sponge) ──
    if (/^(rm|del|erase|remove-item|rd|rmdir)\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File deletion/removal — reversibility depends on pre-capture snapshots',
      };
    }
    if (/^(mv|move|move-item|rename-item|ren|rename)\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File move/rename — destination content captured if it existed',
      };
    }
    if (/^cp\s+/i.test(trimmed) || /^(copy|copy-item|xcopy|robocopy)\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File copy — destination content captured if overwritten',
      };
    }
    if (/^sed\s+-i/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'In-place sed edit — file content captured before modification',
      };
    }
    if (/^tee\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Tee output to file — destination content captured before overwrite',
      };
    }
    if (/^dd\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'DD raw write — output file content captured before overwrite',
      };
    }
    if (/^truncate\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File truncation — content captured before shrink',
      };
    }
    if (/^sponge\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Sponge write to file — content captured before overwrite',
      };
    }
    if (/^sort\s+/i.test(trimmed) && /\s+-o\s+/.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'In-place sort — output file content captured before overwrite',
      };
    }
    if (/^install\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File install — destination content captured before overwrite',
      };
    }
    if (/^rsync\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'File sync — destination content captured before overwrite',
      };
    }

    // ── git checkout/restore: Capture before git discards changes ─────
    if (/^git\s+(checkout|restore)\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Git checkout/restore — working tree files captured before overwrite',
      };
    }

    // ── git clean: Capture untracked files before deletion ───────────
    if (/^git\s+clean\s+/i.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Git clean — untracked files captured before deletion',
      };
    }

    // ── curl -o / wget -O: Download to file ──────────────────────────
    if (/^curl\s+/i.test(trimmed) && /\s+-[o-]{1,2}\s+/.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Curl download — output file captured before overwrite',
      };
    }
    if (/^wget\s+/i.test(trimmed) && /\s+-O\s+/.test(trimmed)) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Wget download — output file captured before overwrite',
      };
    }

    // ── npm init / yarn init / pnpm init: Capture package.json ──────
    if ((/^npm\s+init/i.test(trimmed) || /^yarn\s+init/i.test(trimmed) || /^pnpm\s+init/i.test(trimmed))) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Package init — existing package.json captured before overwrite',
      };
    }

    // ── Shell redirections (> file, 2> file, &> file) ────────────────
    // Any command with output redirection to a file may overwrite it
    if (/[>\|]/.test(trimmed) && this._parseFileRedirections(trimmed, '').length > 0) {
      return {
        strategy: 'file_restore',
        reversible: false,
        reason: 'Shell output redirection — file content captured before overwrite',
      };
    }

    // ── NPM package installation ──────────────────────────────────────
    // Requirement 5.4: Identify npm install commands
    if (this.isNpmInstall(trimmed)) {
      const payload = this.generateNpmRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
        };
      }
    }

    // ── Yarn package installation ─────────────────────────────────────
    if (this.isYarnInstall(trimmed)) {
      const payload = this.generateYarnRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
        };
      }
    }

    // ── Pip package installation ──────────────────────────────────────
    // Requirement 5.4: Identify pip install commands
    if (this.isPipInstall(trimmed)) {
      const payload = this.generatePipRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
        };
      }
    }

    // ── Apt package installation (Debian/Ubuntu) ─────────────────────
    // Requirement 5.4: Identify apt install commands
    if (this.isAptInstall(trimmed)) {
      const payload = this.generateAptRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
        };
      }
    }

    // ── Homebrew package installation (AG-SAF-02) ─────────────────────
    if (this.isBrewInstall(trimmed)) {
      const payload = this.generateBrewRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
        };
      }
    }

    // ── Cargo package installation (Rust) ─────────────────────────────
    // Requirement 5.4: Identify cargo install commands
    if (this.isCargoInstall(trimmed)) {
      const payload = this.generateCargoRollbackPayload(trimmed);
      if (payload) {
        return {
          strategy: 'package_uninstall',
          reversible: true,
          rollbackCommand: this._formatRollbackPayload(payload),
          rollbackPayload: payload,
          partial: false,
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
   * Retention invariant: the newest `keepCount` records for the task are
   * kept; everything older is deleted regardless of reversibility. Deleting a
   * record orphans its command_file_links rows — prune command history no
   * more aggressively than file snapshots.
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
    // ── dd: only irreversible when targeting block devices ──────────────
    // dd of=/dev/sda  → irreversible (device write)
    // dd of=output.dat → conditionally reversible (file write)
    if (/^dd\s+/i.test(command)) {
      const ofMatch = command.match(/\bof=(\S+)/);
      if (ofMatch) {
        const target = ofMatch[1];
        // Device paths: /dev/sd*, /dev/nvme*, /dev/mmc*, /dev/hd*, /dev/vd*, etc.
        if (/^\/dev\//.test(target) || /^\\\\.\\.+/.test(target)) {
          return true;
        }
        // Common Windows raw device paths
        if (/^[A-Z]:$/.test(target) || /^\\\\?\\[A-Z]:/.test(target)) {
          return true;
        }
      }
      // dd without of= is read-only (not destructive)
      return false;
    }

    const irreversiblePatterns = [
      /^mkfs/i, // mkfs (make filesystem - destructive)
      /^format\s+/i, // format (Windows disk format)
      /^shred\s+/i, // shred (secure file deletion — intentionally overwrites)
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
   * Tokenize a command string into argv-like tokens (AG-SAF-02).
   * Handles single- and double-quoted arguments.
   *
   * Deliberately minimal: only whitespace splitting and one layer of quote
   * stripping. NO shell expansions ($vars, `...`, $(...), globbing) — so a
   * token can never smuggle active shell syntax into the argv array later
   * executed with shell:false; metacharacters stay inert literal characters
   * inside a single argument.
   */
  private _tokenizePackageCommand(command: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const s = command.trim();
    while (i < s.length) {
      // skip whitespace
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      let token = '';
      // quoted argument
      if (s[i] === '"' || s[i] === "'") {
        const quote = s[i++];
        while (i < s.length && s[i] !== quote) token += s[i++];
        i++; // closing quote
        tokens.push(token);
        continue;
      }
      // unquoted argument
      while (i < s.length && !/\s/.test(s[i])) token += s[i++];
      if (token) tokens.push(token);
    }
    return tokens;
  }

  /**
   * Extract all positional package operands from a package-manager install
   * command (AG-SAF-02). Flag tokens (--save, -g, -D, --global, ...) and any
   * flag arguments (--python-version 3.9) are skipped; every remaining
   * positional token is treated as a package operand.
   *
   * @param command - Install command (program tokens included)
   * @param skipFirstArgGroups - Number of leading program/subcommand tokens to skip
   * @returns Array of package operand tokens (may be empty)
   */
  private _extractPackageOperands(command: string, skipFirstTokens: number): string[] {
    const tokens = this._tokenizePackageCommand(command);
    const operands: string[] = [];
    for (let i = skipFirstTokens; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === '--') {
        // everything after -- is positional
        for (let j = i + 1; j < tokens.length; j++) operands.push(tokens[j]);
        break;
      }
      // Flag tokens are skipped entirely
      if (tok.startsWith('-') && tok !== '-') continue;
      operands.push(tok);
    }
    return operands;
  }

  /**
   * Check if command is a brew install operation (AG-SAF-02).
   */
  private isBrewInstall(command: string): boolean {
    return /^brew\s+(install|add)\s+/.test(command);
  }

  /**
   * Generate npm uninstall rollback payload (AG-SAF-01/02).
   *
   * Extracts ALL package operands and generates a structured uninstall
   * payload removing every installed name. Version specifiers are stripped.
   *
   * @param command - npm install command
   * @returns Structured payload, or null if no package operands found
   */
  private generateNpmRollbackPayload(command: string): RollbackPayload | null {
    const operands = this._extractPackageOperands(command, 2); // 'npm' + 'install|i'
    if (operands.length === 0) return null;

    const names: string[] = [];
    for (const operand of operands) {
      let packageName = operand;
      // Strip @version but keep @scope (e.g. @babel/core@7.12.0 → @babel/core)
      packageName = packageName.replace(/@([0-9]).*$/, '');
      if (packageName) names.push(packageName);
    }
    if (names.length === 0) return null;

    return { program: 'npm', args: ['uninstall', ...names] };
  }

  /**
   * Generate yarn remove rollback payload (AG-SAF-01/02).
   *
   * @param command - yarn add/install command
   * @returns Structured payload, or null if no package operands found
   */
  private generateYarnRollbackPayload(command: string): RollbackPayload | null {
    const operands = this._extractPackageOperands(command, 2); // 'yarn' + 'add|install'
    if (operands.length === 0) return null;
    return { program: 'yarn', args: ['remove', ...operands] };
  }

  /**
   * Generate pip uninstall rollback payload (AG-SAF-01/02).
   *
   * Extracts ALL package operands and strips version specifiers
   * (==, >=, ~=, [extras]).
   *
   * @param command - pip/pip3 install command
   * @returns Structured payload, or null if no package operands found
   */
  private generatePipRollbackPayload(command: string): RollbackPayload | null {
    const tokens = this._tokenizePackageCommand(command);
    const isPip3 = /^pip3\b/.test(tokens[0] || '');
    // 'pip' + 'install' (note: pip has flag-like requirements e.g. -r requirements.txt)
    const operands = this._extractPackageOperands(command, 2);
    const names: string[] = [];
    for (const operand of operands) {
      // Extract base package name (remove [extras] and version specifiers)
      const baseName = operand.split(/[[\]=<>!~]/)[0];
      if (baseName) names.push(baseName);
    }
    if (names.length === 0) return null;

    const program = isPip3 ? 'pip3' : 'pip';
    return { program, args: ['uninstall', '-y', ...names] };
  }

  /**
   * Generate apt remove rollback payload (AG-SAF-01/02).
   *
   * @param command - apt/apt-get install command
   * @returns Structured payload, or null if no package operands found
   */
  private generateAptRollbackPayload(command: string): RollbackPayload | null {
    const tokens = this._tokenizePackageCommand(command);
    const isAptGet = /^apt-get\b/.test(tokens[0] || '');
    const operands = this._extractPackageOperands(command, 2);
    if (operands.length === 0) return null;

    const program = isAptGet ? 'apt-get' : 'apt-get';
    return { program, args: ['remove', '-y', ...operands] };
  }

  /**
   * Generate brew uninstall rollback payload (AG-SAF-02).
   *
   * @param command - brew install command
   * @returns Structured payload, or null if no package operands found
   */
  private generateBrewRollbackPayload(command: string): RollbackPayload | null {
    const operands = this._extractPackageOperands(command, 2); // 'brew' + 'install'
    if (operands.length === 0) return null;
    return { program: 'brew', args: ['uninstall', ...operands] };
  }

  /**
   * Generate cargo uninstall rollback payload (AG-SAF-01).
   *
   * @param command - cargo install command
   * @returns Structured payload, or null if unable to parse
   */
  private generateCargoRollbackPayload(command: string): RollbackPayload | null {
    const operands = this._extractPackageOperands(command, 2);
    const names: string[] = [];
    for (const operand of operands) {
      const crateName = operand.split(/[=@]/)[0];
      if (crateName) names.push(crateName);
    }
    if (names.length === 0) return null;
    return { program: 'cargo', args: ['uninstall', ...names] };
  }

  /**
   * Render a structured rollback payload as a human-readable command string
   * (display/logging only — never executed).
   */
  private _formatRollbackPayload(payload: RollbackPayload): string {
    return [payload.program, ...payload.args].join(' ');
  }

  /**
   * Generate npm uninstall rollback command (legacy display string).
   *
   * Extracts package names from npm install and generates uninstall command.
   *
   * @param command - npm install command
   * @returns Rollback command or null if unable to parse
   */
  private generateNpmRollback(command: string): string | null {
    const payload = this.generateNpmRollbackPayload(command);
    return payload ? this._formatRollbackPayload(payload) : null;
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
   * Generate yarn remove rollback command (legacy display string).
   *
   * @param command - yarn add/install command
   * @returns Rollback command or null if unable to parse
   */
  private generateYarnRollback(command: string): string | null {
    const payload = this.generateYarnRollbackPayload(command);
    return payload ? this._formatRollbackPayload(payload) : null;
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
   * Generate pip uninstall rollback command (legacy display string).
   *
   * Extracts package names from pip install and generates uninstall command.
   *
   * @param command - pip install command
   * @returns Rollback command or null if unable to parse
   */
  private generatePipRollback(command: string): string | null {
    const payload = this.generatePipRollbackPayload(command);
    return payload ? this._formatRollbackPayload(payload) : null;
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
   * Generate apt remove rollback command (legacy display string).
   *
   * Extracts package names from apt install and generates remove command.
   *
   * @param command - apt install command
   * @returns Rollback command or null if unable to parse
   */
  private generateAptRollback(command: string): string | null {
    const payload = this.generateAptRollbackPayload(command);
    return payload ? this._formatRollbackPayload(payload) : null;
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
   * Generate cargo uninstall rollback command (legacy display string).
   *
   * Extracts crate names from cargo install and generates uninstall command.
   *
   * @param command - cargo install command
   * @returns Rollback command or null if unable to parse
   */
  private generateCargoRollback(command: string): string | null {
    const payload = this.generateCargoRollbackPayload(command);
    return payload ? this._formatRollbackPayload(payload) : null;
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

  // ── Destructive command file capture ────────────────────────────────

  /**
   * Parse a destructive shell command and extract targets.
   * Supports rm, mv, cp, sed -i, tee, dd, truncate, sponge,
   * and Windows rd/rmdir/erase/ren commands.
   *
   * @param command - The raw command string
   * @param cwd - Working directory for resolving relative paths
   * @returns Parsed command info or null if not a handled destructive command
   */
  parseDestructiveCommand(command: string, cwd: string): DestructiveCommandInfo | null {
    if (!command || typeof command !== 'string') return null;
    const trimmed = command.trim();
    if (!trimmed) return null;

    // Normalize: collapse whitespace, strip leading PowerShell prefix
    let normalized = trimmed;
    normalized = normalized.replace(/^cmd\s+\/c\s+/i, '');
    normalized = normalized.replace(/^powershell\s+-Command\s+["']/i, '');
    normalized = normalized.replace(/["']$/, '');

    // Split into tokens, handling quoted strings
    const tokens = this._tokenizeCommand(normalized);
    if (tokens.length === 0) return null;

    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    // Also parse shell redirections in the command
    const redirectFiles = this._parseFileRedirections(normalized, cwd);

    // ── rm / del / erase / rd / rmdir / remove-item: Remove files/dirs ──
    if (cmd === 'rm' || cmd === 'del' || cmd === 'erase' || cmd === 'remove-item' ||
        cmd === 'rd' || cmd === 'rmdir') {
      const isPwsh = cmd === 'remove-item';
      const isRd = cmd === 'rd' || cmd === 'rmdir';
      const parsedArgs = this._parseRmArgs(args, isPwsh, isRd);
      if (parsedArgs.targets.length === 0) {
        // Return with just redirections if any
        if (redirectFiles.length > 0) {
          return { operation: 'rm', targets: [], force: false, redirectFiles };
        }
        return null;
      }

      return {
        operation: 'rm',
        targets: parsedArgs.targets.map(t => ({
          original: t.original,
          resolved: path.resolve(cwd, t.original),
          recursive: t.recursive || parsedArgs.recursive,
        })),
        force: parsedArgs.force,
        redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
      };
    }

    // ── mv / move / move-item / rename-item / ren / rename: Move/rename ──
    if (cmd === 'mv' || cmd === 'move' || cmd === 'move-item' ||
        cmd === 'rename-item' || cmd === 'ren' || cmd === 'rename') {
      const parsedArgs = this._parseMvCpArgs(args);
      if (parsedArgs.targets.length < 1 || !parsedArgs.destination) {
        if (redirectFiles.length > 0) {
          return { operation: 'mv', targets: [], force: false, redirectFiles };
        }
        return null;
      }

      return {
        operation: 'mv',
        targets: parsedArgs.targets.map(t => ({
          original: t,
          resolved: path.resolve(cwd, t),
          recursive: false,
        })),
        destination: path.resolve(cwd, parsedArgs.destination),
        force: parsedArgs.force,
        redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
      };
    }

    // ── cp / copy / copy-item / xcopy / robocopy: Copy files ─────────
    if (cmd === 'cp' || cmd === 'copy' || cmd === 'copy-item' ||
        cmd === 'xcopy' || cmd === 'robocopy') {
      const parsedArgs = this._parseMvCpArgs(args);
      if (parsedArgs.targets.length < 1 || !parsedArgs.destination) {
        if (redirectFiles.length > 0) {
          return { operation: 'cp', targets: [], force: false, redirectFiles };
        }
        return null;
      }

      return {
        operation: 'cp',
        targets: parsedArgs.targets.map(t => ({
          original: t,
          resolved: path.resolve(cwd, t),
          recursive: parsedArgs.recursive,
        })),
        destination: path.resolve(cwd, parsedArgs.destination),
        force: parsedArgs.force,
        redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
      };
    }

    // ── sed -i: In-place file editing ─────────────────────────────────
    // sed -i 's/foo/bar/g' file.txt
    // sed -i.bak 's/foo/bar/g' file.txt  (macOS: backup extension)
    // sed -i '' 's/foo/bar/g' file.txt   (macOS: no backup)
    if (cmd === 'sed') {
      const sedTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      let foundInline = false;
      let i = 0;

      // Check for -i or --in-place flag
      while (i < args.length) {
        const arg = args[i];
        if (arg === '-i' || arg === '--in-place') {
          foundInline = true;
          // Next arg may be the backup extension (sed -i.bak or sed -i '' or sed -i.bak)
          // In sed, -i optionally takes an argument: -iBAK or -i BAK
          if (i + 1 < args.length && !args[i + 1].startsWith('-') && args[i + 1] !== '' && !/^[a-z]/i.test(args[i + 1])) {
            // It could be the extension like .bak, but only if it doesn't look like a command
            i++;
          }
          i++;
          break;
        }
        if (arg.startsWith('-i')) {
          // -i.bak style (no space between -i and extension)
          foundInline = true;
          i++;
          break;
        }
        i++;
      }

      if (foundInline) {
        // Remaining args after -i and its backup extension are file targets
        // Skip the sed expression (which starts with s/ or similar)
        while (i < args.length) {
          const arg = args[i];
          // Skip flags
          if (arg.startsWith('-')) { i++; continue; }
          // Skip the sed command expression (s/pattern/replacement/flags or similar)
          if (/^[sey]\/|^\/|^#|^@/.test(arg) || /^[0-9]+[acdilnpqrstw]$/.test(arg)) { i++; continue; }
          // Skip empty strings and flags disguised as expressions
          if (arg === '' || arg === '--') { i++; if (arg === '--') { i++; } continue; }
          // Remaining are file paths
          sedTargets.push({
            original: arg,
            resolved: path.resolve(cwd, arg),
            recursive: false,
          });
          i++;
        }
      }

      if (sedTargets.length > 0) {
        return {
          operation: 'sed',
          targets: sedTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── tee: Pipe output to file(s) ───────────────────────────────────
    // echo "text" | tee file.txt
    // echo "text" | tee -a file.txt
    // echo "text" | tee file1.txt file2.txt
    if (cmd === 'tee') {
      const teeTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      for (const arg of args) {
        if (arg.startsWith('-')) continue; // Skip flags (-a, --append, -i, --ignore-interrupts)
        if (arg.startsWith('"') || arg.startsWith("'")) {
          const unquoted = arg.replace(/^["']|["']$/g, '');
          if (unquoted) {
            teeTargets.push({
              original: unquoted,
              resolved: path.resolve(cwd, unquoted),
              recursive: false,
            });
          }
        } else {
          teeTargets.push({
            original: arg,
            resolved: path.resolve(cwd, arg),
            recursive: false,
          });
        }
      }

      if (teeTargets.length > 0) {
        return {
          operation: 'tee',
          targets: teeTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── dd: Raw device/file copy ─────────────────────────────────────
    // dd if=/dev/zero of=output.dat bs=1M count=10
    // dd of=output.txt
    if (cmd === 'dd') {
      const ddTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      for (const arg of args) {
        if (arg.startsWith('of=')) {
          const ofPath = arg.slice(3);
          if (ofPath) {
            ddTargets.push({
              original: ofPath,
              resolved: path.resolve(cwd, ofPath),
              recursive: false,
            });
          }
        }
      }

      if (ddTargets.length > 0) {
        return {
          operation: 'dd',
          targets: ddTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── truncate: Shrink/extend files ─────────────────────────────────
    // truncate -s 0 file.txt
    // truncate --size 0 file.txt
    if (cmd === 'truncate') {
      const truncTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      let i = 0;
      while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('-')) {
          // Skip flags: -s, --size, -c, --no-create, -r, --reference
          if (arg === '-s' || arg === '--size' || arg === '-r' || arg === '--reference' || arg === '-c' || arg === '--no-create') {
            i += 2; // Skip flag and its value
            continue;
          }
          if (arg.startsWith('-s') && arg.length > 2) {
            i++; // -s0 style
            continue;
          }
          i++;
          continue;
        }
        truncTargets.push({
          original: arg,
          resolved: path.resolve(cwd, arg),
          recursive: false,
        });
        i++;
      }

      if (truncTargets.length > 0) {
        return {
          operation: 'truncate',
          targets: truncTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── sponge: Soak up stdin and write to file ──────────────────────
    // cat file.txt | sponge output.txt
    if (cmd === 'sponge') {
      const spongeTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      for (const arg of args) {
        if (arg.startsWith('-')) continue;
        spongeTargets.push({
          original: arg,
          resolved: path.resolve(cwd, arg),
          recursive: false,
        });
      }

      if (spongeTargets.length > 0) {
        return {
          operation: 'sponge',
          targets: spongeTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── sort -o: In-place sort (overwrites input file) ────────────────
    // sort -o file.txt file.txt
    // sort file.txt -o file.txt
    if (cmd === 'sort') {
      const sortTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      let i = 0;
      while (i < args.length) {
        const arg = args[i];
        if (arg === '-o' || arg === '--output') {
          if (i + 1 < args.length) {
            const outFile = args[i + 1];
            sortTargets.push({
              original: outFile,
              resolved: path.resolve(cwd, outFile),
              recursive: false,
            });
            i += 2;
            continue;
          }
        }
        if (arg.startsWith('-o') && arg.length > 2) {
          // -ooutput.txt style
          const outFile = arg.slice(2);
          sortTargets.push({
            original: outFile,
            resolved: path.resolve(cwd, outFile),
            recursive: false,
          });
          i++;
          continue;
        }
        i++;
      }

      if (sortTargets.length > 0) {
        return {
          operation: 'sort',
          targets: sortTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── install: Copy files and set attributes ───────────────────────
    // install -m 644 source.txt dest.txt
    // install source.txt dest.txt
    if (cmd === 'install') {
      const installTargets = this._parseInstallArgs(args, cwd);
      if (installTargets) {
        return {
          operation: 'install',
          targets: installTargets.targets,
          destination: installTargets.destination,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── rsync: File synchronization (capture dest before overwrite) ──
    // rsync -a source/ dest/
    // rsync -av source.txt dest.txt
    if (cmd === 'rsync') {
      const rsyncTargets = this._parseRsyncArgs(args, cwd);
      if (rsyncTargets) {
        return {
          operation: 'rsync',
          targets: rsyncTargets.targets,
          destination: rsyncTargets.destination,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── git checkout / git restore: Capture files before git overwrites ──
    // git checkout -- file.txt          (restore from index)
    // git checkout HEAD -- file.txt     (restore from HEAD)
    // git restore file.txt              (restore from index, newer git)
    // git restore --source=HEAD file.txt
    if (cmd === 'git') {
      const subcommand = args[0]?.toLowerCase();

      // git checkout -- <files> or git checkout <tree-ish> -- <files>
      if (subcommand === 'checkout') {
        const gitTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
        let afterDoubleDash = false;

        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a === '--') {
            afterDoubleDash = true;
            continue;
          }
          if (!afterDoubleDash && a.startsWith('-')) continue; // Skip flags before --
          if (!afterDoubleDash && a.startsWith('*')) continue;  // Could be a branch glob
          // After --, everything is a file path; before --, non-flag non-branch names are pathspecs too
          if (!afterDoubleDash && /^[a-zA-Z0-9_\-./\\]+$/.test(a) && i === args.length - 1) continue; // Last non-flag before -- is likely tree-ish
          if (afterDoubleDash || (!a.startsWith('-') && i >= 2)) {
            // Check if this is likely a file path
            const resolved = path.resolve(cwd, a);
            try { if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isFile()) { /* valid */ } } catch { /* continue */ }
            gitTargets.push({ original: a, resolved, recursive: false });
          }
        }

        if (gitTargets.length > 0) {
          return {
            operation: 'git',
            targets: gitTargets,
            force: false,
            redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
          };
        }
      }

      // git restore <files>
      if (subcommand === 'restore') {
        const gitTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith('-')) continue; // Skip flags: --source, --staged, --worktree, etc.
          if (a === '--') continue;
          const resolved = path.resolve(cwd, a);
          gitTargets.push({ original: a, resolved, recursive: false });
        }

        if (gitTargets.length > 0) {
          return {
            operation: 'git',
            targets: gitTargets,
            force: false,
            redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
          };
        }
      }

      // git clean -fd (remove untracked files — capture them first)
      if (subcommand === 'clean') {
        const flags = args.slice(1).filter(a => a.startsWith('-')).join('').toLowerCase();
        if (flags.includes('f') && flags.includes('d')) {
          // Force + directory = destructive
          return {
            operation: 'git',
            targets: [], // Will be populated by caller via git ls-files
            force: true,
            redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
          };
        }
      }
    }

    // ── curl -o / curl --output: Download file (capture destination before overwrite) ──
    // curl -o file.txt https://example.com/data
    // curl --output file.txt https://example.com/data
    // curl -o dir/file.txt https://example.com/data
    if (cmd === 'curl') {
      const curlTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      let i = 0;
      while (i < args.length) {
        const a = args[i];
        if (a === '-o' || a === '--output') {
          if (i + 1 < args.length) {
            const outFile = args[i + 1];
            curlTargets.push({ original: outFile, resolved: path.resolve(cwd, outFile), recursive: false });
            i += 2;
            continue;
          }
        }
        if (a.startsWith('-o') && a.length > 2) {
          // -ooutput.txt style
          const outFile = a.slice(2);
          curlTargets.push({ original: outFile, resolved: path.resolve(cwd, outFile), recursive: false });
          i++;
          continue;
        }
        i++;
      }

      if (curlTargets.length > 0) {
        return {
          operation: 'download',
          targets: curlTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── wget -O / wget --output-document: Download file ─────────────────
    // wget -O file.txt https://example.com/data
    // wget --output-document file.txt https://example.com/data
    if (cmd === 'wget') {
      const wgetTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      let i = 0;
      while (i < args.length) {
        const a = args[i];
        if (a === '-O' || a === '--output-document') {
          if (i + 1 < args.length) {
            const outFile = args[i + 1];
            wgetTargets.push({ original: outFile, resolved: path.resolve(cwd, outFile), recursive: false });
            i += 2;
            continue;
          }
        }
        if (a.startsWith('-O') && a.length > 2) {
          // -Ooutput.txt style
          const outFile = a.slice(2);
          wgetTargets.push({ original: outFile, resolved: path.resolve(cwd, outFile), recursive: false });
          i++;
          continue;
        }
        i++;
      }

      if (wgetTargets.length > 0) {
        return {
          operation: 'download',
          targets: wgetTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── npm init: Capture package.json before init overwrites it ─────
    // npm init -y
    // npm init --yes
    if ((cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm') && (args[0] === 'init' || args[0] === 'create')) {
      const pkgJsonPath = path.resolve(cwd, 'package.json');
      const npmTargets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
      try {
        if (fsSync.existsSync(pkgJsonPath) && fsSync.statSync(pkgJsonPath).isFile()) {
          npmTargets.push({ original: 'package.json', resolved: pkgJsonPath, recursive: false });
        }
      } catch { /* ignore */ }

      if (npmTargets.length > 0) {
        return {
          operation: 'download', // treat as capture-before-overwrite
          targets: npmTargets,
          force: false,
          redirectFiles: redirectFiles.length > 0 ? redirectFiles : undefined,
        };
      }
    }

    // ── Pure shell redirections (no specific destructive command) ────
    // e.g. echo "hello" > file.txt, : > file.txt, cat > file.txt
    if (redirectFiles.length > 0) {
      const redirTargets = redirectFiles.map(f => ({
        original: path.relative(cwd, f),
        resolved: f,
        recursive: false,
      }));
      return {
        operation: 'rm', // treat as file overwrite/delete
        targets: redirTargets,
        force: false,
        redirectFiles,
      };
    }

    return null;
  }

  /**
   * Tokenize a command string, respecting quoted strings.
   */
  private _tokenizeCommand(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];
      if (inQuote) {
        if (ch === inQuote && (i === 0 || command[i - 1] !== '\\')) {
          tokens.push(current);
          current = '';
          inQuote = null;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
  }

  /**
   * Parse arguments for rm command (handles -r, -rf, -f, -Recurse, etc.).
   */
  private _parseRmArgs(
    args: string[], isPwsh: boolean, isRd: boolean = false
  ): { targets: Array<{ original: string; recursive: boolean }>; recursive: boolean; force: boolean } {
    const targets: Array<{ original: string; recursive: boolean }> = [];
    let recursive = false;
    let force = false;

    for (const arg of args) {
      if (arg.startsWith('-') || (isRd && arg.startsWith('/'))) {
        // Remove leading - or -- (or / for rd/rmdir)
        const raw = isRd && arg.startsWith('/') ? arg.slice(1) : arg.replace(/^--?/, '');
        const flags = raw.toLowerCase();

        // Unix/PowerShell flags
        if (flags.includes('r') || flags === 'recurse' || flags === 'recursive') recursive = true;
        if (flags.includes('f') || flags === 'force') force = true;

        // Windows rd/rmdir flags
        if (isRd && (flags.includes('s') || flags === 's')) recursive = true;
        if (isRd && (flags.includes('q') || flags === 'q')) force = true;
      } else if (isPwsh && (arg.toLowerCase() === '-recurse' || arg.toLowerCase() === '-force' || arg.toLowerCase() === '-confirm:$false')) {
        // PowerShell named flags
        if (arg.toLowerCase() === '-recurse') recursive = true;
        if (arg.toLowerCase() === '-force') force = true;
      } else {
        targets.push({ original: arg, recursive: false });
      }
    }

    return { targets, recursive, force };
  }

  /**
   * Parse arguments for mv/cp commands.
   */
  private _parseMvCpArgs(
    args: string[]
  ): { targets: string[]; destination?: string; recursive: boolean; force: boolean } {
    const targets: string[] = [];
    let recursive = false;
    let force = false;

    for (const arg of args) {
      if (arg.startsWith('-')) {
        const flags = arg.replace(/^--?/, '').toLowerCase();
        if (flags.includes('r') || flags === 'recursive') recursive = true;
        if (flags.includes('f') || flags === 'force') force = true;
      } else if (arg.startsWith('-')) {
        continue;
      } else {
        targets.push(arg);
      }
    }

    // Last target is the destination
    const destination = targets.length > 1 ? targets.pop() : undefined;

    return { targets, destination, recursive, force };
  }

  /**
   * Parse arguments for install command (copy + set attributes).
   * install -m 644 source.txt dest.txt
   * install source.txt dest.txt
   * install -d dir  (create directory only — skip)
   */
  private _parseInstallArgs(
    args: string[], cwd: string
  ): { targets: Array<{ original: string; resolved: string; recursive: boolean }>; destination?: string } | null {
    // Skip directory-only installs (-d, --directory)
    if (args.some(a => a === '-d' || a === '--directory')) return null;

    const targets: Array<{ original: string; resolved: string; recursive: boolean }> = [];
    const pathArgs: string[] = [];
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg.startsWith('-')) {
        // Skip flags and their values: -m 644, -g root, -o root, -s (strip), -t dir
        if (arg === '-m' || arg === '--mode' || arg === '-g' || arg === '--group' ||
            arg === '-o' || arg === '--owner' || arg === '-t' || arg === '--target-directory') {
          i += 2;
          continue;
        }
        if (arg === '-s' || arg === '--strip') { i++; continue; }
        if (arg === '-D') { i++; continue; } // Create leading components (skip)
        i++;
        continue;
      }
      pathArgs.push(arg);
      i++;
    }

    if (pathArgs.length < 1) return null;
    const destination = pathArgs.length > 1 ? pathArgs[pathArgs.length - 1] : undefined;
    const sourcePaths = pathArgs.length > 1 ? pathArgs.slice(0, -1) : pathArgs;

    for (const src of sourcePaths) {
      targets.push({ original: src, resolved: path.resolve(cwd, src), recursive: false });
    }

    return {
      targets,
      destination: destination ? path.resolve(cwd, destination) : undefined,
    };
  }

  /**
   * Parse arguments for rsync command (file synchronization).
   * rsync -a source/ dest/
   * rsync -av source.txt dest.txt
   * rsync -av --delete source/ dest/
   */
  private _parseRsyncArgs(
    args: string[], cwd: string
  ): { targets: Array<{ original: string; resolved: string; recursive: boolean }>; destination?: string } | null {
    const pathArgs: string[] = [];
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg.startsWith('-')) {
        // rsync options: -a, -v, -r, -z, --delete, --exclude, etc.
        if (arg === '--exclude' || arg === '--include' || arg === '--filter' ||
            arg === '--files-from' || arg === '--password-file' || arg === '--rsync-path' ||
            arg === '--log-file' || arg === '--backup-dir' || arg === '--temp-dir' ||
            arg === '--partial-dir' || arg === '--compare-dest' || arg === '--copy-dest' ||
            arg === '--link-dest') {
          i += 2; // Skip option and its value
          continue;
        }
        // Single-char option with value: -e (ssh command), --rsh
        if (arg === '-e' || arg === '--rsh') {
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      // Skip paths with trailing colon (remote rsync)
      if (arg.includes(':')) { i++; continue; }
      pathArgs.push(arg);
      i++;
    }

    if (pathArgs.length < 2) return null;
    const destination = pathArgs[pathArgs.length - 1];
    const sourcePaths = pathArgs.slice(0, -1);

    // Strip trailing slashes from source paths
    const targets = sourcePaths.map(src => ({
      original: src,
      resolved: path.resolve(cwd, src.replace(/\/$/, '')),
      recursive: false,
    }));

    return {
      targets,
      destination: path.resolve(cwd, destination),
    };
  }

  /**
   * Parse shell file redirection operators (> file, 2> file, &> file, >> file)
   * from a command string, respecting quoted strings from _tokenizeCommand.
   *
   * @param command - Raw command string
   * @param cwd - Working directory for resolving paths
   * @returns Array of resolved absolute file paths being written to via redirection
   */
  private _parseFileRedirections(command: string, cwd: string): string[] {
    const files: string[] = [];
    const tokens = this._tokenizeCommand(command);

    for (let i = 0; i < tokens.length - 1; i++) {
      const token = tokens[i];
      const nextToken = tokens[i + 1];

      // Must contain > to be any kind of redirection
      if (!token.includes('>')) continue;

      // Skip file descriptor redirects: 2>&1, >&2, 1>&2, >>&1, etc.
      if (/^(?:\d*&?>|>>)&?\d+$/.test(token)) continue;

      // Must be a file redirection operator pattern
      if (!/^(?:\d*&?>{1,2}|>{1,2}\|?|<>)$/.test(token)) continue;

      // If next token is just digits (a fd number), skip
      if (/^\d+$/.test(nextToken) && !token.includes('&')) continue;

      const resolved = path.resolve(cwd, nextToken);
      files.push(resolved);
    }

    return [...new Set(files)];
  }

  /**
   * Expand a glob pattern to matching file paths.
   * Uses fast-glob for high-performance glob expansion.
   *
   * @param pattern - Glob pattern to expand (e.g. "*.log", "**", "dist/*.js")
   * @param cwd - Working directory for resolution
   * @returns Array of resolved absolute file paths
   *
   * Glob expansion happens in-process via fast-glob, never by shelling out
   * (`sh -c 'ls ...'`), so an adversarial pattern can enumerate files but
   * cannot execute anything.
   */
  expandGlob(pattern: string, cwd: string): string[] {
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[') && !pattern.includes('!') && !pattern.includes('{')) {
      // Not a glob — return as-is if it exists
      const resolved = path.resolve(cwd, pattern);
      try {
        if (fsSync.existsSync(resolved)) return [resolved];
      } catch { /* ignore */ }
      return [resolved];
    }
    return fg.sync(pattern, { cwd, absolute: true, dot: true, onlyFiles: false });
  }

  /**
   * Capture a list of paths in parallel using a concurrency pool.
   *
   * Concurrency is capped (default 15) rather than unbounded Promise.all:
   * each capture opens a file handle, reads it fully, and writes a DB row —
   * an unbounded pool over a large directory would exhaust file descriptors
   * and starve the single SQLite writer. Per-path failures become warnings;
   * one unreadable file must not cancel the whole pre-destructive backup.
   */
  async capturePathsParallel(
    pathsToCapture: Array<{ resolved: string; original: string }>,
    taskId: string,
    stepNumber: number,
    concurrencyLimit = 15
  ): Promise<{ snapshotIds: string[]; totalSizeBytes: number; paths: string[]; warnings: string[] }> {
    const snapshotIds: string[] = [];
    const capturedPaths: string[] = [];
    const warnings: string[] = [];
    let totalSizeBytes = 0;

    const results: Array<{ snapshotId: string | null; path: string; size: number; warning?: string; paths?: string[]; snapshotIds?: string[] }> = [];

    // Simple queue-based concurrency pool
    let index = 0;
    const workers = Array(Math.min(concurrencyLimit, pathsToCapture.length)).fill(null).map(async () => {
      while (index < pathsToCapture.length) {
        const currentIdx = index++;
        const target = pathsToCapture[currentIdx];
        try {
          if (!fsSync.existsSync(target.resolved)) {
            results.push({ snapshotId: null, path: target.resolved, size: 0, warning: `Target does not exist: ${target.original}` });
            continue;
          }
          const stat = fsSync.statSync(target.resolved);
          if (stat.isDirectory()) {
            const dirSummary = await this._captureDirectory(target.resolved, taskId, stepNumber);
            results.push({
              snapshotId: null,
              path: target.resolved,
              size: dirSummary.totalSizeBytes,
              paths: dirSummary.paths,
              snapshotIds: dirSummary.snapshotIds,
            });
            if (dirSummary.warnings.length > 0) {
              for (const w of dirSummary.warnings) {
                results.push({ snapshotId: null, path: target.resolved, size: 0, warning: w });
              }
            }
          } else if (stat.isFile()) {
            const snapshotId = await this._captureSingleFile(target.resolved, taskId, stepNumber);
            results.push({
              snapshotId,
              path: target.resolved,
              size: snapshotId ? stat.size : 0,
              warning: snapshotId ? undefined : `Could not capture file: ${target.original}`
            });
          }
        } catch (err) {
          results.push({
            snapshotId: null,
            path: target.resolved,
            size: 0,
            warning: `Could not capture ${target.original}: ${(err as Error).message}`
          });
        }
      }
    });

    await Promise.all(workers);

    for (const res of results) {
      if (res.snapshotId) {
        snapshotIds.push(res.snapshotId);
        capturedPaths.push(res.path);
        totalSizeBytes += res.size;
      } else if (res.snapshotIds && res.paths) {
        snapshotIds.push(...res.snapshotIds);
        capturedPaths.push(...res.paths);
        totalSizeBytes += res.size;
      }
      if (res.warning) {
        warnings.push(res.warning);
      }
    }

    return { snapshotIds, totalSizeBytes, paths: capturedPaths, warnings };
  }

  /**
   * Auto-detect and capture all modified/deleted/staged files in the git working tree.
   *
   * Git is probed via execFile with a literal argv (never a shell string) —
   * cwd is an arbitrary user directory, and argv form guarantees nothing in
   * it is shell-interpreted. The 5s timeout bounds huge repos; failure
   * degrades to a warning rather than aborting the pre-destructive capture.
   */
  async captureGitChangedFiles(cwd: string, taskId: string, stepNumber: number): Promise<CaptureSummary> {
    const warnings: string[] = [];
    const pathsToCapture: Array<{ resolved: string; original: string }> = [];

    try {
      let output: string | null = null;
      const cached = gitStatusCache.get(cwd);
      if (cached && Date.now() - cached.ts < GIT_STATUS_CACHE_TTL_MS) {
        output = cached.out;
      } else {
        gitStatusCache.delete(cwd);
        // Fixed literal args, no shell, short timeout — safe no matter what
        // the working directory contains (argv-execution, AG-SAF-01 style).
        const result = await execFileAsync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 });
        output = result.stdout ?? '';
        gitStatusCache.set(cwd, { ts: Date.now(), out: output });
      }
      const lines = output.split('\n').filter(Boolean);

      for (const line of lines) {
        let file = line.slice(3).trim();
        if (file.startsWith('"') && file.endsWith('"')) {
          file = file.slice(1, -1);
        }

        // Handle renamed files (status XY renamed-from -> renamed-to)
        if (file.includes(' -> ')) {
          const parts = file.split(' -> ');
          file = parts[parts.length - 1].trim();
        }

        const resolved = path.resolve(cwd, file);
        pathsToCapture.push({ resolved, original: file });
      }
    } catch (err) {
      warnings.push(`Failed to list git changed files: ${(err as Error).message}`);
    }

    if (pathsToCapture.length === 0) {
      return { snapshotIds: [], fileCount: 0, totalSizeBytes: 0, paths: [], warnings };
    }

    const parallelResult = await this.capturePathsParallel(pathsToCapture, taskId, stepNumber);
    return {
      snapshotIds: parallelResult.snapshotIds,
      fileCount: parallelResult.snapshotIds.length,
      totalSizeBytes: parallelResult.totalSizeBytes,
      paths: parallelResult.paths,
      warnings: [...warnings, ...parallelResult.warnings]
    };
  }

  /**
   * Capture file content and create deletion/modification snapshots BEFORE
   * a destructive operation. Handles rm, mv, cp, sed -i, tee, dd, truncate,
   * sponge, and shell redirections (> file, 2> file, &> file).
   *
   * Call this BEFORE executing the command to ensure content is preserved.
   *
   * Invariant: nothing destructive may run until every captureable target
   * has a snapshot row committed to the DB. Uncapturable targets produce
   * warnings (rollback then simply cannot restore them) — but the capture
   * never silently pretends a missing file was backed up.
   *
   * @param command - The destructive command about to be executed
   * @param cwd - Working directory for resolving paths
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns Capture summary with snapshot IDs and file count
   */
  async captureFilesBeforeDestructiveCommand(
    command: string,
    cwd: string,
    taskId: string,
    stepNumber: number
  ): Promise<CaptureSummary> {
    this.ensureInitialized();

    const emptySummary: CaptureSummary = { snapshotIds: [], fileCount: 0, totalSizeBytes: 0, paths: [], warnings: [] };
    const cmdInfo = this.parseDestructiveCommand(command, cwd);
    if (!cmdInfo) return emptySummary;

    console.log(`[RollbackManager] Pre-capturing files for: ${cmdInfo.operation} (${command.substring(0, 80)})`);

    const snapshotIds: string[] = [];
    const allPaths: string[] = [];
    const warnings: string[] = [];
    let totalSizeBytes = 0;

    const pathsToCapture: Array<{ resolved: string; original: string }> = [];

    // ── rm: File/directory deletion ──────────────────────────────────
    if (cmdInfo.operation === 'rm') {
      for (const target of cmdInfo.targets) {
        let targetExists = false;
        try { targetExists = fsSync.existsSync(target.resolved); } catch { /* ignore */ }

        if (!targetExists) {
          // Try glob expansion
          // The shell would have expanded this operand before rm saw it; we
          // must enumerate the same matches ourselves or `rm *.log`-style
          // commands would capture nothing.
          const globResults = this.expandGlob(target.original, cwd);
          const actualMatches = globResults.filter(r => { try { return fsSync.existsSync(r); } catch { return false; } });
          if (actualMatches.length > 0) {
            for (const globPath of actualMatches) {
              pathsToCapture.push({ resolved: globPath, original: target.original });
            }
            continue;
          }
          warnings.push(`Target does not exist: ${target.original}`);
          continue;
        }

        const stat = fsSync.statSync(target.resolved);
        if (stat.isDirectory()) {
          if (!cmdInfo.targets.some(t => t.recursive) && !cmdInfo.force) {
            warnings.push(`Skipping directory (no -r flag): ${target.original}`);
            continue;
          }
          pathsToCapture.push({ resolved: target.resolved, original: target.original });
        } else if (stat.isFile()) {
          pathsToCapture.push({ resolved: target.resolved, original: target.original });
        }
      }
    }

    // ── mv / cp: Move/rename/copy (capture destination before overwrite) ──
    // mv sources survive the move, so the content actually at risk is the
    // DESTINATION's current bytes — capture them or the overwrite loses them.
    else if (cmdInfo.operation === 'mv' || cmdInfo.operation === 'cp') {
      if (cmdInfo.destination) {
        try {
          if (fsSync.existsSync(cmdInfo.destination)) {
            const stat = fsSync.statSync(cmdInfo.destination);
            if (stat.isFile()) {
              pathsToCapture.push({ resolved: cmdInfo.destination, original: cmdInfo.destination });
            } else if (stat.isDirectory() && cmdInfo.operation === 'mv') {
              for (const target of cmdInfo.targets) {
                const destFile = path.join(cmdInfo.destination, path.basename(target.resolved));
                pathsToCapture.push({ resolved: destFile, original: path.basename(target.original) });
              }
            }
          }
        } catch (err) {
          warnings.push(`Could not capture destination ${cmdInfo.destination}: ${(err as Error).message}`);
        }
      }
    }

    // ── sed / tee / dd / truncate / sponge / sort / download ───────────
    else if (
      cmdInfo.operation === 'sed' ||
      cmdInfo.operation === 'tee' ||
      cmdInfo.operation === 'dd' ||
      cmdInfo.operation === 'truncate' ||
      cmdInfo.operation === 'sponge' ||
      cmdInfo.operation === 'sort' ||
      cmdInfo.operation === 'download'
    ) {
      for (const target of cmdInfo.targets) {
        pathsToCapture.push({ resolved: target.resolved, original: target.original });
      }
    }

    // ── install / rsync ──────────────────────────────────────────────
    else if (cmdInfo.operation === 'install' || cmdInfo.operation === 'rsync') {
      if (cmdInfo.destination) {
        pathsToCapture.push({ resolved: cmdInfo.destination, original: cmdInfo.destination });
      }
      for (const target of cmdInfo.targets) {
        pathsToCapture.push({ resolved: target.resolved, original: target.original });
      }
    }

    // ── git checkout/restore/clean ───────────────────────────────────
    else if (cmdInfo.operation === 'git') {
      const isWholeRepoAction = cmdInfo.targets.length === 0 || cmdInfo.targets.some(t => t.original === '.' || t.original === '*');
      if (isWholeRepoAction) {
        // Sophisticated auto-detection of all modified files in working tree
        const gitSummary = await this.captureGitChangedFiles(cwd, taskId, stepNumber);
        snapshotIds.push(...gitSummary.snapshotIds);
        allPaths.push(...gitSummary.paths);
        totalSizeBytes += gitSummary.totalSizeBytes;
        warnings.push(...gitSummary.warnings);
      } else {
        for (const target of cmdInfo.targets) {
          pathsToCapture.push({ resolved: target.resolved, original: target.original });
        }
      }
      // For git clean -fd, need to list and capture untracked files
      // They are invisible to `git status` captures above and have no git
      // history to recover from, so without this snapshot they'd be gone forever.
      if (cmdInfo.force && cmdInfo.targets.length === 0) {
        try {
          const result = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf-8', timeout: 5000 });
          const untracked = (result.stdout ?? '').split('\n').filter(Boolean);
          for (const file of untracked) {
            const resolved = path.resolve(cwd, file);
            pathsToCapture.push({ resolved, original: file });
          }
        } catch { /* git not available or not a git repo — skip */ }
      }
    }

    // ── Shell redirections (> file, 2> file, &> file) ──────────────────
    // Capture the file being written to via redirection BEFORE overwrite
    // Deduped against paths already captured by the main operation branch
    // so the same file isn't snapshotted (and restored) twice.
    if (cmdInfo.redirectFiles && cmdInfo.redirectFiles.length > 0) {
      for (const redirectPath of cmdInfo.redirectFiles) {
        // Skip if already captured as part of the main operation
        if (pathsToCapture.some(p => p.resolved === redirectPath) || allPaths.includes(redirectPath)) continue;
        pathsToCapture.push({ resolved: redirectPath, original: path.relative(cwd, redirectPath) });
      }
    }

    // Execute parallel capturing
    if (pathsToCapture.length > 0) {
      const parallelResult = await this.capturePathsParallel(pathsToCapture, taskId, stepNumber);
      snapshotIds.push(...parallelResult.snapshotIds);
      allPaths.push(...parallelResult.paths);
      totalSizeBytes += parallelResult.totalSizeBytes;
      warnings.push(...parallelResult.warnings);
    }

    console.log(
      `[RollbackManager] Pre-captured ${snapshotIds.length} file(s) (${(totalSizeBytes / 1024).toFixed(1)} KB) ` +
      `for ${cmdInfo.operation} command`
    );

    return { snapshotIds, fileCount: snapshotIds.length, totalSizeBytes, paths: allPaths, warnings };
  }

  /**
   * Capture a single file as a deletion snapshot before it's removed.
   */
  private async _captureSingleFile(
    filePath: string,
    taskId: string,
    stepNumber: number
  ): Promise<string | null> {
    try {
      // Exclude pattern check
      if (this.isFileExcluded(filePath)) return null;

      // AG-SAF-05: root containment check
      if (!this.isPathWithinAllowedRoots(filePath)) {
        console.warn(`[RollbackManager] Skipped: path outside allowed roots: ${filePath}`);
        return null;
      }

      const content = await fsPromises.readFile(filePath);

      // AG-SAF-05: secrets heuristic on the file's actual content
      if (content.length > 0 && this.contentLooksLikeSecrets(content)) {
        console.warn(`[RollbackManager] Skipped: content matched secret heuristics: ${filePath}`);
        return null;
      }

      return await this._storeDeleteSnapshot(filePath, content, taskId, stepNumber);
    } catch (err) {
      console.warn(`[RollbackManager] Failed to capture file ${filePath}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Store a file deletion snapshot.
   */
  private async _storeDeleteSnapshot(
    filePath: string,
    content: string | Buffer,
    taskId: string,
    stepNumber: number
  ): Promise<string> {
    const compressedContent = await this.compressContent(content);
    const id = this.generateSnapshotId();
    const timestamp = Date.now();

    await dbOps.run(
      `INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, 'delete', ?)`,
      [id, taskId, stepNumber, filePath, compressedContent, null, timestamp]
    );

    return id;
  }

  /**
   * Recursively capture all files in a directory as deletion snapshots.
   */
  private async _captureDirectory(
    dirPath: string,
    taskId: string,
    stepNumber: number
  ): Promise<CaptureSummary> {
    const snapshotIds: string[] = [];
    const paths: string[] = [];
    const warnings: string[] = [];
    let totalSizeBytes = 0;

    const entries: string[] = [];
    try {
      this._collectFiles(dirPath, entries);
    } catch (err) {
      warnings.push(`Could not read directory ${dirPath}: ${(err as Error).message}`);
      return { snapshotIds, fileCount: 0, totalSizeBytes: 0, paths, warnings };
    }

    for (const filePath of entries) {
      try {
        const snapshotId = await this._captureSingleFile(filePath, taskId, stepNumber);
        if (snapshotId) {
          snapshotIds.push(snapshotId);
          paths.push(filePath);
          try {
            totalSizeBytes += fsSync.statSync(filePath).size;
          } catch { /* size unavailable */ }
        }
      } catch { /* skip failed captures */ }
    }

    return { snapshotIds, fileCount: snapshotIds.length, totalSizeBytes, paths, warnings };
  }

  /**
   * Collect all file paths under a directory (recursive).
   */
  private _collectFiles(dirPath: string, results: string[]): void {
    try {
      const entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (this.isFileExcluded(fullPath)) continue;
        if (entry.isDirectory()) {
          this._collectFiles(fullPath, results);
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    } catch { /* skip unreadable */ }
  }

  /**
   * Link captured file snapshots to a command record.
   * Call this AFTER trackCommandExecution to associate snapshots with the command.
   *
   * Side-effect: for file_restore commands this re-flips the record's
   * reversible flag — a destructive command is only "reversible" once it has
   * snapshots to restore from; zero linked snapshots means NOT reversible.
   *
   * @param commandId - The command record ID from trackCommandExecution
   * @param snapshotIds - Array of snapshot IDs from captureFilesBeforeDestructiveCommand
   * @returns Result with number of links created
   */
  async linkSnapshotsToCommand(commandId: string, snapshotIds: string[]): Promise<LinkSnapshotsResult> {
    this.ensureInitialized();
    if (!commandId) {
      return { commandId, snapshotIds: snapshotIds || [], linked: 0 };
    }

    const snaps = snapshotIds || [];
    let linked = 0;
    for (const snapId of snaps) {
      try {
        await dbOps.run(
          `INSERT OR IGNORE INTO command_file_links (command_id, snapshot_id) VALUES (?, ?)`,
          [commandId, snapId]
        );
        linked++;
      } catch (err) {
        console.warn(`[RollbackManager] Failed to link snapshot ${snapId} to command ${commandId}:`, err);
      }
    }

    // AG-CORR-10: only advertise reversibility when there ARE snapshots to
    // restore. Previously this flipped reversible=1 even with 0 snapshots,
    // making the rollback button appear for destructive-only command sets.
    try {
      const cmdRec = await this.getCommandRecord(commandId);
      if (cmdRec) {
        const strategyInfo = this.identifyRollbackStrategy(cmdRec.command);
        if (strategyInfo.strategy === 'file_restore') {
          await dbOps.run(
            `UPDATE command_history SET reversible = ?, rollback_command = ? WHERE id = ?`,
            [
              snaps.length > 0 ? 1 : 0,
              snaps.length > 0
                ? `[File restoration] Restore ${snaps.length} file(s) from pre-capture snapshots`
                : `[File restoration] No restorable files were captured for this command`,
              commandId
            ]
          );
        }
      }
    } catch (err) {
      console.warn(`[RollbackManager] Failed to update command reversibility:`, err);
    }

    console.log(`[RollbackManager] Linked ${linked}/${snaps.length} snapshot(s) to command ${commandId}`);
    return { commandId, snapshotIds: snaps, linked };
  }

  /**
   * Get file snapshots linked to a command record.
   *
   * @param commandId - Command record ID
   * @returns Array of file snapshots
   */
  async getFileSnapshotsForCommand(commandId: string): Promise<FileSnapshot[]> {
    this.ensureInitialized();
    try {
      const rows = await dbOps.all(
        `SELECT fs.* FROM file_snapshots fs
         JOIN command_file_links cfl ON fs.id = cfl.snapshot_id
         WHERE cfl.command_id = ?
         ORDER BY fs.timestamp ASC`,
        [commandId]
      );
      return rows.map(this.rowToSnapshot);
    } catch (err) {
      console.error(`[RollbackManager] Failed to get snapshots for command ${commandId}:`, err);
      return [];
    }
  }

  /**
   * Get the set of snapshot IDs linked to any of the given command records
   * in a single query (avoids N+1 per-command lookups in rollback previews).
   *
   * @param commandIds - Command record IDs
   * @returns Set of linked snapshot IDs (empty on error)
   */
  private async getLinkedSnapshotIdsForCommands(commandIds: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (commandIds.length === 0) return ids;
    try {
      this.ensureInitialized();
      const placeholders = commandIds.map(() => '?').join(',');
      const rows = await dbOps.all(
        `SELECT DISTINCT cfl.snapshot_id AS snapshot_id
         FROM command_file_links cfl
         WHERE cfl.command_id IN (${placeholders})`,
        commandIds
      );
      for (const row of rows) {
        if (row?.snapshot_id) ids.add(row.snapshot_id);
      }
    } catch (err) {
      console.error('[RollbackManager] Failed to get linked snapshot ids for commands:', err);
    }
    return ids;
  }

  /**
   * Get a rollback preview since a specific timestamp.
   *
   * @param taskId - Task identifier
   * @param timestamp - Starting timestamp
   * @returns Rollback preview with file/command details and risk assessment
   */
  async getRollbackPreviewByTimestamp(taskId: string, timestamp: number): Promise<RollbackPreview> {
    this.ensureInitialized();

    // Fetch snapshots since timestamp
    let fileSnapshots: FileSnapshot[] = [];
    try {
      const rows = await dbOps.all(
        `SELECT * FROM file_snapshots WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp ASC`,
        [taskId, timestamp]
      );
      fileSnapshots = rows.map(r => this.rowToSnapshot(r));
    } catch (err) {
      console.error('[RollbackManager] Failed to get snapshots for preview:', err);
    }

    // Fetch commands since timestamp
    let commands: CommandRecord[] = [];
    try {
      const rows = await dbOps.all(
        `SELECT * FROM command_history WHERE task_id = ? AND timestamp >= ? ORDER BY timestamp ASC`,
        [taskId, timestamp]
      );
      commands = rows.map(r => this.rowToCommandRecord(r));
    } catch (err) {
      console.error('[RollbackManager] Failed to get commands for preview:', err);
    }

    // Get linked snapshots for each command
    const linkedSnapshotIds = await this.getLinkedSnapshotIdsForCommands(commands.map(c => c.id));

    const files: RollbackPreviewItem[] = [];
    let totalSizeBytes = 0;
    let hasUnrestorableFiles = false;

    for (const snap of fileSnapshots) {
      let contentSize = 0;
      if (snap.contentBefore) {
        try {
          const decoded = Buffer.from(snap.contentBefore, 'base64');
          contentSize = decoded.length;
        } catch { contentSize = snap.contentBefore.length; }
      }
      totalSizeBytes += contentSize;

      let warning: string | undefined;
      let willRestore = true;

      // Check if file still exists in its current state
      if (snap.operation === 'delete') {
        const stillDeleted = !fsSync.existsSync(snap.filePath);
        if (!stillDeleted) {
          warning = 'File has been re-created since deletion — restoring may overwrite current content';
        }
      } else if (snap.operation === 'create') {
        if (!fsSync.existsSync(snap.filePath)) {
          warning = 'File was already deleted or never created';
          hasUnrestorableFiles = true;
        }
      } else if (snap.operation === 'modify') {
        try {
          const currentContent = fsSync.existsSync(snap.filePath)
            ? await fsPromises.readFile(snap.filePath).catch(() => null)
            : null;

          if (currentContent === null) {
            warning = 'File no longer exists — snapshot content will be restored as new file';
          } else {
            try {
              const expectedAfter = await this.decompressContent(snap.contentAfter);
              if (currentContent && expectedAfter && currentContent.equals(expectedAfter)) {
                // Clean restore
              } else {
                warning = 'File was modified since snapshot — restoring may cause data loss';
              }
            } catch { /* can't compare */ }
          }
        } catch { warning = 'Cannot verify current file state'; }
      }

      let lastModified: string | undefined;
      try {
        if (fsSync.existsSync(snap.filePath)) {
          lastModified = fsSync.statSync(snap.filePath).mtime.toISOString();
        }
      } catch { /* ignore */ }

      files.push({
        filePath: snap.filePath,
        operation: snap.operation,
        contentSizeBytes: contentSize,
        willRestore,
        warning,
        lastModified,
      });
    }

    const commandItems = commands.map(cmd => ({
      command: cmd.command,
      reversible: cmd.reversible,
      rollbackCommand: cmd.rollbackCommand || undefined,
      linkedSnapshots: linkedSnapshotIds.size,
    }));

    const hasIrreversibleCommands = commands.some(c => !c.reversible);
    const totalFilesToRestore = files.filter(f => f.willRestore).length;

    // Calculate risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (files.some(f => f.warning)) riskLevel = 'medium';
    if (hasIrreversibleCommands || hasUnrestorableFiles || totalFilesToRestore > 50) riskLevel = 'high';

    return {
      stepNumber: 0,
      files,
      commands: commandItems,
      totalFilesToRestore,
      totalSizeBytes,
      hasIrreversibleCommands,
      hasUnrestorableFiles,
      riskLevel,
    };
  }

  /**
   * Get a rollback preview for a step — shows what will be restored
   * without actually performing the rollback.
   *
   * @param taskId - Task identifier
   * @param stepNumber - Agent step number
   * @returns Rollback preview with file/command details and risk assessment
   */
  async getRollbackPreview(taskId: string, stepNumber: number): Promise<RollbackPreview> {
    this.ensureInitialized();

    const fileSnapshots = await this.getFileSnapshotsForStep(taskId, stepNumber);
    const commands = await this.getCommandsForStep(taskId, stepNumber);

    // Get linked snapshots for each command
    const linkedSnapshotIds = await this.getLinkedSnapshotIdsForCommands(commands.map(c => c.id));

    const files: RollbackPreviewItem[] = [];
    let totalSizeBytes = 0;
    let hasUnrestorableFiles = false;

    for (const snap of fileSnapshots) {
      let contentSize = 0;
      if (snap.contentBefore) {
        try {
          const decoded = Buffer.from(snap.contentBefore, 'base64');
          contentSize = decoded.length;
        } catch { contentSize = snap.contentBefore.length; }
      }
      totalSizeBytes += contentSize;

      let warning: string | undefined;
      let willRestore = true;

      // Check if file still exists in its current state
      if (snap.operation === 'delete') {
        const stillDeleted = !fsSync.existsSync(snap.filePath);
        if (!stillDeleted) {
          warning = 'File has been re-created since deletion — restoring may overwrite current content';
        }
      } else if (snap.operation === 'create') {
        if (!fsSync.existsSync(snap.filePath)) {
          warning = 'File was already deleted or never created';
          hasUnrestorableFiles = true;
        }
      } else if (snap.operation === 'modify') {
        try {
          const currentContent = fsSync.existsSync(snap.filePath)
            ? await fsPromises.readFile(snap.filePath).catch(() => null)
            : null;

          if (currentContent === null) {
            warning = 'File no longer exists — snapshot content will be restored as new file';
          } else {
            // Check if content matches what was expected (no conflict)
            // Pre-restore validation: on-disk bytes vs content_after. Equal
            // → nobody touched it since, so restoring content_before loses
            // nothing. Diverged → warn before overwrite: the current edits
            // have no snapshot of their own and would be destroyed.
            try {
              const expectedAfter = await this.decompressContent(snap.contentAfter);
              if (currentContent && expectedAfter && currentContent.equals(expectedAfter)) {
                // Clean restore — nobody modified it since
              } else {
                warning = 'File was modified since snapshot — restoring may cause data loss';
              }
            } catch { /* can't compare */ }
          }
        } catch { warning = 'Cannot verify current file state'; }
      }

      let lastModified: string | undefined;
      try {
        if (fsSync.existsSync(snap.filePath)) {
          lastModified = fsSync.statSync(snap.filePath).mtime.toISOString();
        }
      } catch { /* ignore */ }

      files.push({
        filePath: snap.filePath,
        operation: snap.operation,
        contentSizeBytes: contentSize,
        willRestore,
        warning,
        lastModified,
      });
    }

    const commandItems = commands.map(cmd => ({
      command: cmd.command,
      reversible: cmd.reversible,
      rollbackCommand: cmd.rollbackCommand || undefined,
      linkedSnapshots: linkedSnapshotIds.size,
    }));

    const hasIrreversibleCommands = commands.some(c => !c.reversible);
    const totalFilesToRestore = files.filter(f => f.willRestore).length;

    // Calculate risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (files.some(f => f.warning)) riskLevel = 'medium';
    if (hasIrreversibleCommands || hasUnrestorableFiles || totalFilesToRestore > 50) riskLevel = 'high';

    return {
      stepNumber,
      files,
      commands: commandItems,
      totalFilesToRestore,
      totalSizeBytes,
      hasIrreversibleCommands,
      hasUnrestorableFiles,
      riskLevel,
    };
  }

  /**
   * Get a human-readable summary of captured files for a command.
   */
  async getCaptureSummary(commandId: string): Promise<string> {
    try {
      const snapshots = await this.getFileSnapshotsForCommand(commandId);
      if (snapshots.length === 0) return 'No files captured';

      const totalSize = snapshots.reduce((sum, s) => sum + (s.contentBefore?.length || 0), 0);
      const operations = new Set(snapshots.map(s => s.operation));

      return `${snapshots.length} file(s) captured (${(totalSize / 1024).toFixed(1)} KB), ` +
        `operations: [${[...operations].join(', ')}]`;
    } catch {
      return 'Unknown';
    }
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
   *
   * The JSON rollback_payload column is re-validated on read: a malformed or
   * shape-mismatched payload is dropped (treated as absent), so a corrupted
   * DB row can never fabricate an executable payload downstream.
   */
  private rowToCommandRecord(row: any): CommandRecord {
    let rollbackPayload: RollbackPayload | null = null;
    if (row.rollback_payload) {
      try {
        const parsed = JSON.parse(row.rollback_payload);
        if (parsed && typeof parsed.program === 'string' && Array.isArray(parsed.args)) {
          rollbackPayload = { program: parsed.program, args: parsed.args };
        }
      } catch { /* malformed payload — treat as absent (fail-safe) */ }
    }

    return {
      id: row.id,
      taskId: row.task_id,
      stepNumber: row.step_number,
      command: row.command,
      output: row.output || '',
      exitCode: row.exit_code,
      rollbackCommand: row.rollback_command || null,
      rollbackPayload,
      cwd: row.cwd || null,
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
   * Partial-failure behavior: best-effort — never stops at the first error.
   * Every file and command is attempted; failures accumulate in `errors`;
   * `partialRollback` is true when some (but not all) operations succeeded.
   * A declined confirmation is the only short-circuit, and even then
   * already-restored files are reported in the result.
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
      // Ordering constraint: files are restored BEFORE any rollback command
      // runs (Phase 2), so a failed or declined command reversal cannot leave
      // the pre-capture file state exposed to a later command. Each restore
      // is independent — one failure must not abort the rest, because
      // partial-rollback reporting depends on attempting everything.

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

        // AG-SAF-01: ONE consolidated confirmation for the whole batch —
        // gather all valid structured payloads + file ops, confirm once.
        const commandsToRun = commands
          .filter((c) => c.reversible && c.rollbackPayload && this._validateRollbackPayload(c.rollbackPayload!))
          .map((c) => ({ cmd: c, payload: c.rollbackPayload! }));
        if (commandsToRun.length > 0) {
          const fileOps = (await this.getFileSnapshotsForStep(taskId, stepNumber)).map((s) => ({
            filePath: s.filePath,
            operation: s.operation,
          }));
          const approved = await this.confirmRollbackExecution({
            commands: commandsToRun.map((c) => c.payload),
            fileOperations: fileOps,
          });
          if (!approved) {
            this.batchRollbackApproval = null;
            return {
              success: false,
              filesRestored,
              commandsReversed: [],
              errors: ['Rollback aborted: user declined the confirmation dialog'],
              partialRollback: filesRestored.length > 0,
              stepsRolledBack: [],
            };
          }
          this.batchRollbackApproval = {
            commands: commandsToRun.map((c) => c.payload),
            fileOperations: [],
          };
        }

        // Reverse commands in reverse order (last executed first)
        // Undo the most recent state change before the one it layered on.
        // Individual failures are collected, not thrown, so the remaining
        // commands still get their reversal attempt.
        for (let i = commands.length - 1; i >= 0; i--) {
          const cmd = commands[i];

          try {
            const result = await this.rollbackCommand(cmd.id);
            if (result.success) {
              commandsReversed.push(cmd.command);
              console.log(`[RollbackManager] Reversed command: ${cmd.command}`);
            } else if ((result as any).skipped) {
              // AG-SAF-01: fail-safe refusal (no structured payload / declined)
              errors.push(`Command reversal skipped for "${cmd.command}": ${result.error}`);
            } else {
              errors.push(`Command reversal failed for "${cmd.command}": ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during command reversal for "${cmd.command}": ${(error as Error).message}`
            );
          }
        }
        this.batchRollbackApproval = null;
      } catch (error) {
        this.batchRollbackApproval = null;
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
      // Files first, commands second — same safety ordering as rollbackStep.
      // The SQL above already orders rows newest-first (DESC), so iterating
      // forward here IS reverse-chronological undo.

      try {
        const cmdRows = await dbOps.all(
          `SELECT * FROM command_history
           WHERE task_id = ? AND timestamp >= ?
           ORDER BY timestamp DESC`,
          [taskId, timestampMs]
        );

        const commands = cmdRows.map(this.rowToCommandRecord);

        // AG-SAF-01: ONE consolidated confirmation for the whole batch
        const commandsToRun = commands
          .filter((c) => c.reversible && c.rollbackPayload && this._validateRollbackPayload(c.rollbackPayload!))
          .map((c) => ({ cmd: c, payload: c.rollbackPayload! }));
        if (commandsToRun.length > 0) {
          const approved = await this.confirmRollbackExecution({
            commands: commandsToRun.map((c) => c.payload),
            fileOperations: filesRestored.map((p) => ({ filePath: p, operation: 'modify' as const })),
          });
          if (!approved) {
            this.batchRollbackApproval = null;
            return {
              success: false,
              filesRestored,
              commandsReversed: [],
              errors: ['Rollback aborted: user declined the confirmation dialog'],
              partialRollback: filesRestored.length > 0,
              stepsRolledBack: [],
            };
          }
          this.batchRollbackApproval = {
            commands: commandsToRun.map((c) => c.payload),
            fileOperations: [],
          };
        }

        for (const cmd of commands) {
          try {
            const result = await this.rollbackCommand(cmd.id);
            if (result.success) {
              commandsReversed.push(cmd.command);
              console.log(`[RollbackManager] Reversed command: ${cmd.command}`);
            } else if ((result as any).skipped) {
              errors.push(`Command reversal skipped for "${cmd.command}": ${result.error}`);
            } else {
              errors.push(`Command reversal failed for "${cmd.command}": ${result.error}`);
            }
          } catch (error) {
            errors.push(
              `Exception during command reversal for "${cmd.command}": ${(error as Error).message}`
            );
          }
        }
        this.batchRollbackApproval = null;
      } catch (error) {
        this.batchRollbackApproval = null;
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
   * Set an injectable confirmation handler for rollback command execution
   * (AG-SAF-01). Tests use this to auto-approve; production Electron uses
   * the native dialog when no handler is set.
   */
  setRollbackConfirmationHandler(handler: RollbackConfirmationHandler | null): void {
    this.rollbackConfirmationHandler = handler;
  }

  /**
   * Show a consolidated confirmation for a rollback operation (AG-SAF-01).
   *
   * Resolution order (fail-closed):
   * 1. Injected handler via setRollbackConfirmationHandler()
   * 2. Native Electron dialog (only when running in the main Electron
   *    process, process.type === 'browser'); denies on any failure.
   * 3. Default: DENY (no handler, no Electron).
   *
   * @param request - Commands + file operations to approve
   * @returns true only when explicitly approved
   */
  private async confirmRollbackExecution(
    request: RollbackConfirmationRequest
  ): Promise<boolean> {
    // 1. Injected handler takes precedence
    if (this.rollbackConfirmationHandler) {
      try {
        return await this.rollbackConfirmationHandler(request);
      } catch (err) {
        console.error('[RollbackManager] Confirmation handler threw — denying:', err);
        return false;
      }
    }

    // 2. Native Electron dialog — only in the main Electron process
    if (typeof process !== 'undefined' && (process as any).type === 'browser') {
      try {
        const { dialog, BrowserWindow } = require('electron');
        const win = BrowserWindow.getAllWindows()[0];
        const commandLines = request.commands
          .map(c => `  ${c.program} ${c.args.join(' ')}`)
          .join('\n');
        const fileLines = request.fileOperations
          .map(f => `  [${f.operation}] ${f.filePath}`)
          .join('\n');
        const response = await dialog.showMessageBox(win || undefined, {
          type: 'warning',
          title: 'EverFern Rollback Authorization',
          message:
            'A rollback is about to execute the following commands and file operations.\n\n' +
            `Commands:\n${commandLines || '  (none)'}\n\n` +
            `File operations:\n${fileLines || '  (none)'}\n\n` +
            'Do you want to authorize this rollback?',
          buttons: ['Approve', 'Deny'],
          defaultId: 0,
          cancelId: 1,
        });
        return response.response === 0;
      } catch (err) {
        console.error('[RollbackManager] Failed to show confirmation dialog — denying:', err);
        return false;
      }
    }

    // 3. Fail-closed default: no handler and no Electron → DENY
    // An unverifiable approval is treated as no approval — rollback command
    // execution must never proceed on an ambiguous confirmation path.
    console.warn(
      '[RollbackManager] No rollback confirmation handler available — denying rollback command execution (fail-closed)'
    );
    return false;
  }

  /**
   * Validate a stored rollback payload before execution (AG-SAF-01).
   *
   * Only well-formed argv arrays with known-safe package-manager/git programs
   * are allowed; anything else is refused.
   *
   * Needed even with shell:false: the payload round-trips through the DB as
   * JSON, so shape and program are re-checked on every execution. The program
   * allowlist stops a poisoned record from invoking sh/curl/node; the NUL/
   * newline check blocks control characters some tools treat as argument
   * separators or terminators. Defense in depth on top of argv form.
   */
  private _validateRollbackPayload(payload: RollbackPayload): boolean {
    if (!payload || typeof payload.program !== 'string' || !Array.isArray(payload.args)) {
      return false;
    }
    const ALLOWED_PROGRAMS = new Set([
      'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'apt-get', 'brew', 'cargo', 'git',
    ]);
    if (!ALLOWED_PROGRAMS.has(payload.program)) return false;
    // Every arg must be a non-empty string without NUL / newline injection
    return payload.args.every(
      (a) => typeof a === 'string' && a.length > 0 && !/[\0\n\r]/.test(a)
    );
  }

  /**
   * Rollback a command execution.
   *
   * AG-SAF-01: executes ONLY the structured rollback payload (argv array,
   * shell:false, recorded cwd, 120s timeout). Legacy free-text
   * `rollbackCommand` strings are NEVER executed — records without a
   * structured payload are refused (skipped) fail-safe.
   *
   * Requirement 6.4: Execute rollback commands for reversible command executions
   * Requirement 6.5: Report if rollback cannot be fully completed
   *
   * @param commandId - Command record identifier
   * @returns Rollback result with success status and error message
   */
  async rollbackCommand(commandId: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
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

      // AG-SAF-01: only the structured payload is honored.
      const payload = commandRecord.rollbackPayload;
      if (!payload) {
        // Fail-safe refusal: legacy free-text rollbackCommand is display-only
        console.warn(
          `[RollbackManager] Refusing rollback for "${commandRecord.command}": ` +
            `no structured rollback payload (legacy free-text rollbackCommand strings are never executed)`
        );
        return {
          success: false,
          skipped: true,
          error:
            `Rollback refused: no structured rollback payload for "${commandRecord.command}" ` +
            `(free-text rollbackCommand is never executed; command marked as skipped)`,
        };
      }

      // Validate the payload before doing anything with it
      if (!this._validateRollbackPayload(payload)) {
        console.warn(
          `[RollbackManager] Refusing rollback for "${commandRecord.command}": invalid rollback payload`
        );
        return {
          success: false,
          skipped: true,
          error: `Rollback refused: invalid or disallowed rollback payload for "${commandRecord.command}"`,
        };
      }

      // Consolidated confirmation (AG-SAF-01): skip only when this exact
      // payload was already approved as part of the current batch operation.
      const alreadyApproved = !!this.batchRollbackApproval &&
        this.batchRollbackApproval.commands.some(
          (p) => p.program === payload.program &&
            p.args.length === payload.args.length &&
            p.args.every((a, idx) => a === payload.args[idx])
        );
      if (!alreadyApproved) {
        const approved = await this.confirmRollbackExecution({
          commands: [payload],
          fileOperations: [],
        });
        if (!approved) {
          return {
            success: false,
            skipped: true,
            error: `Rollback denied: user declined confirmation for "${commandRecord.command}"`,
          };
        }
      }

      // Execute rollback command via structured spawn (shell: false)
      try {
        const { spawn } = require('child_process');
        const rollbackDisplay = this._formatRollbackPayload(payload);
        // Rollback must run where the original command ran — an inverse like
        // `npm uninstall` is workspace-relative, so executing it from the
        // process cwd instead of the recorded cwd would hit the wrong project.
        const cwd = payload.cwd || commandRecord.cwd || process.cwd();

        const rollbackOutput = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(payload.program, payload.args, {
              cwd,
              // argv execution: each args[i] reaches the OS as ONE literal
              // argument — no shell runs, so there is no word-splitting, no
              // glob expansion, and no ;|&$() metacharacter interpretation.
              // That is what makes executing a stored rollback safe even
              // when operands came from a user-typed command string.
              shell: false,
              timeout: 120000,
            });

            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
            child.on('error', reject);
            child.on('close', (code: number | null) => resolve({ code, stdout, stderr }));
          }
        );

        if (rollbackOutput.code !== 0) {
          const tail = (rollbackOutput.stderr || rollbackOutput.stdout || '').slice(-500);
          console.error(
            `[RollbackManager] Rollback command failed (exit ${rollbackOutput.code}): "${rollbackDisplay}"\n${tail}`
          );
          return {
            success: false,
            error: `Rollback command failed (exit ${rollbackOutput.code}): ${rollbackDisplay}`,
          };
        }

        // Capture output to the existing log mechanism
        console.log(
          `[RollbackManager] Successfully reversed command: "${commandRecord.command}"`,
          `Rollback: "${rollbackDisplay}"`,
          rollbackOutput.stdout ? `\n[stdout] ${rollbackOutput.stdout.slice(0, 2000)}` : '',
          rollbackOutput.stderr ? `\n[stderr] ${rollbackOutput.stderr.slice(0, 2000)}` : ''
        );

        return {
          success: true,
        };
      } catch (execError) {
        const errorMsg = (execError as Error).message || 'Unknown execution error';
        console.error(
          `[RollbackManager] Failed to execute rollback payload "${this._formatRollbackPayload(payload)}":`,
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

      // AG-CORR-10: a step with ONLY irreversible commands (rm -rf, dd, mkfs…)
      // cannot be rolled back. Previously canRollback returned true for any
      // step with recorded commands, advertising reversibility that didn't
      // exist. Snapshots alone are fine; bare irreversible commands are not.
      const hasRestorable =
        fileSnapshots.length > 0 ||
        commands.some(cmd => !!cmd.reversible);
      if (!hasRestorable) {
        return false;
      }

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
