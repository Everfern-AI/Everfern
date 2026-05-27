"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCallModelNode = void 0;
const crypto = __importStar(require("crypto"));
const messages_1 = require("@langchain/core/messages");
const ai_client_1 = require("../../../lib/ai-client");
const text_to_tool_1 = require("../../parsers/text-to-tool");
const mission_integrator_1 = require("../mission-integrator");
const message_utils_1 = require("../services/message-utils");
const computer_use_1 = require("../../tools/computer-use");
/**
 * AI-based prompt slimming decision
 * Replaces keyword-based intent checking with semantic analysis
 */
async function shouldUseSlimmedPrompt(intent, messages, client) {
    if (!client) {
        // Fallback: use keyword-based check
        return intent === 'conversation' || intent === 'question';
    }
    // Quick check: only slim if system prompt exists and contains EverFern
    if (messages.length === 0 || messages[0].role !== 'system')
        return false;
    const systemPrompt = messages[0].content;
    if (!systemPrompt.includes('EverFern System Prompt'))
        return false;
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
    }
    catch (err) {
        console.warn('[CallModel] AI prompt slimming decision failed:', err);
        return intent === 'conversation' || intent === 'question';
    }
}
/**
 * AI-based model nudging decision
 * Replaces regex pattern matching with semantic analysis
 */
async function shouldNudgeModel(parseError, intent, textContent, client) {
    // Always nudge on parse errors
    if (parseError)
        return true;
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
    }
    catch (err) {
        console.warn('[CallModel] AI nudge decision failed:', err);
        return false;
    }
}
const createCallModelNode = (runner, toolDefs, eventQueue, maxIterations = 10, maxVerifyRetries = 3, missionTracker, shouldAbort) => {
    let verifyIntentRetries = 0;
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        // Check for abort signal
        if (shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        integrator.startNode('call_model', 'Calling AI model');
        try {
            runner.telemetry.transition('call_model');
            runner.telemetry.metrics(state.iterations);
            const iterations = state.iterations;
            let client = runner.client;
            let modelUsed = client.model;
            // Telemetry Update
            runner.telemetry.metrics(iterations);
            let thoughtBuffer = '';
            let isThinking = false;
            let streamedText = '';
            // Optima: Context Pruning & Normalization with enhanced performance
            let normalizedMessages = (0, message_utils_1.normalizeMessages)(state.messages);
            // ── Vision Grounding ───────────────────────────────────────────────────
            const vlm = runner.config.vlm;
            const lastMsgContent = state.messages[state.messages.length - 1]?.content || '';
            const needsVisionGrounding = iterations === 0 &&
                vlm?.model &&
                vlm?.provider &&
                runner.shouldCaptureScreenshot(lastMsgContent);
            let updatedMessages = null;
            if (needsVisionGrounding && vlm) {
                runner.telemetry.info(` telescope Vision Grounding: Analyzing workspace footprint with ${vlm.model} (${vlm.provider})`);
                client = new ai_client_1.AIClient({
                    provider: (vlm.engine === 'cloud' && vlm.provider === 'ollama' ? 'ollama-cloud' :
                        vlm.engine === 'cloud' && vlm.provider === 'everfern' ? 'everfern' :
                            vlm.provider),
                    apiKey: vlm.apiKey,
                    model: vlm.model,
                    baseUrl: vlm.baseUrl
                });
                modelUsed = vlm.model;
                try {
                    runner.telemetry.info(' camera Capturing desktop state for vision grounding...');
                    const screenshotData = await (0, computer_use_1.captureScreen)();
                    if (screenshotData && screenshotData.b64) {
                        const lastMsgIdx = normalizedMessages.length - 1;
                        const lastMsg = normalizedMessages[lastMsgIdx];
                        if (lastMsg && lastMsg.role === 'user') {
                            const originalContent = typeof lastMsg.content === 'string'
                                ? [{ type: 'text', text: lastMsg.content }]
                                : lastMsg.content;
                            const newContent = [
                                ...originalContent,
                                {
                                    type: 'image_url',
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
                }
                catch (err) {
                    runner.telemetry.warn(`Failed to capture screenshot for vision grounding: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            // Get current intent for AI-based decisions
            const currentIntent = state.currentIntent || 'unknown';
            // Use AI to determine if system prompt slimming is appropriate
            const shouldSlimPrompt = await shouldUseSlimmedPrompt(currentIntent, normalizedMessages, client);
            if (shouldSlimPrompt && normalizedMessages.length > 0 && normalizedMessages[0].role === 'system') {
                const originalPrompt = normalizedMessages[0].content;
                normalizedMessages[0].content = `You are EverFern, a helpful and concise AI assistant.
Keep your responses friendly and direct.
The user is engaging in a simple conversation or asking a direct question.
You do not need to use complex execution plans or tools for this interaction.`;
                runner.telemetry.info('Optima: Using slimmed system prompt for read-only intent.');
            }
            // Enhanced message pruning with better image handling
            const prunedMessages = normalizedMessages.map((m, idx) => {
                if (m.role === "user") {
                    if (typeof m.content === 'string')
                        return m;
                    const hasImage = Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url');
                    if (!hasImage)
                        return m;
                    // More aggressive image pruning for performance
                    const futureImages = normalizedMessages.slice(idx + 1).filter((fm) => Array.isArray(fm.content) && fm.content.some((fc) => fc.type === 'image_url')).length;
                    // Keep only the most recent 2 images to save tokens
                    if (futureImages >= 1 || idx < normalizedMessages.length - 3) {
                        return {
                            ...m,
                            content: m.content.map((c) => c.type === 'image_url' ? { type: 'text', text: '[Screenshot Omitted to Save Tokens]' } : c)
                        };
                    }
                }
                return m;
            });
            // Limit message history for performance (keep last 20 messages)
            const maxMessages = 20;
            const limitedMessages = prunedMessages.length > maxMessages
                ? [prunedMessages[0], ...prunedMessages.slice(-maxMessages + 1)] // Keep system prompt + last N messages
                : prunedMessages;
            const request = {
                messages: limitedMessages,
                tools: toolDefs,
                onStreamChunk: (chunk) => {
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
                        if (parts[1])
                            eventQueue?.push({ type: 'thought', content: parts[1] });
                        thoughtBuffer = '';
                    }
                    else if (isThinking && hasEnd) {
                        isThinking = false;
                        const tag = thoughtBuffer.includes('</think>') ? '</think>' : '</thought>';
                        const parts = thoughtBuffer.split(tag);
                        if (parts[0])
                            eventQueue?.push({ type: 'thought', content: parts[0] });
                        if (parts[1]) {
                            eventQueue?.push({ type: 'chunk', content: parts[1] });
                            streamedText += parts[1];
                        }
                        thoughtBuffer = '';
                    }
                    else if (isThinking) {
                        eventQueue?.push({ type: 'thought', content: chunk });
                        thoughtBuffer = '';
                    }
                    else {
                        const trimmed = thoughtBuffer.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('<')) {
                            if (thoughtBuffer.length > 20) {
                                eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
                                streamedText += thoughtBuffer;
                                thoughtBuffer = '';
                            }
                        }
                        else {
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
                runner.telemetry.info(`Model resonance confirmed | Tokens: In=${usage.promptTokens}, Out=${usage.completionTokens}`);
                runner.telemetry.metrics(iterations, usage.totalTokens);
                eventQueue?.push({
                    type: 'usage',
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                });
            }
            if (!response.toolCalls || response.toolCalls.length === 0) {
                let textContent = typeof response.content === 'string'
                    ? response.content
                    : Array.isArray(response.content)
                        ? response.content.map((c) => 'text' in c ? c.text : '').join('\n')
                        : '';
                const allowedInToolDefs = new Set(toolDefs.map((t) => t.name));
                const filteredTools = (runner.tools || []).filter((t) => allowedInToolDefs.has(t.name));
                const parserResult = (0, text_to_tool_1.parseTextToToolCalls)(textContent, filteredTools);
                if (parserResult.toolCalls.length > 0) {
                    response.toolCalls = parserResult.toolCalls;
                    response.content = parserResult.scrubbedContent;
                    response.finishReason = 'tool_calls';
                }
                else {
                    // Use AI to determine if we should nudge the model
                    const shouldNudge = await shouldNudgeModel(parserResult.parseError, currentIntent, textContent, client);
                    if (shouldNudge && verifyIntentRetries < maxVerifyRetries) {
                        verifyIntentRetries++;
                        let message = `SYSTEM REMINDER: You did not format your tool call correctly or failed to call a tool. If you are completing a task, you MUST use a tool (write, run_command, edit, etc).`;
                        if (parserResult.parseError) {
                            message = `SYSTEM REMINDER: Your tool call failed to parse. ${parserResult.parseError}. Please output valid JSON.`;
                        }
                        else {
                            message = `SYSTEM REMINDER: You said you'd "${textContent.substring(0, 50).trim()}..." — DO IT NOW. Ensure your tool call is valid JSON or correctly formatted.`;
                        }
                        state.messages.push({ role: 'system', content: message });
                        response.toolCalls = [{
                                id: 'call_nudge_' + crypto.randomUUID().substring(0, 8),
                                name: 'system_verify_intent',
                                arguments: { _context: { intent: currentIntent, phase: state.taskPhase, error: parserResult.parseError } }
                            }];
                        response.finishReason = 'tool_calls';
                    }
                    else if (verifyIntentRetries >= maxVerifyRetries) {
                        verifyIntentRetries = 0;
                    }
                }
            }
            let rawContent = response.content || '';
            let textContent = typeof rawContent === 'string'
                ? rawContent
                : rawContent.map((c) => 'text' in c ? c.text : '').join('\n');
            const scrubbed = textContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/ig, '').trim();
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
                    });
                    response.toolCalls = [{
                            id: 'call_nudge_' + crypto.randomUUID().substring(0, 8),
                            name: 'system_verify_intent',
                            arguments: {}
                        }];
                    response.finishReason = 'tool_calls';
                }
                else {
                    return {
                        messages: [new messages_1.AIMessage({
                                content: 'I apologize, but I encountered an issue processing your request. The model did not respond properly. Please try again.',
                            })],
                        pendingToolCalls: [],
                        iterations,
                        finalResponse: 'Error: Model returned empty response multiple times.'
                    };
                }
            }
            const assistantMsg = {
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
            const validatedToolCalls = (response.toolCalls ?? []).filter((tc) => toolDefs.some((td) => td.name === tc.name));
            if (validatedToolCalls.length !== (response.toolCalls?.length ?? 0)) {
                console.warn(`[CallModel] Filtered ${(response.toolCalls?.length ?? 0) - validatedToolCalls.length} hallucinated tool call(s)`);
            }
            if (validatedToolCalls.length === 0) {
                response.finishReason = 'stop';
            }
            const result = {
                messages: [assistantMsg],
                pendingToolCalls: validatedToolCalls,
                iterations,
                finalResponse: response.finishReason !== 'tool_calls' ? scrubbed : '',
            };
            integrator.completeNode('call_model', 'Model call completed');
            return result;
        }
        catch (error) {
            integrator.failNode('call_model', error instanceof Error ? error.message : String(error));
            throw error;
        }
    };
};
exports.createCallModelNode = createCallModelNode;
