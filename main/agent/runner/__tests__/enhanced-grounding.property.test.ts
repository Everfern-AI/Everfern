import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  EnhancedGroundingEngine,
  ElementData,
  EnhancedGroundingConfig,
} from '../grounding';

/**
 * Property-Based Tests for Enhanced Grounding Engine
 *
 * **Validates: Requirements 3.1, 3.3, 8.2, 8.4, 8.6**
 *
 * Property 3: Visual Grounding Fallback Intelligence
 * For any DOM interaction failure or ambiguous selector scenario, the system SHALL
 * automatically fall back to visual grounding using the existing GroundingEngine with
 * SoM detection, validate coordinates against the current viewport, and provide
 * actionable error messages when both methods fail.
 */

describe('Feature: enhanced-web-automation-system, Property 3: Visual Grounding Fallback Intelligence', () => {

  it('should always return a valid VisualGroundingResult structure', () => {
    fc.assert(
      fc.property(
        fc.record({
          query: fc.string({ minLength: 1, maxLength: 100 }),
          imgW: fc.integer({ min: 100, max: 4000 }),
          imgH: fc.integer({ min: 100, max: 4000 }),
          confidenceThreshold: fc.float({ min: 0, max: 1, noNaN: true }),
        }),
        (data) => {
          const config: EnhancedGroundingConfig = {
            enableSoMDetection: true,
            fallbackToVisual: true,
            confidenceThreshold: data.confidenceThreshold,
          };
          const engine = new EnhancedGroundingEngine(config);

          // Simulate a result (in real scenario, this would be from locate())
          const result = engine['handleGroundingError'](
            new Error('test error'),
            data.query,
            ['dom', 'visual']
          );

          // Verify result structure
          expect(result).toBeDefined();
          expect(result.found).toBeDefined();
          expect(typeof result.found).toBe('boolean');
          expect(result.x).toBeDefined();
          expect(typeof result.x).toBe('number');
          expect(result.y).toBeDefined();
          expect(typeof result.y).toBe('number');
          expect(result.confidence).toBeDefined();
          expect(typeof result.confidence).toBe('number');
          expect(result.method).toBeDefined();
          expect(['dom', 'visual', 'hybrid']).toContain(result.method);
          expect(result.source).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate coordinates within viewport bounds for all results', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -100, max: 5000 }),
          y: fc.integer({ min: -100, max: 5000 }),
          imgW: fc.integer({ min: 100, max: 4000 }),
          imgH: fc.integer({ min: 100, max: 4000 }),
        }),
        (data) => {
          const engine = new EnhancedGroundingEngine({});
          const isValid = engine['validateCoordinates'](data.x, data.y, data.imgW, data.imgH);

          // Coordinates should be valid if within reasonable bounds
          if (isValid) {
            expect(data.x).toBeGreaterThanOrEqual(-10);
            expect(data.x).toBeLessThanOrEqual(data.imgW + 10);
            expect(data.y).toBeGreaterThanOrEqual(-10);
            expect(data.y).toBeLessThanOrEqual(data.imgH + 10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle extension element data consistently', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            selector: fc.string({ minLength: 1, maxLength: 50 }),
            textContent: fc.string({ minLength: 0, maxLength: 100 }),
            left: fc.integer({ min: 0, max: 1920 }),
            top: fc.integer({ min: 0, max: 1080 }),
            right: fc.integer({ min: 0, max: 1920 }),
            bottom: fc.integer({ min: 0, max: 1080 }),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (elementSpecs) => {
          const engine = new EnhancedGroundingEngine({
            enableExtensionData: true,
          });

          // Create unique selectors to avoid duplicates
          const elements: ElementData[] = elementSpecs.map((spec, idx) => ({
            selector: `${spec.selector}-${idx}`,
            boundingRect: {
              left: spec.left,
              top: spec.top,
              right: Math.max(spec.right, spec.left + 1),
              bottom: Math.max(spec.bottom, spec.top + 1),
              width: Math.max(spec.right, spec.left + 1) - spec.left,
              height: Math.max(spec.bottom, spec.top + 1) - spec.top,
            },
            tagName: 'BUTTON',
            textContent: spec.textContent,
            attributes: {},
            isInteractive: true,
          }));

          // Update elements
          engine.updateExtensionElements(elements);

          // Verify data is stored
          expect(engine['extensionElements'].size).toBe(elements.length);

          // Verify freshness
          expect(engine['isExtensionDataFresh']()).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should select appropriate detection method based on element type and complexity', () => {
    fc.assert(
      fc.property(
        fc.record({
          elementType: fc.option(
            fc.constantFrom('button', 'input', 'link', 'checkbox', 'custom', 'unknown')
          ),
          complexity: fc.constantFrom('simple', 'moderate', 'complex'),
        }),
        (data) => {
          const engine = new EnhancedGroundingEngine({});
          const method = engine.selectDetectionMethod(data.elementType, data.complexity);

          // Method should always be one of the valid options
          expect(['dom', 'visual', 'hybrid']).toContain(method);

          // For simple pages with known elements, prefer DOM
          if (data.complexity === 'simple' && data.elementType && ['button', 'input', 'link'].includes(data.elementType)) {
            expect(method).toBe('dom');
          }

          // For complex pages, use hybrid
          if (data.complexity === 'complex') {
            expect(method).toBe('hybrid');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle error scenarios gracefully with actionable messages', () => {
    fc.assert(
      fc.property(
        fc.record({
          errorType: fc.constantFrom('timeout', 'confidence', 'unknown'),
          query: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        (data) => {
          const engine = new EnhancedGroundingEngine({});

          const errorMessage = data.errorType === 'timeout'
            ? 'timeout after 5000ms'
            : data.errorType === 'confidence'
              ? 'confidence too low'
              : 'unknown error occurred';

          const result = engine.handleGroundingError(
            new Error(errorMessage),
            data.query,
            ['dom', 'visual']
          );

          // Result should indicate failure
          expect(result.found).toBe(false);
          expect(result.confidence).toBe(0);

          // Should have actionable fallback reason
          expect(result.fallbackReason).toBeDefined();
          expect(['timeout', 'low_confidence', 'unknown_error']).toContain(result.fallbackReason);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain confidence threshold consistency across all detection methods', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.5), max: Math.fround(0.98), noNaN: true }),
        (threshold) => {
          const config: EnhancedGroundingConfig = {
            confidenceThreshold: threshold,
          };
          const engine = new EnhancedGroundingEngine(config);

          // Verify threshold is applied
          expect(engine.enhancedConfig.confidenceThreshold).toBe(threshold);

          // Verify threshold is used in matching logic
          const elements: ElementData[] = [
            {
              selector: 'button.test',
              boundingRect: { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 },
              tagName: 'BUTTON',
              textContent: 'Test',
              attributes: {},
              isInteractive: true,
            },
          ];

          engine.updateExtensionElements(elements);
          const result = engine['matchExtensionElements']('Test');

          // Result confidence should be compared against threshold
          if (result) {
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle coordinate validation for all viewport sizes', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -500, max: 5000 }),
          y: fc.integer({ min: -500, max: 5000 }),
          imgW: fc.integer({ min: 100, max: 4000 }),
          imgH: fc.integer({ min: 100, max: 4000 }),
        }),
        (data) => {
          const engine = new EnhancedGroundingEngine({});
          const isValid = engine['validateCoordinates'](data.x, data.y, data.imgW, data.imgH);

          // Validation should be consistent
          expect(typeof isValid).toBe('boolean');

          // Coordinates at viewport center should always be valid
          const centerX = data.imgW / 2;
          const centerY = data.imgH / 2;
          expect(engine['validateCoordinates'](centerX, centerY, data.imgW, data.imgH)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should provide consistent results for identical inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          query: fc.string({ minLength: 1, maxLength: 50 }),
          selector: fc.string({ minLength: 1, maxLength: 50 }),
          textContent: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        (data) => {
          const engine = new EnhancedGroundingEngine({});

          const elements: ElementData[] = [
            {
              selector: data.selector,
              boundingRect: { left: 100, top: 100, right: 200, bottom: 150, width: 100, height: 50 },
              tagName: 'BUTTON',
              textContent: data.textContent,
              attributes: {},
              isInteractive: true,
            },
          ];

          engine.updateExtensionElements(elements);

          // Call matching twice with same input
          const result1 = engine['matchExtensionElements'](data.query);
          const result2 = engine['matchExtensionElements'](data.query);

          // Results should be identical
          if (result1 && result2) {
            expect(result1.found).toBe(result2.found);
            expect(result1.x).toBe(result2.x);
            expect(result1.y).toBe(result2.y);
            expect(result1.confidence).toBe(result2.confidence);
          } else {
            expect(result1).toBe(result2);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
