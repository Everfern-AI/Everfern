/**
 * TimelineRenderer Component
 *
 * Orchestrates rendering of hierarchical or flat timeline based on decomposed task availability.
 * Handles conditional rendering logic, task-to-tool mapping, and streaming updates.
 *
 * Features:
 * - Hierarchical rendering when decomposed task exists
 * - Flat timeline rendering for backward compatibility
 * - Mixed mode rendering (decomposed + non-decomposed)
 * - Unmapped tool calls section
 * - Streaming update integration
 * - State management for expand/collapse
 */

import React, { useState, useMemo, useEffect } from 'react';
import { TaskSection } from './TaskSection';
import { TaskToolMapper } from './TaskToolMapper';
import type { TimelineRendererProps } from './types';
import type { DecomposedTask } from '../../../main/agent/runner/state';

/**
 * TimelineRenderer Component
 *
 * Renders either hierarchical or flat timeline based on decomposed task availability.
 *
 * @param props - Component props
 * @returns React component
 */
export const TimelineRenderer: React.FC<TimelineRendererProps> = ({
  toolCalls,
  decomposedTask,
  thoughts,
  plans,
  isLive = false,
  onPillClick,
}) => {
  // State for expand/collapse
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // State for task-to-tool mapping
  const [mapper, setMapper] = useState<TaskToolMapper | null>(null);

  // State for task statuses
  const [taskStatuses, setTaskStatuses] = useState<Map<string, 'pending' | 'in-progress' | 'completed' | 'failed'>>(
    new Map()
  );

  // Initialize mapper when decomposed task arrives
  useEffect(() => {
    if (decomposedTask && decomposedTask.steps.length > 0) {
      const newMapper = new TaskToolMapper();
      newMapper.initialize(decomposedTask);
      setMapper(newMapper);

      // Initialize all tasks as pending
      const statuses = new Map<string, 'pending' | 'in-progress' | 'completed' | 'failed'>();
      decomposedTask.steps.forEach((step: any) => {
        statuses.set(step.id, 'pending');
      });
      setTaskStatuses(statuses);

      // Initialize expanded tasks (all expanded by default)
      const expanded = new Set<string>();
      decomposedTask.steps.forEach((step: any) => {
        expanded.add(step.id);
      });
      setExpandedTasks(expanded);
    }
  }, [decomposedTask]);

  // Update mapper when tool calls arrive
  useEffect(() => {
    if (mapper && toolCalls.length > 0) {
      const statusUpdates = new Map<string, 'pending' | 'in-progress' | 'completed' | 'failed'>();

      // Map each tool call to its task step
      toolCalls.forEach((toolCall) => {
        if (!mapper.isToolCallMapped(toolCall.id)) {
          mapper.mapToolCall(toolCall.id, toolCall.toolName);
        }

        // Get task step for this tool call
        const taskStep = mapper.getTaskStepForToolCall(toolCall.id);
        if (taskStep) {
          // Determine tool call status
          const toolStatus =
            toolCall.status === 'running'
              ? 'in-progress'
              : toolCall.status === 'done'
                ? 'completed'
                : toolCall.status === 'error'
                  ? 'failed'
                  : 'pending';

          // Get all tool calls for this task step
          const taskToolCalls = mapper.getToolCallsForStep(taskStep.id);
          const allToolsForStep = taskToolCalls
            .map((id) => toolCalls.find((tc) => tc.id === id))
            .filter((tc) => tc !== undefined);

          // Determine task status based on all tool calls
          let taskStatus: 'pending' | 'in-progress' | 'completed' | 'failed' = 'pending';

          if (allToolsForStep.length > 0) {
            const hasError = allToolsForStep.some((tc) => tc.status === 'error');
            const hasRunning = allToolsForStep.some((tc) => tc.status === 'running');
            const allDone = allToolsForStep.every((tc) => tc.status === 'done');

            if (hasError) {
              taskStatus = 'failed';
            } else if (hasRunning) {
              taskStatus = 'in-progress';
            } else if (allDone) {
              taskStatus = 'completed';
            } else if (allToolsForStep.length > 0) {
              taskStatus = 'in-progress';
            }
          }

          statusUpdates.set(taskStep.id, taskStatus);
        }
      });

      // Update all task statuses at once
      if (statusUpdates.size > 0) {
        setTaskStatuses((prev) => {
          const updated = new Map(prev);
          statusUpdates.forEach((status, taskId) => {
            const oldStatus = prev.get(taskId);
            if (status === 'completed' && oldStatus !== 'completed') {
              // It transitioned to completed! Collapse it.
              setExpandedTasks((prevExpanded) => {
                const newExpanded = new Set(prevExpanded);
                newExpanded.delete(taskId);
                return newExpanded;
              });
            }
            updated.set(taskId, status);
          });
          return updated;
        });
      }
    }
  }, [mapper, toolCalls]);

  // Handle task expand/collapse
  const handleToggleTask = (taskId: string) => {
    setExpandedTasks((prev) => {
      const updated = new Set(prev);
      if (updated.has(taskId)) {
        updated.delete(taskId);
      } else {
        updated.add(taskId);
      }
      return updated;
    });
  };

  // Determine rendering mode
  const hasDecomposedTask = decomposedTask && decomposedTask.steps.length > 0;

  // Render hierarchical timeline
  if (hasDecomposedTask && mapper) {
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="timeline-renderer-hierarchical"
      >
        {decomposedTask!.steps.map((step: any, index: number) => {
          const taskToolCalls = mapper
            .getToolCallsForStep(step.id)
            .map((toolCallId) => toolCalls.find((tc) => tc.id === toolCallId))
            .filter((tc) => tc !== undefined);

          const status = taskStatuses.get(step.id) || 'pending';
          const isExpanded = expandedTasks.has(step.id);
          const isLast = index === decomposedTask!.steps.length - 1;

          return (
            <TaskSection
              key={step.id}
              task={step}
              toolCalls={taskToolCalls}
              isExpanded={isExpanded}
              onToggleExpand={() => handleToggleTask(step.id)}
              status={status}
              isLast={isLast}
              onToolCallClick={onPillClick}
            />
          );
        })}

        {/* Unmapped tool calls section */}
        {mapper.getUnmappedToolCalls().length > 0 && (
          <div
            className="mt-4 pt-4 border-t border-slate-200"
            data-testid="timeline-renderer-unmapped"
          >
            <div className="text-xs font-semibold text-slate-600 mb-2">
              Unmapped Tool Calls ({mapper.getUnmappedToolCalls().length})
            </div>
            <div className="flex flex-col gap-1 pl-2">
              {mapper.getUnmappedToolCalls().map((toolCallId) => {
                const toolCall = toolCalls.find((tc) => tc.id === toolCallId);
                return toolCall ? (
                  <div
                    key={toolCallId}
                    className="text-xs text-slate-500 italic"
                    data-testid={`unmapped-tool-${toolCallId}`}
                  >
                    {toolCall.toolName} ({toolCall.status})
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render flat timeline (backward compatibility)
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="timeline-renderer-flat"
    >
      {toolCalls.length > 0 ? (
        toolCalls.map((toolCall, index) => (
          <div
            key={toolCall.id}
            className="text-xs text-slate-600"
            data-testid={`flat-tool-call-${index}`}
          >
            {toolCall.toolName} ({toolCall.status})
          </div>
        ))
      ) : (
        <div
          className="text-xs text-slate-500 italic"
          data-testid="timeline-renderer-empty"
        >
          No tool calls
        </div>
      )}
    </div>
  );
};

export default TimelineRenderer;
