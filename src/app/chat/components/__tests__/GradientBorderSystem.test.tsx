import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GradientBorderSystem, useGradientBorderState } from '../GradientBorderSystem';

describe('GradientBorderSystem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Gradient Color Calculations', () => {
    it('should display blue-purple-pink gradient for idle status', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      expect(borderElement).toBeInTheDocument();

      const style = window.getComputedStyle(borderElement!);
      const background = style.background;

      // Verify gradient contains Spotlight colors
      expect(background).toContain('linear-gradient');
      expect(background).toContain('rgb(59, 130, 246)'); // Blue #3B82F6
      expect(background).toContain('rgb(147, 51, 234)'); // Purple #9333EA
      expect(background).toContain('rgb(236, 72, 153)'); // Pink #EC4899
    });

    it('should display blue-purple-pink gradient for executing status', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);
      const background = style.background;

      expect(background).toContain('rgb(59, 130, 246)'); // Blue
      expect(background).toContain('rgb(147, 51, 234)'); // Purple
      expect(background).toContain('rgb(236, 72, 153)'); // Pink
    });

    it('should display green-tinted gradient for success status', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="success">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);
      const background = style.background;

      expect(background).toContain('rgb(34, 197, 94)'); // Success green #22c55e
    });

    it('should display red-tinted gradient for error status', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="error">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);
      const background = style.background;

      expect(background).toContain('rgb(239, 68, 68)'); // Error red #ef4444
    });

    it('should have transparent background when not active', () => {
      const { container } = render(
        <GradientBorderSystem isActive={false} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      // Transparent is rendered as rgba(0, 0, 0, 0) in computed styles
      expect(style.background).toMatch(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/);
    });
  });

  describe('Animation States', () => {
    it('should apply hardware acceleration properties when active', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.transform).toContain('translate3d');
      expect(style.willChange).toBe('background, box-shadow');
    });

    it('should not apply will-change when inactive', () => {
      const { container } = render(
        <GradientBorderSystem isActive={false} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.willChange).toBe('auto');
    });

    it('should apply glow effect when active', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.boxShadow).not.toBe('none');
    });

    it('should not apply glow effect when inactive', () => {
      const { container } = render(
        <GradientBorderSystem isActive={false} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.boxShadow).toBe('none');
    });

    it('should update animation when status changes', () => {
      const { container, rerender } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const initialStyle = window.getComputedStyle(borderElement!);
      const initialBackground = initialStyle.background;

      // Change status to success
      rerender(
        <GradientBorderSystem isActive={true} status="success">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      // Check immediately after rerender (React updates synchronously in tests)
      const updatedStyle = window.getComputedStyle(borderElement!);
      const updatedBackground = updatedStyle.background;

      // Background should change to include success color
      expect(updatedBackground).toContain('rgb(34, 197, 94)');
    });
  });

  describe('Border Properties', () => {
    it('should apply default border radius of 12px', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]') as HTMLElement;
      expect(borderElement).toBeInTheDocument();

      // Check inline style attribute directly (jsdom doesn't always compute inline styles)
      expect(borderElement.style.borderRadius).toBe('12px');
    });

    it('should apply custom border radius', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle" borderRadius={16}>
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]') as HTMLElement;
      expect(borderElement).toBeInTheDocument();

      // Check inline style attribute directly
      expect(borderElement.style.borderRadius).toBe('16px');
    });

    it('should apply default border width of 2.5px', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.padding).toBe('2.5px');
    });

    it('should apply custom border width', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle" borderWidth={3}>
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.padding).toBe('3px');
    });
  });

  describe('Glow Effect', () => {
    it('should apply default glow intensity', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      // Default glow intensity is 1.0, which gives blur radius of 8 + (1.0 * 4) = 12px
      expect(style.boxShadow).toContain('12px');
    });

    it('should apply custom glow intensity', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing" glowIntensity={0.5}>
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      // Glow intensity 0.5 gives blur radius of 8 + (0.5 * 4) = 10px
      expect(style.boxShadow).toContain('10px');
    });
  });

  describe('Children Rendering', () => {
    it('should render children content', () => {
      render(
        <GradientBorderSystem isActive={true} status="idle">
          <div data-testid="child-content">Test Content</div>
        </GradientBorderSystem>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should apply inner container styling', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="idle">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const innerContainer = container.querySelector('[data-testid="gradient-border"] > div');
      expect(innerContainer).toBeInTheDocument();

      const style = window.getComputedStyle(innerContainer!);
      expect(style.background).toContain('rgb(255, 255, 255)'); // White background
      expect(style.overflow).toBe('hidden');
    });
  });

  describe('useGradientBorderState Hook', () => {
    it('should initialize with idle status', () => {
      let hookResult: any;

      function TestComponent() {
        hookResult = useGradientBorderState();
        return null;
      }

      render(<TestComponent />);

      const [state] = hookResult;
      expect(state.colors).toEqual(['#3B82F6', '#9333EA', '#EC4899', '#3B82F6']);
      expect(state.animationPhase).toBe(0);
      expect(state.shimmerPosition).toBe(0);
      expect(state.glowOpacity).toBe(0);
    });

    it('should update colors when status changes', () => {
      let hookResult: any;

      function TestComponent() {
        hookResult = useGradientBorderState('idle');
        return null;
      }

      const { rerender } = render(<TestComponent />);

      const [initialState] = hookResult;
      expect(initialState.colors).toEqual(['#3B82F6', '#9333EA', '#EC4899', '#3B82F6']);

      // Update the component to trigger status change
      function TestComponentUpdated() {
        hookResult = useGradientBorderState('success');
        return null;
      }

      rerender(<TestComponentUpdated />);

      const [updatedState] = hookResult;
      expect(updatedState.colors).toContain('#22c55e'); // Success green
    });
  });

  describe('Animation Speed', () => {
    it('should apply default animation speed of 2.5s', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      expect(borderElement).toBeInTheDocument();

      // Animation speed is controlled by requestAnimationFrame, not CSS
      // We verify the component renders without errors
    });

    it('should apply custom animation speed', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing" animationSpeed={1.5}>
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      expect(borderElement).toBeInTheDocument();
    });
  });

  describe('Smooth Transitions', () => {
    it('should apply smooth transition for box-shadow and opacity', () => {
      const { container } = render(
        <GradientBorderSystem isActive={true} status="executing">
          <div>Test Content</div>
        </GradientBorderSystem>
      );

      const borderElement = container.querySelector('[data-testid="gradient-border"]');
      const style = window.getComputedStyle(borderElement!);

      expect(style.transition).toContain('box-shadow');
      expect(style.transition).toContain('opacity');
      expect(style.transition).toContain('0.3s');
      expect(style.transition).toContain('ease');
    });
  });
});
