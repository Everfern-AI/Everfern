/**
 * TaskSection Component
 *
 * Renders a collapsible task section with nested tool calls.
 * Displays task header with metadata and expand/collapse controls,
 * and renders nested tool calls when expanded.
 *
 * Features:
 * - Collapsible task header
 * - Nested tool call rendering
 * - Collapsed state summary display
 * - Smooth expand/collapse animations
 * - Tool call click handling
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TaskHeader } from './TaskHeader';
import { ToolCallGroup } from './ToolCallGroup';
import type { TaskSectionProps } from './types';

/**
 * Calculate summary for collapsed state
 */
const calculateSummary = (toolCalls: TaskSectionProps['toolCalls']) => {
  const completed = toolCalls.filter((tc) => tc.status === 'done').length;
  const running = toolCalls.filter((tc) => tc.status === 'running').length;
  const failed = toolCalls.filter((tc) => tc.status === 'error').length;

  const parts: string[] = [];
  if (completed > 0) parts.push(`${completed} done`);
  if (running > 0) parts.push(`${running} running`);
  if (failed > 0) parts.push(`${failed} failed`);

  return parts.length > 0 ? parts.join(', ') : 'No tools';
};

/**
 * TaskSection Component
 *
 * Renders a collapsible task section with nested tool calls.
 *
 * @param props - Component props
 * @returns React component
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
  task,
  toolCalls,
  isExpanded: initialExpanded,
  onToggleExpand,
  status,
  isLast = false,
  onToolCallClick,
}) => {
  // Local state for expand/collapse
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  // Sync local state with parent prop updates
  React.useEffect(() => {
    setIsExpanded(initialExpanded);
  }, [initialExpanded]);

  // Handle toggle
  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    onToggleExpand?.();
  };

  // Calculate summary for collapsed state
  const summary = useMemo(() => calculateSummary(toolCalls), [toolCalls]);

  // Prepare metadata for header
  const metadata = useMemo(
    () => ({
      estimatedComplexity: task.estimatedComplexity,
      priority: task.priority,
      executionMode: task.parallelGroup !== undefined ? 'parallel' : 'sequential',
    }),
    [task]
  );

  return (
    <div
      className={`
        flex flex-col gap-2
        ${!isLast ? 'pb-2' : ''}
      `}
      data-testid="task-section"
    >
      {/* Task Header */}
      <TaskHeader
        task={task}
        toolCount={toolCalls.length}
        isExpanded={isExpanded}
        onToggleExpand={handleToggle}
        status={status}
        metadata={metadata}
        isLast={isLast}
      />

      {/* Collapsed Summary */}
      {!isExpanded && toolCalls.length > 0 && (
        <div
          className="px-4 py-2 text-xs text-slate-600 italic"
          data-testid="task-section-summary"
        >
          {summary}
        </div>
      )}

      {/* Expanded Tool Calls */}
      <AnimatePresence>
        {isExpanded && toolCalls.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            data-testid="task-section-expanded"
          >
            <ToolCallGroup
              toolCalls={toolCalls}
              isExpanded={isExpanded}
              canParallelize={task.canParallelize}
              isLast={isLast}
              onToolCallClick={onToolCallClick}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state when expanded but no tools */}
      {isExpanded && toolCalls.length === 0 && (
        <div
          className="px-4 py-3 text-xs text-slate-500 italic"
          data-testid="task-section-empty"
        >
          No tools executed yet
        </div>
      )}
    </div>
  );
};

export default TaskSection;
