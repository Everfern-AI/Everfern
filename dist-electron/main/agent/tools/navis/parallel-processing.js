"use strict";
/**
 * Navis — Parallel Processing Engine
 *
 * Implements concurrent operations for performance:
 * - Parallel screenshot and element snapshot capture (Req 3.1)
 * - Parallel action execution for independent actions (Req 3.2)
 * - Parallel tab opening (Req 3.3)
 * - Background element capture during navigation (Req 3.4)
 * - Element prefetching during AI processing (Req 3.5)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParallelProcessingCoordinator = exports.ElementPrefetcher = exports.BackgroundElementCapture = void 0;
exports.captureScreenshotAndElements = captureScreenshotAndElements;
exports.executeActionsInParallel = executeActionsInParallel;
exports.openTabsInParallel = openTabsInParallel;
const element_capture_1 = require("./element-capture");
/**
 * Captures screenshot and element snapshot in parallel
 * Implements Req 3.1: Parallel screenshot and element snapshot capture
 */
async function captureScreenshotAndElements(page, screenshotConfig = {
    type: 'jpeg',
    quality: 75,
    fullPage: false,
}) {
    const startTime = Date.now();
    try {
        // Capture both in parallel
        const [screenshot, elements] = await Promise.all([
            page
                .screenshot({
                type: screenshotConfig.type,
                quality: screenshotConfig.quality,
                fullPage: screenshotConfig.fullPage,
            })
                .catch((err) => {
                console.warn('[Navis] Screenshot capture failed:', err);
                return null;
            }),
            (0, element_capture_1.captureInteractiveElements)(page).catch((err) => {
                console.warn('[Navis] Element capture failed:', err);
                return null;
            }),
        ]);
        return {
            screenshot,
            elements,
            elapsedMs: Date.now() - startTime,
        };
    }
    catch (err) {
        console.error('[Navis] Parallel capture failed:', err);
        return {
            screenshot: null,
            elements: null,
            elapsedMs: Date.now() - startTime,
        };
    }
}
/**
 * Executes multiple independent actions in parallel
 * Implements Req 3.2: Parallel action execution for independent actions
 *
 * Maintains original order of results while respecting maxConcurrent limit.
 */
async function executeActionsInParallel(actions, options = {}) {
    const { maxConcurrent = 4 } = options;
    // Pre-allocate results array to maintain original order
    const results = Array(actions.length).fill(null);
    // Simple queue-based concurrency limiter
    let activeCount = 0;
    const queue = [];
    // Add all actions to queue
    for (let i = 0; i < actions.length; i++) {
        queue.push({ index: i, action: actions[i] });
    }
    const processNext = async () => {
        while (queue.length > 0) {
            const { index, action } = queue.shift();
            activeCount++;
            try {
                const result = await action.execute();
                results[index] = { id: action.id, result, error: null };
            }
            catch (error) {
                results[index] = {
                    id: action.id,
                    result: null,
                    error: error instanceof Error ? error : new Error(String(error)),
                };
            }
            finally {
                activeCount--;
            }
        }
    };
    // Start maxConcurrent workers
    const workers = Array.from({ length: Math.min(maxConcurrent, actions.length) }, () => processNext());
    await Promise.all(workers);
    return results;
}
/**
 * Opens multiple tabs in parallel
 * Implements Req 3.3: Parallel tab opening
 */
async function openTabsInParallel(context, urls) {
    const results = await Promise.all(urls.map(async (url) => {
        try {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => { });
            return { url, page, error: null };
        }
        catch (error) {
            return {
                url,
                page: null,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }));
    return results;
}
/**
 * Background element capture during navigation
 * Implements Req 3.4: Background element capture during navigation
 *
 * Starts capturing elements in the background while other operations proceed,
 * hiding the capture latency behind other work.
 */
class BackgroundElementCapture {
    pendingCapture = null;
    lastCaptureUrl = null;
    /**
     * Start background capture for a page
     */
    startCapture(page) {
        const currentUrl = page.url();
        // Only start if URL changed
        if (currentUrl === this.lastCaptureUrl) {
            return;
        }
        this.lastCaptureUrl = currentUrl;
        // Start capture in background
        this.pendingCapture = page
            .waitForLoadState('domcontentloaded', { timeout: 1000 })
            .then(() => (0, element_capture_1.captureInteractiveElements)(page))
            .then((result) => {
            console.log(`[Navis] Background element capture complete for ${currentUrl}`);
            return result;
        })
            .catch((err) => {
            console.warn('[Navis] Background element capture failed:', err);
            return null;
        });
    }
    /**
     * Get the result of background capture (waits if still pending)
     */
    async getCapture() {
        if (!this.pendingCapture) {
            return null;
        }
        const result = await this.pendingCapture;
        this.pendingCapture = null;
        return result;
    }
    /**
     * Check if capture is ready without waiting
     */
    isReady() {
        return this.pendingCapture === null;
    }
    /**
     * Reset background capture state
     */
    reset() {
        this.pendingCapture = null;
        this.lastCaptureUrl = null;
    }
}
exports.BackgroundElementCapture = BackgroundElementCapture;
/**
 * Element prefetching during AI processing
 * Implements Req 3.5: Element prefetching during AI processing
 *
 * While the AI is processing the current decision, prefetch elements for the next page
 * to hide latency behind AI processing time.
 */
class ElementPrefetcher {
    prefetchQueue = [];
    prefetchResults = new Map();
    isProcessing = false;
    /**
     * Queue a page for prefetching
     */
    queuePrefetch(page, priority = 0) {
        this.prefetchQueue.push({ page, priority });
        this.prefetchQueue.sort((a, b) => b.priority - a.priority);
        // Start processing if not already running
        if (!this.isProcessing) {
            this.processPrefetchQueue();
        }
    }
    /**
     * Process prefetch queue in background
     */
    async processPrefetchQueue() {
        if (this.isProcessing || this.prefetchQueue.length === 0) {
            return;
        }
        this.isProcessing = true;
        while (this.prefetchQueue.length > 0) {
            const { page } = this.prefetchQueue.shift();
            const url = page.url();
            // Skip if already prefetched
            if (this.prefetchResults.has(url)) {
                continue;
            }
            try {
                const result = await (0, element_capture_1.captureInteractiveElements)(page);
                this.prefetchResults.set(url, result);
                console.log(`[Navis] Prefetched elements for ${url}`);
            }
            catch (err) {
                console.warn(`[Navis] Prefetch failed for ${url}:`, err);
            }
        }
        this.isProcessing = false;
    }
    /**
     * Get prefetched elements for a page
     */
    getPrefetched(page) {
        const url = page.url();
        const result = this.prefetchResults.get(url) || null;
        if (result) {
            this.prefetchResults.delete(url);
            console.log(`[Navis] Using prefetched elements for ${url}`);
        }
        return result;
    }
    /**
     * Clear prefetch cache
     */
    clear() {
        this.prefetchQueue = [];
        this.prefetchResults.clear();
        this.isProcessing = false;
    }
}
exports.ElementPrefetcher = ElementPrefetcher;
/**
 * Parallel processing coordinator
 * Manages all parallel operations and ensures they don't interfere
 */
class ParallelProcessingCoordinator {
    backgroundCapture;
    elementPrefetcher;
    constructor() {
        this.backgroundCapture = new BackgroundElementCapture();
        this.elementPrefetcher = new ElementPrefetcher();
    }
    getBackgroundCapture() {
        return this.backgroundCapture;
    }
    getElementPrefetcher() {
        return this.elementPrefetcher;
    }
    reset() {
        this.backgroundCapture.reset();
        this.elementPrefetcher.clear();
    }
}
exports.ParallelProcessingCoordinator = ParallelProcessingCoordinator;
