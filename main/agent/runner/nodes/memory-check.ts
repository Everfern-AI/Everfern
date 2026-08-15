import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { findMatchingSensitivePreference } from '../../learning/memory/persistent-memory';

const getLatestUserText = (state: GraphStateType): string => {
  const messages = state.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    const role = msg.role || msg.type || msg._getType?.();
    if (role === 'user' || role === 'human') {
      return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    }
  }
  return '';
};

export const createMemoryCheckNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType, config?: any): Promise<Partial<GraphStateType>> => {
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    // Retrieve user query
    const userQuery = getLatestUserText(state);
    if (!userQuery) {
      return { taskPhase: 'triage' as const };
    }

    // Check if there is a matching sensitive preference
    const match = findMatchingSensitivePreference(userQuery);
    if (!match) {
      // No sensitive preference matching, proceed directly to intent classifier
      return { taskPhase: 'triage' as const };
    }

    console.log(`[MemoryCheck] Relevant preference found: ${match.category} -> "${match.value}". Injecting seamlessly into context.`);
    runner.telemetry.info(`Applying saved preference for ${match.category}: "${match.value}"`);

    // Non-blocking preference context injection:
    // Inform the downstream nodes (Brain, Specialists, Navis) about the user's preference
    // without interrupting the execution loop or creating artificial tool calls.
    const messages = state.messages || [];
    const preferencePrompt = `[SAVED_USER_PREFERENCE] The user has a saved preference for ${match.category}: "${match.value}". Respect and incorporate this preference where relevant into your plan and tool executions.`;
    
    // Only inject if not already present in the last system messages
    const alreadyInjected = messages.some(m => typeof m.content === 'string' && m.content.includes(`preference for ${match.category}: "${match.value}"`));
    if (!alreadyInjected) {
      messages.push({
        role: 'system',
        content: preferencePrompt,
        created_at: new Date().toISOString()
      } as any);
    }

    return {
      messages,
      taskPhase: 'triage' as const
    };
  };
};
