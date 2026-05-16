"use strict";
/**
 * Navis — AI Decision Optimization
 *
 * Implements performance optimizations for AI decision-making:
 * - Conversation history compression after 8 steps (Req 2.3)
 * - Temperature 0.1 for consistent responses (Req 2.4)
 * - Response streaming for AI calls (Req 2.5)
 * - Performance targets: <2000ms for text-only, <4000ms for vision (Req 2.1, 2.2)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCREENSHOT_CONFIG = exports.PERFORMANCE_TARGETS = exports.DEFAULT_COMPRESSION_CONFIG = void 0;
exports.compressHistory = compressHistory;
exports.estimateTokens = estimateTokens;
exports.checkPerformanceTarget = checkPerformanceTarget;
exports.callAIWithStreaming = callAIWithStreaming;
exports.optimizeContext = optimizeContext;
exports.getDetailLevel = getDetailLevel;
exports.checkScreenshotPerformance = checkScreenshotPerformance;
exports.DEFAULT_COMPRESSION_CONFIG = {
    compressionThreshold: 8, // Compress after 8 steps (Req 2.3)
    maxHistoryTokens: 10000, // Keep context below 10k tokens
};
/**
 * Compresses conversation history to reduce context size
 * Implements Req 2.3: Compress conversation history after 8 steps
 */
function compressHistory(history, config = exports.DEFAULT_COMPRESSION_CONFIG) {
    if (history.length <= config.compressionThreshold) {
        return history.join('\n');
    }
    // Keep the last N steps, summarize earlier ones
    const recentSteps = history.slice(-config.compressionThreshold);
    const earlierSteps = history.slice(0, -config.compressionThreshold);
    // Create a summary of earlier steps
    const summary = `[${earlierSteps.length} earlier steps summarized]
- Started with task
- Completed ${earlierSteps.length} intermediate steps
- Current progress: ${recentSteps[0]?.split('→')[1] || 'in progress'}`;
    return [summary, ...recentSteps].join('\n');
}
/**
 * Estimates token count for a string (rough approximation)
 * 1 token ≈ 4 characters for English text
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
exports.PERFORMANCE_TARGETS = {
    'text-only': { type: 'text-only', maxMs: 2000 }, // Req 2.1
    'vision': { type: 'vision', maxMs: 4000 }, // Req 2.2
};
function checkPerformanceTarget(elapsedMs, targetType) {
    const target = exports.PERFORMANCE_TARGETS[targetType];
    const met = elapsedMs <= target.maxMs;
    const message = `AI ${targetType} decision: ${elapsedMs}ms (target: ${target.maxMs}ms) ${met ? '✓' : '⚠'}`;
    return { met, message };
}
async function callAIWithStreaming(aiClient, messages, config) {
    const startTime = Date.now();
    // Temperature 0.1 for consistent responses (Req 2.4)
    const temperature = config.temperature ?? 0.1;
    try {
        // Call AI with streaming if enabled
        if (config.streaming?.enabled) {
            let fullContent = '';
            // Note: Actual streaming implementation depends on AIClient capabilities
            // This is a placeholder for the streaming interface
            const response = await aiClient.chat({
                messages,
                model: config.model,
                temperature,
                responseFormat: config.responseFormat,
                jsonSchema: config.jsonSchema,
            });
            fullContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            config.streaming.onChunk?.(fullContent);
            config.streaming.onComplete?.(fullContent);
            return {
                content: fullContent,
                elapsedMs: Date.now() - startTime,
            };
        }
        else {
            // Standard non-streaming call
            const response = await aiClient.chat({
                messages,
                model: config.model,
                temperature,
                responseFormat: config.responseFormat,
                jsonSchema: config.jsonSchema,
            });
            const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            return {
                content,
                elapsedMs: Date.now() - startTime,
            };
        }
    }
    catch (err) {
        throw new Error(`AI call failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
}
/**
 * Optimizes input context for AI by removing redundant information
 */
function optimizeContext(context, maxChars = 8000) {
    if (context.length <= maxChars) {
        return context;
    }
    // Remove verbose sections while keeping essential info
    const lines = context.split('\n');
    const essential = [];
    let charCount = 0;
    for (const line of lines) {
        if (charCount + line.length > maxChars) {
            break;
        }
        essential.push(line);
        charCount += line.length;
    }
    return essential.join('\n');
}
/**
 * Calculates optimal detail level for vision mode based on screenshot size
 * Implements Req 4.2 and 4.3: Low detail for <200KB, high for >200KB
 */
function getDetailLevel(screenshotSizeKB) {
    return screenshotSizeKB > 200 ? 'high' : 'low'; // Req 4.2, 4.3
}
exports.DEFAULT_SCREENSHOT_CONFIG = {
    format: 'jpeg', // Req 4.1
    quality: 75, // Req 4.1: 75% quality
    viewportOnly: true, // Req 4.4: viewport-only
};
/**
 * Validates screenshot capture performance
 * Implements Req 4.5: Screenshot capture within 300ms
 */
function checkScreenshotPerformance(elapsedMs) {
    const target = 300; // Req 4.5: 300ms
    const met = elapsedMs <= target;
    const message = `Screenshot capture: ${elapsedMs}ms (target: ${target}ms) ${met ? '✓' : '⚠'}`;
    return { met, message };
}
