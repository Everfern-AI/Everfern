/**
 * Health Check Module
 *
 * Provides health check functionality for database, vectors, and system status.
 * Used during app startup to verify all systems are operational.
 *
 * Self-healing: if any table or vector table is missing, it is automatically
 * created before the check proceeds — no manual intervention needed.
 */

import { ipcMain } from 'electron';
import { databaseService } from '../store/database-service';
import { dbOps } from './db';

export interface HealthCheckResult {
  success: boolean;
  error?: string;
  details?: string;
  count?: number;
  repaired?: string[];
}

// ── Table definitions used for auto-repair ────────────────────────────────

const REQUIRED_TABLES: Array<{ name: string; ddl: string }> = [
  {
    name: 'conversations',
    ddl: `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      provider TEXT,
      model TEXT,
      project_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    name: 'messages',
    ddl: `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      thought TEXT,
      reasoning_content TEXT,
      tool_calls TEXT,
      mission_timeline TEXT,
      has_timeline BOOLEAN DEFAULT 0,
      order_index INTEGER DEFAULT 0,
      thinking_duration INTEGER,
      stopped BOOLEAN DEFAULT 0,
      attachments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )`
  },
  {
    name: 'memory_chunks',
    ddl: `CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      text_content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    name: 'semantic_cache',
    ddl: `CREATE TABLE IF NOT EXISTS semantic_cache (
      id TEXT PRIMARY KEY,
      prompt_text TEXT NOT NULL,
      response_json TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    name: 'scheduled_tasks',
    ddl: `CREATE TABLE IF NOT EXISTS scheduled_tasks (
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
    )`
  },
  {
    name: 'projects',
    ddl: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instructions TEXT,
      path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    name: 'schema_migrations',
    ddl: `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
  {
    name: 'usage_events',
    ddl: `CREATE TABLE IF NOT EXISTS usage_events (
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
    )`
  },
  {
    name: 'model_pricing_cache',
    ddl: `CREATE TABLE IF NOT EXISTS model_pricing_cache (
      model_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT,
      input_cost_per_1m REAL NOT NULL DEFAULT 0,
      output_cost_per_1m REAL NOT NULL DEFAULT 0,
      context_window INTEGER DEFAULT 150000,
      last_fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  },
];

// Vector tables need sqlite-vec loaded.
// Fallback dim = 1536 (OpenAI text-embedding-3-small / ada-002 default).
const REQUIRED_VECTOR_TABLES: Array<{ name: string; getDdl: (dims: number) => string }> = [
  {
    name: 'memory_chunks_vec',
    getDdl: (dims) => `CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dims}]
    )`
  },
  {
    name: 'semantic_cache_vec',
    getDdl: (dims) => `CREATE VIRTUAL TABLE IF NOT EXISTS semantic_cache_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dims}]
    )`
  },
  {
    name: 'chat_messages_vec',
    getDdl: (dims) => `CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dims}]
    )`
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
  try {
    const row = await dbOps.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [name]
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

async function vectorTableExists(name: string): Promise<boolean> {
  try {
    // Virtual tables appear in sqlite_master as type='table' with tbl_name === name
    await dbOps.get(`SELECT COUNT(*) as c FROM ${name}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the vector embedding dimension from an existing vector table or
 * fall back to 1536 (OpenAI default).
 */
async function detectVectorDimensions(): Promise<number> {
  try {
    const row = await dbOps.get(`SELECT * FROM vec_info('memory_chunks_vec')`);
    if (row && row.dimensions) return Number(row.dimensions);
  } catch { /* table doesn't exist yet */ }
  return 1536;
}

// ── Auto-repair functions ─────────────────────────────────────────────────

/**
 * Ensure all required regular tables exist; auto-create any that are missing.
 * Returns list of table names that were created.
 */
async function ensureRequiredTables(): Promise<string[]> {
  const created: string[] = [];
  for (const { name, ddl } of REQUIRED_TABLES) {
    const exists = await tableExists(name);
    if (!exists) {
      console.log(`[HealthCheck] 🔧 Auto-creating missing table: ${name}`);
      try {
        await dbOps.exec(ddl);
        created.push(name);
      } catch (err: any) {
        console.error(`[HealthCheck] Failed to create table ${name}:`, err.message);
      }
    }
  }
  return created;
}

/**
 * Ensure all required vector (virtual) tables exist; auto-create any missing ones.
 * Returns list of table names that were created.
 */
async function ensureRequiredVectorTables(): Promise<string[]> {
  const created: string[] = [];
  let dims: number | null = null;

  for (const { name, getDdl } of REQUIRED_VECTOR_TABLES) {
    const exists = await vectorTableExists(name);
    if (!exists) {
      if (dims === null) dims = await detectVectorDimensions();
      console.log(`[HealthCheck] 🔧 Auto-creating missing vector table: ${name} (dims=${dims})`);
      try {
        await dbOps.exec(getDdl(dims));
        created.push(name);
      } catch (err: any) {
        // sqlite-vec may not be loaded — log a warning but don't crash
        console.warn(
          `[HealthCheck] Could not create vector table ${name}: ${err.message}. ` +
          `sqlite-vec extension may not be available on this platform.`
        );
      }
    }
  }
  return created;
}

// ── Public health check functions ─────────────────────────────────────────

/**
 * Check (and auto-repair) database connection and required regular tables.
 */
export async function checkDatabaseConnection(): Promise<HealthCheckResult> {
  try {
    console.log('[HealthCheck] Checking database connection...');

    // Self-healing: create any missing regular tables
    const repairedTables = await ensureRequiredTables();
    if (repairedTables.length > 0) {
      console.log(`[HealthCheck] ✅ Auto-created missing tables: ${repairedTables.join(', ')}`);
    }

    const result = await databaseService.healthCheck();
    if (result.healthy) {
      return {
        success: true,
        repaired: repairedTables,
        details: repairedTables.length > 0
          ? `Database is healthy. Auto-created tables: ${repairedTables.join(', ')}`
          : result.message
      };
    } else {
      return {
        success: false,
        repaired: repairedTables,
        error: result.message,
        details: result.diagnostics ? JSON.stringify(result.diagnostics) : undefined
      };
    }
  } catch (error) {
    console.error('[HealthCheck] Database check failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check (and auto-repair) vector store — creates any missing vector tables.
 */
export async function checkVectorStore(): Promise<HealthCheckResult> {
  try {
    console.log('[HealthCheck] Checking vector store...');

    // Self-healing: create any missing vector tables
    const repairedTables = await ensureRequiredVectorTables();
    if (repairedTables.length > 0) {
      console.log(`[HealthCheck] ✅ Auto-created missing vector tables: ${repairedTables.join(', ')}`);
    }

    const result = await dbOps.get('SELECT COUNT(*) as count FROM chat_messages_vec');
    const count = result?.count ?? 0;
    return {
      success: true,
      count,
      repaired: repairedTables,
      details: repairedTables.length > 0
        ? `Vector store healthy. Found ${count} vectors. Auto-created: ${repairedTables.join(', ')}`
        : `Vector store is healthy. Found ${count} vectors.`
    };
  } catch (error) {
    console.error('[HealthCheck] Vector store check failed:', error);
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check API connectivity
 */
export async function checkApiConnectivity(apiUrl: string = 'http://localhost:5000'): Promise<HealthCheckResult> {
  try {
    console.log('[HealthCheck] Checking API connectivity...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${apiUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { success: true, details: 'API is responsive' };
      } else {
        return { success: false, error: `API returned ${response.status}` };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error('[HealthCheck] API connectivity check failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Register IPC handlers for health checks
 */
export function registerHealthCheckHandlers() {
  // Check database connection (auto-repairs missing tables)
  ipcMain.handle('db:checkConnection', async () => {
    return await checkDatabaseConnection();
  });

  // Check vector store (auto-repairs missing vector tables)
  ipcMain.handle('db:checkVectors', async () => {
    return await checkVectorStore();
  });

  // Check API connectivity
  ipcMain.handle('api:checkHealth', async (_event, apiUrl?: string) => {
    return await checkApiConnectivity(apiUrl);
  });

  // Combined: run all checks with auto-repair
  ipcMain.handle('health:repair', async () => {
    return await runAllHealthChecks();
  });

  console.log('[HealthCheck] IPC handlers registered');
}

/**
 * Run all health checks (with auto-repair on each)
 */
export async function runAllHealthChecks(): Promise<{
  database: HealthCheckResult;
  vectors: HealthCheckResult;
  api: HealthCheckResult;
}> {
  console.log('[HealthCheck] Running all health checks...');

  const [database, vectors, api] = await Promise.all([
    checkDatabaseConnection(),
    checkVectorStore(),
    checkApiConnectivity()
  ]);

  return { database, vectors, api };
}
