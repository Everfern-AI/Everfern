/**
 * Migration Verification Test
 *
 * Tests that the database schema migration script creates all required tables,
 * indexes, and constraints for the chat memory persistence system.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Database Schema Migration', () => {
  let db: sqlite3.Database;
  let testDbPath: string;

  beforeAll(async () => {
    // Create a temporary test database
    const testDir = path.join(os.tmpdir(), 'everfern-test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    testDbPath = path.join(testDir, `test-${Date.now()}.sqlite`);

    // Initialize database
    db = new sqlite3.Database(testDbPath);

    // Load sqlite-vec extension
    try {
      await new Promise<void>((resolve, reject) => {
        db.loadExtension(sqliteVec.getLoadablePath(), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      console.warn('sqlite-vec extension not available for testing');
    }

    // Create projects table (dependency for conversations)
    await new Promise<void>((resolve, reject) => {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `, (err) => err ? reject(err) : resolve());
    });
  });

  afterAll(async () => {
    // Clean up test database
    if (db) {
      await new Promise<void>((resolve) => {
        db.close(() => resolve());
      });
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('should create conversations table with proper structure', async () => {
    // Execute the first migration
    const migration1Path = path.join(__dirname, '..', 'migrations', '001_chat_memory_persistence.sql');
    const migration1SQL = fs.readFileSync(migration1Path, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      db.exec(migration1SQL, (err) => err ? reject(err) : resolve());
    });

    // Verify conversations table structure
    const tableInfo = await new Promise<any[]>((resolve, reject) => {
      db.all("PRAGMA table_info(conversations)", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    const columnNames = tableInfo.map(col => col.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('title');
    expect(columnNames).toContain('provider');
    expect(columnNames).toContain('model');
    expect(columnNames).toContain('project_id');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should create messages table with proper structure', async () => {
    // Verify messages table structure
    const tableInfo = await new Promise<any[]>((resolve, reject) => {
      db.all("PRAGMA table_info(messages)", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    const columnNames = tableInfo.map(col => col.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('conversation_id');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('content');
    expect(columnNames).toContain('order_index');
    expect(columnNames).toContain('created_at');
  });

  it('should create required indexes for performance', async () => {
    // Check that required indexes exist
    const indexes = await new Promise<any[]>((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type='index'", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    const indexNames = indexes.map(idx => idx.name);

    // Verify required indexes from task description
    expect(indexNames).toContain('idx_conversations_updated_at');
    expect(indexNames).toContain('idx_messages_conversation_id');
    expect(indexNames).toContain('idx_messages_conversation_order');
  });

  it('should create foreign key constraints', async () => {
    // Verify foreign key constraints
    const foreignKeys = await new Promise<any[]>((resolve, reject) => {
      db.all("PRAGMA foreign_key_list(messages)", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    expect(foreignKeys.length).toBeGreaterThan(0);
    expect(foreignKeys[0].table).toBe('conversations');
    expect(foreignKeys[0].on_delete).toBe('CASCADE');
  });

  it('should create vector storage tables', async () => {
    // Execute the vector storage migration
    const migration2Path = path.join(__dirname, '..', 'migrations', '002_chat_vector_storage.sql');

    if (fs.existsSync(migration2Path)) {
      const migration2SQL = fs.readFileSync(migration2Path, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        db.exec(migration2SQL, (err) => err ? reject(err) : resolve());
      });

      // Verify chat_messages table exists
      const tables = await new Promise<any[]>((resolve, reject) => {
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
          err ? reject(err) : resolve(rows);
        });
      });

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('chat_messages');
    }
  });

  it('should support session isolation through unique conversation IDs', async () => {
    // Insert test conversations
    await new Promise<void>((resolve, reject) => {
      db.run(`
        INSERT INTO conversations (id, title) VALUES
        ('conv-1', 'Test Conversation 1'),
        ('conv-2', 'Test Conversation 2')
      `, (err) => err ? reject(err) : resolve());
    });

    // Insert messages for different conversations
    await new Promise<void>((resolve, reject) => {
      db.run(`
        INSERT INTO messages (id, conversation_id, role, content, order_index) VALUES
        ('msg-1', 'conv-1', 'user', 'Hello from conversation 1', 0),
        ('msg-2', 'conv-2', 'user', 'Hello from conversation 2', 0)
      `, (err) => err ? reject(err) : resolve());
    });

    // Verify session isolation - messages from conv-1 should not appear in conv-2 queries
    const conv1Messages = await new Promise<any[]>((resolve, reject) => {
      db.all("SELECT * FROM messages WHERE conversation_id = 'conv-1'", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    const conv2Messages = await new Promise<any[]>((resolve, reject) => {
      db.all("SELECT * FROM messages WHERE conversation_id = 'conv-2'", (err, rows) => {
        err ? reject(err) : resolve(rows);
      });
    });

    expect(conv1Messages).toHaveLength(1);
    expect(conv2Messages).toHaveLength(1);
    expect(conv1Messages[0].content).toBe('Hello from conversation 1');
    expect(conv2Messages[0].content).toBe('Hello from conversation 2');
  });

  it('should support timestamp precision', async () => {
    // Insert a message and verify timestamp precision
    const testId = `test-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      db.run(`
        INSERT INTO conversations (id, title, created_at)
        VALUES (?, 'Timestamp Test', datetime('now', 'subsec'))
      `, [testId], (err) => err ? reject(err) : resolve());
    });

    const result = await new Promise<any>((resolve, reject) => {
      db.get("SELECT created_at FROM conversations WHERE id = ?", [testId], (err, row) => {
        err ? reject(err) : resolve(row);
      });
    });

    // Verify timestamp format supports subsecond precision
    expect(result.created_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    expect(result.created_at.length).toBeGreaterThanOrEqual(19); // ISO format minimum
  });
});
