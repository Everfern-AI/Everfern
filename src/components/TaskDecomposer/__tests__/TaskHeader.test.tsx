/**
 * Unit Tests for TaskHeader Component
 *
 * Tests rendering, metadata display, status indicators, and user interactions.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskHeader } from '../TaskHeader';
import type { TaskHeaderProps } from '../types';
import type { TaskStep } from '@/main/agent/runner/state';

/**
 * Helper to create a mock TaskStep
 */
const createMockTaskStep = (overrides?: Partial<TaskStep>): TaskStep => ({
  id: 'step-1',
  title: 'Test Task',
  description: 'Test task description',
  tool: 'test-tool',
  canParallelize: false,
  ...overrides,
});

/**
 * Helper to create TaskHeaderProps
 */
const createProps = (overrides?: Partial<TaskHeaderProps>): TaskHeaderProps => ({
  task: createMockTaskStep(),
  toolCount: 3,
  isExpanded: true,
  onToggleExpand: vi.fn(),
  status: 'pending',
  ...overrides,
});

describe('TaskHeader Component', () => {
  describe('Rendering', () => {
    it('should render task header with title', () => {
      const props = createProps({
        task: createMockTaskStep({ title: 'My Task' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header')).toBeInTheDocument();
      expect(screen.getByTestId('task-header-title')).toHaveTextContent('My Task');
    });

    it('should render with description when title is missing', () => {
      const props = createProps({
        task: createMockTaskStep({ title: undefined, description: 'Task description' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-title')).toHaveTextContent('Task description');
    });

    it('should render "Unnamed Task" when both title and description are missing', () => {
      const props = createProps({
        task: createMockTaskStep({ title: undefined, description: '' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-title')).toHaveTextContent('Unnamed Task');
    });

    it('should render chevron icon', () => {
      const props = createProps();
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-chevron')).toBeInTheDocument();
    });

    it('should render status indicator dot', () => {
      const props = createProps();
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-status-indicator')).toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    it('should display pending status', () => {
      const props = createProps({ status: 'pending' });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Pending');
    });

    it('should display in-progress status', () => {
      const props = createProps({ status: 'in-progress' });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('In Progress');
    });

    it('should display completed status', () => {
      const props = createProps({ status: 'completed' });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Completed');
    });

    it('should display failed status', () => {
      const props = createProps({ status: 'failed' });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Failed');
    });

    it('should apply correct styling for pending status', () => {
      const props = createProps({ status: 'pending' });
      const { container } = render(<TaskHeader {...props} />);

      const header = container.querySelector('[data-testid="task-header"]');
      expect(header).toHaveClass('bg-slate-50');
    });

    it('should apply correct styling for in-progress status', () => {
      const props = createProps({ status: 'in-progress' });
      const { container } = render(<TaskHeader {...props} />);

      const header = container.querySelector('[data-testid="task-header"]');
      expect(header).toHaveClass('bg-blue-50');
    });

    it('should apply correct styling for completed status', () => {
      const props = createProps({ status: 'completed' });
      const { container } = render(<TaskHeader {...props} />);

      const header = container.querySelector('[data-testid="task-header"]');
      expect(header).toHaveClass('bg-green-50');
    });

    it('should apply correct styling for failed status', () => {
      const props = createProps({ status: 'failed' });
      const { container } = render(<TaskHeader {...props} />);

      const header = container.querySelector('[data-testid="task-header"]');
      expect(header).toHaveClass('bg-red-50');
    });
  });

  describe('Metadata Display', () => {
    it('should display tool count badge', () => {
      const props = createProps({ toolCount: 5 });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-tool-count')).toHaveTextContent('5 tools');
    });

    it('should display singular "tool" for single tool', () => {
      const props = createProps({ toolCount: 1 });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-tool-count')).toHaveTextContent('1 tool');
    });

    it('should display complexity metadata when available', () => {
      const props = createProps({
        metadata: { estimatedComplexity: 'complex' },
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-complexity')).toHaveTextContent('complex');
    });

    it('should display priority metadata when available', () => {
      const props = createProps({
        metadata: { priority: 'critical' },
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-priority')).toHaveTextContent('critical');
    });

    it('should display execution mode metadata when available', () => {
      const props = createProps({
        metadata: { executionMode: 'parallel' },
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-execution-mode')).toHaveTextContent('parallel');
    });

    it('should display all metadata when available', () => {
      const props = createProps({
        metadata: {
          estimatedComplexity: 'moderate',
          priority: 'normal',
          executionMode: 'sequential',
        },
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-complexity')).toBeInTheDocument();
      expect(screen.getByTestId('task-header-priority')).toBeInTheDocument();
      expect(screen.getByTestId('task-header-execution-mode')).toBeInTheDocument();
    });

    it('should not display metadata badges when metadata is not provided', () => {
      const props = createProps({ metadata: undefined });
      render(<TaskHeader {...props} />);

      expect(screen.queryByTestId('task-header-complexity')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-header-priority')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-header-execution-mode')).not.toBeInTheDocument();
    });

    it('should not display metadata badges when metadata fields are empty', () => {
      const props = createProps({
        metadata: {
          estimatedComplexity: undefined,
          priority: undefined,
          executionMode: undefined,
        },
      });
      render(<TaskHeader {...props} />);

      expect(screen.queryByTestId('task-header-complexity')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-header-priority')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-header-execution-mode')).not.toBeInTheDocument();
    });
  });

  describe('Expand/Collapse', () => {
    it('should call onToggleExpand when clicked', () => {
      const onToggleExpand = vi.fn();
      const props = createProps({ onToggleExpand });
      render(<TaskHeader {...props} />);

      fireEvent.click(screen.getByTestId('task-header'));
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleExpand when Enter key is pressed', () => {
      const onToggleExpand = vi.fn();
      const props = createProps({ onToggleExpand });
      render(<TaskHeader {...props} />);

      fireEvent.keyDown(screen.getByTestId('task-header'), { key: 'Enter' });
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleExpand when Space key is pressed', () => {
      const onToggleExpand = vi.fn();
      const props = createProps({ onToggleExpand });
      render(<TaskHeader {...props} />);

      fireEvent.keyDown(screen.getByTestId('task-header'), { key: ' ' });
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });

    it('should rotate chevron when expanded', () => {
      const props = createProps({ isExpanded: true });
      const { container } = render(<TaskHeader {...props} />);

      const chevron = container.querySelector('[data-testid="task-header-chevron"]');
      expect(chevron).toHaveClass('rotate-0');
    });

    it('should rotate chevron when collapsed', () => {
      const props = createProps({ isExpanded: false });
      const { container } = render(<TaskHeader {...props} />);

      const chevron = container.querySelector('[data-testid="task-header-chevron"]');
      expect(chevron).toHaveClass('-rotate-90');
    });

    it('should set aria-expanded attribute correctly', () => {
      const props = createProps({ isExpanded: true });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header')).toHaveAttribute('aria-expanded', 'true');
    });

    it('should set aria-expanded to false when collapsed', () => {
      const props = createProps({ isExpanded: false });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Failure Handling', () => {
    it('should display failure reason when status is failed', () => {
      const props = createProps({
        status: 'failed',
        task: createMockTaskStep({ description: 'Connection timeout' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-failure-reason')).toHaveTextContent(
        'Connection timeout'
      );
    });

    it('should not display failure reason when status is not failed', () => {
      const props = createProps({
        status: 'completed',
        task: createMockTaskStep({ description: 'Some description' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.queryByTestId('task-header-failure-reason')).not.toBeInTheDocument();
    });

    it('should not display failure reason when description is empty', () => {
      const props = createProps({
        status: 'failed',
        task: createMockTaskStep({ description: '' }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.queryByTestId('task-header-failure-reason')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible', () => {
      const onToggleExpand = vi.fn();
      const props = createProps({ onToggleExpand });
      render(<TaskHeader {...props} />);

      const header = screen.getByTestId('task-header');
      expect(header).toHaveAttribute('role', 'button');
      expect(header).toHaveAttribute('tabIndex', '0');
    });

    it('should have proper ARIA attributes', () => {
      const props = createProps({ isExpanded: true });
      render(<TaskHeader {...props} />);

      const header = screen.getByTestId('task-header');
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('should have title attributes on metadata badges', () => {
      const props = createProps({
        metadata: {
          estimatedComplexity: 'complex',
          priority: 'critical',
          executionMode: 'parallel',
        },
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-complexity')).toHaveAttribute('title');
      expect(screen.getByTestId('task-header-priority')).toHaveAttribute('title');
      expect(screen.getByTestId('task-header-execution-mode')).toHaveAttribute('title');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long task titles', () => {
      const longTitle = 'A'.repeat(200);
      const props = createProps({
        task: createMockTaskStep({ title: longTitle }),
      });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-title')).toHaveClass('truncate');
    });

    it('should handle zero tool count', () => {
      const props = createProps({ toolCount: 0 });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-tool-count')).toHaveTextContent('0 tools');
    });

    it('should handle large tool counts', () => {
      const props = createProps({ toolCount: 999 });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header-tool-count')).toHaveTextContent('999 tools');
    });

    it('should handle isLast prop', () => {
      const props = createProps({ isLast: true });
      render(<TaskHeader {...props} />);

      expect(screen.getByTestId('task-header')).toBeInTheDocument();
    });
  });
});
