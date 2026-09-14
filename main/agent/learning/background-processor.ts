/**
 * Background Processor for Continuous Learning Agent
 *
 * Manages non-blocking learning operations with resource constraints.
 * Processes learning tasks during idle periods while respecting CPU and memory limits.
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { LearningTask, ProcessingQueue, ResourceUsage, ResourceLimits, LearningError } from './types';
import { IBackgroundProcessor, QueueStatus } from './interfaces';
import { learningErrorHandler } from './error-handler';

export interface BackgroundProcessorConfig {
  maxConcurrency: number;
  resourceLimits: ResourceLimits;
  idleThresholdMs: number;
  queueCleanupIntervalMs: number;
  performanceMonitoringIntervalMs: number;
}

// ResourceUsage and ResourceLimits are imported from types.ts

/**
 * Background processor that manages learning tasks with resource constraints
 */
export class BackgroundProcessor extends EventEmitter implements IBackgroundProcessor {
  private queue: ProcessingQueue;
  private processingTasks: Set<string> = new Set();
  private completedTasks: Map<string, { success: boolean; completedAt: Date }> = new Map();
  private failedTasks: Map<string, { error: Error; failedAt: Date }> = new Map();

  private lastUserActivity: number = Date.now();
  private resourceMonitorInterval?: NodeJS.Timeout;
  private queueCleanupInterval?: NodeJS.Timeout;
  private currentResourceUsage: ResourceUsage;

  private readonly config: BackgroundProcessorConfig;
  private isShuttingDown = false;

  constructor(config: Partial<BackgroundProcessorConfig> = {}) {
    super();

    this.config = {
      maxConcurrency: config.maxConcurrency ?? 2,
      resourceLimits: config.resourceLimits ?? {
        maxCpuPercent: 5,
        maxMemoryMB: 100
      },
      idleThresholdMs: config.idleThresholdMs ?? 5000,
      queueCleanupIntervalMs: config.queueCleanupIntervalMs ?? 60000,
      performanceMonitoringIntervalMs: config.performanceMonitoringIntervalMs ?? 1000
    };

    this.queue = {
      tasks: [],
      isProcessing: false,
      maxConcurrency: this.config.maxConcurrency,
      resourceLimits: this.config.resourceLimits
    };

    this.currentResourceUsage = {
      cpuPercent: 0,
      memoryMB: 0,
      timestamp: new Date()
    };

    this.initializeMonitoring();
  }

  /**
   * Initialize resource monitoring and queue cleanup
   */
  private initializeMonitoring(): void {
    // Monitor resource usage
    this.resourceMonitorInterval = setInterval(() => {
      this.updateResourceUsage();
    }, this.config.performanceMonitoringIntervalMs);

    // Cleanup completed/failed tasks periodically
    this.queueCleanupInterval = setInterval(() => {
      this.cleanupQueue();
    }, this.config.queueCleanupIntervalMs);
  }

  /**
   * Update current resource usage metrics
   */
  private updateResourceUsage(): void {
    const memUsage = process.memoryUsage();

    this.currentResourceUsage = {
      cpuPercent: this.estimateCpuUsage(),
      memoryMB: memUsage.heapUsed / 1024 / 1024,
      timestamp: new Date()
    };

    // Emit resource usage event for monitoring
    this.emit('resourceUsage', this.currentResourceUsage);
  }

  /**
   * Estimate CPU usage (simplified approach)
   * In a real implementation, this would use more sophisticated CPU monitoring
   */
  private estimateCpuUsage(): number {
    // Simple estimation based on processing tasks and system load
    const processingCount = this.processingTasks.size;
    const baseUsage = processingCount * 2; // Rough estimate: 2% per task

    // Add some randomness to simulate real CPU fluctuation
    const variance = Math.random() * 1;

    return Math.min(baseUsage + variance, 100);
  }

  /**
   * Update last user activity timestamp
   */
  public updateUserActivity(): void {
    this.lastUserActivity = Date.now();
    this.emit('userActivity', this.lastUserActivity);
  }

  /**
   * Check if the system is currently idle and available for processing
   */
  public isIdle(): boolean {
    const timeSinceLastActivity = Date.now() - this.lastUserActivity;
    const isUserIdle = timeSinceLastActivity >= this.config.idleThresholdMs;
    const isResourceAvailable = this.isResourceAvailable();

    return isUserIdle && isResourceAvailable && !this.isShuttingDown;
  }

  /**
   * Check if resources are available for processing
   */
  private isResourceAvailable(): boolean {
    const { cpuPercent, memoryMB } = this.currentResourceUsage;
    const { maxCpuPercent, maxMemoryMB } = this.config.resourceLimits;

    return cpuPercent < maxCpuPercent && memoryMB < maxMemoryMB;
  }

  /**
   * Queue a learning task for background processing
   */
  public async queueLearningTask(task: LearningTask): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Background processor is shutting down');
    }

    // Validate task
    if (!task.id || !task.type) {
      throw new Error('Invalid learning task: missing id or type');
    }

    // Check for duplicate tasks
    const existingTask = this.queue.tasks.find(t => t.id === task.id);
    if (existingTask) {
      console.log(`[Background Processor] Task ${task.id} already queued, skipping`);
      return;
    }

    // Add task to queue
    this.queue.tasks.push(task);

    // Sort queue by priority
    this.queue.tasks = this.prioritizeTasks(this.queue.tasks);

    console.log(`[Background Processor] Queued task ${task.id} (type: ${task.type}, priority: ${task.priority})`);
    this.emit('taskQueued', task);

    // Try to process immediately if idle
    if (this.isIdle() && !this.queue.isProcessing) {
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Process queued tasks during idle periods
   */
  public async processQueue(): Promise<void> {
    if (this.queue.isProcessing || this.isShuttingDown) {
      return;
    }

    if (!this.isIdle()) {
      console.log('[Background Processor] System not idle, deferring processing');
      return;
    }

    if (this.queue.tasks.length === 0) {
      return;
    }

    this.queue.isProcessing = true;
    this.emit('processingStarted');

    try {
      const availableSlots = this.config.maxConcurrency - this.processingTasks.size;
      const tasksToProcess = this.queue.tasks
        .filter(task => !this.processingTasks.has(task.id))
        .filter(task => !task.scheduledFor || task.scheduledFor <= new Date())
        .slice(0, availableSlots);

      if (tasksToProcess.length === 0) {
        this.queue.isProcessing = false;
        return;
      }

      console.log(`[Background Processor] Processing ${tasksToProcess.length} tasks`);

      // Process tasks concurrently
      const processingPromises = tasksToProcess.map(task => this.processTask(task));
      await Promise.allSettled(processingPromises);

    } catch (error) {
      console.error('[Background Processor] Error during queue processing:', error);
    } finally {
      this.queue.isProcessing = false;
      this.emit('processingCompleted');

      // Schedule next processing cycle if there are more tasks
      if (this.queue.tasks.length > 0 && this.isIdle()) {
        setTimeout(() => this.processQueue(), 1000);
      }
    }
  }

  /**
   * Process a single learning task
   */
  private async processTask(task: LearningTask): Promise<void> {
    const startTime = performance.now();
    this.processingTasks.add(task.id);

    try {
      console.log(`[Background Processor] Processing task ${task.id} (${task.type})`);
      this.emit('taskStarted', task);

      // Check resource constraints before processing
      if (!this.isResourceAvailable()) {
        throw new Error('Resource constraints exceeded');
      }

      // Simulate task processing based on type
      await this.executeTask(task);

      // Mark task as completed
      const processingTime = performance.now() - startTime;
      this.completedTasks.set(task.id, {
        success: true,
        completedAt: new Date()
      });

      // Remove from queue
      this.queue.tasks = this.queue.tasks.filter(t => t.id !== task.id);

      console.log(`[Background Processor] Completed task ${task.id} in ${processingTime.toFixed(2)}ms`);
      this.emit('taskCompleted', { task, processingTime });

    } catch (error) {
      const processingTime = performance.now() - startTime;
      console.error(`[Background Processor] Task ${task.id} failed:`, error);

      // Handle error through error handler
      const learningError: LearningError = {
        type: 'processing',
        code: 'PROCESSING_FAILED',
        message: (error as Error).message,
        context: { taskId: task.id, taskType: task.type },
        timestamp: new Date(),
        recoverable: true
      };
      await learningErrorHandler.handleProcessingError(learningError, task);

      // Mark task as failed or retry
      if (task.retryCount >= task.maxRetries) {
        this.failedTasks.set(task.id, {
          error: error as Error,
          failedAt: new Date()
        });

        // Remove from queue
        this.queue.tasks = this.queue.tasks.filter(t => t.id !== task.id);

        this.emit('taskFailed', { task, error, processingTime });
      } else {
        // Task will be retried (scheduledFor was set by error handler)
        this.emit('taskRetry', { task, error, processingTime });
      }

    } finally {
      this.processingTasks.delete(task.id);
    }
  }

  /**
   * Execute the actual task logic based on task type
   */
  private async executeTask(task: LearningTask): Promise<void> {
    // Simulate processing time and resource usage
    const processingTime = this.getTaskProcessingTime(task.type);

    // Check for user activity during processing
    const checkInterval = Math.min(processingTime / 10, 500);
    const startTime = Date.now();

    while (Date.now() - startTime < processingTime) {
      // Check if user became active
      if (!this.isIdle()) {
        throw new Error('User activity detected, aborting task');
      }

      // Check resource constraints
      if (!this.isResourceAvailable()) {
        throw new Error('Resource constraints exceeded during processing');
      }

      await this.sleep(checkInterval);
    }

    // Task-specific processing would go here
    switch (task.type) {
      case 'analyze':
        await this.processAnalysisTask(task);
        break;
      case 'synthesize':
        await this.processSynthesisTask(task);
        break;
      case 'store':
        await this.processStorageTask(task);
        break;
      case 'prune':
        await this.processPruningTask(task);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Get estimated processing time for task type
   */
  private getTaskProcessingTime(taskType: string): number {
    const baseTimes = {
      analyze: 2000,    // 2 seconds
      synthesize: 3000, // 3 seconds
      store: 1000,      // 1 second
      prune: 1500       // 1.5 seconds
    };

    return baseTimes[taskType as keyof typeof baseTimes] || 2000;
  }

  /**
   * Process analysis task
   */
  private async processAnalysisTask(task: LearningTask): Promise<void> {
    // Placeholder for interaction analysis logic
    console.log(`[Background Processor] Analyzing interaction data for task ${task.id}`);
    // Real implementation would call InteractionAnalyzer
  }

  /**
   * Process synthesis task
   */
  private async processSynthesisTask(task: LearningTask): Promise<void> {
    // Placeholder for knowledge synthesis logic
    console.log(`[Background Processor] Synthesizing knowledge for task ${task.id}`);
    // Real implementation would call KnowledgeSynthesizer
  }

  /**
   * Process storage task
   */
  private async processStorageTask(task: LearningTask): Promise<void> {
    // Placeholder for knowledge storage logic
    console.log(`[Background Processor] Storing knowledge for task ${task.id}`);
    // Real implementation would call LearningMemory
  }

  /**
   * Process pruning task
   */
  private async processPruningTask(task: LearningTask): Promise<void> {
    // Placeholder for knowledge pruning logic
    console.log(`[Background Processor] Pruning old knowledge for task ${task.id}`);
    // Real implementation would call LearningMemory.pruneLowConfidenceKnowledge
  }

  /**
   * Prioritize tasks in the processing queue
   */
  public prioritizeTasks(tasks: LearningTask[]): LearningTask[] {
    return tasks.sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      // Older tasks first (FIFO for same priority)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * Clean up completed and failed tasks from memory
   */
  public async cleanupQueue(): Promise<void> {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up completed tasks older than maxAge
    for (const [taskId, completion] of Array.from(this.completedTasks.entries())) {
      if (now - completion.completedAt.getTime() > maxAge) {
        this.completedTasks.delete(taskId);
      }
    }

    // Clean up failed tasks older than maxAge
    for (const [taskId, failure] of Array.from(this.failedTasks.entries())) {
      if (now - failure.failedAt.getTime() > maxAge) {
        this.failedTasks.delete(taskId);
      }
    }

    const initialCount = this.queue.tasks.length;
    this.queue.tasks = this.queue.tasks.filter(task => {
      if (task.scheduledFor && task.scheduledFor.getTime() > now) {
        return now - task.createdAt.getTime() < maxAge;
      }
      return true;
    });

    if (initialCount > this.queue.tasks.length) {
      console.log(`[Background Processor] Cleaned up ${initialCount - this.queue.tasks.length} expired queue tasks`);
    }
  }

  /**
   * Get current resource usage metrics
   */
  public getResourceUsage(): ResourceUsage {
    return { ...this.currentResourceUsage };
  }

  /**
   * Set resource limits for background processing
   */
  public setResourceLimits(limits: ResourceLimits): void {
    this.config.resourceLimits = { ...limits };
    this.queue.resourceLimits = { ...limits };
    console.log(`[Background Processor] Resource limits updated:`, limits);
  }

  /**
   * Get queue status and metrics
   */
  public getQueueStatus(): QueueStatus {
    const totalTasks = this.queue.tasks.length + this.completedTasks.size + this.failedTasks.size;
    const pendingTasks = this.queue.tasks.filter(t => !this.processingTasks.has(t.id)).length;
    const processingTasks = this.processingTasks.size;
    const completedTasks = this.completedTasks.size;
    const failedTasks = this.failedTasks.size;

    // Calculate average processing time from completed tasks
    const completedEntries = Array.from(this.completedTasks.values());
    const averageProcessingTime = completedEntries.length > 0
      ? completedEntries.reduce((sum, entry) => sum + 1000, 0) / completedEntries.length // Placeholder calculation
      : 0;

    return {
      totalTasks,
      pendingTasks,
      processingTasks,
      completedTasks,
      failedTasks,
      averageProcessingTime
    };
  }

  /**
   * Gracefully shutdown the background processor
   */
  public async shutdown(): Promise<void> {
    console.log('[Background Processor] Shutting down...');
    this.isShuttingDown = true;

    // Clear intervals
    if (this.resourceMonitorInterval) {
      clearInterval(this.resourceMonitorInterval);
    }
    if (this.queueCleanupInterval) {
      clearInterval(this.queueCleanupInterval);
    }

    // Wait for current processing to complete
    const maxWaitTime = 10000; // 10 seconds
    const startTime = Date.now();

    while (this.queue.isProcessing && Date.now() - startTime < maxWaitTime) {
      await this.sleep(100);
    }

    // Clear remaining tasks
    this.queue.tasks = [];
    this.processingTasks.clear();

    console.log('[Background Processor] Shutdown completed');
    this.emit('shutdown');
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get debug information about the processor state
   */
  public getDebugInfo(): any {
    return {
      config: this.config,
      queue: {
        taskCount: this.queue.tasks.length,
        isProcessing: this.queue.isProcessing,
        processingTasks: Array.from(this.processingTasks)
      },
      resourceUsage: this.currentResourceUsage,
      isIdle: this.isIdle(),
      lastUserActivity: new Date(this.lastUserActivity),
      completedTasksCount: this.completedTasks.size,
      failedTasksCount: this.failedTasks.size,
      isShuttingDown: this.isShuttingDown
    };
  }
}

// Export a default instance for easy use
export const backgroundProcessor = new BackgroundProcessor();
