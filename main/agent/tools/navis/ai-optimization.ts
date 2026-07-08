/**
 * Navis — AI Decision Optimization
 */

import type { AIClient } from '../../../lib/ai-client';

export interface CompressionConfig {
  compressionThreshold: number;
  maxHistoryTokens: number;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  compressionThreshold: 8,
  maxHistoryTokens: 10000,
};

/**
 * Compresses conversation history while preserving critical context:
 * - All failed actions (so the AI doesn't retry the same thing)
 * - All extract_content results (the AI needs facts it gathered)
 * - The N most recent steps verbatim
 */
export function compressHistory(
  history: string[],
  config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG,
): string {
  if (history.length <= config.compressionThreshold) {
    return history.join('\n');
  }

  const recentSteps = history.slice(-config.compressionThreshold);
  const earlierSteps = history.slice(0, -config.compressionThreshold);

  // Preserve failures and extract results from the earlier section
  const preserved: string[] = [];
  for (const step of earlierSteps) {
    const lower = step.toLowerCase();
    const isFailed = lower.includes('failed') || lower.includes('error') || lower.includes('no clickable') || lower.includes('not found');
    const isExtract = lower.includes('extract') || lower.includes('content:');
    if (isFailed || isExtract) {
      preserved.push(step);
    }
  }

  const summaryLines: string[] = [
    `[Earlier ${earlierSteps.length} steps — ${history.length - config.compressionThreshold} compressed]`,
  ];
  if (preserved.length > 0) {
    summaryLines.push('Key earlier events preserved:');
    // Keep at most 5 preserved lines to avoid bloat
    for (const line of preserved.slice(-5)) {
      summaryLines.push(`  ${line}`);
    }
  }

  return [...summaryLines, ...recentSteps].join('\n');
}

/**
 * Estimates token count (rough: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PerformanceTarget {
  type: 'text-only' | 'vision';
  maxMs: number;
}

export const PERFORMANCE_TARGETS: Record<string, PerformanceTarget> = {
  'text-only': { type: 'text-only', maxMs: 2000 },
  'vision': { type: 'vision', maxMs: 4000 },
};

export function checkPerformanceTarget(
  elapsedMs: number,
  targetType: 'text-only' | 'vision',
): { met: boolean; message: string } {
  const target = PERFORMANCE_TARGETS[targetType];
  const met = elapsedMs <= target.maxMs;
  const message = `[Navis Perf] ${targetType} AI call: ${elapsedMs}ms (target ≤${target.maxMs}ms) ${met ? '✓' : '⚠ SLOW'}`;
  if (!met) console.warn(message);
  return { met, message };
}

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
  const temperature = config.temperature ?? 0.1;

  try {
    const response = await aiClient.chat({
      messages,
      model: config.model,
      temperature,
      responseFormat: config.responseFormat,
      jsonSchema: config.jsonSchema,
    });

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const elapsedMs = Date.now() - startTime;

    config.streaming?.onChunk?.(content);
    config.streaming?.onComplete?.(content);

    // Log performance — warn if slow
    checkPerformanceTarget(elapsedMs, config.streaming?.enabled ? 'vision' : 'text-only');

    return { content, elapsedMs };
  } catch (err) {
    throw new Error(`AI call failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

/**
 * Smart context truncation — always preserves task + last history.
 * Trims in order: refs list, then page text, then older history.
 */
export function optimizeContext(context: string, maxChars: number = 8000): string {
  if (context.length <= maxChars) return context;

  const lines = context.split('\n');

  // Identify which lines belong to which section by marker lines
  type Section = 'header' | 'history' | 'refs' | 'dom' | 'footer';
  const sections: { section: Section; lines: string[] }[] = [];
  let current: Section = 'header';
  let buf: string[] = [];

  const flush = () => { if (buf.length) sections.push({ section: current, lines: [...buf] }); buf = []; };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('interactive elements:')) { flush(); current = 'refs'; buf.push(line); }
    else if (lower.startsWith('dom grounding context:')) { flush(); current = 'dom'; buf.push(line); }
    else if (lower.startsWith('history:')) { flush(); current = 'history'; buf.push(line); }
    else if (lower.startsWith('last result:') || lower.startsWith('vision:') || lower.startsWith('last step:')) { flush(); current = 'footer'; buf.push(line); }
    else { buf.push(line); }
  }
  flush();

  // Build result: always include header + footer; trim refs > dom > history in that order
  const build = () => sections.map(s => s.lines.join('\n')).join('\n');

  // Trim refs to 60 entries if over budget
  const refsSection = sections.find(s => s.section === 'refs');
  if (build().length > maxChars && refsSection) {
    refsSection.lines = refsSection.lines.slice(0, 62); // header line + 60 ref lines + 1 buffer
  }

  // Trim DOM JSON if still over
  const domSection = sections.find(s => s.section === 'dom');
  if (build().length > maxChars && domSection) {
    const domText = domSection.lines.join('\n');
    const budget = Math.max(500, maxChars - (build().length - domText.length));
    domSection.lines = [domText.slice(0, budget)];
  }

  // Trim history if still over
  const histSection = sections.find(s => s.section === 'history');
  if (build().length > maxChars && histSection) {
    // Keep last 4 history lines
    histSection.lines = [histSection.lines[0], ...histSection.lines.slice(-4)];
  }

  return build().slice(0, maxChars);
}

export function getDetailLevel(screenshotSizeKB: number): 'low' | 'high' {
  return screenshotSizeKB > 200 ? 'high' : 'low';
}

export function checkScreenshotPerformance(elapsedMs: number): { met: boolean; message: string } {
  const met = elapsedMs <= 300;
  const message = `[Navis Perf] Screenshot captured in ${elapsedMs}ms (target: 300ms) ${met ? '✓' : '⚠ SLOW'}`;
  return { met, message };
}

export interface ScreenshotConfig {
  format: 'jpeg' | 'png';
  quality: number;
  viewportOnly: boolean;
}

export const DEFAULT_SCREENSHOT_CONFIG: ScreenshotConfig = {
  format: 'jpeg',
  quality: 75,
  viewportOnly: true,
};
