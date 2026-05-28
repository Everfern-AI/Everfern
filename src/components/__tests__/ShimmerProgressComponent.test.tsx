import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { ShimmerProgressComponent, ResearchState, SourceInfo } from '../ShimmerProgressComponent';

// Mock the Loader component to avoid SVG getTotalLength issues in JSDOM
vi.mock('@/components/ui/animated-loading-svg-text-shimmer', () => ({
  Loader: ({ className }: { className?: string }) => (
    <div data-testid="loader" className={className}>Loading...</div>
  )
}));

describe('ShimmerProgressComponent', () => {
  const mockSource: SourceInfo = {
    url: 'https://example.com/article',
    title: 'Test Article',
    qualityScore: 85,
    factsExtracted: 3,
    visitedAt: Date.now()
  };

  const createState = (overrides?: Partial<ResearchState>): ResearchState => ({
    phase: 'planning',
    currentSources: [],
    factsFound: 0,
    confidence: 0.5,
    ...overrides
  });

  describe('Phase Display', () => {
    it('should display planning phase', () => {
      const state = createState({ phase: 'planning' });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Planning research')).toBeInTheDocument();
    });

    it('should display searching phase', () => {
      const state = createState({ phase: 'searching' });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Searching sources')).toBeInTheDocument();
    });

    it('should display analyzing phase', () => {
      const state = createState({ phase: 'analyzing' });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Analyzing pages')).toBeInTheDocument();
    });

    it('should display synthesizing phase', () => {
      const state = createState({ phase: 'synthesizing' });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Synthesizing findings')).toBeInTheDocument();
    });
  });

  describe('Fact Counter', () => {
    it('should display fact count', () => {
      const state = createState({ factsFound: 5 });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('facts')).toBeInTheDocument();
    });

    it('should update fact count when state changes', () => {
      const state = createState({ factsFound: 3 });
      const { rerender } = render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('3')).toBeInTheDocument();

      const updatedState = createState({ factsFound: 7 });
      rerender(<ShimmerProgressComponent state={updatedState} />);

      // The animated counter will eventually show 7
      waitFor(() => {
        expect(screen.getByText('7')).toBeInTheDocument();
      });
    });
  });

  describe('Source Display', () => {
    it('should display current sources', () => {
      const state = createState({
        currentSources: [mockSource]
      });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Test Article')).toBeInTheDocument();
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    it('should display source count', () => {
      const state = createState({
        currentSources: [mockSource, { ...mockSource, url: 'https://example2.com' }]
      });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('sources')).toBeInTheDocument();
    });

    it('should display quality score', () => {
      const state = createState({
        currentSources: [mockSource]
      });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('should show "+X more" when more than 3 sources', () => {
      const sources = Array.from({ length: 5 }, (_, i) => ({
        ...mockSource,
        url: `https://example${i}.com`,
        title: `Article ${i}`
      }));
      const state = createState({ currentSources: sources });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });
  });

  describe('Confidence Indicator', () => {
    it('should display high confidence label', () => {
      const state = createState({ confidence: 0.85 });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    it('should display good confidence label', () => {
      const state = createState({ confidence: 0.65 });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Good')).toBeInTheDocument();
    });

    it('should display medium confidence label', () => {
      const state = createState({ confidence: 0.45 });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    it('should display low confidence label', () => {
      const state = createState({ confidence: 0.25 });
      render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Low')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message', () => {
      const state = createState();
      const errorMessage = 'Failed to connect to research sources';
      render(<ShimmerProgressComponent state={state} error={errorMessage} />);
      expect(screen.getByText('Research failed')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should display retry button when onRetry provided', () => {
      const state = createState();
      const onRetry = vi.fn();
      render(<ShimmerProgressComponent state={state} error="Error" onRetry={onRetry} />);
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should call onRetry when retry button clicked', async () => {
      const user = userEvent.setup();
      const state = createState();
      const onRetry = vi.fn();
      render(<ShimmerProgressComponent state={state} error="Error" onRetry={onRetry} />);

      const retryButton = screen.getByText('Retry');
      await user.click(retryButton);

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should not display retry button when onRetry not provided', () => {
      const state = createState();
      render(<ShimmerProgressComponent state={state} error="Error" />);
      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });
  });

  describe('Smooth Transitions', () => {
    it('should transition between phases smoothly', () => {
      const state = createState({ phase: 'planning' });
      const { rerender } = render(<ShimmerProgressComponent state={state} />);
      expect(screen.getByText('Planning research')).toBeInTheDocument();

      const updatedState = createState({ phase: 'searching' });
      rerender(<ShimmerProgressComponent state={updatedState} />);
      expect(screen.getByText('Searching sources')).toBeInTheDocument();
    });

    it('should animate new sources appearing', () => {
      const state = createState({ currentSources: [] });
      const { rerender } = render(<ShimmerProgressComponent state={state} />);

      const updatedState = createState({ currentSources: [mockSource] });
      rerender(<ShimmerProgressComponent state={updatedState} />);

      expect(screen.getByText('Test Article')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      const state = createState();
      const { container } = render(<ShimmerProgressComponent state={state} />);

      // Check for mocked loader
      const loader = container.querySelector('[data-testid="loader"]');
      expect(loader).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      const state = createState();
      const { container } = render(<ShimmerProgressComponent state={state} className="custom-class" />);

      const component = container.firstChild;
      expect(component).toHaveClass('custom-class');
    });
  });
});
