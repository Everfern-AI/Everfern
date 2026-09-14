import { START } from '@langchain/langgraph';
import { GraphStateType, IntentType, IntentClassification, StreamEvent } from '../state';
import { classifyIntent } from '../triage';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';

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

      // Pass entire state.messages for context-aware classification
      let classification: IntentClassification;
      try {
        classification = await classifyIntent(content, runner.client, state.messages, runner.workspaceDir, !!state.operatorMode);
      } catch (connErr) {
        const msg = connErr instanceof Error ? connErr.message : String(connErr);
        console.warn('[Triage] AI classification failed:', msg);
        classification = { intent: 'task', confidence: 0.5, reasoning: `Classification unavailable: ${msg}` };
      }

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
