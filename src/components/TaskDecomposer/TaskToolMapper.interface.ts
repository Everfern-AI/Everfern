/**
 * Interface definitions for TaskToolMapper class
 *
 * This module defines the public interface for the TaskToolMapper class,
 * which is responsible for mapping tool calls to their corresponding task steps
 * during streaming execution.
 */

import type { DecomposedTask, TaskStep } from '../../../main/agent/runner/state';
import type { TaskToolMapping, TaskToolMapperState, SerializedTaskToolMapperState } from './types';

/**
 * TaskToolMapper interface
 *
 * Manages the mapping of tool calls to task steps during agent execution.
 * Handles streaming tool call arrivals, task step progression, and state persistence.
 */
export interface ITaskToolMapper {
  /**
   * Initialize the mapper with a decomposed task
   *
   * @param decomposedTask - The decomposed task containing task steps
   * @throws Error if decomposedTask is null or invalid
   */
  initialize(decomposedTask: DecomposedTask): void;

  /**
   * Map a tool call to the current task step
   *
   * Determines which task step the tool call belongs to based on execution order
   * and step dependencies. Handles out-of-order arrivals gracefully.
   *
   * @param toolCallId - The unique identifier of the tool call
   * @param toolName - The name of the tool being called
   * @returns The task step ID the tool call was mapped to, or null if unmappable
   */
  mapToolCall(toolCallId: string, toolName: string): string | null;

  /**
   * Advance to the next task step
   *
   * Called when the current task step completes and execution should move to the next step.
   * Updates the current task step index and marks the previous step as completed.
   *
   * @throws Error if already at the last task step
   */
  advanceTaskStep(): void;

  /**
   * Get all tool calls for a specific task step
   *
   * @param stepId - The task step ID
   * @returns Array of tool call IDs associated with the step
   */
  getToolCallsForStep(stepId: string): string[];

  /**
   * Get the task step for a specific tool call
   *
   * @param toolCallId - The tool call ID
   * @returns The task step, or null if the tool call is not mapped
   */
  getTaskStepForToolCall(toolCallId: string): TaskStep | null;

  /**
   * Update the status of a task step
   *
   * @param stepId - The task step ID
   * @param status - The new status
   * @param failureReason - Optional failure reason if status is 'failed'
   */
  updateTaskStepStatus(
    stepId: string,
    status: 'pending' | 'in-progress' | 'completed' | 'failed',
    failureReason?: string
  ): void;

  /**
   * Get the current state of the mapper
   *
   * @returns The current TaskToolMapperState
   */
  getState(): TaskToolMapperState;

  /**
   * Get the current task step
   *
   * @returns The current task step, or null if not initialized
   */
  getCurrentTaskStep(): TaskStep | null;

  /**
   * Get the current task step index
   *
   * @returns The index of the current task step
   */
  getCurrentTaskStepIndex(): number;

  /**
   * Check if a tool call is mapped to a task step
   *
   * @param toolCallId - The tool call ID
   * @returns true if the tool call is mapped, false otherwise
   */
  isToolCallMapped(toolCallId: string): boolean;

  /**
   * Get all unmapped tool calls
   *
   * @returns Array of tool call IDs that could not be mapped to any task step
   */
  getUnmappedToolCalls(): string[];

  /**
   * Serialize the mapper state to JSON
   *
   * @returns JSON string representation of the mapper state
   */
  serialize(): string;



  /**
   * Reset the mapper to initial state
   *
   * Clears all mappings and resets the current task step index to 0.
   */
  reset(): void;

  /**
   * Get the mapping for a specific task step
   *
   * @param stepId - The task step ID
   * @returns The TaskToolMapping, or null if not found
   */
  getMapping(stepId: string): TaskToolMapping | null;

  /**
   * Get all mappings
   *
   * @returns Map of all task step ID to TaskToolMapping
   */
  getAllMappings(): Map<string, TaskToolMapping>;
}
