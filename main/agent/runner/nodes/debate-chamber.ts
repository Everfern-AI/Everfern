import { GraphStateType, StreamEvent, DecomposedTask } from '../state';
import { AgentRunner } from '../runner';
import { PeerAgentDebateEngine } from '../debate-engine';
import type { DebateContext, DebateResult } from '../debate-types';
import { DebateEventEmitter } from '../debate-event-emitter';
import { createMissionIntegrator } from '../mission-integrator';
import type { MissionTracker } from '../mission-tracker';
import { nodeLifecycle } from '../services/node-utils';
import { clearDebateSkip, waitForDebateSkip } from '../debate-skip';

export const createDebateChamberNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean,
) => {
  const integrator = createMissionIntegrator(missionTracker);

  // CU-ST-03: conversation id for cross-chat isolation. `conversationId` is not
  // a declared GraphState field; sibling nodes read `(state as any).conversationId`
  // (call_model.ts:479, agent-runtime.ts:757) but nothing ever writes it into
  // graph state (it only rides in executionContext). The reliably populated
  // mapping is `state.missionId`, which runner.ts seeds with the conversation
  // id at every graph invoke (runner.ts:1353, runner.ts:1393).
  const emitDebateEvent = (type: string, debateId: string, conversationId: string | undefined, data?: any, error?: string) => {
    const debateEvent = { type, timestamp: new Date().toISOString(), debateId, conversationId, data, error };
    eventQueue?.push({
      type: 'debate_event',
      debateEvent,
    } as any);
    DebateEventEmitter.broadcastDebateEvent(debateEvent as any);
  };

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const logger = nodeLifecycle(runner, 'debate_chamber');

    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    // CU-ST-03: conversation id for cross-chat isolation of broadcast events.
    // Prefer an explicit `conversationId` if ever written into state, else fall
    // back to `missionId` (which runner.ts seeds with the conversation id).
    const conversationId = ((state as any).conversationId as string | undefined) ?? state.missionId ?? undefined;

    const intent = state.currentIntent || 'unknown';
    const lastUserMsg = (state.messages ?? []).filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();
    const userInput = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content ?? ''))
      : '';

    const debateDecision = shouldUseDebateChamber(intent, userInput);
    if (!debateDecision.shouldDebate) {
      logger.info(`Task intent "${intent}" skipped debate chamber — ${debateDecision.reason}`);
      emitDebateEvent('debate_skipped', `debate-${Date.now()}`, conversationId, { reason: debateDecision.reason });
      return { debateResult: null };
    }

    // LP-01: local fast-path — never run the multi-agent debate (3+ extra
    // LLM round trips) on local providers, even when the keyword gate above
    // selected debate. Emits the same debate_skipped event the no-debate
    // path uses, so the frontend sees the identical shape. Belt-and-braces:
    // the local decomposer fast-path (LP-01) already prevents debate
    // strategyContext from being injected, but debate_chamber remains
    // graph-reachable for 'automate'/'task' intents (graph.ts:713), so the
    // explicit gate is required. Cloud path is byte-identical below.
    if ((runner.client as any)?.isLocal?.()) {
      logger.info('Local provider — skipping debate chamber (LP-01 fast-path)');
      emitDebateEvent('debate_skipped', `debate-${Date.now()}`, conversationId, { reason: 'Local provider fast-path (LP-01): debate skipped' });
      return { debateResult: null };
    }

    if (!runner.client) {
      logger.warn('No AI client available — skipping debate');
      return { debateResult: null };
    }

    runner.telemetry.info(`[DebateChamber] 🎭 STARTING debate for ${debateDecision.reason}`);

    // Get all available tools from runner
    const allToolNames = (runner.tools ?? []).map((t: any) => t.name).filter(Boolean);

    const context: DebateContext = {
      taskId: `task_${Date.now()}`,
      userInput: (userInput ?? '').slice(0, 2000),
      conversationHistory: (state.messages ?? []).slice(-6).map((m: any) => {
        const rawContent = m.content ?? '';
        const strContent = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        return {
          role: (m.role || 'user') as 'system' | 'user' | 'assistant' | 'tool',
          content: strContent.slice(0, 500),
        };
      }),
      availableTools: [...new Set(allToolNames)] as string[],
      workspaceContext: `Mode: Strategy Planning`,
      constraints: [],
    };

    const debateId = `debate-${Date.now()}`;
    let debateSkipped = false;
    emitDebateEvent('debate_start', debateId, conversationId);

    // Create callback to emit phase completion events to frontend
    const onPhaseComplete = async (phase: 'vanguard' | 'phantom' | 'arbiter', proposal?: any, review?: any, finalPlan?: any) => {
      if (debateSkipped) return;

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

      emitDebateEvent(phaseEventMap[phase], debateId, conversationId, frontendData);
    };

    const engine = new PeerAgentDebateEngine(runner.client, {
      verbose: false,
      complexityThreshold: 'moderate',
      timeoutMs: 180000,
      vanguardTimeoutMs: 60000,
      phantomTimeoutMs: 60000,
      arbiterTimeoutMs: 45000,
      onPhaseComplete,
      shouldAbort,
    });

    try {
      const outcome = await Promise.race([
        engine.debate(context).then(result => ({ type: 'result' as const, result })),
        waitForDebateSkip(debateId).then(() => ({ type: 'skip' as const })),
      ]);

      if (outcome.type === 'skip') {
        debateSkipped = true;
        logger.info(`[DebateChamber] Debate ${debateId} skipped by user`);
        emitDebateEvent('debate_skipped', debateId, conversationId, { reason: 'Skipped by user' });
        clearDebateSkip(debateId);
        return { debateResult: null };
      }

      clearDebateSkip(debateId);
      const debateResult: DebateResult = outcome.result;

      const frontendData = DebateEventEmitter.formatDebateResultForFrontend(debateResult);

      emitDebateEvent('debate_complete', debateResult.debateId, conversationId, frontendData);



      const isNoGo = debateResult.finalPlan.goNogo === 'no-go';
      if (isNoGo) {
        runner.telemetry.warn('[DebateChamber] Arbiter voted NO-GO — task will proceed anyway as requested');

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
        completionSignal: null,
        shouldContinueIteration: undefined,
      };
    } catch (err: any) {
      clearDebateSkip(debateId);
      console.error(`[DebateChamber] Debate failed: ${err.message}`);
      emitDebateEvent('debate_error', debateId, conversationId, undefined, err.message.slice(0, 200));

      return { debateResult: null };
    }
  };
};

function shouldUseDebateChamber(intent: string, userInput: string): { shouldDebate: boolean; reason: string } {
  const text = userInput.toLowerCase();

  if (['automate', 'question', 'conversation', 'research', 'analyze', 'background_task'].includes(intent)) {
    return { shouldDebate: false, reason: `Intent ${intent} does not need debate` };
  }

  const documentOnlyPattern = /\b(write|draft|create|make|update|edit|summari[sz]e)\b[\s\S]{0,80}\b(spec|specs|document|documentation|docs|readme|prd|proposal|report|essay|outline|brief|notes|requirements|changelog)\b/;
  if (documentOnlyPattern.test(text) && !/\b(implement|code|scaffold|bug|crash|error|security|production)\b/.test(text)) {
    return { shouldDebate: false, reason: 'Writing specs or documents should not use Debate Chamber' };
  }

  const criticalBug = /\b(critical|severe|production|prod|security|vulnerability|exploit|data loss|corrupt|crash|outage|payment|auth|permission|privacy|leak|broken deploy|release blocker)\b/.test(text);
  if (intent === 'fix' && criticalBug) {
    return { shouldDebate: true, reason: 'critical bug or high-risk fix' };
  }

  const bigProject = /\b(full|complete|entire|from scratch|scaffold|scafold|new app|new project|whole|large|big|multi[- ]?feature|multi[- ]?agent|dashboard|platform|website|next\.?js|electron|api|backend|frontend|database|auth|payments?)\b/.test(text);
  if ((intent === 'build' || intent === 'coding') && bigProject) {
    return { shouldDebate: true, reason: 'large coding/build project' };
  }

  const complexCoding = /\b(complex|architecture|harness|orchestrat|migration|refactor|multi[- ]?system|distributed|concurrent|race condition|state machine|subagent|manager|cross[- ]?module|end[- ]?to[- ]?end|integration)\b/.test(text);
  if (['coding', 'build', 'fix', 'task'].includes(intent) && complexCoding) {
    return { shouldDebate: true, reason: 'complex high-risk engineering task' };
  }

  return { shouldDebate: false, reason: 'Task is not large, critical, or complex enough for Debate Chamber' };
}
