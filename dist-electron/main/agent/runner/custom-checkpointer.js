"use strict";
/**
 * Custom Lightweight Checkpointer for LangGraph
 *
 * This replaces MemorySaver which was causing 90-minute compilation hangs.
 * Provides session persistence without the overhead and validation issues.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lightweightCheckpointer = exports.LightweightCheckpointer = void 0;
const langgraph_1 = require("@langchain/langgraph");
const db_1 = require("../../lib/db");
class LightweightCheckpointer extends langgraph_1.BaseCheckpointSaver {
    constructor() {
        super();
        console.log('[Checkpointer] ✅ Initialized Persistent LightweightCheckpointer (SQLite)');
    }
    async getTuple(config) {
        const threadId = config.configurable?.thread_id;
        const checkpointId = config.configurable?.checkpoint_id;
        if (!threadId) {
            return undefined;
        }
        try {
            let row;
            if (checkpointId) {
                row = await db_1.dbOps.get('SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?', [threadId, checkpointId]);
            }
            else {
                row = await db_1.dbOps.get('SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1', [threadId]);
            }
            if (!row)
                return undefined;
            const checkpoint = JSON.parse(row.checkpoint_json);
            const metadata = JSON.parse(row.metadata_json);
            return {
                config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
                checkpoint,
                metadata,
                parentConfig: row.parent_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_id } } : undefined,
            };
        }
        catch (err) {
            console.error('[Checkpointer] Failed to get tuple:', err);
            return undefined;
        }
    }
    async *list(config, options) {
        const threadId = config.configurable?.thread_id;
        const limit = options?.limit;
        if (!threadId) {
            return;
        }
        try {
            const rows = await db_1.dbOps.all(`SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC ${limit ? `LIMIT ${limit}` : ''}`, [threadId]);
            for (const row of rows) {
                yield {
                    config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
                    checkpoint: JSON.parse(row.checkpoint_json),
                    metadata: JSON.parse(row.metadata_json),
                    parentConfig: row.parent_id ? { configurable: { thread_id: threadId, checkpoint_id: row.parent_id } } : undefined,
                };
            }
        }
        catch (err) {
            console.error('[Checkpointer] Failed to list checkpoints:', err);
        }
    }
    async put(config, checkpoint, metadata) {
        const threadId = config.configurable?.thread_id || `thread_${Date.now()}`;
        const checkpointId = checkpoint.id || `checkpoint_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const parentId = config.configurable?.checkpoint_id;
        try {
            await db_1.dbOps.run(`INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_id, parent_id, checkpoint_json, metadata_json)
         VALUES (?, ?, ?, ?, ?)`, [
                threadId,
                checkpointId,
                parentId || null,
                JSON.stringify({ ...checkpoint, id: checkpointId }),
                JSON.stringify(metadata)
            ]);
            // Limit storage to last 100 checkpoints per thread
            await db_1.dbOps.run(`DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id NOT IN (
          SELECT checkpoint_id FROM checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 100
        )`, [threadId, threadId]);
        }
        catch (err) {
            console.error('[Checkpointer] Failed to put checkpoint:', err);
        }
        return {
            configurable: {
                thread_id: threadId,
                checkpoint_id: checkpointId,
            },
        };
    }
    async putWrites(config, writes, taskId) {
        const threadId = config.configurable?.thread_id;
        const checkpointId = config.configurable?.checkpoint_id;
        if (!threadId || !checkpointId)
            return;
        try {
            const row = await db_1.dbOps.get('SELECT checkpoint_json FROM checkpoints WHERE thread_id = ? AND checkpoint_id = ?', [threadId, checkpointId]);
            if (!row)
                return;
            const checkpoint = JSON.parse(row.checkpoint_json);
            const pendingSends = checkpoint.pending_sends || [];
            for (const write of writes) {
                pendingSends.push(write);
            }
            checkpoint.pending_sends = pendingSends;
            await db_1.dbOps.run('UPDATE checkpoints SET checkpoint_json = ? WHERE thread_id = ? AND checkpoint_id = ?', [JSON.stringify(checkpoint), threadId, checkpointId]);
        }
        catch (err) {
            console.error('[Checkpointer] Failed to put writes:', err);
        }
    }
    async deleteThread(threadId) {
        try {
            await db_1.dbOps.run('DELETE FROM checkpoints WHERE thread_id = ?', [threadId]);
            console.log(`[Checkpointer] 🗑️  Deleted thread: ${threadId}`);
        }
        catch (err) {
            console.error('[Checkpointer] Failed to delete thread:', err);
        }
    }
    clearThread(threadId) {
        this.deleteThread(threadId);
    }
    async getStats() {
        try {
            const threadRow = await db_1.dbOps.get('SELECT COUNT(DISTINCT thread_id) as count FROM checkpoints');
            const checkpointRow = await db_1.dbOps.get('SELECT COUNT(*) as count FROM checkpoints');
            return {
                threads: threadRow?.count || 0,
                totalCheckpoints: checkpointRow?.count || 0,
            };
        }
        catch (err) {
            console.error('[Checkpointer] Failed to get stats:', err);
            return { threads: 0, totalCheckpoints: 0 };
        }
    }
}
exports.LightweightCheckpointer = LightweightCheckpointer;
exports.lightweightCheckpointer = new LightweightCheckpointer();
