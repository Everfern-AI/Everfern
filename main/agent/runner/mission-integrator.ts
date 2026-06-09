/**
 * Mission Integration Adapter
 * 
 * Safe integration of MissionTracker throughout the graph without breaking
 * existing node implementations. Nodes can optionally use mission tracking.
 */

import type { MissionTracker, MissionStep, StepStatus } from './mission-tracker';
import type { GraphStateType } from './state';

export class MissionIntegrator {
  private tracker?: MissionTracker;
  private nodeStepMap: Map<string, string> = new Map(); // node name → step id

  constructor(tracker?: MissionTracker) {
    this.tracker = tracker;
  }

  /**
   * Begin tracking a node's execution.
   * Smart-matches technical nodes to planned user-facing tasks.
   */
  startNode(nodeId: string, description: string): void {
    if (!this.tracker) return;

    // 1. Try to find an existing planned step that matches this node's purpose
    // Specialist nodes map to specific tools in the plan
    const nodeToToolMap: Record<string, string> = {
      'web_explorer': 'web_search',
      'coding_specialist': 'read_file', 
      'data_analyst': 'python_executor',
      'computer_use_agent': 'computer_use',
      'deep_research': 'deep_research',
      'multi_tool_orchestrator': 'ANY',
      'execute_tools': 'ANY',
      'brain': 'ANY'
    };

    const targetTool = nodeToToolMap[nodeId];
    const steps = this.tracker.getSteps();
    
    // Find active or first pending step that matches the tool or is the 'current' planned task
    // For 'ANY' nodes (orchestrators), we prioritize the last in-progress or first pending step
    const plannedStep = (targetTool === 'ANY')
      ? (steps.find(s => s.status === 'in-progress') || steps.find(s => s.status === 'pending'))
      : (targetTool 
          ? steps.find(s => s.status === 'pending' && s.toolCalls?.includes(targetTool))
          : null);

    const stepId = plannedStep ? plannedStep.id : `step:${nodeId}`;
    this.nodeStepMap.set(nodeId, stepId);

    // 2. Only add a new step if it's NOT an orchestrator and doesn't exist
    // We want to avoid "EXECUTE TOOLS" noise at all costs
    let step = this.tracker.getStep(stepId);
    const isOrchestrator = targetTool === 'ANY';

    if (!step && !isOrchestrator) {
      const stepName = nodeId.replace(/_/g, ' ');
      const displayName = stepName.charAt(0).toUpperCase() + stepName.slice(1);
      
      step = this.tracker.addStep({
        id: stepId,
        name: displayName,
        description,
        phase: 'execution',
      });
    }

    if (stepId) {
      this.tracker.startStep(stepId);
    }
  }

  /**
   * Complete a node's execution
   */
  completeNode(nodeId: string, result?: string): void {
    if (!this.tracker) return;

    const stepId = this.nodeStepMap.get(nodeId) || `step:${nodeId}`;
    this.tracker.completeStep(stepId, result);
  }

  /**
   * Fail a node's execution
   */
  failNode(nodeId: string, error: string): void {
    if (!this.tracker) return;

    const stepId = this.nodeStepMap.get(nodeId) || `step:${nodeId}`;
    this.tracker.failStep(stepId, error);
  }

  /**
   * Record tool calls for current node
   */
  recordToolCalls(nodeId: string, toolNames: string[]): void {
    if (!this.tracker) return;

    const stepId = this.nodeStepMap.get(nodeId) || `step:${nodeId}`;
    const step = this.tracker.getStep(stepId);
    if (step) {
      if (step.status === 'completed') {
        this.tracker.updateStep(stepId, {
          status: 'in-progress',
          startTime: step.startTime || Date.now(),
        });
      }
      this.tracker.updateStep(stepId, {
        toolCalls: toolNames,
      });
    }
  }

  /**
   * Update node metadata
   */
  setMetadata(nodeId: string, metadata: Record<string, any>): void {
    if (!this.tracker) return;

    const stepId = this.nodeStepMap.get(nodeId) || `step:${nodeId}`;
    const step = this.tracker.getStep(stepId);
    if (step) {
      this.tracker.updateStep(stepId, {
        metadata: { ...step.metadata, ...metadata },
      });
    }
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return !!this.tracker;
  }

  /**
   * Wrap node execution with tracking
   */
  async wrapNode<T>(
    nodeId: string,
    nodeFunc: () => Promise<T>,
    description?: string
  ): Promise<T> {
    if (!this.tracker) {
      return nodeFunc();
    }

    try {
      this.startNode(nodeId, description || `Executing ${nodeId}`);
      const result = await nodeFunc();
      this.completeNode(nodeId, JSON.stringify(result, null, 2).slice(0, 500));
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.failNode(nodeId, errorMsg);
      throw error;
    }
  }

  /**
   * Get the underlying tracker (if you need direct access)
   */
  getTracker(): MissionTracker | undefined {
    return this.tracker;
  }
}

/**
 * Create a no-op integrator when tracker is not available
 * This allows using the same API regardless of whether tracking is enabled
 */
export function createMissionIntegrator(tracker?: MissionTracker): MissionIntegrator {
  return new MissionIntegrator(tracker);
}
