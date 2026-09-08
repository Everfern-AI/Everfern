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

/** Compatibility stub — always returns 'task'. See classifyIntentLocal for the real local classifier. */
export function classifyIntentHeuristic(userInput: string, history: any[] = []): IntentClassification {
  return {
    intent: 'task',
    confidence: 0.5,
    reasoning: 'Fallback heuristic default to task'
  };
}

/** Compatibility stub — always returns 'task'; used when there is no AI client or the AI call fails. */
export function classifyIntentFallback(userInput: string, history: any[] = []): IntentClassification {
  return {
    intent: 'task',
    confidence: 0.5,
    reasoning: 'Fallback default to task'
  };
}

/**
 * Pre-classifier for short affirmatives ("yes", "ok", "go ahead"): instead of
 * classifying the affirmative itself, inherit the previous user turn's intent —
 * checked against intentCache first, then message attachments/heuristics.
 * Returns null when the input isn't a short affirmative, meaning "defer to
 * the next classifier in the chain" (keyword rules or the AI classifier).
 */
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

// In-process cache of AI classifications, keyed by (input, history, operatorMode).
// Only the AI path uses it — the local fast-path skips this cache because its
// regex rules cost less than building the history-heavy cache key (its
// affirmative-inheritance step still reads it via classifyIntentFast).
const intentCache = new Map<string, IntentClassification>();

/** Clears the in-process AI classification cache (e.g. between sessions or tests). */
export function clearIntentCache(): void {
  intentCache.clear();
}

/**
 * AI classification pipeline — the cloud/router path. The triage node's local
 * fast-path bypasses this entirely when the provider is local.
 * Precedence: intentCache hit → short-affirmative inheritance
 * (classifyIntentFast) → AI classifier → 'task' fallback (no client or error).
 * Every result is memoized in intentCache.
 *
 * @param userInput Latest user message; "[Form Response]" inputs are rewritten
 *                  to the prior non-form user message to preserve intent context
 * @param client AI client; when omitted the fallback stub is returned
 * @param history Conversation history, used for inheritance and the cache key
 * @param workspaceRoot Roots the SOUL.md/AGENTS.md lookups folded into the prompt
 * @param operatorMode Manual Pursue-goal flag; affects the prompt and cache key
 */
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

/**
 * The single LLM call the local fast-path exists to skip: assembles the system
 * prompt (TRIAGE_SYSTEM_PROMPT + SOUL.md + AGENTS.md), races the chat call
 * against a timeout (60s local, 5s cloud, 1.5s under vitest), then parses the
 * JSON reply. On timeout/failure/parse error it falls back to 'task'.
 * Param semantics as in classifyIntent.
 */
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
    // Some models wrap the JSON reply in <think>…</think> blocks or markdown
    // fences — strip both before parsing.
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

// ── Local Fast-Path Keyword Classifier ────────────────────────────────
// Normalized keyword rules mapped to the real IntentType enum. Used only
// when runner.client.isLocal() — the cloud branch is byte-identical.
// Null (no rule match) falls back to 'task'.
//
// Safe/cheap by construction: each rule is one precompiled regex tested with
// .test() against lowercased text — deterministic, allocation-light, free of
// nested quantifiers (no catastrophic backtracking), and with no network or
// state access, so it can run on every request without memoization. The
// check order inside classifyIntentLocal is part of the contract: the first
// matching rule wins.

// Web/URL presence ⇒ research. The "NEG" is the negations: (?<!no ) skips
// "no <website>"-style phrasing, and the lookahead after "browser" excludes
// extension/plugin/add-on mentions so extension work falls through to coding.
const LOCAL_NEG_URL_BROWSER_EXT = /(?<!no )\b(?:https?:\/\/|www\.|\.com\b|\.org\b|\.io\b|\burl\b|\bwebsite\b|\bweb page\b|\bwebpage\b|\bweb site\b|\binternet\b|\bgoogle\b|\bsearch (?:the )?(?:web|internet|online)\b|\bbrowse\b|\bgmail\b|\bdocs\.google\b|\bdrive\.google\b|\bbrowser\b(?!\s*(?:extension|plugin|add-?on))\b|\bbrowser tab)/;

const LOCAL_AUTOMATE_RE = /\b(?:click|type into|press (?:the )?(?:button|key)|gui|desktop (?:app|application|window)|native (?:app|ui|window)|computer use|control (?:my|the) (?:screen|computer|mouse|keyboard|desktop)|use the computer|automate the (?:desktop|app|gui)|double-?click|right-?click|drag (?:and drop|the))/;

const LOCAL_RESEARCH_RE = /\b(?:research|look up|find (?:out|information|reviews)|look\s?up|compare (?:prices|options|products)|book (?:a )?(?:flight|hotel|trip)|trip plan|itinerary|weather|news (?:about|on))\b|\b(?:search|google)\b/;

const LOCAL_BUILD_RE = /\b(?:scaffold|bootstrap|set up a new|create a new (?:project|app|application|repo(?:sitory)?|template|workspace)|build (?:me )?(?:a|an|the) (?:new |brand-new )?(?:project|app|application|repo(?:sitory)?|template|website from scratch)|start a new (?:project|app)|initialize (?:a|an) (?:project|repo))\b/;

const LOCAL_ANALYZE_RE = /\b(?:analy[sz]e|analy[sz]is|chart|visuali[sz]e|visuali[sz]ation|\bgraph\b|\bplot\b|generate (?:a )?report|statistics|summary of (?:the )?(?:data|csv)|dataset|\bcsv\b|\bxlsx\b|\bspreadsheet\b|pivot table)\b/;

const LOCAL_FIX_RE = /\b(?:fix|debug|\bbug\b|\bbugs\b|error|crash(?:es|ed|ing)?|broken|not working|fails?|failing|exception|stack trace|regression|hotfix|patch (?:the )?(?:bug|issue))\b/;

const LOCAL_CODE_RE = /\b(?:code|coding|function|script|refactor|implement|typescript|javascript|python|java\b|\brust\b|\bgo lang|\bgolang\b|api|component|class|regex|unit test|compile|module|library|algorithm|programming|program(?:ming)?)\b/;

const LOCAL_BACKGROUND_RE = /\b(?:background (?:task|agent|job|process|monitor)|silent(?:ly)? (?:run|check|monitor)|cron|schedule (?:a|this|the)? ?(?:task|job|run)|every \d+ ?(?:min|minute|hour)s?|check (?:file|build|lint) status)\b/;

const LOCAL_CONVERSATION_RE = /\b(?:^hi\b|^hello\b|^hey\b|^yo\b|thanks|thank you|good (?:morning|evening|afternoon)|how are you|nice to meet|^bye\b|goodbye|great job|well done|sounds good|awesome)\b/;

const LOCAL_QUESTION_RE = /\b(?:^what\b|^why\b|^how\b|^when\b|^who\b|^where\b|^which\b|^is\b|^are\b|^does\b|^do\b|^can you explain|^explain\b|^tell me about|^what's\b|^who's\b|^define\b|^describe\b)\b|\?$/;

// Action verbs, used only as a NEGATIVE filter: a question/conversation-shaped
// request containing any of these is actionable, so it must not become chat.
const LOCAL_ACTION_NEG_RE = /\b(?:write|create|fix|build|make|add|remove|delete|refactor|implement|run|execute|deploy|send|open|click|analyze|research|organize|rename|move|install)\b/;

/**
 * Local fast-path intent classifier — deterministic, synchronous, and free of
 * LLM/router calls. The triage node runs this BEFORE any AI classification
 * whenever the provider is local (see createTriageNode), because local models
 * are slow/unreliable at JSON classification while these rules answer in
 * microseconds. There is no deferral to the LLM: it never returns 'operator'
 * (operator mode is opt-in and AI-judged only), and unmatched input simply
 * becomes 'task'.
 *
 * Rule precedence (first match wins): short-affirmative inheritance
 * (classifyIntentFast) → background_task → research (web, non-extension) →
 * automate (desktop GUI, non-web) → build → analyze → fix → coding →
 * conversation → question → 'task' fallback. fix is checked before coding so
 * bug reports don't route to coding, and research/automate mutually exclude
 * each other (web vs desktop).
 *
 * Cheap by construction: precompiled regexes over lowercased input, no
 * network, no intentCache writes (affirmative inheritance may read it).
 *
 * @param userInput Latest user message; normalized internally
 * @param history Conversation history — only consulted for short-affirmative
 *                context inheritance ("yes", "ok", ...)
 * @returns Classification whose reasoning is prefixed "Local fast-path:"
 */
export function classifyIntentLocal(
  userInput: string,
  history: any[] = []
): IntentClassification {
  // Short affirmatives — inherit prior intent from history (same as fast path)
  const inherited = classifyIntentFast(userInput, history);
  if (inherited) {
    return inherited;
  }

  const text = (userInput || '').toLowerCase().trim();

  if (!text) {
    return { intent: 'task', confidence: 0.4, reasoning: 'Local fast-path: empty input, default task' };
  }

  // background_task: silent/scheduled/cron background loops or status watchers
  if (LOCAL_BACKGROUND_RE.test(text)) {
    return { intent: 'background_task', confidence: 0.85, reasoning: 'Local fast-path: background/scheduled task keywords' };
  }

  // research: web/URL/browser — but NOT "browser extension" (that's coding)
  // The second test strips the first web match and re-checks the remainder:
  // inputs like "open example.com and fix the browser extension" would
  // otherwise let the URL alone win and misroute extension work to research.
  if (LOCAL_NEG_URL_BROWSER_EXT.test(text) && !/browser (?:extension|plugin|add-?on)/.test(text.replace(LOCAL_NEG_URL_BROWSER_EXT, ''))) {
    return { intent: 'research', confidence: 0.85, reasoning: 'Local fast-path: URL/browser/web keywords (non-extension)' };
  }
  // research keywords lose when desktop-automation verbs also appear
  // (e.g. "click the search button" is automate, not research)
  if (LOCAL_RESEARCH_RE.test(text) && !LOCAL_AUTOMATE_RE.test(text)) {
    return { intent: 'research', confidence: 0.8, reasoning: 'Local fast-path: research/web keywords' };
  }

  // automate: desktop GUI automation — NOT websites/browser-based tasks
  if (LOCAL_AUTOMATE_RE.test(text) && !LOCAL_NEG_URL_BROWSER_EXT.test(text)) {
    return { intent: 'automate', confidence: 0.8, reasoning: 'Local fast-path: desktop GUI automation keywords' };
  }

  // build: scaffolding new projects/apps/repos
  if (LOCAL_BUILD_RE.test(text)) {
    return { intent: 'build', confidence: 0.8, reasoning: 'Local fast-path: scaffold/build-new-project keywords' };
  }

  // analyze: data processing, reports, charts
  if (LOCAL_ANALYZE_RE.test(text)) {
    return { intent: 'analyze', confidence: 0.8, reasoning: 'Local fast-path: data analysis keywords' };
  }

  // fix: distinct from coding — diagnosing/repairing broken behavior
  if (LOCAL_FIX_RE.test(text)) {
    return { intent: 'fix', confidence: 0.8, reasoning: 'Local fast-path: bug/fix keywords' };
  }

  // coding: writing/editing code (checked after fix so bug reports route to fix)
  if (LOCAL_CODE_RE.test(text)) {
    return { intent: 'coding', confidence: 0.8, reasoning: 'Local fast-path: coding keywords' };
  }

  // conversation: greetings/small talk (short, no actionable content)
  if (LOCAL_CONVERSATION_RE.test(text) && text.length < 60 && !LOCAL_ACTION_NEG_RE.test(text)) {
    return { intent: 'conversation', confidence: 0.8, reasoning: 'Local fast-path: greeting/small-talk keywords' };
  }

  // question — but only when it does not carry an actionable verb
  if ((LOCAL_QUESTION_RE.test(text) || text.endsWith('?')) && !LOCAL_ACTION_NEG_RE.test(text)) {
    return { intent: 'question', confidence: 0.75, reasoning: 'Local fast-path: question without action verbs' };
  }

  // null match → task
  return { intent: 'task', confidence: 0.5, reasoning: 'Local fast-path: no keyword match, default task' };
}

/**
 * Check if task is read-only (no mutations)
 * — gates downstream flows (e.g. planner) so question/conversation intents
 * skip mutation-capable tool paths.
 */
export function isReadOnlyTask(intent: IntentType): boolean {
  return ['question', 'conversation'].includes(intent);
}
