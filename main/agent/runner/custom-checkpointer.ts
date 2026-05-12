/**
 * Custom Lightweight Checkpointer for LangGraph
 *
 * This replaces MemorySaver which was causing 90-minute compilation hangs.
 * Provides session persistence without the overhead and validation issues.
 */

import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph';
import { dbOps } from '../../lib/db';

interface CheckpointData {
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  parentId?: string;
}

export class LightweightCheckpointer extends BaseCheckpointSaver {
  constructor() {
    super();
    console.log('[Checkpointer] ✅ Initialized Persistent LightweightCheckpointer (SQLite)');
  }

  async getTuple(config: { configurable?: { thread_id?: string; checkpoint_id?: string } }): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId) {
      return undefined;
    }

    try {
      let row;
      if (checkpointId) {
        row = await dbOps.get(
          'SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?',
          [threadId, checkpointId]
        );
      } else {
        row = await dbOps.get(
          'SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1',
          [threadId]
        );
      }

      if (!row) return undefined;

      const checkpoint = JSON.parse(row.checkpoint_json);
      const metadata = JSON.parse(row.metadata_json);

      return {
        config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
        checkpoint,
        metadata,
        parentConfig: row.parent_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_id } } : undefined,
      };
    } catch (err) {
      console.error('[Checkpointer] Failed to get tuple:', err);
      return undefined;
    }
  }

  async *list(config: { configurable?: { thread_id?: string } }, options?: { limit?: number }): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    const limit = options?.limit;

    if (!threadId) {
      return;
    }

    try {
      const rows = await dbOps.all(
        `SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC ${limit ? `LIMIT ${limit}` : ''}`,
        [threadId]
      );

      for (const row of rows) {
        yield {
          config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
          checkpoint: JSON.parse(row.checkpoint_json),
          metadata: JSON.parse(row.metadata_json),
          parentConfig: row.parent_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_id } } : undefined,
        };
      }
    } catch (err) {
      console.error('[Checkpointer] Failed to list checkpoints:', err);
    }
  }

  async put(config: { configurable?: { thread_id?: string; checkpoint_id?: string } }, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<{ configurable: { thread_id: string; checkpoint_id: string } }> {
    const threadId = config.configurable?.thread_id || `thread_${Date.now()}`;
    const checkpointId = checkpoint.id || `checkpoint_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const parentId = config.configurable?.checkpoint_id;

    try {
      await dbOps.run(
        `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_id, parent_id, checkpoint_json, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          threadId,
          checkpointId,
          parentId || null,
          JSON.stringify({ ...checkpoint, id: checkpointId }),
          JSON.stringify(metadata)
        ]
      );

      // Limit storage to last 100 checkpoints per thread
      await dbOps.run(
        `DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id NOT IN (
          SELECT checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 100
        )`,
        [threadId, threadId]
      );

    } catch (err) {
      console.error('[Checkpointer] Failed to put checkpoint:', err);
    }

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(config: { configurable?: { thread_id?: string; checkpoint_id?: string } }, writes: any[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId || !checkpointId) return;

    try {
      const row = await dbOps.get(
        'SELECT checkpoint_json FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?',
        [threadId, checkpointId]
      );

      if (!row) return;

      const checkpoint = JSON.parse(row.checkpoint_json);
      const pendingSends = checkpoint.pending_sends || [];
      for (const write of writes) {
        pendingSends.push(write);
      }
      checkpoint.pending_sends = pendingSends;

      await dbOps.run(
        'UPDATE checkpoints SET checkpoint_json = ? WHERE thread_id = ? AND checkpoint_id = ?',
        [JSON.stringify(checkpoint), threadId, checkpointId]
      );
    } catch (err) {
      console.error('[Checkpointer] Failed to put writes:', err);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    try {
      await dbOps.run('DELETE FROM checkpoints WHERE thread_id = ?', [threadId]);
      console.log(`[Checkpointer] 🗑️  Deleted thread: ${threadId}`);
    } catch (err) {
      console.error('[Checkpointer] Failed to delete thread:', err);
    }
  }

  clearThread(threadId: string): void {
    this.deleteThread(threadId);
  }

  async getStats(): Promise<{ threads: number; totalCheckpoints: number }> {
    try {
      const threadRow = await dbOps.get('SELECT COUNT(DISTINCT thread_id) as count FROM checkpoints');
      const checkpointRow = await dbOps.get('SELECT COUNT(*) as count FROM checkpoints');

      return {
        threads: threadRow?.count || 0,
        totalCheckpoints: checkpointRow?.count || 0,
      };
    } catch (err) {
      console.error('[Checkpointer] Failed to get stats:', err);
      return { threads: 0, totalCheckpoints: 0 };
    }
  }
}

export const lightweightCheckpointer = new LightweightCheckpointer();
