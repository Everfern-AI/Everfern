"use strict";
/**
 * EverFern Desktop — Chat History Store (SQLite Edition)
 *
 * Persists conversation history to the central SQLite database.
 * Includes migration logic for legacy JSON files.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatHistoryStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const db_1 = require("../lib/db");
const LEGACY_CONVERSATIONS_DIR = path.join(os.homedir(), '.everfern', 'store', 'conversations');
const LEGACY_TIMELINE_DIR = path.join(os.homedir(), '.everfern', 'store', 'timeline');
class ChatHistoryStore {
    migrated = false;
    constructor() {
        // Migration is handled asynchronously via init()
    }
    async init() {
        if (this.migrated)
            return;
        await this.migrateLegacyData();
        this.migrated = true;
    }
    /**
     * Migrate legacy JSON files to SQLite.
     */
    async migrateLegacyData() {
        if (!fs.existsSync(LEGACY_CONVERSATIONS_DIR))
            return;
        try {
            const files = fs.readdirSync(LEGACY_CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
            if (files.length === 0)
                return;
            console.log(`[History] 🚚 Migrating ${files.length} conversations to SQLite...`);
            for (const file of files) {
                const id = file.replace('.json', '');
                // Check if already in DB
                const existing = await db_1.dbOps.get('SELECT id FROM conversations WHERE id = ?', [id]);
                if (existing)
                    continue;
                try {
                    const raw = fs.readFileSync(path.join(LEGACY_CONVERSATIONS_DIR, file), 'utf-8');
                    const conv = JSON.parse(raw);
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
                                }
                                catch { }
                            }
                        }
                    });
                    await this.save(conv);
                    console.log(`[History] ✅ Migrated ${id}`);
                }
                catch (err) {
                    console.warn(`[History] Failed to migrate ${file}:`, err);
                }
            }
            // Rename legacy folder to prevent re-migration
            const backupDir = `${LEGACY_CONVERSATIONS_DIR}_backup_${Date.now()}`;
            fs.renameSync(LEGACY_CONVERSATIONS_DIR, backupDir);
            console.log(`[History] 🏁 Migration complete. Legacy data moved to ${backupDir}`);
        }
        catch (err) {
            console.error('[History] Migration failed:', err);
        }
    }
    /**
     * List all conversations.
     */
    async list() {
        await this.init();
        try {
            const rows = await db_1.dbOps.all(`
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
        }
        catch (err) {
            console.error('[History] Failed to list conversations:', err);
            return [];
        }
    }
    /**
     * Load a full conversation by ID.
     */
    async load(id) {
        await this.init();
        try {
            const convRow = await db_1.dbOps.get(`
        SELECT c.*, p.name as projectName 
        FROM conversations c 
        LEFT JOIN projects p ON c.project_id = p.id 
        WHERE c.id = ?`, [id]);
            if (!convRow)
                return null;
            const msgRows = await db_1.dbOps.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY order_index ASC, created_at ASC', [id]);
            const messages = msgRows.map(row => {
                let toolCalls = row.tool_calls ? JSON.parse(row.tool_calls) : undefined;
                if (Array.isArray(toolCalls)) {
                    toolCalls.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
                }
                return {
                    id: row.id,
                    role: row.role,
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
            };
        }
        catch (err) {
            console.error(`[History] Failed to load conversation ${id}:`, err);
            return null;
        }
    }
    /**
     * Save a conversation (create or update).
     */
    async save(conversation) {
        // Ensure DB is ready
        if (!this.migrated && conversation.id !== 'temp-migration') {
            await this.init();
        }
        try {
            // 1. Upsert Conversation — use INSERT OR REPLACE to avoid race conditions
            // when saveConversation is called concurrently from the frontend.
            await db_1.dbOps.run(`INSERT INTO conversations (id, title, provider, model, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM conversations WHERE id = ?), ?), ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           provider = excluded.provider,
           model = excluded.model,
           project_id = excluded.project_id,
           updated_at = excluded.updated_at`, [
                conversation.id,
                conversation.title,
                conversation.provider,
                conversation.model,
                conversation.projectId || null,
                conversation.id,
                conversation.createdAt || new Date().toISOString(),
                conversation.updatedAt || new Date().toISOString(),
            ]);
            // 2. Sync Messages (Upsert to prevent UNIQUE constraint failures on concurrent saves)
            const savedIds = [];
            for (let i = 0; i < conversation.messages.length; i++) {
                const msg = conversation.messages[i];
                const msgId = msg.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                savedIds.push(msgId);
                let stampedToolCalls = msg.toolCalls;
                if (Array.isArray(stampedToolCalls)) {
                    stampedToolCalls = stampedToolCalls.map((tc, tcIdx) => ({
                        ...tc,
                        orderIndex: tc.orderIndex ?? tcIdx
                    }));
                }
                await db_1.dbOps.run(`INSERT OR REPLACE INTO messages
           (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline, has_timeline, order_index, thinking_duration, stopped, attachments, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))`, [
                    msgId,
                    conversation.id,
                    msg.role,
                    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    msg.thought || null,
                    msg.reasoning_content || null,
                    stampedToolCalls ? JSON.stringify(stampedToolCalls) : null,
                    msg.missionTimeline ? JSON.stringify(msg.missionTimeline) : null,
                    msg.hasTimeline ? 1 : 0,
                    msg.orderIndex ?? i,
                    msg.thinkingDuration ?? null,
                    msg.stopped ? 1 : 0,
                    msg.attachments ? JSON.stringify(msg.attachments) : null,
                    msgId,
                    msg.createdAt || new Date().toISOString()
                ]);
            }
            // Cleanup orphaned/stale messages that are no longer part of this conversation
            if (savedIds.length > 0) {
                const placeholders = savedIds.map(() => '?').join(',');
                await db_1.dbOps.run(`DELETE FROM messages 
           WHERE conversation_id = ? AND id NOT IN (${placeholders})`, [conversation.id, ...savedIds]);
            }
            else {
                await db_1.dbOps.run('DELETE FROM messages WHERE conversation_id = ?', [conversation.id]);
            }
            return { success: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[History] Failed to save conversation:`, msg);
            return { success: false, error: msg };
        }
    }
    /**
     * Delete a conversation by ID.
     */
    async delete(id) {
        try {
            await db_1.dbOps.run('DELETE FROM conversations WHERE id = ?', [id]);
            // Cascading delete handles messages
            return { success: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[History] Failed to delete conversation ${id}:`, msg);
            return { success: false, error: msg };
        }
    }
}
exports.ChatHistoryStore = ChatHistoryStore;
