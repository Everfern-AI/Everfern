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

import { Page, BrowserContext } from 'playwright';
import { AriaSnapshotResult, captureInteractiveElements } from './element-capture';

/**
 * Captures screenshot and element snapshot in parallel
 * Implements Req 3.1: Parallel screenshot and element snapshot capture
 */
export async function captureScreenshotAndElements(
  page: Page,
  screenshotConfig: { type: 'jpeg' | 'png'; quality?: number; fullPage?: boolean } = {
    type: 'jpeg',
    quality: 75,
    fullPage: false,
  },
): Promise<{
  screenshot: Buffer | null;
  elements: AriaSnapshotResult | null;
  elapsedMs: number;
}> {
  const startTime = Date.now();

  try {
    // Capture both in parallel
    const [screenshot, elements] = await Promise.all([
      page
        .screenshot({
          type: screenshotConfig.type as 'jpeg' | 'png',
          quality: screenshotConfig.quality,
          fullPage: screenshotConfig.fullPage,
        })
        .catch((err) => {
          console.warn('[Navis] Screenshot capture failed:', err);
          return null;
        }),
      captureInteractiveElements(page).catch((err) => {
        console.warn('[Navis] Element capture failed:', err);
        return null;
      }),
    ]);

    return {
      screenshot,
      elements,
      elapsedMs: Date.now() - startTime,
    };
  } catch (err) {
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
export async function executeActionsInParallel<T>(
  actions: Array<{ id: string; execute: () => Promise<T> }>,
  options: { maxConcurrent?: number } = {},
): Promise<Array<{ id: string; result: T | null; error: Error | null }>> {
  const { maxConcurrent = 4 } = options;

  // Pre-allocate results array to maintain original order
  const results: Array<{ id: string; result: T | null; error: Error | null }> =
    Array(actions.length).fill(null) as any;

  // Simple queue-based concurrency limiter
  let activeCount = 0;
  const queue: Array<{ index: number; action: { id: string; execute: () => Promise<T> } }> = [];

  // Add all actions to queue
  for (let i = 0; i < actions.length; i++) {
    queue.push({ index: i, action: actions[i] });
  }

  const processNext = async (): Promise<void> => {
    while (queue.length > 0) {
      const { index, action } = queue.shift()!;
      activeCount++;

      try {
        const result = await action.execute();
        results[index] = { id: action.id, result, error: null };
      } catch (error) {
        results[index] = {
          id: action.id,
          result: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
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
export async function openTabsInParallel(
  context: BrowserContext,
  urls: string[],
): Promise<Array<{ url: string; page: Page | null; error: Error | null }>> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        return { url, page, error: null };
      } catch (error) {
        return {
          url,
          page: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }),
  );

  return results;
}

/**
 * Background element capture during navigation
 * Implements Req 3.4: Background element capture during navigation
 *
 * Starts capturing elements in the background while other operations proceed,
 * hiding the capture latency behind other work.
 */
export class BackgroundElementCapture {
  private pendingCapture: Promise<AriaSnapshotResult | null> | null = null;
  private lastCaptureUrl: string | null = null;

  /**
   * Start background capture for a page
   */
  startCapture(page: Page): void {
    const currentUrl = page.url();

    // Only start if URL changed
    if (currentUrl === this.lastCaptureUrl) {
      return;
    }

    this.lastCaptureUrl = currentUrl;

    // Start capture in background
    this.pendingCapture = page
      .waitForLoadState('domcontentloaded', { timeout: 1000 })
      .then(() => captureInteractiveElements(page))
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
  async getCapture(): Promise<AriaSnapshotResult | null> {
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
  isReady(): boolean {
    return this.pendingCapture === null;
  }

  /**
   * Reset background capture state
   */
  reset(): void {
    this.pendingCapture = null;
    this.lastCaptureUrl = null;
  }
}

/**
 * Element prefetching during AI processing
 * Implements Req 3.5: Element prefetching during AI processing
 *
 * While the AI is processing the current decision, prefetch elements for the next page
 * to hide latency behind AI processing time.
 */
export class ElementPrefetcher {
  private prefetchQueue: Array<{ page: Page; priority: number }> = [];
  private prefetchResults = new Map<string, AriaSnapshotResult>();
  private isProcessing = false;

  /**
   * Queue a page for prefetching
   */
  queuePrefetch(page: Page, priority: number = 0): void {
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
  private async processPrefetchQueue(): Promise<void> {
    if (this.isProcessing || this.prefetchQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.prefetchQueue.length > 0) {
      const { page } = this.prefetchQueue.shift()!;
      const url = page.url();

      // Skip if already prefetched
      if (this.prefetchResults.has(url)) {
        continue;
      }

      try {
        const result = await captureInteractiveElements(page);
        this.prefetchResults.set(url, result);
        console.log(`[Navis] Prefetched elements for ${url}`);
      } catch (err) {
        console.warn(`[Navis] Prefetch failed for ${url}:`, err);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get prefetched elements for a page
   */
  getPrefetched(page: Page): AriaSnapshotResult | null {
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
  clear(): void {
    this.prefetchQueue = [];
    this.prefetchResults.clear();
    this.isProcessing = false;
  }
}

/**
 * Parallel processing coordinator
 * Manages all parallel operations and ensures they don't interfere
 */
export class ParallelProcessingCoordinator {
  private backgroundCapture: BackgroundElementCapture;
  private elementPrefetcher: ElementPrefetcher;

  constructor() {
    this.backgroundCapture = new BackgroundElementCapture();
    this.elementPrefetcher = new ElementPrefetcher();
  }

  getBackgroundCapture(): BackgroundElementCapture {
    return this.backgroundCapture;
  }

  getElementPrefetcher(): ElementPrefetcher {
    return this.elementPrefetcher;
  }

  reset(): void {
    this.backgroundCapture.reset();
    this.elementPrefetcher.clear();
  }
}
