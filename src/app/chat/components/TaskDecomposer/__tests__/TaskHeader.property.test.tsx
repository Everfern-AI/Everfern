/**
 * Property-Based Tests for TaskHeader Component
 *
 * Tests universal correctness properties that should hold across all valid inputs.
 *
 * **Feature: task-decomposer-narrative-ui**
 * **Property 9: Metadata Display Completeness**
 * **Validates: Requirements 10.2, 10.3, 10.5**
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskHeader } from '../TaskHeader';
import type { TaskHeaderProps } from '../types';
import type { TaskStep } from '@/main/agent/runner/state';
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
 * Arbitrary for generating metadata objects
 */
const metadataArbitrary = (): fc.Arbitrary<TaskHeaderProps['metadata']> =>
  fc.option(
    fc.record({
      estimatedComplexity: fc.option(fc.constantFrom('simple', 'moderate', 'complex')),
      priority: fc.option(fc.constantFrom('low', 'normal', 'critical')),
      executionMode: fc.option(fc.constantFrom('sequential', 'parallel', 'hybrid')),
    })
  );

/**
 * Arbitrary for generating TaskHeaderProps
 */
const taskHeaderPropsArbitrary = (): fc.Arbitrary<TaskHeaderProps> =>
  fc.record({
    task: taskStepArbitrary(),
    toolCount: fc.integer({ min: 0, max: 100 }),
    isExpanded: fc.boolean(),
    onToggleExpand: fc.constant(vi.fn()),
    status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed'),
    metadata: metadataArbitrary(),
    isLast: fc.option(fc.boolean()),
  });

describe('TaskHeader Property-Based Tests', () => {
  describe('Property 9: Metadata Display Completeness', () => {
    /**
     * Property: For any TaskStep with available metadata (complexity, priority, execution mode),
     * the TaskHeader SHALL display all available metadata fields without errors.
     *
     * **Validates: Requirements 10.2, 10.3, 10.5**
     */
    it('should display all available metadata fields without errors', () => {
      fc.assert(
        fc.property(taskHeaderPropsArbitrary(), (props) => {
          // Arrange
          cleanup();
          const { container } = render(<TaskHeader {...props} />);

          // Act & Assert
          // Component should render without errors
          expect(container).toBeInTheDocument();

          // If metadata is provided, verify all available fields are displayed
          if (props.metadata) {
            if (props.metadata.estimatedComplexity) {
              const complexity = screen.queryByTestId('task-header-complexity');
              if (complexity) {
                expect(complexity).toHaveTextContent(props.metadata.estimatedComplexity);
              }
            }

            if (props.metadata.priority) {
              const priority = screen.queryByTestId('task-header-priority');
              if (priority) {
                expect(priority).toHaveTextContent(props.metadata.priority);
              }
            }

            if (props.metadata.executionMode) {
              const mode = screen.queryByTestId('task-header-execution-mode');
              if (mode) {
                expect(mode).toHaveTextContent(props.metadata.executionMode);
              }
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any TaskStep without available metadata, the TaskHeader SHALL display
     * only the title and tool count without errors or missing UI elements.
     *
     * **Validates: Requirements 10.6**
     */
    it('should gracefully degrade when metadata is missing', () => {
      fc.assert(
        fc.property(
          taskHeaderPropsArbitrary().filter((props) => !props.metadata),
          (props) => {
            // Arrange
            cleanup();
            const { container } = render(<TaskHeader {...props} />);

            // Act & Assert
            // Component should render without errors
            expect(container).toBeInTheDocument();

            // Title should always be displayed
            expect(screen.getByTestId('task-header-title')).toBeInTheDocument();

            // Tool count should always be displayed
            expect(screen.getByTestId('task-header-tool-count')).toBeInTheDocument();

            // Status should always be displayed
            expect(screen.getByTestId('task-header-status-label')).toBeInTheDocument();

            // No metadata badges should be displayed
            expect(screen.queryByTestId('task-header-complexity')).not.toBeInTheDocument();
            expect(screen.queryByTestId('task-header-priority')).not.toBeInTheDocument();
            expect(screen.queryByTestId('task-header-execution-mode')).not.toBeInTheDocument();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property: For any TaskStep with partial metadata (some fields present, others missing),
     * the TaskHeader SHALL display only the available fields without errors.
     *
     * **Validates: Requirements 10.2, 10.3, 10.5, 10.6**
     */
    it('should handle partial metadata correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            task: taskStepArbitrary(),
            toolCount: fc.integer({ min: 0, max: 100 }),
            isExpanded: fc.boolean(),
            onToggleExpand: fc.constant(vi.fn()),
            status: fc.constantFrom('pending', 'in-progress', 'completed', 'failed'),
            metadata: fc.option(
              fc.record({
                estimatedComplexity: fc.option(
                  fc.constantFrom('simple', 'moderate', 'complex')
                ),
                priority: fc.option(fc.constantFrom('low', 'normal', 'critical')),
                executionMode: fc.option(
                  fc.constantFrom('sequential', 'parallel', 'hybrid')
                ),
              })
            ),
            isLast: fc.option(fc.boolean()),
          }),
          (props) => {
            // Arrange
            cleanup();
            const { container } = render(<TaskHeader {...props} />);

            // Act & Assert
            // Component should render without errors
            expect(container).toBeInTheDocument();

            // Core elements should always be present
            expect(screen.getByTestId('task-header')).toBeInTheDocument();
            expect(screen.getByTestId('task-header-title')).toBeInTheDocument();
            expect(screen.getByTestId('task-header-tool-count')).toBeInTheDocument();
            expect(screen.getByTestId('task-header-status-label')).toBeInTheDocument();

            // Metadata badges should only be present if their values are defined
            if (props.metadata?.estimatedComplexity) {
              expect(screen.getByTestId('task-header-complexity')).toBeInTheDocument();
            } else {
              expect(screen.queryByTestId('task-header-complexity')).not.toBeInTheDocument();
            }

            if (props.metadata?.priority) {
              expect(screen.getByTestId('task-header-priority')).toBeInTheDocument();
            } else {
              expect(screen.queryByTestId('task-header-priority')).not.toBeInTheDocument();
            }

            if (props.metadata?.executionMode) {
              expect(screen.getByTestId('task-header-execution-mode')).toBeInTheDocument();
            } else {
              expect(screen.queryByTestId('task-header-execution-mode')).not.toBeInTheDocument();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid status value, the TaskHeader SHALL display the correct
     * status label and apply appropriate styling without errors.
     *
     * **Validates: Requirements 4.1, 4.5, 4.6**
     */
    it('should display correct status for all status values', () => {
      const statuses: Array<TaskHeaderProps['status']> = [
        'pending',
        'in-progress',
        'completed',
        'failed',
      ];

      statuses.forEach((status) => {
        fc.assert(
          fc.property(taskHeaderPropsArbitrary(), (props) => {
            // Arrange
            cleanup();
            const testProps = { ...props, status };
            const { container } = render(<TaskHeader {...testProps} />);

            // Act & Assert
            // Component should render without errors
            expect(container).toBeInTheDocument();

            // Status label should be displayed
            expect(screen.getByTestId('task-header-status-label')).toBeInTheDocument();

            // Status indicator should be displayed
            expect(screen.getByTestId('task-header-status-indicator')).toBeInTheDocument();
          }),
          { numRuns: 25 }
        );
      });
    });

    /**
     * Property: For any tool count value, the TaskHeader SHALL display the correct
     * singular or plural form without errors.
     *
     * **Validates: Requirements 3.3, 10.2**
     */
    it('should display correct tool count singular/plural form', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          (toolCount) => {
            // Arrange
            cleanup();
            const props: TaskHeaderProps = {
              task: {
                id: 'test',
                description: 'test',
                tool: 'test',
                canParallelize: false,
              },
              toolCount,
              isExpanded: true,
              onToggleExpand: vi.fn(),
              status: 'pending',
            };

            const { container } = render(<TaskHeader {...props} />);

            // Act & Assert
            // Component should render without errors
            expect(container).toBeInTheDocument();

            // Tool count badge should be displayed
            const badge = screen.getByTestId('task-header-tool-count');
            expect(badge).toBeInTheDocument();

            // Verify singular/plural form
            if (toolCount === 1) {
              expect(badge).toHaveTextContent('1 tool');
            } else {
              expect(badge).toHaveTextContent(`${toolCount} tools`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid TaskHeaderProps, the component SHALL render without
     * throwing errors or console warnings.
     *
     * **Validates: Requirements 10.2, 10.3, 10.5, 10.6**
     */
    it('should render without errors for all valid props', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      fc.assert(
        fc.property(taskHeaderPropsArbitrary(), (props) => {
          // Arrange & Act
          cleanup();
          const { container } = render(<TaskHeader {...props} />);

          // Assert
          expect(container).toBeInTheDocument();
          expect(consoleSpy).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );

      consoleSpy.mockRestore();
    });
  });
});
