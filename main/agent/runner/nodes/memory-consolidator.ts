import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { addOrUpdateMemory } from '../../learning/memory/persistent-memory';
import { globalAbortManager } from '../abort-manager';

export const createMemoryConsolidatorNode = (
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

    integrator.startNode('evaluation', 'Consolidating memories from interaction');
    runner.telemetry.transition('evaluating');
    runner.telemetry.info('Analyzing conversation to promote habits and preferences to persistent memory...');

    try {
      const formattedHistory = state.messages.map(m => {
        const role = (m as any).role || (m as any).type || (m as any)._getType?.() || 'unknown';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${role.toUpperCase()}]: ${content}`;
      }).join('\n');

      const systemPrompt = `You are the EverFern Memory Agent.
Your job is to analyze the conversation history of the current interaction and decide if there are any new or updated user preferences, habits, or facts that should be promoted to long-term memory.

Analyze the conversation. Identify:
1. User Preferences: Personal preferences, favorite tools, coding style, travel preference, airline preference, billing/payment preferences, etc. (e.g. "prefers Delta airlines", "wants to use Visa ending in 1234").
2. Habits: Recurring user behaviors or requirements (e.g. "User always wants tests included").
3. General Facts: Key project architectural choices, facts about the user's environment, paths, APIs, etc.

You MUST choose the correct linked file for the memory type:
- If it is about billing, payments, credit cards, or accounts -> Save to "PAYMENTS.md"
- If it is about airlines, hotels, travel, seat selections, or bookings -> Save to "TRAVEL.md"
- If it is about coding styles, favorite frameworks, or general user preferences -> Save to "USER_PROFILE.md"
- If it is a general fact about the codebase, environment, or a specific project fact -> Save to "PROJECT_STATE.md"

Respond with JSON only in the following format:
{
  "newMemories": [
    {
      "type": "preference" | "habit" | "fact",
      "category": string, (e.g., "airline", "payment", "coding", "general")
      "value": string, (the preference or fact details)
      "linkedFile": "PAYMENTS.md" | "TRAVEL.md" | "USER_PROFILE.md" | "PROJECT_STATE.md"
    }
  ]
}

If no new memory should be saved, respond with:
{
  "newMemories": []
}`;

      const userPrompt = `Here is the conversation history of the current interaction:\n\n${formattedHistory}`;

      const response = await runner.client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        responseFormat: 'json',
        temperature: 0.2,
        maxTokens: 1000,
        abortSignal: globalAbortManager.abortController.signal,
      }) as any;

      let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        content = content.substring(firstBrace, lastBrace + 1);
      }

      const result = JSON.parse(content);
      const newMemories = result.newMemories || [];

      console.log(`[MemoryConsolidator] Found ${newMemories.length} memory entries to save/update.`);

      for (const mem of newMemories) {
        const { type, category, value, linkedFile } = mem;
        if (type && category && value && linkedFile) {
          addOrUpdateMemory(type, category, value, linkedFile);
          runner.telemetry.info(`[Memory] Saved long-term ${type} (${category}): "${value}" -> ${linkedFile}`);
        }
      }

      if (newMemories.length === 0) {
        console.log('[MemoryConsolidator] Primary agent found no memories. Invoking secondary auditor agent...');
        runner.telemetry.info('Double-checking with Memory Auditor to ensure no important preferences or facts were missed...');
        
        const auditorSystemPrompt = `You are the EverFern Memory Auditor.
Your job is to perform a rigorous secondary audit on the conversation history of the current interaction.
The primary agent decided that no new or updated user preferences, habits, or facts should be stored.
You must double-check this decision. Look very closely for:
1. User Preferences: Travel details (airlines, flights), payment details (payment methods, credit cards), coding styles, general user preferences.
2. Habits: Repeated actions or requirements requested by the user.
3. General Facts: Any architectural choices, file structure, API details, paths, or settings explicitly stated or decided.

Be extremely careful. Look for subtle details like:
- Preferred names or tools.
- Operating system or hardware environment choices.
- Custom directories or layout preferences.
- Billing, flight details, or travel choices.

You MUST choose the correct linked file for the memory type:
- Billing/payments/accounts -> Save to "PAYMENTS.md"
- Travel/airlines/bookings -> Save to "TRAVEL.md"
- Coding styles/frameworks/general preferences -> Save to "USER_PROFILE.md"
- General facts about codebase/environment/project -> Save to "PROJECT_STATE.md"

Respond with JSON only in the following format:
{
  "newMemories": [
    {
      "type": "preference" | "habit" | "fact",
      "category": string,
      "value": string,
      "linkedFile": "PAYMENTS.md" | "TRAVEL.md" | "USER_PROFILE.md" | "PROJECT_STATE.md"
    }
  ]
}

If you agree that there is absolutely nothing to store, respond with:
{
  "newMemories": []
}`;

        const auditorResponse = await runner.client.chat({
          messages: [
            { role: 'system', content: auditorSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          responseFormat: 'json',
          temperature: 0.2,
          maxTokens: 1000,
          abortSignal: globalAbortManager.abortController.signal,
        }) as any;

        let auditorContent = typeof auditorResponse.content === 'string' ? auditorResponse.content : JSON.stringify(auditorResponse.content);
        auditorContent = auditorContent.replace(/<think>[\s\S]*?<\/think>/g, '');
        auditorContent = auditorContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

        const firstBraceAud = auditorContent.indexOf('{');
        const lastBraceAud = auditorContent.lastIndexOf('}');
        if (firstBraceAud !== -1 && lastBraceAud > firstBraceAud) {
          auditorContent = auditorContent.substring(firstBraceAud, lastBraceAud + 1);
        }

        const auditorResult = JSON.parse(auditorContent);
        const auditorNewMemories = auditorResult.newMemories || [];

        if (auditorNewMemories.length > 0) {
          console.log(`[MemoryConsolidator] Auditor found ${auditorNewMemories.length} missed memory entries.`);
          for (const mem of auditorNewMemories) {
            const { type, category, value, linkedFile } = mem;
            if (type && category && value && linkedFile) {
              addOrUpdateMemory(type, category, value, linkedFile);
              runner.telemetry.info(`[Memory] Saved long-term ${type} (${category}): "${value}" -> ${linkedFile}`);
              newMemories.push(mem);
            }
          }
        }
      }

      integrator.completeNode('evaluation', `Memory consolidation completed. Processed ${newMemories.length} entries.`);
    } catch (err) {
      console.warn('[MemoryConsolidator] Failed to consolidate memories:', err);
      integrator.failNode('evaluation', err instanceof Error ? err.message : String(err));
    }

    return {};
  };
};
