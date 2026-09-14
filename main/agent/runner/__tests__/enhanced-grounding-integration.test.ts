import { describe, it, expect, beforeEach } from 'vitest';
import {
  EnhancedGroundingEngine,
  ElementData,
  EnhancedGroundingConfig,
} from '../grounding';

/**
 * Integration tests for Enhanced Grounding Engine with learning mechanism
 * Tests the complete flow of extension data integration, learning, and optimization
 */
describe('EnhancedGroundingEngine Integration', () => {
  let engine: EnhancedGroundingEngine;

  beforeEach(() => {
    const config: EnhancedGroundingConfig = {
      enableSoMDetection: true,
      fallbackToVisual: true,
      confidenceThreshold: 0.75,
      maxRetryAttempts: 3,
      enableExtensionData: true,
    };
    engine = new EnhancedGroundingEngine(config);
  });

  describe('Complete Learning Flow', () => {
    it('should learn from successful interactions and optimize future attempts', async () => {
      // Step 1: First interaction - extension data available
      const elements: ElementData[] = [
        {
          selector: 'button.submit-btn',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: { class: 'submit-btn' },
          isInteractive: true,
        },
        {
          selector: 'button.cancel-btn',
          boundingRect: { left: 160, top: 200, right: 210, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Cancel',
          attributes: { class: 'cancel-btn' },
          isInteractive: true,
        },
      ];

      // First attempt - should match and learn
      const result1 = await engine.locateWithFallback(
        'base64screenshot1',
        1920,
        1080,
        'Submit',
        elements
      );

      expect(result1.found).toBe(true);
      expect(result1.method).toBe('dom');
      expect(result1.domSelector).toBe('button.submit-btn');

      // Verify learning was recorded
      const log1 = engine.getLearningLog();
      expect(log1.length).toBeGreaterThan(0);
      expect(log1[log1.length - 1].query).toBe('Submit');
      expect(log1[log1.length - 1].success).toBe(true);

      // Verify selector was optimized
      const optimizations = engine.getSelectorOptimizations();
      expect(optimizations.get('Submit')).toBe('button.submit-btn');

      // Step 2: Second attempt - should use learned selector
      const result2 = await engine.locateWithFallback(
        'base64screenshot2',
        1920,
        1080,
        'Submit',
        elements
      );

      expect(result2.found).toBe(true);
      expect(result2.method).toBe('dom');
      expect(result2.domSelector).toBe('button.submit-btn');

      // Verify learning statistics
      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.methodBreakdown['dom']).toBeGreaterThan(0);
    });

    it('should handle multiple queries with different selectors', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
        {
          selector: 'button.cancel',
          boundingRect: { left: 160, top: 200, right: 210, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Cancel',
          attributes: {},
          isInteractive: true,
        },
        {
          selector: 'a.help-link',
          boundingRect: { left: 220, top: 200, right: 270, bottom: 230, width: 50, height: 30 },
          tagName: 'A',
          textContent: 'Help',
          attributes: {},
          isInteractive: true,
        },
      ];

      // Learn multiple queries
      const queries = ['Submit', 'Cancel', 'Help'];
      for (const query of queries) {
        await engine.locateWithFallback(
          `screenshot-${query}`,
          1920,
          1080,
          query,
          elements
        );
      }

      // Verify all selectors were learned
      const optimizations = engine.getSelectorOptimizations();
      expect(optimizations.size).toBe(3);
      expect(optimizations.get('Submit')).toBe('button.submit');
      expect(optimizations.get('Cancel')).toBe('button.cancel');
      expect(optimizations.get('Help')).toBe('a.help-link');

      // Verify statistics
      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBe(3);
      expect(stats.successRate).toBe(1.0);
    });

    it('should track viewport size in learning records', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.test',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Test',
          attributes: {},
          isInteractive: true,
        },
      ];

      // Test with different viewport sizes
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
        { width: 768, height: 1024 },
      ];

      for (const viewport of viewports) {
        await engine.locateWithFallback(
          `screenshot-${viewport.width}`,
          viewport.width,
          viewport.height,
          'Test',
          elements
        );
      }

      // Verify viewport sizes were recorded
      const log = engine.getLearningLog();
      const viewportSizes = log.map(l => l.viewportSize);
      expect(viewportSizes).toContainEqual({ width: 1920, height: 1080 });
      expect(viewportSizes).toContainEqual({ width: 1280, height: 720 });
      expect(viewportSizes).toContainEqual({ width: 768, height: 1024 });
    });

    it('should handle coordinate validation failures', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.edge',
          boundingRect: { left: 1900, top: 1050, right: 1950, bottom: 1080, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Edge Button',
          attributes: {},
          isInteractive: true,
        },
      ];

      // This should still work because coordinates are within margin
      const result = await engine.locateWithFallback(
        'screenshot-edge',
        1920,
        1080,
        'Edge Button',
        elements
      );

      expect(result.found).toBe(true);
      expect(result.x).toBeGreaterThan(1900);
      expect(result.y).toBeGreaterThan(1050);
    });

    it('should maintain learning log size limit', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.test',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Test',
          attributes: {},
          isInteractive: true,
        },
      ];

      // Record more than max size
      for (let i = 0; i < 1100; i++) {
        engine['recordLearning'](
          `Query${i}`,
          'dom',
          'button.test',
          0.9,
          true,
          { found: true, x: 125, y: 215 },
          1920,
          1080,
          100
        );
      }

      // Verify log size is limited
      const log = engine.getLearningLog();
      expect(log.length).toBeLessThanOrEqual(1000);
    });

    it('should calculate accurate learning statistics', async () => {
      // Record successful interactions
      for (let i = 0; i < 7; i++) {
        engine['recordLearning'](
          `SuccessQuery${i}`,
          'dom',
          `selector${i}`,
          0.9,
          true,
          { found: true, x: 100, y: 100 },
          1920,
          1080,
          100
        );
      }

      // Record failed interactions
      for (let i = 0; i < 3; i++) {
        engine['recordLearning'](
          `FailedQuery${i}`,
          'visual',
          undefined,
          0,
          false,
          undefined,
          1920,
          1080,
          100,
          'element_not_found'
        );
      }

      // Verify statistics
      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBe(10);
      expect(stats.successRate).toBe(0.7);
      expect(stats.averageConfidence).toBeCloseTo(0.63, 1); // (7 * 0.9 + 3 * 0) / 10
      expect(stats.methodBreakdown['dom']).toBe(7);
      expect(stats.methodBreakdown['visual']).toBe(3);
    });

    it('should handle mixed detection methods', async () => {
      // Record interactions with different methods
      engine['recordLearning'](
        'Query1',
        'dom',
        'selector1',
        0.95,
        true,
        { found: true, x: 100, y: 100 },
        1920,
        1080,
        100
      );

      engine['recordLearning'](
        'Query2',
        'visual',
        undefined,
        0.85,
        true,
        { found: true, x: 200, y: 200 },
        1920,
        1080,
        200
      );

      engine['recordLearning'](
        'Query3',
        'hybrid',
        'selector3',
        0.88,
        true,
        { found: true, x: 300, y: 300 },
        1920,
        1080,
        150
      );

      // Verify method breakdown
      const stats = engine.getLearningStats();
      expect(stats.methodBreakdown['dom']).toBe(1);
      expect(stats.methodBreakdown['visual']).toBe(1);
      expect(stats.methodBreakdown['hybrid']).toBe(1);
      expect(stats.averageConfidence).toBeCloseTo(0.893, 2);
    });

    it('should provide learning data for debugging', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.debug',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Debug',
          attributes: {},
          isInteractive: true,
        },
      ];

      // Perform interaction
      await engine.locateWithFallback(
        'screenshot-debug',
        1920,
        1080,
        'Debug',
        elements
      );

      // Get learning log
      const log = engine.getLearningLog();
      expect(log.length).toBeGreaterThan(0);

      // Verify log entry has all required fields
      const entry = log[log.length - 1];
      expect(entry.query).toBeDefined();
      expect(entry.method).toBeDefined();
      expect(entry.confidence).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.success).toBeDefined();
      expect(entry.viewportSize).toBeDefined();

      // Get statistics
      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.averageConfidence).toBeGreaterThan(0);
      expect(stats.methodBreakdown).toBeDefined();
    });
  });

  describe('Error Recovery with Learning', () => {
    it('should record failed attempts for debugging', async () => {
      // Record a failed attempt
      engine['recordLearning'](
        'NonExistent',
        'visual',
        undefined,
        0,
        false,
        undefined,
        1920,
        1080,
        500,
        'element_not_found'
      );

      // Verify failure was recorded
      const log = engine.getLearningLog();
      expect(log.length).toBe(1);
      expect(log[0].success).toBe(false);
      expect(log[0].query).toBe('NonExistent');

      // Verify statistics reflect failure
      const stats = engine.getLearningStats();
      expect(stats.successRate).toBe(0);
      expect(stats.totalAttempts).toBe(1);
    });

    it('should not store selectors for failed interactions', async () => {
      // Record failed interaction
      engine['recordLearning'](
        'Failed',
        'visual',
        undefined,
        0,
        false,
        undefined,
        1920,
        1080,
        100,
        'timeout'
      );

      // Verify no selector was stored
      const optimizations = engine.getSelectorOptimizations();
      expect(optimizations.size).toBe(0);
    });
  });
});
