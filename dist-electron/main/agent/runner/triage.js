"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyIntent = classifyIntent;
exports.isReadOnlyTask = isReadOnlyTask;
const message_utils_1 = require("./services/message-utils");
// ── Triage AI Prompt ─────────────────────────────────────────────────
const TRIAGE_SYSTEM_PROMPT = `You are a precise intent classifier for an AI assistant. Classify the user's request into exactly one intent category based on its full semantic meaning.

INTENT CATEGORIES:
- coding — Writing, editing, refactoring, debugging, or creating code/scripts
- fix — Diagnosing and fixing bugs, errors, crashes, or broken behavior
- build — Scaffolding new projects, apps, repos, or templates from scratch
- analyze — Processing data, generating reports, charts, visualizations from datasets
- research — Web research, searching the internet, investigating topics, AND all browser-based web interaction including opening URLs in a browser (NOT desktop automation)
- automate — Desktop GUI automation: clicking native UI elements, interacting with desktop applications (NOT websites or browser-based tasks)
- question — Answering factual questions, explaining concepts, providing information
- conversation — Greetings, small talk, acknowledgments, follow-ups with no actionable task
- task — General actionable task that doesn't clearly fit the above

Respond with JSON only: {"intent":"<category>","confidence":<0.0-1.0>,"reasoning":"<one sentence explaining why>"}`;
const TRIAGE_USER_TEMPLATE = (userInput, historySnippet) => `
CONVERSATION HISTORY (last 5 messages):
${historySnippet || 'None'}

CURRENT USER REQUEST:
"${userInput}"

Classify the intent.`;
// ── Main AI Classification ────────────────────────────────────────────
async function classifyIntent(userInput, client, history = []) {
    if (!client) {
        return { intent: 'task', confidence: 0.5, reasoning: 'AI unavailable' };
    }
    const normalized = (0, message_utils_1.normalizeMessages)(history);
    const historySnippet = normalized.slice(-5).map(m => {
        const role = (m.role || 'user').toUpperCase();
        let content = '';
        if (typeof m.content === 'string') {
            content = m.content.slice(0, 200);
        }
        else if (Array.isArray(m.content)) {
            const textParts = m.content.filter((item) => item.type === 'text' || typeof item === 'string');
            content = textParts.map((item) => typeof item === 'string' ? item : item.text || '').join(' ').slice(0, 200);
            const hasFiles = m.content.some((item) => item.type === 'file' || item.type === 'image_url');
            if (hasFiles)
                content += ' [FILE ATTACHED]';
        }
        return `[${role}]: ${content}`;
    }).join('\n');
    try {
        const response = await client.chat({
            messages: [
                { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
                { role: 'user', content: TRIAGE_USER_TEMPLATE(userInput, historySnippet) },
            ],
            responseFormat: 'json',
            temperature: 0.2,
            maxTokens: 500,
        });
        let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const data = JSON.parse(content);
        return {
            intent: (data.intent || 'task'),
            confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
            reasoning: data.reasoning || 'AI classification',
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { intent: 'task', confidence: 0.5, reasoning: `AI error: ${msg}` };
    }
}
/**
 * Check if task is read-only (no mutations)
 */
function isReadOnlyTask(intent) {
    return ['question', 'conversation'].includes(intent);
}
