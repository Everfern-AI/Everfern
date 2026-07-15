/**
 * EverFern Desktop — Chat Vector Store
 *
 * Stores chat messages in SQLite for semantic search.
 * Uses text-based keyword matching (no vector embeddings).
 * Messages are stored in ~/.everfern/sql/chat.sqlite
 *
 * Has a write queue to prevent concurrent write errors.
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

let instance: sqlite3.Database | null = null;
let isInitialized = false;

export interface VectorMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  createdAt: number;
}

export interface SearchResult {
  id: string;
  chatId: string;
  role: string;
  content: string;
  createdAt: number;
  similarity: number;
}

const VECTORS_DIR = path.join(os.homedir(), '.everfern', 'sql');
const DEBUG = false;

function log(...args: any[]): void {
  if (DEBUG) {
    console.log('[ChatVectors]', ...args);
  }
}

function ensureDir(): void {
  if (!fs.existsSync(VECTORS_DIR)) {
    fs.mkdirSync(VECTORS_DIR, { recursive: true });
  }
}

let writeQueue: Array<() => void> = [];
let isWriteInProgress = false;

function queueWrite(fn: () => void): void {
  writeQueue.push(fn);
  processQueue();
}

function processQueue(): void {
  if (isWriteInProgress || writeQueue.length === 0 || !instance) return;

  isWriteInProgress = true;
  const next = writeQueue.shift();
  if (next) {
    try {
      next();
    } catch (err) {
      log('Queue write error:', err);
    }
  }
  isWriteInProgress = false;

  // Process next in queue
  if (writeQueue.length > 0) {
    setTimeout(processQueue, 10);
  }
}

export async function initChatVectorDb(): Promise<sqlite3.Database> {
  if (instance) {
    return instance;
  }

  ensureDir();
  const dbPath = path.join(VECTORS_DIR, 'chat.sqlite');

  return new Promise((resolve, reject) => {
    try {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          log('Database open ERROR:', err.message);
          const fallbackDb = new sqlite3.Database(':memory:');
          instance = fallbackDb;
          resolve(fallbackDb);
          return;
        }

        log('Database opened successfully');

        // Configure WAL mode and busy timeout to handle concurrent writes safely
        db.serialize(() => {
          db.run('PRAGMA journal_mode = WAL');
          db.run('PRAGMA busy_timeout = 5000');
        });

        db.exec(`
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            indexed_at INTEGER
          );

          CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);
        `, (execErr) => {
          if (execErr) {
            log('Table creation ERROR:', execErr.message);
          } else {
            log('Tables created successfully');
          }
          instance = db;
          isInitialized = true;
          resolve(db);
        });
      });
    } catch (err: any) {
      log('Database init FATAL ERROR:', err.message);
      reject(err);
    }
  });
}

export async function getChatVectorDb(): Promise<sqlite3.Database> {
  if (!instance) {
    await initChatVectorDb();
  }
  return instance!;
}

export async function embedAndStoreMessage(
  id: string,
  chatId: string,
  role: string,
  content: string,
  createdAt: number
): Promise<void> {
  log('embedAndStoreMessage:', { id, chatId, role, contentLength: content.length });

  if (!content || content.trim().length === 0) {
    log('Skipping empty content');
    return;
  }

  try {
    const db = await getChatVectorDb();

    // Use synchronous write in queue to prevent concurrent writes
    return new Promise((res, rej) => {
      queueWrite(() => {
        try {
          db.run(
            `INSERT OR REPLACE INTO chat_messages (id, chat_id, role, content, created_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, chatId, role, content, createdAt, Date.now()],
            (e) => {
              if (e) {
                log('Store message ERROR:', e.message);
                rej(e);
              } else {
                log('Message stored successfully');
                res();
              }
              isWriteInProgress = false;
              processQueue();
            }
          );
        } catch (err: any) {
          log('Queue write error:', err.message);
          isWriteInProgress = false;
          processQueue();
          rej(err);
        }
      });
    });
  } catch (err: any) {
    log('embedAndStoreMessage failed:', err.message);
  }
}

export async function searchChatVectors(
  query: string,
  topK: number = 10,
  filterChatId?: string
): Promise<SearchResult[]> {
  log('searchChatVectors:', { query: query.substring(0, 50), topK, filterChatId });

  try {
    const db = await getChatVectorDb();

    const queryLower = query.toLowerCase();

    let sql = `
      SELECT
        cm.id, cm.chat_id as chatId, cm.role, cm.content, cm.created_at as createdAt
      FROM chat_messages cm
    `;

    const params: any[] = [];
    if (filterChatId) {
      sql += ` WHERE cm.chat_id = ?`;
      params.push(filterChatId);
    }

    sql += ` ORDER BY cm.created_at DESC LIMIT ?`;
    params.push(topK * 3);

    const results = await new Promise<any[]>((res, rej) => {
      db.all(sql, params, (e, rows) => {
        if (e) {
          log('Search query ERROR:', e.message);
          rej(e);
        } else {
          log('Search returned', rows.length, 'results');
          res(rows);
        }
      });
    });

    // Score by keyword match
    const scored = results.map(r => {
      const contentLower = r.content.toLowerCase();
      let similarity = 0;
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          similarity += 0.15;
        }
      }
      return { ...r, similarity };
    });

    const filtered = scored
      .filter(r => r.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    log('Search scored results:', filtered.length);
    return filtered.map(r => ({
      id: r.id,
      chatId: r.chatId,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      similarity: r.similarity
    }));
  } catch (err: any) {
    log('searchChatVectors failed:', err.message);
    return [];
  }
}

export async function getChatVectors(chatId: string): Promise<VectorMessage[]> {
  log('getChatVectors:', chatId);

  try {
    const db = await getChatVectorDb();

    return new Promise<VectorMessage[]>((res, rej) => {
      db.all(
        `SELECT id, chat_id as chatId, role, content, created_at as createdAt FROM chat_messages WHERE chat_id = ? ORDER BY created_at`,
        [chatId],
        (e, rows: any[]) => {
          if (e) {
            log('getChatVectors ERROR:', e.message);
            rej(e);
          } else {
            log('getChatVectors returned', rows.length, 'messages');
            res(rows as VectorMessage[]);
          }
        }
      );
    });
  } catch (err: any) {
    log('getChatVectors failed:', err.message);
    return [];
  }
}

export async function deleteChatVectors(chatId: string): Promise<void> {
  log('deleteChatVectors:', chatId);

  try {
    const db = await getChatVectorDb();

    return new Promise((res, rej) => {
      queueWrite(() => {
        db.run(`DELETE FROM chat_messages WHERE chat_id = ?`, [chatId], (e) => {
          if (e) {
            log('deleteChatVectors ERROR:', e.message);
            rej(e);
          } else {
            log('Deleted vectors for chat:', chatId);
            res();
          }
          isWriteInProgress = false;
          processQueue();
        });
      });
    });
  } catch (err: any) {
    log('deleteChatVectors failed:', err.message);
  }
}

export async function closeChatVectorDb(): Promise<void> {
  log('closeChatVectorDb');

  if (instance) {
    return new Promise((res, rej) => {
      instance!.close((e) => {
        if (e) {
          log('closeChatVectorDb ERROR:', e.message);
          rej(e);
        } else {
          log('Database closed');
          instance = null;
          isInitialized = false;
          res();
        }
      });
    });
  }
}

export async function getVectorStats(): Promise<{
  messageCount: number;
  dimensionCount: number | null;
  storageSize: number;
  initialized: boolean;
  error: string | null;
}> {
  ensureDir();
  const dbPath = path.join(VECTORS_DIR, 'chat.sqlite');

  let storageSize = 0;
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    storageSize = stats.size;
  }

  log('getVectorStats:', { storageSize, initialized: isInitialized });

  let messageCount = 0;
  if (instance) {
    messageCount = await new Promise<number>((res) => {
      instance!.get(`SELECT COUNT(*) as count FROM chat_messages`, (_e, row: any) => {
        res(row?.count ?? 0);
      });
    });
  }

  return {
    messageCount,
    dimensionCount: null,
    storageSize,
    initialized: isInitialized,
    error: null
  };
}

export async function refreshEmbeddingConfig(): Promise<void> {
  log('refreshEmbeddingConfig called (no-op, text-only mode)');
}
