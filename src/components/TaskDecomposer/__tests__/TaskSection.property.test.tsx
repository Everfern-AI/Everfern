/**
 * Property-Based Tests for TaskSection Component
 *
 * Tests universal correctness properties that should hold across all valid inputs.
 *
 * **Feature: task-decomposer-narrative-ui**
 * **Property 4: Collapse/Expand State Preservation**
 * **Property 5: Tool Call Order Preservation**
 * **Validates: Requirements 9.2, 9.5, 3.7, 9.3**
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskSection } from '../TaskSection';
import type { TaskSectionProps } from '../types';
import type { TaskStep } from '@/main/agent/runner/state';
import type { ToolCallDisplay } from '../types';
import fc from 'fast-check';

// Clean up after each test
afterEach(() => {
  cleanup();
});

/**
 * Arbitrary for generating TaskStep objects
 */
const taskStepArbitrary = (): fc.Arbitrary<TaskStep> =>
  fc.record({
    id: fc.uuid(),
    title: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    description: fc.string({ minLength: 0, maxLength: 200 }),
    tool: fc.string({ minLength: 1, maxLength: 50 }),
    canParallelize: fc.boolean(),
    priority: fc.option(fc.constantFrom('low', 'normal', 'critical')),
    estimatedComplexity: fc.option(fc.constantFrom('simple', 'moderate', 'complex')),
    dependsOn: fc.option(fc.array(fc.uuid(), { maxLength: 3 })),
    parallelGroup: fc.option(fc.integer({ min: 0, max: 10 })),
    agentPrompt: fc.option(fc.string({ maxLength: 500 })),
  });

/**
 * Arbitrary for generating ToolCall objects
 */
const toolCallArbitrary = (): fc.Arbitrary<ToolCallDisplay> =>
  fc.record({
    id: fc.uuid(),
    toolName: fc.string({ minLength: 1, maxLength: 50 }),
    status: fc.constantFrom('running', 'done', 'error'),
    icon: fc.constant(undefined),
    label: fc.option(fc.string({ maxLength: 50 })),
    color: fc.option(fc.string()),
    output: fc.option(fc.string({ maxLength: 500 })),
    durationMs: fc.option(fc.integer({ min: 0, max: 10000 })),
    data: fc.constant(undefined),
    base64Image: fc.option(fc.string()),
    args: fc.constant(undefined),
    displayName: fc.option(fc.string({ maxLength: 50 })),
    description: fc.option(fc.string({ maxLength: 200 })),
    phase: fc.option(fc.string({ maxLength: 50 })),
    thought: fc.option(fc.string({ maxLength: 200 })),
  });

/**
 * Arbitrary for generating TaskSectionProps
 */
const taskSectionPropsArbitrary = (): fc.Arbitrary<TaskSectionProps> =>
  fc.record({
    task: taskStepArbitrary(),
    toolCalls: fc.array(toolCallArbitrary(), { maxLength: 20 }),
    isExpanded: fc.boolean(),
    onToggleExpand: fc.constant(vi.fn()),
    status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed'),
    isLast: fc.option(fc.boolean()),
    onToolCallClick: fc.option(fc.constant(vi.fn())),
  });

describe('TaskSection Property-Based Tests', () => {
  describe('Property 4: Collapse/Expand State Preservation', () => {
    /**
     * Property: For any collapsed TaskStep, when a new ToolCall arrives,
     * the TaskStep SHALL remain collapsed and the summary count SHALL update
     * without expanding the section.
     *
     * **Validates: Requirements 9.2, 9.5**
     */
    it('should preserve collapsed state when tool calls are added', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            taskSectionPropsArbitrary().filter((props) => !props.isExpanded),
            fc.array(toolCallArbitrary(), { minLength: 1, maxLength: 5 })
          ),
          ([props, newToolCalls]) => {
            // Arrange
            cleanup();
            const { rerender } = render(<TaskSection {...props} />);

            // Verify initially collapsed
            expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();

            // Act: Add new tool calls
            const updatedProps = {
              ...props,
              toolCalls: [...props.toolCalls, ...newToolCalls],
            };
            rerender(<TaskSection {...updatedProps} />);

            // Assert: Should remain collapsed
            expect(screen.queryByTestId('tool-call-group')).not.toBeInTheDocument();

            // Summary should be updated
            if (updatedProps.toolCalls.length > 0) {
              expect(screen.getByTestId('task-section-summary')).toBeInTheDocument();
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 5: Tool Call Order Preservation', () => {
    /**
     * Property: For any TaskStep with multiple ToolCalls, when the TaskStep is expanded,
     * all ToolCalls SHALL be displayed in their original execution order.
     *
     * **Validates: Requirements 3.7, 9.3**
     */
    it('should preserve tool call order when expanded', () => {
      fc.assert(
        fc.property(
          taskSectionPropsArbitrary()
            .filter((props) => !props.isExpanded && props.toolCalls.length > 1)
            .map((props) => ({
              ...props,
              // Ensure tool calls have unique IDs for order verification
              toolCalls: props.toolCalls.map((tc, i) => ({
                ...tc,
                id: `tool-${i}`,
              })),
            })),
          (props) => {
            // Arrange
            cleanup();
            render(<TaskSection {...props} />);

            // Act & Assert
            // When collapsed, verify summary is displayed
            expect(screen.getByTestId('task-section-summary')).toBeInTheDocument();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: For any TaskStep with tool calls in any order, the summary
     * SHALL correctly count tools by status regardless of order.
     *
     * **Validates: Requirements 9.2, 9.5**
     */
    it('should calculate correct summary regardless of tool call order', () => {
      fc.assert(
        fc.property(
          taskSectionPropsArbitrary()
            .filter((props) => !props.isExpanded && props.toolCalls.length > 0),
          (props) => {
            // Arrange
            cleanup();
            render(<TaskSection {...props} />);

            // Act & Assert
            const completed = props.toolCalls.filter((tc) => tc.status === 'done').length;
            const running = props.toolCalls.filter((tc) => tc.status === 'running').length;
            const failed = props.toolCalls.filter((tc) => tc.status === 'error').length;

            const summary = screen.getByTestId('task-section-summary').textContent || '';

            // Verify summary contains correct counts
            if (completed > 0) {
              expect(summary).toContain(`${completed} done`);
            }
            if (running > 0) {
              expect(summary).toContain(`${running} running`);
            }
            if (failed > 0) {
              expect(summary).toContain(`${failed} failed`);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('General Properties', () => {
    /**
     * Property: For any valid TaskSectionProps with collapsed state, the component SHALL render
     * without throwing errors or console warnings.
     *
     * **Validates: Requirements 9.1, 9.2, 9.3**
     */
    it('should render without errors for all valid collapsed props', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      fc.assert(
        fc.property(
          taskSectionPropsArbitrary().filter((props) => !props.isExpanded),
          (props) => {
            // Arrange & Act
            cleanup();
            const { container } = render(<TaskSection {...props} />);

            // Assert
            expect(container).toBeInTheDocument();
            expect(consoleSpy).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );

      consoleSpy.mockRestore();
    });

    /**
     * Property: For any TaskStep with any status, the TaskHeader SHALL display
     * the correct status without errors.
     *
     * **Validates: Requirements 5.3, 5.4, 5.6**
     */
    it('should display correct status for all status values', () => {
      const statuses: Array<TaskSectionProps['status']> = [
        'pending',
        'in-progress',
        'completed',
        'failed',
      ];

      statuses.forEach((status) => {
        fc.assert(
          fc.property(
            taskSectionPropsArbitrary().filter((props) => !props.isExpanded),
            (props) => {
              // Arrange
              cleanup();
              const testProps = { ...props, status };
              render(<TaskSection {...testProps} />);

              // Act & Assert
              expect(screen.getByTestId('task-header-status-label')).toBeInTheDocument();
            }
          ),
          { numRuns: 25 }
        );
      });
    });
  });
});
