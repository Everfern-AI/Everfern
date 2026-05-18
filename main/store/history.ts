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

      const msgRows = await dbOps.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [id]);

      const messages: ChatMessage[] = msgRows.map(row => ({
        id: row.id,
        role: row.role as any,
        content: row.content,
        thought: row.thought,
        reasoning_content: row.reasoning_content || row.thought, // Use reasoning_content if available, fallback to thought
        toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        missionTimeline: row.mission_timeline ? JSON.parse(row.mission_timeline) : undefined,
        hasTimeline: !!row.has_timeline,
      }));

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
      for (const msg of conversation.messages) {
        const msgId = msg.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await dbOps.run(
          `INSERT OR REPLACE INTO messages
           (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline, has_timeline, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))`,
          [
            msgId,
            conversation.id,
            msg.role,
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            msg.thought || null,
            msg.reasoning_content || null,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            (msg as any).missionTimeline ? JSON.stringify((msg as any).missionTimeline) : null,
            msg.hasTimeline ? 1 : 0,
            msgId,
            new Date().toISOString()
          ]
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
}
