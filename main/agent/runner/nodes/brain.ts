import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';
import type { AIClient } from '../../../lib/ai-client';
import { globalAbortManager } from '../abort-manager';
import { nodeLifecycle } from '../services/node-utils';
import { getCheckpointEngine, type Checkpoint, type FailedCheckpoint } from '../../persistence/checkpoint-engine';
import { loadSoul, loadAgents } from '../../personality-manager';

type CompletionReason = 'task_complete' | 'waiting_for_user_input' | 'needs_hitl' | 'cannot_proceed';
type RoutingDecision = 'continue_brain' | 'route_coding' | 'route_data_analyst' | 'route_web_explorer' | 'complete_task';

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
      runner.telemetry.info(`[Brain] Checkpoint created in ${duration}ms for step: ${stepDescription}`);
      console.log(`[Brain] Checkpoint created: id=${checkpoint.id} task=${taskId} step=${checkpoint.stepNumber} (${stepDescription})`);
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
 * - Increased timeout from 20s to 30s for slower LLM responses
 * - Added fallback completion signal when LLM fails
 * - Improved JSON extraction and error handling
 * - Added detailed logging at each step
 */
async function buildCompletionSignal(
  runner: AgentRunner,
  responseContent: string,
  originalRequest: string,
): Promise<{ reason: CompletionReason; explanation: string } | null> {
  if (!runner.client) {
    console.warn('[Brain] No client available for completion signal');
    // Return fallback signal instead of null
    console.warn('[Brain] Using fallback completion signal (no client)');
    return { reason: 'task_complete' as const, explanation: 'Task completed (fallback signal - no client)' };
  }

  try {
    const prompt = `You just produced a response to a user request. Classify why you are done for this turn.

USER REQUEST: "${originalRequest.slice(0, 300)}"
YOUR RESPONSE: "${responseContent.slice(0, 500)}"

Choose exactly one reason:
- "task_complete"        — You fully completed the requested task with substantive output
- "waiting_for_user_input" — You need the user to provide information, make a selection, or upload a file before you can proceed
- "needs_hitl"           — A high-risk or irreversible action requires explicit human approval before execution. Use this for: file organizing/moving/renaming, bulk operations, deleting user files, installing system packages, or any local execution on the host system.
- "cannot_proceed"       — You are blocked and cannot make progress (missing permissions, unsupported request, etc.)

Respond with JSON only:
{
  "reason": "task_complete" | "waiting_for_user_input" | "needs_hitl" | "cannot_proceed",
  "explanation": "one sentence explaining why",
  "hitlRationale": "If reason is needs_hitl, explain what action needs approval and why"
}`;

    console.log('[Brain] Building completion signal...');
    console.log('[Brain] Original request (first 100 chars):', originalRequest.slice(0, 100));
    const startTime = Date.now();

    // Increased timeout from 20s to 30s (Sub-task 3.1)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('completion signal timed out after 30s')), 30000)
    );

    const response = await Promise.race([
      runner.client.chat({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json',
        temperature: 0.3,
        maxTokens: 1500,
        abortSignal: globalAbortManager.abortController.signal,
      }),
      timeoutPromise,
    ]) as any;

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
      // Return fallback signal instead of null (Sub-task 3.1)
      console.warn('[Brain] Using fallback completion signal (JSON parse failed)');
      return { reason: 'task_complete' as const, explanation: 'Task completed (fallback signal - parse error)' };
    }

    const validReasons: CompletionReason[] = ['task_complete', 'waiting_for_user_input', 'needs_hitl', 'cannot_proceed'];
    if (!validReasons.includes(signal.reason)) {
      console.warn('[Brain] Invalid completion signal reason:', signal.reason);
      // Return fallback signal instead of null (Sub-task 3.1)
      console.warn('[Brain] Using fallback completion signal (invalid reason)');
      return { reason: 'task_complete' as const, explanation: 'Task completed (fallback signal - invalid reason)' };
    }

    console.log(`[Brain] Completion signal built successfully in ${duration}ms: ${signal.reason}`);
    return { reason: signal.reason as CompletionReason, explanation: String(signal.explanation || '') };
  } catch (error) {
    // Log the specific error for debugging (Sub-task 3.1)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[Brain] Completion signal failed:', errorMessage);
    // Return fallback signal instead of null (Sub-task 3.1)
    console.warn('[Brain] Using fallback completion signal (exception)');
    return { reason: 'task_complete' as const, explanation: 'Task completed (fallback signal - exception)' };
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

  // Detect if this brain is running as a sub-agent
  const isSubAgent = !!runner.currentAgentSessionKey;

  try {
    // Extract user request from the last user message
    const lastUserMsg = state.messages?.filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();
    const userRequest = lastUserMsg
      ? (typeof (lastUserMsg as any).content === 'string'
          ? (lastUserMsg as any).content
          : JSON.stringify((lastUserMsg as any).content))
      : '';
    const conversationHistory = state.messages?.slice(-3) || []; // Last 3 messages for context

    // Emit analysis phase


    const intentConstraint = state.currentIntent
      ? `\nTRIAGE INTENT (HARD CONSTRAINT): "${state.currentIntent}"\n` +
        (state.currentIntent === 'research'
          ? `Because the triage intent is "research", the ONLY valid routing decisions are: "route_web_explorer", "continue_brain", or "complete_task". You MUST NOT route to "route_computer_use".\n`
          : '')
      : '';

    const subAgentConstraint = isSubAgent
      ? `\nSUB-AGENT CONSTRAINT (HARD): You are a SUB-AGENT. You MUST NOT route to "route_web_explorer", "route_coding", "route_data_analyst", or "route_computer_use". You are already a delegated agent — use the tools you have directly. Route to "continue_brain" to keep working with your available tools, or "complete_task" if done.\n`
      : '';

    const prompt = `You are the EverFern Brain - the central orchestrator. Analyze the user request and determine the best routing decision.

${intentConstraint}${subAgentConstraint}
USER REQUEST: "${userRequest.slice(0, 400)}"
YOUR CURRENT RESPONSE: "${responseContent.slice(0, 300)}"
CONVERSATION CONTEXT: ${JSON.stringify(conversationHistory).slice(0, 200)}

Available routing options:
- "continue_brain"     — Continue handling this yourself with general capabilities (conversation, simple tasks, IMAGE/FILE ORGANIZATION, web_search + navis for detailed extraction)
- "route_coding"       — Route to Coding Specialist for software development, code writing, debugging, PROJECT CREATION
- "route_data_analyst" — Route to Data Analyst for data processing, CSV/Excel analysis, charts
- "route_web_explorer" — Route to Web Explorer for complex multi-step web research (multiple page visits, form filling, login workflows). For simple web lookups or single-page research, use your available web_search/navis tools directly.
- "complete_task"      — Task is complete, no further routing needed

CRITICAL ROUTING RULES:
1. If user asks to "write code", "fix a bug", "implement a feature", "create a project", "build an app", "scaffold a website", "make a React app", "create a Next.js app", or perform ANY software development task → ALWAYS use "route_coding"
2. For ANY web research task (searching, finding information online, looking up websites, finding bots, comparing services), prefer "continue_brain" to use web_search + navis directly. Only use "route_web_explorer" for complex multi-step workflows.
3. CRITICAL WEB RESEARCH STRATEGY: For tasks like "find pricing", "get discount codes", "compare services", "find contact info", "download software" → Use "continue_brain" and follow the two-phase approach: (1) web_search to find candidate sites, (2) navis to extract specific details, pricing, coupons, or interact with forms.
4. CRITICAL: If the user asks to "find", "search for", "investigate", "get pricing for", "find coupons for", "compare costs of" — these are SIMPLE web research tasks. Use "continue_brain" with web_search + navis.
5. You have web_search and navis available directly — use them for most web research tasks. The two-phase approach (search then extract) handles 90% of web research needs without routing to specialists.
6. NEVER use terminal_execute with curl for web research. Use web_search or navis which you have available.
7. CRITICAL — PICK ONE: Do NOT both route to a specialist AND call spawn_agent/tools for the same task. If you use "continue_brain", handle the complete task with your tools. If you route to "route_web_explorer", let the specialist handle it completely.
8. POST-SEARCH NAVIS USAGE: After web_search finds relevant sites, ALWAYS use navis to extract specific details like pricing, features, contact info, discount codes, or to interact with forms/downloads.
9. IMAGE/FILE ORGANIZATION: For tasks like "organize my images/pictures/photos", "sort files by content", "classify images" → ALWAYS use "continue_brain". Use system_files to list files, analyze_image to classify by content (vision), and system_files to move them. Never route image organization to a specialist. Read the image-viewer skill (SKILL.md) and follow its workflows.

Respond with JSON only:
{
  "decision": "continue_brain" | "route_coding" | "route_data_analyst" | "route_web_explorer" | "complete_task",
  "explanation": "one sentence explaining the routing decision"
}`;

    console.log('[Brain] Determining routing decision...');
    const startTime = Date.now();

    const response = await runner.client.chat({
      messages: [{ role: 'user', content: prompt }],
      responseFormat: 'json',
      temperature: 0.3,
      maxTokens: 1500,
      abortSignal: globalAbortManager.abortController.signal,
    }) as any;

    const duration = Date.now() - startTime;
    console.log(`[Brain] Routing decision response received in ${duration}ms`);

    if (response.usage) {
      try {
        const { recordUsage } = await import('../../../store/analytics');
        const cfg = (runner as any).config;
        recordUsage({
          conversationId: state.missionId ?? undefined, // Route tracking
          model: runner.client.model ?? cfg?.model ?? 'unknown',
          provider: runner.client.provider ?? cfg?.provider ?? cfg?.engine ?? 'unknown',
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
        }).catch(() => { /* never throw */ });
      } catch { /* ignore */ }
    }

    // Emit decision analysis


    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    console.log('[Brain] Raw routing response (first 500 chars):', content.slice(0, 500));

    content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Robust JSON extraction: find first '{' and last '}'
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      console.warn('[Brain] No valid JSON braces found in routing response');
      console.warn('[Brain] Response was:', content.slice(0, 300));
      return null;
    }

    const jsonStr = content.substring(firstBrace, lastBrace + 1);
    console.log('[Brain] Extracted JSON string:', jsonStr);

    let routing;
    try {
      routing = JSON.parse(jsonStr);
      console.log('[Brain] Successfully parsed routing JSON:', routing);
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn('[Brain] Failed to parse routing decision JSON:', errorMsg);
      console.warn('[Brain] Attempted to parse:', jsonStr);
      return null;
    }

    const validDecisions: RoutingDecision[] = [
      'continue_brain', 'route_coding', 'route_data_analyst',
      'route_web_explorer', 'complete_task'
    ];

    if (!validDecisions.includes(routing.decision)) {
      console.warn('[Brain] Invalid routing decision:', routing.decision);
      return null;
    }

    console.log(`[Brain] Routing decision made in ${duration}ms: ${routing.decision}`);
    return { decision: routing.decision as RoutingDecision, explanation: String(routing.explanation || '') };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[Brain] Routing decision failed:', errorMessage);
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

    // Debug logging
    console.log(`[Brain] Current intent: ${state.currentIntent}`);
    console.log(`[Brain] Is sub-agent: ${isSubAgent}`);
    console.log(`[Brain] Available tools: ${allTools.map((t: any) => t.name).join(', ')}`);

    // Emit phase change event for execution phase (only on first brain call)
    if (missionTracker && state.iterations === 0) {
      missionTracker.setPhase('execution');
    }

    // Emit initial brain activation message


    // ── EARLY RESEARCH INTENT DETECTION ──────────────────────────────────────
    // If the current intent is 'research' AND we haven't already routed to web-explorer
    // in this turn, immediately route to web-explorer without executing any tools.
    // This prevents the brain from attempting web_search execution and ensures research
    // requests are delegated to the specialized web-explorer agent.
    //
    // CRITICAL: Only route on the FIRST brain call for research intent.
    // If returningFromSpecialist is already set to 'web_explorer', we've already routed
    // and should NOT route again (that would create an infinite loop).
    //
    // ALSO: If web-explorer has already completed (webExplorerComplete === true),
    // do NOT route back to it — the task is done.
    if (state.currentIntent === 'research' && !state.returningFromSpecialist && !state.webExplorerComplete) {
      console.log('[Brain] Research intent detected → routing to web-explorer immediately');

      return {
        pendingToolCalls: [],
        routingDecision: {
          decision: 'route_web_explorer',
          explanation: 'Research intent detected — delegating to web-explorer'
        },
        completionSignal: null,
        taskPhase: 'specialized_agent' as const,
        brainToolsInFlight: false,
        returningFromSpecialist: 'web_explorer'
      };
    }

    if ((state.currentIntent === 'coding' || state.currentIntent === 'build' || state.currentIntent === 'fix') && !state.returningFromSpecialist && !state.codingComplete) {
      console.log(`[Brain] ${state.currentIntent} intent detected → routing to coding_specialist immediately`);

      return {
        pendingToolCalls: [],
        routingDecision: {
          decision: 'route_coding',
          explanation: `${state.currentIntent} intent detected — delegating to coding_specialist`
        },
        completionSignal: null,
        taskPhase: 'specialized_agent' as const,
        brainToolsInFlight: false,
        returningFromSpecialist: 'coding_specialist'
      };
    }
    // ────────────────────────────────────────────────────────────────────────

    // Load the main system prompt from synchronized location
    let systemPrompt = systemPromptOverride;
    if (!systemPrompt) {
      const mainSystemPrompt = loadPrompt('SYSTEM_PROMPT.md');
      if (mainSystemPrompt) {
        systemPrompt = mainSystemPrompt;
        console.log('[Brain] 📖 Using main SYSTEM_PROMPT.md from ~/.everfern/prompts/');
      } else {
        console.warn('[Brain] ⚠️  Could not load SYSTEM_PROMPT.md, using default');
      }
    }

    // Inject graph-based persistent memories (USER_PROFILE.md and PROJECT_STATE.md)
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const memoryDir = path.join(os.homedir(), '.everfern', 'memory');
      const profilePath = path.join(memoryDir, 'USER_PROFILE.md');
      const projectPath = path.join(memoryDir, 'PROJECT_STATE.md');

      let memoryInjection = '\n\n# PERSISTENT MEMORY & SYSTEM STATE\n';
      if (fs.existsSync(profilePath)) {
        memoryInjection += `\n## USER_PROFILE.md (User preferences, rules, styles):\n${fs.readFileSync(profilePath, 'utf-8')}\n`;
      }
      if (fs.existsSync(projectPath)) {
        memoryInjection += `\n## PROJECT_STATE.md (Persistent facts, architectural choices):\n${fs.readFileSync(projectPath, 'utf-8')}\n`;
      }

      if (systemPrompt && memoryInjection !== '\n\n# PERSISTENT MEMORY & SYSTEM STATE\n') {
        systemPrompt += memoryInjection;
        console.log('[Brain] 🧠 Injected persistent memories into system prompt');
      }
    } catch (memErr) {
      console.warn('[Brain] Failed to inject persistent memory:', memErr);
    }

    // Inject OpenClaw personality and routing configurations
    try {
      const workspaceRoot = runner.workspaceDir;
      const soulContent = loadSoul(workspaceRoot);
      const agentsContent = loadAgents(workspaceRoot);
      
      if (systemPrompt) {
        systemPrompt += `\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\n${soulContent}\n`;
        systemPrompt += `\n\n# SUB-AGENTS & ROUTING RULES (AGENTS.md)\n${agentsContent}\n`;
        console.log('[Brain] 🎭 Injected SOUL.md and AGENTS.md into system prompt');
      }
    } catch (openclawErr) {
      console.warn('[Brain] Failed to inject OpenClaw configurations:', openclawErr);
    }

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

    // ── EARLY CHECK FOR WEB_EXPLORER COMPLETION (Sub-task 3.2) ──────────────
    // If web_explorer has completed (webExplorerComplete: true) and we're returning from it,
    // skip routing to another specialist and go directly to completion signal generation.
    // This prevents unnecessary specialist routing when the task is already done.
    if (state.webExplorerComplete && state.returningFromSpecialist === 'web_explorer') {
      console.log('[Brain] Web explorer complete detected → skipping specialist routing, generating completion signal');

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
        systemPromptOverride: systemPrompt
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
        returningFromSpecialist: null
      };
    }

    // Circuit breaker: if brain produced no meaningful output on repeat iterations,
    // signal task complete to prevent infinite loops (e.g. after spawn_agent returns
    // and the brain hallucinates filtered tools with empty response).
    const hasNoOutput = !responseContent || responseContent.trim().length === 0;
    if (hasNoOutput && state.iterations > 1) {
      runner.telemetry.warn(`[Brain] No output on iteration ${state.iterations} — forcing task_complete to prevent loop`);

      const finalState = {
        ...result,
        completionSignal: { reason: 'task_complete' as const, explanation: 'Brain produced no output after multiple iterations.' },
        routingDecision: null,
        brainToolsInFlight: false,
        returningFromSpecialist: null
      };

      // Create checkpoint before forcing completion
      await createAgentCheckpoint(
        { ...state, ...finalState },
        runner,
        `Brain forced completion (no output on iteration ${state.iterations})`
      );

      return finalState;
    }

    // Auto-route based on intent when brain produces empty output.
    // This handles the case where the brain just asked a clarifying question,
    // the user answered, and on the next iteration the brain hallucinates tools
    // (e.g. web_search) that are filtered out → empty output → routing/completion signals fail.
    // Instead of falling through to determineRouting (which gets blank content and returns null),
    // use the triage intent to route directly to the right specialist.
    if (hasNoOutput && state.currentIntent) {
      const intentRoutingMap: Record<string, RoutingDecision> = {
        'research': 'route_web_explorer',
        'coding': 'route_coding',
        'build': 'route_coding',
        'fix': 'route_coding',
        'analyze': 'route_data_analyst',
        'automate': 'continue_brain',
      };
      const autoDecision = intentRoutingMap[state.currentIntent];
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
            returningFromSpecialist: null
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
    // Skip routing decision if web_explorer has completed (Sub-task 3.2)
    let routingDecision: { decision: RoutingDecision; explanation: string } | null = null;

    if (!state.webExplorerComplete) {
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
      console.log('[Brain] Skipping routing decision because webExplorerComplete is true');
    }

    // If routing to a specialized agent, set the routing decision
    if (routingDecision && routingDecision.decision.startsWith('route_')) {
      const isCodingDone = routingDecision.decision === 'route_coding' && state.codingComplete;
      const isWebExplorerDone = routingDecision.decision === 'route_web_explorer' && state.webExplorerComplete;
      const isDataAnalystDone = routingDecision.decision === 'route_data_analyst' && state.dataAnalysisComplete;

      if (isCodingDone || isWebExplorerDone || isDataAnalystDone) {
        runner.telemetry.info(`[Brain] Refusing to route to ${routingDecision.decision} because it has already completed`);
        routingDecision = null;
      } else {
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
          // Set task phase to route to specialized agents
          taskPhase: 'specialized_agent' as const,
          brainToolsInFlight: false,
          returningFromSpecialist: null
        };

        // Create checkpoint before routing to specialist
        await createAgentCheckpoint(
          { ...state, ...routedState },
          runner,
          `Brain routing to ${routingDecision.decision}: ${routingDecision.explanation}`
        );

        return routedState;
      }
    }

    // If continuing with brain or completing task, build completion signal
    const signal = await buildCompletionSignal(runner, responseContent, originalRequest);

    if (signal) {
      runner.telemetry.info(`Brain completion signal: ${signal.reason} — ${signal.explanation}`);

    } else {
      runner.telemetry.warn('Brain completion signal failed');

    }

    return {
      ...result,
      completionSignal: signal,
      routingDecision: routingDecision,
      brainToolsInFlight: false,
      returningFromSpecialist: null,
      // Preserve webExplorerComplete flag from input state (Sub-task 3.2)
      webExplorerComplete: state.webExplorerComplete
    };
  };
};
