import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';
import type { AIClient } from '../../../lib/ai-client';
import { getConversationAbortManager } from '../abort-manager';
import { nodeLifecycle } from '../services/node-utils';
import { getCheckpointEngine, type Checkpoint, type FailedCheckpoint } from '../../persistence/checkpoint-engine';
import { loadSoul, loadAgents } from '../../personality-manager';
import { resolvePromptPlaceholders } from '../system-prompt';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

type CompletionReason = 'task_complete' | 'waiting_for_user_input' | 'needs_hitl' | 'cannot_proceed';
type RoutingDecision = 'continue_brain' | 'route_coding' | 'route_data_analyst' | 'route_web_explorer' | 'route_deep_research' | 'complete_task';

// ── HP-04: static-first / volatile-last prompt assembly ─────────────────────
// The system prompt is split into a STABLE prefix (base + memory + soul + agents,
// byte-stable across steps so prompt-prefix caches hit) and a VOLATILE block
// (findings tail + DWSP git-status) that is appended as a trailing system
// message on every step and never persisted into conversation history.

export const VOLATILE_CONTEXT_HEADER = '# VOLATILE CONTEXT';
export const MEMORY_MARKER = '# PERSISTENT MEMORY & SYSTEM STATE';
export const SOUL_MARKER = '# PERSONALITY & BEHAVIOR CORE';
export const AGENTS_MARKER = '# SUB-AGENTS & ROUTING RULES';
export const FINDINGS_MARKER = 'RECENT RESEARCH FINDINGS';
export const DWSP_MARKER = 'DYNAMIC WORKSPACE PROJECTION';
export const FINDINGS_TAIL_MAX_CHARS = 2000;
export const DWSP_GIT_STATUS_MAX_LINES = 40;
const DWSP_GIT_TIMEOUT_MS = 1500;

const execAsync = promisify(exec);

interface VolatilePromptContext {
  /** Pre-capped tail of ~/.everfern/findings.md (see readFindingsTail). */
  findingsTail?: string;
  /** Pre-built DWSP block (see buildDwspBlock). */
  dwspBlock?: string;
}

interface SystemPromptParts {
  memory?: string;
  soul?: string;
  agents?: string;
}

/**
 * Trim text to at most `maxChars` characters, keeping the TAIL (most recent
 * content) and snapping the cut forward to a line boundary when possible.
 * The tail is kept because findings.md is append-only — the newest (and
 * most relevant) findings always live at the end of the file.
 */
function capFindingsTail(text: string, maxChars: number = FINDINGS_TAIL_MAX_CHARS): string {
  const trimmed = (text || '').trim();
  if (trimmed.length <= maxChars) return trimmed;
  const tail = trimmed.slice(-maxChars);
  // If the char budget cut landed mid-line, drop the partial first line —
  // a truncated leading line would leak half a markdown bullet or URL.
  const nl = tail.indexOf('\n');
  return nl >= 0 && nl < tail.length - 1 ? tail.slice(nl + 1) : tail;
}

/**
 * Cap `block` to at most `maxLines` lines, replacing the overflow with a
 * trailing `... and N more` summary line (codebase idiom from system-files.ts).
 */
function capLines(text: string, maxLines: number): string {
  const lines = (text || '').split('\n');
  if (lines.length <= maxLines) return text;
  const shown = lines.slice(0, Math.max(0, maxLines - 1));
  const hidden = lines.length - shown.length;
  return `${shown.join('\n')}\n... and ${hidden} more`;
}

/**
 * Read the tail (≤ `maxChars` chars) of the session findings file.
 * Only the tail is read because findings.md grows unboundedly as research
 * tools append to it; the ≤2000-char cap bounds the volatile block and keeps
 * it fresh (a whole-file read would bloat the prompt with stale
 * early-session findings).
 * Pure w.r.t. conversation state — filesystem read only, never throws.
 *
 * @param maxChars - Hard cap on returned characters (tail-kept, line-snapped).
 * @param findingsPath - Path override (tests); defaults to ~/.everfern/findings.md.
 * @returns The capped findings tail, or '' when missing or unreadable.
 */
export function readFindingsTail(
  maxChars: number = FINDINGS_TAIL_MAX_CHARS,
  findingsPath?: string
): string {
  try {
    const p = findingsPath || path.join(os.homedir(), '.everfern', 'findings.md');
    if (!fs.existsSync(p)) return '';
    return capFindingsTail(fs.readFileSync(p, 'utf-8'), maxChars);
  } catch {
    return '';
  }
}

/**
 * Build the DWSP git-status block for the volatile prompt tail.
 * Runs `git status --porcelain` with a 1.5s timeout; non-repo, missing dir,
 * git failure or timeout all yield '' (never throws, never blocks the step).
 * Output is capped at `maxLines` lines total including a `... and N more` line.
 *
 * @param workspaceDir - Repo to inspect; null/undefined, missing dir, or any
 *                       git failure yields '' (never throws, never blocks).
 * @param maxLines - Total line budget for the block, header lines included.
 * @returns The DWSP git-status block, or '' when unavailable.
 */
export async function buildDwspBlock(
  workspaceDir?: string | null,
  maxLines: number = DWSP_GIT_STATUS_MAX_LINES
): Promise<string> {
  if (!workspaceDir) return '';
  try {
    if (!fs.existsSync(workspaceDir)) return '';
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: workspaceDir,
      timeout: DWSP_GIT_TIMEOUT_MS,
    });
    const trimmed = stdout.trim();
    let statusLines = trimmed
      ? trimmed.split('\n').map(line => {
          // Porcelain v1 format: 2-char XY status code, one space, then path.
          const status = line.slice(0, 2).trim();
          const file = line.slice(3).trim();
          return `- \`${file}\` [Status: ${status}]`;
        })
      : ['Workspace is clean (no uncommitted Git modifications).'];

    const header = ['## DYNAMIC WORKSPACE PROJECTION (DWSP)', '', '### Active Git Modifications'];
    // The line budget must also cover the header lines so the assembled
    // block never exceeds `maxLines` in total.
    const budget = Math.max(1, maxLines - header.length);
    if (statusLines.length > budget) {
      const shown = statusLines.slice(0, budget - 1);
      statusLines = [...shown, `... and ${statusLines.length - shown.length} more`];
    }
    return [...header, ...statusLines].join('\n');
  } catch {
    // Non-repo, git not installed, or 1.5s timeout — emit no volatile git context.
    return '';
  }
}

/**
 * Pure prompt assembly (HP-04 static-first / volatile-last).
 *
 * Stable = base + memory (once) + soul (once) + agents (once). Each static
 * section is appended at most once, guarded by the canonical `includes()`
 * markers already used by this file, so re-entrant assembly never duplicates.
 *
 * Volatile = a `# VOLATILE CONTEXT` block containing the findings tail
 * (≤2000 chars) and the DWSP git-status block (≤40 lines, `... and N more`).
 * The caller must emit the volatile block as a trailing system message
 * AFTER the conversation history — never bake it into the stable prompt.
 *
 * Performs no I/O; findings/DWSP content is passed in pre-read.
 *
 * Why the split exists: providers cache longest-common prompt prefixes. If
 * findings/DWSP (which change every step) were baked into the system prompt,
 * the prefix would diverge each step and every cache entry would miss. The
 * stable head stays byte-identical across steps, so the head + early
 * history remain cache-hot; only the cheap trailing volatile message is
 * re-tokenized per step.
 *
 * @param base - Base system prompt (SYSTEM_PROMPT.md) or an explicit override.
 * @param parts - Marker-guarded static sections (memory, soul, agents), each
 *                appended at most once per assembly.
 * @param volatile - Pre-read volatile inputs; findings are re-capped defensively.
 * @returns `{ stable, volatile }` — the stable head prompt and the volatile
 *          block ('' when no findings or DWSP content is available).
 */
export function assembleSystemPrompt(
  base: string,
  parts: SystemPromptParts,
  volatile?: VolatilePromptContext
): { stable: string; volatile: string } {
  let stable = base ?? '';

  // The `includes(MARKER)` guards make assembly idempotent: callers may pass a
  // base prompt that already carries these sections (e.g. a resumed step or
  // an override), and re-appending would duplicate content and shift the
  // cached prefix bytes.
  if (parts.memory && !stable.includes(MEMORY_MARKER)) {
    stable += parts.memory;
  }
  if (parts.soul && !stable.includes(SOUL_MARKER)) {
    stable += `\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n${parts.soul}\n`;
  }
  if (parts.agents && !stable.includes(AGENTS_MARKER)) {
    stable += `\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n${parts.agents}\n`;
  }

  const volatileSections: string[] = [];
  // Re-cap even though readFindingsTail already caps: this function is
  // exported, so callers may pass an uncapped findingsTail directly.
  const findings = capFindingsTail(volatile?.findingsTail ?? '');
  if (findings) {
    volatileSections.push(
      `## ${FINDINGS_MARKER}\nBelow are findings from tools (navis, web_search) already executed during this session. Do NOT repeat the same URLs or searches unless new information is needed:\n${findings}\n`
    );
  }
  const dwsp = volatile?.dwspBlock ? capLines(volatile.dwspBlock, DWSP_GIT_STATUS_MAX_LINES) : '';
  if (dwsp) {
    volatileSections.push(dwsp);
  }

  const volatileBlock = volatileSections.length
    ? `${VOLATILE_CONTEXT_HEADER}\nVolatile, session-scoped context for the current step only. Refreshed every step — never treat as durable instructions.\n\n${volatileSections.join('\n')}`
    : '';

  return { stable, volatile: volatileBlock };
}

/**
 * Build the persistent-memory injection string from ~/.everfern/memory.
 * Returns '' when neither USER_PROFILE.md nor PROJECT_STATE.md exists so
 * the absence of memory never introduces an empty marker section into
 * the stable prompt.
 */
function buildMemoryInjection(): string {
  try {
    const memoryDir = path.join(os.homedir(), '.everfern', 'memory');
    const profilePath = path.join(memoryDir, 'USER_PROFILE.md');
    const projectPath = path.join(memoryDir, 'PROJECT_STATE.md');

    let memoryInjection = `\n\n${MEMORY_MARKER}\n`;
    if (fs.existsSync(profilePath)) {
      memoryInjection += `\n## USER_PROFILE.md (User preferences, rules, styles):\n${fs.readFileSync(profilePath, 'utf-8')}\n`;
    }
    if (fs.existsSync(projectPath)) {
      memoryInjection += `\n## PROJECT_STATE.md (Persistent facts, architectural choices):\n${fs.readFileSync(projectPath, 'utf-8')}\n`;
    }

    return memoryInjection !== `\n\n${MEMORY_MARKER}\n` ? memoryInjection : '';
  } catch {
    return '';
  }
}

/**
 * Build the clarification question shown to the user when the brain signals
 * `waiting_for_user_input`. Preference order: the signal's own explanation,
 * then a short (<600 char) raw LLM response, then a truncated echo of the
 * original request — so the user always gets SOME actionable question.
 */
export function buildUserInputQuestion(explanation: string, responseContent: string, originalRequest: string): string {
  const cleanExplanation = explanation.replace(/\s+/g, ' ').trim();
  const cleanResponse = responseContent.replace(/\s+/g, ' ').trim();

  if (cleanExplanation) {
    return `I need a little more information before I can continue: ${cleanExplanation}\n\nPlease provide the missing details here.`;
  }

  if (cleanResponse && cleanResponse.length < 600) {
    return `${cleanResponse}\n\nPlease provide the missing details here.`;
  }

  return `Please provide the missing details I need to continue with: ${originalRequest.slice(0, 220)}`;
}

/**
 * Wrap a `waiting_for_user_input` completion signal as a synthetic
 * `ask_user_question` tool call so the UI renders a structured input form
 * instead of a dead-end chat message.
 *
 * @param signal - The completion signal carrying reason and explanation.
 * @param responseContent - The brain's raw response text (fallback question body).
 * @param originalRequest - The originating user request (last-resort question body).
 * @returns A single-question `ask_user_question` tool-call object.
 */
export function buildAskUserQuestionToolCall(
  signal: { reason: CompletionReason; explanation: string },
  responseContent: string,
  originalRequest: string
) {
  return {
    id: `ask_user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: 'ask_user_question',
    arguments: {
      questions: [
        {
          question: buildUserInputQuestion(signal.explanation, responseContent, originalRequest),
          options: [],
          multiSelect: false,
        },
      ],
    },
  };
}

/**
 * Extract tool names executed specifically during the current user turn (after the latest user message).
 * Prevents historical tools (like `present_files` or `task_complete` from a previous turn) from prematurely
 * terminating subsequent turns.
 */
function getCurrentTurnExecutedTools(messages: any[]): string[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const role = (m as any)?.role || (m as any)?._getType?.() || (m as any)?.type;
    if (role === 'user' || role === 'human') {
      lastUserIdx = i;
      break;
    }
  }
  const turnMsgs = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages;
  return turnMsgs
    .filter((m: any) => m.role === 'tool' || m.tool_calls)
    .flatMap((m: any) => m.tool_calls ? m.tool_calls.map((tc: any) => tc.name || tc.function?.name) : (m.tool_name ? [m.tool_name] : []));
}

/**
 * Create a checkpoint for the current agent state.
 *
 * Implements error handling that logs but doesn't break execution as per
 * Requirement 2.5: When checkpoint creation fails, log error and continue execution
 *
 * @param state - Current agent state
 * @param runner - Agent runner for telemetry
 * @param stepDescription - Description of the step for logging
 * @returns The created checkpoint (or failed checkpoint placeholder)
 */
async function createAgentCheckpoint(
  state: GraphStateType,
  runner: AgentRunner,
  stepDescription: string
): Promise<Checkpoint | FailedCheckpoint> {
  const checkpointEngine = getCheckpointEngine();

  // Use missionId as task identifier, or generate one if not available
  const taskId = state.missionId || `brain-task-${Date.now()}`;

  try {
    const startTime = Date.now();
    const checkpoint = await checkpointEngine.createCheckpoint(state, taskId);
    const duration = Date.now() - startTime;

    // Check if checkpoint creation succeeded
    if ('failed' in checkpoint && checkpoint.failed) {
      // This is a FailedCheckpoint - log the failure but don't throw
      runner.telemetry.warn(`[Brain] Checkpoint creation failed for step: ${stepDescription}. Execution continues.`);
      console.warn(`[Brain] Checkpoint failed: ${stepDescription} (taskId: ${taskId})`);
    } else {
      // Successful checkpoint
      runner.telemetry.info(`[Brain] Checkpoint created: id=${checkpoint.id} task=${taskId} step=${checkpoint.stepNumber} (${stepDescription})`);
      console.debug(`[Brain] Checkpoint created: id=${checkpoint.id} task=${taskId} step=${checkpoint.stepNumber} (${stepDescription})`);
    }

    return checkpoint;
  } catch (error) {
    // Catch any unexpected errors and log them, but don't throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    runner.telemetry.warn(`[Brain] Unexpected checkpoint error: ${errorMessage} (taskId: ${taskId}, step: ${state.iterations})`);
    console.error(`[Brain] Unexpected checkpoint error for step "${stepDescription}":`, error);

    // Return a failed checkpoint to maintain execution flow
    return {
      id: `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      stepNumber: state.iterations || 0,
      timestamp: Date.now(),
      stateJson: '',
      stateHash: '',
      deltaOnly: false,
      previousCheckpointId: null,
      compressed: false,
      failed: true,
    } satisfies FailedCheckpoint;
  }
}

/**
 * After the brain produces a response with no tool calls, ask it to self-assess
 * why it's done and produce a structured completion signal.
 *
 * This replaces regex pattern matching with a first-class signal
 * from the brain itself.
 *
 * IMPROVEMENTS (Sub-task 3.1):
 * - Reduced timeout to 5s (5000ms) for completion signals
 * - Added fallback completion signal when LLM fails
 * - Improved JSON extraction and error handling
 * - Added detailed logging at each step
 *
 * @param runner - Agent runner
 * @param responseContent - Content of the response
 * @param originalRequest - Original request text
 */
export async function buildCompletionSignal(
  runner: AgentRunner,
  responseContent: string,
  originalRequest: string,
): Promise<{ reason: CompletionReason; explanation: string } | null> {
  if (!runner.client) {
    console.warn('[Brain] No client available for completion signal');
    // BUG-12 FIX: Return null instead of fallback task_complete.
    // When null is returned, the brain node's existing fallback routing logic
    // kicks in (intent-based routing), which is much safer than silently ending.
    console.warn('[Brain] No client available for completion signal — returning null for fallback routing');
    return null;
  }

  try {
    const prompt = `You just produced a response to a user request. Classify why you are done for this turn.

USER REQUEST: "${originalRequest.slice(0, 300)}"
YOUR RESPONSE: "${responseContent.slice(0, 500)}"

Choose exactly one reason:
- "task_complete"          — You fully completed the requested task with substantive output. The user got what they asked for.
- "waiting_for_user_input" — You are blocked and cannot proceed without the user providing critical details (e.g. file path, credentials). Do NOT use this for informative queries where you have already answered the request and are offering optional next steps.
- "needs_hitl"             — A high-risk or irreversible action requires explicit human approval before execution (file operations, installs, bulk deletions, local execution on the host system).
- "cannot_proceed"         — You are blocked and cannot make progress (missing permissions, unsupported request, etc.)

Respond with JSON only:
{
  "reason": "task_complete" | "waiting_for_user_input" | "needs_hitl" | "cannot_proceed",
  "explanation": "one sentence explaining why",
  "hitlRationale": "If reason is needs_hitl, explain what action needs approval and why"
}`;


    console.log('[Brain] Building completion signal...');
    console.log('[Brain] Original request (first 100 chars):', originalRequest.slice(0, 100));
    const startTime = Date.now();

    // Reduced timeout from 30s to 5s for fast responses (dynamic for local LLMs)
    const isLocal = runner.client?.isLocal?.();
    const timeoutMs = isLocal ? 60000 : 5000;
    let timerId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error(`completion signal timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });

    let response: any;
    try {
      response = await Promise.race([
        runner.client.chat({
          messages: [{ role: 'user', content: prompt }],
          responseFormat: 'json',
          temperature: 0.3,
          maxTokens: 1500,
          // Scoped abort: ties this auxiliary LLM call to the same
          // conversation-scoped AbortController as the main step, so a user
          // stop cancels the completion-signal probe too instead of letting
          // it race the timeout in the background.
          abortSignal: getConversationAbortManager(runner.currentConversationId).abortController.signal,
        }),
        timeoutPromise,
      ]) as any;
    } finally {
      if (timerId) {
        clearTimeout(timerId);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Brain] Completion signal response received in ${duration}ms`);
    console.log(`[Brain] Response length: ${response.content?.length || 0} chars, first 100 chars:`,
      (typeof response.content === 'string' ? response.content : JSON.stringify(response.content)).slice(0, 100));

    if (response.usage) {
      try {
        const { recordUsage } = await import('../../../store/analytics');
        const cfg = (runner as any).config;
        recordUsage({
          conversationId: undefined, // Internal brain task
          model: runner.client.model ?? cfg?.model ?? 'unknown',
          provider: runner.client.provider ?? cfg?.provider ?? cfg?.engine ?? 'unknown',
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
          promptTokensCost: response.usage.promptTokensCost,
          completionTokensCost: response.usage.completionTokensCost,
          imageInputCost: response.usage.imageInputCost,
          imageOutputCost: response.usage.imageOutputCost,
          totalCost: response.usage.totalCost,
        }).catch(() => { /* never throw */ });
      } catch { /* ignore */ }
    }

    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Strip out <think>...</think> blocks from reasoning models before extracting JSON
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '');

    // Improved JSON extraction: handle extra whitespace and markdown code blocks (Sub-task 3.1)
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    console.log('[Brain] After markdown cleanup:', content.slice(0, 100));

    // Robust JSON extraction: find first '{' and last '}'
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      content = content.substring(firstBrace, lastBrace + 1);
      console.log('[Brain] Extracted JSON substring:', content.slice(0, 100));
    }

    let signal;
    try {
      console.log('[Brain] Attempting to parse JSON:', content.slice(0, 150));
      signal = JSON.parse(content);
      console.log('[Brain] Successfully parsed JSON:', signal);
    } catch (parseError) {
      const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn('[Brain] Failed to parse completion signal JSON:', parseErrorMsg);
      console.warn('[Brain] Content was:', content.slice(0, 200));
      // BUG-12 FIX: Return null instead of fallback task_complete
      console.warn('[Brain] Completion signal JSON parse failed — returning null for fallback routing');
      return null;
    }

    const validReasons: CompletionReason[] = ['task_complete', 'waiting_for_user_input', 'needs_hitl', 'cannot_proceed'];
    if (!validReasons.includes(signal.reason)) {
      console.warn('[Brain] Invalid completion signal reason:', signal.reason);
      // BUG-12 FIX: Return null instead of fallback task_complete
      console.warn('[Brain] Invalid completion signal reason — returning null for fallback routing');
      return null;
    }

    console.log(`[Brain] Completion signal built successfully in ${duration}ms: ${signal.reason}`);
    return { reason: signal.reason as CompletionReason, explanation: String(signal.explanation || '') };
  } catch (error) {
    // Log the specific error for debugging (Sub-task 3.1)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[Brain] Completion signal failed:', errorMessage);
    // BUG-12 FIX: Return null instead of fallback task_complete
    console.warn('[Brain] Completion signal exception — returning null for fallback routing');
    return null;
  }
}

/**
 * Determine if the brain should route to a specialized agent
 */
async function determineRouting(
  runner: AgentRunner,
  state: GraphStateType,
  responseContent: string,
  eventQueue?: StreamEvent[]
): Promise<{ decision: RoutingDecision; explanation: string } | null> {
  if (!runner.client) {
    console.warn('[Brain] No client available for routing decision');
    return null;
  }

  try {
    const { CognitiveRouter } = await import('../cognitive-router');
    const router = new CognitiveRouter(runner, eventQueue);
    const result = await router.route(state);
    return {
      decision: result.decision,
      explanation: result.explanation
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[Brain] Cognitive Router routing decision failed:', errorMessage);
    return null;
  }
}

/**
 * Detect if the last tool result in messages is from web_search.
 */
function lastToolResultIsWebSearch(messages: any[]): boolean {
  if (!messages || messages.length === 0) return false;
  // Walk backwards to find the most recent tool result message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const role = msg.role || msg._getType?.();
    if (role === 'tool' || role === 'function') {
      // Check if the tool name is web_search
      const name = msg.name || msg.tool_name || msg.toolName || '';
      return name === 'web_search';
    }
    // Stop at assistant messages (tool results come right after assistant tool calls)
    if (role === 'assistant' || role === 'ai') break;
  }
  return false;
}

/**
 * Extract URLs from a web_search tool result content string.
 */
function extractUrlsFromSearchResult(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
  const matches = content.match(urlRegex) || [];
  // Deduplicate and limit to first 3 URLs
  return [...new Set(matches)].slice(0, 3);
}

/**
 * Central Brain Node - The Main Orchestrator and Router
 *
 * The Brain node now serves as the central decision maker that:
 * 1. Uses the main SYSTEM_PROMPT.md for comprehensive capabilities
 * 2. Makes intelligent routing decisions to specialized agents
 * 3. Handles general tasks that don't require specialization
 * 4. Provides completion signals
 */
export const createBrainNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[],
  shouldAbort?: () => boolean,
  systemPromptOverride?: string
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const logger = nodeLifecycle(runner, 'brain');

    // Check for abort signal before processing
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    const allTools = toolDefs || (runner as any)._buildToolDefinitions();
    const isSubAgent = !!runner.currentAgentSessionKey;

    // Get original user request for context
    const allMessages = state.messages || [];
    const firstUserMsg = allMessages.find((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    });
    const originalRequest = firstUserMsg
      ? (typeof (firstUserMsg as any).content === 'string'
          ? (firstUserMsg as any).content
          : JSON.stringify((firstUserMsg as any).content))
      : '';

    // Debug logging
    console.log(`[Brain] Current intent: ${state.currentIntent}`);
    console.log(`[Brain] Is sub-agent: ${isSubAgent}`);
    console.log(`[Brain] Available tools: ${allTools.map((t: any) => t.name).join(', ')}`);

    // Emit phase change event for execution phase (only on first brain call)
    if (missionTracker && state.iterations === 0) {
      missionTracker.setPhase('execution');
    }

    // Emit initial brain activation message


    // Load the main system prompt from synchronized location
    let basePrompt = systemPromptOverride;
    if (!basePrompt) {
      const mainSystemPrompt = loadPrompt('SYSTEM_PROMPT.md');
      if (mainSystemPrompt) {
        // HP-02: resolve {{OS_INFO}}/{{SKILLS}}/{{PLUGIN_SKILLS}}/paths before the
        // prompt reaches the model — brain previously sent the raw template.
        basePrompt = await resolvePromptPlaceholders(
          mainSystemPrompt,
          process.platform,
          (runner as any).currentConversationId || undefined,
          [],
          (runner as any).projectId || undefined,
          (runner as any).skills
        );
        console.log('[Brain] 📖 Using main SYSTEM_PROMPT.md from ~/.everfern/prompts/ (placeholders resolved)');
      } else {
        console.warn('[Brain] ⚠️  Could not load SYSTEM_PROMPT.md, using default');
      }
    }

    // ── HP-04 static-first / volatile-last ──────────────────────────────────
    // Stable prompt = base + persistent memory + SOUL.md + AGENTS.md, each
    // injected exactly once (marker-guarded). Volatile context (findings tail
    // + DWSP git-status) is assembled separately and appended by the runtime
    // as a trailing system message AFTER the conversation history.
    const { stable, volatile: volatileSystemPrompt } = assembleSystemPrompt(
      basePrompt || '',
      {
        memory: buildMemoryInjection(),
        soul: loadSoul(runner.workspaceDir),
        agents: loadAgents(runner.workspaceDir),
      },
      {
        findingsTail: readFindingsTail(),
        dwspBlock: await buildDwspBlock(runner.workspaceDir),
      }
    );

    let systemPrompt = stable;
    if (stable) {
      console.log('[Brain] 🧩 Assembled stable system prompt (base + memory + soul + agents)');
    }
    if (volatileSystemPrompt) {
      console.log('[Brain] ⚡ Assembled volatile context (findings tail + DWSP git-status)');
    }

    // Inject harness workflow phase prompt if available
    if (state.harnessPhasePrompt) {
      systemPrompt += `\n\n=== WORKFLOW PHASE ===\n${state.harnessPhasePrompt}\n`;
      console.log('[Brain] 🏗️ Injected harness phase prompt into system prompt');
    }

    let skipRouting = false;
    // ── EARLY CHECK FOR WEB_EXPLORER COMPLETION (Sub-task 3.2) ──────────────
    // If web_explorer has completed (webExplorerComplete: true) and we're returning from it,
    // skip routing to another specialist and go directly to completion signal generation.
    // This prevents unnecessary specialist routing when the task is already done.
    if (state.webExplorerComplete && state.returningFromSpecialist === 'web_explorer') {
      console.log('[Brain] Web explorer complete detected → skipping specialist routing, generating completion signal');
      skipRouting = true;
      // Skip to completion signal generation below
    } else if (state.returningFromSpecialist) {
      console.log(`[Brain] Clearing returningFromSpecialist flag: ${state.returningFromSpecialist}`);
      // Don't route back automatically - let the normal routing logic decide
    }

    const result = await integrator.wrapNode(
      'brain',
      () => runAgentStep(state, {
        runner,
        toolDefs: allTools,
        eventQueue,
        nodeName: 'brain',
        systemPromptOverride: systemPrompt,
        volatileSystemPrompt: volatileSystemPrompt || undefined,
      }),
      'Processing request with Brain orchestrator'
    );

    // Create checkpoint after agent step completion
    // Requirements: 1.1, 1.6, 2.1, 2.5
    const checkpoint = await createAgentCheckpoint(
      { ...state, ...result },  // Merge original state with result
      runner,
      `Brain step ${(state.iterations || 0) + 1}`
    );


    // Extract the brain's response text for analysis
    const messages = result.messages as any[] | undefined;
    const lastMsg = messages && messages.length > 0 ? messages[messages.length - 1] : null;
    const responseContent = lastMsg
      ? (typeof lastMsg.content === 'string' ? lastMsg.content : (lastMsg.content?.text || ''))
      : '';

    // Emit analysis of pending tools
    if (result.pendingToolCalls && result.pendingToolCalls.length > 0) {
      const toolNames = result.pendingToolCalls.map((tc: any) => tc.name).join(', ');

    }

    // If there are pending tool calls, continue with brain execution
    const hasPendingTools = result.pendingToolCalls && result.pendingToolCalls.length > 0;
    if (hasPendingTools) {
      // Create checkpoint before returning with pending tools
      await createAgentCheckpoint(
        { ...state, ...result },
        runner,
        `Brain with pending tools: ${result.pendingToolCalls?.map((tc: any) => tc.name).join(', ') || 'none'}`
      );

      return {
        ...result,
        completionSignal: null,
        routingDecision: null,
        brainToolsInFlight: true,
        returningFromSpecialist: null,
        resumingFromFormResponse: false
      };
    }

    // Compute hasNoOutput early — used by circuit breaker, auto-routing, and form-response continuation
    const hasNoOutput = !responseContent || responseContent.trim().length === 0;

    // ── FORM RESPONSE CONTINUATION ────────────────────────────────────────
    // When resuming from ask_user_wait, the brain's LLM may acknowledge the
    // form response with text but no tool calls. If we let it fall through to
    // buildCompletionSignal(), the LLM may classify the acknowledgment as
    // task_complete, ending the task prematurely.
    //
    // When this flag is set and the LLM produced no tools, we force auto-routing
    // based on intent so the brain gets routed to the right specialist or
    // continues with its tools.
    if (state.resumingFromFormResponse && !hasPendingTools) {
      console.log('[Brain] Resuming from form response — checking specialist status');

      const intentRoutingMap: Record<string, RoutingDecision> = {
        'research': 'route_web_explorer',
        'coding': 'route_coding',
        'build': 'route_coding',
        'fix': 'route_coding',
        'analyze': 'route_data_analyst',
        'automate': 'continue_brain',
      };

      let autoDecision = state.currentIntent ? intentRoutingMap[state.currentIntent] : undefined;
      if (!autoDecision && state.returningFromSpecialist) {
        const spec = state.returningFromSpecialist;
        autoDecision = spec.startsWith('route_') ? (spec as RoutingDecision) : (`route_${spec}` as RoutingDecision);
      }

      // Check if the targeted specialist is already complete
      const isCodingDone = autoDecision === 'route_coding' && state.codingComplete;
      const isWebExplorerDone = autoDecision === 'route_web_explorer' && state.webExplorerComplete;
      const isDataAnalystDone = autoDecision === 'route_data_analyst' && state.dataAnalysisComplete;
      const isSpecialistFinished = isCodingDone || isWebExplorerDone || isDataAnalystDone;

      if (autoDecision && autoDecision !== 'continue_brain' && !isSpecialistFinished) {
        runner.telemetry.info(`[Brain] Form response continuation — auto-routing to ${autoDecision}`);
        return {
          ...result,
          routingDecision: { decision: autoDecision, explanation: `Form response continuation for task` },
          completionSignal: null,
          taskPhase: 'specialized_agent' as const,
          brainToolsInFlight: false,
          returningFromSpecialist: state.returningFromSpecialist,
          resumingFromFormResponse: false,
        };
      }

      console.log('[Brain] Form response continuation — specialists finished or brain coordination needed. Proceeding to LLM synthesis.');
    }

    // Fast-path completion: if deliverables were presented or task_complete called in the current turn, complete cleanly
    const currentTurnTools = getCurrentTurnExecutedTools(state.messages || []);
    const alreadyDelivered = currentTurnTools.includes('present_files') || currentTurnTools.includes('task_complete');

    if (alreadyDelivered && !hasPendingTools) {
      runner.telemetry.info(`[Brain] Mission deliverables completed on step ${state.iterations}`);
      const finalState = {
        ...result,
        completionSignal: { reason: 'task_complete' as const, explanation: 'Deliverables presented and mission finished.' },
        routingDecision: null,
        brainToolsInFlight: false,
        returningFromSpecialist: null,
        resumingFromFormResponse: false
      };
      await createAgentCheckpoint(
        { ...state, ...finalState },
        runner,
        `Brain completed (step ${state.iterations})`
      );
      return finalState;
    }

    // Circuit breaker: if brain produced no meaningful output on repeat iterations without tools
    if (hasNoOutput && state.iterations > 2 && !state.resumingFromFormResponse) {
      runner.telemetry.info(`[Brain] No additional tool calls on iteration ${state.iterations} — wrapping up task`);

      const finalState = {
        ...result,
        completionSignal: { reason: 'task_complete' as const, explanation: 'Task completed.' },
        routingDecision: null,
        brainToolsInFlight: false,
        returningFromSpecialist: null,
        resumingFromFormResponse: false
      };

      await createAgentCheckpoint(
        { ...state, ...finalState },
        runner,
        `Brain completed on step ${state.iterations}`
      );

      return finalState;
    }

    // Auto-route based on intent when brain produces empty output.
    // This handles the case where the brain just asked a clarifying question,
    // the user answered, and on the next iteration the brain hallucinates tools
    // (e.g. web_search) that are filtered out → empty output → routing/completion signals fail.
    // Instead of falling through to determineRouting (which gets blank content and returns null),
    // use the triage intent to route directly to the right specialist.
    if (hasNoOutput) {
      const intentRoutingMap: Record<string, RoutingDecision> = {
        'research': 'route_web_explorer',
        'coding': 'route_coding',
        'build': 'route_coding',
        'fix': 'route_coding',
        'analyze': 'route_data_analyst',
        'automate': 'continue_brain',
        'task': state.webExplorerComplete ? 'continue_brain' : 'route_web_explorer',
        'unknown': state.webExplorerComplete ? 'continue_brain' : 'route_web_explorer',
      };
      const autoDecision = (state.currentIntent && intentRoutingMap[state.currentIntent]) || (state.webExplorerComplete ? 'continue_brain' : 'route_web_explorer');
      if (autoDecision) {
        const isCodingDone = autoDecision === 'route_coding' && state.codingComplete;
        const isWebExplorerDone = autoDecision === 'route_web_explorer' && state.webExplorerComplete;
        const isDataAnalystDone = autoDecision === 'route_data_analyst' && state.dataAnalysisComplete;

        if (!(isCodingDone || isWebExplorerDone || isDataAnalystDone)) {
          runner.telemetry.info(`[Brain] Auto-routing to ${autoDecision} for intent ${state.currentIntent} (brain produced no output)`);

          const routedState = {
            ...result,
            routingDecision: { decision: autoDecision, explanation: `Auto-routing for intent ${state.currentIntent} after brain produced no output` },
            completionSignal: null,
            taskPhase: 'specialized_agent' as const,
            brainToolsInFlight: false,
            returningFromSpecialist: null,
            resumingFromFormResponse: false
          };

          // Create checkpoint before auto-routing
          await createAgentCheckpoint(
            { ...state, ...routedState },
            runner,
            `Brain auto-routing to ${autoDecision} for intent ${state.currentIntent}`
          );

          return routedState;
        }
      }
    }

    // Determine routing decision
    // Skip routing decision if web_explorer has completed and we're returning from it (Sub-task 3.2)
    let routingDecision: { decision: RoutingDecision; explanation: string } | null = null;

    if (!skipRouting) {
      routingDecision = await determineRouting(runner, state, responseContent, eventQueue);

      if (routingDecision) {

        runner.telemetry.info(`Brain routing decision: ${routingDecision.decision} — ${routingDecision.explanation}`);
        console.log(`[Brain] Routing decision: ${routingDecision.decision} for intent: ${state.currentIntent}`);

      }

      // Fallback: if routing LLM failed (Mistral Small JSON parse issue, etc.),
      // use intent-based routing as a hard fallback so the task can make progress
      // instead of falling through to a failed completion signal.
      if (!routingDecision && state.currentIntent) {
        const fallbackRoutingMap: Record<string, RoutingDecision> = {
          'research': 'route_web_explorer',
          'coding': 'route_coding',
          'build': 'route_coding',
          'fix': 'route_coding',
          'analyze': 'route_data_analyst',
          'automate': 'continue_brain',
        };
        const fallbackDecision = fallbackRoutingMap[state.currentIntent];
        if (fallbackDecision) {
          runner.telemetry.warn(`[Brain] Routing LLM failed, falling back to intent-based routing: ${fallbackDecision} for intent ${state.currentIntent}`);

          routingDecision = { decision: fallbackDecision, explanation: `Fallback routing for intent ${state.currentIntent} (routing LLM failed)` };
        }
      }
    } else {
      console.log('[Brain] Skipping routing decision because web explorer complete and returning from it');
    }

    // Check if the target specialist (or task) has already completed in the current run
    if (routingDecision) {
      const isCodingDone = routingDecision.decision === 'route_coding' && state.codingComplete && state.returningFromSpecialist === 'coding_specialist';
      const isWebExplorerDone = routingDecision.decision === 'route_web_explorer' && state.webExplorerComplete && state.returningFromSpecialist === 'web_explorer';
      const isDataAnalystDone = routingDecision.decision === 'route_data_analyst' && state.dataAnalysisComplete && state.returningFromSpecialist === 'data_analyst';
      const isDeepResearchDone = routingDecision.decision === 'route_deep_research' && state.deepResearchComplete && state.returningFromSpecialist === 'deep_research';
      // computer_use has no first-class RoutingDecision literal — routers emit
      // either a legacy 'route_computer_use' string or 'continue_brain' under
      // the 'automate' intent — so both spellings must be matched here.
      const isComputerUseDone = ((routingDecision.decision as any) === 'route_computer_use' || 
                                 (routingDecision.decision === 'continue_brain' && state.currentIntent === 'automate')) && 
                                state.computerUseComplete && state.returningFromSpecialist === 'computer_use';

      if (isCodingDone || isWebExplorerDone || isDataAnalystDone || isDeepResearchDone || isComputerUseDone) {
        runner.telemetry.info(`[Brain] Override routing decision to complete_task because target specialist/task (${routingDecision.decision}) has already completed`);
        routingDecision = {
          decision: 'complete_task',
          explanation: 'Specialist task has already completed.'
        };
      }
    }

    // If routing to a specialized agent, set the routing decision
    if (routingDecision && routingDecision.decision.startsWith('route_')) {
      // Auto-enable Coding Mode UI when routing to coding specialist
      if (routingDecision.decision === 'route_coding') {
        eventQueue?.push({
          type: 'surface_action',
          action: 'coding_mode',
          active: true,
          surfaceId: 'coding-mode'
        });
      }

      const routedState = {
        ...result,
        routingDecision: routingDecision,
        completionSignal: null,
        taskPhase: 'specialized_agent' as const,
        brainToolsInFlight: false,
        returningFromSpecialist: null,
        harnessRecoveryActions: [],
        resumingFromFormResponse: false,
      };

      // Create checkpoint before routing to specialist
      await createAgentCheckpoint(
        { ...state, ...routedState },
        runner,
        `Brain routing to ${routingDecision.decision}: ${routingDecision.explanation}`
      );

      return routedState;
    }

    // Fast-path completion bypass (Claude Cowork pattern)
    // If routing decided complete_task or a deliverable was presented in the current turn, skip redundant LLM validation call
    const deliveredOrCompleted = currentTurnTools.includes('present_files') || currentTurnTools.includes('task_complete');

    let signal: any = null;
    if (routingDecision && routingDecision.decision === 'complete_task') {
      signal = {
        reason: 'task_complete' as const,
        explanation: routingDecision.explanation || 'Specialist task has already completed.'
      };
    } else if (deliveredOrCompleted && !hasPendingTools) {
      signal = {
        reason: 'task_complete' as const,
        explanation: 'Deliverables presented or task_complete executed successfully.'
      };
    } else {
      signal = await buildCompletionSignal(runner, responseContent, originalRequest);
    }

    if (signal) {
      runner.telemetry.info(`Brain completion signal: ${signal.reason} — ${signal.explanation}`);

      if (signal.reason === 'waiting_for_user_input') {
        const askTool = buildAskUserQuestionToolCall(signal, responseContent, originalRequest);
        runner.telemetry.info('[Brain] Converting waiting_for_user_input signal into ask_user_question form');
        eventQueue?.push({
          type: 'thought',
          content: 'I need one more detail from you before I can continue.'
        });

        const questionState = {
          ...result,
          pendingToolCalls: [askTool],
          completionSignal: null,
          routingDecision: null,
          brainToolsInFlight: true,
          returningFromSpecialist: null,
          webExplorerComplete: state.webExplorerComplete,
          resumingFromFormResponse: false
        };

        await createAgentCheckpoint(
          { ...state, ...questionState },
          runner,
          'Brain converted waiting_for_user_input to ask_user_question'
        );

        return questionState;
      }

      if (signal.reason === 'cannot_proceed' && signal.explanation) {
        const existingResponse = responseContent.trim().toLowerCase();
        const explanation = signal.explanation.trim();
        if (!existingResponse || !existingResponse.includes(explanation.toLowerCase().slice(0, 80))) {
          eventQueue?.push({
            type: 'chunk',
            content: `I can't proceed with that request: ${explanation}`,
          });
        }
      }
    } else {
      runner.telemetry.warn('Brain completion signal failed');

    }

    // Sync .everfern/task_plan.md checkboxes & progress
    try {
      const { syncTaskPlan } = await import('../task-plan-helper');
      await syncTaskPlan(runner, missionTracker);
    } catch (tpErr) {
      console.warn('[Brain] Failed to sync task plan:', tpErr);
    }

    return {
      ...result,
      completionSignal: signal,
      routingDecision: routingDecision,
      brainToolsInFlight: false,
      returningFromSpecialist: null,
      // Preserve webExplorerComplete flag from input state (Sub-task 3.2)
      webExplorerComplete: state.webExplorerComplete,
      resumingFromFormResponse: false
    };
  };
};
