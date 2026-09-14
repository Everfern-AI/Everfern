/**
 * TaskHeader Component
 *
 * Renders the header for a task section in the hierarchical narrative timeline.
 * Displays task title, status, metadata, and expand/collapse controls.
 *
 * Features:
 * - Task title with prominent styling
 * - Status indicator (pending, in-progress, completed, failed)
 * - Tool count badge
 * - Metadata badges (complexity, priority, execution mode)
 * - Expand/collapse chevron
 * - Status-based background colors
 */

import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { TaskHeaderProps } from './types';

/**
 * Get status-based styling
 */
const getStatusStyles = (status: TaskHeaderProps['status']) => {
  switch (status) {
    case 'pending':
      return {
        bg: 'bg-slate-50 border-slate-200',
        text: 'text-slate-700',
        badge: 'bg-slate-100 text-slate-700',
        indicator: 'bg-slate-400',
      };
    case 'in-progress':
      return {
        bg: 'bg-blue-50 border-blue-200',
        text: 'text-blue-700',
        badge: 'bg-blue-100 text-blue-700',
        indicator: 'bg-blue-500 animate-pulse',
      };
    case 'completed':
      return {
        bg: 'bg-green-50 border-green-200',
        text: 'text-green-700',
        badge: 'bg-green-100 text-green-700',
        indicator: 'bg-green-500',
      };
    case 'failed':
      return {
        bg: 'bg-red-50 border-red-200',
        text: 'text-red-700',
        badge: 'bg-red-100 text-red-700',
        indicator: 'bg-red-500',
      };
    default:
      return {
        bg: 'bg-slate-50 border-slate-200',
        text: 'text-slate-700',
        badge: 'bg-slate-100 text-slate-700',
        indicator: 'bg-slate-400',
      };
  }
};

/**
 * Get status label
 */
const getStatusLabel = (status: TaskHeaderProps['status']): string => {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in-progress':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Unknown';
  }
};

/**
 * Get status icon
 */
const getStatusIcon = (status: TaskHeaderProps['status']): string => {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'in-progress':
      return '⚙️';
    case 'completed':
      return '✓';
    case 'failed':
      return '✕';
    default:
      return '?';
  }
};

/**
 * TaskHeader Component
 *
 * Renders the header for a task section with metadata and controls.
 *
 * @param props - Component props
 * @returns React component
 */
export const TaskHeader: React.FC<TaskHeaderProps> = ({
  task,
  toolCount,
  isExpanded,
  onToggleExpand,
  status,
  metadata,
  isLast = false,
}) => {
  const styles = getStatusStyles(status);
  const statusLabel = getStatusLabel(status);
  const statusIcon = getStatusIcon(status);

  return (
    <div
      className={`
        border-l-4 border-l-transparent px-4 py-3 rounded-lg
        transition-all duration-200 cursor-pointer
        ${styles.bg} border ${styles.text}
        hover:shadow-sm
      `}
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
      aria-expanded={isExpanded}
      data-testid="task-header"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left section: Chevron, status indicator, and title */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Expand/collapse chevron */}
          <ChevronDown
            size={20}
            className={`
              flex-shrink-0 transition-transform duration-200
              ${isExpanded ? 'rotate-0' : '-rotate-90'}
            `}
            data-testid="task-header-chevron"
          />

          {/* Status indicator dot */}
          <div
            className={`
              w-3 h-3 rounded-full flex-shrink-0
              ${styles.indicator}
            `}
            data-testid="task-header-status-indicator"
            title={statusLabel}
          />

          {/* Task title */}
          <div className="flex-1 min-w-0">
            <h3
              className="font-semibold text-base truncate"
              data-testid="task-header-title"
            >
              {task.title || task.description || 'Unnamed Task'}
            </h3>
          </div>
        </div>

        {/* Right section: Badges and metadata */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Tool count badge */}
          <span
            className={`
              px-2.5 py-1 rounded-full text-xs font-medium
              ${styles.badge}
            `}
            data-testid="task-header-tool-count"
          >
            {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
          </span>

          {/* Metadata badges */}
          {metadata?.estimatedComplexity && (
            <span
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium
                ${styles.badge}
              `}
              data-testid="task-header-complexity"
              title="Estimated Complexity"
            >
              {metadata.estimatedComplexity}
            </span>
          )}

          {metadata?.priority && (
            <span
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium
                ${styles.badge}
              `}
              data-testid="task-header-priority"
              title="Priority"
            >
              {metadata.priority}
            </span>
          )}

          {metadata?.executionMode && (
            <span
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium
                ${styles.badge}
              `}
              data-testid="task-header-execution-mode"
              title="Execution Mode"
            >
              {metadata.executionMode}
            </span>
          )}

          {/* Status label */}
          <span
            className={`
              px-2.5 py-1 rounded-full text-xs font-medium
              ${styles.badge}
            `}
            data-testid="task-header-status-label"
          >
            {statusIcon} {statusLabel}
          </span>
        </div>
      </div>

      {/* Optional: Show failure reason if task failed */}
      {status === 'failed' && task.description && (
        <div
          className="mt-2 text-xs text-red-600 pl-8"
          data-testid="task-header-failure-reason"
        >
          {task.description}
        </div>
      )}
    </div>
  );
};

export default TaskHeader;
