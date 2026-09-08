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
let instancePromise: Promise<sqlite3.Database> | null = null;
let isInitialized = false;
let isClosing = false;

interface VectorMessage {
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
let isNextScheduled = false;

/**
 * Enqueue a write and kick the drain loop. All mutations funnel through the
 * single write slot so concurrent callers can never interleave SQLite writes.
 */
function queueWrite(fn: () => void): void {
  writeQueue.push(fn);
  processQueue();
}

// Release the write slot only once the write's callback/completion has fired,
// then schedule the next queued item.
function finishWrite(): void {
  isWriteInProgress = false;
  scheduleNext();
}

// The 10ms delay coalesces queue churn: writes completing in the same tick
// are batched into one scheduled drain instead of racing processQueue()
// re-entrantly from every finishWrite() callback.
function scheduleNext(): void {
  if (isNextScheduled || isWriteInProgress || writeQueue.length === 0 || !instance) return;
  isNextScheduled = true;
  setTimeout(() => {
    isNextScheduled = false;
    processQueue();
  }, 10);
}

function processQueue(): void {
  if (isWriteInProgress || writeQueue.length === 0 || !instance) return;

  const next = writeQueue.shift();
  if (!next) return;

  isWriteInProgress = true;
  try {
    next();
  } catch (err) {
    log('Queue write error:', err);
    finishWrite();
  }
}

/**
 * Open (or return the already-open) chat-vector SQLite database.
 * Retries open failures with exponential backoff before degrading to an
 * in-memory DB; also creates the schema on first open.
 */
export async function initChatVectorDb(): Promise<sqlite3.Database> {
  if (instance) {
    return instance;
  }

  ensureDir();
  const dbPath = path.join(VECTORS_DIR, 'chat.sqlite');

  // MP-CORR-06: retry opening the DB with backoff before degrading to
  // :memory: — a transient lock/permission blip should not silently cost
  // the whole session's persistence.
  const openDbOnce = (): Promise<sqlite3.Database | null> =>
    new Promise((resolve) => {
      try {
        const db = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            console.error('[ChatVectors] ⚠️ Database open ERROR:', err.message);
            resolve(null);
            return;
          }
          resolve(db);
        });
        // Guard against a constructor-level throw (bad path types etc.).
        if (!db) resolve(null);
      } catch (err: any) {
        console.error('[ChatVectors] ⚠️ Database open threw:', err?.message ?? err);
        resolve(null);
      }
    });

  let db: sqlite3.Database | null = null;
  // 250ms base doubling per attempt; total worst-case wait ~750ms before the
  // in-memory fallback, long enough for transient lock contention to clear.
  const OPEN_RETRIES = 3;
  for (let attempt = 1; attempt <= OPEN_RETRIES && !db; attempt++) {
    db = await openDbOnce();
    if (!db && attempt < OPEN_RETRIES) {
      const delayMs = 250 * 2 ** (attempt - 1); // 250ms, 500ms
      console.warn(`[ChatVectors] Open attempt ${attempt}/${OPEN_RETRIES} failed — retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!db) {
    console.error('[ChatVectors] ⚠️ All open attempts failed. Falling back to in-memory DB — keyword memory will NOT persist across restarts. Check permissions on', VECTORS_DIR);
    const fallbackDb = new sqlite3.Database(':memory:');
    instance = fallbackDb;
    return fallbackDb;
  }

  return new Promise((resolve, reject) => {
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
        // MP-CORR-06: table-creation failure also degrades persistence — log loudly.
        console.error('[ChatVectors] ⚠️ Table creation ERROR:', execErr.message);
      } else {
        log('Tables created successfully');
      }
      instance = db;
      isInitialized = true;
      resolve(db);
    });
  });
}

/**
 * Single-flight accessor for the vector DB: concurrent callers share one
 * init promise, so only one sqlite open/creation sequence ever runs.
 */
function getChatVectorDb(): Promise<sqlite3.Database> {
  if (isClosing) {
    return Promise.reject(new Error('Chat vector DB is closing'));
  }
  if (!instancePromise) {
    // Reset on failure so a later call can retry init instead of being
    // permanently rejected by a cached broken promise.
    instancePromise = initChatVectorDb().catch((err) => {
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise!;
}

/**
 * Persist a chat message for keyword search. Routes through the write queue
 * (serialized single-slot writes) to avoid concurrent-write errors.
 */
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
              finishWrite();
            }
          );
        } catch (err: any) {
          log('Queue write error:', err.message);
          finishWrite();
          rej(err);
        }
      });
    });
  } catch (err: any) {
    // Init failures are swallowed deliberately: keyword memory is optional,
    // so callers (context-engine, IPC) proceed without breaking the chat.
    log('embedAndStoreMessage failed:', err.message);
  }
}

/**
 * Keyword-search stored messages, optionally scoped to one chat.
 * Scoring happens in JS after a 3x over-fetch, since SQLite only supplies
 * raw candidates (no ranking is possible in the query itself).
 */
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

/** Fetch all stored messages for a chat, oldest first. */
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

/** Delete all stored messages for a chat (queued write). */
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
          finishWrite();
        });
      });
    });
  } catch (err: any) {
    // Swallowed for the same reason as embedAndStoreMessage: chat deletion
    // must not fail because optional keyword-memory cleanup failed.
    log('deleteChatVectors failed:', err.message);
  }
}

/**
 * Close the vector DB, also awaiting and closing an in-flight init so a
 * close racing first-open can't leak an fd. Resets all singleton state,
 * allowing a clean reopen afterwards.
 */
export async function closeChatVectorDb(): Promise<void> {
  log('closeChatVectorDb');

  isClosing = true;

  try {
    if (instance) {
      await new Promise<void>((res, rej) => {
        instance!.close((e) => {
          if (e) {
            log('closeChatVectorDb ERROR:', e.message);
            rej(e);
          } else {
            log('Database closed');
            res();
          }
        });
      });
      instance = null;
      instancePromise = null;
      isInitialized = false;
    } else if (instancePromise) {
      try {
        const db = await instancePromise;
        await new Promise<void>((res, rej) => {
          db.close((e) => {
            if (e) {
              log('closeChatVectorDb ERROR:', e.message);
              rej(e);
            } else {
              log('Database closed (in-flight init)');
              res();
            }
          });
        });
        instance = null;
        instancePromise = null;
        isInitialized = false;
      } catch (err: any) {
        log('closeChatVectorDb in-flight init error:', err?.message);
      }
    }
  } finally {
    isClosing = false;
  }
}

/**
 * Report storage stats (row count, file size) for the vector DB.
 * Reads the file size even when the DB is closed, since it stats the
 * on-disk path directly.
 */
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

/**
 * Kept for API compatibility with embedding-based call sites; this store is
 * text-only, so there is no embedding config to refresh — a deliberate no-op.
 */
async function refreshEmbeddingConfig(): Promise<void> {
  log('refreshEmbeddingConfig called (no-op, text-only mode)');
}
