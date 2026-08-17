-- Migration: Project Context and Pinning Support
-- Description: Ensures is_pinned, is_bookmarked, is_unread, and project_id columns exist on conversations and projects
-- Date: 2026-08-17

-- Add columns to conversations if not present
-- (SQLite handles safety in db.ts migration loader; this migration formalizes version tracking)

CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_is_pinned ON conversations(is_pinned);
CREATE INDEX IF NOT EXISTS idx_projects_is_pinned ON projects(is_pinned);
