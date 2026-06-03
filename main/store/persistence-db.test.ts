/**
 * Unit tests for persistence database schema
 *
 * Tests table creation, indexes, schema verification, and cleanup functionality.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  initializePersistenceTables,
  verifyPersistenceSchema,
  migratePersistenceSchema,
  cleanupOldPersistenceData,
  getPersistenceStats,
} from './persistence-db';
import { dbOps, initMemoryDb, closeDb } from '../lib/db';

describe('Persistence Database Schema', () => {
  beforeAll(async () => {
    // Initialize in-memory database for testing
    await initMemoryDb();
  });

  afterAll(async () => {
    // Close database connection
    await closeDb();
  });

  describe('Table Initialization', () => {
    it('should create all required persistence tables', async () => {
      await initializePersistenceTables();

      const tables = await dbOps.all(`
        SELECT name FROM sqlite_master
        WHERE type='table'
        AND name IN ('checkpoints', 'file_snapshots', 'command_history', 'task_schedules', 'navis_sessions', 'computer_use_actions')
      `);

      expect(tables).toHaveLength(6);
      const tableNames = tables.map((t: any) => t.name);
      expect(tableNames).toContain('checkpoints');
      expect(tableNames).toContain('file_snapshots');
      expect(tableNames).toContain('command_history');
      expect(tableNames).toContain('task_schedules');
      expect(tableNames).toContain('navis_sessions');
      expect(tableNames).toContain('computer_use_actions');
    });

    it('should create checkpoints table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(checkpoints)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('task_id');
      expect(columnNames).toContain('step_number');
      expect(columnNames).toContain('timestamp');
      expect(columnNames).toContain('state_json');
      expect(columnNames).toContain('state_hash');
      expect(columnNames).toContain('delta_only');
      expect(columnNames).toContain('previous_checkpoint_id');
      expect(columnNames).toContain('compressed');
    });

    it('should create file_snapshots table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(file_snapshots)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('task_id');
      expect(columnNames).toContain('step_number');
      expect(columnNames).toContain('file_path');
      expect(columnNames).toContain('content_before');
      expect(columnNames).toContain('content_after');
      expect(columnNames).toContain('operation');
      expect(columnNames).toContain('timestamp');
    });

    it('should create command_history table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(command_history)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('task_id');
      expect(columnNames).toContain('step_number');
      expect(columnNames).toContain('command');
      expect(columnNames).toContain('output');
      expect(columnNames).toContain('exit_code');
      expect(columnNames).toContain('rollback_command');
      expect(columnNames).toContain('reversible');
      expect(columnNames).toContain('timestamp');
    });

    it('should create task_schedules table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(task_schedules)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('schedule_json');
      expect(columnNames).toContain('completion_criteria_json');
      expect(columnNames).toContain('initial_prompt');
      expect(columnNames).toContain('max_steps');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('current_step');
      expect(columnNames).toContain('execution_count');
      expect(columnNames).toContain('error_count');
      expect(columnNames).toContain('latest_error');
    });

    it('should create navis_sessions table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(navis_sessions)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('task_id');
      expect(columnNames).toContain('cookies_encrypted');
      expect(columnNames).toContain('tabs_json');
      expect(columnNames).toContain('session_storage_json');
      expect(columnNames).toContain('local_storage_json');
      expect(columnNames).toContain('auth_tokens_encrypted');
      expect(columnNames).toContain('form_data_json');
      expect(columnNames).toContain('timestamp');
    });

    it('should create computer_use_actions table with correct schema', async () => {
      const columns = await dbOps.all("PRAGMA table_info(computer_use_actions)");
      const columnNames = columns.map((c: any) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('task_id');
      expect(columnNames).toContain('step_number');
      expect(columnNames).toContain('action');
      expect(columnNames).toContain('parameters_json');
      expect(columnNames).toContain('screenshot_before');
      expect(columnNames).toContain('screenshot_after');
      expect(columnNames).toContain('reversible');
      expect(columnNames).toContain('reverse_action_json');
      expect(columnNames).toContain('timestamp');
    });
  });

  describe('Index Creation', () => {
    it('should create all required indexes', async () => {
      const indexes = await dbOps.all(`
        SELECT name FROM sqlite_master
        WHERE type='index'
        AND name LIKE 'idx_%'
      `);

      const indexNames = indexes.map((i: any) => i.name);

      // Checkpoints indexes
      expect(indexNames).toContain('idx_checkpoints_task_id');
      expect(indexNames).toContain('idx_checkpoints_step');
      expect(indexNames).toContain('idx_checkpoints_timestamp');

      // File snapshots indexes
      expect(indexNames).toContain('idx_file_snapshots_task');
      expect(indexNames).toContain('idx_file_snapshots_path');

      // Command history indexes
      expect(indexNames).toContain('idx_command_history_task');

      // Task schedules indexes
      expect(indexNames).toContain('idx_task_schedules_status');
      expect(indexNames).toContain('idx_task_schedules_next_execution');

      // Navis sessions indexes
      expect(indexNames).toContain('idx_navis_sessions_task');

      // Computer Use actions indexes
      expect(indexNames).toContain('idx_computer_use_task');
    });
  });

  describe('Schema Verification', () => {
    it('should verify all tables and indexes exist', async () => {
      const result = await verifyPersistenceSchema();

      expect(result.valid).toBe(true);
      expect(result.missingTables).toHaveLength(0);
      expect(result.missingIndexes).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.tables).toHaveLength(6);
    });
  });

  describe('Schema Migration', () => {
    it('should run migration without errors', async () => {
      await expect(migratePersistenceSchema()).resolves.not.toThrow();
    });

    it('should be idempotent (safe to run multiple times)', async () => {
      await migratePersistenceSchema();
      await migratePersistenceSchema();
      await migratePersistenceSchema();

      const result = await verifyPersistenceSchema();
      expect(result.valid).toBe(true);
    });
  });

  describe('Data Insertion', () => {
    it('should insert and retrieve a checkpoint', async () => {
      const checkpoint = {
        id: 'test-checkpoint-1',
        task_id: 'test-task-1',
        step_number: 1,
        timestamp: Date.now(),
        state_json: JSON.stringify({ messages: [], iterations: 1 }),
        state_hash: 'abc123',
        delta_only: 0,
        previous_checkpoint_id: null,
        compressed: 0,
      };

      await dbOps.run(`
        INSERT INTO checkpoints (id, task_id, step_number, timestamp, state_json, state_hash, delta_only, previous_checkpoint_id, compressed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        checkpoint.id,
        checkpoint.task_id,
        checkpoint.step_number,
        checkpoint.timestamp,
        checkpoint.state_json,
        checkpoint.state_hash,
        checkpoint.delta_only,
        checkpoint.previous_checkpoint_id,
        checkpoint.compressed,
      ]);

      const retrieved = await dbOps.get('SELECT * FROM checkpoints WHERE id = ?', [checkpoint.id]);
      expect(retrieved).toBeDefined();
      expect(retrieved.task_id).toBe(checkpoint.task_id);
      expect(retrieved.step_number).toBe(checkpoint.step_number);
    });

    it('should insert and retrieve a file snapshot', async () => {
      const snapshot = {
        id: 'test-snapshot-1',
        task_id: 'test-task-1',
        step_number: 1,
        file_path: '/test/file.ts',
        content_before: Buffer.from('before'),
        content_after: Buffer.from('after'),
        operation: 'modify',
        timestamp: Date.now(),
      };

      await dbOps.run(`
        INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        snapshot.id,
        snapshot.task_id,
        snapshot.step_number,
        snapshot.file_path,
        snapshot.content_before,
        snapshot.content_after,
        snapshot.operation,
        snapshot.timestamp,
      ]);

      const retrieved = await dbOps.get('SELECT * FROM file_snapshots WHERE id = ?', [snapshot.id]);
      expect(retrieved).toBeDefined();
      expect(retrieved.file_path).toBe(snapshot.file_path);
      expect(retrieved.operation).toBe(snapshot.operation);
    });

    it('should insert and retrieve a task schedule', async () => {
      const task = {
        id: 'test-schedule-1',
        name: 'Test Task',
        description: 'Test task description',
        schedule_json: JSON.stringify({ frequency: 'daily' }),
        completion_criteria_json: JSON.stringify({ type: 'step_count', targetSteps: 10 }),
        initial_prompt: 'Test prompt',
        max_steps: 1000,
        notify_on_complete: 1,
        status: 'scheduled',
        current_step: 0,
        execution_count: 0,
        error_count: 0,
        start_time: null,
        last_execution_time: null,
        next_execution_time: Date.now() + 86400000,
        latest_error: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await dbOps.run(`
        INSERT INTO task_schedules (id, name, description, schedule_json, completion_criteria_json, initial_prompt, max_steps, notify_on_complete, status, current_step, execution_count, error_count, start_time, last_execution_time, next_execution_time, latest_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        task.id, task.name, task.description, task.schedule_json, task.completion_criteria_json,
        task.initial_prompt, task.max_steps, task.notify_on_complete, task.status, task.current_step,
        task.execution_count, task.error_count, task.start_time, task.last_execution_time,
        task.next_execution_time, task.latest_error, task.created_at, task.updated_at,
      ]);

      const retrieved = await dbOps.get('SELECT * FROM task_schedules WHERE id = ?', [task.id]);
      expect(retrieved).toBeDefined();
      expect(retrieved.name).toBe(task.name);
      expect(retrieved.status).toBe(task.status);
    });
  });

  describe('Statistics', () => {
    it('should return persistence statistics', async () => {
      const stats = await getPersistenceStats();

      expect(stats).toHaveProperty('checkpoints');
      expect(stats).toHaveProperty('fileSnapshots');
      expect(stats).toHaveProperty('commandHistory');
      expect(stats).toHaveProperty('taskSchedules');
      expect(stats).toHaveProperty('navisSessions');
      expect(stats).toHaveProperty('computerUseActions');

      // We should have at least the data we inserted
      expect(stats.checkpoints).toBeGreaterThanOrEqual(1);
      expect(stats.fileSnapshots).toBeGreaterThanOrEqual(1);
      expect(stats.taskSchedules).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old checkpoints while keeping recent ones', async () => {
      const taskId = 'test-cleanup-task';

      // Insert 150 checkpoints
      for (let i = 0; i < 150; i++) {
        await dbOps.run(`
          INSERT INTO checkpoints (id, task_id, step_number, timestamp, state_json, state_hash, delta_only, previous_checkpoint_id, compressed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          `cleanup-checkpoint-${i}`,
          taskId,
          i,
          Date.now() - (150 - i) * 1000, // Older checkpoints have earlier timestamps
          JSON.stringify({ step: i }),
          `hash-${i}`,
          0,
          null,
          0,
        ]);
      }

      // Run cleanup (should keep last 100)
      const result = await cleanupOldPersistenceData({ checkpointsToKeep: 100 });

      // Check that we deleted 50 checkpoints
      expect(result.checkpointsDeleted).toBe(50);

      // Verify only 100 checkpoints remain for this task
      const remaining = await dbOps.all('SELECT * FROM checkpoints WHERE task_id = ?', [taskId]);
      expect(remaining).toHaveLength(100);
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should allow null previous_checkpoint_id for initial checkpoints', async () => {
      const checkpoint = {
        id: 'fk-test-checkpoint-1',
        task_id: 'fk-test-task',
        step_number: 1,
        timestamp: Date.now(),
        state_json: '{}',
        state_hash: 'hash1',
        delta_only: 0,
        previous_checkpoint_id: null,
        compressed: 0,
      };

      await expect(
        dbOps.run(`
          INSERT INTO checkpoints (id, task_id, step_number, timestamp, state_json, state_hash, delta_only, previous_checkpoint_id, compressed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          checkpoint.id,
          checkpoint.task_id,
          checkpoint.step_number,
          checkpoint.timestamp,
          checkpoint.state_json,
          checkpoint.state_hash,
          checkpoint.delta_only,
          checkpoint.previous_checkpoint_id,
          checkpoint.compressed,
        ])
      ).resolves.not.toThrow();
    });

    it('should allow valid foreign key reference to previous checkpoint', async () => {
      const checkpoint2 = {
        id: 'fk-test-checkpoint-2',
        task_id: 'fk-test-task',
        step_number: 2,
        timestamp: Date.now(),
        state_json: '{}',
        state_hash: 'hash2',
        delta_only: 1,
        previous_checkpoint_id: 'fk-test-checkpoint-1',
        compressed: 0,
      };

      await expect(
        dbOps.run(`
          INSERT INTO checkpoints (id, task_id, step_number, timestamp, state_json, state_hash, delta_only, previous_checkpoint_id, compressed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          checkpoint2.id,
          checkpoint2.task_id,
          checkpoint2.step_number,
          checkpoint2.timestamp,
          checkpoint2.state_json,
          checkpoint2.state_hash,
          checkpoint2.delta_only,
          checkpoint2.previous_checkpoint_id,
          checkpoint2.compressed,
        ])
      ).resolves.not.toThrow();
    });
  });

  describe('Check Constraints', () => {
    it('should enforce operation check constraint in file_snapshots', async () => {
      const invalidSnapshot = {
        id: 'invalid-snapshot',
        task_id: 'test-task',
        step_number: 1,
        file_path: '/test/file.ts',
        content_before: Buffer.from('before'),
        content_after: Buffer.from('after'),
        operation: 'invalid_operation', // Should fail
        timestamp: Date.now(),
      };

      await expect(
        dbOps.run(`
          INSERT INTO file_snapshots (id, task_id, step_number, file_path, content_before, content_after, operation, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          invalidSnapshot.id,
          invalidSnapshot.task_id,
          invalidSnapshot.step_number,
          invalidSnapshot.file_path,
          invalidSnapshot.content_before,
          invalidSnapshot.content_after,
          invalidSnapshot.operation,
          invalidSnapshot.timestamp,
        ])
      ).rejects.toThrow();
    });

    it('should enforce status check constraint in task_schedules', async () => {
      const invalidTask = {
        id: 'invalid-task',
        name: 'Invalid Task',
        description: 'Test',
        schedule_json: '{}',
        completion_criteria_json: '{}',
        initial_prompt: 'Test',
        status: 'invalid_status', // Should fail
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await expect(
        dbOps.run(`
          INSERT INTO task_schedules (id, name, description, schedule_json, completion_criteria_json, initial_prompt, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          invalidTask.id,
          invalidTask.name,
          invalidTask.description,
          invalidTask.schedule_json,
          invalidTask.completion_criteria_json,
          invalidTask.initial_prompt,
          invalidTask.status,
          invalidTask.created_at,
          invalidTask.updated_at,
        ])
      ).rejects.toThrow();
    });
  });
});
