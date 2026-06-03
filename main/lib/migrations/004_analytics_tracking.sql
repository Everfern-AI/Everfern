-- Migration 004: Analytics Tracking
-- Tracks token usage, cost, and model statistics per conversation

-- Track schema_migrations table first (in case it doesn't exist)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage events table — one row per AI request/response
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

-- Model pricing cache — fetched from OpenRouter, refreshed periodically
CREATE TABLE IF NOT EXISTS model_pricing_cache (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT,
  input_cost_per_1m REAL NOT NULL DEFAULT 0,
  output_cost_per_1m REAL NOT NULL DEFAULT 0,
  context_window INTEGER DEFAULT 150000,
  last_fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Record this migration as applied
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('004_analytics_tracking');
