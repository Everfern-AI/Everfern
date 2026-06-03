import * as crypto from 'crypto';
import { SystemMessage, AIMessage } from '@langchain/core/messages';
import { AIClient, ChatMessage, ChatRequest, ToolDefinition } from '../../../lib/ai-client';
import { GraphStateType, StreamEvent } from '../state';
import { parseTextToToolCalls } from '../../parsers/text-to-tool';
import { AgentRunner } from '../runner';
import { normalizeMessages } from './message-utils';
import { captureScreen } from '../../tools/computer-use';
import { globalAbortManager } from '../abort-manager';
import { SERIALIZATION_VERSION } from '../../persistence/state-serializer';
import {
  getSessionPersistenceManager,
  initializeSessionPersistenceManager,
} from '../../persistence/session-manager';

// ── State restoration types ───────────────────────────────────────────

/**
 * Options for resuming an agent task from a persisted checkpoint.
 *
 * Requirement 1.3: Restore most recent LangGraph_State for active tasks
 * Requirement 1.6: Resume from exact state before shutdown
 */
export interface AgentResumptionOptions {
  /**
   * Task ID to resume from — the most recent checkpoint for this task will be loaded.
   * When provided, the agent initializes from the persisted state rather than a fresh slate.
   */
  resumeFromTaskId: string;

  /**
   * Optional specific checkpoint ID to restore from.
   * When omitted, the latest checkpoint for `resumeFromTaskId` is used.
   */
  checkpointId?: string;
}

/**
 * Result of restoring agent state from a checkpoint.
 *
 * Requirement 1.3, 1.4, 1.5, 1.6, 11.4, 11.5
 */
export interface AgentRestorationResult {
  /** The restored LangGraph state ready for graph injection */
  restoredState: GraphStateType;
  /** The checkpoint ID that was restored */
  checkpointId: string;
  /** Step number at time of checkpoint */
  stepNumber: number;
  /** Whether the state is fully compatible with the current serialization version */
  compatible: boolean;
  /** Warning messages for partially-compatible states */
  warnings: string[];
}

export interface AgentStepOptions {
  runner: AgentRunner;
  toolDefs: ToolDefinition[];
  eventQueue?: StreamEvent[];
  maxVerifyRetries?: number;
  systemPromptOverride?: string;
  nodeName: string;
}

// ── State compatibility validation ───────────────────────────────────

/**
 * Validate that a restored state is compatible with the current code version.
 *
 * Checks the serializationVersion stored in the state metadata and emits
 * warnings for version mismatches or missing required fields.
 *
 * Requirement 11.4: Validate state structure against a schema during deserialization
 * Requirement 11.5: Report deserialization errors with specific field information
 *
 * @param state - The deserialized state to validate
 * @returns Validation result with compatibility flag and warnings
 */
function validateRestoredStateCompatibility(
  state: GraphStateType & { serializationVersion?: string; timestamp?: number }
): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check serialization version for forward-compatibility
  // Requirement 11.4: Validate state structure
  const storedVersion = state.serializationVersion;
  if (!storedVersion) {
    warnings.push(
      'Restored state is missing serializationVersion — may have been saved by an older version of EverFern'
    );
  } else if (storedVersion !== SERIALIZATION_VERSION) {
    warnings.push(
      `State was serialized with version ${storedVersion} but current version is ${SERIALIZATION_VERSION}. ` +
      `Minor version differences are usually safe; major differences may cause unexpected behavior.`
    );
  }

  // Validate required fields are present
  // Requirement 11.4: Validate the state structure against a schema
  const requiredFields: Array<keyof GraphStateType> = ['messages', 'iterations'];
  const missingFields: string[] = [];
  for (const field of requiredFields) {
    if (state[field] === undefined || state[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    // Requirement 11.5: Report deserialization errors with specific field information
    warnings.push(
      `Restored state is missing required fields: ${missingFields.join(', ')}. ` +
      `These will be initialized to defaults.`
    );
  }

  // Validate messages array integrity
  if (!Array.isArray(state.messages)) {
    warnings.push('Restored state messages field is not an array — conversation history may be lost.');
  } else if (state.messages.length === 0) {
    warnings.push('Restored state has no messages — the conversation history may have been empty at checkpoint time.');
  }

  // Validate iterations counter
  if (typeof state.iterations !== 'number' || state.iterations < 0) {
    warnings.push(
      `Restored state has invalid iterations value (${state.iterations}) — will reset to 0.`
    );
  }

  // State is compatible if there are no critical issues (missing required fields are fixable)
  const hasCompatibilityBreakingIssues =
    !Array.isArray(state.messages) ||
    (typeof state.iterations !== 'number');

  return {
    compatible: !hasCompatibilityBreakingIssues,
    warnings,
  };
}

/**
 * Apply default values to fill missing or invalid fields in a restored state.
 *
 * Ensures the state is always safe to inject into the LangGraph graph,
 * even if some fields were missing from the checkpoint.
 *
 * Requirement 1.6: Resume from exact state before shutdown (with safe defaults for gaps)
 */
function applyRestorationDefaults(state: Partial<GraphStateType>): GraphStateType {
  return {
    messages: state.messages ?? [],
    currentIntent: state.currentIntent ?? 'unknown',
    intentConfidence: state.intentConfidence ?? 0,
    decomposedTask: state.decomposedTask ?? null,
    taskPhase: state.taskPhase ?? 'brain',
    pendingToolCalls: state.pendingToolCalls ?? [],
    toolCallRecords: state.toolCallRecords ?? [],
    activeAgent: state.activeAgent ?? '',
    completionSignal: state.completionSignal ?? null,
    routingDecision: state.routingDecision ?? null,
    webExplorerComplete: state.webExplorerComplete ?? false,
    navisInvoked: state.navisInvoked ?? false,
    searchInvoked: state.searchInvoked ?? false,
    codingComplete: state.codingComplete ?? false,
    missionId: state.missionId ?? '',
    missionTimeline: state.missionTimeline ?? null,
    missionSteps: state.missionSteps ?? [],
    agiHints: state.agiHints ?? '',
    pauseGeneration: state.pauseGeneration ?? false,
    iterations: (typeof state.iterations === 'number' && state.iterations >= 0)
      ? state.iterations
      : 0,
    validationResult: state.validationResult ?? null,
    shouldContinueIteration: state.shouldContinueIteration ?? false,
    hitlApprovalResult: state.hitlApprovalResult ?? null,
    currentStepId: state.currentStepId ?? '',
    webExplorerSelfLoopCount: state.webExplorerSelfLoopCount ?? 0,
    dataAnalysisComplete: state.dataAnalysisComplete ?? false,
    computerUseComplete: state.computerUseComplete ?? false,
    deepResearchComplete: state.deepResearchComplete ?? false,
    deepResearchSelfLoopCount: state.deepResearchSelfLoopCount ?? 0,
    subagentSpawned: state.subagentSpawned ?? null,
    completedSteps: state.completedSteps ?? [],
    decompositionAttempts: state.decompositionAttempts ?? 0,
    brainToolsInFlight: state.brainToolsInFlight ?? false,
    returningFromSpecialist: state.returningFromSpecialist ?? null,
    debateResult: state.debateResult ?? null,
    ...(state as Record<string, unknown>)['toolCallHistory'] !== undefined
      ? { toolCallHistory: (state as Record<string, unknown>)['toolCallHistory'] }
      : { toolCallHistory: [] },
    ...(state as Record<string, unknown>)['userConfirmation'] !== undefined
      ? { userConfirmation: (state as Record<string, unknown>)['userConfirmation'] }
      : {},
    ...(state as Record<string, unknown>)['finalResponse'] !== undefined
      ? { finalResponse: (state as Record<string, unknown>)['finalResponse'] }
      : { finalResponse: '' },
  } as GraphStateType;
}

// ── State restoration entry point ─────────────────────────────────────

/**
 * Initialize the agent state from a persisted checkpoint.
 *
 * This is the primary entry point for restoring a previously interrupted task.
 * It loads the latest (or specified) checkpoint for the given task ID,
 * validates compatibility with the current code version, and returns
 * the restored state ready for LangGraph injection.
 *
 * On any failure, logs the error and returns null so the caller can fall
 * back to a fresh agent initialization — agent execution is never blocked
 * by a restoration failure.
 *
 * Requirement 1.3: Restore most recent LangGraph_State for active tasks
 * Requirement 1.4: Maintain conversation history across restarts
 * Requirement 1.5: Preserve tool call history and results across restarts
 * Requirement 1.6: Resume from exact state before shutdown
 * Requirement 11.4: Validate state structure against a schema
 * Requirement 11.5: Report deserialization errors with specific field information
 *
 * @param options - Resumption options including task ID and optional checkpoint ID
 * @returns Restoration result with restored state, or null on failure
 */
export async function initializeRestoredAgentState(
  options: AgentResumptionOptions
): Promise<AgentRestorationResult | null> {
  const { resumeFromTaskId, checkpointId } = options;

  try {
    console.log(
      `[AgentRuntime] Restoring agent state for task ${resumeFromTaskId}` +
      (checkpointId ? ` from checkpoint ${checkpointId}` : ' from latest checkpoint')
    );

    // Ensure session persistence manager is initialized
    // Requirement 1.3: Session_Persistence_Manager SHALL restore the most recent LangGraph_State
    const manager = getSessionPersistenceManager();
    await initializeSessionPersistenceManager();

    // Retrieve the restored state
    let rawState: GraphStateType | null;

    if (checkpointId) {
      // Restore from specific checkpoint
      rawState = await manager.restoreState(checkpointId);
    } else {
      // Restore from latest checkpoint for the task
      rawState = await manager.restoreLatestCheckpoint(resumeFromTaskId);
    }

    if (!rawState) {
      console.warn(
        `[AgentRuntime] No checkpoint found for task ${resumeFromTaskId} — will start fresh`
      );
      return null;
    }

    // Find the actual checkpoint metadata for reporting
    const checkpoints = await manager.listCheckpointsForTask(resumeFromTaskId, 1);
    const latestCheckpoint = checkpoints[0];
    const resolvedCheckpointId = checkpointId ?? latestCheckpoint?.id ?? `restored-${Date.now()}`;
    const stepNumber = latestCheckpoint?.stepNumber ?? (rawState.iterations ?? 0);

    // Validate compatibility with current code version
    // Requirement 11.4: Validate state structure
    const { compatible, warnings } = validateRestoredStateCompatibility(
      rawState as GraphStateType & { serializationVersion?: string; timestamp?: number }
    );

    // Log warnings for operators to review
    for (const warning of warnings) {
      console.warn(`[AgentRuntime] State restoration warning: ${warning}`);
    }

    if (!compatible) {
      console.error(
        `[AgentRuntime] Restored state for task ${resumeFromTaskId} is not compatible with current code version. ` +
        `Warnings: ${warnings.join('; ')}`
      );
      // Requirement 11.5: Report deserialization errors
      // Even on incompatibility, we attempt restoration with defaults to maximize continuity
      console.warn(
        '[AgentRuntime] Attempting partial restoration with defaults for incompatible fields...'
      );
    }

    // Apply defaults to fill missing fields from the restored state
    // Requirement 1.6: Resume from exact state, filling gaps with safe defaults
    const restoredState = applyRestorationDefaults(rawState);

    console.log(
      `[AgentRuntime] State restored successfully for task ${resumeFromTaskId}: ` +
      `${restoredState.messages?.length ?? 0} messages, step ${stepNumber}, ` +
      `compatible=${compatible}, warnings=${warnings.length}`
    );

    return {
      restoredState,
      checkpointId: resolvedCheckpointId,
      stepNumber,
      compatible,
      warnings,
    };
  } catch (error) {
    // Never block agent execution due to restoration failure
    // Requirement 2.5 pattern: Log error and continue
    console.error(
      `[AgentRuntime] Failed to restore agent state for task ${resumeFromTaskId}:`,
      error
    );
    return null;
  }
}

/**
 * Reusable agent execution logic for calling the model and processing its response.
 * Uses pooled AI clients for better performance and connection reuse.
 */
export async function runAgentStep(
  state: GraphStateType,
  options: AgentStepOptions
): Promise<Partial<GraphStateType>> {
  const { runner, toolDefs, eventQueue, maxVerifyRetries = 3, systemPromptOverride, nodeName } = options;

  runner.telemetry.transition(nodeName);
  const iterations = state.iterations || 0;
  runner.telemetry.metrics(iterations);

  // Emit transition as thought for frontend visibility
  const icon = nodeName === 'data_analyst' ? '📊' :
               nodeName === 'coding_specialist' ? '💻' :
               nodeName === 'web_explorer' ? '🌐' : '🧭';
  // eventQueue?.push({ type: 'thought', content: `\n${icon} ${nodeName.replace(/_/g, ' ').toUpperCase()}: Initializing step...` });

  let client = runner.client;
  let clientToRelease: AIClient | null = null;
  let clientConfig: any = null;
  let verifyIntentRetries = 0;

  try {
    // 1. Initial message normalization for all subsequent steps
    let normalizedMessages = normalizeMessages(state.messages);

    // 2. Vision Grounding check - use pooled client for VLM
    const lastMsgContent = state.messages[state.messages.length - 1]?.content || '';
    const vlm = (runner as any).config.vlm;
    let updatedMessages: ChatMessage[] | null = null;

    // Only use separate VLM if main model isn't vision-native OR if a specific VLM provider is configured
    const mainProvider = runner.client.provider;
    let isVisionNative = ['openai', 'anthropic', 'gemini', 'nvidia', 'google'].includes(mainProvider);

    // If a separate VLM provider is configured that is DIFFERENT from the main provider,
    // we should prefer the VLM for grounding tasks.
    if (vlm?.model && vlm.provider !== mainProvider) {
      isVisionNative = false;
    }

    if (iterations === 0 && vlm?.model && runner.shouldCaptureScreenshot(lastMsgContent)) {
      // If native vision exists, keep main client but capture screenshot
      // If not, switch to VLM client
      if (!isVisionNative) {
        clientConfig = {
          provider: (vlm.engine === 'cloud' && vlm.provider === 'ollama' ? 'ollama-cloud' :
                     vlm.engine === 'cloud' && vlm.provider === 'everfern' ? 'everfern' :
                     vlm.provider),
          model: vlm.model,
          apiKey: vlm.apiKey,
          baseUrl: vlm.baseUrl
        };
        client = runner.getClient(clientConfig);
        clientToRelease = client;
        runner.telemetry.info(`Using VLM: ${vlm.model} (${vlm.provider})`);
      } else {
        runner.telemetry.info(`Using Native Vision: ${runner.client.model} (${mainProvider})`);
      }

      try {
        runner.telemetry.info('📸 Capturing desktop state for vision grounding...');
        const screenshotData = await captureScreen();
        if (screenshotData && screenshotData.b64) {
          const lastMsgIdx = normalizedMessages.length - 1;
          const lastMsg = normalizedMessages[lastMsgIdx];

          if (lastMsg && lastMsg.role === 'user') {
            const originalContent = typeof lastMsg.content === 'string'
              ? [{ type: 'text' as const, text: lastMsg.content }]
              : lastMsg.content;

            const newContent: ChatMessage['content'] = [
              ...originalContent,
              {
                type: 'image_url' as const,
                image_url: { url: `data:image/jpeg;base64,${screenshotData.b64}` }
              }
            ];

            // Create a copy of the normalized messages and update the last one
            updatedMessages = [...normalizedMessages];
            updatedMessages[lastMsgIdx] = { ...lastMsg, content: newContent };
            normalizedMessages = updatedMessages;
            runner.telemetry.info('✅ Screenshot attached to user message.');
          }
        }
      } catch (err) {
        runner.telemetry.warn(`Failed to capture screenshot for vision grounding: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Inject system prompt override or ensure one exists
    if (systemPromptOverride) {
      if (normalizedMessages.length > 0 && normalizedMessages[0].role === 'system') {
        normalizedMessages[0].content = systemPromptOverride;
      } else {
        // Insert new system message at the beginning
        normalizedMessages.unshift({
          role: 'system',
          content: systemPromptOverride
        });
      }
    }

    let thoughtBuffer = '';
    let isThinking = false;
    let streamedText = '';

    // 4. Enhanced context pruning for better performance
    const prunedMessages = normalizedMessages.map((m, idx) => {
      if (m.role === "user" && Array.isArray(m.content)) {
        const hasImage = m.content.some((c: any) => c.type === 'image_url');
        if (hasImage) {
          const futureImages = normalizedMessages.slice(idx + 1).filter((fm: any) =>
            Array.isArray(fm.content) && fm.content.some((fc: any) => fc.type === 'image_url')
          ).length;
          // Keep only the most recent 2 images
          if (futureImages >= 1 || idx < normalizedMessages.length - 3) {
            return {
              ...m,
              content: m.content.map((c: any) => c.type === 'image_url' ? { type: 'text', text: '[Screenshot Omitted]' } : c)
            } as ChatMessage;
          }
        }
      }
      return m;
    });

    // Limit message history for performance — only compact when total estimated tokens exceed 150k
    const COMPACT_THRESHOLD = 150000;
    const estimateTokens = (msgs: typeof prunedMessages) =>
      msgs.reduce((sum, m) => sum + Math.ceil((typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length / 4), 0);

    let limitedMessages: typeof prunedMessages;
    if (estimateTokens(prunedMessages) > COMPACT_THRESHOLD) {
      // Keep system message + first user message + last 20 messages
      const systemMsg = prunedMessages[0]?.role === 'system' ? [prunedMessages[0]] : [];
      const rest = prunedMessages.filter(m => m.role !== 'system');
      const firstUserMsg = rest[0];
      const recentMsgs = rest.slice(-20);
      const hasFirstMessage = firstUserMsg && recentMsgs.includes(firstUserMsg);

      limitedMessages = [
        ...systemMsg,
        ...(firstUserMsg && !hasFirstMessage ? [firstUserMsg] : []),
        ...recentMsgs
      ];
    } else {
      limitedMessages = prunedMessages;
    }

    const startedToolCallIndices = new Set<number>();

    const request: ChatRequest = {
      messages: limitedMessages,
      tools: toolDefs,
      onToolCallChunk: (index: number, toolName: string, argumentsDelta: string) => {
        try {
          if (!startedToolCallIndices.has(index)) {
            startedToolCallIndices.add(index);

            // Link tool call to planned mission step
            const matchingStep = state.decomposedTask?.steps.find(s => s.tool === toolName);
            const tracker = (runner as any).missionTracker;
            if (matchingStep && tracker) {
              tracker.startStep(matchingStep.id);
              // Also record tool call for this step
              const step = tracker.getStep(matchingStep.id);
              if (step) {
                const toolCalls = step.toolCalls || [];
                if (!toolCalls.includes(toolName)) {
                  tracker.updateStep(matchingStep.id, { toolCalls: [...toolCalls, toolName] });
                }
              }
            }

            eventQueue?.push({ type: 'tool_call_start', index, toolName });
          }
          eventQueue?.push({ type: 'tool_call_chunk', index, argumentsDelta });
        } catch (err) {
          console.warn('[AgentRuntime] onToolCallChunk error:', err);
        }
      },
      onStreamChunk: (chunk: string) => {
        // First chunk received - clear initialization and show thinking
        if (!streamedText && !thoughtBuffer && !isThinking) {
           isThinking = true;
        }
        console.log(`[Stream] Received chunk: "${chunk}" (buffer: ${thoughtBuffer.length} chars)`);
        thoughtBuffer += chunk;
        const hasStart = thoughtBuffer.includes('<think>') || thoughtBuffer.includes('<thought>');
        const hasEnd = thoughtBuffer.includes('</think>') || thoughtBuffer.includes('</thought>');

        if (!isThinking && hasStart) {
          isThinking = true;
          const tag = thoughtBuffer.includes('<think>') ? '<think>' : '<thought>';
          const parts = thoughtBuffer.split(tag);
          if (parts[0]) {
            console.log(`[Stream] Sending chunk before <think>: "${parts[0]}"`);
            eventQueue?.push({ type: 'chunk', content: parts[0] });
            streamedText += parts[0];
          }
          if (parts[1]) {
            console.log(`[Stream] Sending thought: "${parts[1].slice(0, 50)}..."`);
            eventQueue?.push({ type: 'thought', content: parts[1] });
          }
          thoughtBuffer = '';
        } else if (isThinking && hasEnd) {
          isThinking = false;
          const tag = thoughtBuffer.includes('</think>') ? '</think>' : '</thought>';
          const parts = thoughtBuffer.split(tag);
          if (parts[0]) {
            console.log(`[Stream] Sending thought end: "${parts[0].slice(0, 50)}..."`);
            eventQueue?.push({ type: 'thought', content: parts[0] });
          }
          if (parts[1]) {
            console.log(`[Stream] Sending chunk after </think>: "${parts[1]}"`);
            eventQueue?.push({ type: 'chunk', content: parts[1] });
            streamedText += parts[1];
          }
          thoughtBuffer = '';
        } else if (isThinking) {
          console.log(`[Stream] In thinking mode, sending as thought`);
          eventQueue?.push({ type: 'thought', content: chunk });
          thoughtBuffer = '';
        } else {
          const trimmed = thoughtBuffer.trim();
          if (!trimmed.startsWith('{') && !trimmed.startsWith('<')) {
            console.log(`[Stream] Sending regular chunk: "${thoughtBuffer}"`);
            eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
            streamedText += thoughtBuffer;
            thoughtBuffer = '';
          } else if (thoughtBuffer.length > 20) {
            console.log(`[Stream] Buffer > 20 chars, sending: "${thoughtBuffer.slice(0, 50)}..."`);
            eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
            streamedText += thoughtBuffer;
            thoughtBuffer = '';
          } else {
            console.log(`[Stream] Buffering (starts with { or <, length: ${thoughtBuffer.length})`);
          }
        }
      },
      abortSignal: globalAbortManager.abortController.signal,
    };

    let response = await client.chat(request);

    // 5. Tool Call Nudge (Specialized Agents)
    // If a specialized agent (like computer_use) fails to call a tool, nudge it once.
    const isSpecializedAgent = ['computer_use_agent', 'coding_specialist', 'data_analyst', 'web_explorer'].includes(nodeName);
    if (isSpecializedAgent && (!response.toolCalls || response.toolCalls.length === 0) && verifyIntentRetries === 0) {
        verifyIntentRetries++;
        runner.telemetry.warn(`[AgentRuntime] ${nodeName} failed to call a tool. Nudging...`);

        const agentToolHint =
          nodeName === 'web_explorer' ? `'web_search' or 'navis'` :
          nodeName === 'coding_specialist' ? `your coding tools (read_file, write_file, terminal_execute, etc.)` :
          nodeName === 'data_analyst' ? `your data analysis tools (python_executor, read_file, etc.)` :
          `'computer_use'`;

        const nudgeMsg: ChatMessage = {
          role: 'system',
          content: `SYSTEM REMINDER: You are the ${nodeName}. You are specifically designed to use your specialized tools. YOU HAVE ALL NECESSARY PERMISSIONS. Do not explain why you cannot do something. Do not talk about the task. Use ${agentToolHint} NOW to execute the next step of the plan. Output a tool call immediately.`
        };

        const nudgeMessages = [...limitedMessages, nudgeMsg];
        response = await client.chat({ ...request, messages: nudgeMessages });

        // Graceful fallback: if web_explorer nudge retry also produced no tool calls, signal completion to break the loop
        if (isSpecializedAgent && nodeName === 'web_explorer' && (!response.toolCalls || response.toolCalls.length === 0)) {
          runner.telemetry.warn(`[AgentRuntime] web_explorer nudge retry also produced no tool calls. Signaling completion to break loop.`);
          return {
            messages: [],
            pendingToolCalls: [],
            webExplorerComplete: true,
            finalResponse: 'Web research could not be completed — the agent did not produce a tool call after retry.',
            iterations: iterations + 1,
          };
        }
    }

    // Flush any remaining content in thoughtBuffer after streaming completes
    if (thoughtBuffer.trim()) {
      console.log(`[Stream] Flushing remaining buffer: "${thoughtBuffer}"`);
      eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
      streamedText += thoughtBuffer;
      thoughtBuffer = '';
    }

    console.log(`[Stream] Total streamed text length: ${streamedText.length} chars`);

    if (response.usage) {
      const usage = response.usage;
      runner.telemetry.info(`Tokens: In=${usage.promptTokens}, Out=${usage.completionTokens}`);
      eventQueue?.push({ type: 'usage', ...response.usage });
    }

    // Tool Call Parsing & Nudging
    let textContent = typeof response.content === 'string' ? response.content : '';
    if (Array.isArray(response.content)) {
      textContent = response.content.map((c: any) => 'text' in c ? c.text : '').join('\n');
    }

    const scrubbed = textContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/ig, '').trim();

    // If model didn't provide tool calls but intent requires them, parse or nudge
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const allowedInToolDefs = new Set(options.toolDefs.map((t: any) => t.name));
      const filteredTools = ((runner as any).tools || []).filter((t: any) => allowedInToolDefs.has(t.name));
      const parserResult = parseTextToToolCalls(textContent, filteredTools);
      if (parserResult.toolCalls.length > 0) {
        response.toolCalls = parserResult.toolCalls;
        response.finishReason = 'tool_calls';
      }
    }

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: scrubbed,
      tool_calls: response.toolCalls,
      reasoning_content: response.reasoning_content,
    };

    // Validate tool calls against allowed toolDefs — strip hallucinated tools
    const validatedToolCalls = (response.toolCalls ?? []).filter((tc: any) =>
      options.toolDefs.some((td: any) => td.name === tc.name)
    );
    if (validatedToolCalls.length !== (response.toolCalls?.length ?? 0)) {
      console.warn(`[AgentRuntime] Filtered ${(response.toolCalls?.length ?? 0) - validatedToolCalls.length} hallucinated tool call(s)`);
    }
    if (validatedToolCalls.length === 0) {
      response.finishReason = 'stop';
    }

    assistantMsg.content = scrubbed;

    // Always send the final response to frontend if it's not a tool call
    if (response.finishReason !== 'tool_calls' && scrubbed) {
      const needsFinalChunk = !streamedText || streamedText.trim() !== scrubbed.trim();
      if (needsFinalChunk) {
        eventQueue?.push({ type: 'chunk', content: scrubbed });
      }
    }

    return {
      messages: [assistantMsg as any],
      pendingToolCalls: validatedToolCalls,
      iterations: iterations + 1,
      finalResponse: response.finishReason !== 'tool_calls' ? scrubbed : '',
    };
  } finally {
    // Release pooled client if we used one
    if (clientToRelease && clientConfig) {
      runner.releaseClient(clientToRelease, clientConfig);
    }
  }
}
