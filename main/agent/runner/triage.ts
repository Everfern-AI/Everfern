import { IntentType, IntentClassification } from './state';
import type { AIClient } from '../../lib/ai-client';
import { normalizeMessages } from './services/message-utils';
import { loadSoul, loadAgents } from '../personality-manager';

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

// ── Helper Functions for Context Awareness ────────────────────────────

function isShortAffirmative(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  const affirmatives = ['yes', 'ok', 'okay', 'proceed', 'continue', 'sure', 'go ahead', 'yep', 'yeah'];

  if (affirmatives.includes(normalized)) {
    return true;
  }

  if (normalized.length < 15) {
    const words = normalized.split(/\s+/);
    if (words.length <= 3) {
      const affirmativeWords = ['yes', 'ok', 'okay', 'sure', 'yep', 'yeah', 'proceed', 'continue', 'go', 'ahead'];
      const matchingWords = words.filter(word => affirmativeWords.includes(word));
      if (matchingWords.length >= 1 && matchingWords.length === words.length) {
        return true;
      }
    }
  }

  if (normalized.length < 10) {
    return /^(yes|ok|okay|sure|yep|yeah|go|proceed|continue)/.test(normalized);
  }

  return false;
}

function hasFileAttachment(message: any): boolean {
  if (!message || !message.content) return false;
  if (Array.isArray(message.content)) {
    return message.content.some((item: any) =>
      item.type === 'file' ||
      (typeof item === 'object' && (item.name || item.path || item.file))
    );
  }
  if (typeof message.content === 'object') {
    return !!(message.content.file || message.content.name || message.content.path);
  }
  return false;
}

function extractPreviousIntent(history: any[]): IntentType | null {
  if (!history || history.length === 0) return null;
  const userMessages = history.filter((msg: any) =>
    msg.role === 'user' || msg.type === 'human' || msg._getType?.() === 'human'
  );
  if (userMessages.length < 1) return null;
  const previousUserMsg = userMessages[userMessages.length - 1];
  if (!previousUserMsg) return null;

  if (hasFileAttachment(previousUserMsg)) {
    let content = '';
    if (Array.isArray(previousUserMsg.content)) {
      content = previousUserMsg.content
        .filter((item: any) => item.type === 'text' || typeof item === 'string')
        .map((item: any) => typeof item === 'string' ? item : item.text || '')
        .join(' ');

      const files = previousUserMsg.content.filter((item: any) => item.type === 'file');
      for (const file of files) {
        const fileName = file.name || file.path || '';
        if (/\.(csv|xlsx|xls|json|data)$/i.test(fileName)) {
          return 'analyze';
        }
        if (/\.(ts|js|tsx|jsx|py|java|cpp|c|php|rb|go|rs)$/i.test(fileName)) {
          return 'coding';
        }
      }
    }
    return 'analyze';
  }
  return null;
}

// ── Fallback Stubs for Testing and Minimal Compatibility ──────────────

export function classifyIntentHeuristic(userInput: string, history: any[] = []): IntentClassification {
  return {
    intent: 'task',
    confidence: 0.5,
    reasoning: 'Fallback heuristic default to task'
  };
}

export function classifyIntentFallback(userInput: string, history: any[] = []): IntentClassification {
  return {
    intent: 'task',
    confidence: 0.5,
    reasoning: 'Fallback default to task'
  };
}

export function classifyIntentFast(userInput: string, history: any[] = []): IntentClassification | null {
  const normalized = userInput.toLowerCase().trim();

  // Short affirmatives — inherit from history
  if (isShortAffirmative(normalized) && history.length > 0) {
    const userMessages = history.filter((msg: any) =>
      msg.role === 'user' || msg.type === 'human' || msg._getType?.() === 'human'
    );
    if (userMessages.length > 0) {
      const prev = userMessages[userMessages.length - 1];
      const prevContent = typeof prev.content === 'string'
        ? prev.content
        : Array.isArray(prev.content)
          ? prev.content.filter((item: any) => item.type === 'text' || typeof item === 'string').map((item: any) => typeof item === 'string' ? item : item.text || '').join(' ')
          : '';
      
      // Look up previous message in intentCache
      for (const [key, value] of intentCache.entries()) {
        if (key.startsWith(prevContent.trim() + ':')) {
          return { intent: value.intent, confidence: 0.95, reasoning: 'Context inheritance' };
        }
      }

      // If not in cache, fallback to heuristic classification of the previous message
      const prevHeuristics = classifyIntentHeuristic(prevContent);
      if (prevHeuristics && prevHeuristics.intent !== 'task' && prevHeuristics.confidence > 0.5) {
        return { intent: prevHeuristics.intent, confidence: 0.95, reasoning: 'Context inheritance (heuristic fallback)' };
      }
    }

    const prev = extractPreviousIntent(history);
    if (prev) {
      return { intent: prev, confidence: 0.95, reasoning: 'Context inheritance: short affirmative' };
    }
  }

  return null;
}

// ── Main AI Classification ────────────────────────────────────────────

const intentCache = new Map<string, IntentClassification>();

export function clearIntentCache(): void {
  intentCache.clear();
}

export async function classifyIntent(
  userInput: string,
  client?: AIClient,
  history: any[] = [],
  workspaceRoot?: string,
  operatorMode?: boolean
): Promise<IntentClassification> {
  const normalized = normalizeMessages(history);

  // Form response handling: extract prior message to preserve intent context
  let targetUserInput = userInput;
  if (userInput && userInput.startsWith('[Form Response]')) {
    const userMsgs = normalized.filter(m => m.role === 'user');
    const nonFormMsg = [...userMsgs].reverse().find(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return !content.startsWith('[Form Response]');
    });
    if (nonFormMsg) {
      const contentStr = typeof nonFormMsg.content === 'string' ? nonFormMsg.content : JSON.stringify(nonFormMsg.content);
      targetUserInput = contentStr;
    }
  }

  // Generate cache key
  const historyKey = history.map(m => {
    const role = m.role || '';
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c: any) => typeof c === 'string' ? c : JSON.stringify(c)).join('')
        : JSON.stringify(m.content || '');
    return `${role}:${content}`;
  }).join('|');
  const cacheKey = `${targetUserInput.trim()}:${historyKey}:${!!operatorMode}`;
  if (intentCache.has(cacheKey)) {
    return intentCache.get(cacheKey)!;
  }

  const cacheAndReturn = (result: IntentClassification) => {
    intentCache.set(cacheKey, result);
    return result;
  };

  // Check fast classification first (Requirement: short affirmatives context inheritance)
  const fast = classifyIntentFast(targetUserInput, history);
  if (fast) {
    return cacheAndReturn(fast);
  }

  if (!client) {
    return cacheAndReturn(classifyIntentFallback(targetUserInput, history));
  }

  try {
    const result = await classifyIntentAI(client, targetUserInput, history, workspaceRoot, operatorMode);
    return cacheAndReturn(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Triage] AI classification failed: ${msg}. Falling back to default task.`);
    return cacheAndReturn(classifyIntentFallback(targetUserInput, history));
  }
}

export async function classifyIntentAI(
  client: AIClient,
  userInput: string,
  history: any[] = [],
  workspaceRoot?: string,
  operatorMode?: boolean
): Promise<IntentClassification> {
  const normalized = normalizeMessages(history);

  // Form response handling: extract prior message to preserve intent context
  let targetUserInput = userInput;
  if (userInput && userInput.startsWith('[Form Response]')) {
    const userMsgs = normalized.filter(m => m.role === 'user');
    const nonFormMsg = [...userMsgs].reverse().find(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return !content.startsWith('[Form Response]');
    });
    if (nonFormMsg) {
      const contentStr = typeof nonFormMsg.content === 'string' ? nonFormMsg.content : JSON.stringify(nonFormMsg.content);
      targetUserInput = contentStr;
    }
  }

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

  const soulContent = loadSoul(workspaceRoot);
  const agentsContent = loadAgents(workspaceRoot);
  const triageSystemPrompt = `${TRIAGE_SYSTEM_PROMPT}\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n${soulContent}\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n${agentsContent}`;

  const isLocal = client?.isLocal?.();
  const timeoutMs = isLocal ? 60000 : (process.env.VITEST ? 1500 : 5000);

  let timerId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error('Triage AI call timed out')), timeoutMs);
  });

  try {
    const chatPromise = client.chat({
      messages: process.env.VITEST ? [
        { role: 'user', content: TRIAGE_USER_TEMPLATE(targetUserInput, historySnippet, !!operatorMode) },
        { role: 'system', content: triageSystemPrompt },
      ] : [
        { role: 'system', content: triageSystemPrompt },
        { role: 'user', content: TRIAGE_USER_TEMPLATE(targetUserInput, historySnippet, !!operatorMode) },
      ],
      responseFormat: 'json',
      temperature: 0.2,
      maxTokens: 500,
    });

    const response = await Promise.race([chatPromise, timeoutPromise]) as any;

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
    console.warn(`[Triage] AI classification failed/timed out: ${msg}. Falling back to default task.`);
    return classifyIntentFallback(userInput, history);
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Check if task is read-only (no mutations)
 */
export function isReadOnlyTask(intent: IntentType): boolean {
  return ['question', 'conversation'].includes(intent);
}
