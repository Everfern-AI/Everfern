/**
 * EverFern Desktop — Scheduled Tasks Store
 *
 * Persists scheduled tasks to the SQLite database.
 */

import { dbOps } from '../lib/db';
import * as crypto from 'crypto';
import { spawnNative } from '../lib/native-process';
import { SchedulerService } from '../integrations/scheduler-service';
import { currentScope } from '../agent/agent-scope';

function nativeTaskStore(operation: 'save' | 'run-times' | 'list' | 'get' | 'delete' | 'retry', payload: object): Promise<string> | undefined {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  const request = JSON.stringify({ ...payload, scope: currentScope() });
  return new Promise((resolve, reject) => {
    const child = spawnNative(executable, [`--ef-task-${operation}`]);
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        child.kill();
        reject(new Error('Native scheduled task response exceeded 1 MiB'));
        return;
      }
      chunks.push(chunk);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`Native scheduled task operation ${operation} exited with ${signal ?? code}`));
    });
    child.stdin.once('error', reject);
    if (operation === 'retry') child.stdin.write(request + '\n');
    else child.stdin.end(request);
  });
}

export interface ScheduledTask {
  id: string;
  name?: string;
  description: string;
  cron: string; // Keep for backward compatibility/internal use
  pattern: string; // e.g., "daily", "weekly:wednesday", "hourly"
  prompt: string;
  projectId?: string;
  startsAt: string;
  lastRun?: string;
  nextRun?: string;
  endsAt?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class ScheduledTasksStore {
  /**
   * List all scheduled tasks.
   */
  async list(projectId?: string): Promise<ScheduledTask[]> {
    try {
      const native = nativeTaskStore('list', { projectId });
      if (native) return JSON.parse(await native);
      let rows;
      if (projectId) {
        rows = await dbOps.all('SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
      } else {
        rows = await dbOps.all('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
      }

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        cron: row.cron,
        pattern: row.pattern || row.cron,
        prompt: row.prompt,
        projectId: row.project_id,
        startsAt: row.starts_at || row.created_at,
        lastRun: row.last_run,
        nextRun: row.next_run,
        endsAt: row.ends_at,
        enabled: !!row.enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      console.error('[ScheduledTasks] Failed to list tasks:', err);
      return [];
    }
  }

  /**
   * Get a task by ID.
   */
  async get(id: string): Promise<ScheduledTask | null> {
    try {
      const native = nativeTaskStore('get', { id });
      if (native) return JSON.parse(await native);
      const row = await dbOps.get('SELECT * FROM scheduled_tasks WHERE id = ?', [id]);
      if (!row) return null;

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        cron: row.cron,
        pattern: row.pattern || row.cron,
        prompt: row.prompt,
        projectId: row.project_id,
        startsAt: row.starts_at || row.created_at,
        lastRun: row.last_run,
        nextRun: row.next_run,
        endsAt: row.ends_at,
        enabled: !!row.enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      console.error(`[ScheduledTasks] Failed to get task ${id}:`, err);
      return null;
    }
  }

  /**
   * Save a task (create or update).
   */
  async save(task: Partial<ScheduledTask>): Promise<ScheduledTask> {
    const native = nativeTaskStore('save', { task });
    if (native) return JSON.parse(await native);
    const id = task.id || crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      const existing = await this.get(id);

      if (existing) {
        await dbOps.run(
          `UPDATE scheduled_tasks SET
            name = ?,
            description = ?,
            cron = ?,
            pattern = ?,
            prompt = ?,
            project_id = ?,
            starts_at = ?,
            enabled = ?,
            ends_at = ?,
            updated_at = ?
          WHERE id = ?`,
          [
            task.name || existing.name || null,
            task.description || existing.description,
            task.cron || existing.cron,
            task.pattern || existing.pattern,
            task.prompt || existing.prompt,
            task.projectId || existing.projectId,
            task.startsAt || existing.startsAt,
            task.enabled !== undefined ? (task.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
            task.endsAt || existing.endsAt || null,
            now,
            id
          ]
        );
      } else {
        // Calculate initial nextRun
        const cron = task.cron || '';
        const startsAt = task.startsAt || now;
        const nextRun = SchedulerService.calculateNextRun(cron, undefined, startsAt);

        await dbOps.run(
          `INSERT INTO scheduled_tasks (id, name, description, cron, pattern, prompt, project_id, starts_at, next_run, enabled, ends_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            task.name || null,
            task.description || '',
            cron,
            task.pattern || cron || '',
            task.prompt || '',
            task.projectId || null,
            startsAt,
            nextRun.toISOString(),
            task.enabled !== false ? 1 : 0,
            task.endsAt || null,
            now,
            now
          ]
        );
      }

      return (await this.get(id))!;
    } catch (err) {
      console.error(`[ScheduledTasks] Failed to save task:`, err);
      throw err;
    }
  }

  /**
   * Update task run times.
   */
  prepareNativeRun(task: Pick<ScheduledTask, 'id' | 'updatedAt'>): Promise<{
    conversationId: string;
    task: ScheduledTask;
  } | null> | undefined {
    return nativeTaskStore('run-times', {
      id: task.id,
      updatedAt: task.updatedAt, prepare: true,
    })?.then(result => JSON.parse(result));
  }

  prepareNativeRetry(task: ScheduledTask, attempt: number): Promise<string | null> | undefined {
    return nativeTaskStore('retry', { retryTask: task, retryAttempt: attempt })?.then(result => JSON.parse(result));
  }

  async updateRunTimes(id: string, lastRun: string, nextRun: string): Promise<void> {
    try {
      const native = nativeTaskStore('run-times', { id, lastRun, nextRun });
      if (native) {
        await native;
        return;
      }
      await dbOps.run(
        'UPDATE scheduled_tasks SET last_run = ?, next_run = ?, updated_at = ? WHERE id = ?',
        [lastRun, nextRun, new Date().toISOString(), id]
      );
    } catch (err) {
      console.error(`[ScheduledTasks] Failed to update run times for task ${id}:`, err);
    }
  }

  /**
   * Delete a task.
   */
  async delete(id: string): Promise<void> {
    try {
      const native = nativeTaskStore('delete', { id });
      if (native) {
        await native;
        return;
      }
      await dbOps.run('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
    } catch (err) {
      console.error(`[ScheduledTasks] Failed to delete task ${id}:`, err);
      throw err;
    }
  }
}

export const scheduledTasksStore = new ScheduledTasksStore();
