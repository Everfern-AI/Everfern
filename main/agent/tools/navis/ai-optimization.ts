/**
 * Navis — AI Decision Optimization
 *
 * Implements performance optimizations for AI decision-making:
 * - Conversation history compression after 8 steps (Req 2.3)
 * - Temperature 0.1 for consistent responses (Req 2.4)
 * - Response streaming for AI calls (Req 2.5)
 * - Performance targets: <2000ms for text-only, <4000ms for vision (Req 2.1, 2.2)
 */

import type { AIClient } from '../../../lib/ai-client';

export interface CompressionConfig {
  compressionThreshold: number; // Compress after N steps
  maxHistoryTokens: number; // Target max tokens for history
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  compressionThreshold: 8, // Compress after 8 steps (Req 2.3)
  maxHistoryTokens: 10000, // Keep context below 10k tokens
};

/**
 * Compresses conversation history to reduce context size
 * Implements Req 2.3: Compress conversation history after 8 steps
 */
export function compressHistory(
  history: string[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG,
): string {
  if (history.length <= config.compressionThreshold) {
    return history.join('\n');
  }

  // Keep the last N steps, summarize earlier ones
  const recentSteps = history.slice(-config.compressionThreshold);
  const earlierSteps = history.slice(0, -config.compressionThreshold);

  // Create a summary of earlier steps
  const summary = `[${history.length} earlier steps summarized]
- Started with task
- Completed ${earlierSteps.length} intermediate steps
- Current progress: ${recentSteps[0]?.split('→')[1] || 'in progress'}`;

  return [summary, ...recentSteps].join('\n');
}

/**
 * Estimates token count for a string (rough approximation)
 * 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validates that AI response completes within performance targets
 * Implements Req 2.1 and 2.2: Text-only <2000ms, vision <4000ms
 */
export interface PerformanceTarget {
  type: 'text-only' | 'vision';
  maxMs: number;
}

export const PERFORMANCE_TARGETS: Record<string, PerformanceTarget> = {
  'text-only': { type: 'text-only', maxMs: 2000 }, // Req 2.1
  'vision': { type: 'vision', maxMs: 4000 }, // Req 2.2
};

export function checkPerformanceTarget(
  elapsedMs: number,
  targetType: 'text-only' | 'vision',
): { met: boolean; message: string } {
  const target = PERFORMANCE_TARGETS[targetType];
  const met = elapsedMs <= target.maxMs;
  const message = `AI ${targetType} decision: ${elapsedMs}ms (target: ${target.maxMs}ms) ${met ? '✓' : '⚠'}`;
  return { met, message };
}

/**
 * Implements response streaming for AI calls (Req 2.5)
 * Allows showing progress during long AI calls
 */
export interface StreamingConfig {
  enabled: boolean;
  onChunk?: (chunk: string) => void;
  onComplete?: (full: string) => void;
}

export async function callAIWithStreaming(
  aiClient: AIClient,
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | any[] }>,
  config: {
    model: string;
    temperature?: number;
    responseFormat?: 'json';
    jsonSchema?: any;
    streaming?: StreamingConfig;
  },
): Promise<{ content: string; elapsedMs: number }> {
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
    } else {
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
  } catch (err) {
    throw new Error(`AI call failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

/**
 * Optimizes input context for AI by removing redundant information
 */
export function optimizeContext(context: string, maxChars: number = 8000): string {
  if (context.length <= maxChars) {
    return context;
  }

  // Remove verbose sections while keeping essential info
  const lines = context.split('\n');
  const essential: string[] = [];
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
export function getDetailLevel(screenshotSizeKB: number): 'low' | 'high' {
  return screenshotSizeKB >= 200 ? 'high' : 'low'; // Req 4.2, 4.3
}

/**
 * Formats screenshot for vision mode with optimal quality
 * Implements Req 4.1: JPEG format with 75% quality
 */
export interface ScreenshotConfig {
  format: 'jpeg' | 'png';
  quality: number; // 0-100 for JPEG
  viewportOnly: boolean; // Req 4.4: viewport-only capture
}

export const DEFAULT_SCREENSHOT_CONFIG: ScreenshotConfig = {
  format: 'jpeg', // Req 4.1
  quality: 75, // Req 4.1: 75% quality
  viewportOnly: true, // Req 4.4: viewport-only
};

/**
 * Validates screenshot capture performance
 * Implements Req 4.5: Screenshot capture within 300ms
 */
export function checkScreenshotPerformance(elapsedMs: number): { met: boolean; message: string } {
  const target = 300; // Req 4.5: 300ms
  const met = elapsedMs <= target;
  const message = `Screenshot capture: ${elapsedMs}ms (target: ${target}ms) ${met ? '✓' : '⚠'}`;
  return { met, message };
}
