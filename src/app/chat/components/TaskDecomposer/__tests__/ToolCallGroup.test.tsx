/**
 * Unit Tests for ToolCallGroup Component
 *
 * Tests rendering, indentation, parallel indicators, and tool call integration.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ToolCallGroup } from '../ToolCallGroup';
import type { ToolCallGroupProps } from '../types';
import type { ToolCallDisplay } from '../types';

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
 * Helper to create ToolCallGroupProps
 */
const createProps = (overrides?: Partial<ToolCallGroupProps>): ToolCallGroupProps => ({
  toolCalls: [createMockToolCall()],
  isExpanded: true,
  canParallelize: false,
  ...overrides,
});

describe('ToolCallGroup Component', () => {
  describe('Rendering', () => {
    it('should render tool call group', async () => {
      const props = createProps();
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });

    it('should render tool call container', async () => {
      const props = createProps();
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-container')).toBeInTheDocument();
      });
    });

    it('should not render when not expanded', () => {
      const props = createProps({ isExpanded: false });
      render(<ToolCallGroup {...props} />);

      expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();
    });

    it('should not render when no tool calls', () => {
      const props = createProps({ toolCalls: [] });
      render(<ToolCallGroup {...props} />);

      expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();
    });
  });

  describe('Tool Call Rendering', () => {
    it('should render all tool calls', async () => {
      const props = createProps({
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-item-0')).toBeInTheDocument();
        expect(screen.getByTestId('tool-call-group-item-1')).toBeInTheDocument();
        expect(screen.getByTestId('tool-call-group-item-2')).toBeInTheDocument();
      });
    });

    it('should maintain tool call order', async () => {
      const props = createProps({
        toolCalls: [
          createMockToolCall({ id: 'tool-1', toolName: 'first' }),
          createMockToolCall({ id: 'tool-2', toolName: 'second' }),
          createMockToolCall({ id: 'tool-3', toolName: 'third' }),
        ],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        const items = screen.getAllByTestId(/tool-call-group-item-/);
        expect(items).toHaveLength(3);
      });
    });

    it('should render single tool call', async () => {
      const props = createProps({
        toolCalls: [createMockToolCall({ id: 'tool-1' })],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-item-0')).toBeInTheDocument();
      });
    });
  });

  describe('Indentation', () => {
    it('should apply indentation to tool call container', async () => {
      const props = createProps();
      const { container } = render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        const toolCallContainer = container.querySelector('[data-testid="tool-call-group-container"]');
        expect(toolCallContainer).toHaveClass('pl-6');
      });
    });

    it('should maintain consistent indentation for multiple tools', async () => {
      const props = createProps({
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      const { container } = render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        const toolCallContainer = container.querySelector('[data-testid="tool-call-group-container"]');
        expect(toolCallContainer).toHaveClass('pl-6');
      });
    });
  });

  describe('Parallel Execution Indicator', () => {
    it('should show parallel indicator when canParallelize is true and multiple tools', async () => {
      const props = createProps({
        canParallelize: true,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-parallel-indicator')).toBeInTheDocument();
      });
    });

    it('should display correct tool count in parallel indicator', async () => {
      const props = createProps({
        canParallelize: true,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
          createMockToolCall({ id: 'tool-3' }),
        ],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-parallel-indicator')).toHaveTextContent(
          '3 tools'
        );
      });
    });

    it('should not show parallel indicator when canParallelize is false', async () => {
      const props = createProps({
        canParallelize: false,
        toolCalls: [
          createMockToolCall({ id: 'tool-1' }),
          createMockToolCall({ id: 'tool-2' }),
        ],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-call-group-parallel-indicator')).not.toBeInTheDocument();
      });
    });

    it('should not show parallel indicator with single tool even if canParallelize is true', async () => {
      const props = createProps({
        canParallelize: true,
        toolCalls: [createMockToolCall({ id: 'tool-1' })],
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.queryByTestId('tool-call-group-parallel-indicator')).not.toBeInTheDocument();
      });
    });
  });

  describe('Tool Call Click Handling', () => {
    it('should pass onToolCallClick to tool calls', async () => {
      const onToolCallClick = vi.fn();
      const props = createProps({
        toolCalls: [createMockToolCall({ id: 'tool-1' })],
        onToolCallClick,
      });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group-item-0')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle isLast prop', async () => {
      const props = createProps({ isLast: true });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });

    it('should handle large number of tool calls', async () => {
      const toolCalls = Array.from({ length: 50 }, (_, i) =>
        createMockToolCall({ id: `tool-${i}` })
      );
      const props = createProps({ toolCalls });
      render(<ToolCallGroup {...props} />);

      await waitFor(() => {
        expect(screen.getByTestId('tool-call-group')).toBeInTheDocument();
      });
    });
  });
});
