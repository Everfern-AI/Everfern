/**
 * Health Check Module
 *
 * Provides health check functionality for database, vectors, and system status.
 * Used during app startup to verify all systems are operational.
 */

import { ipcMain } from 'electron';
import { databaseService } from '../store/database-service';
import { dbOps } from './db';

export interface HealthCheckResult {
  success: boolean;
  error?: string;
  details?: string;
  count?: number;
}

/**
 * Check database connection
 */
export async function checkDatabaseConnection(): Promise<HealthCheckResult> {
  try {
    console.log('[HealthCheck] Checking database connection...');
    const result = await databaseService.healthCheck();
    if (result.healthy) {
      return {
        success: true,
        details: result.message
      };
    } else {
      return {
        success: false,
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
 * Check vector store status
 */
export async function checkVectorStore(): Promise<HealthCheckResult> {
  try {
    console.log('[HealthCheck] Checking vector store...');
    const result = await dbOps.get('SELECT COUNT(*) as count FROM chat_messages_vec');
    const count = result?.count ?? 0;
    return {
      success: true,
      count,
      details: `Vector store is healthy. Found ${count} vectors.`
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

    // Use AbortController for timeout instead of fetch timeout option
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${apiUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          success: true,
          details: 'API is responsive'
        };
      } else {
        return {
          success: false,
          error: `API returned ${response.status}`
        };
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
  // Check database connection
  ipcMain.handle('db:checkConnection', async () => {
    return await checkDatabaseConnection();
  });

  // Check vector store
  ipcMain.handle('db:checkVectors', async () => {
    return await checkVectorStore();
  });

  // Check API connectivity
  ipcMain.handle('api:checkHealth', async (_event, apiUrl?: string) => {
    return await checkApiConnectivity(apiUrl);
  });

  console.log('[HealthCheck] IPC handlers registered');
}

/**
 * Run all health checks
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
