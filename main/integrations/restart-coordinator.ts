/**
 * Integration Restart Coordinator
 *
 * This service coordinates the restart of integrations when configuration
 * changes require it, ensuring graceful shutdown and startup.
 */

import { EventEmitter } from 'events';

/**
 * Integration status
 */
export type IntegrationStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Integration info
 */
export interface IntegrationInfo {
  platform: string;
  status: IntegrationStatus;
  lastStarted?: Date;
  lastStopped?: Date;
  error?: string;
}

/**
 * Restart operation
 */
export interface RestartOperation {
  id: string;
  platforms: string[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Restart coordinator events
 */
export interface RestartCoordinatorEvents {
  'integration-status-changed': (platform: string, status: IntegrationStatus) => void;
  'restart-operation-started': (operation: RestartOperation) => void;
  'restart-operation-completed': (operation: RestartOperation) => void;
  'restart-operation-failed': (operation: RestartOperation, error: Error) => void;
  'error': (error: Error) => void;
}

/**
 * Integration restart coordinator
 */
export class RestartCoordinator extends EventEmitter {
  private integrations: Map<string, IntegrationInfo> = new Map();
  private restartOperations: Map<string, RestartOperation> = new Map();
  private operationCounter = 0;

  constructor() {
    super();
  }

  /**
   * Register an integration
   */
  registerIntegration(platform: string): void {
    this.integrations.set(platform, {
      platform,
      status: 'stopped'
    });
    console.log(`Integration registered: ${platform}`);
  }

  /**
   * Unregister an integration
   */
  unregisterIntegration(platform: string): void {
    this.integrations.delete(platform);
    console.log(`Integration unregistered: ${platform}`);
  }

  /**
   * Update integration status
   */
  updateIntegrationStatus(platform: string, status: IntegrationStatus, error?: string): void {
    const integration = this.integrations.get(platform);
    if (!integration) {
      console.warn(`Attempted to update status for unregistered integration: ${platform}`);
      return;
    }

    const oldStatus = integration.status;
    integration.status = status;
    integration.error = error;

    if (status === 'running') {
      integration.lastStarted = new Date();
    } else if (status === 'stopped') {
      integration.lastStopped = new Date();
    }

    if (oldStatus !== status) {
      this.emit('integration-status-changed', platform, status);
      console.log(`Integration ${platform} status changed: ${oldStatus} -> ${status}`);
    }
  }

  /**
   * Get integration status
   */
  getIntegrationStatus(platform: string): IntegrationInfo | undefined {
    return this.integrations.get(platform);
  }

  /**
   * Get all integration statuses
   */
  getAllIntegrationStatuses(): IntegrationInfo[] {
    return Array.from(this.integrations.values());
  }

  /**
   * Restart specific integration
   */
  async restartIntegration(platform: string): Promise<void> {
    await this.restartIntegrations([platform]);
  }

  /**
   * Restart multiple integrations
   */
  async restartIntegrations(platforms: string[]): Promise<void> {
    const operation: RestartOperation = {
      id: this.generateOperationId(),
      platforms,
      status: 'pending',
      startedAt: new Date()
    };

    this.restartOperations.set(operation.id, operation);

    try {
      console.log(`Starting restart operation ${operation.id} for platforms: ${platforms.join(', ')}`);

      operation.status = 'in-progress';
      this.emit('restart-operation-started', operation);

      // Stop all specified integrations first
      for (const platform of platforms) {
        await this.stopIntegration(platform);
      }

      // Wait a moment for clean shutdown
      await this.delay(1000);

      // Start all specified integrations
      for (const platform of platforms) {
        await this.startIntegration(platform);
      }

      operation.status = 'completed';
      operation.completedAt = new Date();
      this.emit('restart-operation-completed', operation);

      console.log(`Restart operation ${operation.id} completed successfully`);
    } catch (error) {
      operation.status = 'failed';
      operation.error = (error as Error).message;
      operation.completedAt = new Date();

      this.emit('restart-operation-failed', operation, error as Error);
      console.error(`Restart operation ${operation.id} failed:`, error);
      throw error;
    }
  }

  /**
   * Restart all integrations
   */
  async restartAllIntegrations(): Promise<void> {
    const platforms = Array.from(this.integrations.keys());
    await this.restartIntegrations(platforms);
  }

  /**
   * Stop integration gracefully
   */
  async stopIntegration(platform: string): Promise<void> {
    const integration = this.integrations.get(platform);
    if (!integration) {
      console.warn(`Cannot stop unregistered integration: ${platform}`);
      return;
    }

    if (integration.status === 'stopped' || integration.status === 'stopping') {
      console.log(`Integration ${platform} is already stopped or stopping`);
      return;
    }

    try {
      console.log(`Stopping integration: ${platform}`);
      this.updateIntegrationStatus(platform, 'stopping');

      // Emit stop signal - the actual integration manager should listen to this
      this.emit('stop-integration-requested', platform);

      // Wait for integration to stop (with timeout)
      await this.waitForStatus(platform, 'stopped', 10000);

      console.log(`Integration ${platform} stopped successfully`);
    } catch (error) {
      this.updateIntegrationStatus(platform, 'error', (error as Error).message);
      throw error;
    }
  }

  /**
   * Start integration
   */
  async startIntegration(platform: string): Promise<void> {
    const integration = this.integrations.get(platform);
    if (!integration) {
      console.warn(`Cannot start unregistered integration: ${platform}`);
      return;
    }

    if (integration.status === 'running' || integration.status === 'starting') {
      console.log(`Integration ${platform} is already running or starting`);
      return;
    }

    try {
      console.log(`Starting integration: ${platform}`);
      this.updateIntegrationStatus(platform, 'starting');

      // Emit start signal - the actual integration manager should listen to this
      this.emit('start-integration-requested', platform);

      // Wait for integration to start (with timeout)
      await this.waitForStatus(platform, 'running', 15000);

      console.log(`Integration ${platform} started successfully`);
    } catch (error) {
      this.updateIntegrationStatus(platform, 'error', (error as Error).message);
      throw error;
    }
  }

  /**
   * Check if any integrations are running
   */
  hasRunningIntegrations(): boolean {
    return Array.from(this.integrations.values()).some(
      integration => integration.status === 'running'
    );
  }

  /**
   * Check if specific integration is running
   */
  isIntegrationRunning(platform: string): boolean {
    const integration = this.integrations.get(platform);
    return integration?.status === 'running' || false;
  }

  /**
   * Get active restart operations
   */
  getActiveRestartOperations(): RestartOperation[] {
    return Array.from(this.restartOperations.values()).filter(
      op => op.status === 'pending' || op.status === 'in-progress'
    );
  }

  /**
   * Get restart operation by ID
   */
  getRestartOperation(id: string): RestartOperation | undefined {
    return this.restartOperations.get(id);
  }

  /**
   * Clean up completed restart operations (keep last 10)
   */
  cleanupRestartOperations(): void {
    const operations = Array.from(this.restartOperations.values())
      .filter(op => op.status === 'completed' || op.status === 'failed')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    // Keep only the 10 most recent completed operations
    const toDelete = operations.slice(10);
    for (const operation of toDelete) {
      this.restartOperations.delete(operation.id);
    }

    if (toDelete.length > 0) {
      console.log(`Cleaned up ${toDelete.length} old restart operations`);
    }
  }

  /**
   * Wait for integration to reach specific status
   */
  private async waitForStatus(platform: string, targetStatus: IntegrationStatus, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('integration-status-changed', statusListener);
        reject(new Error(`Timeout waiting for ${platform} to reach status ${targetStatus}`));
      }, timeoutMs);

      const statusListener = (changedPlatform: string, status: IntegrationStatus) => {
        if (changedPlatform === platform && status === targetStatus) {
          clearTimeout(timeout);
          this.removeListener('integration-status-changed', statusListener);
          resolve();
        } else if (changedPlatform === platform && status === 'error') {
          clearTimeout(timeout);
          this.removeListener('integration-status-changed', statusListener);
          const integration = this.integrations.get(platform);
          reject(new Error(`Integration ${platform} failed: ${integration?.error || 'Unknown error'}`));
        }
      };

      this.on('integration-status-changed', statusListener);

      // Check if already at target status
      const integration = this.integrations.get(platform);
      if (integration?.status === targetStatus) {
        clearTimeout(timeout);
        this.removeListener('integration-status-changed', statusListener);
        resolve();
      }
    });
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `restart-op-${Date.now()}-${++this.operationCounter}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Global restart coordinator instance
 */
let globalRestartCoordinator: RestartCoordinator | null = null;

/**
 * Get or create global restart coordinator
 */
export function getRestartCoordinator(): RestartCoordinator {
  if (!globalRestartCoordinator) {
    globalRestartCoordinator = new RestartCoordinator();
  }
  return globalRestartCoordinator;
}

/**
 * Create a restart coordinator instance
 */
export function createRestartCoordinator(): RestartCoordinator {
  return new RestartCoordinator();
}
