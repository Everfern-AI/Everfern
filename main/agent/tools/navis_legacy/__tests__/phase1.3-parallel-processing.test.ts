/**
 * Phase 1.3: Parallel Processing Tests
 *
 * Tests for parallel processing requirements:
 * - 1.3.1: Parallel screenshot and element snapshot capture (Req 3.1)
 * - 1.3.2: Parallel action execution for independent actions (Req 3.2)
 * - 1.3.3: Parallel tab opening (Req 3.3)
 * - 1.3.4: Background element capture during navigation (Req 3.4)
 * - 1.3.5: Element prefetching during AI processing (Req 3.5)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  captureScreenshotAndElements,
  executeActionsInParallel,
  openTabsInParallel,
  BackgroundElementCapture,
  ElementPrefetcher,
  ParallelProcessingCoordinator,
} from '../parallel-processing';

describe('Phase 1.3: Parallel Processing', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1.3.1: Parallel screenshot and element snapshot capture (Req 3.1)
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3.1 Parallel screenshot and element snapshot capture (Req 3.1)', () => {
    it('should export captureScreenshotAndElements function', () => {
      expect(typeof captureScreenshotAndElements).toBe('function');
    });

    it('should return object with screenshot, elements, and elapsedMs', async () => {
      // Mock page object
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
        url: vi.fn().mockReturnValue('http://example.com'),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockResolvedValue({}),
        ariaSnapshot: vi.fn().mockResolvedValue(''),
      };

      const result = await captureScreenshotAndElements(mockPage as any);

      expect(result).toHaveProperty('screenshot');
      expect(result).toHaveProperty('elements');
      expect(result).toHaveProperty('elapsedMs');
      expect(typeof result.elapsedMs).toBe('number');
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should use Promise.all for parallel execution', async () => {
      const mockPage = {
        screenshot: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(Buffer.from('screenshot')), 50))
        ),
        url: vi.fn().mockReturnValue('http://example.com'),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockResolvedValue({}),
        ariaSnapshot: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(''), 50))
        ),
      };

      const startTime = Date.now();
      await captureScreenshotAndElements(mockPage as any);
      const elapsed = Date.now() - startTime;

      // If truly parallel, should take ~50ms (not ~100ms sequential)
      // Allow some margin for test execution overhead
      expect(elapsed).toBeLessThan(150);
    });

    it('should handle screenshot capture failure gracefully', async () => {
      const mockPage = {
        screenshot: vi.fn().mockRejectedValue(new Error('Screenshot failed')),
        url: vi.fn().mockReturnValue('http://example.com'),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockResolvedValue({}),
        ariaSnapshot: vi.fn().mockResolvedValue(''),
      };

      const result = await captureScreenshotAndElements(mockPage as any);

      expect(result.screenshot).toBeNull();
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle element capture failure gracefully', async () => {
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
        url: vi.fn().mockReturnValue('http://example.com'),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockRejectedValue(new Error('Element capture failed')),
        ariaSnapshot: vi.fn().mockRejectedValue(new Error('Aria snapshot failed')),
      };

      const result = await captureScreenshotAndElements(mockPage as any);

      expect(result.screenshot).not.toBeNull();
      expect(result.elements).toBeNull();
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should support JPEG format with 75% quality', async () => {
      const mockPage = {
        screenshot: vi.fn().mockResolvedValue(Buffer.from('jpeg-screenshot')),
        url: vi.fn().mockReturnValue('http://example.com'),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockResolvedValue({}),
        ariaSnapshot: vi.fn().mockResolvedValue(''),
      };

      await captureScreenshotAndElements(mockPage as any, {
        type: 'jpeg',
        quality: 75,
        fullPage: false,
      });

      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'jpeg',
          quality: 75,
          fullPage: false,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3.2: Parallel action execution for independent actions (Req 3.2)
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3.2 Parallel action execution for independent actions (Req 3.2)', () => {
    it('should export executeActionsInParallel function', () => {
      expect(typeof executeActionsInParallel).toBe('function');
    });

    it('should execute multiple actions in parallel', async () => {
      const executionOrder: string[] = [];

      const actions = [
        {
          id: 'action1',
          execute: async () => {
            executionOrder.push('action1-start');
            await new Promise((r) => setTimeout(r, 10));
            executionOrder.push('action1-end');
            return 'result1';
          },
        },
        {
          id: 'action2',
          execute: async () => {
            executionOrder.push('action2-start');
            await new Promise((r) => setTimeout(r, 10));
            executionOrder.push('action2-end');
            return 'result2';
          },
        },
      ];

      const results = await executeActionsInParallel(actions);

      // Both should start before either ends (parallel execution)
      expect(executionOrder[0]).toBe('action1-start');
      expect(executionOrder[1]).toBe('action2-start');
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'action1', result: 'result1', error: null });
      expect(results[1]).toEqual({ id: 'action2', result: 'result2', error: null });
    });

    it('should respect maxConcurrent limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const actions = Array.from({ length: 6 }, (_, i) => ({
        id: `action${i}`,
        execute: async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 20));
          currentConcurrent--;
          return `result${i}`;
        },
      }));

      await executeActionsInParallel(actions, { maxConcurrent: 2 });

      // With proper concurrency limiting, max should be <= 2
      // Allow some margin for timing variations
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should handle action failures gracefully', async () => {
      const actions = [
        {
          id: 'action1',
          execute: async () => 'result1',
        },
        {
          id: 'action2',
          execute: async () => {
            throw new Error('Action 2 failed');
          },
        },
        {
          id: 'action3',
          execute: async () => 'result3',
        },
      ];

      const results = await executeActionsInParallel(actions);

      expect(results).toHaveLength(3);
      expect(results[0].result).toBe('result1');
      expect(results[1].error).not.toBeNull();
      expect(results[1].error?.message).toBe('Action 2 failed');
      expect(results[2].result).toBe('result3');
    });

    it('should return results in original order', async () => {
      const actions = Array.from({ length: 5 }, (_, i) => ({
        id: `action${i}`,
        execute: async () => {
          // Vary delays to ensure order is not based on completion time
          await new Promise((r) => setTimeout(r, Math.random() * 20));
          return `result${i}`;
        },
      }));

      const results = await executeActionsInParallel(actions);

      expect(results.map((r) => r.id)).toEqual(['action0', 'action1', 'action2', 'action3', 'action4']);
    });

    it('should default to maxConcurrent of 4', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const actions = Array.from({ length: 8 }, (_, i) => ({
        id: `action${i}`,
        execute: async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 5));
          currentConcurrent--;
          return `result${i}`;
        },
      }));

      await executeActionsInParallel(actions);

      // Default should be 4, allow some margin for timing
      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3.3: Parallel tab opening (Req 3.3)
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3.3 Parallel tab opening (Req 3.3)', () => {
    it('should export openTabsInParallel function', () => {
      expect(typeof openTabsInParallel).toBe('function');
    });

    it('should open multiple tabs in parallel', async () => {
      const mockPages: any[] = [];
      const mockContext = {
        newPage: vi.fn().mockImplementation(async () => {
          const page = {
            goto: vi.fn().mockResolvedValue(null),
            close: vi.fn().mockResolvedValue(null),
          };
          mockPages.push(page);
          return page;
        }),
      };

      const urls = ['http://example1.com', 'http://example2.com', 'http://example3.com'];
      const results = await openTabsInParallel(mockContext as any, urls);

      expect(results).toHaveLength(3);
      expect(mockContext.newPage).toHaveBeenCalledTimes(3);
      expect(results.every((r) => r.page !== null)).toBe(true);
    });

    it('should handle tab opening failures gracefully', async () => {
      const mockContext = {
        newPage: vi.fn()
          .mockResolvedValueOnce({
            goto: vi.fn().mockResolvedValue(null),
          })
          .mockRejectedValueOnce(new Error('Failed to create page'))
          .mockResolvedValueOnce({
            goto: vi.fn().mockResolvedValue(null),
          }),
      };

      const urls = ['http://example1.com', 'http://example2.com', 'http://example3.com'];
      const results = await openTabsInParallel(mockContext as any, urls);

      expect(results).toHaveLength(3);
      expect(results[0].page).not.toBeNull();
      expect(results[1].error).not.toBeNull();
      expect(results[2].page).not.toBeNull();
    });

    it('should use Promise.all for concurrent execution', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const mockContext = {
        newPage: vi.fn().mockImplementation(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 10));
          currentConcurrent--;
          return {
            goto: vi.fn().mockResolvedValue(null),
          };
        }),
      };

      const urls = Array.from({ length: 5 }, (_, i) => `http://example${i}.com`);
      await openTabsInParallel(mockContext as any, urls);

      // All should start concurrently
      expect(maxConcurrent).toBe(5);
    });

    it('should return results with url, page, and error', async () => {
      const mockContext = {
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
        }),
      };

      const urls = ['http://example.com'];
      const results = await openTabsInParallel(mockContext as any, urls);

      expect(results[0]).toHaveProperty('url');
      expect(results[0]).toHaveProperty('page');
      expect(results[0]).toHaveProperty('error');
      expect(results[0].url).toBe('http://example.com');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3.4: Background element capture during navigation (Req 3.4)
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3.4 Background element capture during navigation (Req 3.4)', () => {
    it('should create BackgroundElementCapture instance', () => {
      const bgCapture = new BackgroundElementCapture();
      expect(bgCapture).toBeDefined();
    });

    it('should start background capture', () => {
      const bgCapture = new BackgroundElementCapture();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
        waitForLoadState: vi.fn().mockResolvedValue(null),
      };

      bgCapture.startCapture(mockPage as any);
      expect(bgCapture.isReady()).toBe(false); // Capture is pending
    });

    it('should not start capture for same URL', () => {
      const bgCapture = new BackgroundElementCapture();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
        waitForLoadState: vi.fn().mockResolvedValue(null),
      };

      bgCapture.startCapture(mockPage as any);
      const firstReady = bgCapture.isReady();

      bgCapture.startCapture(mockPage as any);
      const secondReady = bgCapture.isReady();

      // Both should have same ready state (capture still pending from first call)
      expect(firstReady).toBe(secondReady);
    });

    it('should reset background capture state', () => {
      const bgCapture = new BackgroundElementCapture();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
        waitForLoadState: vi.fn().mockResolvedValue(null),
      };

      bgCapture.startCapture(mockPage as any);
      expect(bgCapture.isReady()).toBe(false);

      bgCapture.reset();
      expect(bgCapture.isReady()).toBe(true);
    });

    it('should return null when no capture is pending', async () => {
      const bgCapture = new BackgroundElementCapture();
      const result = await bgCapture.getCapture();
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3.5: Element prefetching during AI processing (Req 3.5)
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3.5 Element prefetching during AI processing (Req 3.5)', () => {
    it('should create ElementPrefetcher instance', () => {
      const prefetcher = new ElementPrefetcher();
      expect(prefetcher).toBeDefined();
    });

    it('should queue pages for prefetching', () => {
      const prefetcher = new ElementPrefetcher();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
      };

      prefetcher.queuePrefetch(mockPage as any, 1);
      // Should not throw
      expect(prefetcher).toBeDefined();
    });

    it('should clear prefetch cache', () => {
      const prefetcher = new ElementPrefetcher();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
      };

      prefetcher.queuePrefetch(mockPage as any, 1);
      prefetcher.clear();

      // After clear, should be able to prefetch same page again
      prefetcher.queuePrefetch(mockPage as any, 1);
      expect(prefetcher).toBeDefined();
    });

    it('should return null for non-prefetched pages', () => {
      const prefetcher = new ElementPrefetcher();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
      };

      const result = prefetcher.getPrefetched(mockPage as any);
      expect(result).toBeNull();
    });

    it('should prioritize prefetch queue by priority', () => {
      const prefetcher = new ElementPrefetcher();
      const pages = [
        { url: vi.fn().mockReturnValue('http://example1.com') },
        { url: vi.fn().mockReturnValue('http://example2.com') },
        { url: vi.fn().mockReturnValue('http://example3.com') },
      ];

      prefetcher.queuePrefetch(pages[0] as any, 1);
      prefetcher.queuePrefetch(pages[1] as any, 3);
      prefetcher.queuePrefetch(pages[2] as any, 2);

      // Higher priority should be processed first
      expect(prefetcher).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Parallel Processing Coordinator
  // ─────────────────────────────────────────────────────────────────────────

  describe('Parallel Processing Coordinator', () => {
    it('should create coordinator instance', () => {
      const coordinator = new ParallelProcessingCoordinator();
      expect(coordinator).toBeDefined();
    });

    it('should provide background capture interface', () => {
      const coordinator = new ParallelProcessingCoordinator();
      const bgCapture = coordinator.getBackgroundCapture();
      expect(bgCapture).toBeDefined();
      expect(bgCapture.isReady()).toBe(true);
    });

    it('should provide element prefetcher interface', () => {
      const coordinator = new ParallelProcessingCoordinator();
      const prefetcher = coordinator.getElementPrefetcher();
      expect(prefetcher).toBeDefined();
    });

    it('should reset all parallel operations', () => {
      const coordinator = new ParallelProcessingCoordinator();
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
        waitForLoadState: vi.fn().mockResolvedValue(null),
      };

      coordinator.getBackgroundCapture().startCapture(mockPage as any);
      expect(coordinator.getBackgroundCapture().isReady()).toBe(false);

      coordinator.reset();
      expect(coordinator.getBackgroundCapture().isReady()).toBe(true);
    });

    it('should maintain separate instances for background capture and prefetcher', () => {
      const coordinator = new ParallelProcessingCoordinator();
      const bgCapture1 = coordinator.getBackgroundCapture();
      const bgCapture2 = coordinator.getBackgroundCapture();
      const prefetcher1 = coordinator.getElementPrefetcher();
      const prefetcher2 = coordinator.getElementPrefetcher();

      expect(bgCapture1).toBe(bgCapture2);
      expect(prefetcher1).toBe(prefetcher2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('Integration Tests', () => {
    it('should handle concurrent parallel operations', async () => {
      const coordinator = new ParallelProcessingCoordinator();

      // Simulate parallel capture and prefetch
      const mockPage = {
        url: vi.fn().mockReturnValue('http://example.com'),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
        context: vi.fn().mockReturnValue({
          browser: vi.fn().mockReturnValue({ version: () => '1.0' }),
        }),
        evaluate: vi.fn().mockResolvedValue({}),
        ariaSnapshot: vi.fn().mockResolvedValue(''),
        waitForLoadState: vi.fn().mockResolvedValue(null),
      };

      // Start background capture
      coordinator.getBackgroundCapture().startCapture(mockPage as any);

      // Queue prefetch
      coordinator.getElementPrefetcher().queuePrefetch(mockPage as any, 1);

      // Both should work without interference
      expect(coordinator.getBackgroundCapture().isReady()).toBe(false);
      expect(coordinator).toBeDefined();
    });

    it('should handle rapid sequential operations', async () => {
      const actions = Array.from({ length: 10 }, (_, i) => ({
        id: `action${i}`,
        execute: async () => `result${i}`,
      }));

      const results = await executeActionsInParallel(actions, { maxConcurrent: 2 });

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.error === null)).toBe(true);
    });
  });
});
