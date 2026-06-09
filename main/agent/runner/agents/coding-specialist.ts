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
      const managerTools = spawnTool
        ? [...piTools, spawnTool]
        : piTools;
      const basePrompt = loadPrompt('coding-specialist.md') || '';
      const codingHandoff = buildCodingHandoff(state);
      const systemPrompt = `${basePrompt}

PI CODING ${isWorkerSubagent ? 'WORKER' : 'MANAGER'} MODE:
- ${isWorkerSubagent ? 'You are a coding worker spawned for one specific lane. Complete only your assigned lane and do not spawn agents.' : 'You are the manager for this coding request.'}
- Use PI coding tools directly for small or tightly coupled changes.
- ${isWorkerSubagent ? 'Do not use spawn_agent. Report back exact files changed, commands run, and any blockers.' : 'For independent feature lanes, spawn coding-specialist workers with spawn_agent.'}
- ${isWorkerSubagent ? 'Stay inside the assigned feature/file ownership boundaries from the manager.' : 'Example: if the user asks for two independent features, spawn one worker per feature with the same target root and clear ownership boundaries.'}
- Do not spawn for tiny single-file changes, tightly coupled edits, or work that needs strict serial ordering.
- Never let workers use different host target roots for the same project.
- ${isWorkerSubagent ? 'When finished, return a concise report with exact changed paths and validation evidence.' : 'After workers finish, inspect/verify their outputs, resolve conflicts, and run final validation yourself.'}
- You have PI coding tools available: read, write, edit, find, grep, ls, and executePwsh.
- ${isWorkerSubagent ? 'spawn_agent is intentionally unavailable in worker mode.' : 'You may use spawn_agent for coding-specialist workers when independent work can proceed in parallel.'}
- For scaffolding/build work, execute commands with executePwsh on the main Windows host.
- If the user asks to create a project in Downloads/Desktop/Documents/C:\\..., resolve that exact host path and create files there.
- For multiple new files, either use repeated write calls or executePwsh with a safe script that writes files on the host.
- Treat tool receipts as authoritative: "Success: wrote file", "Success: edited file", and "Success: command completed" mean that step succeeded.
- After every meaningful write batch, verify with executePwsh from the target root and repair any failures before finalizing.
- If a package scaffold command fails or is unavailable, manually create a minimal working project and verify it.
- Never refuse a build/scaffold request because you only have review tools; this mode has file and process tools.

${codingHandoff}

HANDOFF RULES:
- Treat the decomposer handoff as the implementation brief.
- First mirror the handoff into todo_write unless this is a tiny single-step edit.
- Execute steps in dependency order.
- Use spawn_agent only for independent parallel groups or clearly separable feature lanes.
- If inspection proves the handoff is wrong, adapt it, but keep the same user goal and target root.
- Validation/repair steps are mandatory before final success.

USER REQUEST:
${userInput}`;

      const result = await integrator.wrapNode(
        'coding_specialist',
        () => runAgentStep(state, {
          runner,
          toolDefs: managerTools as any,
          eventQueue,
          nodeName: 'coding_specialist',
          systemPromptOverride: systemPrompt,
        }),
        'Writing code'
      );

      return {
        ...result,
        subagentCoordination: undefined,
        returningFromSpecialist: null,
        codingComplete: true,
        codingSpecialistSelfLoopCount: loopCount,
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
