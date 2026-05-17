/**
 * ToolCallGroup Component
 *
 * Renders a group of tool calls with proper indentation and nesting.
 * Integrates with existing ToolCallRow component for individual tool display.
 *
 * Features:
 * - Proper indentation (20px+) for visual nesting
 * - Parallel execution indicator
 * - Integration with existing ToolCallRow
 * - Maintains tool call order
 */

import React from 'react';
import { ToolCallRow } from '../ToolCallComponents';
import type { ToolCallGroupProps } from './types';

/**
 * ToolCallGroup Component
 *
 * Renders a group of tool calls with proper indentation and nesting.
 *
 * @param props - Component props
 * @returns React component
 */
export const ToolCallGroup: React.FC<ToolCallGroupProps> = ({
  toolCalls,
  isExpanded,
  canParallelize,
  isLast = false,
  onToolCallClick,
}) => {
  if (!isExpanded || toolCalls.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="tool-call-group"
    >
      {/* Parallel indicator if applicable */}
      {canParallelize && toolCalls.length > 1 && (
        <div
          className="px-4 py-1 text-xs text-blue-600 font-medium"
          data-testid="tool-call-group-parallel-indicator"
        >
          ⚡ Parallel Execution ({toolCalls.length} tools)
        </div>
      )}

      {/* Tool calls with indentation */}
      <div
        className="flex flex-col gap-1 pl-6"
        data-testid="tool-call-group-container"
      >
        {toolCalls.map((toolCall, index) => (
          <div
            key={toolCall.id}
            className="flex flex-col"
            data-testid={`tool-call-group-item-${index}`}
          >
            <ToolCallRow
              tc={toolCall}
              isLast={index === toolCalls.length - 1}
              onClick={() => onToolCallClick?.(toolCall)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ToolCallGroup;
