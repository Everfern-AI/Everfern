/**
 * EverFern Desktop — Persistence Database Schema
 *
 * Database schema and initialization for long-running agentic tasks system.
 * Supports session persistence, state checkpointing, rollback capabilities,
 * and task scheduling across application and system restarts.
 *
 * @see requirements.md - Requirements 1.1, 1.2, 2.1, 2.3, 11.1
 * @see design.md - Persistence Layer
 */

import { dbOps } from '../lib/db';

/**
 * Initialize persistence tables for long-running agentic tasks system
 *
 * Creates the following tables:
 * - checkpoints: Agent state snapshots
 * - file_snapshots: File modifications for rollback
 * - command_history: Command executions for rollback
 * - task_schedules: Scheduled task definitions
 * - navis_sessions: Browser session state
 * - computer_use_actions: GUI automation actions
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.3, 11.1**
 */
export async function initializePersistenceTables(): Promise<void> {
  try {
    await dbOps.exec(`
      -- Checkpoints table: stores agent state snapshots
      -- Validates: Requirements 2.1, 2.3, 2.4
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        state_json TEXT NOT NULL,  -- JSON serialized state
        state_hash TEXT NOT NULL,   -- SHA-256 integrity check
        delta_only BOOLEAN DEFAULT 0,
        previous_checkpoint_id TEXT,
        compressed BOOLEAN DEFAULT 0,
        FOREIGN KEY (previous_checkpoint_id) REFERENCES checkpoints(id) ON DELETE SET NULL
      );

      -- File snapshots table: tracks file modifications for rollback
      -- Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
      CREATE TABLE IF NOT EXISTS file_snapshots (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        content_before BLOB,  -- Gzipped content
        content_after BLOB,   -- Gzipped content
        operation TEXT NOT NULL CHECK(operation IN ('create', 'modify', 'delete')),
        timestamp INTEGER NOT NULL
      );

      -- Command history table: tracks executed commands for rollback
      -- Validates: Requirements 5.1, 5.2, 5.3, 5.4
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

      -- Task schedules table: stores scheduled task definitions
      -- Validates: Requirements 7.1, 7.6, 8.1
      CREATE TABLE IF NOT EXISTS task_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        schedule_json TEXT NOT NULL,  -- TaskSchedule serialized
        completion_criteria_json TEXT,
        initial_prompt TEXT NOT NULL,
        max_steps INTEGER DEFAULT 1000,
        notify_on_complete BOOLEAN DEFAULT 1,
        status TEXT DEFAULT 'scheduled' CHECK(status IN ('active', 'paused', 'completed', 'failed', 'scheduled')),
        current_step INTEGER DEFAULT 0,
        execution_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        start_time INTEGER,
        last_execution_time INTEGER,
        next_execution_time INTEGER,
        latest_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Navis sessions table: stores browser session state
      -- Validates: Requirements 3.1, 3.2, 3.3, 3.4, 11.2
      CREATE TABLE IF NOT EXISTS navis_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        cookies_encrypted TEXT,  -- Encrypted JSON
        tabs_json TEXT,
        session_storage_json TEXT,
        local_storage_json TEXT,
        auth_tokens_encrypted TEXT,
        form_data_json TEXT,
        timestamp INTEGER NOT NULL
      );

      -- Computer Use actions table: tracks GUI automation actions
      -- Validates: Requirements 9.1, 9.2, 9.5, 9.6
      CREATE TABLE IF NOT EXISTS computer_use_actions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        action TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        screenshot_before TEXT,  -- File path or base64
        screenshot_after TEXT,
        reversible BOOLEAN DEFAULT 0,
        reverse_action_json TEXT,
        timestamp INTEGER NOT NULL
      );
    `);

    console.log('[PersistenceDB] Base tables created successfully');

    // Run migrations before indexes to ensure columns exist
    await migratePersistenceSchema();

    // Create performance indexes
    await createPersistenceIndexes();

    console.log('[PersistenceDB] Persistence database initialization complete');
  } catch (error) {
    console.error('[PersistenceDB] Failed to initialize persistence tables:', error);
    throw error;
  }
}

/**
 * Create indexes for performance optimization
 *
 * Indexes are created for common query patterns:
 * - task_id lookups (all tables)
 * - step_number queries (checkpoints, file_snapshots, command_history, computer_use_actions)
 * - timestamp-based queries (checkpoints, task_schedules)
 * - file_path lookups (file_snapshots)
 * - status filtering (task_schedules)
 * - next_execution_time for scheduler (task_schedules)
 *
 * **Validates: Requirement 12.1 (Performance under 200ms)**
 */
async function createPersistenceIndexes(): Promise<void> {
  try {
    await dbOps.exec(`
      -- Checkpoints indexes
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task_id ON checkpoints(task_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_step ON checkpoints(task_id, step_number);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp ON checkpoints(timestamp);

      -- File snapshots indexes
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_task ON file_snapshots(task_id, step_number);
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_path ON file_snapshots(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_timestamp ON file_snapshots(timestamp);

      -- Command history indexes
      CREATE INDEX IF NOT EXISTS idx_command_history_task ON command_history(task_id, step_number);
      CREATE INDEX IF NOT EXISTS idx_command_history_timestamp ON command_history(timestamp);

      -- Task schedules indexes
      CREATE INDEX IF NOT EXISTS idx_task_schedules_status ON task_schedules(status);
      CREATE INDEX IF NOT EXISTS idx_task_schedules_next_execution ON task_schedules(next_execution_time);

      -- Navis sessions indexes
      CREATE INDEX IF NOT EXISTS idx_navis_sessions_task ON navis_sessions(task_id);
      CREATE INDEX IF NOT EXISTS idx_navis_sessions_timestamp ON navis_sessions(timestamp);

      -- Computer Use actions indexes
      CREATE INDEX IF NOT EXISTS idx_computer_use_task ON computer_use_actions(task_id, step_number);
      CREATE INDEX IF NOT EXISTS idx_computer_use_timestamp ON computer_use_actions(timestamp);
    `);

    console.log('[PersistenceDB] Performance indexes created successfully');
  } catch (error) {
    console.error('[PersistenceDB] Failed to create indexes:', error);
    throw error;
  }
}

/**
 * Add missing columns to existing tables for schema migration support
 *
 * This function is idempotent and safe to run multiple times.
 * It checks for column existence before attempting to add new columns.
 *
 * **Validates: Future schema migrations**
 */
export async function migratePersistenceSchema(): Promise<void> {
  try {
    // Check if tables exist first
    const tables = await dbOps.all(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name IN ('checkpoints', 'file_snapshots', 'command_history', 'task_schedules', 'navis_sessions', 'computer_use_actions')
    `);

    if (tables.length === 0) {
      console.log('[PersistenceDB] No persistence tables found, skipping migration');
      return;
    }

    // Check and add missing columns to checkpoints table
    const checkpointColumns = await dbOps.all("PRAGMA table_info(checkpoints)");
    if (checkpointColumns && checkpointColumns.length > 0) {
      const columnNames = checkpointColumns.map((c: any) => c.name);

      if (!columnNames.includes('compressed')) {
        await dbOps.run('ALTER TABLE checkpoints ADD COLUMN compressed BOOLEAN DEFAULT 0');
        console.log('[PersistenceDB] Added compressed column to checkpoints table');
      }
    }

    // Add task_id to tables that need it
    const tablesWithTaskId = ['checkpoints', 'file_snapshots', 'command_history', 'navis_sessions', 'computer_use_actions'];
    for (const tableName of tablesWithTaskId) {
      const tableColumns = await dbOps.all(`PRAGMA table_info(${tableName})`);
      if (tableColumns && tableColumns.length > 0) {
        const columnNames = tableColumns.map((c: any) => c.name);
        if (!columnNames.includes('task_id')) {
          await dbOps.run(`ALTER TABLE ${tableName} ADD COLUMN task_id TEXT NOT NULL DEFAULT 'legacy-task'`);
          console.log(`[PersistenceDB] Added task_id column to ${tableName} table`);
        }
      }
    }

    // Check and add missing columns to task_schedules table
    const taskColumns = await dbOps.all("PRAGMA table_info(task_schedules)");
    if (taskColumns && taskColumns.length > 0) {
      const columnNames = taskColumns.map((c: any) => c.name);

      if (!columnNames.includes('error_count')) {
        await dbOps.run('ALTER TABLE task_schedules ADD COLUMN error_count INTEGER DEFAULT 0');
        console.log('[PersistenceDB] Added error_count column to task_schedules table');
      }

      if (!columnNames.includes('latest_error')) {
        await dbOps.run('ALTER TABLE task_schedules ADD COLUMN latest_error TEXT');
        console.log('[PersistenceDB] Added latest_error column to task_schedules table');
      }
    }

    console.log('[PersistenceDB] Schema migration complete');
  } catch (error) {
    console.error('[PersistenceDB] Schema migration failed:', error);
    // Don't throw - migrations should be non-fatal
  }
}

/**
 * Verify persistence table structure and indexes
 *
 * Performs validation checks to ensure all required tables and indexes exist.
 * Returns a health check result with diagnostics.
 *
 * **Validates: Requirements 1.1, 2.1**
 */
export async function verifyPersistenceSchema(): Promise<{
  valid: boolean;
  tables: string[];
  indexes: string[];
  missingTables: string[];
  missingIndexes: string[];
  errors: string[];
}> {
  const result = {
    valid: true,
    tables: [] as string[],
    indexes: [] as string[],
    missingTables: [] as string[],
    missingIndexes: [] as string[],
    errors: [] as string[],
  };

  const requiredTables = [
    'checkpoints',
    'file_snapshots',
    'command_history',
    'task_schedules',
    'navis_sessions',
    'computer_use_actions',
  ];

  const requiredIndexes = [
    'idx_checkpoints_task_id',
    'idx_checkpoints_step',
    'idx_checkpoints_timestamp',
    'idx_file_snapshots_task',
    'idx_file_snapshots_path',
    'idx_command_history_task',
    'idx_task_schedules_status',
    'idx_task_schedules_next_execution',
    'idx_navis_sessions_task',
    'idx_computer_use_task',
  ];

  try {
    // Check tables
    const tables = await dbOps.all(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name IN (${requiredTables.map(() => '?').join(',')})
    `, requiredTables);

    result.tables = tables.map((t: any) => t.name);
    result.missingTables = requiredTables.filter(t => !result.tables.includes(t));

    // Check indexes
    const indexes = await dbOps.all(`
      SELECT name FROM sqlite_master
      WHERE type='index'
      AND name IN (${requiredIndexes.map(() => '?').join(',')})
    `, requiredIndexes);

    result.indexes = indexes.map((i: any) => i.name);
    result.missingIndexes = requiredIndexes.filter(i => !result.indexes.includes(i));

    if (result.missingTables.length > 0) {
      result.valid = false;
      result.errors.push(`Missing tables: ${result.missingTables.join(', ')}`);
    }

    if (result.missingIndexes.length > 0) {
      result.valid = false;
      result.errors.push(`Missing indexes: ${result.missingIndexes.join(', ')}`);
    }
  } catch (error) {
    result.valid = false;
    result.errors.push(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

/**
 * Clean up old data to manage storage size
 *
 * Removes old checkpoints, file snapshots, and command history based on retention policies:
 * - Keeps last 100 checkpoints per task
 * - Removes file snapshots older than 30 days for completed tasks
 * - Removes command history older than 30 days for completed tasks
 *
 * **Validates: Requirement 2.6 (Checkpoint Cleanup)**
 */
export async function cleanupOldPersistenceData(options?: {
  checkpointsToKeep?: number;
  retentionDays?: number;
}): Promise<{
  checkpointsDeleted: number;
  snapshotsDeleted: number;
  commandsDeleted: number;
}> {
  const checkpointsToKeep = options?.checkpointsToKeep || 100;
  const retentionDays = options?.retentionDays || 30;
  const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  const stats = {
    checkpointsDeleted: 0,
    snapshotsDeleted: 0,
    commandsDeleted: 0,
  };

  try {
    // Clean up old checkpoints (keep last N per task)
    const tasks = await dbOps.all('SELECT DISTINCT task_id FROM checkpoints');

    for (const task of tasks) {
      const taskId = task.task_id;

      // Get checkpoint IDs to delete (all except last N)
      const oldCheckpoints = await dbOps.all(`
        SELECT id FROM checkpoints
        WHERE task_id = ?
        ORDER BY step_number DESC
        LIMIT -1 OFFSET ?
      `, [taskId, checkpointsToKeep]);

      if (oldCheckpoints.length > 0) {
        const idsToDelete = oldCheckpoints.map((c: any) => c.id);
        await dbOps.run(`
          DELETE FROM checkpoints
          WHERE id IN (${idsToDelete.map(() => '?').join(',')})
        `, idsToDelete);

        stats.checkpointsDeleted += oldCheckpoints.length;
      }
    }

    // Clean up old file snapshots for completed tasks
    const snapshotsResult = await dbOps.run(`
      DELETE FROM file_snapshots
      WHERE timestamp < ?
      AND task_id IN (
        SELECT id FROM task_schedules WHERE status IN ('completed', 'failed')
      )
    `, [cutoffTimestamp]);

    // Note: sqlite3 doesn't provide changes directly, we'd need to query before/after
    // For now, we'll skip tracking the exact count

    // Clean up old command history for completed tasks
    await dbOps.run(`
      DELETE FROM command_history
      WHERE timestamp < ?
      AND task_id IN (
        SELECT id FROM task_schedules WHERE status IN ('completed', 'failed')
      )
    `, [cutoffTimestamp]);

    console.log('[PersistenceDB] Cleanup complete:', stats);
  } catch (error) {
    console.error('[PersistenceDB] Cleanup failed:', error);
  }

  return stats;
}

/**
 * Get storage statistics for persistence data
 *
 * Returns counts and size information for all persistence tables.
 */
export async function getPersistenceStats(): Promise<{
  checkpoints: number;
  fileSnapshots: number;
  commandHistory: number;
  taskSchedules: number;
  navisSessions: number;
  computerUseActions: number;
}> {
  try {
    const stats = await Promise.all([
      dbOps.get('SELECT COUNT(*) as count FROM checkpoints'),
      dbOps.get('SELECT COUNT(*) as count FROM file_snapshots'),
      dbOps.get('SELECT COUNT(*) as count FROM command_history'),
      dbOps.get('SELECT COUNT(*) as count FROM task_schedules'),
      dbOps.get('SELECT COUNT(*) as count FROM navis_sessions'),
      dbOps.get('SELECT COUNT(*) as count FROM computer_use_actions'),
    ]);

    return {
      checkpoints: stats[0]?.count || 0,
      fileSnapshots: stats[1]?.count || 0,
      commandHistory: stats[2]?.count || 0,
      taskSchedules: stats[3]?.count || 0,
      navisSessions: stats[4]?.count || 0,
      computerUseActions: stats[5]?.count || 0,
    };
  } catch (error) {
    console.error('[PersistenceDB] Failed to get stats:', error);
    return {
      checkpoints: 0,
      fileSnapshots: 0,
      commandHistory: 0,
      taskSchedules: 0,
      navisSessions: 0,
      computerUseActions: 0,
    };
  }
}
