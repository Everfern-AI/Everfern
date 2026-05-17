/**
 * Integration Tests for PillNarrativeTimelineComponent UI Integration
 *
 * Tests the integration of the pill-based timeline component with the chat page.
 * Validates that the component renders correctly, responds to updates, and integrates
 * with the timeline manager.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PillNarrativeTimeline from '../PillNarrativeTimeline';
import type { NarrativeTimeline, Task, ToolPill } from '../../../../main/agent/runner/pill-narrative/types';

/**
 * Create a mock timeline for testing
 */
function createMockTimeline(): NarrativeTimeline {
  const pill1: ToolPill = {
    id: 'pill_1',
    toolName: 'web_search',
    status: 'pending',
    label: 'Search',
    icon: '🔍',
  };

  const pill2: ToolPill = {
    id: 'pill_2',
    toolName: 'browser_use',
    status: 'pending',
    label: 'Browse',
    icon: '🌐',
  };

  const task1: Task = {
    id: 'task_1',
    title: 'Search for information',
    description: 'Search the web for relevant information',
    pills: [pill1, pill2],
    status: 'pending',
  };

  const timeline: NarrativeTimeline = {
    missionId: 'mission_1',
    tasks: [task1],
    status: 'pending',
    startTime: Date.now(),
  };

  return timeline;
}

describe('PillNarrativeTimelineComponent Integration', () => {
  describe('Component Rendering', () => {
    it('should render timeline with tasks', () => {
      const timeline = createMockTimeline();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      expect(screen.getByText('Search for information')).toBeInTheDocument();
    });

    it('should render pills within tasks', () => {
      const timeline = createMockTimeline();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      expect(screen.getByText('Search')).toBeInTheDocument();
      expect(screen.getByText('Browse')).toBeInTheDocument();
    });

    it('should display task status', () => {
      const timeline = createMockTimeline();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Check for pending status in the task header
      const statusElements = screen.getAllByText(/pending/i);
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('should display running indicator when isRunning is true', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={true}
        />
      );

      // Check for animated pulse indicator
      const pulseElement = container.querySelector('.animate-pulse');
      expect(pulseElement).toBeInTheDocument();
    });

    it('should handle null timeline gracefully', () => {
      render(
        <PillNarrativeTimeline
          timeline={null}
          isRunning={false}
        />
      );

      expect(screen.getByText(/no timeline data available/i)).toBeInTheDocument();
    });
  });

  describe('Task Expansion/Collapse', () => {
    it('should expand task to show pills', async () => {
      const timeline = createMockTimeline();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Task should be expanded by default
      expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('should collapse task to hide pills', async () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Find and click the collapse button
      const collapseButton = container.querySelector('button');
      if (collapseButton) {
        fireEvent.click(collapseButton);

        // Pills should be hidden
        await waitFor(() => {
          expect(screen.queryByText('Search')).not.toBeInTheDocument();
        });
      }
    });

    it('should call onTaskExpand callback', async () => {
      const timeline = createMockTimeline();
      const onTaskExpand = vi.fn();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          onTaskExpand={onTaskExpand}
        />
      );

      // Find and click the collapse button
      const collapseButton = container.querySelector('button');
      if (collapseButton) {
        fireEvent.click(collapseButton);

        await waitFor(() => {
          expect(onTaskExpand).toHaveBeenCalled();
        });
      }
    });
  });

  describe('Pill Interaction', () => {
    it('should call onPillClick when pill is clicked', async () => {
      const timeline = createMockTimeline();
      const onPillClick = vi.fn();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          onPillClick={onPillClick}
        />
      );

      const pillButton = screen.getByText('Search');
      fireEvent.click(pillButton);

      await waitFor(() => {
        expect(onPillClick).toHaveBeenCalled();
      });
    });

    it('should display pill status visually', () => {
      const timeline = createMockTimeline();
      timeline.tasks[0].pills[0].status = 'in-progress';

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Check for in-progress styling
      const inProgressElement = container.querySelector('.animate-pulse');
      expect(inProgressElement).toBeInTheDocument();
    });

    it('should display completed pill with success styling', () => {
      const timeline = createMockTimeline();
      timeline.tasks[0].pills[0].status = 'completed';

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Check for completed styling (green)
      const completedElement = container.querySelector('.bg-green-100');
      expect(completedElement).toBeInTheDocument();
    });

    it('should display failed pill with error styling', () => {
      const timeline = createMockTimeline();
      timeline.tasks[0].pills[0].status = 'failed';

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Check for failed styling (red)
      const failedElement = container.querySelector('.bg-red-100');
      expect(failedElement).toBeInTheDocument();
    });
  });

  describe('Real-time Updates', () => {
    it('should update when timeline prop changes', async () => {
      const timeline1 = createMockTimeline();
      const { rerender } = render(
        <PillNarrativeTimeline
          timeline={timeline1}
          isRunning={false}
        />
      );

      expect(screen.getByText('Search for information')).toBeInTheDocument();

      // Update timeline
      const timeline2 = createMockTimeline();
      timeline2.tasks[0].pills[0].status = 'completed';

      rerender(
        <PillNarrativeTimeline
          timeline={timeline2}
          isRunning={false}
        />
      );

      // Should still render the task
      expect(screen.getByText('Search for information')).toBeInTheDocument();
    });

    it('should update pill status when timeline changes', async () => {
      const timeline1 = createMockTimeline();
      const { rerender, container } = render(
        <PillNarrativeTimeline
          timeline={timeline1}
          isRunning={false}
        />
      );

      // Update timeline with completed pill
      const timeline2 = createMockTimeline();
      timeline2.tasks[0].pills[0].status = 'completed';

      rerender(
        <PillNarrativeTimeline
          timeline={timeline2}
          isRunning={false}
        />
      );

      // Check for completed styling
      const completedElement = container.querySelector('.bg-green-100');
      expect(completedElement).toBeInTheDocument();
    });
  });

  describe('Progress Display', () => {
    it('should display progress bar for task with multiple pills', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Check for progress bar
      const progressBar = container.querySelector('.bg-gray-200');
      expect(progressBar).toBeInTheDocument();
    });

    it('should update progress bar as pills complete', async () => {
      const timeline = createMockTimeline();
      const { rerender, container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      // Complete first pill
      const timeline2 = createMockTimeline();
      timeline2.tasks[0].pills[0].status = 'completed';

      rerender(
        <PillNarrativeTimeline
          timeline={timeline2}
          isRunning={false}
        />
      );

      // Progress bar should show 50% completion
      const progressFill = container.querySelector('.bg-green-500');
      expect(progressFill).toBeInTheDocument();
    });
  });

  describe('Variant Support', () => {
    it('should render main variant', () => {
      const timeline = createMockTimeline();

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          variant="main"
        />
      );

      expect(screen.getByText('Search for information')).toBeInTheDocument();
    });

    it('should render sidebar variant with max-height', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          variant="sidebar"
        />
      );

      // Check for sidebar styling
      const sidebarContainer = container.firstChild;
      expect(sidebarContainer).toHaveClass('max-h-96');
    });
  });

  describe('Auto-collapse Feature', () => {
    it('should auto-collapse completed tasks', async () => {
      const timeline = createMockTimeline();
      timeline.tasks[0].status = 'completed';

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          autoCollapse={true}
        />
      );

      // Task should be collapsed
      await waitFor(() => {
        expect(screen.queryByText('Search')).not.toBeInTheDocument();
      });
    });

    it('should not auto-collapse when autoCollapse is false', () => {
      const timeline = createMockTimeline();
      timeline.tasks[0].status = 'completed';

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          autoCollapse={false}
        />
      );

      // Task should be expanded
      expect(screen.getByText('Search')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper button roles', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should have descriptive titles for pills', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
        />
      );

      const pills = container.querySelectorAll('[title]');
      expect(pills.length).toBeGreaterThan(0);
    });
  });
});
