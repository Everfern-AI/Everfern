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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

type CompletionReason = 'task_complete' | 'waiting_for_user_input' | 'needs_hitl' | 'cannot_proceed';
type RoutingDecision = 'continue_brain' | 'route_coding' | 'route_data_analyst' | 'route_web_explorer' | 'route_deep_research' | 'complete_task';

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
          abortSignal: globalAbortManager.abortController.signal,
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

    // Inject harness workflow phase prompt if available
    if (systemPrompt && state.harnessPhasePrompt) {
      systemPrompt += `\n\n=== WORKFLOW PHASE ===\n${state.harnessPhasePrompt}\n`;
      console.log('[Brain] 🏗️ Injected harness phase prompt into system prompt');
    }

    // Inject recent findings from findings.md so the brain doesn't repeat navis/web_search work
    try {
      const findingsPath = path.join(os.homedir(), '.everfern', 'findings.md');
      if (fs.existsSync(findingsPath)) {
        const findingsContent = fs.readFileSync(findingsPath, 'utf-8').trim();
        if (findingsContent && findingsContent.length > 0) {
          systemPrompt += `\n\n# RECENT RESEARCH FINDINGS\nBelow are findings from tools (navis, web_search) already executed during this session. Do NOT repeat the same URLs or searches unless new information is needed:\n${findingsContent}\n`;
          console.log('[Brain] 📄 Injected findings.md context into system prompt');
        }
      }
    } catch (findingsErr) {
      console.warn('[Brain] Failed to inject findings:', findingsErr);
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

    // Circuit breaker: if brain produced no meaningful output on repeat iterations,
    // signal task complete to prevent infinite loops (e.g. after spawn_agent returns
    // and the brain hallucinates filtered tools with empty response).
    if (hasNoOutput && state.iterations > 1 && !state.resumingFromFormResponse) {
      runner.telemetry.warn(`[Brain] No output on iteration ${state.iterations} — forcing task_complete to prevent loop`);

      const finalState = {
        ...result,
        completionSignal: { reason: 'task_complete' as const, explanation: 'Brain produced no output after multiple iterations.' },
        routingDecision: null,
        brainToolsInFlight: false,
        returningFromSpecialist: null,
        resumingFromFormResponse: false
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

    // If continuing with brain or completing task, build completion signal
    let signal = await buildCompletionSignal(runner, responseContent, originalRequest);

    if (routingDecision && routingDecision.decision === 'complete_task') {
      signal = {
        reason: 'task_complete' as const,
        explanation: routingDecision.explanation || 'Specialist task has already completed.'
      };
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
