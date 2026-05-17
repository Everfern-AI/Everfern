"use strict";
/**
 * Performance Optimizations for Pill-Based Narrative Timeline
 *
 * Implements memoization, lazy-loading, and virtual scrolling optimizations
 * to ensure the pill-based timeline performs well with large numbers of pills.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceMonitor = exports.BatchStatusUpdater = exports.VirtualScroller = exports.LazyToolCallLoader = exports.MemoizedStatusCalculator = void 0;
/**
 * Memoized status calculation to avoid recalculation
 */
class MemoizedStatusCalculator {
    cache = new Map();
    pillStatusCache = new Map();
    /**
     * Calculate task status with memoization
     */
    calculateTaskStatus(taskId, pills) {
        // Create cache key from pill statuses
        const cacheKey = `task_${taskId}_${pills.map((p) => p.status).join('_')}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        // Calculate status
        const allCompleted = pills.every((p) => p.status === 'completed');
        const anyFailed = pills.some((p) => p.status === 'failed');
        const anyInProgress = pills.some((p) => p.status === 'in-progress');
        const allSkipped = pills.every((p) => p.status === 'skipped');
        let status;
        if (allCompleted) {
            status = 'completed';
        }
        else if (anyFailed) {
            status = 'failed';
        }
        else if (anyInProgress) {
            status = 'in-progress';
        }
        else if (allSkipped) {
            status = 'skipped';
        }
        else {
            status = 'pending';
        }
        this.cache.set(cacheKey, status);
        return status;
    }
    /**
     * Calculate timeline status with memoization
     */
    calculateTimelineStatus(timelineId, tasks) {
        // Create cache key from task statuses
        const cacheKey = `timeline_${timelineId}_${tasks.map((t) => t.status).join('_')}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        // Calculate status
        const allCompleted = tasks.every((t) => t.status === 'completed');
        const anyFailed = tasks.some((t) => t.status === 'failed');
        const anyInProgress = tasks.some((t) => t.status === 'in-progress');
        const allSkipped = tasks.every((t) => t.status === 'skipped');
        let status;
        if (allCompleted) {
            status = 'completed';
        }
        else if (anyFailed) {
            status = 'failed';
        }
        else if (anyInProgress) {
            status = 'in-progress';
        }
        else if (allSkipped) {
            status = 'skipped';
        }
        else {
            status = 'pending';
        }
        this.cache.set(cacheKey, status);
        return status;
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.pillStatusCache.clear();
    }
    /**
     * Get cache size for monitoring
     */
    getCacheSize() {
        return this.cache.size + this.pillStatusCache.size;
    }
}
exports.MemoizedStatusCalculator = MemoizedStatusCalculator;
/**
 * Lazy loader for tool call details
 */
class LazyToolCallLoader {
    loadedPills = new Set();
    loadingPills = new Set();
    /**
     * Check if pill details are loaded
     */
    isLoaded(pillId) {
        return this.loadedPills.has(pillId);
    }
    /**
     * Check if pill is currently loading
     */
    isLoading(pillId) {
        return this.loadingPills.has(pillId);
    }
    /**
     * Mark pill as loading
     */
    markLoading(pillId) {
        this.loadingPills.add(pillId);
    }
    /**
     * Mark pill as loaded
     */
    markLoaded(pillId) {
        this.loadingPills.delete(pillId);
        this.loadedPills.add(pillId);
    }
    /**
     * Clear loaded pills
     */
    clearLoaded() {
        this.loadedPills.clear();
        this.loadingPills.clear();
    }
    /**
     * Get number of loaded pills
     */
    getLoadedCount() {
        return this.loadedPills.size;
    }
}
exports.LazyToolCallLoader = LazyToolCallLoader;
/**
 * Virtual scroller for large timelines
 */
class VirtualScroller {
    itemHeight;
    containerHeight;
    scrollTop = 0;
    constructor(itemHeight = 100, containerHeight = 600) {
        this.itemHeight = itemHeight;
        this.containerHeight = containerHeight;
    }
    /**
     * Calculate visible range
     */
    getVisibleRange(totalItems) {
        const start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - 1);
        const end = Math.min(totalItems, Math.ceil((this.scrollTop + this.containerHeight) / this.itemHeight) + 1);
        return { start, end };
    }
    /**
     * Update scroll position
     */
    setScrollTop(scrollTop) {
        this.scrollTop = Math.max(0, scrollTop);
    }
    /**
     * Get offset for item
     */
    getItemOffset(index) {
        return index * this.itemHeight;
    }
    /**
     * Get total height
     */
    getTotalHeight(totalItems) {
        return totalItems * this.itemHeight;
    }
}
exports.VirtualScroller = VirtualScroller;
/**
 * Batch updater for status updates
 */
class BatchStatusUpdater {
    updates = [];
    batchSize;
    batchTimeout;
    timeoutId = null;
    callback;
    constructor(batchSize = 10, batchTimeout = 100, callback = () => { }) {
        this.batchSize = batchSize;
        this.batchTimeout = batchTimeout;
        this.callback = callback;
    }
    /**
     * Add an update to the batch
     */
    addUpdate(missionId, taskId, pillId, status, result, error) {
        this.updates.push({ missionId, taskId, pillId, status, result, error });
        // Flush if batch is full
        if (this.updates.length >= this.batchSize) {
            this.flush();
        }
        else {
            // Schedule flush
            this.scheduleFlush();
        }
    }
    /**
     * Schedule a flush
     */
    scheduleFlush() {
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
    flush() {
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
    getPendingCount() {
        return this.updates.length;
    }
}
exports.BatchStatusUpdater = BatchStatusUpdater;
/**
 * Performance monitor for tracking metrics
 */
class PerformanceMonitor {
    metrics = new Map();
    startTimes = new Map();
    /**
     * Start timing a metric
     */
    startTiming(metricName) {
        this.startTimes.set(metricName, performance.now());
    }
    /**
     * End timing a metric
     */
    endTiming(metricName) {
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
        this.metrics.get(metricName).push(duration);
        return duration;
    }
    /**
     * Get average time for a metric
     */
    getAverageTime(metricName) {
        const times = this.metrics.get(metricName);
        if (!times || times.length === 0) {
            return 0;
        }
        return times.reduce((a, b) => a + b, 0) / times.length;
    }
    /**
     * Get max time for a metric
     */
    getMaxTime(metricName) {
        const times = this.metrics.get(metricName);
        if (!times || times.length === 0) {
            return 0;
        }
        return Math.max(...times);
    }
    /**
     * Get min time for a metric
     */
    getMinTime(metricName) {
        const times = this.metrics.get(metricName);
        if (!times || times.length === 0) {
            return 0;
        }
        return Math.min(...times);
    }
    /**
     * Get all metrics
     */
    getAllMetrics() {
        const result = {};
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
    clearMetrics() {
        this.metrics.clear();
        this.startTimes.clear();
    }
}
exports.PerformanceMonitor = PerformanceMonitor;
