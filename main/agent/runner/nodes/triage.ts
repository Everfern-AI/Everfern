import { START } from '@langchain/langgraph';
import { GraphStateType, IntentType, IntentClassification, StreamEvent } from '../state';
import { classifyIntent, classifyIntentLocal } from '../triage';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';

// LP-01-lite: announce the local fast-path once per runner instance.
// WeakSet (not a flag on the node closure) so repeated createTriageNode
// calls with the same runner don't re-announce, and entries are
// garbage-collected with the runner.
const localFastPathAnnounced = new WeakSet<object>();

/**
 * Factory for the triage graph node: classifies the user's intent, then
 * emits telemetry/stream events and advances the graph state for routing.
 *
 * Classification precedence:
 * 1. Local fast-path — when the provider is local (client.isLocal()),
 *    classifyIntentLocal answers deterministically with zero chat() calls
 *    and short-circuits before any AI/router interaction.
 * 2. AI classifier — cloud providers go through classifyIntent (cache →
 *    affirmative inheritance → LLM → 'task' fallback).
 * 3. Downgrade guard — regardless of path, 'operator' is demoted to 'task'
 *    unless the user manually enabled operatorMode.
 *
 * @param runner Agent runner — supplies the AI client and telemetry
 * @param eventQueue Optional stream sink for intent_classified events
 * @param missionTracker Optional tracker used to set the 'triage' phase
 * @param shouldAbort Optional poll, checked once on entry for user stops
 * @returns Node that returns a Partial<GraphStateType> with currentIntent,
 *          intentConfidence and taskPhase='routing' (a full state update,
 *          not a mutation — LangGraph state is immutable)
 */
export const createTriageNode = (runner: AgentRunner, eventQueue?: StreamEvent[], missionTracker?: MissionTracker, shouldAbort?: () => boolean) => {
  const integrator = createMissionIntegrator(missionTracker);
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    // Check for abort signal
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    integrator.startNode('triage', 'Analyzing user intent and decomposing task');

    // Emit phase change event for triage phase
    if (missionTracker) {
      missionTracker.setPhase('triage');
    }

    try {
      runner.telemetry.transition('triage');
      runner.telemetry.info('Analyzing user intent and decomposing task requirements...');

      // BUG-01 FIX: Do NOT mutate state.messages directly.
      // LangGraph state is immutable — direct mutation bypasses the state reducer
      // and causes corrupted checkpoints, phantom messages, and duplicate messages on replay.

      const lastUserMsg = state.messages.filter(m => {
        const msg = m as any;
        return msg.role === 'user' || msg.type === 'human' || msg._getType?.() === 'human';
      }).pop();
      const content = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';

      // LP-01-lite: local fast-path — skip the AI classifier entirely on
      // local providers; use the normalized keyword classifier instead.
      // The cloud branch below is byte-identical to the pre-LP-01 behavior.
      // The classifyIntentLocal result fully replaces the AI result, so the
      // rest of the node (operator guard, telemetry, result) is path-agnostic.
      let classification: IntentClassification;
      const isLocalClient = !!(runner.client as any)?.isLocal?.();
      if (isLocalClient) {
        // announce once per runner: a log on every request would be noise
        // (the per-request mode is reported by the triageMode= line below)
        if (!localFastPathAnnounced.has(runner)) {
          localFastPathAnnounced.add(runner);
          console.debug('[Triage] local fast-path engaged (skipping classifyIntentAI)');
        }
        classification = classifyIntentLocal(content, state.messages);
      } else {
        try {
          classification = await classifyIntent(content, runner.client, state.messages, runner.workspaceDir, !!state.operatorMode);
        } catch (connErr) {
          // never let a connectivity failure kill the run: degrade to 'task'
          const msg = connErr instanceof Error ? connErr.message : String(connErr);
          console.warn('[Triage] AI classification failed:', msg);
          classification = { intent: 'task', confidence: 0.5, reasoning: `Classification unavailable: ${msg}` };
        }
      }
      // per-request mode marker ('fast' vs 'ai'), one log per invocation
      console.debug(`[Triage] triageMode=${isLocalClient ? 'fast' : 'ai'}`);

      // Precedence guard applied after classification (both paths): the AI
      // may suggest 'operator', but that intent is opt-in only — demote it
      // unless the user manually enabled Pursue-goal/operator mode.
      if (classification.intent === 'operator' && !state.operatorMode) {
        classification = {
          intent: 'task',
          confidence: Math.min(classification.confidence, 0.75),
          reasoning: 'Operator mode requires the user to enable Pursue goal manually.',
        };
      }

      runner.telemetry.info(`Intent identified: ${classification.intent.toUpperCase()} (${Math.round(classification.confidence * 100)}% confidence)`);

      eventQueue?.push({
        type: 'intent_classified',
        intent: classification.intent,
        confidence: classification.confidence,
        phase: 'triage'
      });

      // Fresh-copy state update returned to LangGraph: record the intent,
      // flip taskPhase to 'routing' so the graph continues to the routing/
      // decomposer node, and reset all per-phase completion flags for the
      // new run.
      const result = {
        currentIntent: classification.intent,
        intentConfidence: classification.confidence,
        taskPhase: 'routing' as const, // Transit to routing/decomposer
        codingComplete: false,
        dataAnalysisComplete: false,
        webExplorerComplete: false,
        deepResearchComplete: false,
      };

      integrator.completeNode('triage', `Intent classified as: ${classification.intent}`);
      return result;
    } catch (error) {
      integrator.failNode('triage', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
};
