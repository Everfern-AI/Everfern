"use strict";
/**
 * Navis — Metrics and Logging Module
 *
 * Tracks hybrid click performance metrics and provides analytics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalMetricsCollector = exports.MetricsCollector = void 0;
class MetricsCollector {
    metrics = [];
    maxMetrics = 1000; // Keep last 1000 metrics
    /**
     * Log a hybrid click attempt
     */
    logHybridClick(metrics) {
        this.metrics.push(metrics);
        // Trim old metrics if we exceed max
        if (this.metrics.length > this.maxMetrics) {
            this.metrics = this.metrics.slice(-this.maxMetrics);
        }
        console.log('[NAVIS Metrics]', JSON.stringify(metrics));
    }
    /**
     * Get all metrics
     */
    getMetrics() {
        return [...this.metrics];
    }
    /**
     * Get overall success rate
     */
    getSuccessRate() {
        if (this.metrics.length === 0)
            return 0;
        const successful = this.metrics.filter(m => m.success).length;
        return successful / this.metrics.length;
    }
    /**
     * Get DOM-based click success rate
     */
    getDOMSuccessRate() {
        const domClicks = this.metrics.filter(m => m.method === 'dom');
        if (domClicks.length === 0)
            return 0;
        const successful = domClicks.filter(m => m.success).length;
        return successful / domClicks.length;
    }
    /**
     * Get pixel-based click success rate
     */
    getPixelSuccessRate() {
        const pixelClicks = this.metrics.filter(m => m.method === 'pixel');
        if (pixelClicks.length === 0)
            return 0;
        const successful = pixelClicks.filter(m => m.success).length;
        return successful / pixelClicks.length;
    }
    /**
     * Get average vision confidence
     */
    getAverageConfidence() {
        if (this.metrics.length === 0)
            return 0;
        const sum = this.metrics.reduce((acc, m) => acc + m.visionConfidence, 0);
        return sum / this.metrics.length;
    }
    /**
     * Get average duration
     */
    getAverageDuration() {
        if (this.metrics.length === 0)
            return 0;
        const sum = this.metrics.reduce((acc, m) => acc + m.duration, 0);
        return sum / this.metrics.length;
    }
    /**
     * Get DOM found rate (how often DOM query succeeds)
     */
    getDOMFoundRate() {
        if (this.metrics.length === 0)
            return 0;
        const found = this.metrics.filter(m => m.domFound).length;
        return found / this.metrics.length;
    }
    /**
     * Get fallback rate (how often we fall back to pixel click)
     */
    getFallbackRate() {
        if (this.metrics.length === 0)
            return 0;
        const fallbacks = this.metrics.filter(m => m.method === 'pixel').length;
        return fallbacks / this.metrics.length;
    }
    /**
     * Get metrics summary
     */
    getSummary() {
        return {
            totalClicks: this.metrics.length,
            successRate: this.getSuccessRate(),
            domSuccessRate: this.getDOMSuccessRate(),
            pixelSuccessRate: this.getPixelSuccessRate(),
            averageConfidence: this.getAverageConfidence(),
            averageDuration: this.getAverageDuration(),
            domFoundRate: this.getDOMFoundRate(),
            fallbackRate: this.getFallbackRate(),
        };
    }
    /**
     * Clear all metrics
     */
    clear() {
        this.metrics = [];
    }
    /**
     * Export metrics to JSON
     */
    exportJSON() {
        return JSON.stringify({
            metrics: this.metrics,
            summary: this.getSummary(),
            exportedAt: new Date().toISOString(),
        }, null, 2);
    }
}
exports.MetricsCollector = MetricsCollector;
// Global metrics collector instance
exports.globalMetricsCollector = new MetricsCollector();
