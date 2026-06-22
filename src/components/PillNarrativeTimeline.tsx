'use client';

/**
 * Pill-Based Narrative Timeline Component
 *
 * Displays a task-oriented timeline with tool pills representing individual tool executions.
 * Each task is displayed as a section with inline tool pills. Clicking a pill opens the
 * Tool Detail Side Panel showing parameters, results, and errors.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
 */

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NarrativeTimeline, Task, ToolPill, ExecutionStatus } from '../../main/agent/runner/pill-narrative/types';
import ToolDetailSidePanel from './ToolDetailSidePanel';

/**
 * Props for the PillNarrativeTimelineComponent
 */
export interface PillNarrativeTimelineComponentProps {
  /** The narrative timeline to display */
  timeline: NarrativeTimeline | null;

  /** Whether the timeline is currently running */
  isRunning: boolean;

  /** Callback when a pill is clicked */
  onPillClick?: (pillId: string, pill: ToolPill) => void;

  /** Callback when a task is expanded/collapsed */
  onTaskExpand?: (taskId: string, isExpanded: boolean) => void;

  /** Display variant (main timeline or sidebar) */
  variant?: 'main' | 'sidebar';

  /** Whether to auto-collapse completed tasks */
  autoCollapse?: boolean;
}

/**
 * Status color mapping
 */
const STATUS_COLORS: Record<ExecutionStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 border-gray-300',
  'in-progress': 'bg-blue-100 text-blue-700 border-blue-300 animate-pulse',
  completed: 'bg-green-100 text-green-700 border-green-300',
  failed: 'bg-red-100 text-red-700 border-red-300',
  skipped: 'bg-yellow-100 text-yellow-700 border-yellow-300',
};

/**
 * Status icon mapping
 */
const STATUS_ICONS: Record<ExecutionStatus, string> = {
  pending: '⏳',
  'in-progress': '⚙️',
  completed: '✅',
  failed: '❌',
  skipped: '⊘',
};

/**
 * Tool pill component
 */
function PillComponent({
  pill,
  onClick,
}: {
  pill: ToolPill;
  onClick: (pill: ToolPill) => void;
}) {
  const statusColor = STATUS_COLORS[pill.status];
  const statusIcon = STATUS_ICONS[pill.status];

  const n = (pill.toolName || pill.label || "").toLowerCase();
  const isMemory = n === 'fern' || n === 'recall_fact' || n === 'remember_fact' || n === 'update_profile' || n.includes('fern') || n.includes('memory') || n.includes('consolidator') || n.includes('confirm_preference') || n.includes('recall') || n.includes('remember');
  const displayLabel = isMemory ? 'Memory' : (pill.label || pill.toolName);
  const displayIcon = isMemory ? '🧠' : (pill.icon || '⚙️');

  return (
    <motion.button
      onClick={() => onClick(pill)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:shadow-md cursor-pointer ${statusColor}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={`${displayLabel} - ${pill.status}`}
    >
      <span className="text-sm">{displayIcon}</span>
      <span className="text-xs font-medium">{displayLabel}</span>
      <span className="text-xs opacity-75">{statusIcon}</span>
    </motion.button>
  );
}

/**
 * Task section component
 */
function TaskSection({
  task,
  isCollapsed,
  onToggleCollapse,
  onPillClick,
}: {
  task: Task;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onPillClick: (pill: ToolPill) => void;
}) {
  const statusColor = STATUS_COLORS[task.status];
  const statusIcon = STATUS_ICONS[task.status];

  // Calculate progress
  const completedPills = task.pills.filter((p) => p.status === 'completed').length;
  const failedPills = task.pills.filter((p) => p.status === 'failed').length;
  const totalPills = task.pills.length;
  const progressPercent = totalPills > 0 ? (completedPills / totalPills) * 100 : 0;

  return (
    <motion.div
      className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      {/* Task Header */}
      <button
        onClick={onToggleCollapse}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 text-left">
          {/* Collapse/Expand Icon */}
          <motion.div
            animate={{ rotate: isCollapsed ? 0 : 90 }}
            transition={{ duration: 0.2 }}
            className="text-gray-400"
          >
            ▶
          </motion.div>

          {/* Task Title and Status */}
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">{task.title}</h3>
            {task.description && (
              <p className="text-xs text-gray-500 mt-1">{task.description}</p>
            )}
          </div>

          {/* Status Badge */}
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            <span>{statusIcon}</span>
            <span>{task.status}</span>
          </div>
        </div>
      </button>

      {/* Progress Bar */}
      {totalPills > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">
              {completedPills}/{totalPills} completed
            </span>
            {failedPills > 0 && (
              <span className="text-xs text-red-600">{failedPills} failed</span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="bg-green-500 h-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {/* Pills Section */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            className="px-4 py-3 border-t border-gray-100 bg-gray-50"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-wrap gap-2">
              {task.pills.map((pill) => (
                <PillComponent
                  key={pill.id}
                  pill={pill}
                  onClick={onPillClick}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Main PillNarrativeTimelineComponent
 */
export default function PillNarrativeTimeline({
  timeline,
  isRunning,
  onPillClick,
  onTaskExpand,
  variant = 'main',
  autoCollapse = false,
}: PillNarrativeTimelineComponentProps) {
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  const [selectedPill, setSelectedPill] = useState<ToolPill | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);

  // Handle task collapse/expand
  const handleToggleCollapse = useCallback(
    (taskId: string) => {
      setCollapsedTasks((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        onTaskExpand?.(taskId, !next.has(taskId));
        return next;
      });
    },
    [onTaskExpand]
  );

  // Handle pill click
  const handlePillClick = useCallback(
    (pill: ToolPill) => {
      setSelectedPill(pill);
      setShowSidePanel(true);
      onPillClick?.(pill.id, pill);
    },
    [onPillClick]
  );

  // Auto-collapse completed tasks
  const displayTasks = useMemo(() => {
    if (!timeline) return [];

    return timeline.tasks.map((task) => {
      const isCompleted = task.status === 'completed';
      const shouldCollapse = autoCollapse && isCompleted;

      if (shouldCollapse && !collapsedTasks.has(task.id)) {
        setCollapsedTasks((prev) => new Set(prev).add(task.id));
      }

      return task;
    });
  }, [timeline, autoCollapse, collapsedTasks]);

  if (!timeline) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <p>No timeline data available</p>
      </div>
    );
  }

  const mainStatusIcon = STATUS_ICONS[timeline.status];
  const mainStatusColor = STATUS_COLORS[timeline.status];

  return (
    <div className={`flex flex-col gap-4 ${variant === 'sidebar' ? 'max-h-96 overflow-y-auto' : ''}`}>
      {/* Timeline Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Execution Timeline</h2>
          {isRunning && (
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${mainStatusColor}`}>
          <span>{mainStatusIcon}</span>
          <span>{timeline.status}</span>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {displayTasks.length > 0 ? (
            displayTasks.map((task) => (
              <TaskSection
                key={task.id}
                task={task}
                isCollapsed={collapsedTasks.has(task.id)}
                onToggleCollapse={() => handleToggleCollapse(task.id)}
                onPillClick={handlePillClick}
              />
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No tasks in timeline</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Tool Detail Side Panel */}
      {selectedPill && (
        <ToolDetailSidePanel
          isOpen={showSidePanel}
          toolCall={{
            id: selectedPill.id,
            toolName: selectedPill.toolName,
            args: selectedPill.parameters || {},
            output: selectedPill.result || '',
            agentName: 'Agent',
          }}
          onClose={() => {
            setShowSidePanel(false);
            setSelectedPill(null);
          }}
          conversationId=""
        />
      )}
    </div>
  );
}
