import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { addOrUpdateMemory } from '../../learning/memory/persistent-memory';
import { globalAbortManager } from '../abort-manager';
import { extractJsonFromLLM } from '../json-repair';

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

    // Run memory consolidation silently in the background without UI notifications
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

      const isLocal = runner.client?.isLocal?.();
      const timeoutMs = isLocal ? 60000 : 5000;
      const createTimeoutPromise = () => new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Memory operation timed out')), timeoutMs);
      });

      const response = await Promise.race([
        runner.client.chat({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          responseFormat: 'json',
          temperature: 0.2,
          maxTokens: 1000,
          abortSignal: globalAbortManager.abortController.signal,
        }),
        createTimeoutPromise()
      ]) as any;

      let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      const result = extractJsonFromLLM(content) || { newMemories: [] };
      const newMemories = result.newMemories || [];

      console.log(`[MemoryConsolidator] Found ${newMemories.length} memory entries to save/update.`);

      for (const mem of newMemories) {
        const { type, category, value, linkedFile } = mem;
        if (type && category && value && linkedFile) {
          await addOrUpdateMemory(type, category, value, linkedFile);
          console.log(`[MemoryConsolidator] Saved long-term ${type} (${category}): "${value}" -> ${linkedFile}`);
        }
      }

      if (newMemories.length === 0) {
        console.log('[MemoryConsolidator] Primary agent found no memories. Invoking secondary auditor agent...');
        
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

        const auditorResponse = await Promise.race([
          runner.client.chat({
            messages: [
              { role: 'system', content: auditorSystemPrompt },
              { role: 'user', content: userPrompt }
            ],
            responseFormat: 'json',
            temperature: 0.2,
            maxTokens: 1000,
            abortSignal: globalAbortManager.abortController.signal,
          }),
          createTimeoutPromise()
        ]) as any;

        let auditorContent = typeof auditorResponse.content === 'string' ? auditorResponse.content : JSON.stringify(auditorResponse.content);
        auditorContent = auditorContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const auditorResult = extractJsonFromLLM(auditorContent) || { newMemories: [] };
        const auditorNewMemories = auditorResult.newMemories || [];

        if (auditorNewMemories.length > 0) {
          console.log(`[MemoryConsolidator] Auditor found ${auditorNewMemories.length} missed memory entries.`);
          for (const mem of auditorNewMemories) {
            const { type, category, value, linkedFile } = mem;
            if (type && category && value && linkedFile) {
              await addOrUpdateMemory(type, category, value, linkedFile);
              console.log(`[MemoryConsolidator] Saved long-term ${type} (${category}): "${value}" -> ${linkedFile}`);
              newMemories.push(mem);
            }
          }
        }
      }

      console.log(`[MemoryConsolidator] Silent memory consolidation completed cleanly. Processed ${newMemories.length} entries.`);
    } catch (err: any) {
      console.warn('[MemoryConsolidator] Failed to consolidate memories silently:', err?.message || String(err));
    }

    return {};
  };
};
