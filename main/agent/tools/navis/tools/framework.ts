/**
 * Navis — Tool Framework
 *
 * Ported from BrowserOS browser-mcp/src/tools/framework.ts.
 * Provides defineTool(), ToolContext, ToolResponse, executeTool().
 */

import { z, type TypeOf, type ZodObject, type ZodRawShape } from 'zod';
import type { ToolContext, ToolResult, ContentItem } from '../core/types';

export type ToolInputSchema = ZodObject<ZodRawShape>;

export interface ToolDefinition {
  name: string;
  description: string;
  input: ToolInputSchema;
  annotations?: import('../core/types').ToolAnnotations;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<ToolResult | undefined>;
}

export function defineTool<S extends ToolInputSchema>(def: {
  name: string;
  description: string;
  input: S;
  annotations?: import('../core/types').ToolAnnotations;
  handler: (
    args: TypeOf<S>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<ToolResult | undefined>;
}): ToolDefinition {
  return def as unknown as ToolDefinition;
}

export function textResult(text: string, structured?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured !== undefined && { structuredContent: structured }),
  };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function clampTimeout(
  value: number | undefined,
  defaultMs: number,
  maxMs: number,
): number {
  if (value === undefined) return defaultMs;
  if (!Number.isFinite(value) || value <= 0) return defaultMs;
  return Math.min(Math.round(value), maxMs);
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      clearTimeout(timeout);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return operation;

  let cleanup = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    cleanup = () => signal.removeEventListener('abort', onAbort);
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    cleanup();
    void operation.catch(() => {});
  }
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(
    reason === undefined ? 'The operation was aborted.' : String(reason),
  );
  error.name = 'AbortError';
  return error;
}

/** Validate args, run handler, catch errors into errorResult. */
export async function executeTool(
  def: ToolDefinition,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  throwIfAborted(ctx.signal);
  const parsed = def.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return errorResult(`Invalid arguments for ${def.name}: ${detail}`);
  }

  const response = new ToolResponse();
  try {
    const result = await abortable(
      def.handler(parsed.data as Record<string, unknown>, ctx, response),
      ctx.signal,
    );
    if (result) response.appendResult(result);
    throwIfAborted(ctx.signal);
  } catch (err) {
    if (ctx.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
    response.error(
      `${def.name} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  throwIfAborted(ctx.signal);
  return response.toResult();
}

// ── ToolResponse ─────────────────────────────────────────────────────────────

export class ToolResponse {
  private content: ContentItem[] = [];
  private hasError = false;
  private structured: unknown;

  text(value: string): void {
    this.content.push({ type: 'text', text: value });
  }

  error(message: string): void {
    this.hasError = true;
    this.content.push({ type: 'text', text: message });
  }

  data(key: string, value: unknown): void;
  data(obj: Record<string, unknown>): void;
  data(keyOrObj: string | Record<string, unknown>, value?: unknown): void {
    const current = isRecord(this.structured) ? this.structured : {};
    if (typeof keyOrObj === 'string') {
      current[keyOrObj] = value;
      this.structured = current;
      return;
    }
    Object.assign(current, keyOrObj);
    this.structured = current;
  }

  appendResult(result: ToolResult): void {
    this.content.push(...result.content);
    if (result.isError) this.hasError = true;
    if ('structuredContent' in result) {
      if (isRecord(result.structuredContent)) {
        this.data(result.structuredContent);
      } else {
        this.structured = result.structuredContent;
      }
    }
  }

  toResult(): ToolResult {
    return {
      content: this.content,
      ...(this.hasError && { isError: true }),
      ...(this.structured !== undefined && { structuredContent: this.structured }),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
