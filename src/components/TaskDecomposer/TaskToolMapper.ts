/**
 * TaskToolMapper - Maps tool calls to task steps during streaming execution
 *
 * This class manages the association between tool calls and their corresponding task steps
 * during agent execution. It handles streaming tool call arrivals, task step progression,
 * out-of-order arrivals, and state persistence.
 */

import type { DecomposedTask, TaskStep } from '../../../main/agent/runner/state';
import type {
  TaskToolMapping,
  TaskToolMapperState,
  SerializedTaskToolMapperState,
} from './types';
import type { ITaskToolMapper } from './TaskToolMapper.interface';

/**
 * TaskToolMapper implementation
 *
 * Manages the mapping of tool calls to task steps during agent execution.
 * Handles streaming tool call arrivals, task step progression, and state persistence.
 */
export class TaskToolMapper implements ITaskToolMapper {
  private decomposedTask: DecomposedTask | null = null;
  private mappings: Map<string, TaskToolMapping> = new Map();
  private currentTaskStepIndex: number = 0;
  private toolCallOrder: string[] = [];
  private unmappedToolCalls: string[] = [];
  private toolCallToStepMap: Map<string, string> = new Map(); // Maps toolCallId -> stepId

  /**
   * Initialize the mapper with a decomposed task
   *
   * @param decomposedTask - The decomposed task containing task steps
   * @throws Error if decomposedTask is null or invalid
   */
  initialize(decomposedTask: DecomposedTask): void {
    if (!decomposedTask) {
      throw new Error('DecomposedTask cannot be null');
    }

    if (!decomposedTask.steps || decomposedTask.steps.length === 0) {
      throw new Error('DecomposedTask must have at least one step');
    }

    this.decomposedTask = decomposedTask;
    this.currentTaskStepIndex = 0;
    this.mappings.clear();
    this.toolCallOrder = [];
    this.unmappedToolCalls = [];
    this.toolCallToStepMap.clear();

    // Initialize mappings for all task steps
    for (const step of decomposedTask.steps) {
      this.mappings.set(step.id, {
        taskStepId: step.id,
        toolCallIds: [],
        status: 'pending',
      });
    }
  }

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
  mapToolCall(toolCallId: string, toolName: string): string | null {
    if (!this.decomposedTask) {
      this.unmappedToolCalls.push(toolCallId);
      return null;
    }

    // Check if already mapped
    if (this.toolCallToStepMap.has(toolCallId)) {
      return this.toolCallToStepMap.get(toolCallId) || null;
    }

    // Get current task step
    const currentStep = this.getCurrentTaskStep();
    if (!currentStep) {
      this.unmappedToolCalls.push(toolCallId);
      return null;
    }

    // Map to current task step
    const stepId = currentStep.id;
    const mapping = this.mappings.get(stepId);

    if (mapping) {
      mapping.toolCallIds.push(toolCallId);
      mapping.status = 'in-progress';
      this.toolCallToStepMap.set(toolCallId, stepId);
      this.toolCallOrder.push(toolCallId);
      return stepId;
    }

    this.unmappedToolCalls.push(toolCallId);
    return null;
  }

  /**
   * Advance to the next task step
   *
   * Called when the current task step completes and execution should move to the next step.
   * Updates the current task step index and marks the previous step as completed.
   *
   * @throws Error if already at the last task step
   */
  advanceTaskStep(): void {
    if (!this.decomposedTask) {
      throw new Error('TaskToolMapper not initialized');
    }

    if (this.currentTaskStepIndex >= this.decomposedTask.steps.length - 1) {
      throw new Error('Already at the last task step');
    }

    // Mark current step as completed
    const currentStep = this.decomposedTask.steps[this.currentTaskStepIndex];
    const currentMapping = this.mappings.get(currentStep.id);
    if (currentMapping) {
      currentMapping.status = 'completed';
      currentMapping.endTime = Date.now();
    }

    // Advance to next step
    this.currentTaskStepIndex++;

    // Mark next step as pending (it will become in-progress when first tool call arrives)
    const nextStep = this.decomposedTask.steps[this.currentTaskStepIndex];
    const nextMapping = this.mappings.get(nextStep.id);
    if (nextMapping) {
      nextMapping.status = 'pending';
    }
  }

  /**
   * Get all tool calls for a specific task step
   *
   * @param stepId - The task step ID
   * @returns Array of tool call IDs associated with the step
   */
  getToolCallsForStep(stepId: string): string[] {
    const mapping = this.mappings.get(stepId);
    return mapping ? [...mapping.toolCallIds] : [];
  }

  /**
   * Get the task step for a specific tool call
   *
   * @param toolCallId - The tool call ID
   * @returns The task step, or null if the tool call is not mapped
   */
  getTaskStepForToolCall(toolCallId: string): TaskStep | null {
    if (!this.decomposedTask) {
      return null;
    }

    const stepId = this.toolCallToStepMap.get(toolCallId);
    if (!stepId) {
      return null;
    }

    return this.decomposedTask.steps.find(step => step.id === stepId) || null;
  }

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
  ): void {
    const mapping = this.mappings.get(stepId);
    if (!mapping) {
      return;
    }

    mapping.status = status;

    if (status === 'in-progress' && !mapping.startTime) {
      mapping.startTime = Date.now();
    }

    if (status === 'completed' || status === 'failed') {
      mapping.endTime = Date.now();
    }

    if (status === 'failed' && failureReason) {
      mapping.failureReason = failureReason;
    }
  }

  /**
   * Get the current state of the mapper
   *
   * @returns The current TaskToolMapperState
   */
  getState(): TaskToolMapperState {
    return {
      decomposedTask: this.decomposedTask,
      mappings: new Map(this.mappings),
      currentTaskStepIndex: this.currentTaskStepIndex,
      toolCallOrder: [...this.toolCallOrder],
      unmappedToolCalls: [...this.unmappedToolCalls],
    };
  }

  /**
   * Get the current task step
   *
   * @returns The current task step, or null if not initialized
   */
  getCurrentTaskStep(): TaskStep | null {
    if (!this.decomposedTask) {
      return null;
    }

    if (this.currentTaskStepIndex >= this.decomposedTask.steps.length) {
      return null;
    }

    return this.decomposedTask.steps[this.currentTaskStepIndex] || null;
  }

  /**
   * Get the current task step index
   *
   * @returns The index of the current task step
   */
  getCurrentTaskStepIndex(): number {
    return this.currentTaskStepIndex;
  }

  /**
   * Check if a tool call is mapped to a task step
   *
   * @param toolCallId - The tool call ID
   * @returns true if the tool call is mapped, false otherwise
   */
  isToolCallMapped(toolCallId: string): boolean {
    return this.toolCallToStepMap.has(toolCallId);
  }

  /**
   * Get all unmapped tool calls
   *
   * @returns Array of tool call IDs that could not be mapped to any task step
   */
  getUnmappedToolCalls(): string[] {
    return [...this.unmappedToolCalls];
  }

  /**
   * Serialize the mapper state to JSON
   *
   * @returns JSON string representation of the mapper state
   */
  serialize(): string {
    const serialized: SerializedTaskToolMapperState = {
      decomposedTask: this.decomposedTask,
      mappings: Array.from(this.mappings.entries()),
      currentTaskStepIndex: this.currentTaskStepIndex,
      toolCallOrder: this.toolCallOrder,
      unmappedToolCalls: this.unmappedToolCalls,
    };

    return JSON.stringify(serialized);
  }

  /**
   * Deserialize mapper state from JSON
   *
   * @param json - JSON string representation of the mapper state
   * @returns The deserialized TaskToolMapperState
   * @throws Error if JSON is invalid or cannot be deserialized
   */
  static deserialize(json: string): TaskToolMapperState {
    try {
      const parsed: SerializedTaskToolMapperState = JSON.parse(json);

      // Validate required fields
      if (!Array.isArray(parsed.mappings)) {
        throw new Error('Invalid mappings format');
      }

      if (typeof parsed.currentTaskStepIndex !== 'number') {
        throw new Error('Invalid currentTaskStepIndex');
      }

      if (!Array.isArray(parsed.toolCallOrder)) {
        throw new Error('Invalid toolCallOrder format');
      }

      if (!Array.isArray(parsed.unmappedToolCalls)) {
        throw new Error('Invalid unmappedToolCalls format');
      }

      // Convert mappings array back to Map
      const mappingsMap = new Map<string, TaskToolMapping>(parsed.mappings);

      return {
        decomposedTask: parsed.decomposedTask,
        mappings: mappingsMap,
        currentTaskStepIndex: parsed.currentTaskStepIndex,
        toolCallOrder: parsed.toolCallOrder,
        unmappedToolCalls: parsed.unmappedToolCalls,
      };
    } catch (error) {
      throw new Error(`Failed to deserialize TaskToolMapperState: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reset the mapper to initial state
   *
   * Clears all mappings and resets the current task step index to 0.
   */
  reset(): void {
    this.decomposedTask = null;
    this.mappings.clear();
    this.currentTaskStepIndex = 0;
    this.toolCallOrder = [];
    this.unmappedToolCalls = [];
    this.toolCallToStepMap.clear();
  }

  /**
   * Get the mapping for a specific task step
   *
   * @param stepId - The task step ID
   * @returns The TaskToolMapping, or null if not found
   */
  getMapping(stepId: string): TaskToolMapping | null {
    return this.mappings.get(stepId) || null;
  }

  /**
   * Get all mappings
   *
   * @returns Map of all task step ID to TaskToolMapping
   */
  getAllMappings(): Map<string, TaskToolMapping> {
    return new Map(this.mappings);
  }
}
