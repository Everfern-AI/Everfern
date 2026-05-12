import { GraphStateType, StreamEvent, DecomposedTask } from '../state';
import { AgentRunner } from '../runner';
import { PeerAgentDebateEngine } from '../debate-engine';
import type { DebateContext, DebateResult } from '../debate-types';
import { DebateEventEmitter } from '../debate-event-emitter';
import { createMissionIntegrator } from '../mission-integrator';
import type { MissionTracker } from '../mission-tracker';
import { nodeLifecycle } from '../services/node-utils';

console.log('[DebateChamber] 📦 Module loaded');

export const createDebateChamberNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean,
) => {
  const integrator = createMissionIntegrator(missionTracker);

  const emitDebateEvent = (type: string, debateId: string, data?: any, error?: string) => {
    const debateEvent = { type, timestamp: new Date().toISOString(), debateId, data, error };
    eventQueue?.push({
      type: 'debate_event',
      debateEvent,
    } as any);
    DebateEventEmitter.broadcastDebateEvent(debateEvent as any);
  };

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    console.log('[DebateChamber] 🔥 NODE INVOKED');
    const logger = nodeLifecycle(runner, 'debate_chamber');
    console.log(`[DebateChamber] decomposedTask:`, state.decomposedTask ? 'EXISTS' : 'null');
    if (state.decomposedTask) {
      const plan = state.decomposedTask as DecomposedTask;
      console.log(`[DebateChamber] Steps: ${plan.steps?.length}, Title: ${plan.title}`);
    }

    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    const plan = state.decomposedTask as DecomposedTask | undefined;
    if (!plan) {
      logger.info('No plan to debate — skipping');
      return { debateResult: null };
    }

    const stepCount = plan.steps?.length || 0;
    const estimatedModerate = stepCount >= 2 && stepCount <= 4;
    const estimatedComplex = stepCount > 4;
    const complexity: 'simple' | 'moderate' | 'complex' = estimatedComplex ? 'complex' : estimatedModerate ? 'moderate' : 'simple';

    if (!PeerAgentDebateEngine.shouldDebate(complexity, 'moderate')) {
      logger.info(`Task complexity "${complexity}" (${stepCount} steps) below threshold — skipping debate`);
      eventQueue?.push({
        type: 'thought',
        content: `\n⏭️ Skipped Debate: Task complexity is '${complexity}' (threshold is 'moderate'). Proceeding directly to execution.`
      });
      emitDebateEvent('debate_skipped', `debate-${Date.now()}`, { reason: `Complexity: ${complexity}` });
      return { debateResult: null };
    }

    if (!runner.client) {
      logger.warn('No AI client available — skipping debate');
      return { debateResult: null };
    }

    runner.telemetry.info(`[DebateChamber] 🎭 STARTING debate for ${complexity} task (${stepCount} steps)`);
    eventQueue?.push({ type: 'thought', content: '\n🎭 **Peer Agent Debate Started** — Three agents (Vanguard, Phantom, Arbiter) are now deliberating on your plan...' });

    const lastUserMsg = state.messages.filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();
    const userInput = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content))
      : '';

    const availableTools = plan.steps.map((s: any) => s.tool).filter(Boolean);

    const context: DebateContext = {
      taskId: plan.id || `task_${Date.now()}`,
      userInput: userInput.slice(0, 2000),
      conversationHistory: state.messages.slice(-6).map((m: any) => ({
        role: (m.role || 'user') as 'system' | 'user' | 'assistant' | 'tool',
        content: typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500),
      })),
      availableTools: [...new Set(availableTools)] as string[],
      workspaceContext: `Task: ${plan.title}\nSteps: ${stepCount}\nMode: ${plan.executionMode || 'sequential'}`,
    };

    const debateId = `debate-${Date.now()}`;
    emitDebateEvent('debate_start', debateId);

    // Create callback to emit phase completion events to frontend
    const onPhaseComplete = async (phase: 'vanguard' | 'phantom' | 'arbiter', proposal?: any, review?: any, finalPlan?: any) => {
      const frontendData = DebateEventEmitter.formatDebateResultForFrontend({
        debateId,
        timestamp: new Date().toISOString(),
        transcript: [],
        proposal: proposal || {},
        review: review || {},
        finalPlan: finalPlan || {},
      } as any);

      const phaseEventMap = {
        vanguard: 'vanguard_complete',
        phantom: 'phantom_complete',
        arbiter: 'arbiter_complete',
      };

      emitDebateEvent(phaseEventMap[phase], debateId, frontendData);
    };

    const engine = new PeerAgentDebateEngine(runner.client, {
      verbose: true,
      complexityThreshold: 'moderate',
      timeoutMs: 180000,
      vanguardTimeoutMs: 60000,
      phantomTimeoutMs: 60000,
      arbiterTimeoutMs: 45000,
      onPhaseComplete,
    });

    try {
      const debateResult: DebateResult = await engine.debate(context);

      const frontendData = DebateEventEmitter.formatDebateResultForFrontend(debateResult);

      emitDebateEvent('debate_complete', debateResult.debateId, frontendData);

      eventQueue?.push({
        type: 'thought',
        content: `\n⚖️  Arbiter decision: ${debateResult.finalPlan.goNogo.toUpperCase()} — ${debateResult.finalPlan.explanation.slice(0, 200)}`,
      });

      const isNoGo = debateResult.finalPlan.goNogo === 'no-go';
      if (isNoGo) {
        runner.telemetry.warn('[DebateChamber] Arbiter voted NO-GO — task will not proceed');
        eventQueue?.push({
          type: 'thought',
          content: `\n❌ Debate result: NO-GO — ${debateResult.finalPlan.explanation.slice(0, 300)}`,
        });
      }

      return {
        debateResult: {
          debateId: debateResult.debateId,
          timestamp: debateResult.timestamp,
          goNogo: debateResult.finalPlan.goNogo,
          riskAssessment: debateResult.finalPlan.overallRiskAssessment,
          explanation: debateResult.finalPlan.explanation,
          guidance: debateResult.finalPlan.executionGuidance,
          allData: debateResult,
        },
        completionSignal: isNoGo
          ? { reason: 'cannot_proceed' as const, explanation: `Debate chamber voted NO-GO: ${debateResult.finalPlan.explanation.slice(0, 200)}` }
          : null,
        shouldContinueIteration: isNoGo ? false : undefined,
      };
    } catch (err: any) {
      console.error(`[DebateChamber] Debate failed: ${err.message}`);
      emitDebateEvent('debate_error', debateId, undefined, err.message.slice(0, 200));
      eventQueue?.push({
        type: 'thought',
        content: `\n⚠️ Debate chamber failed: ${err.message.slice(0, 200)} — proceeding without debate`,
      });
      return { debateResult: null };
    }
  };
};
