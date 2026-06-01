-- Migration: Chat Vector Storage
-- Description: Creates vector storage tables for semantic search using sqlite-vec
-- Requirements: 2.2, 2.6, 6.1, 6.2
-- Date: 2025-01-15

-- ============================================================================
-- CHAT MESSAGES VECTOR TABLE
-- ============================================================================
-- Virtual table for storing vector embeddings of chat messages
-- Uses sqlite-vec extension with 1536 dimensions (OpenAI text-embedding-3-small)
CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[1536]
);

-- ============================================================================
-- VECTOR METADATA AND INDEXES
-- ============================================================================
-- The chat_messages table already exists from migration 001
-- Add any missing indexes for vector operations

-- Index for efficient vector search by session
-- (chat_messages table already has idx_chat_messages_chat_id)

-- Index for vector search with timestamp ranking
-- (chat_messages table already has idx_chat_messages_created_at)

-- ============================================================================
-- VECTOR HEALTH CHECK SUPPORT
-- ============================================================================
-- Create a test vector entry for health checks
-- This will be used by the health check system to verify vector operations
INSERT OR IGNORE INTO chat_messages (
  id,
  chat_id,
  role,
  content,
  created_at
) VALUES (
  '__health_check__',
  '__health_check__',
  'system',
  'Health check test message for vector operations',
  strftime('%s', 'now') * 1000
);

-- Insert a test vector for health checks (zero vector for testing)
-- This will be replaced with actual embeddings during health checks
INSERT OR IGNORE INTO chat_messages_vec (id, embedding)
SELECT '__health_check__', zeroblob(1536 * 4)
WHERE NOT EXISTS (SELECT 1 FROM chat_messages_vec WHERE id = '__health_check__');

-- ============================================================================
-- MIGRATION TRACKING
-- ============================================================================
-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('002_chat_vector_storage');
