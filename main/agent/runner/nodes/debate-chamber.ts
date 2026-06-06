import { GraphStateType, StreamEvent, DecomposedTask } from '../state';
import { AgentRunner } from '../runner';
import { PeerAgentDebateEngine } from '../debate-engine';
import type { DebateContext, DebateResult } from '../debate-types';
import { DebateEventEmitter } from '../debate-event-emitter';
import { createMissionIntegrator } from '../mission-integrator';
import type { MissionTracker } from '../mission-tracker';
import { nodeLifecycle } from '../services/node-utils';

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
    const logger = nodeLifecycle(runner, 'debate_chamber');

    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    // Determine complexity based on intent instead of step count
    let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';
    const intent = state.currentIntent || 'unknown';
    const complexIntents = ['coding', 'build', 'automate', 'fix', 'task'];
    const simpleIntents = ['question', 'conversation', 'unknown'];

    if (complexIntents.includes(intent)) {
      complexity = 'complex';
    } else if (simpleIntents.includes(intent)) {
      complexity = 'simple';
    }

    if (!PeerAgentDebateEngine.shouldDebate(complexity, 'moderate')) {
      logger.info(`Task intent "${intent}" (complexity: ${complexity}) below threshold — skipping debate`);

      emitDebateEvent('debate_skipped', `debate-${Date.now()}`, { reason: `Complexity: ${complexity}` });
      return { debateResult: null };
    }

    if (!runner.client) {
      logger.warn('No AI client available — skipping debate');
      return { debateResult: null };
    }

    runner.telemetry.info(`[DebateChamber] 🎭 STARTING debate for ${complexity} task`);


    const lastUserMsg = (state.messages ?? []).filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();
    const userInput = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content ?? ''))
      : '';

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
      const debateResult: DebateResult = await engine.debate(context);

      const frontendData = DebateEventEmitter.formatDebateResultForFrontend(debateResult);

      emitDebateEvent('debate_complete', debateResult.debateId, frontendData);



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
      console.error(`[DebateChamber] Debate failed: ${err.message}`);
      emitDebateEvent('debate_error', debateId, undefined, err.message.slice(0, 200));

      return { debateResult: null };
    }
  };
};
