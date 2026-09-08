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

      // LP-01: local fast-path — on local providers, skip the AI decomposition
      // round trip and fall through to single-task passthrough (the same
      // trivial one-step shape decomposeWithAIUnified uses as its failure
      // fallback). Local models answer fast enough that the decomposition
      // pass costs more latency than it saves; the brain/specialists still
      // receive the full request text as the step description. The cloud
      // branch below is byte-identical to the pre-LP-01 behavior.
      const isLocalClient = !!(runner.client as any)?.isLocal?.();
      if (isLocalClient) {
        console.log('[Decomposer] Local provider — skipping AI decomposition (LP-01 fast-path), single-task passthrough');

        const singleStep: TaskStep = {
          id: 'step_1',
          title: 'Execute Request',
          description: content,
          tool: 'internal',
          dependsOn: [],
          canParallelize: false,
          estimatedComplexity: 'medium',
          priority: 'normal'
        };
        const single: DecomposedTask = {
          id: `task_${Date.now()}`,
          title: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
          steps: [singleStep],
          canParallelize: false,
          estimatedParallelGroups: 0,
          totalSteps: 1,
          executionMode: 'sequential',
          estimatedDurationMs: 5000,
        };

        eventQueue?.push({
          type: 'plan_created',
          plan: {
            id: single.id,
            title: single.title,
            steps: single.steps.map(s => ({
              id: s.id,
              title: s.title,
              description: s.description,
              tool: s.tool
            }))
          }
        });

        // Add the single step to the mission tracker for to-do visibility
        if (missionTracker) {
          const stepName = singleStep.title || (singleStep.description.length > 35
            ? singleStep.description.substring(0, 32).trim() + '...'
            : singleStep.description);
          missionTracker.addStep({
            id: singleStep.id,
            name: stepName.charAt(0).toUpperCase() + stepName.slice(1),
            description: singleStep.description,
            toolCalls: [singleStep.tool],
            metadata: { originalTool: singleStep.tool },
            phase: 'execution',
          });
        }

        // Initialize .everfern/task_plan.md file (best effort, same as the AI path)
        try {
          const { initializeTaskPlan } = await import('../task-plan-helper');
          await initializeTaskPlan(runner, single, content);
        } catch (tpErr) {
          console.warn('[Decomposer] Failed to initialize task plan file:', tpErr);
        }

        integrator.completeNode('decomposer', 'Local fast-path: single-task passthrough');
        return {
          decomposedTask: single,
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

      // Inject Arbiter strategy if debate was run
      let strategyContext = '';
      if (state.debateResult && state.debateResult.finalPlan) {
          const fp = state.debateResult.finalPlan as any;
          const phases = fp.approvedPhases || [];
          const guidance = fp.executionGuidance || [];
          strategyContext = `\n\nSTRATEGY APPROVED BY ARBITER (MUST FOLLOW):\nApproach: ${fp.approvedApproach || 'N/A'}\nPhases:\n${phases.join('\n')}\nExecution Guidance:\n${guidance.join('\n')}`;
      }

      const decomposed = await decomposeTaskWithAI(content, toolNames || [], runner.client ?? undefined, strategyContext);

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

      // Initialize .everfern/task_plan.md file
      try {
        const { initializeTaskPlan } = await import('../task-plan-helper');
        await initializeTaskPlan(runner, decomposed, content);
      } catch (tpErr) {
        console.warn('[Decomposer] Failed to initialize task plan file:', tpErr);
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
