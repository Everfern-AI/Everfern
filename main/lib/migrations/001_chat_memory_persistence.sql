-- Migration: Chat Memory Persistence System
-- Description: Creates database schema for chat conversations and messages with proper indexes and constraints
-- Requirements: 5.3, 7.5, 8.1
-- Date: 2025-01-15

-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================
-- Stores chat session metadata including provider, model, and project association
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider TEXT,
  model TEXT,
  project_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Index for efficient sorting and filtering by update time
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

-- Index for project-based conversation queries
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
-- Stores individual messages within conversations with full metadata
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
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

-- Index for efficient conversation message retrieval
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Composite index for ordered message retrieval within conversations
CREATE INDEX IF NOT EXISTS idx_messages_conversation_order ON messages(conversation_id, order_index);

-- Index for timestamp-based queries (for recency ranking)
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- ============================================================================
-- CHAT MESSAGES METADATA TABLE (for vector search)
-- ============================================================================
-- Stores metadata for vector embeddings with session isolation
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL, -- Unix timestamp in milliseconds
  indexed_at INTEGER,
  FOREIGN KEY(chat_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Index for session-based vector search
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);

-- Index for timestamp-based ranking
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Composite index for session + timestamp queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created ON chat_messages(chat_id, created_at);

-- ============================================================================
-- MIGRATION TRACKING
-- ============================================================================
-- Track applied migrations to prevent duplicate execution
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('001_chat_memory_persistence');
