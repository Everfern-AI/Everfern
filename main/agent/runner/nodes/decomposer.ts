import { GraphStateType, StreamEvent, DecomposedTask, TaskStep } from '../state';
import { AgentRunner } from '../runner';
import { createMissionIntegrator } from '../mission-integrator';
import type { MissionTracker } from '../mission-tracker';
import { AIClient } from '../../../lib/ai-client';

/**
 * AI-powered Task Decomposer Node
 *
 * Uses a specialized sub-agent to break down complex user requests
 * into dependency-aware, parallelizable execution steps.
 */
export const createDecomposerNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    // Check for abort signal
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    integrator.startNode('decomposer', 'Intelligently decomposing task into execution steps');

    try {
      const lastUserMsg = state.messages.filter(m => {
        const msg = m as any;
        return msg.role === 'user' || msg.type === 'human' || msg._getType?.() === 'human';
      }).pop();
      const content = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';
      const isPlanApproval = content.includes('[PLAN_APPROVED]');

      const attempts = state.decompositionAttempts || 0;
      const alreadyHasPlan = !!state.decomposedTask;
      const alreadyHasProgress = (state.completedSteps && state.completedSteps.length > 0);

      // Definitively break loops: skip if plan exists with progress OR if we've tried too many times
      if (isPlanApproval || alreadyHasProgress || (alreadyHasPlan && attempts >= 1) || attempts >= 3) {
          console.log(`[Decomposer] Skipping decomposition: existing state found. Approval: ${isPlanApproval}, Progress: ${alreadyHasProgress}, Plan: ${alreadyHasPlan}, Attempts: ${attempts}`);
          return { 
              taskPhase: 'planning' as const,
              decompositionAttempts: attempts + 1
          };
      }

      runner.telemetry.transition('decomposer');


      const startTime = Date.now();

      // Use AI-powered decomposition when a client is available, regex fallback otherwise
      const { decomposeTaskWithAI } = await import('../task-decomposer');
      const toolDefs = (runner as any)._buildToolDefinitions?.() || [];
      const toolNames = toolDefs.map((t: any) => t.name);
      const decomposed = await decomposeTaskWithAI(content, toolNames || [], runner.client ?? undefined);

      // Ensure totalSteps and unique ID are set
      decomposed.totalSteps = decomposed.steps.length;
      decomposed.id = `task_${Date.now()}`;

      const duration = Date.now() - startTime;
      runner.telemetry.info(`[Decomposer] Task split into ${decomposed.totalSteps} steps in ${duration}ms (${decomposed.executionMode}) via AI classification`);

      eventQueue?.push({
        type: 'task_analyzed',
        analysis: {
          complexity: decomposed.totalSteps > 5 ? 'complex' : 'simple',
          canParallelize: decomposed.canParallelize,
          suggestedApproach: decomposed.executionMode
        }
      });

      // Emit plan created event for UI
      eventQueue?.push({
        type: 'plan_created',
        plan: {
          id: decomposed.id,
          title: decomposed.title,
          steps: decomposed.steps.map(s => ({
            id: s.id,
            title: s.title,
            description: s.description,
            tool: s.tool
          }))
        }
      });

      // Add steps to mission tracker for to-do visibility
      if (missionTracker) {
        for (const step of decomposed.steps) {
          const stepName = step.title || (step.description.length > 35 
            ? step.description.substring(0, 32).trim() + '...' 
            : step.description);

          const displayName = stepName.charAt(0).toUpperCase() + stepName.slice(1);

          missionTracker.addStep({
            id: step.id,
            name: displayName,
            description: step.description,
            toolCalls: [step.tool],
            metadata: {
              originalTool: step.tool
            },
            phase: 'execution',
          });
        }
      }

      const result = {
        decomposedTask: decomposed,
        taskPhase: 'planning' as const,
        decompositionAttempts: attempts + 1
      };

      integrator.completeNode('decomposer', `AI Decomposed into ${decomposed.totalSteps} steps`);
      return result;
    } catch (error) {
      runner.telemetry.warn(`[Decomposer] Fast decomposition failed: ${error instanceof Error ? error.message : String(error)}`);
      integrator.completeNode('decomposer', 'Decomposition failed');
      throw error;
    }
  };
};
