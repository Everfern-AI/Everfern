import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';
import { getPiCodingTools } from '../../tools/pi-tools';

const buildCodingHandoff = (state: GraphStateType): string => {
  const plan = state.decomposedTask;
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return 'No decomposer handoff was provided. Resolve the task directly with the fast coding loop.';
  }

  const parallelGroups = new Map<string, typeof plan.steps>();
  for (const step of plan.steps) {
    if (step.canParallelize && step.parallelGroup !== undefined) {
      const key = String(step.parallelGroup);
      parallelGroups.set(key, [...(parallelGroups.get(key) || []), step]);
    }
  }

  const stepLines = plan.steps.map((step, index) => {
    const deps = step.dependsOn?.length ? step.dependsOn.join(', ') : 'none';
    const lane = step.canParallelize
      ? `parallel group ${step.parallelGroup ?? 'unassigned'}`
      : 'sequential';
    return [
      `${index + 1}. ${step.id}: ${step.title || step.description}`,
      `   Tool hint: ${step.tool}`,
      `   Depends on: ${deps}`,
      `   Lane: ${lane}`,
      step.agentPrompt ? `   Specialist guidance: ${step.agentPrompt}` : `   Specialist guidance: ${step.description}`,
    ].join('\n');
  }).join('\n');

  const parallelSummary = Array.from(parallelGroups.entries())
    .filter(([, steps]) => steps.length > 1)
    .map(([group, steps]) => `- Group ${group}: ${steps.map(step => `${step.id} ${step.title || step.description}`).join(' | ')}`)
    .join('\n') || '- No independent parallel groups detected. Implement sequentially unless inspection reveals safe lanes.';

  return `DECOMPOSER → CODING SPECIALIST HANDOFF
Title: ${plan.title}
Execution mode: ${plan.executionMode}
Total steps: ${plan.totalSteps}
Can parallelize: ${plan.canParallelize ? 'yes' : 'no'}

Steps:
${stepLines}

Parallel lane guidance:
${parallelSummary}`;
};

/**
 * Enhanced AI Coding Specialist - PI Manager Harness
 *
 * The parent coding specialist acts as a manager: it can implement directly with
 * PI tools, or spawn coding-specialist workers for independent feature lanes.
 * Spawned workers are still PI-backed, but cannot recursively spawn more agents.
 */

export const createCodingSpecialistNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const loopCount = (state.codingSpecialistSelfLoopCount || 0) + 1;
    const MAX_CODING_SPECIALIST_PASSES = 30;
    if (loopCount > MAX_CODING_SPECIALIST_PASSES) {
      const message = `Coding specialist stopped after ${MAX_CODING_SPECIALIST_PASSES} passes to avoid an infinite tool loop. I gathered context and ran tools, but the task did not reach a clean completion signal. Please narrow the target files or ask me to continue from the current checkpoint.`;
      console.warn(`[CodingSpecialist] ${message}`);
      eventQueue?.push({ type: 'thought', content: `⚠️ ${message}` });
      return {
        messages: [{ role: 'assistant', content: message } as any],
        pendingToolCalls: [],
        returningFromSpecialist: null,
        codingComplete: true,
        codingSpecialistSelfLoopCount: loopCount,
        completionSignal: {
          reason: 'cannot_proceed',
          explanation: message,
        },
      };
    }

    // Reset codingComplete at the start of each pass so stale state from a previous
    // iteration never causes the graph edge to think the task is done prematurely.
    // The node will only re-set it to true when [PHASE_COMPLETE] is explicitly signalled.


    const fallbackTools = toolDefs || (runner as any)._buildToolDefinitions();

    // Extract user request and determine current phase
    const messages = state.messages || [];
    const firstUserMsg = messages.find((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    });
    const userInput = firstUserMsg
      ? (typeof (firstUserMsg as any).content === 'string'
          ? (firstUserMsg as any).content
          : JSON.stringify((firstUserMsg as any).content))
      : '';

    try {
      const piTools = await getPiCodingTools();
      const isWorkerSubagent = Boolean((runner as any).currentAgentSessionKey);
      const spawnTool = !isWorkerSubagent
        ? ((runner as any).tools || []).find((tool: any) => tool.name === 'spawn_agent')
        : undefined;
      const termExecTool = ((runner as any).tools || []).find((tool: any) => tool.name === 'terminal_execute');
      const termStatusTool = ((runner as any).tools || []).find((tool: any) => tool.name === 'terminal_status');

      const extraTools = [spawnTool, termExecTool, termStatusTool].filter(Boolean);
      const managerTools = [...piTools, ...extraTools];
      const basePrompt = loadPrompt('coding-specialist.md') || '';
      const codingHandoff = buildCodingHandoff(state);

      // ── Harness: phase-driven tool filtering ──
      const alwaysAvailable = ['spawn_agent', 'ask_user_question', 'todo_write'];
      const filteredTools = managerTools;

      const systemPrompt = `${basePrompt}

MODE: ${isWorkerSubagent ? 'WORKER — Complete your assigned lane only, do not spawn agents' : 'MANAGER — You own the full implementation. Use tools directly. Spawn workers only for truly independent parallel lanes.'}

${codingHandoff}

USER REQUEST:
${userInput}

REMEMBER:
1. Quick context-gather (2-3 reads/greps)
2. Ship the change (write or edit)
3. Verify immediately (typecheck/lint/build)
4. Fix errors before responding
5. Call \`task_complete\` with a summary when you have verified everything works`;

      const result = await integrator.wrapNode(
        'coding_specialist',
        () => runAgentStep(state, {
          runner,
          toolDefs: filteredTools as any,
          eventQueue,
          nodeName: 'coding_specialist',
          systemPromptOverride: systemPrompt,
        }),
        'Writing code'
      );

      const agentMessages = result.messages || [];
      const lastAssistantMsg = [...agentMessages].reverse().find((m: any) => {
        const role = m.role || m._getType?.();
        return role === 'assistant' || role === 'ai';
      });
      const hasPendingTools = !!(result.pendingToolCalls && result.pendingToolCalls.length > 0);

      // ── Tool-call-presence routing (ReAct / LangGraph / OpenAI Swarm pattern) ──
      // The specialist signals completion by calling the `task_complete` tool.
      // We check tool-call presence structurally — no text pattern matching needed.
      const calledTaskComplete = (result.pendingToolCalls || []).some(
        (tc: any) => (tc.name || tc.toolName || tc.function?.name || '') === 'task_complete'
      );

      // Also check if task_complete was just executed in the previous turn
      const wasTaskCompleteExecutedInLastTurn = (): boolean => {
        const msgs = state.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i] as any;
          const role = msg.role || msg.type || msg._getType?.();
          if (role === 'assistant' || role === 'ai') break;
          if (role === 'tool' || role === 'function') {
            const name = msg.name || msg.tool_name || msg.toolName || '';
            if (name === 'task_complete') return true;
          }
        }
        return false;
      };

      const isComplete = calledTaskComplete || wasTaskCompleteExecutedInLastTurn() || (state.codingComplete ?? false);

      return {
        ...result,
        subagentCoordination: undefined,
        returningFromSpecialist: null,
        codingComplete: isComplete,
        // Reset self loop count to 0 when complete, otherwise track active passes
        codingSpecialistSelfLoopCount: isComplete ? 0 : loopCount,
      };

    } catch (error) {
      console.error('[CodingSpecialist] Error in coding specialist:', error);

      eventQueue?.push({
        type: 'thought',
        content: `❌ Error in coding specialist: ${error instanceof Error ? error.message : String(error)}`
      });

      const systemPrompt = (loadPrompt('coding-specialist.md') || '') +
        `\n\nERROR RECOVERY: PI coding tools could not be loaded. Continue as a single coding agent with the available file and terminal tools. Do not route to review-only subagents.`;

      const result = await integrator.wrapNode(
        'coding_specialist_fallback',
        () => runAgentStep(state, {
          runner,
          toolDefs: fallbackTools,
          eventQueue,
          nodeName: 'coding_specialist',
          systemPromptOverride: systemPrompt,
        }),
        'Fallback coding implementation'
      );

      return {
        ...result,
        returningFromSpecialist: null,
        codingComplete: true,
        codingSpecialistSelfLoopCount: loopCount,
      };
    }
  };
};
