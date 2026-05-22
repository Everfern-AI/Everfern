"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentStep = runAgentStep;
const text_to_tool_1 = require("../../parsers/text-to-tool");
const message_utils_1 = require("./message-utils");
const computer_use_1 = require("../../tools/computer-use");
const abort_manager_1 = require("../abort-manager");
/**
 * Reusable agent execution logic for calling the model and processing its response.
 * Uses pooled AI clients for better performance and connection reuse.
 */
async function runAgentStep(state, options) {
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
    let clientToRelease = null;
    let clientConfig = null;
    let verifyIntentRetries = 0;
    try {
        // 1. Initial message normalization for all subsequent steps
        let normalizedMessages = (0, message_utils_1.normalizeMessages)(state.messages);
        // 2. Vision Grounding check - use pooled client for VLM
        const lastMsgContent = state.messages[state.messages.length - 1]?.content || '';
        const vlm = runner.config.vlm;
        let updatedMessages = null;
        // Only use separate VLM if main model isn't vision-native
        const mainProvider = runner.client.provider;
        const isVisionNative = ['openai', 'anthropic', 'gemini', 'nvidia', 'google'].includes(mainProvider);
        if (iterations === 0 && vlm?.model && runner.shouldCaptureScreenshot(lastMsgContent)) {
            // If native vision exists, keep main client but capture screenshot
            // If not, switch to VLM client
            if (!isVisionNative) {
                clientConfig = {
                    provider: (vlm.engine === 'cloud' && vlm.provider === 'ollama' ? 'ollama-cloud' : vlm.provider),
                    model: vlm.model,
                    apiKey: vlm.apiKey,
                    baseUrl: vlm.baseUrl
                };
                client = runner.getClient(clientConfig);
                clientToRelease = client;
                runner.telemetry.info(`Using VLM: ${vlm.model} (${vlm.provider})`);
            }
            else {
                runner.telemetry.info(`Using Native Vision: ${runner.client.model} (${mainProvider})`);
            }
            try {
                runner.telemetry.info('📸 Capturing desktop state for vision grounding...');
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
                        runner.telemetry.info('✅ Screenshot attached to user message.');
                    }
                }
            }
            catch (err) {
                runner.telemetry.warn(`Failed to capture screenshot for vision grounding: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // 3. Inject system prompt override or ensure one exists
        if (systemPromptOverride) {
            if (normalizedMessages.length > 0 && normalizedMessages[0].role === 'system') {
                normalizedMessages[0].content = systemPromptOverride;
            }
            else {
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
                const hasImage = m.content.some((c) => c.type === 'image_url');
                if (hasImage) {
                    const futureImages = normalizedMessages.slice(idx + 1).filter((fm) => Array.isArray(fm.content) && fm.content.some((fc) => fc.type === 'image_url')).length;
                    // Keep only the most recent 2 images
                    if (futureImages >= 1 || idx < normalizedMessages.length - 3) {
                        return {
                            ...m,
                            content: m.content.map((c) => c.type === 'image_url' ? { type: 'text', text: '[Screenshot Omitted]' } : c)
                        };
                    }
                }
            }
            return m;
        });
        // Limit message history for performance — only compact when total estimated tokens exceed 150k
        const COMPACT_THRESHOLD = 150000;
        const estimateTokens = (msgs) => msgs.reduce((sum, m) => sum + Math.ceil((typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length / 4), 0);
        let limitedMessages;
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
        }
        else {
            limitedMessages = prunedMessages;
        }
        const startedToolCallIndices = new Set();
        const request = {
            messages: limitedMessages,
            tools: toolDefs,
            onToolCallChunk: (index, toolName, argumentsDelta) => {
                try {
                    if (!startedToolCallIndices.has(index)) {
                        startedToolCallIndices.add(index);
                        // Link tool call to planned mission step
                        const matchingStep = state.decomposedTask?.steps.find(s => s.tool === toolName);
                        const tracker = runner.missionTracker;
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
                }
                catch (err) {
                    console.warn('[AgentRuntime] onToolCallChunk error:', err);
                }
            },
            onStreamChunk: (chunk) => {
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
                }
                else if (isThinking && hasEnd) {
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
                }
                else if (isThinking) {
                    console.log(`[Stream] In thinking mode, sending as thought`);
                    eventQueue?.push({ type: 'thought', content: chunk });
                    thoughtBuffer = '';
                }
                else {
                    const trimmed = thoughtBuffer.trim();
                    if (!trimmed.startsWith('{') && !trimmed.startsWith('<')) {
                        console.log(`[Stream] Sending regular chunk: "${thoughtBuffer}"`);
                        eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
                        streamedText += thoughtBuffer;
                        thoughtBuffer = '';
                    }
                    else if (thoughtBuffer.length > 20) {
                        console.log(`[Stream] Buffer > 20 chars, sending: "${thoughtBuffer.slice(0, 50)}..."`);
                        eventQueue?.push({ type: 'chunk', content: thoughtBuffer });
                        streamedText += thoughtBuffer;
                        thoughtBuffer = '';
                    }
                    else {
                        console.log(`[Stream] Buffering (starts with { or <, length: ${thoughtBuffer.length})`);
                    }
                }
            },
            abortSignal: abort_manager_1.globalAbortManager.abortController.signal,
        };
        let response = await client.chat(request);
        // 5. Tool Call Nudge (Specialized Agents)
        // If a specialized agent (like computer_use) fails to call a tool, nudge it once.
        const isSpecializedAgent = ['computer_use_agent', 'coding_specialist', 'data_analyst', 'web_explorer'].includes(nodeName);
        if (isSpecializedAgent && (!response.toolCalls || response.toolCalls.length === 0) && verifyIntentRetries === 0) {
            verifyIntentRetries++;
            runner.telemetry.warn(`[AgentRuntime] ${nodeName} failed to call a tool. Nudging...`);
            const agentToolHint = nodeName === 'web_explorer' ? `'web_search' or 'navis'` :
                nodeName === 'coding_specialist' ? `your coding tools (read_file, write_file, terminal_execute, etc.)` :
                    nodeName === 'data_analyst' ? `your data analysis tools (python_executor, read_file, etc.)` :
                        `'computer_use'`;
            const nudgeMsg = {
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
            textContent = response.content.map((c) => 'text' in c ? c.text : '').join('\n');
        }
        const scrubbed = textContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/ig, '').trim();
        // If model didn't provide tool calls but intent requires them, parse or nudge
        if (!response.toolCalls || response.toolCalls.length === 0) {
            const allowedInToolDefs = new Set(options.toolDefs.map((t) => t.name));
            const filteredTools = (runner.tools || []).filter((t) => allowedInToolDefs.has(t.name));
            const parserResult = (0, text_to_tool_1.parseTextToToolCalls)(textContent, filteredTools);
            if (parserResult.toolCalls.length > 0) {
                response.toolCalls = parserResult.toolCalls;
                response.finishReason = 'tool_calls';
            }
        }
        const assistantMsg = {
            role: 'assistant',
            content: scrubbed,
            tool_calls: response.toolCalls,
            reasoning_content: response.reasoning_content,
        };
        // Validate tool calls against allowed toolDefs — strip hallucinated tools
        const validatedToolCalls = (response.toolCalls ?? []).filter((tc) => options.toolDefs.some((td) => td.name === tc.name));
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
            messages: [assistantMsg],
            pendingToolCalls: validatedToolCalls,
            iterations: iterations + 1,
            finalResponse: response.finishReason !== 'tool_calls' ? scrubbed : '',
        };
    }
    finally {
        // Release pooled client if we used one
        if (clientToRelease && clientConfig) {
            runner.releaseClient(clientToRelease, clientConfig);
        }
    }
}
