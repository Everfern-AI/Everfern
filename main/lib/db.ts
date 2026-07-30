import sqlite3 from 'sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { runMigrations } from './migrations/runner';
import { initializePersistenceTables, migratePersistenceSchema } from '../store/persistence-db';

let instance: sqlite3.Database | null = null;
let currentVectorDims: number | null = null;

function dbRunPromise(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((res, rej) => {
    db.run(sql, params, (err) => err ? rej(err) : res());
  });
}

function dbAllPromise(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any[]> {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => err ? rej(err) : res(rows));
  });
}

function dbExecPromise(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((res, rej) => {
    db.exec(sql, (err) => err ? rej(err) : res());
  });
}

async function continueWithSetup(db: sqlite3.Database, resolve: (db: sqlite3.Database) => void, reject: (err: Error) => void): Promise<void> {
  try {
    await dbExecPromise(db, `
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        text_content TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- FTS5 table for full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        text_content,
        content='memory_chunks',
        content_rowid='id'
      );

      -- Triggers to keep FTS5 up to date
      CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(rowid, text_content) VALUES (new.id, new.text_content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text_content) VALUES('delete', old.id, old.text_content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text_content) VALUES('delete', old.id, old.text_content);
        INSERT INTO memory_chunks_fts(rowid, text_content) VALUES (new.id, new.text_content);
      END;

      -- Semantic Caching tables
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        prompt_text TEXT NOT NULL,
        response_json TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Conversation History tables
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        provider TEXT,
        model TEXT,
        project_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        thought TEXT,
        reasoning_content TEXT,
        tool_calls TEXT, -- JSON string
        mission_timeline TEXT, -- JSON string
        has_timeline BOOLEAN DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        thinking_duration INTEGER,
        stopped BOOLEAN DEFAULT 0,
        attachments TEXT, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- Scheduled Tasks table
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT NOT NULL,
        cron TEXT NOT NULL,
        pattern TEXT,
        prompt TEXT NOT NULL,
        project_id TEXT,
        starts_at DATETIME,
        last_run DATETIME,
        next_run DATETIME,
        ends_at DATETIME,
        enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        instructions TEXT,
        path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

      -- LangGraph Checkpoints table
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT,
        checkpoint_id TEXT,
        parent_id TEXT,
        checkpoint_json TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_id)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id ON checkpoints(thread_id);

      -- Analytics: schema_migrations tracking
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Analytics: usage events — one row per AI request/response
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_cost_usd REAL NOT NULL DEFAULT 0,
        output_cost_usd REAL NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        context_window INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_usage_events_conversation_id ON usage_events(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model);
      CREATE INDEX IF NOT EXISTS idx_usage_events_provider ON usage_events(provider);
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);

      -- Analytics: model pricing cache
      CREATE TABLE IF NOT EXISTS model_pricing_cache (
        model_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        display_name TEXT,
        input_cost_per_1m REAL NOT NULL DEFAULT 0,
        output_cost_per_1m REAL NOT NULL DEFAULT 0,
        context_window INTEGER DEFAULT 150000,
        last_fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safety: Add missing columns to conversations (migration support)
    try {
      const columns = await dbAllPromise(db, "PRAGMA table_info(conversations)");
      if (columns) {
        const requiredColumns = [
          { name: 'project_id', type: 'TEXT' },
          { name: 'provider', type: 'TEXT' },
          { name: 'model', type: 'TEXT' }
        ];

        for (const col of requiredColumns) {
          if (!columns.some(c => c.name === col.name)) {
            await dbRunPromise(db, `ALTER TABLE conversations ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    } catch (err: any) {
      console.warn('[DB] Migration safety check failed for conversations:', err.message);
    }

    // Safety: Add missing columns to messages (migration support)
    try {
      const columns = await dbAllPromise(db, "PRAGMA table_info(messages)");
      if (columns) {
        const requiredColumns = [
          { name: 'thought', type: 'TEXT' },
          { name: 'reasoning_content', type: 'TEXT' },
          { name: 'tool_calls', type: 'TEXT' },
          { name: 'mission_timeline', type: 'TEXT' },
          { name: 'has_timeline', type: 'BOOLEAN DEFAULT 0' },
          { name: 'order_index', type: 'INTEGER DEFAULT 0' },
          { name: 'thinking_duration', type: 'INTEGER' },
          { name: 'stopped', type: 'BOOLEAN DEFAULT 0' },
          { name: 'attachments', type: 'TEXT' }
        ];

        for (const col of requiredColumns) {
          if (!columns.some(c => c.name === col.name)) {
            await dbRunPromise(db, `ALTER TABLE messages ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    } catch (err: any) {
      console.warn('[DB] Migration safety check failed for messages:', err.message);
    }

    // Safety: Add missing columns to scheduled_tasks (migration support)
    try {
      const columns = await dbAllPromise(db, "PRAGMA table_info(scheduled_tasks)");
      if (columns) {
        const requiredColumns = [
          { name: 'name', type: 'TEXT' },
          { name: 'pattern', type: 'TEXT' },
          { name: 'starts_at', type: 'DATETIME' },
          { name: 'last_run', type: 'DATETIME' },
          { name: 'next_run', type: 'DATETIME' },
          { name: 'ends_at', type: 'DATETIME' }
        ];

        for (const col of requiredColumns) {
          if (!columns.some(c => c.name === col.name)) {
            await dbRunPromise(db, `ALTER TABLE scheduled_tasks ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    } catch (err: any) {
      console.warn('[DB] Migration safety check failed for scheduled_tasks:', err.message);
    }

    // Set instance before running migrations so dbOps can use it
    instance = db;

    // Run database migrations
    await runMigrations();

    console.log('[DB] Running persistence table initialization...');
    // Initialize persistence tables for long-running agentic tasks
    await initializePersistenceTables();
    // Run persistence schema migrations (idempotent)
    await migratePersistenceSchema();
    console.log('[DB] Database initialization complete');
    resolve(db);
  } catch (err: any) {
    console.error('[DB] Setup error:', err);
    reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function initMemoryDb(): Promise<sqlite3.Database> {
  if (instance) return instance;

  const dbDir = path.join(os.homedir(), '.everfern', 'sql');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const dbPath = isTest ? ':memory:' : path.join(dbDir, 'memory.sqlite');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      // Configure WAL mode, busy timeout, and synchronous mode to handle concurrent writes safely
      db.serialize(() => {
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA busy_timeout = 30000');
        db.run('PRAGMA synchronous = NORMAL');
      });

      // Load sqlite-vec extension with a timeout guard
      let extLoaded = false;
      const extTimeout = setTimeout(() => {
        if (!extLoaded) {
          extLoaded = true;
          console.warn('[Optima] sqlite-vec loadExtension timed out — continuing without vector support');
          continueWithSetup(db, resolve, reject);
        }
      }, 5000);

      let extensionPath = path.normalize(sqliteVec.getLoadablePath());
      if (extensionPath.includes('app.asar')) {
        extensionPath = extensionPath.replace('app.asar', 'app.asar.unpacked');
      }

      try {
        db.loadExtension(extensionPath, (extErr) => {
          if (extLoaded) return; // timed out already
          clearTimeout(extTimeout);
          extLoaded = true;
          if (extErr) {
            console.warn('[Optima] Failed to load sqlite-vec extension — continuing without vector support:', extErr.message);
          }
          continueWithSetup(db, resolve, reject);
        });
      } catch (loadErr: any) {
        clearTimeout(extTimeout);
        if (!extLoaded) {
          extLoaded = true;
          console.warn('[Optima] sqlite-vec loadExtension threw — continuing without vector support:', loadErr.message);
          continueWithSetup(db, resolve, reject);
        }
      }
    });
  });
}

export async function getDb(): Promise<sqlite3.Database> {
  if (!instance) return await initMemoryDb();
  return instance;
}

export function closeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (instance) {
      instance.close((err) => {
        if (err) return reject(err);
        instance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 5, initialDelay = 50): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      const isSqliteBusy = err && (err.code === 'SQLITE_BUSY' || (err.message && (err.message.includes('busy') || err.message.includes('locked'))));
      if (isSqliteBusy && attempt <= maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1) + Math.random() * 50;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export const dbOps = {
  get: (sql: string, params: any[] = []): Promise<any> => {
    return withRetry(() => new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    }));
  },
  all: (sql: string, params: any[] = []): Promise<any[]> => {
    return withRetry(() => new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    }));
  },
  run: (sql: string, params: any[] = []): Promise<void> => {
    return withRetry(() => new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.run(sql, params, (err) => err ? reject(err) : resolve());
    }));
  },
  exec: (sql: string): Promise<void> => {
    return withRetry(() => new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.exec(sql, (err) => err ? reject(err) : resolve());
    }));
  }
};

export async function ensureVectorTable(dimensions: number) {
  if (currentVectorDims === dimensions) {
    return;
  }

  // Drop existing vector table if dimensions change
  if (currentVectorDims && currentVectorDims !== dimensions) {
    try {
      await dbOps.exec(`DROP TABLE IF EXISTS memory_chunks_vec`);
      await dbOps.exec(`DROP TABLE IF EXISTS semantic_cache_vec`);
    } catch (err) {
      console.warn('Failed to drop vector tables', err);
    }
  }

  await dbOps.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS semantic_cache_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    );
  `);

  currentVectorDims = dimensions;
}
