import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import { GradientBorderSystem } from '../GradientBorderSystem';

/**
 * Property-Based Tests for GradientBorderSystem
 *
 * **Feature: navis-ui-performance-enhancement**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 */

describe('GradientBorderSystem - Property-Based Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Property 1: Gradient Border State Management
   *
   * For any NAVIS execution state (idle, executing, success, error),
   * the gradient border system SHALL display appropriate colors,
   * smooth transitions, and shimmer effects that match the macOS Spotlight aesthetic
   */
  it('should display appropriate colors and transitions for any NAVIS execution state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          status: fc.constantFrom('idle', 'executing', 'success', 'error'),
          isActive: fc.boolean(),
          borderRadius: fc.integer({ min: 8, max: 20 }),
          borderWidth: fc.float({ min: 1.5, max: 4.0, noNaN: true }),
          animationSpeed: fc.float({ min: 1.0, max: 5.0, noNaN: true }),
          glowIntensity: fc.float({ min: 0.5, max: 2.0, noNaN: true }),
        }),
        async (testCase) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container } = render(
            <GradientBorderSystem
              isActive={testCase.isActive}
              status={testCase.status as 'idle' | 'executing' | 'success' | 'error'}
              borderRadius={testCase.borderRadius}
              borderWidth={testCase.borderWidth}
              animationSpeed={testCase.animationSpeed}
              glowIntensity={testCase.glowIntensity}
            >
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]');
          expect(borderElement).toBeInTheDocument();

          const computedStyle = window.getComputedStyle(borderElement!);

          // Verify border radius is applied correctly (check inline style)
          const borderElementHTML = borderElement as HTMLElement;
          expect(borderElementHTML.style.borderRadius).toBe(`${testCase.borderRadius}px`);

          // Verify border width (padding) is applied correctly
          expect(computedStyle.padding).toBe(`${testCase.borderWidth}px`);

          // Verify hardware acceleration properties
          expect(computedStyle.transform).toContain('translate3d');

          if (testCase.isActive) {
            // Verify gradient background is present
            const backgroundImage = computedStyle.background;
            expect(backgroundImage).toContain('linear-gradient');

            // Verify color scheme matches macOS Spotlight aesthetic based on status
            if (testCase.status === 'success') {
              expect(backgroundImage).toContain('rgb(34, 197, 94)'); // Green tint
            } else if (testCase.status === 'error') {
              expect(backgroundImage).toContain('rgb(239, 68, 68)'); // Red tint
            } else {
              // Default macOS Spotlight colors (blue, purple, pink)
              const hasSpotlightColors =
                backgroundImage.includes('rgb(59, 130, 246)') || // Blue
                backgroundImage.includes('rgb(147, 51, 234)') || // Purple
                backgroundImage.includes('rgb(236, 72, 153)'); // Pink
              expect(hasSpotlightColors).toBe(true);
            }

            // Verify will-change property for hardware acceleration
            expect(computedStyle.willChange).toBe('background, box-shadow');

            // Verify glow effect is present
            expect(computedStyle.boxShadow).not.toBe('none');

            // Verify glow blur radius is within expected range (8-12px base + intensity adjustment)
            const expectedBlurRadius = 8 + testCase.glowIntensity * 4;
            expect(computedStyle.boxShadow).toContain(`${expectedBlurRadius}px`);
          } else {
            // When inactive, background should be transparent
            expect(computedStyle.background).toMatch(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/);

            // When inactive, will-change should be auto
            expect(computedStyle.willChange).toBe('auto');

            // When inactive, no glow effect
            expect(computedStyle.boxShadow).toBe('none');
          }

          // Verify smooth transitions are applied
          expect(computedStyle.transition).toContain('box-shadow');
          expect(computedStyle.transition).toContain('opacity');
          expect(computedStyle.transition).toContain('0.3s');
          expect(computedStyle.transition).toContain('ease');

          // Verify inner content container exists and has correct styling
          const innerContainer = borderElement!.querySelector('div');
          expect(innerContainer).toBeInTheDocument();

          const innerStyle = window.getComputedStyle(innerContainer!);
          expect(innerStyle.background).toContain('rgb(255, 255, 255)'); // White background
          expect(innerStyle.overflow).toBe('hidden');
          // Check inline style for border radius
          const innerContainerHTML = innerContainer as HTMLElement;
          expect(innerContainerHTML.style.borderRadius).toBe(`${testCase.borderRadius - testCase.borderWidth}px`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Status Transition Consistency
   *
   * For any sequence of status transitions, the gradient border system
   * SHALL maintain visual consistency and smooth color transitions
   */
  it('should maintain visual consistency across status transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom('idle', 'executing', 'success', 'error'),
          { minLength: 2, maxLength: 5 }
        ),
        async (statusSequence) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container, rerender } = render(
            <GradientBorderSystem isActive={true} status={statusSequence[0] as any}>
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]');
          expect(borderElement).toBeInTheDocument();

          // Iterate through status sequence
          for (let i = 1; i < statusSequence.length; i++) {
            const previousStatus = statusSequence[i - 1];
            const currentStatus = statusSequence[i];

            rerender(
              <GradientBorderSystem isActive={true} status={currentStatus as any}>
                <div>Test Content</div>
              </GradientBorderSystem>
            );

            const computedStyle = window.getComputedStyle(borderElement!);
            const backgroundImage = computedStyle.background;

            // Verify gradient is always present when active
            expect(backgroundImage).toContain('linear-gradient');

            // Verify appropriate colors for current status
            if (currentStatus === 'success') {
              expect(backgroundImage).toContain('rgb(34, 197, 94)');
            } else if (currentStatus === 'error') {
              expect(backgroundImage).toContain('rgb(239, 68, 68)');
            } else {
              const hasSpotlightColors =
                backgroundImage.includes('rgb(59, 130, 246)') ||
                backgroundImage.includes('rgb(147, 51, 234)') ||
                backgroundImage.includes('rgb(236, 72, 153)');
              expect(hasSpotlightColors).toBe(true);
            }

            // Verify smooth transitions are maintained
            expect(computedStyle.transition).toContain('0.3s');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 3: Border Dimension Constraints
   *
   * For any valid border dimensions, the gradient border system
   * SHALL correctly apply dimensions and maintain visual integrity
   */
  it('should correctly apply border dimensions within valid ranges', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          borderRadius: fc.integer({ min: 0, max: 50 }),
          borderWidth: fc.float({ min: 0.5, max: 10.0, noNaN: true }),
        }),
        async (dimensions) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container } = render(
            <GradientBorderSystem
              isActive={true}
              status="executing"
              borderRadius={dimensions.borderRadius}
              borderWidth={dimensions.borderWidth}
            >
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]') as HTMLElement;
          const computedStyle = window.getComputedStyle(borderElement!);

          // Verify border radius (check inline style)
          expect(borderElement.style.borderRadius).toBe(`${dimensions.borderRadius}px`);

          // Verify border width (padding)
          expect(computedStyle.padding).toBe(`${dimensions.borderWidth}px`);

          // Verify inner container has adjusted border radius
          const innerContainer = borderElement!.querySelector('div') as HTMLElement;
          const innerStyle = window.getComputedStyle(innerContainer!);
          const expectedInnerRadius = Math.max(0, dimensions.borderRadius - dimensions.borderWidth);
          expect(innerContainer.style.borderRadius).toBe(`${expectedInnerRadius}px`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Animation Speed Consistency
   *
   * For any valid animation speed, the gradient border system
   * SHALL maintain smooth shimmer effects without visual glitches
   */
  it('should maintain smooth shimmer effects for any animation speed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0.5, max: 10.0, noNaN: true }),
        async (animationSpeed) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container } = render(
            <GradientBorderSystem
              isActive={true}
              status="executing"
              animationSpeed={animationSpeed}
            >
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]');
          expect(borderElement).toBeInTheDocument();

          const computedStyle = window.getComputedStyle(borderElement!);

          // Verify gradient is present
          expect(computedStyle.background).toContain('linear-gradient');

          // Verify hardware acceleration is enabled
          expect(computedStyle.transform).toContain('translate3d');
          expect(computedStyle.willChange).toBe('background, box-shadow');

          // Verify smooth transitions
          expect(computedStyle.transition).toContain('0.3s');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Glow Intensity Scaling
   *
   * For any valid glow intensity, the gradient border system
   * SHALL correctly scale the glow effect blur radius
   */
  it('should correctly scale glow effect for any intensity value', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.float({ min: 0.0, max: 3.0, noNaN: true }),
        async (glowIntensity) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container } = render(
            <GradientBorderSystem
              isActive={true}
              status="executing"
              glowIntensity={glowIntensity}
            >
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]');
          const computedStyle = window.getComputedStyle(borderElement!);

          // Calculate expected blur radius: 8 + (intensity * 4)
          const expectedBlurRadius = 8 + glowIntensity * 4;

          // Verify glow effect is present
          expect(computedStyle.boxShadow).not.toBe('none');

          // Verify blur radius matches expected value
          expect(computedStyle.boxShadow).toContain(`${expectedBlurRadius}px`);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Active State Consistency
   *
   * For any combination of isActive and status, the gradient border system
   * SHALL correctly apply or remove visual effects
   */
  it('should correctly apply visual effects based on active state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          isActive: fc.boolean(),
          status: fc.constantFrom('idle', 'executing', 'success', 'error'),
        }),
        async (testCase) => {
          // **Feature: navis-ui-performance-enhancement, Property 1: Gradient Border State Management**

          const { container } = render(
            <GradientBorderSystem
              isActive={testCase.isActive}
              status={testCase.status as any}
            >
              <div>Test Content</div>
            </GradientBorderSystem>
          );

          const borderElement = container.querySelector('[data-testid="gradient-border"]');
          const computedStyle = window.getComputedStyle(borderElement!);

          if (testCase.isActive) {
            // When active, gradient should be present
            expect(computedStyle.background).toContain('linear-gradient');

            // When active, glow should be present
            expect(computedStyle.boxShadow).not.toBe('none');

            // When active, will-change should be set
            expect(computedStyle.willChange).toBe('background, box-shadow');
          } else {
            // When inactive, background should be transparent
            expect(computedStyle.background).toMatch(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/);

            // When inactive, no glow
            expect(computedStyle.boxShadow).toBe('none');

            // When inactive, will-change should be auto
            expect(computedStyle.willChange).toBe('auto');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
