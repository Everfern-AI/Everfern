/**
 * Performance Optimizations for Pill-Based Narrative Timeline
 *
 * Implements memoization, lazy-loading, and virtual scrolling optimizations
 * to ensure the pill-based timeline performs well with large numbers of pills.
 */

import { NarrativeTimeline, Task, ToolPill, ExecutionStatus } from './types';

/**
 * Memoized status calculation to avoid recalculation
 */
export class MemoizedStatusCalculator {
  private cache: Map<string, ExecutionStatus> = new Map();
  private pillStatusCache: Map<string, ExecutionStatus> = new Map();

  /**
   * Calculate task status with memoization
   */
  calculateTaskStatus(taskId: string, pills: ToolPill[]): ExecutionStatus {
    // Create cache key from pill statuses
    const cacheKey = `task_${taskId}_${pills.map((p) => p.status).join('_')}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Calculate status
    const allCompleted = pills.every((p) => p.status === 'completed');
    const anyFailed = pills.some((p) => p.status === 'failed');
    const anyInProgress = pills.some((p) => p.status === 'in-progress');
    const allSkipped = pills.every((p) => p.status === 'skipped');

    let status: ExecutionStatus;
    if (allCompleted) {
      status = 'completed';
    } else if (anyFailed) {
      status = 'failed';
    } else if (anyInProgress) {
      status = 'in-progress';
    } else if (allSkipped) {
      status = 'skipped';
    } else {
      status = 'pending';
    }

    this.cache.set(cacheKey, status);
    return status;
  }

  /**
   * Calculate timeline status with memoization
   */
  calculateTimelineStatus(timelineId: string, tasks: Task[]): ExecutionStatus {
    // Create cache key from task statuses
    const cacheKey = `timeline_${timelineId}_${tasks.map((t) => t.status).join('_')}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Calculate status
    const allCompleted = tasks.every((t) => t.status === 'completed');
    const anyFailed = tasks.some((t) => t.status === 'failed');
    const anyInProgress = tasks.some((t) => t.status === 'in-progress');
    const allSkipped = tasks.every((t) => t.status === 'skipped');

    let status: ExecutionStatus;
    if (allCompleted) {
      status = 'completed';
    } else if (anyFailed) {
      status = 'failed';
    } else if (anyInProgress) {
      status = 'in-progress';
    } else if (allSkipped) {
      status = 'skipped';
    } else {
      status = 'pending';
    }

    this.cache.set(cacheKey, status);
    return status;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.pillStatusCache.clear();
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.cache.size + this.pillStatusCache.size;
  }
}

/**
 * Lazy loader for tool call details
 */
export class LazyToolCallLoader {
  private loadedPills: Set<string> = new Set();
  private loadingPills: Set<string> = new Set();

  /**
   * Check if pill details are loaded
   */
  isLoaded(pillId: string): boolean {
    return this.loadedPills.has(pillId);
  }

  /**
   * Check if pill is currently loading
   */
  isLoading(pillId: string): boolean {
    return this.loadingPills.has(pillId);
  }

  /**
   * Mark pill as loading
   */
  markLoading(pillId: string): void {
    this.loadingPills.add(pillId);
  }

  /**
   * Mark pill as loaded
   */
  markLoaded(pillId: string): void {
    this.loadingPills.delete(pillId);
    this.loadedPills.add(pillId);
  }

  /**
   * Clear loaded pills
   */
  clearLoaded(): void {
    this.loadedPills.clear();
    this.loadingPills.clear();
  }

  /**
   * Get number of loaded pills
   */
  getLoadedCount(): number {
    return this.loadedPills.size;
  }
}

/**
 * Virtual scroller for large timelines
 */
export class VirtualScroller {
  private itemHeight: number;
  private containerHeight: number;
  private scrollTop: number = 0;

  constructor(itemHeight: number = 100, containerHeight: number = 600) {
    this.itemHeight = itemHeight;
    this.containerHeight = containerHeight;
  }

  /**
   * Calculate visible range
   */
  getVisibleRange(totalItems: number): { start: number; end: number } {
    const start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - 1);
    const end = Math.min(totalItems, Math.ceil((this.scrollTop + this.containerHeight) / this.itemHeight) + 1);

    return { start, end };
  }

  /**
   * Update scroll position
   */
  setScrollTop(scrollTop: number): void {
    this.scrollTop = Math.max(0, scrollTop);
  }

  /**
   * Get offset for item
   */
  getItemOffset(index: number): number {
    return index * this.itemHeight;
  }

  /**
   * Get total height
   */
  getTotalHeight(totalItems: number): number {
    return totalItems * this.itemHeight;
  }
}

/**
 * Batch updater for status updates
 */
export class BatchStatusUpdater {
  private updates: Array<{
    missionId: string;
    taskId: string;
    pillId: string;
    status: ExecutionStatus;
    result?: string;
    error?: string;
  }> = [];
  private batchSize: number;
  private batchTimeout: number;
  private timeoutId: NodeJS.Timeout | null = null;
  private callback: (updates: typeof this.updates) => void;

  constructor(
    batchSize: number = 10,
    batchTimeout: number = 100,
    callback: (updates: typeof this.updates) => void = () => {}
  ) {
    this.batchSize = batchSize;
    this.batchTimeout = batchTimeout;
    this.callback = callback;
  }

  /**
   * Add an update to the batch
   */
  addUpdate(
    missionId: string,
    taskId: string,
    pillId: string,
    status: ExecutionStatus,
    result?: string,
    error?: string
  ): void {
    this.updates.push({ missionId, taskId, pillId, status, result, error });

    // Flush if batch is full
    if (this.updates.length >= this.batchSize) {
      this.flush();
    } else {
      // Schedule flush
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a flush
   */
  private scheduleFlush(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.flush();
    }, this.batchTimeout);
  }

  /**
   * Flush pending updates
   */
  flush(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.updates.length > 0) {
      this.callback(this.updates);
      this.updates = [];
    }
  }

  /**
   * Get pending update count
   */
  getPendingCount(): number {
    return this.updates.length;
  }
}

/**
 * Performance monitor for tracking metrics
 */
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private startTimes: Map<string, number> = new Map();

  /**
   * Start timing a metric
   */
  startTiming(metricName: string): void {
    this.startTimes.set(metricName, performance.now());
  }

  /**
   * End timing a metric
   */
  endTiming(metricName: string): number {
    const startTime = this.startTimes.get(metricName);
    if (!startTime) {
      console.warn(`[PerformanceMonitor] No start time for metric: ${metricName}`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.startTimes.delete(metricName);

    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }

    this.metrics.get(metricName)!.push(duration);
    return duration;
  }

  /**
   * Get average time for a metric
   */
  getAverageTime(metricName: string): number {
    const times = this.metrics.get(metricName);
    if (!times || times.length === 0) {
      return 0;
    }

    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  /**
   * Get max time for a metric
   */
  getMaxTime(metricName: string): number {
    const times = this.metrics.get(metricName);
    if (!times || times.length === 0) {
      return 0;
    }

    return Math.max(...times);
  }

  /**
   * Get min time for a metric
   */
  getMinTime(metricName: string): number {
    const times = this.metrics.get(metricName);
    if (!times || times.length === 0) {
      return 0;
    }

    return Math.min(...times);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Record<string, { avg: number; max: number; min: number; count: number }> {
    const result: Record<string, { avg: number; max: number; min: number; count: number }> = {};

    for (const [metricName, times] of this.metrics) {
      result[metricName] = {
        avg: this.getAverageTime(metricName),
        max: this.getMaxTime(metricName),
        min: this.getMinTime(metricName),
        count: times.length,
      };
    }

    return result;
  }

  /**
   * Clear metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.startTimes.clear();
  }
}
