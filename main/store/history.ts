/**
 * EverFern Desktop — Chat History Store (SQLite Edition)
 *
 * Persists conversation history to the central SQLite database.
 * Includes migration logic for legacy JSON files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Conversation, ConversationSummary, ChatMessage } from '../acp/types';
import { dbOps } from '../lib/db';
import { getSystemEmbeddingConfig, getEmbeddingModel } from '../lib/embeddings';

const LEGACY_CONVERSATIONS_DIR = path.join(os.homedir(), '.everfern', 'store', 'conversations');
const LEGACY_TIMELINE_DIR = path.join(os.homedir(), '.everfern', 'store', 'timeline');

export class ChatHistoryStore {
  private migrated = false;

  constructor() {
    // Migration is handled asynchronously via init()
  }

  async init() {
    if (this.migrated) return;
    await this.migrateLegacyData();
    this.migrated = true;
  }

  /**
   * Asynchronously generates an embedding for a message and stores it in the vector DB.
   * This is a fire-and-forget method that doesn't block UI saves.
   */
  private async indexMessage(id: string, content: string, maxRetries = 3): Promise<void> {
    if (!content || typeof content !== 'string' || content.trim().length === 0) return;

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const config = getSystemEmbeddingConfig();
        const model = getEmbeddingModel(config);

        const embedding = await model.embeddings.embedQuery(content);

        // vec0 virtual tables don't support INSERT OR REPLACE — use INSERT OR IGNORE
        // so re-indexing the same message ID is a silent no-op.
        await dbOps.run(
          `INSERT OR IGNORE INTO chat_messages_vec (id, embedding) VALUES (?, ?)`,
          [id, `[${embedding.join(',')}]`]
        );
        return; // Success, exit loop
      } catch (err: any) {
        attempt++;
        const errMsg = String(err).toLowerCase();

        if ((errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('too many requests')) && attempt < maxRetries) {
          const delayMs = attempt * 15000; // 15s, 30s
          console.warn(`[History] Rate limit hit for message ${id}. Retrying in ${delayMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          console.error(`[History] Failed to index message ${id} for vector search:`, err);
          return; // Unrecoverable error or max retries reached
        }
      }
    }
  }

  /**
   * Migrate legacy JSON files to SQLite.
   */
  private async migrateLegacyData() {
    if (!fs.existsSync(LEGACY_CONVERSATIONS_DIR)) return;

    try {
      const files = fs.readdirSync(LEGACY_CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
      if (files.length === 0) return;

      console.log(`[History] 🚚 Migrating ${files.length} conversations to SQLite...`);

      for (const file of files) {
        const id = file.replace('.json', '');

        // Check if already in DB
        const existing = await dbOps.get('SELECT id FROM conversations WHERE id = ?', [id]);
        if (existing) continue;

        try {
          const raw = fs.readFileSync(path.join(LEGACY_CONVERSATIONS_DIR, file), 'utf-8');
          const conv: Conversation = JSON.parse(raw);

          // Load timeline data if exists
          const timelineFolderPath = path.join(LEGACY_TIMELINE_DIR, id);
          conv.messages.forEach(msg => {
            if (msg.hasTimeline && msg.id && fs.existsSync(timelineFolderPath)) {
              const tlPath = path.join(timelineFolderPath, `${msg.id}.json`);
              if (fs.existsSync(tlPath)) {
                try {
                  const tlData = JSON.parse(fs.readFileSync(tlPath, 'utf-8'));
                  msg.thought = tlData.thought;
                  msg.toolCalls = tlData.toolCalls;
                } catch {}
              }
            }
          });

          await this.save(conv);
          console.log(`[History] ✅ Migrated ${id}`);
        } catch (err) {
          console.warn(`[History] Failed to migrate ${file}:`, err);
        }
      }

      // Rename legacy folder to prevent re-migration
      const backupDir = `${LEGACY_CONVERSATIONS_DIR}_backup_${Date.now()}`;
      fs.renameSync(LEGACY_CONVERSATIONS_DIR, backupDir);
      console.log(`[History] 🏁 Migration complete. Legacy data moved to ${backupDir}`);

    } catch (err) {
      console.error('[History] Migration failed:', err);
    }
  }

  /**
   * List all conversations.
   */
  async list(): Promise<ConversationSummary[]> {
    await this.init();
    try {
      const rows = await dbOps.all(`
        SELECT c.*, p.name as projectName, COUNT(m.id) as messageCount
        FROM conversations c
        LEFT JOIN projects p ON c.project_id = p.id
        LEFT JOIN messages m ON c.id = m.conversation_id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `);

      return rows.map(row => ({
        id: row.id,
        title: row.title,
        provider: row.provider,
        model: row.model,
        projectId: row.project_id,
        projectName: row.projectName,
        messageCount: row.messageCount,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      console.error('[History] Failed to list conversations:', err);
      return [];
    }
  }

  /**
   * Load a full conversation by ID.
   */
  async load(id: string): Promise<Conversation | null> {
    await this.init();
    try {
      const convRow = await dbOps.get(`
        SELECT c.*, p.name as projectName
        FROM conversations c
        LEFT JOIN projects p ON c.project_id = p.id
        WHERE c.id = ?`, [id]);
      if (!convRow) return null;

      const msgRows = await dbOps.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY order_index ASC, created_at ASC', [id]);

      const messages: ChatMessage[] = msgRows.map(row => {
        let toolCalls = row.tool_calls ? JSON.parse(row.tool_calls) : undefined;
        if (Array.isArray(toolCalls)) {
          toolCalls.sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
        }
        return {
          id: row.id,
          role: row.role as any,
          content: row.content,
          thought: row.thought,
          reasoning_content: row.reasoning_content || row.thought,
          toolCalls,
          missionTimeline: row.mission_timeline ? JSON.parse(row.mission_timeline) : undefined,
          hasTimeline: !!row.has_timeline,
          orderIndex: row.order_index ?? 0,
          thinkingDuration: row.thinking_duration ?? undefined,
          stopped: row.stopped === 1 || row.stopped === true,
          attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
          createdAt: row.created_at
        };
      });

      return {
        id: convRow.id,
        title: convRow.title,
        provider: convRow.provider,
        model: convRow.model,
        projectId: convRow.project_id,
        projectName: convRow.projectName,
        messages,
        createdAt: convRow.created_at,
        updatedAt: convRow.updated_at,
      } as Conversation;
    } catch (err) {
      console.error(`[History] Failed to load conversation ${id}:`, err);
      return null;
    }
  }

  /**
   * Save a conversation (create or update).
   */
  async save(conversation: Conversation): Promise<{ success: boolean; error?: string }> {
    // Ensure DB is ready
    if (!this.migrated && conversation.id !== 'temp-migration') {
       await this.init();
    }

    try {
      // 1. Upsert Conversation — use INSERT OR REPLACE to avoid race conditions
      // when saveConversation is called concurrently from the frontend.
      await dbOps.run(
        `INSERT INTO conversations (id, title, provider, model, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM conversations WHERE id = ?), ?), ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           provider = excluded.provider,
           model = excluded.model,
           project_id = excluded.project_id,
           updated_at = excluded.updated_at`,
        [
          conversation.id,
          conversation.title,
          conversation.provider,
          (conversation as any).model,
          conversation.projectId || null,
          conversation.id,
          conversation.createdAt || new Date().toISOString(),
          conversation.updatedAt || new Date().toISOString(),
        ]
      );

      // 2. Sync Messages (Upsert to prevent UNIQUE constraint failures on concurrent saves)
      const savedIds: string[] = [];
      for (let i = 0; i < conversation.messages.length; i++) {
        const msg = conversation.messages[i];
        const msgId = msg.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        savedIds.push(msgId);

        let stampedToolCalls = msg.toolCalls;
        if (Array.isArray(stampedToolCalls)) {
          stampedToolCalls = stampedToolCalls.map((tc: any, tcIdx: number) => ({
            ...tc,
            orderIndex: tc.orderIndex ?? tcIdx
          }));
        }

        await dbOps.run(
          `INSERT OR REPLACE INTO messages
           (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline, has_timeline, order_index, thinking_duration, stopped, attachments, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))`,
          [
            msgId,
            conversation.id,
            msg.role,
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            msg.thought || null,
            msg.reasoning_content || null,
            stampedToolCalls ? JSON.stringify(stampedToolCalls) : null,
            (msg as any).missionTimeline ? JSON.stringify((msg as any).missionTimeline) : null,
            msg.hasTimeline ? 1 : 0,
            msg.orderIndex ?? i,
            msg.thinkingDuration ?? null,
            msg.stopped ? 1 : 0,
            msg.attachments ? JSON.stringify(msg.attachments) : null,
            msgId,
            msg.createdAt || new Date().toISOString()
          ]
        );

        // Async fire-and-forget: index message content for semantic search
        if (msg.role === 'user' || msg.role === 'assistant') {
           const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
           this.indexMessage(msgId, textContent).catch(() => {});
        }
      }

      // Cleanup orphaned/stale messages ONLY if this is a full conversation save
      // (indicated by (conversation as any).isFullSave flag)
      // This prevents deleting previous messages when doing real-time partial saves
      if ((conversation as any).isFullSave !== false && savedIds.length > 0) {
        const placeholders = savedIds.map(() => '?').join(',');
        await dbOps.run(
          `DELETE FROM messages
           WHERE conversation_id = ? AND id NOT IN (${placeholders})`,
          [conversation.id, ...savedIds]
        );
      } else if ((conversation as any).isFullSave !== false) {
        await dbOps.run(
          'DELETE FROM messages WHERE conversation_id = ?',
          [conversation.id]
        );
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[History] Failed to save conversation:`, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Delete a conversation by ID.
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      await dbOps.run('DELETE FROM conversations WHERE id = ?', [id]);
      // Cascading delete handles messages
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[History] Failed to delete conversation ${id}:`, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Perform a semantic vector search across all chat messages.
   */
  async search(query: string, limit: number = 10): Promise<ConversationSummary[]> {
    await this.init();
    if (!query || query.trim().length === 0) return [];
    try {
      const config = getSystemEmbeddingConfig();
      const model = getEmbeddingModel(config);
      const embedding = await model.embeddings.embedQuery(query);

      const rows = await dbOps.all(`
        SELECT c.id, c.title, c.provider, c.model, c.project_id as projectId, p.name as projectName, c.created_at as createdAt, c.updated_at as updatedAt
        FROM chat_messages_vec v
        JOIN messages m ON v.id = m.id
        JOIN conversations c ON m.conversation_id = c.id
        LEFT JOIN projects p ON c.project_id = p.id
        WHERE v.embedding MATCH ? AND k = ?
        GROUP BY c.id
      `, [`[${embedding.join(',')}]`, limit * 3]);

      return rows.map(row => ({
        id: row.id,
        title: row.title,
        provider: row.provider,
        model: row.model,
        projectId: row.projectId,
        projectName: row.projectName,
        messageCount: 0, // Not querying this to save time during search
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })).slice(0, limit);
    } catch (err) {
      console.error('[History] Vector search failed:', err);
      return [];
    }
  }

  /**
   * Backfill un-indexed messages into the vector database.
   */
  async backfillVectors(): Promise<{ success: boolean; count: number; error?: string }> {
    await this.init();
    try {
      console.log('[History] Starting backfill of vector embeddings...');
      const unindexedRows = await dbOps.all(`
        SELECT m.id, m.content
        FROM messages m
        LEFT JOIN chat_messages_vec v ON m.id = v.id
        WHERE v.id IS NULL AND (m.role = 'user' OR m.role = 'assistant')
      `);

      let count = 0;
      for (const row of unindexedRows) {
        const textContent = typeof row.content === 'string' ? row.content : JSON.stringify(row.content);

        let retries = 0;
        let success = false;

        while (!success && retries < 3) {
          try {
            await this.indexMessage(row.id, textContent);
            success = true;
          } catch (e: any) {
            const errorMsg = String(e).toLowerCase();
            if (errorMsg.includes('rate limit') || errorMsg.includes('429') || errorMsg.includes('too many requests')) {
              console.warn(`[History] Rate limit hit on message ${row.id}. Waiting 15 seconds before retry...`);
              await new Promise(r => setTimeout(r, 15000));
              retries++;
            } else {
              console.error(`[History] Unrecoverable error indexing message ${row.id}:`, e);
              break; // Skip this message on non-rate-limit errors
            }
          }
        }

        if (success) {
          count++;
        }

        // Add a standard 2 second delay between requests to respect RPM limits (30 req/min)
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`[History] Vector backfill completed. Indexed ${count} messages.`);
      return { success: true, count };
    } catch (err) {
      console.error('[History] Vector backfill failed:', err);
      return { success: false, count: 0, error: String(err) };
    }
  }

  /**
   * Fetch raw vector data for debugging and viewing in UI.
   */
  async getVectors(limit: number = 100): Promise<any[]> {
    await this.init();
    try {
      const rows = await dbOps.all(`
        SELECT v.id, length(v.embedding) as embedding_bytes, m.content, m.role, c.title as conversation_title, m.created_at
        FROM chat_messages_vec v
        JOIN messages m ON v.id = m.id
        JOIN conversations c ON m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT ?
      `, [limit]);
      return rows;
    } catch (err) {
      console.error('[History] Failed to get vectors:', err);
      return [];
    }
  }
}
