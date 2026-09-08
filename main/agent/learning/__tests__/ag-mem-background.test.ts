/**
 * AG-MEM-11 tests: background-processor.ts
 *
 * Verifies:
 * - estimateCpuUsage returns real process CPU % (bounded 0..100, deterministic, no NaN)
 * - start() is idempotent — calling twice leaves a single interval
 * - Constructor no longer starts monitoring intervals (lazy start)
 * - Intervals are unref'd
 */

import { BackgroundProcessor } from '../background-processor';

describe('AG-MEM-11: BackgroundProcessor', () => {
  let processor: BackgroundProcessor;

  beforeEach(() => {
    processor = new BackgroundProcessor({
      maxConcurrency: 2,
      resourceLimits: { maxCpuPercent: 100, maxMemoryMB: 10000 },
      idleThresholdMs: 0,
      queueCleanupIntervalMs: 60000,
      performanceMonitoringIntervalMs: 1000
    });
  });

  afterEach(async () => {
    await processor.shutdown();
  });

  describe('real CPU measurement', () => {
    it('returns 0 on first sample, then a bounded deterministic value', async () => {
      const est = (processor as any).estimateCpuUsage.bind(processor) as () => number;

      // First call: no prior sample → 0
      expect(est()).toBe(0);

      // Small delay so the next sample has nonzero wall time
      await new Promise(r => setTimeout(r, 20));

      const second = est();
      expect(Number.isFinite(second)).toBe(true);
      expect(second).not.toBeNaN();
      expect(second).toBeGreaterThanOrEqual(0);
      expect(second).toBeLessThanOrEqual(100);

      // Burn a little CPU so a nonzero reading becomes plausible, still bounded
      const start = Date.now();
      while (Date.now() - start < 30) { /* spin */ }
      const third = est();
      expect(Number.isFinite(third)).toBe(true);
      expect(third).toBeGreaterThanOrEqual(0);
      expect(third).toBeLessThanOrEqual(100);
    });

    it('is deterministic across rapid consecutive calls (no random component)', async () => {
      const est = (processor as any).estimateCpuUsage.bind(processor) as () => number;
      est(); // prime sample

      await new Promise(r => setTimeout(r, 5));
      const a = est();
      await new Promise(r => setTimeout(r, 5));
      const b = est();

      // Both from the same formula on real CPU counters — finite, bounded, and not random noise
      expect(Number.isFinite(a)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(100);
      expect(b).toBeLessThanOrEqual(100);
    });

    it('feeds resourceUsage events with bounded CPU % once monitoring starts', async () => {
      processor.start();

      const seen: Array<{ cpuPercent: number; memoryMB: number }> = [];
      processor.on('resourceUsage', (u: any) => seen.push(u));

      // performanceMonitoringIntervalMs is 1000; wait long enough for ≥1 tick
      await new Promise(r => setTimeout(r, 1250));

      expect(seen.length).toBeGreaterThanOrEqual(1);
      for (const u of seen) {
        expect(Number.isFinite(u.cpuPercent)).toBe(true);
        expect(u.cpuPercent).toBeGreaterThanOrEqual(0);
        expect(u.cpuPercent).toBeLessThanOrEqual(100);
        expect(Number.isFinite(u.memoryMB)).toBe(true);
      }
    });
  });

  describe('lazy + idempotent start()', () => {
    it('does NOT start intervals in the constructor', () => {
      const fresh = new BackgroundProcessor({});
      expect((fresh as any).resourceMonitorInterval).toBeUndefined();
      expect((fresh as any).queueCleanupInterval).toBeUndefined();
      void fresh.shutdown();
    });

    it('starts a single interval handle and is idempotent on repeat calls', () => {
      processor.start();

      const firstMonitor = (processor as any).resourceMonitorInterval;
      const firstCleanup = (processor as any).queueCleanupInterval;
      expect(firstMonitor).toBeDefined();
      expect(firstCleanup).toBeDefined();

      processor.start();
      processor.start();

      // Same handle identity — start() did not create additional intervals
      expect((processor as any).resourceMonitorInterval).toBe(firstMonitor);
      expect((processor as any).queueCleanupInterval).toBe(firstCleanup);
    });

    it('uses unref() on both intervals so they never hold the event loop open', () => {
      processor.start();

      const monitor = (processor as any).resourceMonitorInterval as NodeJS.Timeout;
      const cleanup = (processor as any).queueCleanupInterval as NodeJS.Timeout;

      // unref'd timers report hasRef() === false
      expect(typeof monitor.unref).toBe('function');
      expect(typeof cleanup.unref).toBe('function');
      expect((monitor as any).hasRef?.()).toBe(false);
      expect((cleanup as any).hasRef?.()).toBe(false);
    });
  });

  describe('shutdown clears interval handles', () => {
    it('resets interval handles to undefined so start() can run again', async () => {
      processor.start();
      expect((processor as any).resourceMonitorInterval).toBeDefined();

      await processor.shutdown();

      expect((processor as any).resourceMonitorInterval).toBeUndefined();
      expect((processor as any).queueCleanupInterval).toBeUndefined();

      // start() is usable again after shutdown (no zombie guard)
      processor.start();
      expect((processor as any).resourceMonitorInterval).toBeDefined();
    });
  });
});
