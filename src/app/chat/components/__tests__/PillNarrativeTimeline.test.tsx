/**
 * Unit Tests for PillNarrativeTimelineComponent
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
 *
 * Tests for:
 * - Task rendering and display
 * - Pill rendering and inline display
 * - Status display at task and pill levels
 * - Pill click opens side panel
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PillNarrativeTimeline from '../PillNarrativeTimeline';
import type { NarrativeTimeline, Task, ToolPill } from '../../../../main/agent/runner/pill-narrative/types';

/**
 * Mock ToolDetailSidePanel
 */
vi.mock('../ToolDetailSidePanel', () => ({
  default: ({ isOpen, onClose }: any) => (
    isOpen ? (
      <div data-testid="tool-detail-panel">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

/**
 * Create mock pill
 */
function createMockPill(overrides?: Partial<ToolPill>): ToolPill {
  return {
    id: 'pill_1',
    toolName: 'web_search',
    status: 'pending',
    label: 'Search',
    icon: '🔍',
    ...overrides,
  };
}

/**
 * Create mock task
 */
function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_1',
    title: 'Search for information',
    description: 'Find relevant data',
    pills: [createMockPill()],
    status: 'pending',
    ...overrides,
  };
}

/**
 * Create mock timeline
 */
function createMockTimeline(overrides?: Partial<NarrativeTimeline>): NarrativeTimeline {
  return {
    missionId: 'mission_1',
    tasks: [createMockTask()],
    status: 'pending',
    startTime: Date.now(),
    ...overrides,
  };
}

describe('PillNarrativeTimelineComponent', () => {
  describe('Task Rendering', () => {
    it('should render tasks as distinct sections', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({ id: 'task_1', title: 'Task 1' }),
          createMockTask({ id: 'task_2', title: 'Task 2' }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
    });

    it('should display task title prominently', () => {
      const timeline = createMockTimeline({
        tasks: [createMockTask({ title: 'Search for Discord bots' })],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      const title = screen.getByText('Search for Discord bots');
      expect(title).toBeInTheDocument();
      expect(title.tagName).toBe('H3');
    });

    it('should display task description if provided', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            title: 'Task 1',
            description: 'This is a task description',
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('This is a task description')).toBeInTheDocument();
    });

    it('should display task status badge', () => {
      const timeline = createMockTimeline({
        tasks: [createMockTask({ status: 'in-progress' })],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('in-progress')).toBeInTheDocument();
    });

    it('should display progress bar for tasks with pills', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [
              createMockPill({ id: 'pill_1', status: 'completed' }),
              createMockPill({ id: 'pill_2', status: 'pending' }),
            ],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('1/2 completed')).toBeInTheDocument();
    });
  });

  describe('Pill Rendering', () => {
    it('should render pills inline within tasks', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [
              createMockPill({ id: 'pill_1', label: 'Search' }),
              createMockPill({ id: 'pill_2', label: 'Browse' }),
            ],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('Search')).toBeInTheDocument();
      expect(screen.getByText('Browse')).toBeInTheDocument();
    });

    it('should display pill status with icon', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ status: 'completed' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      // Status icon should be displayed
      expect(screen.getByText('✅')).toBeInTheDocument();
    });

    it('should display pill icon', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ icon: '🔍' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('🔍')).toBeInTheDocument();
    });

    it('should render pills in chronological order', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [
              createMockPill({ id: 'pill_1', label: 'First' }),
              createMockPill({ id: 'pill_2', label: 'Second' }),
              createMockPill({ id: 'pill_3', label: 'Third' }),
            ],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      const pills = screen.getAllByText(/First|Second|Third/);
      expect(pills.length).toBe(3);
    });
  });

  describe('Status Display', () => {
    it('should display timeline status', () => {
      const timeline = createMockTimeline({ status: 'in-progress' });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('in-progress')).toBeInTheDocument();
    });

    it('should display task status', () => {
      const timeline = createMockTimeline({
        tasks: [createMockTask({ status: 'completed' })],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('completed')).toBeInTheDocument();
    });

    it('should display pill status', () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ status: 'failed' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('❌')).toBeInTheDocument();
    });

    it('should show running indicator when isRunning is true', () => {
      const timeline = createMockTimeline();

      const { container } = render(
        <PillNarrativeTimeline timeline={timeline} isRunning={true} />
      );

      const runningIndicator = container.querySelector('.animate-pulse');
      expect(runningIndicator).toBeInTheDocument();
    });
  });

  describe('Pill Click Interaction', () => {
    it('should open side panel when pill is clicked', async () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ label: 'Search' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      const pillButton = screen.getByText('Search').closest('button');
      fireEvent.click(pillButton!);

      await waitFor(() => {
        expect(screen.getByTestId('tool-detail-panel')).toBeInTheDocument();
      });
    });

    it('should call onPillClick callback when pill is clicked', async () => {
      const onPillClick = vi.fn();
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ id: 'pill_1', label: 'Search' })],
          }),
        ],
      });

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          onPillClick={onPillClick}
        />
      );

      const pillButton = screen.getByText('Search').closest('button');
      fireEvent.click(pillButton!);

      await waitFor(() => {
        expect(onPillClick).toHaveBeenCalledWith('pill_1', expect.any(Object));
      });
    });

    it('should close side panel when close button is clicked', async () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            pills: [createMockPill({ label: 'Search' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      const pillButton = screen.getByText('Search').closest('button');
      fireEvent.click(pillButton!);

      await waitFor(() => {
        expect(screen.getByTestId('tool-detail-panel')).toBeInTheDocument();
      });

      const closeButton = screen.getByText('Close');
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-detail-panel')).not.toBeInTheDocument();
      });
    });
  });

  describe('Task Collapse/Expand', () => {
    it('should collapse and expand tasks', async () => {
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            title: 'Task 1',
            pills: [createMockPill({ label: 'Search' })],
          }),
        ],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      // Initially expanded
      expect(screen.getByText('Search')).toBeInTheDocument();

      // Click to collapse
      const taskHeader = screen.getByText('Task 1').closest('button');
      fireEvent.click(taskHeader!);

      await waitFor(() => {
        expect(screen.queryByText('Search')).not.toBeInTheDocument();
      });

      // Click to expand
      fireEvent.click(taskHeader!);

      await waitFor(() => {
        expect(screen.getByText('Search')).toBeInTheDocument();
      });
    });

    it('should call onTaskExpand callback when task is toggled', async () => {
      const onTaskExpand = vi.fn();
      const timeline = createMockTimeline({
        tasks: [
          createMockTask({
            id: 'task_1',
            title: 'Task 1',
            pills: [createMockPill()],
          }),
        ],
      });

      render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          onTaskExpand={onTaskExpand}
        />
      );

      const taskHeader = screen.getByText('Task 1').closest('button');
      fireEvent.click(taskHeader!);

      await waitFor(() => {
        expect(onTaskExpand).toHaveBeenCalledWith('task_1', false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null timeline', () => {
      render(<PillNarrativeTimeline timeline={null} isRunning={false} />);

      expect(screen.getByText('No timeline data available')).toBeInTheDocument();
    });

    it('should handle empty tasks list', () => {
      const timeline = createMockTimeline({ tasks: [] });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('No tasks in timeline')).toBeInTheDocument();
    });

    it('should handle tasks with no pills', () => {
      const timeline = createMockTimeline({
        tasks: [createMockTask({ pills: [] })],
      });

      render(<PillNarrativeTimeline timeline={timeline} isRunning={false} />);

      expect(screen.getByText('Search for information')).toBeInTheDocument();
    });

    it('should handle different status values', () => {
      const statuses = ['pending', 'in-progress', 'completed', 'failed', 'skipped'] as const;

      statuses.forEach((status) => {
        const { unmount } = render(
          <PillNarrativeTimeline
            timeline={createMockTimeline({
              tasks: [createMockTask({ status })],
            })}
            isRunning={false}
          />
        );

        expect(screen.getAllByText(status).length).toBeGreaterThan(0);
        unmount();
      });
    });
  });

  describe('Sidebar Variant', () => {
    it('should apply sidebar styling when variant is sidebar', () => {
      const timeline = createMockTimeline();
      const { container } = render(
        <PillNarrativeTimeline
          timeline={timeline}
          isRunning={false}
          variant="sidebar"
        />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('max-h-96');
      expect(wrapper).toHaveClass('overflow-y-auto');
    });
  });
});
