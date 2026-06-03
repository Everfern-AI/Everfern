/**
 * Retry Logic with Exponential Backoff
 *
 * Wraps individual tool call execution with retry logic per the design doc:
 * - Network errors: wait 60 seconds and retry
 * - Rate limit errors: wait for the rate limit reset time (dynamic)
 * - Other errors: exponential backoff (2^attempt * 1000ms)
 * - After 3 failed retries: pause task and notify user
 * - All retries are logged to checkpoints
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import type { AgentTool, ToolCallRecord, ToolResult } from '../types';
import type { StreamEvent } from '../state';

// ── Constants ─────────────────────────────────────────────────────────

/** Maximum number of retry attempts before pausing the task (Req 13.1) */
export const MAX_RETRIES = 3;

/** Fixed delay for network errors in milliseconds (Req 13.2) */
export const NETWORK_ERROR_DELAY_MS = 60_000;

/** Default rate limit wait when no reset time is available (Req 13.3) */
export const DEFAULT_RATE_LIMIT_DELAY_MS = 120_000;

// ── Error type detection ──────────────────────────────────────────────

/**
 * Determines whether an error is a transient network error.
 *
 * Network errors warrant a fixed 60-second wait before retry (Req 13.2).
 */
export function isNetworkError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  const networkPatterns = [
    'econnreset',
    'econnrefused',
    'enotfound',
    'etimedout',
    'econnaborted',
    'network',
    'socket',
    'fetch failed',
    'failed to fetch',
    'networkerror',
    'net::',
    'connection refused',
    'connection reset',
    'connection timed out',
    'no such host',
    'dns lookup failed',
    'getaddrinfo',
    'unable to connect',
  ];

  // Also check error codes and error names
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const code = String(e['code'] ?? '').toLowerCase();
    const name = String(e['name'] ?? '').toLowerCase();
    if (
      code.startsWith('e') && ['econnreset', 'econnrefused', 'enotfound', 'etimedout', 'econnaborted'].includes(code)
    ) {
      return true;
    }
    if (name === 'networkerror' || name === 'typeerror' && msg.includes('fetch')) {
      return true;
    }
  }

  return networkPatterns.some(pattern => msg.includes(pattern));
}

/**
 * Determines whether an error is a rate limit error (HTTP 429 / quota exceeded).
 *
 * Rate limit errors warrant a dynamic wait based on the reset time (Req 13.3).
 */
export function isRateLimitError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  const rateLimitPatterns = [
    '429',
    'rate limit',
    'rate_limit',
    'ratelimit',
    'too many requests',
    'quota exceeded',
    'quota_exceeded',
    'tokens per minute',
    'requests per minute',
    'throttled',
    'throttle',
    'overloaded',
    'capacity',
    'retry after',
    'retry-after',
    'x-ratelimit',
  ];

  // Check HTTP status code on error objects
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const status = Number(e['status'] ?? e['statusCode'] ?? e['code'] ?? 0);
    if (status === 429) return true;
  }

  return rateLimitPatterns.some(pattern => msg.includes(pattern));
}

/**
 * Extracts the rate limit reset wait time from an error response.
 *
 * Looks for standard headers/fields:
 * - `retry-after` header (seconds or HTTP date)
 * - `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens`
 * - `reset_after` field (in ms)
 *
 * Returns the wait time in milliseconds. Falls back to DEFAULT_RATE_LIMIT_DELAY_MS.
 *
 * Requirement 13.3: Schedule next retry after the rate limit reset time
 */
export function extractRateLimitWaitTime(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return DEFAULT_RATE_LIMIT_DELAY_MS;
  }

  const e = error as Record<string, unknown>;

  // Check common field names for retry-after
  const retryAfterFields = ['retryAfter', 'retry_after', 'retryAfterMs', 'resetAfter', 'reset_after'];
  for (const field of retryAfterFields) {
    const val = e[field];
    if (val != null) {
      const ms = parseRetryAfterValue(val);
      if (ms > 0) return ms;
    }
  }

  // Check nested response headers
  const response = e['response'] as any;
  const headers = (e['headers'] ?? (response && typeof response === 'object' ? response['headers'] : undefined) ?? e['responseHeaders']) as Record<string, string> | undefined;
  if (headers && typeof headers === 'object') {
    const retryAfterHeader = headers['retry-after'] ?? headers['Retry-After'] ?? headers['x-ratelimit-reset-after'];
    if (retryAfterHeader) {
      const ms = parseRetryAfterValue(retryAfterHeader);
      if (ms > 0) return ms;
    }
  }

  // Check nested response body
  const responseBody = e['response'] as Record<string, unknown> | undefined;
  if (responseBody && typeof responseBody === 'object') {
    const error2 = responseBody['error'] as Record<string, unknown> | undefined;
    if (error2) {
      const msg = errorMessage(error2).toLowerCase();
      // Pattern: "try again in 2.345s"
      const tryAgainMatch = msg.match(/try again in (\d+(?:\.\d+)?)\s*s/);
      if (tryAgainMatch) {
        return Math.ceil(parseFloat(tryAgainMatch[1]) * 1000) + 500; // Add 500ms buffer
      }
    }
  }

  return DEFAULT_RATE_LIMIT_DELAY_MS;
}

/**
 * Parses a retry-after value to milliseconds.
 * Accepts a number (seconds), a number string (seconds), or an HTTP date string.
 */
function parseRetryAfterValue(value: unknown): number {
  if (typeof value === 'number') {
    // If already in ms (large values > 1000) vs seconds
    return value > 1000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const numeric = parseFloat(value);
    if (!isNaN(numeric)) {
      return numeric > 1000 ? numeric : Math.ceil(numeric * 1000);
    }
    // HTTP date format
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const waitMs = date.getTime() - Date.now();
      return waitMs > 0 ? waitMs : DEFAULT_RATE_LIMIT_DELAY_MS;
    }
  }
  return 0;
}

/**
 * Calculates exponential backoff delay for a given attempt number.
 *
 * Formula: 2^attempt * 1000ms (Req 13.1)
 * Example: attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s
 */
export function calculateExponentialBackoff(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

// ── Retry entry ───────────────────────────────────────────────────────

export interface RetryLogEntry {
  attempt: number;
  toolName: string;
  errorType: 'network' | 'rate_limit' | 'other';
  errorMessage: string;
  delayMs: number;
  timestamp: number;
}

export interface ToolExecutionError extends Error {
  toolName: string;
  attempts: number;
  retryLog: RetryLogEntry[];
  taskPaused: boolean;
}

/**
 * Executes a tool call with retry logic and exponential backoff.
 *
 * Retry strategy:
 * 1. Network errors → wait NETWORK_ERROR_DELAY_MS (60s) then retry (Req 13.2)
 * 2. Rate limit errors → wait extractRateLimitWaitTime() then retry (Req 13.3)
 * 3. Other errors → wait 2^attempt * 1000ms (Req 13.1)
 * 4. After MAX_RETRIES failures → throw and signal task pause (Req 13.5)
 *
 * All retry attempts are logged (Req 13.4) and the caller is responsible for
 * persisting the log to checkpoints.
 *
 * @param toolCall    - Tool call descriptor with name, args, and id
 * @param tools       - Available tool registry
 * @param eventQueue  - Optional event queue for UI streaming
 * @param onRetryLog  - Callback invoked with each retry log entry (Req 13.4)
 * @param sleepFn     - Injectable sleep function for testing (defaults to real sleep)
 *
 * Requirement 13.1: Retry up to 3 times with exponential backoff
 * Requirement 13.2: Wait 60s for network errors
 * Requirement 13.3: Dynamic wait for rate limit errors
 * Requirement 13.4: Log all retry attempts with error details
 * Requirement 13.5: Pause task and notify user after max retries
 * Requirement 13.6: Allow manual retry trigger after user intervention
 */
export async function executeToolCallWithRetry(
  toolCall: { name: string; args: Record<string, unknown>; id: string },
  tools: AgentTool[],
  eventQueue?: StreamEvent[],
  onRetryLog?: (entry: RetryLogEntry) => void,
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<ToolCallRecord> {
  const retryLog: RetryLogEntry[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const record = await executeOnce(toolCall, tools, eventQueue);
      return record;
    } catch (err) {
      lastError = err;

      const errType: RetryLogEntry['errorType'] =
        isNetworkError(err) ? 'network' :
        isRateLimitError(err) ? 'rate_limit' :
        'other';

      let delayMs: number;
      let delayDescription: string;

      if (errType === 'network') {
        // Req 13.2: Network error → fixed 60-second wait
        delayMs = NETWORK_ERROR_DELAY_MS;
        delayDescription = `${delayMs / 1000}s (network error)`;
      } else if (errType === 'rate_limit') {
        // Req 13.3: Rate limit → dynamic wait based on reset time
        delayMs = extractRateLimitWaitTime(err);
        delayDescription = `${delayMs / 1000}s (rate limit reset)`;
      } else {
        // Req 13.1: Other errors → exponential backoff
        delayMs = calculateExponentialBackoff(attempt);
        delayDescription = `${delayMs}ms (exponential backoff, attempt ${attempt})`;
      }

      const logEntry: RetryLogEntry = {
        attempt,
        toolName: toolCall.name,
        errorType: errType,
        errorMessage: errorMessage(err),
        delayMs,
        timestamp: Date.now(),
      };

      retryLog.push(logEntry);

      // Req 13.4: Log retry attempt with error details
      console.warn(
        `[RetryLogic] Tool '${toolCall.name}' failed (attempt ${attempt}/${MAX_RETRIES}, ${errType}): ${errorMessage(err)}. Waiting ${delayDescription}...`
      );

      // Emit retry event to frontend
      eventQueue?.push({
        type: 'thought',
        content: `⚠️ Tool '${toolCall.name}' failed (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${delayDescription}...`
      } as StreamEvent);

      // Invoke callback so caller can persist log to checkpoint (Req 13.4)
      onRetryLog?.(logEntry);

      if (attempt < MAX_RETRIES) {
        await sleepFn(delayMs);
      }
    }
  }

  // Req 13.5: All retries exhausted — pause task and notify user
  console.error(
    `[RetryLogic] Tool '${toolCall.name}' failed after ${MAX_RETRIES} attempts. Pausing task for manual intervention.`
  );

  eventQueue?.push({
    type: 'chunk',
    content: `\n\n⛔ **Tool '${toolCall.name}' failed after ${MAX_RETRIES} attempts.**\n\nErrors encountered:\n${
      retryLog.map(l => `• Attempt ${l.attempt} (${l.errorType}): ${l.errorMessage}`).join('\n')
    }\n\nTask has been paused. Please review the error and retry manually. (Req 13.6)`
  } as StreamEvent);

  const toolExecError = new Error(
    `Tool '${toolCall.name}' failed after ${MAX_RETRIES} attempts: ${errorMessage(lastError)}`
  ) as ToolExecutionError;
  toolExecError.toolName = toolCall.name;
  toolExecError.attempts = MAX_RETRIES;
  toolExecError.retryLog = retryLog;
  toolExecError.taskPaused = true;

  throw toolExecError;
}

// ── Private helpers ───────────────────────────────────────────────────

/**
 * Executes a tool call once (no retry).
 * Throws on tool-not-found or tool execution error.
 */
async function executeOnce(
  toolCall: { name: string; args: Record<string, unknown>; id: string },
  tools: AgentTool[],
  eventQueue?: StreamEvent[]
): Promise<ToolCallRecord> {
  const tool = tools.find(t => t.name === toolCall.name);
  if (!tool) {
    throw Object.assign(new Error(`Tool not found: ${toolCall.name}`), { toolName: toolCall.name });
  }

  const result = await tool.execute(
    toolCall.args,
    (update) => {
      eventQueue?.push({ type: 'tool_update', toolName: toolCall.name, update } as any);
    },
    (event) => {
      eventQueue?.push(event);
    },
    toolCall.id
  );

  // Treat tool errors (success: false) as thrown errors for retry purposes
  if (!result.success && result.error) {
    throw Object.assign(new Error(result.error), {
      toolResult: result,
      toolName: toolCall.name,
    });
  }

  return {
    id: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.args,
    result,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns the error message string regardless of error type.
 */
export function errorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    return String(e['message'] ?? e['error'] ?? e['msg'] ?? JSON.stringify(error));
  }
  return String(error);
}

/**
 * Promise-based sleep utility.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
