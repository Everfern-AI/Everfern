import * as crypto from 'crypto';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { AIClient, ChatMessage, ChatRequest, ToolDefinition } from '../../../lib/ai-client';
import { GraphStateType, StreamEvent } from '../state';
import { parseTextToToolCalls } from '../../parsers/text-to-tool';
import { AgentRunner } from '../runner';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';

import { normalizeMessages } from '../services/message-utils';
import { captureScreen } from '../../tools/computer-use';

/**
 * AI-based prompt slimming decision
 * Replaces keyword-based intent checking with semantic analysis
 */
async function shouldUseSlimmedPrompt(
  intent: string,
  messages: ChatMessage[],
  client?: AIClient
): Promise<boolean> {
  if (!client) {
    // Fallback: use keyword-based check
    return intent === 'conversation' || intent === 'question';
  }

  // Quick check: only slim if system prompt exists and contains EverFern
  if (messages.length === 0 || messages[0].role !== 'system') return false;
  const systemPrompt = messages[0].content as string;
  if (!systemPrompt.includes('EverFern System Prompt')) return false;

  try {
    const prompt = `Determine if this conversation intent warrants a slimmed-down system prompt (for simple conversations/questions vs complex tasks).

Intent: "${intent}"

Slim prompt appropriate for:
- Simple conversations and greetings
- Direct factual questions
- Casual interactions

Full prompt needed for:
- Coding tasks
- Complex problem-solving
- Multi-step operations
- File/system modifications

Respond with JSON:
{
  "shouldSlim": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

    const response = await client.chat({
      messages: [{ role: 'user', content: prompt }],
      responseFormat: 'json',
      temperature: 0.1,
      maxTokens: 150
    });

    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    // Remove markdown code blocks if present
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const analysis = JSON.parse(content);

    return analysis.shouldSlim && analysis.confidence > 0.7;
  } catch (err) {
    console.warn('[CallModel] AI prompt slimming decision failed:', err);
    return intent === 'conversation' || intent === 'question';
  }
}

/**
 * Generates a semantic summary of older/dropped messages to conserve context window
 */
async function generateSemanticSummary(
  droppedMessages: ChatMessage[],
  client?: AIClient
): Promise<string> {
  if (!client || droppedMessages.length === 0) return '';
  
  try {
    const serialized = droppedMessages.map(m => {
      const role = m.role;
      let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (m.tool_calls) {
        content += `\n[Tool Calls: ${JSON.stringify(m.tool_calls)}]`;
      }
      return `${role.toUpperCase()}: ${content.substring(0, 400)}`;
    }).join('\n---\n');

    const prompt = `Summarize the following historical execution turns of an AI software development agent into a high-density, concise bulleted list of facts, files created/edited, commands run, and current state. Do not include introductory text, just return the bulleted list.
    
Execution turns:
${serialized}

Format:
- [File Action] Created/Edited src/path/file.ts
- [Command Action] Executed npm run test (Passed/Failed)
- [Context] State details...`;

    const response = await client.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 300
    });

    return typeof response.content === 'string' ? response.content.trim() : '';
  } catch (err) {
    console.warn('[CallModel] generateSemanticSummary error:', err);
    return '';
  }
}


/**
 * AI-based model nudging decision
 * Replaces regex pattern matching with semantic analysis
 */
async function shouldNudgeModel(
  parseError: string | undefined,
  intent: string,
  textContent: string,
  client?: AIClient
): Promise<boolean> {
  // Always nudge on parse errors
  if (parseError) return true;

  if (!client) {
    // Fallback: conservative approach - don't nudge
    return false;
  }

  try {
    const prompt = `Analyze this AI assistant response and determine if it's narrating an action instead of executing it.

Intent: "${intent}"
Response: "${textContent.substring(0, 300)}"

The assistant should USE TOOLS to execute actions, not just describe them.

Narrating actions (BAD - needs nudge):
- "I'll create a file..."
- "Let me write some code..."
- "I'm going to run a command..."
- "Proceeding to build..."

Executing actions (GOOD - no nudge):
- Actually calling tools
- Providing direct answers
- Asking clarifying questions

Respond with JSON:
{
  "isNarrating": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

    const response = await client.chat({
      messages: [{ role: 'user', content: prompt }],
      responseFormat: 'json',
      temperature: 0.1,
      maxTokens: 200
    });

    let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    // Remove markdown code blocks if present
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const analysis = JSON.parse(content);

    return analysis.isNarrating && analysis.confidence > 0.7;
  } catch (err) {
    console.warn('[CallModel] AI nudge decision failed:', err);
    return false;
  }
}

export const createCallModelNode = (
  runner: AgentRunner,
  toolDefs: ToolDefinition[],
  eventQueue?: StreamEvent[],
  maxIterations: number = 10,
  maxVerifyRetries: number = 3,
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean
) => {
  let verifyIntentRetries = 0;
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    // Check for abort signal
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    integrator.startNode('call_model', 'Calling AI model');
    try {
      runner.telemetry.transition('call_model');
    runner.telemetry.metrics(state.iterations);

    const iterations = state.iterations;
    let client = (runner as any).client;
    let modelUsed = client.model;

    // Telemetry Update
    runner.telemetry.metrics(iterations);

    let thoughtBuffer = '';
    let isThinking = false;
    let streamedText = '';

    // Optima: Context Pruning & Normalization with enhanced performance
    let normalizedMessages = normalizeMessages(state.messages);

    // ── Vision Grounding ───────────────────────────────────────────────────
    const vlm = (runner as any).config.vlm;
    const lastMsgContent = state.messages[state.messages.length - 1]?.content || '';
    const shouldUseDesktopVision =
      state.currentIntent !== 'research' &&
      (runner as any).shouldCaptureScreenshot(lastMsgContent);

    const needsVisionGrounding = iterations === 0 &&
      vlm?.model &&
      vlm?.provider &&
      shouldUseDesktopVision;

    let updatedMessages: ChatMessage[] | null = null;
    if (needsVisionGrounding && vlm) {
      runner.telemetry.info(` telescope Vision Grounding: Analyzing workspace footprint with ${vlm.model} (${vlm.provider})`);
      client = new AIClient({
        provider: (vlm.engine === 'cloud' && vlm.provider === 'ollama' ? 'ollama-cloud' :
                   vlm.engine === 'cloud' && vlm.provider === 'everfern' ? 'everfern' :
                   vlm.provider) as any,
        apiKey: vlm.apiKey,
        model: vlm.model,
        baseUrl: vlm.baseUrl
      });
      modelUsed = vlm.model;

      try {
        runner.telemetry.info(' camera Capturing desktop state for vision grounding...');
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
            runner.telemetry.info(' check_mark Screenshot attached to user message.');
          }
        }
      } catch (err) {
        runner.telemetry.warn(`Failed to capture screenshot for vision grounding: ${err instanceof Error ? err.message : String(err)}`);
      }
    }


    // Get current intent for AI-based decisions
    const currentIntent = state.currentIntent || 'unknown';

    // Use AI to determine if system prompt slimming is appropriate
    const shouldSlimPrompt = await shouldUseSlimmedPrompt(currentIntent, normalizedMessages, client);

    if (shouldSlimPrompt && normalizedMessages.length > 0 && normalizedMessages[0].role === 'system') {
      const originalPrompt = normalizedMessages[0].content as string;
      normalizedMessages[0].content = `You are EverFern, a helpful and concise AI assistant.
Keep your responses friendly and direct.
The user is engaging in a simple conversation or asking a direct question.
You do not need to use complex execution plans or tools for this interaction.`;
      
      runner.telemetry.info('Optima: Using slimmed system prompt for read-only intent.');
    }

    // Enhanced message pruning with tool result truncation and image handling
    const prunedMessages = normalizedMessages.map((m, idx) => {
      const isRecent = idx >= normalizedMessages.length - 4;

      // 1. Tool result truncation for older messages to prevent quadratic context bloat
      if (!isRecent && m.role === 'tool' && typeof m.content === 'string' && m.content.length > 1000) {
        const originalLength = m.content.length;
        const truncatedContent = m.content.substring(0, 400) + 
          `\n\n... [Tool Output Truncated: ${originalLength - 800} characters omitted to save tokens] ...\n\n` + 
          m.content.substring(originalLength - 400);
        return {
          ...m,
          content: truncatedContent
        };
      }

      // 2. Strip historical thinking/reasoning blocks from older assistant messages to save tokens
      if (!isRecent && m.role === 'assistant' && typeof m.content === 'string') {
        if (m.content.includes('<think>') || m.content.includes('<thought>')) {
          const strippedContent = m.content
            .replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, '')
            .trim();
          return {
            ...m,
            content: strippedContent
          };
        }
      }

      // 3. Prune large arguments in tool_calls of older assistant messages to save tokens
      if (!isRecent && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const prunedToolCalls = m.tool_calls.map((tc: any) => {
          if (!tc || typeof tc !== 'object') return tc;
          const newTc = JSON.parse(JSON.stringify(tc));
          if (newTc.function && newTc.function.arguments) {
            let args = newTc.function.arguments;
            let isJsonString = typeof args === 'string';
            if (isJsonString) {
              try { args = JSON.parse(args); } catch (e) {}
            }
            if (args && typeof args === 'object') {
              let modified = false;
              for (const key of Object.keys(args)) {
                if (typeof args[key] === 'string' && args[key].length > 1000) {
                  const originalLen = args[key].length;
                  args[key] = `[Argument Truncated: ${originalLen} characters omitted to save tokens]`;
                  modified = true;
                }
              }
              if (modified) {
                newTc.function.arguments = isJsonString ? JSON.stringify(args) : args;
              }
            }
          }
          return newTc;
        });
        return {
          ...m,
          tool_calls: prunedToolCalls
        };
      }

      // 4. Image pruning for user messages
      if (m.role === "user") {
        if (typeof m.content === 'string') return m;
        const hasImage = Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url');
        if (!hasImage) return m;

        // More aggressive image pruning for performance
        const futureImages = normalizedMessages.slice(idx + 1).filter((fm: any) =>
          Array.isArray(fm.content) && fm.content.some((fc: any) => fc.type === 'image_url')
        ).length;

        // Keep only the most recent 2 images to save tokens
        if (futureImages >= 1 || idx < normalizedMessages.length - 3) {
          return {
            ...m,
            content: m.content.map((c: any) => c.type === 'image_url' ? { type: 'text', text: '[Screenshot Omitted to Save Tokens]' } : c)
          } as ChatMessage;
        }
      }
      return m;
    });

    // Limit message history for performance (keep last 20 messages) and compress context
    const maxMessages = 20;
    let limitedMessages = prunedMessages;
    if (prunedMessages.length > maxMessages) {
      const systemPromptMsg = prunedMessages[0];
      const droppedMessages = prunedMessages.slice(1, -maxMessages + 1);
      const remainingMessages = prunedMessages.slice(-maxMessages + 1);
      
      let summaryText = '';
      try {
        runner.telemetry.info(`Optima: Compressing ${droppedMessages.length} older historical turns into semantic summary...`);
        summaryText = await generateSemanticSummary(droppedMessages, client);
      } catch (err) {
        console.warn('[CallModel] Failed to generate semantic summary:', err);
      }
      
      if (summaryText) {
        const memorySummaryMsg: ChatMessage = {
          role: 'system',
          content: `## Compressed Session Memory (Historical Context Summary)\nBelow is a summary of the actions and changes made in earlier steps of this session:\n${summaryText}\n`
        };
        limitedMessages = [systemPromptMsg, memorySummaryMsg, ...remainingMessages];
      } else {
        limitedMessages = [systemPromptMsg, ...remainingMessages];
      }
    }

    const request: ChatRequest = {
      messages: limitedMessages,
      tools: toolDefs,
      onStreamChunk: (chunk: string) => {
        thoughtBuffer += chunk;
        const hasStart = thoughtBuffer.includes('<think>') || thoughtBuffer.includes('<thought>');
        const hasEnd = thoughtBuffer.includes('</think>') || thoughtBuffer.includes('</thought>');

        if (!isThinking && hasStart) {
          isThinking = true;
          const tag = thoughtBuffer.includes('<think>') ? '<think>' : '<thought>';
          const parts = thoughtBuffer.split(tag);
          if (parts[0]) {
            eventQueue?.push({ type: 'chunk', content: parts[0] });
            streamedText += parts[0];
          }
          if (parts[1]) eventQueue?.push({ type: 'thought', content: parts[1] });
          thoughtBuffer = '';
        } else if (isThinking && hasEnd) {
          isThinking = false;
          const tag = thoughtBuffer.includes('</think>') ? '</think>' : '</thought>';
          const parts = thoughtBuffer.split(tag);
          if (parts[0]) eventQueue?.push({ type: 'thought', content: parts[0] });
          if (parts[1]) {
            eventQueue?.push({ type: 'chunk', content: parts[1] });
            streamedText += parts[1];
          }
          thoughtBuffer = '';
        } else if (isThinking) {
          eventQueue?.push({ type: 'thought', content: chunk });
          thoughtBuffer = '';
        } else {
          const trimmed = thoughtBuffer.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('<')) {
            if (thoughtBuffer.length > 20) {
               eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
               streamedText += thoughtBuffer;
               thoughtBuffer = '';
            }
          } else {
            eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
            streamedText += thoughtBuffer;
            thoughtBuffer = '';
          }
        }
      },
      userConfirmation: state.userConfirmation,
    };

    const response = await client.chat(request);

    if (response.usage) {
      const usage = response.usage;
      
      const systemMsg = normalizedMessages.find(m => m.role === 'system');
      const systemPromptTokens = systemMsg && typeof systemMsg.content === 'string' ? Math.ceil(systemMsg.content.length / 4) : 0;
      
      runner.telemetry.info(`Model resonance confirmed | Tokens: In=${usage.promptTokens}, Out=${usage.completionTokens}, System=${systemPromptTokens}`);
      runner.telemetry.metrics(iterations, usage.totalTokens);
      const tr = (runner as any).lastTruncationDetails;
      const toolSchemaTokens = tr?.toolSchemaTokens ?? undefined;
      const truncatedTools = tr?.truncatedTools ?? undefined;
      const schemaTokenSavings = tr?.schemaTokenSavings ?? undefined;
      const outputTokens = usage.completionTokens ?? undefined;

      eventQueue?.push({
        type: 'usage',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        outputTokens,
        toolSchemaTokens,
        truncatedTools,
        schemaTokenSavings,
        promptTokensCost: usage.promptTokensCost,
        completionTokensCost: usage.completionTokensCost,
        imageInputCost: usage.imageInputCost,
        imageOutputCost: usage.imageOutputCost,
        totalCost: usage.totalCost,
        systemPromptTokens,
      });

      // Record into analytics DB (fire-and-forget — never block the agent)
      try {
        const { recordUsage } = await import('../../../store/analytics');
        const cfg = (runner as any).config;
        const convId: string | undefined = (state as any).conversationId ?? undefined;
        recordUsage({
          conversationId: convId,
          model: modelUsed ?? cfg?.model ?? 'unknown',
          provider: cfg?.provider ?? cfg?.engine ?? 'unknown',
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          promptTokensCost: usage.promptTokensCost,
          completionTokensCost: usage.completionTokensCost,
          imageInputCost: usage.imageInputCost,
          imageOutputCost: usage.imageOutputCost,
          totalCost: usage.totalCost,
        }).catch(() => { /* never throw */ });
      } catch { /* analytics never blocks execution */ }
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      let textContent = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c: any) => 'text' in c ? c.text : '').join('\n')
          : '';

      const allowedInToolDefs = new Set(toolDefs.map((t: any) => t.name));
      const filteredTools = ((runner as any).tools || []).filter((t: any) => allowedInToolDefs.has(t.name));
      const parserResult = parseTextToToolCalls(textContent, filteredTools);
      if (parserResult.toolCalls.length > 0) {
        response.toolCalls = parserResult.toolCalls;
        response.content = parserResult.scrubbedContent;
        response.finishReason = 'tool_calls';
      } else {
        // Use AI to determine if we should nudge the model
        const shouldNudge = await shouldNudgeModel(
          parserResult.parseError,
          currentIntent,
          textContent,
          client
        );

        if (shouldNudge && verifyIntentRetries < maxVerifyRetries) {
          verifyIntentRetries++;
          let message = `SYSTEM REMINDER: You did not format your tool call correctly or failed to call a tool. If you are completing a task, you MUST use a tool (write, run_command, edit, etc).`;
          if (parserResult.parseError) {
              message = `SYSTEM REMINDER: Your tool call failed to parse. ${parserResult.parseError}. Please output valid JSON.`;
          } else {
              message = `SYSTEM REMINDER: You said you'd "${textContent.substring(0, 50).trim()}..." — DO IT NOW. Ensure your tool call is valid JSON or correctly formatted.`;
          }
          state.messages.push({ role: 'system', content: message } as any);
          response.toolCalls = [{
            id: 'call_nudge_' + crypto.randomUUID().substring(0, 8),
            name: 'system_verify_intent',
            arguments: { _context: { intent: currentIntent, phase: state.taskPhase, error: parserResult.parseError } }
          }];
          response.finishReason = 'tool_calls';
        } else if (verifyIntentRetries >= maxVerifyRetries) {
          verifyIntentRetries = 0;
        }
      }
    }

    let rawContent = response.content || '';
    let textContent = typeof rawContent === 'string'
      ? rawContent
      : rawContent.map((c: any) => 'text' in c ? c.text : '').join('\n');

    let scrubbed = textContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/ig, '').trim();
    // Also remove unclosed <think> or <thought> tags at the end of the string
    scrubbed = scrubbed.replace(/<(?:think|thought)>[\s\S]*$/i, '').trim();

    if (scrubbed) {
        const preview = scrubbed.length > 80 ? scrubbed.substring(0, 80) + '...' : scrubbed;
        runner.telemetry.info(`Model output: "${preview}"`);
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
        runner.telemetry.info(`Detected ${response.toolCalls.length} actionable tool definitions.`);
    }

    if (scrubbed.length === 0 && (!response.toolCalls || response.toolCalls.length === 0)) {
      if (verifyIntentRetries < maxVerifyRetries) {
        verifyIntentRetries++;
        state.messages.push({
          role: 'system',
          content: 'SYSTEM CONTINUE: You returned an empty response. You MUST proceed with the next step of your task. Call a tool (write, run_command, etc.) to continue.'
        } as any);
        response.toolCalls = [{
          id: 'call_nudge_' + crypto.randomUUID().substring(0, 8),
          name: 'system_verify_intent',
          arguments: {}
        }];
        response.finishReason = 'tool_calls';
      } else {
        return {
          messages: [new AIMessage({
            content: 'I apologize, but I encountered an issue processing your request. The model did not respond properly. Please try again.',
          })],
          pendingToolCalls: [],
          iterations,
          finalResponse: 'Error: Model returned empty response multiple times.'
        };
      }
    }

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: scrubbed,
      tool_calls: response.toolCalls,
      reasoning_content: response.reasoning_content,
    };

    // ONLY push scrubbed content if nothing was streamed (prevents duplicates)
    if (response.finishReason !== 'tool_calls' && scrubbed && !streamedText) {
      eventQueue?.push({ type: 'chunk', content: scrubbed });
    }

    // Validate tool calls against allowed toolDefs — strip hallucinated tools
    const validatedToolCalls = (response.toolCalls ?? []).filter((tc: any) =>
      toolDefs.some((td: any) => td.name === tc.name)
    );
    if (validatedToolCalls.length !== (response.toolCalls?.length ?? 0)) {
      console.warn(`[CallModel] Filtered ${(response.toolCalls?.length ?? 0) - validatedToolCalls.length} hallucinated tool call(s)`);
    }
    if (validatedToolCalls.length === 0) {
      response.finishReason = 'stop';
    }

    const result = {
      messages: [assistantMsg as any],
      pendingToolCalls: validatedToolCalls,
      iterations,
      finalResponse: response.finishReason !== 'tool_calls' ? scrubbed : '',
    };
    integrator.completeNode('call_model', 'Model call completed');
    return result;
    } catch (error) {
      integrator.failNode('call_model', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
};
