import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { findMatchingSensitivePreference } from '../../learning/memory/persistent-memory';
import { askUserTool } from '../../tools/ask-user';
import { saveHitlRequest } from '../../../store/hitl';
import { stateManager } from '../state-manager';
import { interrupt } from '@langchain/langgraph';
import * as crypto from 'crypto';

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

    const conversationId = config?.configurable?.executionContext?.conversationId || state.missionId || 'unknown';
    const isResuming = config?.configurable?.executionContext?.isResuming;

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

    console.log(`[MemoryCheck] Sensitive preference matched: ${match.category} -> "${match.value}"`);

    const requestId = `pref_check_${crypto.randomUUID().substring(0, 8)}`;
    const timestamp = new Date().toISOString();

    const approvalRequest = {
      id: requestId,
      conversationId,
      timestamp,
      question: `I found a saved preference for ${match.category}: "${match.value}". Do you want to proceed with this preference or switch?`,
      details: {
        tools: [],
        summary: `Saved Preference: "${match.value}"`,
        reasoning: `Sensitive preference detected for category "${match.category}".`,
      },
      options: ['proceed', 'switch']
    };

    if (!isResuming) {
      if (conversationId && conversationId !== 'unknown') {
        saveHitlRequest(approvalRequest);
      }

      // Emit tool_start for UI/telemetry
      eventQueue?.push({
        type: 'tool_start',
        toolName: 'confirm_preference',
        toolCallId: requestId,
        toolArgs: { question: approvalRequest.question }
      });

      // Execute askUserTool
      const hitlResult = await askUserTool.execute({
        questions: [
          {
            question: `💡 Saved Preference Found\n\nI noticed you have a saved preference for **${match.category}**:\n"${match.value}"\n\nDo you want to proceed with this preference or switch to something else?`,
            options: [
              { label: `✅ Yes, proceed with this preference`, value: 'proceed' },
              { label: `❌ No, switch / override this preference`, value: 'switch' }
            ],
            multiSelect: false
          }
        ]
      }, (msg) => runner.telemetry.info(msg));

      eventQueue?.push({
        type: 'tool_call',
        toolCall: {
          id: requestId,
          toolCallId: requestId,
          toolName: 'confirm_preference',
          args: { question: approvalRequest.question },
          result: hitlResult,
        },
      } as any);

      eventQueue?.push({
        type: 'hitl_request',
        request: approvalRequest,
      } as any);

      if (conversationId && conversationId !== 'unknown') {
        stateManager.setInterrupted(conversationId, approvalRequest);
      }
    }

    runner.telemetry.info('Awaiting preference confirmation from user...');

    let answer: any;
    try {
      answer = interrupt(approvalRequest);
    } catch (interruptErr) {
      console.warn('[MemoryCheck] interrupt() failed or unsupported, routing forward.');
      return { taskPhase: 'triage' as const };
    }

    const answerStr = String(answer).toLowerCase();
    console.log(`[MemoryCheck] User response: "${answerStr}"`);

    // Process answer
    if (answerStr.includes('proceed') || answerStr.includes('[hitl_approved]') || answerStr.includes('yes')) {
      runner.telemetry.info(`User confirmed preference: "${match.value}"`);
      state.messages.push({
        role: 'system',
        content: `[PREFERENCE_CONFIRMED] User confirmed they want to use their saved preference for ${match.category}: "${match.value}". Use this preference.`,
        created_at: new Date().toISOString()
      } as any);
    } else {
      runner.telemetry.info(`User decided to switch/override preference.`);
      const cleanAnswer = String(answer).replace(/\[hitl_rejected\]/gi, '').replace(/switch/gi, '').trim();
      
      const overrideMsg = cleanAnswer && cleanAnswer.length > 0
        ? `[PREFERENCE_OVERRIDDEN] User decided to switch preference. They specified: "${cleanAnswer}". Use this override instead.`
        : `[PREFERENCE_OVERRIDDEN] User decided to switch preference. DO NOT use the saved preference "${match.value}". Ask them for their details or choose an alternative option.`;
      
      state.messages.push({
        role: 'system',
        content: overrideMsg,
        created_at: new Date().toISOString()
      } as any);
    }

    return {
      messages: state.messages,
      taskPhase: 'triage' as const
    };
  };
};
