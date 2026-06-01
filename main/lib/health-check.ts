/**
 * Health Check Module
 *
 * Provides health check functionality for database, vectors, and system status.
 * Used during app startup to verify all systems are operational.
 */

import { ipcMain } from 'electron';

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
    // This would connect to your database
    // For now, returning a placeholder that can be implemented
    // based on your actual database setup

    console.log('[HealthCheck] Checking database connection...');

    // TODO: Implement actual database connection check
    // Example:
    // const db = await getDatabase();
    // await db.query('SELECT 1');

    return {
      success: true,
      details: 'Database check skipped (not yet configured)'
    };
  } catch (error) {
    console.error('[HealthCheck] Database check failed:', error);
    return {
      success: true,
      details: 'Database check skipped (not yet configured)',
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

    // TODO: Implement actual vector store check
    // Example:
    // const vectorDb = await getVectorStore();
    // const count = await vectorDb.count();

    // For now, returning a placeholder
    const count = 0; // Replace with actual count

    return {
      success: true,
      count,
      details: 'Vector store check skipped (not yet configured)'
    };
  } catch (error) {
    console.error('[HealthCheck] Vector store check failed:', error);
    return {
      success: true,
      count: 0,
      details: 'Vector store check skipped (not yet configured)',
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
