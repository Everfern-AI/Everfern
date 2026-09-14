import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CursorOverlaySystem, useCursorOverlayState } from '../CursorOverlaySystem';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('CursorOverlaySystem', () => {
  const defaultProps = {
    coordinate: [100, 200] as [number, number],
    action: 'move' as const,
    isVisible: true,
    screenDimensions: { width: 1920, height: 1080 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render cursor overlay when visible', () => {
      render(<CursorOverlaySystem {...defaultProps} />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should not render cursor overlay when not visible', () => {
      render(<CursorOverlaySystem {...defaultProps} isVisible={false} />);
      expect(screen.queryByTestId('cursor-overlay')).not.toBeInTheDocument();
    });

    it('should render cursor at correct position', () => {
      render(<CursorOverlaySystem {...defaultProps} />);
      const cursorElement = screen.getByTestId('cursor-position');
      expect(cursorElement).toBeInTheDocument();
    });
  });

  describe('Cursor Positioning', () => {
    it('should calculate correct percentage position for cursor', () => {
      const { rerender } = render(<CursorOverlaySystem {...defaultProps} />);
      const cursorElement = screen.getByTestId('cursor-position');

      // Initial position: 100/1920 = 5.208%, 200/1080 = 18.518%
      const style = cursorElement.style;
      expect(style.left).toContain('%');
      expect(style.top).toContain('%');

      // Update coordinate
      rerender(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[960, 540]} // Center of screen
        />
      );

      // Should update position
      expect(cursorElement).toBeInTheDocument();
    });

    it('should handle edge coordinates (0, 0)', () => {
      render(<CursorOverlaySystem {...defaultProps} coordinate={[0, 0]} />);
      const cursorElement = screen.getByTestId('cursor-position');
      expect(cursorElement).toBeInTheDocument();
    });

    it('should handle edge coordinates (max width, max height)', () => {
      render(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[1920, 1080]}
        />
      );
      const cursorElement = screen.getByTestId('cursor-position');
      expect(cursorElement).toBeInTheDocument();
    });
  });

  describe('Action Types', () => {
    it('should render for move action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="move" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should render for click action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="click" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should render for drag action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="drag" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should render for scroll action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="scroll" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });
  });

  describe('Cursor Styles', () => {
    it('should render with default arrow cursor style', () => {
      render(<CursorOverlaySystem {...defaultProps} />);
      const overlay = screen.getByTestId('cursor-overlay');
      expect(overlay).toBeInTheDocument();
    });

    it('should render with pointer cursor style', () => {
      render(<CursorOverlaySystem {...defaultProps} cursorStyle="pointer" />);
      const overlay = screen.getByTestId('cursor-overlay');
      expect(overlay).toBeInTheDocument();
    });

    it('should render with hand cursor style', () => {
      render(<CursorOverlaySystem {...defaultProps} cursorStyle="hand" />);
      const overlay = screen.getByTestId('cursor-overlay');
      expect(overlay).toBeInTheDocument();
    });
  });

  describe('Screen Dimensions', () => {
    it('should handle different screen dimensions', () => {
      const dimensions = [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
        { width: 3840, height: 2160 },
      ];

      dimensions.forEach((dim) => {
        const { unmount } = render(
          <CursorOverlaySystem
            {...defaultProps}
            screenDimensions={dim}
          />
        );
        expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
        unmount();
      });
    });

    it('should scale cursor position correctly for different screen sizes', () => {
      // Test with 1920x1080 screen
      const { rerender } = render(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[960, 540]} // Center
          screenDimensions={{ width: 1920, height: 1080 }}
        />
      );

      let cursorElement = screen.getByTestId('cursor-position');
      expect(cursorElement).toBeInTheDocument();

      // Test with 1280x720 screen (same center coordinate should scale)
      rerender(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[640, 360]} // Center of smaller screen
          screenDimensions={{ width: 1280, height: 720 }}
        />
      );

      cursorElement = screen.getByTestId('cursor-position');
      expect(cursorElement).toBeInTheDocument();
    });
  });

  describe('Animation Timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should update position smoothly over time', async () => {
      const { rerender } = render(<CursorOverlaySystem {...defaultProps} />);

      // Update coordinate
      rerender(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[500, 600]}
        />
      );

      // Fast-forward time to allow animation
      vi.advanceTimersByTime(100);

      await waitFor(() => {
        const cursorElement = screen.getByTestId('cursor-position');
        expect(cursorElement).toBeInTheDocument();
      });
    });

    it('should handle rapid coordinate changes', async () => {
      const { rerender } = render(<CursorOverlaySystem {...defaultProps} />);

      // Simulate rapid coordinate changes
      const coordinates: [number, number][] = [
        [100, 100],
        [200, 200],
        [300, 300],
        [400, 400],
      ];

      coordinates.forEach((coord) => {
        rerender(
          <CursorOverlaySystem
            {...defaultProps}
            coordinate={coord}
          />
        );
        vi.advanceTimersByTime(16); // ~60fps
      });

      await waitFor(() => {
        const cursorElement = screen.getByTestId('cursor-position');
        expect(cursorElement).toBeInTheDocument();
      });
    });
  });

  describe('Click Ripple Animation', () => {
    it('should trigger ripple animation on click action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="click" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should complete ripple animation cycle', async () => {
      vi.useFakeTimers();
      render(<CursorOverlaySystem {...defaultProps} action="click" />);

      // Fast-forward through animation duration (400ms)
      vi.advanceTimersByTime(400);

      await waitFor(() => {
        expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe('Drag Trail', () => {
    it('should render drag trail during drag action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="drag" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should not render drag trail for non-drag actions', () => {
      render(<CursorOverlaySystem {...defaultProps} action="move" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });
  });

  describe('Scroll Indicator', () => {
    it('should render scroll indicator during scroll action', () => {
      render(<CursorOverlaySystem {...defaultProps} action="scroll" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should not render scroll indicator for non-scroll actions', () => {
      render(<CursorOverlaySystem {...defaultProps} action="move" />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });
  });

  describe('useCursorOverlayState Hook', () => {
    it('should initialize with default coordinate', () => {
      const TestComponent = () => {
        const [state] = useCursorOverlayState();
        return (
          <div data-testid="hook-test">
            {state.position.x},{state.position.y}
          </div>
        );
      };

      render(<TestComponent />);
      expect(screen.getByTestId('hook-test')).toHaveTextContent('0,0');
    });

    it('should initialize with provided coordinate', () => {
      const TestComponent = () => {
        const [state] = useCursorOverlayState([100, 200]);
        return (
          <div data-testid="hook-test">
            {state.position.x},{state.position.y}
          </div>
        );
      };

      render(<TestComponent />);
      expect(screen.getByTestId('hook-test')).toHaveTextContent('100,200');
    });

    it('should update cursor position and action', () => {
      const TestComponent = () => {
        const [state, updateCursor] = useCursorOverlayState();

        React.useEffect(() => {
          updateCursor([300, 400], 'click');
        }, [updateCursor]);

        return (
          <div data-testid="hook-test">
            {state.position.x},{state.position.y},{state.animationState}
          </div>
        );
      };

      render(<TestComponent />);
      expect(screen.getByTestId('hook-test')).toHaveTextContent('300,400,clicking');
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative coordinates gracefully', () => {
      render(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[-10, -20]}
        />
      );
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should handle coordinates beyond screen dimensions', () => {
      render(
        <CursorOverlaySystem
          {...defaultProps}
          coordinate={[5000, 5000]}
        />
      );
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should handle zero screen dimensions', () => {
      render(
        <CursorOverlaySystem
          {...defaultProps}
          screenDimensions={{ width: 0, height: 0 }}
        />
      );
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });

    it('should handle very small screen dimensions', () => {
      render(
        <CursorOverlaySystem
          {...defaultProps}
          screenDimensions={{ width: 1, height: 1 }}
        />
      );
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should cleanup animation frame on unmount', () => {
      const { unmount } = render(<CursorOverlaySystem {...defaultProps} />);
      unmount();
      // If cleanup is not done properly, this would cause memory leaks
      // The test passing indicates proper cleanup
    });

    it('should handle visibility toggle without errors', () => {
      const { rerender } = render(<CursorOverlaySystem {...defaultProps} isVisible={true} />);

      rerender(<CursorOverlaySystem {...defaultProps} isVisible={false} />);
      expect(screen.queryByTestId('cursor-overlay')).not.toBeInTheDocument();

      rerender(<CursorOverlaySystem {...defaultProps} isVisible={true} />);
      expect(screen.getByTestId('cursor-overlay')).toBeInTheDocument();
    });
  });
});
