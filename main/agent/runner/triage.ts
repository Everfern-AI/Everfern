import { IntentType, IntentClassification } from './state';
import type { AIClient } from '../../lib/ai-client';
import { normalizeMessages } from './services/message-utils';

// ── Triage AI Prompt ─────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a precise intent classifier for an AI assistant. Classify the user's request into exactly one intent category based on its full semantic meaning.

INTENT CATEGORIES:
- operator — Only when the user explicitly enabled Pursue goal/operator mode for a high-level, open-ended business objective or goal that will take 6+ hours or full teams to execute (e.g. "grow my brand to 100k users", "get 100 beta users", "launch marketing campaign"). Without the manual Pursue goal flag, classify these as task.
- coding — Writing, editing, refactoring, debugging, or creating code/scripts (NOT booking trips, flight searches, or web-based services even if they involve keywords like "booking")
- fix — Diagnosing and fixing bugs, errors, crashes, or broken behavior in code
- build — Scaffolding new projects, apps, repos, or templates from scratch
- analyze — Processing data, generating reports, charts, visualizations from datasets
- research — Web research, searching the internet, investigating topics, booking flights/hotels, trip planning, comparing options, and all browser-based web interaction including opening URLs, Gmail/webmail, Google Docs/Drive, SaaS dashboards, and web forms (NOT desktop automation)
- automate — Desktop GUI automation: clicking native UI elements, interacting with desktop applications (NOT websites, web apps, Gmail, browser tabs, or browser-based tasks)
- background_task — Running a silent, scheduled, or cron background agent loop, checking file system/build/lint status in the background
- question — Answering factual questions, explaining concepts, providing information
- conversation — Greetings, small talk, acknowledgments, follow-ups with no actionable task
- task — General actionable task that doesn't clearly fit the above (e.g. file organization, file renaming; NOT coding, and NOT trip booking/flight searches)

ROUTING RULES:
- If the request asks to use the computer, control the screen, click/type in a desktop app, interact with native Windows UI, or perform GUI automation, classify as automate.
- automate/computer-use tasks must execute directly with the computer_use tool path. They do not need Debate Chamber planning.
- Do not classify browser research, website navigation, Gmail/webmail, Google Docs/Drive, SaaS apps, browser tabs, or website forms as automate. Classify those as research even when the user says "use the computer".
- Only classify browser-looking work as automate if the user explicitly asks to control a native browser window as an OS-level desktop UI and Navis cannot apply.
- Writing specs, PRDs, reports, READMEs, proposals, requirements, outlines, or other documents is not coding/build/fix unless the user explicitly asks to implement source code or scaffold an app/repo.
- Debate Chamber should only be used downstream for large coding/build projects, critical/high-risk bugs, or complex engineering changes. It should not be used for document/spec writing or simple edits.

Respond with JSON only: {"intent":"<category>","confidence":<0.0-1.0>,"reasoning":"<one sentence explaining why>"}`;

const TRIAGE_USER_TEMPLATE = (userInput: string, historySnippet: string, operatorMode = false) => `
CONVERSATION HISTORY (last 5 messages):
${historySnippet || 'None'}

MANUAL PURSUE GOAL / OPERATOR MODE:
${operatorMode ? 'ENABLED' : 'DISABLED'}

CURRENT USER REQUEST:
"${userInput}"

Classify the intent.`;

import { loadSoul, loadAgents } from '../personality-manager';

// ── Main AI Classification ────────────────────────────────────────────

export async function classifyIntent(
  userInput: string,
  client?: AIClient,
  history: any[] = [],
  workspaceRoot?: string,
  operatorMode?: boolean
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
        { role: 'user', content: TRIAGE_USER_TEMPLATE(userInput, historySnippet, !!operatorMode) },
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
