/**
 * Unit Tests for TimelineRenderer Component
 *
 * Tests rendering modes, hierarchical/flat rendering, and mixed mode handling.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TimelineRenderer } from '../TimelineRenderer';
import type { TimelineRendererProps } from '../types';
import type { DecomposedTask } from '@/main/agent/runner/state';
import type { ToolCallDisplay } from '../types';

/**
 * Helper to create a mock DecomposedTask
 */
const createMockDecomposedTask = (overrides?: Partial<DecomposedTask>): DecomposedTask => ({
  id: 'task-1',
  title: 'Test Task',
  steps: [
    {
      id: 'step-1',
      title: 'Step 1',
      description: 'First step',
      tool: 'tool-1',
      canParallelize: false,
    },
    {
      id: 'step-2',
      title: 'Step 2',
      description: 'Second step',
      tool: 'tool-2',
      canParallelize: false,
    },
  ],
  totalSteps: 2,
  canParallelize: false,
  executionMode: 'sequential',
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
 * Helper to create TimelineRendererProps
 */
const createProps = (overrides?: Partial<TimelineRendererProps>): TimelineRendererProps => ({
  toolCalls: [createMockToolCall()],
  decomposedTask: null,
  ...overrides,
});

describe('TimelineRenderer Component', () => {
  describe('Rendering Modes', () => {
    it('should render hierarchical timeline when decomposed task exists', async () => {
      const props = createProps({
        decomposedTask: createMockDecomposedTask(),
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
          createMockToolCall({ id: 'tool-2', toolName: 'tool-2' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });

    it('should render flat timeline when no decomposed task', () => {
      const props = createProps({
        decomposedTask: null,
        toolCalls: [createMockToolCall()],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });

    it('should render flat timeline when decomposed task has no steps', () => {
      const props = createProps({
        decomposedTask: createMockDecomposedTask({ steps: [] }),
        toolCalls: [createMockToolCall()],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });
  });

  describe('Hierarchical Rendering', () => {
    it('should render all task steps', async () => {
      const decomposedTask = createMockDecomposedTask({
        steps: [
          {
            id: 'step-1',
            title: 'Step 1',
            description: 'First step',
            tool: 'tool-1',
            canParallelize: false,
          },
          {
            id: 'step-2',
            title: 'Step 2',
            description: 'Second step',
            tool: 'tool-2',
            canParallelize: false,
          },
          {
            id: 'step-3',
            title: 'Step 3',
            description: 'Third step',
            tool: 'tool-3',
            canParallelize: false,
          },
        ],
      });

      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });

    it('should render task sections for each step', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getAllByTestId('task-section')).toHaveLength(2);
      });
    });

    it('should map tool calls to correct task steps', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
          createMockToolCall({ id: 'tool-2', toolName: 'tool-2' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });
  });

  describe('Flat Timeline Rendering', () => {
    it('should render all tool calls in flat mode', () => {
      const props = createProps({
        decomposedTask: null,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
          createMockToolCall({ id: 'tool-2', toolName: 'tool-2' }),
          createMockToolCall({ id: 'tool-3', toolName: 'tool-3' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('flat-tool-call-0')).toBeInTheDocument();
      expect(screen.getByTestId('flat-tool-call-1')).toBeInTheDocument();
      expect(screen.getByTestId('flat-tool-call-2')).toBeInTheDocument();
    });

    it('should display empty state when no tool calls', () => {
      const props = createProps({
        decomposedTask: null,
        toolCalls: [],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-empty')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-renderer-empty')).toHaveTextContent('No tool calls');
    });

    it('should display tool name and status', () => {
      const props = createProps({
        decomposedTask: null,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'my-tool', status: 'done' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('flat-tool-call-0')).toHaveTextContent('my-tool');
      expect(screen.getByTestId('flat-tool-call-0')).toHaveTextContent('done');
    });
  });

  describe('Unmapped Tool Calls', () => {
    it('should not display unmapped section when all tools are mapped', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
          createMockToolCall({ id: 'tool-2', toolName: 'tool-2' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.queryByTestId('timeline-renderer-unmapped')).not.toBeInTheDocument();
      });
    });

    it('should handle unmapped tool calls gracefully', async () => {
      const decomposedTask = createMockDecomposedTask({
        steps: [
          {
            id: 'step-1',
            title: 'Step 1',
            description: 'First step',
            tool: 'tool-1',
            canParallelize: false,
          },
        ],
      });

      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });
  });

  describe('Task Status Management', () => {
    it('should initialize all tasks as pending', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        const statusLabels = screen.getAllByTestId('task-header-status-label');
        statusLabels.forEach((label) => {
          expect(label).toHaveTextContent('Pending');
        });
      });
    });

    it('should update task status when tool call completes', async () => {
      const decomposedTask = createMockDecomposedTask();
      const { rerender } = render(
        <TimelineRenderer
          toolCalls={[]}
          decomposedTask={decomposedTask}
        />
      );

      // Add completed tool call
      await waitFor(() => {
        rerender(
          <TimelineRenderer
            toolCalls={[
              createMockToolCall({ id: 'tool-1', status: 'done' }),
            ]}
            decomposedTask={decomposedTask}
          />
        );
      });

      // Task should be marked as completed
      await waitFor(() => {
        const statusLabels = screen.getAllByTestId('task-header-status-label');
        expect(statusLabels[0]).toHaveTextContent('Completed');
      });
    });

    it('should update task status when tool call fails', async () => {
      const decomposedTask = createMockDecomposedTask();
      const { rerender } = render(
        <TimelineRenderer
          toolCalls={[]}
          decomposedTask={decomposedTask}
        />
      );

      // Add failed tool call
      await waitFor(() => {
        rerender(
          <TimelineRenderer
            toolCalls={[
              createMockToolCall({ id: 'tool-1', status: 'error' }),
            ]}
            decomposedTask={decomposedTask}
          />
        );
      });

      // Task should be marked as failed
      await waitFor(() => {
        const statusLabels = screen.getAllByTestId('task-header-status-label');
        expect(statusLabels[0]).toHaveTextContent('Failed');
      });
    });
  });

  describe('Expand/Collapse State', () => {
    it('should initialize all tasks as expanded', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        // Tool call groups should be visible (expanded)
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });
  });

  describe('Props Handling', () => {
    it('should handle isLive prop', () => {
      const props = createProps({ isLive: true });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });

    it('should handle onPillClick callback', async () => {
      const onPillClick = vi.fn();
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [createMockToolCall({ id: 'tool-1' })],
        onPillClick,
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });

    it('should handle thoughts prop', () => {
      const props = createProps({
        thoughts: [{ id: 'thought-1', content: 'Test thought' }],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });

    it('should handle plans prop', () => {
      const props = createProps({
        plans: [{ steps: [], title: 'Test Plan' }],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty decomposed task', () => {
      const props = createProps({
        decomposedTask: createMockDecomposedTask({ steps: [] }),
        toolCalls: [],
      });
      render(<TimelineRenderer {...props} />);

      expect(screen.getByTestId('timeline-renderer-flat')).toBeInTheDocument();
    });

    it('should handle large number of tasks', async () => {
      const steps = Array.from({ length: 50 }, (_, i) => ({
        id: `step-${i}`,
        title: `Step ${i}`,
        description: `Step ${i} description`,
        tool: `tool-${i}`,
        canParallelize: false,
      }));

      const decomposedTask = createMockDecomposedTask({
        steps,
        totalSteps: steps.length,
      });

      const toolCalls = steps.map((step, i) =>
        createMockToolCall({ id: `tool-${i}`, toolName: `tool-${i}` })
      );

      const props = createProps({
        decomposedTask,
        toolCalls,
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });

    it('should handle tool calls arriving out of order', async () => {
      const decomposedTask = createMockDecomposedTask();
      const props = createProps({
        decomposedTask,
        toolCalls: [
          createMockToolCall({ id: 'tool-2', toolName: 'tool-2' }),
          createMockToolCall({ id: 'tool-1', toolName: 'tool-1' }),
        ],
      });
      render(<TimelineRenderer {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('timeline-renderer-hierarchical')).toBeInTheDocument();
      });
    });
  });
});
