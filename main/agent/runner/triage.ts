import { IntentType, IntentClassification } from './state';
import type { AIClient } from '../../lib/ai-client';
import { normalizeMessages } from './services/message-utils';

// ── Triage AI Prompt ─────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a precise intent classifier for an AI assistant. Classify the user's request into exactly one intent category based on its full semantic meaning.

INTENT CATEGORIES:
- operator — High-level, open-ended business objectives or goals that will take 6+ hours or full teams to execute (e.g. "grow my brand to 100k users", "get 100 beta users", "launch marketing campaign"). This implies long-running autonomy, A/B testing, and learning over days.
- coding — Writing, editing, refactoring, debugging, or creating code/scripts (NOT booking trips, flight searches, or web-based services even if they involve keywords like "booking")
- fix — Diagnosing and fixing bugs, errors, crashes, or broken behavior in code
- build — Scaffolding new projects, apps, repos, or templates from scratch
- analyze — Processing data, generating reports, charts, visualizations from datasets
- research — Web research, searching the internet, investigating topics, booking flights/hotels, trip planning, comparing options, and all browser-based web interaction including opening URLs (NOT desktop automation)
- automate — Desktop GUI automation: clicking native UI elements, interacting with desktop applications (NOT websites or browser-based tasks)
- background_task — Running a silent, scheduled, or cron background agent loop, checking file system/build/lint status in the background
- question — Answering factual questions, explaining concepts, providing information
- conversation — Greetings, small talk, acknowledgments, follow-ups with no actionable task
- task — General actionable task that doesn't clearly fit the above (e.g. file organization, file renaming; NOT coding, and NOT trip booking/flight searches)

Respond with JSON only: {"intent":"<category>","confidence":<0.0-1.0>,"reasoning":"<one sentence explaining why>"}`;

const TRIAGE_USER_TEMPLATE = (userInput: string, historySnippet: string) => `
CONVERSATION HISTORY (last 5 messages):
${historySnippet || 'None'}

CURRENT USER REQUEST:
"${userInput}"

Classify the intent.`;

import { loadSoul, loadAgents } from '../personality-manager';

// ── Main AI Classification ────────────────────────────────────────────

export async function classifyIntent(
  userInput: string,
  client?: AIClient,
  history: any[] = [],
  workspaceRoot?: string
): Promise<IntentClassification> {
  if (!client) {
    return { intent: 'task', confidence: 0.5, reasoning: 'AI unavailable' };
  }

  const normalized = normalizeMessages(history);
  const historySnippet = normalized.slice(-5).map(m => {
    const role = (m.role || 'user').toUpperCase();
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content.slice(0, 200);
    } else if (Array.isArray(m.content)) {
      const textParts = m.content.filter((item: any) => item.type === 'text' || typeof item === 'string');
      content = textParts.map((item: any) => typeof item === 'string' ? item : item.text || '').join(' ').slice(0, 200);
      const hasFiles = m.content.some((item: any) => item.type === 'file' || item.type === 'image_url');
      if (hasFiles) content += ' [FILE ATTACHED]';
    }
    return `[${role}]: ${content}`;
  }).join('\n');

  try {
    const soulContent = loadSoul(workspaceRoot);
    const agentsContent = loadAgents(workspaceRoot);
    const triageSystemPrompt = `${TRIAGE_SYSTEM_PROMPT}\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n${soulContent}\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n${agentsContent}`;

    const response = await client.chat({
      messages: [
        { role: 'system', content: triageSystemPrompt },
        { role: 'user', content: TRIAGE_USER_TEMPLATE(userInput, historySnippet) },
      ],
      responseFormat: 'json',
      temperature: 0.2,
      maxTokens: 500,
    }) as any;

    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const data = JSON.parse(content);
    return {
      intent: (data.intent || 'task') as IntentType,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
      reasoning: data.reasoning || 'AI classification',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { intent: 'task', confidence: 0.5, reasoning: `AI error: ${msg}` };
  }
}

/**
 * Check if task is read-only (no mutations)
 */
export function isReadOnlyTask(intent: IntentType): boolean {
  return ['question', 'conversation'].includes(intent);
}
