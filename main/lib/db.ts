import sqlite3 from 'sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';
import fs from 'fs';
import os from 'os';

let instance: sqlite3.Database | null = null;
let currentVectorDims: number | null = null;

function continueWithSetup(db: sqlite3.Database, resolve: (db: sqlite3.Database) => void, reject: (err: Error) => void): void {
  db.exec(`
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

    -- Ensure project_id exists in case table was already created
    -- We use a simple attempt to add it, wrapped in a try/catch in JS if needed, 
    -- but here we can just add it to the exec block.
    -- SQLite ALTER TABLE ADD COLUMN is safe if the column doesn't exist in most cases 
    -- but will throw if it does.
    -- Better to handle this in JS.

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      thought TEXT,
      tool_calls TEXT, -- JSON string
      has_timeline BOOLEAN DEFAULT 0,
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
  `, (execErr) => {
    // Safety: Add missing columns to conversations (migration support)
    db.all("PRAGMA table_info(conversations)", (err, columns: any[]) => {
      if (!err && columns) {
        const requiredColumns = [
          { name: 'project_id', type: 'TEXT' },
          { name: 'provider', type: 'TEXT' },
          { name: 'model', type: 'TEXT' }
        ];

        for (const col of requiredColumns) {
          if (!columns.some(c => c.name === col.name)) {
            db.run(`ALTER TABLE conversations ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    });

    // Safety: Add missing columns to messages (migration support)
    db.all("PRAGMA table_info(messages)", (err, columns: any[]) => {
      if (!err && columns) {
        const requiredColumns = [
          { name: 'thought', type: 'TEXT' },
          { name: 'tool_calls', type: 'TEXT' },
          { name: 'has_timeline', type: 'BOOLEAN DEFAULT 0' }
        ];

        for (const col of requiredColumns) {
          if (!columns.some(c => c.name === col.name)) {
            db.run(`ALTER TABLE messages ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    });

    // Safety: Add missing columns to scheduled_tasks (migration support)
    db.all("PRAGMA table_info(scheduled_tasks)", (err, columns: any[]) => {
      if (!err && columns) {
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
            db.run(`ALTER TABLE scheduled_tasks ADD COLUMN ${col.name} ${col.type}`);
          }
        }
      }
    });

    instance = db;
    resolve(db);
  });
}

export async function initMemoryDb(): Promise<sqlite3.Database> {
  if (instance) return instance;

  const dbDir = path.join(os.homedir(), '.everfern', 'sql');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'memory.sqlite');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      // Load sqlite-vec extension with a timeout guard
      let extLoaded = false;
      const extTimeout = setTimeout(() => {
        if (!extLoaded) {
          extLoaded = true;
          console.warn('[Optima] sqlite-vec loadExtension timed out — continuing without vector support');
          continueWithSetup(db, resolve, reject);
        }
      }, 5000);

      try {
        db.loadExtension(sqliteVec.getLoadablePath(), (extErr) => {
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

export const dbOps = {
  get: (sql: string, params: any[] = []): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
  },
  all: (sql: string, params: any[] = []): Promise<any[]> => {
    return new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
  },
  run: (sql: string, params: any[] = []): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.run(sql, params, (err) => err ? reject(err) : resolve());
    });
  },
  exec: (sql: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const db = await getDb();
      db.exec(sql, (err) => err ? reject(err) : resolve());
    });
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
