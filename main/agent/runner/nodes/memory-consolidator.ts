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

    // Run memory consolidation silently in the background
    try {
      if (globalAbortManager.abortController.signal.aborted) return {};

      // Filter to user/human messages only to avoid bloating with massive tool outputs (scraped web pages, files, diffs)
      const userMessages = (state.messages || []).filter(m => {
        const role = (m as any).role || (m as any).type || (m as any)._getType?.();
        return role === 'user' || role === 'human';
      });

      if (userMessages.length === 0) return {};

      // Take the most recent user messages (up to 5)
      const recentUserMessages = userMessages.slice(-5);

      // Skip trivial confirmations or approvals that cannot contain enduring personal preferences
      const hasSubstantiveMessage = recentUserMessages.some(m => {
        const text = (typeof m.content === 'string' ? m.content : '').trim().toLowerCase();
        if (text.length < 5) return false;
        if (text.startsWith('[hitl_') || text.startsWith('[user approved') || text.startsWith('[user rejected')) return false;
        if (['yes', 'no', 'okay', 'sure', 'proceed', 'cancel', 'approve'].includes(text)) return false;
        return true;
      });

      if (!hasSubstantiveMessage) return {};

      const formattedHistory = recentUserMessages.map(m => {
        const role = (m as any).role || (m as any).type || (m as any)._getType?.() || 'user';
        let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        // Truncate giant pastes or log dumps to prevent token explosion
        if (content.length > 1500) {
          content = content.slice(0, 1500) + '... [truncated]';
        }
        return `[${role.toUpperCase()}]: ${content}`;
      }).join('\n\n');

      const systemPrompt = `You are the EverFern Memory Agent.
Your job is to analyze the conversation history and determine if the user EXPLICITLY stated an enduring personal preference, rule, or identity fact that should be remembered across future sessions.

STRICT EXTRACTION RULES (HIGH PRECISION ONLY):
1. User Preferences: ONLY extract explicit, enduring user preferences that the user explicitly declared about themselves (e.g., "I prefer dark mode", "I only fly Delta", "Always use Tailwind CSS", "My default currency is INR").
2. Identity Facts: Core facts about the user explicitly stated by the user (e.g., "My name is Preetham", "I am based in Hyderabad").
3. Architectural Rules: Explicit project architectural rules explicitly stated by the user (e.g., "Always format dates in ISO 8601").

PROHIBITED — NEVER EXTRACT OR SAVE:
- NEVER save temporary or one-off search queries (e.g., "searching flights to Rotterdam", "looking for hair creams on Amazon").
- NEVER save transient research findings, third-party website errors, or bot issues (e.g., "Skyscanner has bot detection", "No direct flights found").
- NEVER save conversational chatter, greetings, questions, or temporary task instructions.
- If in doubt, DO NOT SAVE. Default to an empty list.

Linked File Categorization:
- Billing/credit card preferences explicitly stated -> "PAYMENTS.md"
- Enduring airline/hotel preferences explicitly stated -> "TRAVEL.md"
- General coding styles, design preferences, identity -> "USER_PROFILE.md"
- Project-level persistent technical choices explicitly stated -> "PROJECT_STATE.md"

Respond with JSON only:
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

If no enduring memory should be saved (the common case), respond with:
{
  "newMemories": []
}`;

      const userPrompt = `Here is the conversation history:\n\n${formattedHistory}`;

      const isLocal = runner.client?.isLocal?.();
      const timeoutMs = isLocal ? 30000 : 15000;

      const timeoutController = new AbortController();
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        timeoutController.abort(new Error('Memory operation timed out'));
      }, timeoutMs);

      const onGlobalAbort = () => {
        timeoutController.abort(new Error('Execution aborted by user'));
      };
      globalAbortManager.abortController.signal.addEventListener('abort', onGlobalAbort, { once: true });

      try {
        const response = await runner.client.chat({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          responseFormat: 'json',
          temperature: 0.1,
          maxTokens: 500,
          abortSignal: timeoutController.signal,
        });

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const result = extractJsonFromLLM(content) || { newMemories: [] };
        const newMemories = (result.newMemories || []).filter((m: any) => {
          if (!m.type || !m.category || !m.value || !m.linkedFile) return false;
          const valLower = String(m.value).toLowerCase();
          // Reject common junk memories
          if (valLower.includes('bot detection') || valLower.includes('no direct flights') || valLower.includes('error') || valLower.includes('failed') || valLower.length < 5) {
            return false;
          }
          return true;
        });

        if (newMemories.length > 0) {
          console.log(`[MemoryConsolidator] High-confidence memories to save: ${newMemories.length}`);
          for (const mem of newMemories) {
            const { type, category, value, linkedFile } = mem;
            await addOrUpdateMemory(type, category, value, linkedFile);
            console.log(`[MemoryConsolidator] Saved ${type} (${category}): "${value}" -> ${linkedFile}`);
          }
        } else {
          console.log('[MemoryConsolidator] No enduring user preferences to save.');
        }
      } finally {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        globalAbortManager.abortController.signal.removeEventListener('abort', onGlobalAbort);
      }
    } catch (err: any) {
      console.log('[MemoryConsolidator] Silent memory consolidation skipped:', err?.message || String(err));
    }

    return {};
  };
};
