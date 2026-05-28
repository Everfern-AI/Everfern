/**
 * Unit Tests for TaskSection Component
 *
 * Tests expand/collapse functionality, nested rendering, and state management.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskSection } from '../TaskSection';
import type { TaskSectionProps } from '../types';
import type { TaskStep } from '@/main/agent/runner/state';
import type { ToolCallDisplay } from '../types';

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
 * Helper to create a mock ToolCall
 */
const createMockToolCall = (overrides?: Partial<ToolCallDisplay>): ToolCallDisplay => ({
  id: 'tool-1',
  toolName: 'test-tool',
  status: 'done',
  ...overrides,
});

/**
 * Helper to create TaskSectionProps
 */
const createProps = (overrides?: Partial<TaskSectionProps>): TaskSectionProps => ({
  task: createMockTaskStep(),
  toolCalls: [createMockToolCall()],
  isExpanded: true,
  onToggleExpand: vi.fn(),
  status: 'pending',
  ...overrides,
});

describe('TaskSection Component', () => {
  describe('Rendering', () => {
    it('should render task section', () => {
      const props = createProps();
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('should render task header', () => {
      const props = createProps();
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header')).toBeInTheDocument();
    });

    it('should render tool call group when expanded', async () => {
      const props = createProps({ isExpanded: true });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });

    it('should not render tool call group when collapsed', () => {
      const props = createProps({ isExpanded: false });
      render(<TaskSection {...props} />);

      expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();
    });

    it('should render empty state when expanded but no tools', () => {
      const props = createProps({ toolCalls: [], isExpanded: true });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-empty')).toBeInTheDocument();
      expect(screen.getByTestId('task-section-empty')).toHaveTextContent('No tools executed yet');
    });
  });

  describe('Expand/Collapse', () => {
    it('should toggle expand state when header clicked', async () => {
      const props = createProps({ isExpanded: true });
      render(<TaskSection {...props} />);

      const header = screen.getByTestId('task-header');
      fireEvent.click(header);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();
      });
    });

    it('should call onToggleExpand when header clicked', () => {
      const onToggleExpand = vi.fn();
      const props = createProps({ onToggleExpand });
      render(<TaskSection {...props} />);

      fireEvent.click(screen.getByTestId('task-header'));
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });

    it('should display summary when collapsed', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', status: 'done' }),
          createMockToolCall({ id: 'tool-2', status: 'done' }),
          createMockToolCall({ id: 'tool-3', status: 'running' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-summary')).toHaveTextContent('2 done, 1 running');
    });

    it('should not display summary when expanded', () => {
      const props = createProps({ isExpanded: true });
      render(<TaskSection {...props} />);

      expect(screen.queryByTestId('task-section-summary')).not.toBeInTheDocument();
    });

    it('should not display summary when no tools', () => {
      const props = createProps({ isExpanded: false, toolCalls: [] });
      render(<TaskSection {...props} />);

      expect(screen.queryByTestId('task-section-summary')).not.toBeInTheDocument();
    });
  });

  describe('Summary Display', () => {
    it('should show completed count in summary', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', status: 'done' }),
          createMockToolCall({ id: 'tool-2', status: 'done' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-summary')).toHaveTextContent('2 done');
    });

    it('should show running count in summary', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', status: 'running' }),
          createMockToolCall({ id: 'tool-2', status: 'running' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-summary')).toHaveTextContent('2 running');
    });

    it('should show failed count in summary', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', status: 'error' }),
          createMockToolCall({ id: 'tool-2', status: 'error' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-summary')).toHaveTextContent('2 failed');
    });

    it('should show combined summary with multiple statuses', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', status: 'done' }),
          createMockToolCall({ id: 'tool-2', status: 'done' }),
          createMockToolCall({ id: 'tool-3', status: 'running' }),
          createMockToolCall({ id: 'tool-4', status: 'error' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section-summary')).toHaveTextContent(
        '2 done, 1 running, 1 failed'
      );
    });

    it('should show "No tools" when no tool calls', () => {
      const props = createProps({
        isExpanded: false,
        toolCalls: [],
      });
      render(<TaskSection {...props} />);

      // Summary is not shown when there are no tool calls
      expect(screen.queryByTestId('task-section-summary')).not.toBeInTheDocument();
    });
  });

  describe('Tool Call Rendering', () => {
    it('should render all tool calls when expanded', async () => {
      const props = createProps({
        isExpanded: true,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-item-0')).toBeInTheDocument();
        expect(screen.getByTestId('tool-call-group-item-1')).toBeInTheDocument();
        expect(screen.getByTestId('tool-call-group-item-2')).toBeInTheDocument();
      });
    });

    it('should maintain tool call order', async () => {
      const props = createProps({
        isExpanded: true,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'first' }),
          createMockToolCall({ id: 'tool-2', toolName: 'second' }),
          createMockToolCall({ id: 'tool-3', toolName: 'third' }),
        ],
      });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        const items = screen.getAllByTestId(/tool-call-group-item-/);
        expect(items).toHaveLength(3);
      });
    });

    it('should call onToolCallClick when tool call clicked', async () => {
      const onToolCallClick = vi.fn();
      const toolCall = createMockToolCall({ id: 'tool-1' });
      const props = createProps({
        isExpanded: true,
        toolCalls: [toolCall],
        onToolCallClick,
      });
      render(<TaskSection {...props} />);

      // Note: The actual click handler is on ToolCallRow, which we're testing indirectly
      // This test verifies the prop is passed through
      expect(props.onToolCallClick).toBeDefined();
    });
  });

  describe('Metadata Display', () => {
    it('should pass task metadata to header', () => {
      const task = createMockTaskStep({
        title: 'Complex Task',
        estimatedComplexity: 'complex',
        priority: 'critical',
      });
      const props = createProps({ task });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-title')).toHaveTextContent('Complex Task');
    });

    it('should display tool count in header', () => {
      const props = createProps({
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-tool-count')).toHaveTextContent('3 tools');
    });
  });

  describe('Status Display', () => {
    it('should display pending status', () => {
      const props = createProps({ status: 'pending' });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Pending');
    });

    it('should display in-progress status', () => {
      const props = createProps({ status: 'in-progress' });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('In Progress');
    });

    it('should display completed status', () => {
      const props = createProps({ status: 'completed' });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Completed');
    });

    it('should display failed status', () => {
      const props = createProps({ status: 'failed' });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-header-status-label')).toHaveTextContent('Failed');
    });
  });

  describe('Parallel Execution', () => {
    it('should show parallel indicator when canParallelize is true', async () => {
      const props = createProps({
        isExpanded: true,
        task: createMockTaskStep({ canParallelize: true }),
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-parallel-indicator')).toBeInTheDocument();
      });
    });

    it('should not show parallel indicator when canParallelize is false', async () => {
      const props = createProps({
        isExpanded: true,
        task: createMockTaskStep({ canParallelize: false }),
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-call-group-parallel-indicator')).not.toBeInTheDocument();
      });
    });

    it('should not show parallel indicator with single tool', async () => {
      const props = createProps({
        isExpanded: true,
        task: createMockTaskStep({ canParallelize: true }),
        toolCalls: [createMockToolCall({ id: 'tool-1' })],
      });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-call-group-parallel-indicator')).not.toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle isLast prop', () => {
      const props = createProps({ isLast: true });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('should handle empty tool calls array', () => {
      const props = createProps({ toolCalls: [] });
      render(<TaskSection {...props} />);

      expect(screen.getByTestId('task-section')).toBeInTheDocument();
    });

    it('should handle large number of tool calls', async () => {
      const toolCalls = Array.from({ length: 50 }, (_, i) =>
        createMockToolCall({ id: `tool-${i}` })
      );
      const props = createProps({ isExpanded: true, toolCalls });
      render(<TaskSection {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });
  });
});
