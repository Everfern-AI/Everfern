import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnhancedGroundingEngine,
  VisualGroundingResult,
  ElementData,
  EnhancedGroundingConfig,
  createGroundingEngine,
} from '../grounding';

describe('EnhancedGroundingEngine', () => {
  let engine: EnhancedGroundingEngine;
  let config: EnhancedGroundingConfig;

  beforeEach(() => {
    config = {
      enableSoMDetection: true,
      fallbackToVisual: true,
      confidenceThreshold: 0.75,
      maxRetryAttempts: 3,
      enableExtensionData: true,
    };
    engine = new EnhancedGroundingEngine(config);
  });

  describe('Extension Element Matching', () => {
    it('should match element by text content', () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: { class: 'submit' },
          isInteractive: true,
        },
      ];

      engine.updateExtensionElements(elements);
      const result = engine['matchExtensionElements']('Submit');

      expect(result).not.toBeNull();
      expect(result?.found).toBe(true);
      expect(result?.x).toBe(125); // (100 + 150) / 2
      expect(result?.y).toBe(215); // (200 + 230) / 2
      expect(result?.method).toBe('dom');
    });

    it('should match element by aria-label', () => {
      const elements: ElementData[] = [
        {
          selector: 'button.close',
          boundingRect: { left: 500, top: 50, right: 530, bottom: 80, width: 30, height: 30 },
          tagName: 'BUTTON',
          textContent: '×',
          attributes: {},
          isInteractive: true,
          ariaLabel: 'Close dialog',
        },
      ];

      engine.updateExtensionElements(elements);
      const result = engine['matchExtensionElements']('Close dialog');

      expect(result).not.toBeNull();
      expect(result?.found).toBe(true);
      expect(result?.extensionData?.ariaLabel).toBe('Close dialog');
    });

    it('should match element by data-testid', () => {
      const elements: ElementData[] = [
        {
          selector: '[data-testid="login-button"]',
          boundingRect: { left: 200, top: 300, right: 300, bottom: 350, width: 100, height: 50 },
          tagName: 'BUTTON',
          textContent: 'Login',
          attributes: { 'data-testid': 'login-button' },
          isInteractive: true,
          dataTestId: 'login-button',
        },
      ];

      engine.updateExtensionElements(elements);
      const result = engine['matchExtensionElements']('login-button');

      expect(result).not.toBeNull();
      expect(result?.found).toBe(true);
      expect(result?.extensionData?.dataTestId).toBe('login-button');
    });

    it('should return null when no match found', () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
      ];

      engine.updateExtensionElements(elements);
      const result = engine['matchExtensionElements']('NonExistent');

      expect(result).toBeNull();
    });

    it('should handle case-insensitive matching', () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
      ];

      engine.updateExtensionElements(elements);
      const result = engine['matchExtensionElements']('SUBMIT');

      expect(result).not.toBeNull();
      expect(result?.found).toBe(true);
    });
  });

  describe('Coordinate Validation', () => {
    it('should validate coordinates within bounds', () => {
      const isValid = engine['validateCoordinates'](500, 400, 1920, 1080);
      expect(isValid).toBe(true);
    });

    it('should validate coordinates at edges', () => {
      const isValid = engine['validateCoordinates'](0, 0, 1920, 1080);
      expect(isValid).toBe(true);
    });

    it('should reject coordinates far outside bounds', () => {
      const isValid = engine['validateCoordinates'](5000, 5000, 1920, 1080);
      expect(isValid).toBe(false);
    });

    it('should allow small margin for edge elements', () => {
      const isValid = engine['validateCoordinates'](-5, -5, 1920, 1080);
      expect(isValid).toBe(true);
    });
  });

  describe('Detection Method Selection', () => {
    it('should prefer DOM for simple pages with known elements', () => {
      const method = engine.selectDetectionMethod('button', 'simple');
      expect(method).toBe('dom');
    });

    it('should use hybrid for complex pages', () => {
      const method = engine.selectDetectionMethod('button', 'complex');
      expect(method).toBe('hybrid');
    });

    it('should use hybrid for unknown element types', () => {
      const method = engine.selectDetectionMethod(undefined, 'simple');
      expect(method).toBe('hybrid');
    });

    it('should default to hybrid', () => {
      const method = engine.selectDetectionMethod();
      expect(method).toBe('hybrid');
    });
  });

  describe('Grounding Logging', () => {
    it('should log successful grounding attempts', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      engine.logGroundingAttempt('Submit', 'dom', true, 0.95, 150);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EnhancedGrounding] 📊 Attempt log:'),
        expect.objectContaining({
          query: 'Submit',
          method: 'dom',
          success: true,
          confidence: 0.95,
        })
      );

      consoleSpy.mockRestore();
    });

    it('should log failed grounding attempts with error', () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const result = engine.handleGroundingError(
        new Error('timeout'),
        'Submit',
        ['dom', 'visual']
      );

      expect(result.found).toBe(false);
      expect(result.fallbackReason).toBe('timeout');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle timeout errors', () => {
      const result = engine.handleGroundingError(
        new Error('timeout after 5000ms'),
        'Submit',
        ['dom']
      );

      expect(result.found).toBe(false);
      expect(result.fallbackReason).toBe('timeout');
    });

    it('should handle low confidence errors', () => {
      const result = engine.handleGroundingError(
        new Error('confidence too low'),
        'Submit',
        ['visual']
      );

      expect(result.found).toBe(false);
      expect(result.fallbackReason).toBe('low_confidence');
    });

    it('should handle unknown errors', () => {
      const result = engine.handleGroundingError(
        new Error('unknown error'),
        'Submit',
        ['dom', 'visual']
      );

      expect(result.found).toBe(false);
      expect(result.fallbackReason).toBe('unknown_error');
    });
  });

  describe('Extension Data Freshness', () => {
    it('should consider data fresh within TTL', () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
      ];

      engine.updateExtensionElements(elements);
      const isFresh = engine['isExtensionDataFresh']();

      expect(isFresh).toBe(true);
    });

    it('should consider data stale after TTL', async () => {
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
      ];

      engine.updateExtensionElements(elements);
      engine['extensionUpdateTTL'] = 100; // Set short TTL for testing

      await new Promise(resolve => setTimeout(resolve, 150));

      const isFresh = engine['isExtensionDataFresh']();
      expect(isFresh).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should apply default configuration', () => {
      const defaultEngine = new EnhancedGroundingEngine({});

      expect(defaultEngine.enhancedConfig.enableSoMDetection).toBe(true);
      expect(defaultEngine.enhancedConfig.fallbackToVisual).toBe(true);
      expect(defaultEngine.enhancedConfig.confidenceThreshold).toBe(0.75);
    });

    it('should override default configuration', () => {
      const customConfig: EnhancedGroundingConfig = {
        enableSoMDetection: false,
        fallbackToVisual: false,
        confidenceThreshold: 0.9,
      };

      const customEngine = new EnhancedGroundingEngine(customConfig);

      expect(customEngine.enhancedConfig.enableSoMDetection).toBe(false);
      expect(customEngine.enhancedConfig.fallbackToVisual).toBe(false);
      expect(customEngine.enhancedConfig.confidenceThreshold).toBe(0.9);
    });
  });

  describe('Learning Mechanism', () => {
    it('should record successful visual interactions', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      engine['recordLearning'](
        'Submit',
        'dom',
        'button.submit',
        0.95,
        true,
        { found: true, x: 125, y: 215 },
        1920,
        1080,
        150
      );

      const log = engine.getLearningLog();
      expect(log.length).toBe(1);
      expect(log[0].query).toBe('Submit');
      expect(log[0].method).toBe('dom');
      expect(log[0].success).toBe(true);
      expect(log[0].confidence).toBe(0.95);

      consoleSpy.mockRestore();
    });

    it('should store selector optimizations from successful interactions', () => {
      engine['recordLearning'](
        'Submit',
        'dom',
        'button.submit',
        0.95,
        true,
        { found: true, x: 125, y: 215 },
        1920,
        1080,
        150
      );

      const optimizations = engine.getSelectorOptimizations();
      expect(optimizations.get('Submit')).toBe('button.submit');
    });

    it('should not store selector optimizations for failed interactions', () => {
      engine['recordLearning'](
        'Submit',
        'visual',
        undefined,
        0,
        false,
        undefined,
        1920,
        1080,
        150,
        'element_not_found'
      );

      const optimizations = engine.getSelectorOptimizations();
      expect(optimizations.size).toBe(0);
    });

    it('should maintain learning log size limit', () => {
      // Record more than max size
      for (let i = 0; i < 1100; i++) {
        engine['recordLearning'](
          `Query${i}`,
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

      const log = engine.getLearningLog();
      expect(log.length).toBeLessThanOrEqual(1000);
    });

    it('should calculate learning statistics correctly', () => {
      // Record successful interactions
      for (let i = 0; i < 8; i++) {
        engine['recordLearning'](
          `Query${i}`,
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
      for (let i = 0; i < 2; i++) {
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

      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBe(10);
      expect(stats.successRate).toBe(0.8);
      expect(stats.averageConfidence).toBeCloseTo(0.72, 1); // (8 * 0.9 + 2 * 0) / 10
      expect(stats.methodBreakdown['dom']).toBe(8);
      expect(stats.methodBreakdown['visual']).toBe(2);
    });

    it('should return empty stats when no learning data exists', () => {
      const stats = engine.getLearningStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageConfidence).toBe(0);
      expect(Object.keys(stats.methodBreakdown).length).toBe(0);
    });

    it('should track viewport size in learning records', () => {
      engine['recordLearning'](
        'Submit',
        'dom',
        'button.submit',
        0.95,
        true,
        { found: true, x: 125, y: 215 },
        1920,
        1080,
        150
      );

      const log = engine.getLearningLog();
      expect(log[0].viewportSize).toEqual({ width: 1920, height: 1080 });
    });

    it('should track coordinates in learning records', () => {
      engine['recordLearning'](
        'Submit',
        'dom',
        'button.submit',
        0.95,
        true,
        { found: true, x: 125, y: 215 },
        1920,
        1080,
        150
      );

      const log = engine.getLearningLog();
      expect(log[0].coordinates).toEqual({ x: 125, y: 215 });
    });

    it('should not track coordinates for failed interactions', () => {
      engine['recordLearning'](
        'Submit',
        'visual',
        undefined,
        0,
        false,
        undefined,
        1920,
        1080,
        150,
        'element_not_found'
      );

      const log = engine.getLearningLog();
      expect(log[0].coordinates).toBeUndefined();
    });
  });

  describe('Learned Selector Usage', () => {
    it('should use learned selector when available', async () => {
      // First, record a successful interaction
      engine['recordLearning'](
        'Submit',
        'dom',
        'button.submit',
        0.95,
        true,
        { found: true, x: 125, y: 215 },
        1920,
        1080,
        150
      );

      // Create extension elements
      const elements: ElementData[] = [
        {
          selector: 'button.submit',
          boundingRect: { left: 100, top: 200, right: 150, bottom: 230, width: 50, height: 30 },
          tagName: 'BUTTON',
          textContent: 'Submit',
          attributes: {},
          isInteractive: true,
        },
      ];

      // Mock the locateWithFallback to use learned selector
      const result = await engine.locateWithFallback(
        'base64screenshot',
        1920,
        1080,
        'Submit',
        elements
      );

      // Should find the element using learned selector
      expect(result.found).toBe(true);
      expect(result.method).toBe('dom');
    });
  });
});
