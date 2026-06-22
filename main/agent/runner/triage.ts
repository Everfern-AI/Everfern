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

// Intent classification signals for heuristics
const INTENT_SIGNALS: Record<IntentType, string[]> = {
  unknown: [],
  coding: [
    'write code', 'create function', 'fix bug', 'refactor', 'debug',
    'implement', 'create class', 'add method', 'write script', 'programming',
    'api', 'endpoint', 'database', 'query', 'schema'
  ],
  research: [
    'search', 'find information', 'lookup', 'what is', 'how does',
    'explain', 'research', 'investigate', 'analyze', 'compare'
  ],
  task: [
    'run command', 'create file', 'delete', 'download', 'generate report',
    'process', 'execute', 'automate', 'batch', 'install', 'configure'
  ],
  question: [
    'what', 'how', 'why', 'when', 'where', 'who', 'which',
    'explain', 'tell me', 'show me', 'give me', 'can you'
  ],
  conversation: [
    'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'sorry'
  ],
  build: [
    'create', 'build', 'make', 'generate', 'scaffold', 'setup', 'initialize',
    'new project', 'new app', 'create app', 'build app', 'create website',
    'create component', 'generate report', 'generate dashboard'
  ],
  fix: [
    'fix', 'debug', 'repair', 'resolve', 'troubleshoot', 'error', 'bug',
    'broken', 'not working', 'failing', 'crash', 'issue', 'problem', 'wrong'
  ],
  analyze: [
    'analyze', 'analyse', 'analysis', 'insights', 'visualize', 'chart',
    'graph', 'statistics', 'metrics', 'dashboard', 'report', 'data',
    'csv', 'excel', 'dataset', 'trends', 'patterns', 'summarize'
  ],
  automate: [
    'automate', 'schedule', 'batch', 'pipeline', 'workflow', 'script',
    'recurring', 'every day', 'every week', 'cron', 'whenever', 'monitor',
    'watch', 'trigger', 'on change', 'background'
  ],
  background_task: [],
  operator: []
};

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

// ── Heuristics and Fallbacks ──────────────────────────────────────────

export function classifyIntentHeuristic(userInput: string, history: any[] = []): IntentClassification {
  const normalized = userInput.toLowerCase().trim();

  const scores: Record<IntentType, number> = {
    unknown: 0, coding: 0, research: 0, task: 0, question: 0, conversation: 0,
    build: 0, fix: 0, analyze: 0, automate: 0, background_task: 0, operator: 0
  };

  for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
    if (intent === 'unknown') continue;
    for (const signal of signals) {
      if (normalized.includes(signal)) {
        scores[intent as IntentType] += 1;
      }
    }
  }

  // Special patterns
  if (/\b(function|class|const|let|var|import|export|def|async|public|private|void|return|interface|type)\b/.test(normalized)) {
    scores.coding += 3;
  }
  if (/\b(run|execute|launch|start|install|setup|configure)\b/.test(normalized)) {
    scores.task += 2;
  }
  if (/^(what|how|why|when|where|who|which|can|could|is|are)\b/i.test(normalized)) {
    scores.question += 2;
  }
  if (/^(hi|hello|hey|thanks|thank you|bye)\b/i.test(normalized)) {
    scores.conversation += 3;
  }

  const multiActionPatterns = [
    /\b(find|search).*\b(and|then|also)\b.*(find|search|analyze)\b/i,
    /\b(create|write).*\b(and|then|also)\b.*(create|write|run)\b/i,
    /\bmultiple\b.*\bfiles?\b/i,
    /\bfiles?\b.*\band\b.*\bfiles?\b/i,
    /\ball\b.*\b(of\s+)?the\b/i,
    /\b(analyze?|compare?|evaluate?).*\b(analyze?|compare?|evaluate?)\b/i,
  ];
  for (const pattern of multiActionPatterns) {
    if (pattern.test(normalized)) {
      scores.task += 2;
      scores.coding += 1;
    }
  }

  if (/\b(benchmark|test against|compare.*with|vs\.?|versus)\b/i.test(normalized)) {
    scores.research += 2;
  }

  if (/\b(algorithm|database|api|endpoint|microservice|architecture|design pattern)\b/i.test(normalized)) {
    scores.coding += 2;
  }

  if (/\b(create|build|make|generate|scaffold|initialize|setup)\b.{0,40}\b(app|project|website|dashboard|report|component|script)\b/i.test(normalized)) {
    scores.build += 4;
  }
  if (/\b(error|exception|traceback|undefined|null|crash|fails?|broken|not work|wrong)\b/i.test(normalized)) {
    scores.fix += 3;
  }
  if (/\b(csv|xlsx|data|dataset|dataframe|df\.|pandas|numpy|matplotlib|analyze|chart|graph|plot|dashboard|insights)\b/i.test(normalized)) {
    scores.analyze += 3;
  }
  if (/\b(automate|schedule|cron|every (day|week|hour|morning)|batch|pipeline|workflow|recurring)\b/i.test(normalized)) {
    scores.automate += 4;
  }

  let maxScore = 0;
  let maxIntent: IntentType = 'task';

  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxIntent = intent as IntentType;
    }
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? Math.min(1, maxScore / Math.max(totalScore, 1)) : 0;

  return {
    intent: maxIntent,
    confidence,
    reasoning: `Intent: ${maxIntent} (${Math.round(confidence * 100)}% confidence) [Heuristic]`
  };
}

export function classifyIntentFast(userInput: string, history: any[]): IntentClassification | null {
  const normalized = userInput.toLowerCase().trim();

  // Short affirmatives — inherit from history
  if (isShortAffirmative(normalized) && history.length > 0) {
    const prev = extractPreviousIntent(history);
    if (prev) {
      return { intent: prev, confidence: 0.95, reasoning: 'Context inheritance: short affirmative' };
    }
  }

  // Very short inputs — likely conversational
  if (normalized.length < 8) {
    return { intent: 'conversation', confidence: 0.8, reasoning: 'Fast: very short input' };
  }

  // GUI automation - application launch pattern (higher confidence)
  if (/\b(open|launch|start)\s+(spotify|discord|chrome|firefox|notepad|calculator|word|excel|powerpoint|slack|teams|zoom|vscode|terminal|cmd|powershell)\b/i.test(normalized)) {
    return { intent: 'automate', confidence: 0.9, reasoning: 'Fast: Application launch pattern' };
  }

  // GUI automation - general keywords
  if (/\b(open|click|type|launch|start|press|scroll|drag|move cursor|mouse|keyboard|gui|window|desktop|screen)\b/i.test(normalized)) {
    return { intent: 'automate', confidence: 0.85, reasoning: 'Fast: GUI automation keywords' };
  }

  // Strong fix/debug signals
  if (/\b(fix|debug|error|bug|crash|broken|not working|doesn't work|failing)\b/.test(normalized)) {
    return { intent: 'fix', confidence: 0.85, reasoning: 'Fast: fix/debug keywords' };
  }

  // Strong coding signals
  if (/\b(write|implement|create|add|refactor|code|function|class|component|script)\b/.test(normalized) &&
      /\b(code|function|class|component|script|method|api|endpoint|module)\b/.test(normalized)) {
    return { intent: 'coding', confidence: 0.85, reasoning: 'Fast: coding keywords' };
  }

  // Strong build signals
  if (/\b(build|scaffold|generate|setup|initialize|bootstrap)\b.*\b(project|app|application|repo|template)\b/.test(normalized)) {
    return { intent: 'build', confidence: 0.85, reasoning: 'Fast: build keywords' };
  }

  // Strong question signals
  if (/^(what|how|why|when|where|which|who|can you explain|tell me about)\b/.test(normalized)) {
    return { intent: 'question', confidence: 0.8, reasoning: 'Fast: question pattern' };
  }

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon|thanks|thank you|bye)\b/.test(normalized)) {
    return { intent: 'conversation', confidence: 0.9, reasoning: 'Fast: greeting' };
  }

  return null;
}

export function classifyIntentFallback(userInput: string, history: any[] = []): IntentClassification {
  const fast = classifyIntentFast(userInput, history);
  if (fast) {
    return {
      ...fast,
      reasoning: `Fallback: ${fast.reasoning}`
    };
  }

  const heuristic = classifyIntentHeuristic(userInput, history);
  if (heuristic.intent !== 'task' && heuristic.confidence > 0) {
    return {
      ...heuristic,
      reasoning: `Fallback: Heuristic classification - ${heuristic.reasoning}`
    };
  }

  const normalized = userInput.toLowerCase().trim();
  const inputLength = normalized.length;

  if (inputLength < 10) {
    const greetingPatterns = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay'];
    if (greetingPatterns.some(pattern => normalized.includes(pattern))) {
      return {
        intent: 'conversation',
        confidence: 0.75,
        reasoning: 'Fallback: Short greeting or acknowledgment detected'
      };
    }
  }

  const recentMessages = history.slice(-3);
  const hasRecentFiles = recentMessages.some(msg => hasFileAttachment(msg));
  if (hasRecentFiles) {
    return {
      intent: 'analyze',
      confidence: 0.7,
      reasoning: 'Fallback: File attachment detected in recent context'
    };
  }

  if (inputLength < 15) {
    return {
      intent: 'conversation',
      confidence: 0.5,
      reasoning: 'Fallback: Short input without clear pattern - likely conversational'
    };
  }

  return {
    intent: 'task',
    confidence: 0.5,
    reasoning: 'Fallback: No clear pattern detected - defaulting to general task'
  };
}

// ── Main AI Classification ────────────────────────────────────────────

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
      console.log(`[Triage] Form response detected. Classifying intent using prior user message: "${contentStr}"`);
      targetUserInput = contentStr;
    }
  }

  if (!client) {
    return classifyIntentFallback(targetUserInput, history);
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

  try {
    const soulContent = loadSoul(workspaceRoot);
    const agentsContent = loadAgents(workspaceRoot);
    const triageSystemPrompt = `${TRIAGE_SYSTEM_PROMPT}\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n${soulContent}\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n${agentsContent}`;

    const response = await client.chat({
      messages: [
        { role: 'system', content: triageSystemPrompt },
        { role: 'user', content: TRIAGE_USER_TEMPLATE(targetUserInput, historySnippet, !!operatorMode) },
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
    console.warn(`[Triage] AI classification failed: ${msg}. Falling back to heuristics.`);
    return classifyIntentFallback(targetUserInput, history);
  }
}

/**
 * Check if task is read-only (no mutations)
 */
export function isReadOnlyTask(intent: IntentType): boolean {
  return ['question', 'conversation'].includes(intent);
}
