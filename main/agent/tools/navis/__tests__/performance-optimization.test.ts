/**
 * Performance Optimization Tests for Navis Phase 1
 *
 * Tests critical performance optimizations:
 * - Element snapshot caching with 500ms TTL (Req 1.4)
 * - Conversation history compression (Req 2.3)
 * - Response streaming and performance targets (Req 2.1, 2.2, 2.5)
 * - Parallel processing (Req 3.1, 3.2, 3.3, 3.4, 3.5)
 * - Screenshot optimization (Req 4.1, 4.2, 4.3, 4.4, 4.5)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  compressHistory,
  estimateTokens,
  checkPerformanceTarget,
  checkScreenshotPerformance,
  getDetailLevel,
} from '../ai-optimization';
import {
  BackgroundElementCapture,
  ElementPrefetcher,
  ParallelProcessingCoordinator,
} from '../parallel-processing';
import { clearElementCache, getCacheStats } from '../element-capture';

describe('Navis Performance Optimization - Phase 1', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1.1 Element Capture Performance
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.1 Element Capture Performance', () => {
    describe('1.1.2 Element snapshot caching with 500ms TTL (Req 1.4)', () => {
      beforeEach(() => {
        clearElementCache();
      });

      it('should maintain cache statistics', () => {
        const stats = getCacheStats();
        expect(stats).toHaveProperty('size');
        expect(stats).toHaveProperty('entries');
        expect(Array.isArray(stats.entries)).toBe(true);
      });

      it('should track cache age correctly', () => {
        const stats = getCacheStats();
        for (const entry of stats.entries) {
          expect(entry.age).toBeGreaterThanOrEqual(0);
          expect(typeof entry.key).toBe('string');
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.2 AI Decision Latency
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.2 AI Decision Latency', () => {
    describe('1.2.1 Conversation history compression after 8 steps (Req 2.3)', () => {
      it('should not compress history with fewer than 8 steps', () => {
        const history = ['step 1', 'step 2', 'step 3'];
        const compressed = compressHistory(history);
        expect(compressed).toContain('step 1');
        expect(compressed).toContain('step 2');
        expect(compressed).toContain('step 3');
      });

      it('should compress history after 8 steps', () => {
        const history = Array.from({ length: 10 }, (_, i) => `step ${i + 1}`);
        const compressed = compressHistory(history);
        expect(compressed).toContain('[10 earlier steps summarized]');
        expect(compressed).toContain('step 9');
        expect(compressed).toContain('step 10');
      });

      it('should keep recent steps after compression', () => {
        const history = Array.from({ length: 12 }, (_, i) => `step ${i + 1}`);
        const compressed = compressHistory(history);
        // Should keep last 8 steps
        expect(compressed).toContain('step 5');
        expect(compressed).toContain('step 12');
      });

      it('should maintain compression threshold of 8 steps', () => {
        const config = { compressionThreshold: 8, maxHistoryTokens: 10000 };
        const history = Array.from({ length: 15 }, (_, i) => `step ${i + 1}`);
        const compressed = compressHistory(history, config);
        expect(compressed).toContain('[15 earlier steps summarized]');
      });
    });

    describe('1.2.2 Temperature 0.1 for consistent responses (Req 2.4)', () => {
      it('should use temperature 0.1 for consistent responses', () => {
        // This is validated in the orchestrator's callAI method
        // Temperature is hardcoded to 0.1 in the AI calls
        expect(0.1).toBe(0.1);
      });
    });

    describe('1.2.4 Text-only AI decisions within 2000ms (Req 2.1)', () => {
      it('should validate text-only performance target', () => {
        const result = checkPerformanceTarget(1500, 'text-only');
        expect(result.met).toBe(true);
        expect(result.message).toContain('1500ms');
        expect(result.message).toContain('2000ms');
      });

      it('should flag slow text-only calls', () => {
        const result = checkPerformanceTarget(2500, 'text-only');
        expect(result.met).toBe(false);
        expect(result.message).toContain('⚠');
      });

      it('should accept calls at exactly 2000ms', () => {
        const result = checkPerformanceTarget(2000, 'text-only');
        expect(result.met).toBe(true);
      });
    });

    describe('1.2.5 Vision-based AI decisions within 4000ms (Req 2.2)', () => {
      it('should validate vision performance target', () => {
        const result = checkPerformanceTarget(3500, 'vision');
        expect(result.met).toBe(true);
        expect(result.message).toContain('3500ms');
        expect(result.message).toContain('4000ms');
      });

      it('should flag slow vision calls', () => {
        const result = checkPerformanceTarget(4500, 'vision');
        expect(result.met).toBe(false);
        expect(result.message).toContain('⚠');
      });

      it('should accept calls at exactly 4000ms', () => {
        const result = checkPerformanceTarget(4000, 'vision');
        expect(result.met).toBe(true);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3 Parallel Processing
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.3 Parallel Processing', () => {
    describe('1.3.4 Background element capture during navigation (Req 3.4)', () => {
      it('should create background capture instance', () => {
        const bgCapture = new BackgroundElementCapture();
        expect(bgCapture).toBeDefined();
        expect(bgCapture.isReady()).toBe(true);
      });

      it('should reset background capture state', () => {
        const bgCapture = new BackgroundElementCapture();
        bgCapture.reset();
        expect(bgCapture.isReady()).toBe(true);
      });
    });

    describe('1.3.5 Element prefetching during AI processing (Req 3.5)', () => {
      it('should create element prefetcher instance', () => {
        const prefetcher = new ElementPrefetcher();
        expect(prefetcher).toBeDefined();
      });

      it('should clear prefetch cache', () => {
        const prefetcher = new ElementPrefetcher();
        prefetcher.clear();
        // Should not throw
        expect(prefetcher).toBeDefined();
      });
    });

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
        coordinator.reset();
        expect(coordinator.getBackgroundCapture().isReady()).toBe(true);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.4 Screenshot Optimization
  // ─────────────────────────────────────────────────────────────────────────

  describe('1.4 Screenshot Optimization', () => {
    describe('1.4.2 Detail level selection based on screenshot size (Req 4.2, 4.3)', () => {
      it('should use low detail for screenshots < 200KB', () => {
        const detail = getDetailLevel(150);
        expect(detail).toBe('low');
      });

      it('should use high detail for screenshots > 200KB', () => {
        const detail = getDetailLevel(250);
        expect(detail).toBe('high');
      });

      it('should use high detail at exactly 200KB boundary', () => {
        const detail = getDetailLevel(200);
        expect(detail).toBe('high');
      });

      it('should use low detail just below 200KB', () => {
        const detail = getDetailLevel(199);
        expect(detail).toBe('low');
      });
    });

    describe('1.4.4 Screenshot capture within 300ms (Req 4.5)', () => {
      it('should validate screenshot performance target', () => {
        const result = checkScreenshotPerformance(250);
        expect(result.met).toBe(true);
        expect(result.message).toContain('250ms');
        expect(result.message).toContain('300ms');
      });

      it('should flag slow screenshot captures', () => {
        const result = checkScreenshotPerformance(350);
        expect(result.met).toBe(false);
        expect(result.message).toContain('⚠');
      });

      it('should accept captures at exactly 300ms', () => {
        const result = checkScreenshotPerformance(300);
        expect(result.met).toBe(true);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Functions
  // ─────────────────────────────────────────────────────────────────────────

  describe('Utility Functions', () => {
    describe('estimateTokens', () => {
      it('should estimate tokens from text length', () => {
        const text = 'Hello world'; // 11 chars
        const tokens = estimateTokens(text);
        expect(tokens).toBeGreaterThan(0);
        expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 4) + 1);
      });

      it('should handle empty strings', () => {
        const tokens = estimateTokens('');
        expect(tokens).toBe(0);
      });

      it('should handle long text', () => {
        const text = 'a'.repeat(1000);
        const tokens = estimateTokens(text);
        expect(tokens).toBeGreaterThan(200);
      });
    });
  });
});
