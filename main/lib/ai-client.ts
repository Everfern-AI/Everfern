/**
 * EverFern Desktop — Unified AI Client
 *
 * Single reusable class that connects to ALL AI providers behind one interface.
 * Supports OpenAI-compatible APIs (OpenAI, DeepSeek, LM Studio), Ollama native,
 * and Anthropic Messages API.
 *
 * Usage:
 *   const client = new AIClient({ provider: 'openai', apiKey: 'sk-...' });
 *   const response = await client.chat({ messages: [...] });
 *   for await (const chunk of client.streamChat({ messages: [...] })) { ... }
 */

import { DebugEmitter } from './debug';
import OpenAI from 'openai';
import { CLOUD_MODEL_MAP } from './providers';

// ── Local URL Normalization ─────────────────────────────────────────

// Normalize localhost/::1 loopback URLs to 127.0.0.1 — Node fetch may dial ::1
// first while Ollama/LM Studio bind IPv4 only, producing bare "fetch failed".
export function normalizeLocalUrl(url?: string): string | undefined {
  if (!url) return url;
  return url
    .replace(/^http:\/\/\[?::1\]?(:\d+)?/i, 'http://127.0.0.1$1')
    .replace(/^http:\/\/localhost(:\d+)?/i, 'http://127.0.0.1$1');
}

// ── Credential Redaction for Logs (AI-CORR-04) ─────────────────────

/**
 * AI-CORR-04: Redact a credential header value for logging.
 * Returns ONLY a scheme hint plus the last 4 characters — never a usable
 * token fragment. "Bearer sk-abc123xyz789" → "Bearer …z789".
 */
export function redactCredentialForLog(value: string | undefined | null): string {
  if (typeof value !== 'string' || value.length === 0) return '(empty)';
  // AI-CORR-04: the scheme allowlist is display-only — unrecognized schemes
  // still collapse to the last-4 tail, so it can never weaken redaction.
  const schemeMatch = value.match(/^(Bearer|Basic|ApiKey)\s+/i);
  const scheme = schemeMatch ? `${schemeMatch[1]} ` : '';
  const tail = value.slice(-4);
  return `${scheme}…${tail}`;
}

/**
 * AI-CORR-04: copy a headers record for logging with credential values
 * (Authorization, x-api-key, x-goog-api-key) collapsed to scheme + last4.
 * Returns a shallow copy — the original stays intact for the actual request.
 */
function redactHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'x-goog-api-key') {
      out[key] = redactCredentialForLog(out[key]);
    }
  }
  return out;
}

// ── SSE Line Parsing (AI-CORR-01) ───────────────────────────────────

/**
 * AI-CORR-01: Parse one raw SSE data line into a JSON object.
 * Returns `undefined` for blank lines, non-data lines, [DONE] sentinels and
 * malformed JSON. Callers count malformed lines via the client's
 * sseParseErrors counter (rate-limited warn logging lives in
 * AIClient._noteSSEParseError).
 */
export function parseSSELine(line: string): Record<string, any> | undefined {
  const t = line.trim();
  if (!t || !t.startsWith('data: ')) return undefined;
  const payload = t.slice(6);
  if (payload === '[DONE]') return undefined;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * AI-CORR-01: parse one newline-delimited JSON stream line (Ollama native).
 * Returns undefined for blank or malformed lines — callers count malformed
 * lines via AIClient._noteSSEParseError.
 */
export function parseNDJSONLine(line: string): Record<string, any> | undefined {
  const t = line.trim();
  if (!t) return undefined;
  try {
    const parsed = JSON.parse(t);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ── Safe JSON Parsing ───────────────────────────────────────────────

/**
 * Safely parse JSON with auto-repair for common LLM issues:
 * - Bad escape characters (e.g. "C:\Users" → "C:\\Users")
 * - Truncated JSON
 * - Single quotes instead of double quotes
 */
/**
 * XI.C: classify provider errors at the AIClient boundary.
 * OVERFLOW = HTTP 400 whose body matches context-window exhaustion patterns.
 * This rewrites the surfaced message only — no retry behavior change
 * (_fetchWithRetry never retries 4xx except 429; OVERFLOW stays non-retryable).
 */
export function classifyProviderError(status: number, body: string): string | null {
  if (status === 400 && /context length|context window|context_length|maximum context|too long|too many tokens|input too long|exceeds?.*(?:context|token)|token limit|prompt is too long/i.test(body)) {
    return `[OVERFLOW] Context window exceeded (HTTP 400). The conversation is too long for this model — compact or start a new session. Original: ${body.slice(0, 300)}`;
  }
  return null;
}

function safeParseJSON(input: string | Record<string, any>, fallback: any = {}): any {
  if (typeof input !== 'string') return input || fallback;
  if (!input.trim()) return fallback;
  try {
    return JSON.parse(input);
  } catch (err: any) {
    // Attempt repair: double backslashes before characters that aren't valid JSON escapes
    // Valid JSON escapes: " \\ / b f n r t u
    let repaired = input
      // Fix \U, \S, \P, etc. (common in Windows paths like C:\Users)
      .replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1')
      // Fix trailing backslash
      .replace(/\\$/, '\\\\');
    try {
      return JSON.parse(repaired);
    } catch {
      // If still fails, try extracting any JSON object from the string
      try {
        const match = repaired.match(/\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\})*)*\}))*\}/);
        if (match) return JSON.parse(match[0]);
      } catch { }
      // Also try the original with stripped control chars
      try {
        const stripped = input.replace(/[\x00-\x1f\x7f]/g, '');
        return JSON.parse(stripped);
      } catch { }
      console.warn(`[AIClient] Failed to parse JSON, using fallback. Input: "${input.slice(0, 200)}..."`);
      return fallback;
    }
  }
}

// ── LP-05: Per-Attempt Fetch Timeouts ────────────────────────────────

// LP-05: local daemons get 15s per non-stream attempt (was 300s, which turned a
// dead local server into ~47s of dead air ×7 prompt-processings). Cloud keeps 60s.
const LOCAL_FETCH_TIMEOUT_MS = 15000;
const CLOUD_FETCH_TIMEOUT_MS = 60000;

// ── LP-12: Prompt Token Estimation (deterministic, dependency-free) ──

/**
 * LP-12: deterministic char/4 token estimate over chat messages. Counts only
 * text content (string or text parts of content arrays) plus role tags —
 * image payloads are excluded so base64 blobs never inflate the estimate.
 */
export function estimatePromptTokens(messages: any[] | undefined | null): number {
  let chars = 0;
  for (const m of messages ?? []) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.role === 'string') chars += m.role.length;
    const c = (m as any).content;
    if (typeof c === 'string') {
      chars += c.length;
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part === 'object' && typeof (part as any).text === 'string') {
          chars += (part as any).text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

// ── LP-04: Prompt-Embedded Tool Calls (tools-incapable local models) ─

/** LP-04: process-lifetime cache of local per-model tools-capability probes (key `${baseUrl}|${model}`). */
const localToolsCapabilityCache = new Map<string, boolean>();

/**
 * LP-04: extract a prompt-embedded tool call from model output — the fenced
 * (or bare) {"tool":"name","arguments":{...}} JSON contract injected when a
 * local model lacks native tool support. Returns null when the model answered
 * with prose, chose "none", or emitted unparseable JSON (callers then keep
 * the existing nudge behavior for that case).
 */
export function extractEmbeddedToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  if (typeof content !== 'string' || !content.trim()) return null;
  // Strip <think> blocks so reasoning prose never masquerades as the answer.
  const clean = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
  const candidates: string[] = [];
  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(clean)) !== null) candidates.push(m[1]);
  candidates.push(clean); // unfenced fallback
  for (const raw of candidates) {
    const t = raw.trim();
    if (!t) continue;
    let obj: any;
    try {
      obj = JSON.parse(t);
    } catch {
      // Trailing prose around a JSON object: extract the first balanced {...}.
      const first = t.indexOf('{');
      const last = t.lastIndexOf('}');
      if (first === -1 || last <= first) continue;
      try {
        obj = JSON.parse(t.slice(first, last + 1));
      } catch {
        continue;
      }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const name = typeof obj.tool === 'string' ? obj.tool.trim() : '';
    // LP-04: explicit "none" = model decided no tool is needed.
    if (!name || name.toLowerCase() === 'none') return null;
    if (typeof obj.arguments !== 'object' || obj.arguments === null || Array.isArray(obj.arguments)) continue;
    return { name, arguments: obj.arguments as Record<string, unknown> };
  }
  return null;
}

// ── Client Pool for Connection Reuse ────────────────────────────────

/**
 * One pooled client plus its checkout bookkeeping. `inUse` tracks checkout
 * so get() never hands a client to two callers and cleanup() skips it.
 */
interface ClientPoolEntry {
  client: AIClient;
  lastUsed: number;
  inUse: boolean;
}

/**
 * Per-key client pool (provider/baseUrl/model) reusing warm connections so
 * requests skip repeated TLS/connection setup. Bounded by maxPoolSize, with
 * untracked one-off clients for overflow (see get()).
 */
class AIClientPool {
  private pool = new Map<string, ClientPoolEntry[]>();
  // Overflow beyond this cap gets untracked one-off clients (see get()), so
  // a concurrency burst can't permanently grow the pool's open connections.
  private maxPoolSize = 5;
  private maxIdleTime = 300000; // 5 minutes

  // Key omits apiKey: clients are reused across credential changes for the
  // same provider/baseUrl/model — the API key is set per-request anyway.
  // Volatile per-request knobs (temperature/maxTokens/etc.) are likewise
  // excluded — they ride on each call, so keying on them would fragment the pool.
  private getPoolKey(config: AIClientConfig): string {
    return `${config.provider}:${config.baseUrl}:${config.model}`;
  }

  /**
   * Acquire a pooled client for this config, marking it in-use. Creates a new
   * pooled entry while under maxPoolSize; beyond that returns an unpooled
   * temporary client (release() on it is a harmless no-op).
   */
  get(config: AIClientConfig): AIClient {
    const key = this.getPoolKey(config);
    const entries = this.pool.get(key) || [];

    // Find available client
    const available = entries.find(entry => !entry.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.client;
    }

    // Create new client if pool not full
    if (entries.length < this.maxPoolSize) {
      const client = new AIClient(config);
      const entry: ClientPoolEntry = {
        client,
        lastUsed: Date.now(),
        inUse: true
      };
      entries.push(entry);
      this.pool.set(key, entries);
      return client;
    }

    // Pool full, create temporary client
    // Never block on exhaustion: proceeding with an untracked one-off client
    // beats queueing — pooling is a perf optimization, not a correctness gate.
    return new AIClient(config);
  }

  /**
   * Mark a checked-out client available again and stamp lastUsed so idle
   * eviction restarts its clock. Unknown clients (unpooled one-offs) are
   * silently ignored.
   */
  release(client: AIClient, config: AIClientConfig): void {
    const key = this.getPoolKey(config);
    const entries = this.pool.get(key) || [];
    const entry = entries.find(e => e.client === client);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Drop pool entries that are idle beyond maxIdleTime. Runs on a 2-minute
   * interval (see globalClientPool below) so idle sockets don't linger.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entries] of this.pool.entries()) {
      const active = entries.filter(entry =>
        entry.inUse || (now - entry.lastUsed) < this.maxIdleTime
      );
      if (active.length === 0) {
        this.pool.delete(key);
      } else {
        this.pool.set(key, active);
      }
    }
  }
}

const globalClientPool = new AIClientPool();

// Cleanup idle connections every 2 minutes
setInterval(() => globalClientPool.cleanup(), 120000);

// ── Types ────────────────────────────────────────────────────────────

/** Supported AI provider IDs. See DEFAULT_URLS/DEFAULT_MODELS for per-provider defaults. */
export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'everfern' | 'gemini' | 'nvidia' | 'openrouter';

/** Constructor config for AIClient. apiKey/baseUrl/model default per provider; per-request knobs ride on each chat/stream call. */
export interface AIClientConfig {
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  customModel?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ollama native: context window size passed as options.num_ctx */
  ollamaNumCtx?: number;
  /** Decoupled Vision AI configuration */
  vlm?: {
    engine: 'online' | 'local' | 'cloud';
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
}

/** One message in a chat conversation: role plus text or image content parts. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
  /** Optional name for the message (e.g. tool name for role: 'tool') */
  name?: string;
  /** Unique ID for a tool call (required for role: 'tool' and assistant tool calls) */
  tool_call_id?: string;
  /** Optional reasoning/thinking content (used by DeepSeek/NVIDIA NIM) */
  reasoning_content?: string;
  thought?: string;
  /** Optional array of tool calls generated by the assistant */
  tool_calls?: ToolCall[];
  missionTimeline?: any;
}

/** Parameters for chat()/streamChat(): messages, generation knobs, tooling, and stream callbacks. */
export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /** Tool choice strategy: 'auto' (default), 'required' (force tool use), or specific tool name */
  toolChoice?: 'auto' | 'required' | string;
  /** Force JSON output. OpenAI/DeepSeek: json_object mode. Ollama: format=json. Nvidia: guided_json. */
  responseFormat?: 'json';
  /** JSON Schema for structured output. OpenAI: json_schema response_format. Nvidia: guided_json. Ollama: appended to prompt (fallback). */
  jsonSchema?: Record<string, unknown>;
  /** Nvidia guided_json: pass a JSON schema object to force structured output. */
  guidedJson?: Record<string, unknown>;
  onStreamChunk?: (chunk: string) => void;
  onToolCallChunk?: (index: number, toolName: string, argumentsDelta: string) => void;
  /** Gemini native: user response to a safety_decision or confirmation prompt */
  userConfirmation?: 'ACT' | 'STAY_ON_NOMINAL';
  abortSignal?: AbortSignal;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'ultra' | 'ultra-delegate';
  /** Agent/node name sent to EverFern Cloud for backend model routing (e.g. 'navis', 'coding_specialist', 'web_explorer') */
  agent?: string;
}

/** Result of a completed (non-streaming) chat call. */
export interface ChatResponse {
  id: string;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
  /** Optional reasoning/thinking content (from DeepSeek/NVIDIA NIM) */
  reasoning_content?: string;
  thought?: string;
  model: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  /** Gemini native: Safety decision for computer use actions */
  safetyDecision?: 'NOMINAL' | 'OFF-NOMINAL';
}

/** One delta yielded by streamChat(): text delta, tool-call deltas, or the final done sentinel. */
export interface StreamChunk {
  id: string;
  delta: string;
  done: boolean;
  model?: string;
  toolCalls?: any[]; // Incremental tool call deltas
}

/** Token accounting and (optional) per-field cost breakdown for one request. */
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTokensCost?: number;
  completionTokensCost?: number;
  imageInputCost?: number;
  imageOutputCost?: number;
  totalCost?: number;
}

/** Tool advertised to the model; `parameters` is a JSON Schema object. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/** A tool invocation requested by the model; `id` links the follow-up role:'tool' message. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ── Provider Base URLs ───────────────────────────────────────────────

/** Default API base URL per provider (cloud endpoints or local daemon ports). */
const DEFAULT_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.io/v1',
  everfern: 'https://api.everfern.app/api',  // Production EverFern API
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://127.0.0.1:11434',
  'ollama-cloud': 'https://ollama.com/v1',  // Fixed: was /api, should be /v1
  lmstudio: 'http://127.0.0.1:1234/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Default model ID per provider, used when config.model is omitted. */
const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-sonnet-4-6',
  deepseek: 'deepseek-v4-pro',
  minimax: 'MiniMax-M3',
  everfern: 'openai/gpt-5.6-luna',
  gemini: 'gemini-3.5-flash',
  ollama: 'llama3',
  'ollama-cloud': 'qwen3-vl:235b-cloud',
  lmstudio: 'local-model',
  nvidia: 'meta/llama-3.1-8b-instruct',
  openrouter: 'openai/gpt-5.2',
};

/** Browser/computer-use tool descriptors injected by _maybeInjectComputerUseTools for Gemini/GPT-5 pass-through models on EverFern/OpenRouter. */
const GEMINI_COMPUTER_USE_TOOLS = [
  {
    name: "open_web_browser",
    description: "Opens the web browser.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "wait_5_seconds",
    description: "Pauses execution for 5 seconds to allow dynamic content to load.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "go_back",
    description: "Navigates to the previous page in history.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "go_forward",
    description: "Navigates to the next page in history.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "search",
    description: "Navigates to the default search engine's homepage.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "navigate",
    description: "Navigates the browser directly to the specified URL.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string" } }
    }
  },
  {
    name: "click_at",
    description: "Clicks at a specific coordinate on the screen. x and y are 0-1000 normalized coordinates.",
    parameters: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1000 },
        y: { type: "integer", minimum: 0, maximum: 1000 }
      }
    }
  },
  {
    name: "hover_at",
    description: "Hovers the mouse at a specific coordinate on the screen. x and y are 0-1000 normalized coordinates.",
    parameters: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1000 },
        y: { type: "integer", minimum: 0, maximum: 1000 }
      }
    }
  },
  {
    name: "type_text_at",
    description: "Types text at a specific coordinate on the screen. x and y are 0-1000 normalized coordinates.",
    parameters: {
      type: "object",
      required: ["x", "y", "text"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1000 },
        y: { type: "integer", minimum: 0, maximum: 1000 },
        text: { type: "string" },
        press_enter: { type: "boolean", default: true },
        clear_before_typing: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "key_combination",
    description: "Press keyboard keys or combinations, such as 'Control+C' or 'Enter'.",
    parameters: {
      type: "object",
      required: ["keys"],
      properties: { keys: { type: "string" } }
    }
  },
  {
    name: "scroll_document",
    description: "Scrolls the entire webpage in the specified direction.",
    parameters: {
      type: "object",
      required: ["direction"],
      properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] } }
    }
  },
  {
    name: "scroll_at",
    description: "Scrolls at coordinate (x, y) in the specified direction. x and y are 0-1000 normalized coordinates.",
    parameters: {
      type: "object",
      required: ["x", "y", "direction"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1000 },
        y: { type: "integer", minimum: 0, maximum: 1000 },
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        magnitude: { type: "integer", default: 800 }
      }
    }
  },
  {
    name: "drag_and_drop",
    description: "Drags an element from starting coordinate (x,y) and drops it at destination (destination_x, destination_y). All coordinates are 0-1000 normalized.",
    parameters: {
      type: "object",
      required: ["x", "y", "destination_x", "destination_y"],
      properties: {
        x: { type: "integer", minimum: 0, maximum: 1000 },
        y: { type: "integer", minimum: 0, maximum: 1000 },
        destination_x: { type: "integer", minimum: 0, maximum: 1000 },
        destination_y: { type: "integer", minimum: 0, maximum: 1000 }
      }
    }
  }
];

// ── AIClient ─────────────────────────────────────────────────────────

/**
 * Convert OpenAI-style tool definitions to Ollama-native format, sanitizing
 * each JSON Schema (drops $schema/$id/examples, hoists boolean `required`,
 * collapses union types) so Ollama's strict parser accepts it. Exported for
 * tests.
 */
export function _formatOllamaTools(tools: any[]): any[] {
    const sanitizeSchemaNode = (node: any, depth: number = 0): any => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return node;
      }
      if (depth > 24) {
        return node;
      }

      const clean: any = { ...node };

      // Keys Ollama's schema parser cannot handle
      delete clean.$schema;
      delete clean.$id;
      delete clean.examples;

      // Boolean required is hoisted by the parent node — never emit it
      if (typeof clean.required === 'boolean') {
        delete clean.required;
      }

      // Union-typed `type` arrays like ["string","null"]: keep first non-null entry
      if (Array.isArray(clean.type)) {
        const nonNull = clean.type.filter((t: any) => t !== 'null');
        clean.type = nonNull.length > 0 ? nonNull[0] : clean.type[0];
      }

      if (clean.properties && typeof clean.properties === 'object' && !Array.isArray(clean.properties)) {
        const hoistedRequired: string[] = [];
        const props: any = {};
        for (const [key, val] of Object.entries(clean.properties)) {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            if ((val as any).required === true && !hoistedRequired.includes(key)) {
              hoistedRequired.push(key);
            }
            props[key] = sanitizeSchemaNode(val, depth + 1);
          } else {
            props[key] = val;
          }
        }
        clean.properties = props;
        if (hoistedRequired.length > 0) {
          clean.required = Array.isArray(clean.required) ? [...clean.required] : [];
          for (const name of hoistedRequired) {
            if (!clean.required.includes(name)) {
              clean.required.push(name);
            }
          }
        } else if (!Array.isArray(clean.required)) {
          delete clean.required;
        }
      }

      if (clean.items !== undefined) {
        clean.items = Array.isArray(clean.items)
          ? clean.items.map((item: any) => sanitizeSchemaNode(item, depth + 1))
          : sanitizeSchemaNode(clean.items, depth + 1);
      }

      for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(clean[combinator])) {
          clean[combinator] = clean[combinator].map((branch: any) => sanitizeSchemaNode(branch, depth + 1));
        }
      }

      for (const defsKey of ['$defs', 'definitions']) {
        if (clean[defsKey] && typeof clean[defsKey] === 'object' && !Array.isArray(clean[defsKey])) {
          const defs: any = {};
          for (const [defName, defVal] of Object.entries(clean[defsKey])) {
            defs[defName] = sanitizeSchemaNode(defVal, depth + 1);
          }
          clean[defsKey] = defs;
        }
      }

      return clean;
    };

    const sanitizeParams = (rawParams: any): any => {
      if (!rawParams || typeof rawParams !== 'object') {
        return { type: 'object', properties: {}, required: [] };
      }
      const clean = sanitizeSchemaNode(rawParams);
      return {
        type: clean?.type || 'object',
        properties: (clean?.properties && typeof clean.properties === 'object') ? clean.properties : {},
        required: Array.isArray(clean?.required) ? clean.required : []
      };
    };

    return tools.map(t => {
      const rawFunc = (t && (t as any).type === 'function' && (t as any).function)
        ? (t as any).function
        : t;
      return {
        type: 'function',
        function: {
          name: rawFunc.name,
          description: rawFunc.description || '',
          parameters: sanitizeParams(rawFunc.parameters)
        }
      };
    });
  }

/**
 * Unified multi-provider AI client: one chat()/streamChat() interface over
 * OpenAI-compatible, Ollama-native, Anthropic Messages, and Gemini APIs.
 * Construct directly or use the pooled factory exports below.
 */
export class AIClient {
  private config: Required<Omit<AIClientConfig, 'vlm' | 'customModel' | 'ollamaNumCtx'>> & { vlm?: AIClientConfig['vlm']; customModel?: string; ollamaNumCtx?: number };
  private openaiClient?: OpenAI; // For NVIDIA NIM and DeepSeek

  /** AI-CORR-01: total malformed SSE lines skipped across this client's lifetime. */
  private sseParseErrors = 0;

  /** LP-07: set once the local default-model sentinel has been resolved (or ruled out). */
  private localModelResolved = false;

  /** LP-07: process-lifetime cache of resolved local default model ids, keyed by baseUrl. */
  private static resolvedLocalDefaultModels = new Map<string, string>();

  constructor(config: AIClientConfig) {
    let finalApiKey = (config.apiKey ?? '').trim();

    // Only apply cleaning for legacy providers if they contain noise
    // Ollama Cloud / Custom keys must be preserved exactly as provided
    if (['openai', 'anthropic', 'nvidia', 'deepseek', 'minimax'].includes(config.provider)) {
      if (finalApiKey.includes(' ') || finalApiKey.includes('\n')) {
        const match = finalApiKey.match(/(?:nvapi-[A-Za-z0-9_-]+|sk-[A-Za-z0-9T\-]+|[A-Za-z0-9]{32,})/);
        if (match) finalApiKey = match[0];
      }
    }

    let finalBaseUrl = config.baseUrl;
    // Clean up stale local baseUrl for cloud/online providers
    if (config.provider && !['ollama', 'lmstudio'].includes(config.provider)) {
      if (finalBaseUrl && (finalBaseUrl.includes('localhost') || finalBaseUrl.includes('127.0.0.1'))) {
        finalBaseUrl = undefined;
      }
    }
    if (!finalBaseUrl) {
      finalBaseUrl = DEFAULT_URLS[config.provider];
    }
    // Ollama Cloud uses /v1 for OpenAI-compatible API, not /api
    if (config.provider === 'ollama-cloud') {
      if (finalBaseUrl === 'https://ollama.com' || finalBaseUrl === 'https://ollama.com/api') {
        finalBaseUrl = 'https://ollama.com/v1';
      }
    }

    const normalizedModel = config.provider === 'ollama-cloud' && config.model === 'qwen3-vl:235b-instruct-cloud'
      ? 'qwen3-vl:235b-cloud'
      : config.model;

    // LP-07: local model ids can arrive prefixed ('lmstudio:x'/'ollama:x') from
    // persisted settings or provider adapters; cloud ids never carry these
    // prefixes, so stripping is gated on the local providers only.
    let finalModel = normalizedModel;
    if (config.provider === 'ollama' || config.provider === 'lmstudio') {
      const stripped = finalModel?.replace(/^(ollama|lmstudio):/i, '');
      if (stripped !== finalModel) {
        console.log(`[AIClient] LP-07: stripped model-id prefix: '${finalModel}' → '${stripped}'`);
        finalModel = stripped;
      }
    }

    console.log(`[AIClient] Constructor: provider=${config.provider}, model=${finalModel}, baseUrl=${finalBaseUrl}, apiKey=${finalApiKey ? '***' : '(empty)'}`);

    this.config = {
      provider: config.provider,
      apiKey: finalApiKey,
      baseUrl: finalBaseUrl,
      model: finalModel ?? DEFAULT_MODELS[config.provider],
      customModel: config.customModel,
      temperature: config.temperature ?? (config.provider === 'nvidia' ? 0.1 : 0.7),
      maxTokens: config.maxTokens ?? (config.provider === 'nvidia' ? 16383 : config.provider === 'openrouter' ? 8192 : 4096),
      ollamaNumCtx: config.ollamaNumCtx,
      vlm: config.vlm,
    };

    // Initialize OpenAI client for OpenAI, NVIDIA NIM, DeepSeek, OpenRouter, MiniMax, EverFern and Ollama Cloud
    if (config.provider === 'openai' || config.provider === 'nvidia' || config.provider === 'deepseek' || config.provider === 'openrouter' || config.provider === 'minimax' || config.provider === 'everfern' || config.provider === 'ollama-cloud') {
      const headers: Record<string, string> = {
        'User-Agent': 'EverFern/1.0'
      };

      if (config.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://everfern.app';
        headers['X-OpenRouter-Title'] = 'EverFern';
      }

      this.openaiClient = new OpenAI({
        apiKey: this.config.apiKey || 'dummy-key',
        baseURL: normalizeLocalUrl(this.config.baseUrl),
        timeout: 120000,
        // Single retry layer: the app-level retryWithBackoff/_fetchWithRetry
        // (capped at 3, Retry-After aware) owns all retries. SDK maxRetries
        // must stay 0 — any SDK-level retries stack multiplicatively with the
        // app layer (audit XI.C: 3x3 = up to 12 attempts per request).
        maxRetries: 0,
        dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
        // Disable keep-alive to avoid Node 22 undici "invalid keep-alive header" errors
        // from NVIDIA NIM and other providers that may send malformed keep-alive responses.
        fetch: (url: RequestInfo | URL, init?: RequestInit) => {
          console.log(`[AIClient Fetch] URL: ${url}, method: ${init?.method || 'GET'}`);
          const safeInit = { ...init, keepalive: false };
          let plainHeaders: Record<string, string> = {};
          if (safeInit.headers) {
            if (typeof (safeInit.headers as any).entries === 'function') {
              for (const [key, value] of (safeInit.headers as any).entries()) {
                const normKey = key.toLowerCase() === 'authorization' ? 'Authorization' : key;
                plainHeaders[normKey] = value;
              }
            } else if (typeof safeInit.headers === 'object') {
              for (const [key, value] of Object.entries(safeInit.headers)) {
                const normKey = key.toLowerCase() === 'authorization' ? 'Authorization' : key;
                plainHeaders[normKey] = value as string;
              }
            }
          }
          delete plainHeaders['connection'];
          delete plainHeaders['Connection'];
          delete plainHeaders['keep-alive'];
          delete plainHeaders['Keep-Alive'];
          safeInit.headers = plainHeaders;

          console.log(`[AIClient Fetch] Request headers: ${Object.keys(plainHeaders).join(', ')}`);
          if (plainHeaders['Authorization']) {
            // AI-CORR-04: log only "Bearer …last4" — never the first 18 chars of the token.
            console.log(`[AIClient Fetch] Authorization header present: ${redactCredentialForLog(plainHeaders['Authorization'])} (total length: ${plainHeaders['Authorization'].length})`);
          } else {
            console.warn('[AIClient Fetch] WARNING: No Authorization header found!');
          }

          const result = Promise.resolve(fetch(url, safeInit)).then((res: any) => {
            if (res) {
              if (!res.headers) {
                res.headers = new Headers();
              }
              if (typeof res.json === 'function' && typeof res.text !== 'function') {
                res.text = () => res.json().then((val: any) => JSON.stringify(val));
              }
            }
            return res;
          });
          result.then(
            (res) => console.log(`[AIClient Fetch] Response: ${res.status} ${res.statusText} from ${url}`),
            (err) => console.error(`[AIClient Fetch] Error:`, err)
          );
          return result;
        }
      });
    }
  }

  get model(): string {
    return this.config.model;
  }

  // ── Public Interface ─────────────────────────────────────────────

  get provider(): ProviderType {
    return this.config.provider;
  }

  get apiKey(): string {
    return this.config.apiKey ?? '';
  }

  /**
   * AI-CORR-01: number of malformed SSE lines skipped by this client —
   * exposed for health telemetry.
   */
  get sseParseErrorCount(): number {
    return this.sseParseErrors;
  }

  /**
   * AI-CORR-01: record a malformed SSE line — increments the counter and
   * rate-limits console.warn to at most one log per 10 errors so a burst of
   * garbage never spams the log. The offending line is truncated to 120 chars.
   */
  private _noteSSEParseError(rawLine: string): void {
    this.sseParseErrors++;
    if (this.sseParseErrors === 1 || this.sseParseErrors % 10 === 0) {
      console.warn('[AIClient] SSE parse error (line skipped):', rawLine.slice(0, 120));
    }
  }

  setModel(model: string) {
    this.config.model = model;
  }

  /**
   * Returns the full configuration for this client.
   * Useful for coordinated fallback logic.
   */
  public getFullConfig(): AIClientConfig {
    return {
      ...this.config,
      vlm: this.config.vlm
    };
  }

  /**
   * Whether this client's model can accept image content. False when a
   * decoupled vlm is configured (vision is handled by that VLM instead);
   * otherwise true for known vision-capable providers or model names
   * matching vision keywords (vision, -vl, llava, gpt, claude, gemini, ...).
   */
  supportsVision(): boolean {
    if (this.config.vlm) return false;
    if (this.config.provider === 'everfern') return true;
    if (this.config.provider === 'minimax') return true;
    const modelName = this.config.model?.toLowerCase() || '';
    const visionKeywords = ['vision', 'image', 'vl-', 'vl:', 'llava', 'minicpm', 'moondream', '-vl', 'minimax'];
    if (visionKeywords.some(kw => modelName.includes(kw))) return true;
    if (this.config.provider === 'anthropic' || modelName.includes('claude')) return true;
    if (this.config.provider === 'gemini' || modelName.includes('gemini')) return true;
    if (this.config.provider === 'openai' || modelName.includes('gpt') || modelName.includes('o1') || modelName.includes('o3') || modelName.includes('computer-use')) return true;
    return false;
  }

  /**
   * Whether requests target a local daemon: ollama/lmstudio providers, a
   * loopback/mDNS baseUrl (localhost, 127.0.0.1, ::1, .local, .lan), or an
   * RFC1918 private subnet. Drives the longer local timeout and the
   * fail-fast/no-retry behavior in _fetchWithRetry and list-model calls.
   */
  isLocal(): boolean {
    const provider = this.config.provider;
    if (provider === 'ollama' || provider === 'lmstudio') {
      return true;
    }
    const baseUrl = this.config.baseUrl || '';
    if (
      baseUrl.includes('localhost') ||
      baseUrl.includes('127.0.0.1') ||
      baseUrl.includes('0.0.0.0') ||
      baseUrl.includes('::1') ||
      baseUrl.includes('.local') ||
      baseUrl.includes('.lan')
    ) {
      return true;
    }
    // Match private IP subnets: 192.168.x.x, 10.x.x.x, 172.16.x.x-172.31.x.x
    const privateIpRegex = /^(https?:\/\/)?(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?(\/.*)?$/;
    if (privateIpRegex.test(baseUrl)) {
      return true;
    }
    return false;
  }

  private assertProviderAuthReady(): void {
    if (this.config.provider === 'minimax' && !this.config.apiKey?.trim()) {
      throw new Error(
        'MiniMax API key is missing. Add your MiniMax secret in Settings > Vision Grounding > MiniMax API, then save settings and retry.'
      );
    }
  }

  private _parseActionsFromContent(content: string): string[] {
    if (!content) return [];

    // Strip thinking blocks and markdown code fences
    let clean = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
    clean = clean.replace(/^```[a-z]*\n?/gmi, '').replace(/```$/gmi, '').trim();

    const actions: string[] = [];

    // 1. Check for Action: section
    const actionBlockMatch = clean.match(/Action:\s*([\s\S]*?)$/i);
    const textToScan = actionBlockMatch ? actionBlockMatch[1] : clean;

    // 2. Extract structured actions (click, left_double, right_single, double_click, right_click, drag, hotkey, type, scroll, wait, finished, call_user, press, hover, etc.)
    const actionRegex = /(click|left_double|right_single|double_click|right_click|drag|hotkey|type|scroll|wait|finished|call_user|press|hover|move_to|mouse_move|key)\s*\(([^)]*)\)/gi;
    let match;
    while ((match = actionRegex.exec(textToScan)) !== null) {
      actions.push(match[0].trim());
    }

    if (actions.length > 0) {
      return actions;
    }

    // 3. Fallback: line-by-line inspection
    const lines = textToScan.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('thought:') || trimmed.startsWith('#')) continue;
      if (/^[a-z0-9_]+\s*\(.*\)/i.test(trimmed)) {
        actions.push(trimmed);
      }
    }

    if (actions.length > 0) return actions;

    // 4. Fallback: split by pipe only if no box tags are present
    if (clean.includes('|') && !clean.includes('<|box_')) {
      return clean
        .split('|')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.toLowerCase().includes('done') && !s.toLowerCase().startsWith('thought:'));
    }

    return [];
  }

  private _extractThoughtFromContent(content: string): string | undefined {
    if (!content) return undefined;
    // 1. Check <think>...</think>
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch && thinkMatch[1].trim()) {
      return thinkMatch[1].trim();
    }
    // 2. Check Thought: ... (up to Action: or end)
    const thoughtMatch = content.match(/Thought:\s*([\s\S]*?)(?=(?:Action:|$))/i);
    if (thoughtMatch && thoughtMatch[1].trim()) {
      return thoughtMatch[1].trim();
    }
    return undefined;
  }

  private _maybeInjectComputerUseTools(options: any, req: ChatRequest): void {
    const modelName = req.model ?? this.config.model;
    const lower = modelName.toLowerCase();
    const isGeminiModel = lower.includes('gemini');
    const isGpt5Model = lower.includes('gpt-5') || lower.includes('openai/gpt-5');
    const needsTools = (isGeminiModel || isGpt5Model) && !req.tools?.length &&
      (this.config.provider === 'everfern' || this.config.provider === 'openrouter');
    if (needsTools) {
      options.tools = GEMINI_COMPUTER_USE_TOOLS.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
      options.tool_choice = 'auto';
      // Token-saving: GPT-5.4 action responses are always short, cap to 512
      if (isGpt5Model) {
        options.max_tokens = Math.min(options.max_tokens ?? 4096, 512);
      }
    }
  }

  /**
   * Unified non-streaming chat entry point. Routes per provider — EverFern
   * Cloud pass-through/vision paths, OpenAI-SDK providers (NVIDIA NIM,
   * DeepSeek, OpenRouter, MiniMax, Ollama Cloud), Anthropic Messages,
   * Ollama native, and Gemini computer-use — defaulting to the
   * OpenAI-compatible HTTP path.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    console.log(`[AIClient] chat() called: provider=${this.config.provider}, model=${request.model ?? this.config.model}, hasOnStreamChunk=${!!request.onStreamChunk}, messages=${request.messages.length}`);
    this.assertProviderAuthReady();
    // LP-07: resolve the local default-model sentinel centrally before the
    // first send; a per-request 'local-model' (or missing) id falls back to the
    // resolved config model so the sentinel never reaches a strict server.
    await this._ensureLocalModelResolved();
    if (request.model === 'local-model' || request.model === '' || request.model === undefined) {
      request = { ...request, model: this.config.model };
    }
    // For EverFern Cloud, route vision requests using direct HTTP (not OpenAI SDK)
    if (this.config.provider === 'everfern') {
      const modelName = request.model ?? this.config.model;
      const isGeminiModel = modelName.toLowerCase().includes('gemini');
      const isGpt5Model = modelName.toLowerCase().includes('gpt-5') || modelName.toLowerCase().includes('openai/gpt-5');
      const isPassThroughModel = isGeminiModel || isGpt5Model;
      if (isPassThroughModel) {
        const isGemini3Flash = modelName.toLowerCase().includes('gemini-3-flash');
        if (isGemini3Flash) {
          // Gemini 3 Flash via EverFern Cloud: attempt primary, fall back to gemini-2.5-flash on failure
          const FALLBACK_MODEL = 'google/gemini-2.5-flash';
          let producedContent = false;
          try {
            console.log(`[EverFern Gemini] Trying primary model: ${modelName}`);
            const guardedRequest: ChatRequest = {
              ...request,
              onStreamChunk: (chunk: string) => {
                if (chunk) producedContent = true;
                request.onStreamChunk?.(chunk);
              }
            };
            const result = await this._openAISDKChat(guardedRequest);
            producedContent = true;
            // If empty content returned, treat as a soft failure and fall back
            const content = typeof result.content === 'string' ? result.content : '';
            if (!content.trim() && result.finishReason !== 'tool_calls') {
              // AI-CORR-01: zero-bytes-delivered guard — if any chunks were
              // already emitted via onStreamChunk, re-sending would duplicate
              // the reply. Propagate the result as-is instead of failing over.
              if (producedContent && request.onStreamChunk) {
                console.warn(`[EverFern Gemini] Primary model ${modelName} returned empty content after chunks were already delivered — not falling back to avoid duplicated reply`);
                return result;
              }
              console.warn(`[EverFern Gemini] Primary model ${modelName} returned empty content — falling back to ${FALLBACK_MODEL}`);
              const fallbackRequest = { ...request, model: FALLBACK_MODEL };
              return this._openAISDKChat(fallbackRequest);
            }
            return result;
          } catch (err: any) {
            if (producedContent) {
              console.warn(`[EverFern Gemini] Primary model ${modelName} failed after content was already produced (${err?.message ?? err}) — not falling back to avoid duplicated reply`);
              throw err;
            }
            console.warn(`[EverFern Gemini] Primary model ${modelName} failed (${err?.message ?? err}) — falling back to ${FALLBACK_MODEL}`);
            const fallbackRequest = { ...request, model: FALLBACK_MODEL };
            return this._openAISDKChat(fallbackRequest);
          }
        }
        if (isGpt5Model) {
          // GPT-5.4 via EverFern Cloud — token-optimized: cap to 512 tokens (actions are short)
          console.log(`[EverFern GPT-5] Routing ${modelName} via OpenAI SDK (max_tokens capped to 512)`);
          return this._openAISDKChat({ ...request, maxTokens: Math.min(request.maxTokens ?? 4096, 512) });
        }
        return this._openAISDKChat(request);
      }

      // Check if this is a vision request (has images)
      const hasImages = request.messages.some(m =>
        Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
      );

      // Only attempt the dedicated vision-grounding path for models that support it.
      // Chat models like fern-1 do NOT support image input — strip images and fall through.
      const modelLower = (request.model ?? this.config.model).toLowerCase();
      const modelSupportsVision = modelLower.includes('tars') || modelLower.startsWith('everfern') || modelLower.includes('qwen') || modelLower.includes('vl');

      if (hasImages && modelSupportsVision) {
        // Extract screenshot and objective from messages
        const lastMsg = request.messages[request.messages.length - 1];
        if (Array.isArray(lastMsg.content)) {
          const imageUrl = lastMsg.content.find(c => c.type === 'image_url')?.image_url?.url;
          const textContent = lastMsg.content.find(c => c.type === 'text')?.text || '';

          if (imageUrl) {
            try {
              // Use direct HTTP request to /api/chat/completions for computer use
              const baseUrl = this.config.baseUrl || 'https://api.everfern.app/api';
              const endpoint = baseUrl.endsWith('/api') ? `${baseUrl}/chat/completions` : (baseUrl.endsWith('/') ? `${baseUrl}api/chat/completions` : `${baseUrl}/api/chat/completions`);
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
                },
                body: JSON.stringify({
                  messages: request.messages,
                  model: CLOUD_MODEL_MAP[request.model ?? this.config.model] || (request.model ?? this.config.model),
                  temperature: request.temperature ?? this.config.temperature,
                  max_tokens: request.maxTokens ?? this.config.maxTokens
                })
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
              }

              const data = await response.json();
              if (!data.choices || !data.choices[0]) {
                throw new Error('No response from API');
              }

              const content = data.choices[0].message.content;

              // Extract real token usage from EverFern Cloud response for analytics
              const rawUsage = data.usage;
              const usageForAnalytics = rawUsage ? {
                promptTokens: rawUsage.prompt_tokens ?? 0,
                completionTokens: rawUsage.completion_tokens ?? 0,
                totalTokens: rawUsage.total_tokens ?? (rawUsage.prompt_tokens ?? 0) + (rawUsage.completion_tokens ?? 0),
                promptTokensCost: rawUsage.prompt_tokens_cost,
                completionTokensCost: rawUsage.completion_tokens_cost,
                imageInputCost: rawUsage.image_input_cost,
                imageOutputCost: rawUsage.image_output_cost,
                totalCost: rawUsage.total_cost,
              } : undefined;

              const message = data.choices[0].message;
              if (message.tool_calls && message.tool_calls.length > 0) {
                console.log('[EverFern Vision] Received native tool calls from EverFern Cloud:', message.tool_calls);
                return {
                  id: data.id || `everfern-${Date.now()}`,
                  content: message.content || '',
                  model: data.model || this.config.model,
                  toolCalls: message.tool_calls.map((tc: any) => ({
                    id: tc.id || `call_${Date.now()}`,
                    name: tc.function.name,
                    arguments: typeof tc.function.arguments === 'string'
                      ? JSON.parse(tc.function.arguments)
                      : tc.function.arguments
                  })),
                  usage: usageForAnalytics,
                  finishReason: 'tool_calls'
                };
              }

              // Parse actions and thoughts from the response
              const actions = this._parseActionsFromContent(content);
              const extractedThought = this._extractThoughtFromContent(content);

              console.log('[EverFern Vision] Parsed actions:', actions, 'Thought:', extractedThought);

              // If we have actions, return them as a computer_use tool call
              if (actions.length > 0) {
                console.log('[EverFern Vision] Creating computer_use tool call with', actions.length, 'actions');
                return {
                  id: data.id || `everfern-${Date.now()}`,
                  content: content,
                  model: data.model || this.config.model,
                  thought: extractedThought,
                  reasoning_content: extractedThought,
                  toolCalls: [{
                    id: `call_${Date.now()}`,
                    name: 'computer_use',
                    arguments: {
                      action: 'execute_actions',
                      actions: actions,
                      thought: extractedThought,
                      reasoning: extractedThought,
                    }
                  }],
                  usage: usageForAnalytics,
                  finishReason: 'tool_calls'
                };
              }

              // No actions, just return the content
              console.log('[EverFern Vision] No actions found, returning content only');
              return {
                id: data.id || `everfern-${Date.now()}`,
                content: content,
                model: data.model || this.config.model,
                thought: extractedThought,
                reasoning_content: extractedThought,
                usage: usageForAnalytics,
                finishReason: 'stop'
              };
            } catch (err) {
              console.error('[EverFern Cloud] Vision grounding failed:', err);
              throw err;
            }
          }
        }
      }

      if (hasImages && !modelSupportsVision) {
        // Model doesn't support images — strip image_url parts and send text-only
        console.warn(`[EverFern] Model ${request.model ?? this.config.model} does not support image input. Stripping images and continuing with text-only.`);
        const textOnlyMessages = request.messages.map(m => {
          if (!Array.isArray(m.content)) return m;
          const textParts = m.content.filter(c => c.type !== 'image_url');
          return {
            ...m,
            content: textParts.length === 1 && textParts[0]?.type === 'text'
              ? textParts[0].text  // flatten to plain string
              : textParts.length > 0 ? textParts : m.content
          };
        });
        return this._openAISDKChat({ ...request, messages: textOnlyMessages });
      }

      // For non-vision requests, use OpenAI SDK
      return this._openAISDKChat(request);
    }

    // Use OpenAI SDK for NVIDIA NIM, DeepSeek, OpenRouter, MiniMax and Ollama Cloud
    if (this.config.provider === 'nvidia' || this.config.provider === 'deepseek' || this.config.provider === 'openrouter' || this.config.provider === 'minimax' || this.config.provider === 'ollama-cloud') {
      return this._openAISDKChat(request);
    }

    switch (this.config.provider) {
      case 'anthropic': return this._anthropicChat(request);
      case 'ollama': return this._ollamaChat(request);
      case 'gemini': {
        const modelName = request.model ?? this.config.model;
        if (modelName.includes('computer-use') || modelName.includes('gemini-3-flash-preview') || modelName.includes('gemini-3-flash')) {
          return this._googleGeminiChat(request);
        }
        return this._openAICompatChat(request);
      }
      default: return this._openAICompatChat(request);
    }
  }

  /**
   * Streaming variant of chat(): async-generates StreamChunk deltas (text,
   * tool-call fragments, or the final done sentinel) as they arrive, with
   * the same per-provider routing as chat().
   */
  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    this.assertProviderAuthReady();
    // LP-07: resolve the local default-model sentinel before the first send
    // (mirrors chat()); per-request 'local-model' falls back to the resolved id.
    await this._ensureLocalModelResolved();
    if (request.model === 'local-model' || request.model === '' || request.model === undefined) {
      request = { ...request, model: this.config.model };
    }
    const modelName = request.model ?? this.config.model;
    const isGeminiModel = modelName.toLowerCase().includes('gemini');

    // For EverFern Cloud, route vision requests to /api/tars/vision
    if (this.config.provider === 'everfern') {
      if (isGeminiModel) {
        const isGemini3Flash = modelName.toLowerCase().includes('gemini-3-flash');
        if (isGemini3Flash) {
          // Gemini 3 Flash via EverFern Cloud: try primary, fall back to gemini-2.5-flash on error
          const FALLBACK_MODEL = 'google/gemini-2.5-flash';
          let yieldedAny = false;
          try {
            console.log(`[EverFern Gemini Stream] Trying primary model: ${modelName}`);
            const iterator = this._openAISDKStream(request);
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              yieldedAny = true;
              yield next.value;
            }
            return;
          } catch (err: any) {
            if (yieldedAny) {
              console.warn(`[EverFern Gemini Stream] Primary model ${modelName} failed mid-stream after chunks were already yielded (${err?.message ?? err}) — not falling back to avoid duplicated reply`);
              throw err;
            }
            console.warn(`[EverFern Gemini Stream] Primary model ${modelName} failed (${err?.message ?? err}) — falling back to ${FALLBACK_MODEL}`);
            const fallbackRequest = { ...request, model: FALLBACK_MODEL };
            yield* this._openAISDKStream(fallbackRequest);
            return;
          }
        }
        yield* this._openAISDKStream(request);
        return;
      }
      // Check if this is a vision request (has images)
      const hasImages = request.messages.some(m =>
        Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
      );

      if (hasImages) {
        // Extract screenshot and objective from messages
        const lastMsg = request.messages[request.messages.length - 1];
        if (Array.isArray(lastMsg.content)) {
          const imageUrl = lastMsg.content.find(c => c.type === 'image_url')?.image_url?.url;
          const textContent = lastMsg.content.find(c => c.type === 'text')?.text || '';

          if (imageUrl) {
            try {
              const result = await this.everfernCloudVisionGrounding({
                screenshot: imageUrl,
                objective: textContent,
                apiBaseUrl: 'https://api.everfern.app',
                token: this.config.apiKey
              });

              // Yield instruction as delta
              yield {
                id: `everfern-${Date.now()}`,
                delta: result.instruction,
                done: false,
                model: this.config.model
              };

              // Yield actions as tool calls
              for (const action of result.actions) {
                yield {
                  id: `everfern-${Date.now()}`,
                  delta: action,
                  done: false,
                  model: this.config.model,
                  toolCalls: [{ id: `call_${Math.random()}`, name: 'execute_action', arguments: { action } }]
                };
              }

              yield {
                id: `everfern-${Date.now()}`,
                delta: '',
                done: true,
                model: this.config.model
              };
              return;
            } catch (err) {
              console.error('[EverFern Cloud] Vision grounding failed:', err);
              throw err;
            }
          }
        }
      }

      // For non-vision requests, use OpenAI SDK
      yield* this._openAISDKStream(request);
      return;
    }

    // Use OpenAI SDK for NVIDIA NIM, DeepSeek, OpenRouter, MiniMax and Ollama Cloud
    if (this.config.provider === 'nvidia' || this.config.provider === 'deepseek' || this.config.provider === 'openrouter' || this.config.provider === 'minimax' || this.config.provider === 'ollama-cloud') {
      yield* this._openAISDKStream(request);
      return;
    }

    switch (this.config.provider) {
      case 'anthropic': yield* this._anthropicStream(request); break;
      case 'ollama': yield* this._ollamaStream(request); break;
      default: yield* this._openAICompatStream(request); break;
    }
  }

  // ── OpenAI SDK Methods (for NVIDIA NIM and Ollama Cloud) ────────

  private _mapMessagesForOpenAI(messages: ChatMessage[]): any[] {
    const supportsVision = this.supportsVision();

    let processedMessages = messages.flatMap(m => {
      let content = m.content;

       // Strip images if model doesn't support vision
      // Skip for NVIDIA tool messages — they're deferred via _images tag
      if (!supportsVision && Array.isArray(content)) {
        const isNvidiaTool = this.config.provider === 'nvidia' && m.role === 'tool';
        if (!isNvidiaTool) {
          content = content.filter(c => c.type !== 'image_url');
          if (content.length === 0) content = '[An image was included in this message, but the current model cannot process images. To enable image analysis, switch to a vision-capable model or configure a VLM in Settings.]';
        }
      } else if (supportsVision && Array.isArray(content)) {
        content = content.map(c => {
          if (c.type === 'image_url' && c.image_url) {
            const isStandardProvider = this.config.provider === 'openai' || this.config.provider === 'anthropic' || this.config.provider === 'gemini';
            if (!isStandardProvider) {
              // Strip detail from image_url to avoid compatibility errors in custom API endpoints
              return {
                type: 'image_url',
                image_url: {
                  url: c.image_url.url
                }
              };
            }
          }
          return c;
        });
      }

      // Flatten assistant/system messages to prevent format errors on strict APIs (Nvidia, Ollama Cloud, etc.)
      if (m.role === 'assistant' || m.role === 'system') {
        content = typeof m.content === 'string'
          ? m.content
          : m.content.filter(c => c.type === 'text').map(c => 'text' in c ? c.text : '').join('\n');
      }

      // Nvidia NIM/OpenAI strict validation:
      if (this.config.provider === 'nvidia') {
        // Tool responses CANNOT contain image_url blocks in strict OpenAI schemas (like NIM).
        // We must defer the image into a subsequent user message AFTER all tools.
        if (m.role === 'tool' && Array.isArray(m.content)) {
          const hasImages = m.content.some(c => c.type === 'image_url');
          if (hasImages) {
            const textContent = m.content.filter(c => c.type === 'text').map(c => 'text' in c ? c.text : '').join('\n');
            const imageChunks = m.content.filter(c => c.type === 'image_url');

            const toolMsg: any = {
              role: 'tool',
              content: textContent || 'Action complete.',
              _images: imageChunks // Tag for second pass
            };
            if (m.tool_call_id) toolMsg.tool_call_id = m.tool_call_id;

            return [toolMsg];
          }
        }
      }

      const msg: any = { role: m.role, content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc, idx) => ({
          id: tc.id || `call${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) }
        }));
      }

      // Additional standard formatting for roles
      if (m.role === 'system') {
        msg.content = typeof content === 'string' ? content : JSON.stringify(content);
      } else if (m.role === 'tool') {
        msg.content = typeof content === 'string' ? content : JSON.stringify(content);
        msg.tool_call_id = m.tool_call_id || 'call1234567890abcdef';
      }

      return [msg];
    });

    // Final Role-Alternation Pass for NVIDIA NIM and Minimax
    if (this.config.provider === 'nvidia' || this.config.provider === 'minimax') {
      const finalMessages: any[] = [];
      const seenToolCallIds = new Set<string>();
      let pendingImages: any[] = [];
      let hasAssistantSeen = false;

      for (let i = 0; i < processedMessages.length; i++) {
        let m = processedMessages[i];

        // Collect images from tool messages and remove the internal tag
        if (m.role === 'tool' && m._images) {
          pendingImages.push(...m._images);
          delete m._images;
        }

        if (m.role === 'assistant') {
          hasAssistantSeen = true;

          // NIM specific: Move reasoning_content to content if content is empty.
          // NIM (and most OpenAI models) reject empty assistant content unless tool_calls are present.
          if (!m.content && m.reasoning_content && (!m.tool_calls || m.tool_calls.length === 0)) {
            m.content = `<think>${m.reasoning_content}</think>`;
          }

          // Final safety: Ensure no assistant message has empty content AND no tool calls.
          if (!m.content && (!m.tool_calls || m.tool_calls.length === 0)) {
            m.content = 'Action acknowledged.';
          }
        }

        let last = finalMessages[finalMessages.length - 1];

        if (last) {
          // Rule: Bridge Tool -> User gap or Handle pending images
          // If we are exiting a tool block and have pending images, inject them
          if (last.role === 'tool' && m.role !== 'tool' && pendingImages.length > 0) {
            if (this.supportsVision()) {
              finalMessages.push({ role: 'assistant', content: 'Action completed.' });
              last = {
                role: 'user',
                content: [
                  { type: 'text', text: 'Screenshot(s) provided from the system:' },
                  ...pendingImages
                ]
              };
              finalMessages.push(last);
            }
            pendingImages = [];
            // Continue to evaluate the current 'm' against this new 'last'
          }

          // Rule: NVIDIA NIM strictly prohibits 'system' messages after the first message.
          // We must convert mid-conversation system messages to 'user' messages.
          if (m.role === 'system') {
            m.role = 'user';
            m.content = `[SYSTEM INSTRUCTION]: ${m.content}`;
          }

          // Rule: Ensure valid role after 'system'. NIM usually expects 'user'.
          if (last.role === 'system' && m.role !== 'user') {
            // If it's a tool after system, we MUST drop it as it's an orphan from slicing.
            if (m.role === 'tool') {
              console.warn(`[AIClient] Dropping orphan tool message after system to prevent 400 error.`);
              continue;
            }
            // If it's assistant after system, NIM might accept it but user is safer.
            // We'll inject a dummy user message.
            finalMessages.push({ role: 'user', content: 'Please continue.' });
            last = finalMessages[finalMessages.length - 1];
          }

          // Rule: Drop tool messages if we haven't seen an assistant message yet in this history slice.
          // (They are orphans from context window slicing).
          if (m.role === 'tool' && !hasAssistantSeen) {
            console.warn(`[AIClient] Dropping orphan tool message (no assistant parent in slice).`);
            continue;
          }

          // Rule: Deduplicate Tool results by ID
          if (m.role === 'tool' && m.tool_call_id) {
            if (seenToolCallIds.has(m.tool_call_id)) {
              console.warn(`[AIClient] Dropping duplicate tool result for ID: ${m.tool_call_id}`);
              continue;
            }
            seenToolCallIds.add(m.tool_call_id);
          }

          // Rule 1: Bridge Tool -> User gap (if not already handled by vision injection)
          if (last.role === 'tool' && m.role === 'user') {
            finalMessages.push({ role: 'assistant', content: 'Action completed.' });
          }
          // Rule 2: Merge consecutive messages of the same role (except 'tool' which can be multiple)
          else if (last.role === m.role && (m.role === 'user' || m.role === 'assistant')) {
            if (typeof last.content === 'string' && typeof m.content === 'string') {
              last.content = last.content + '\n' + m.content;
            } else {
              const content1 = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
              const content2 = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
              last.content = [...content1, ...content2];
            }
            if (m.tool_calls) {
              const existingCalls = last.tool_calls || [];
              const newCalls = m.tool_calls.filter((nc: any) => !existingCalls.some((ec: any) => ec.id === nc.id));
              last.tool_calls = [...existingCalls, ...newCalls];
            }
            continue;
          }
        } else {
          // First message
          if (m.role === 'tool') {
            // A tool message cannot be the first message. Drop it.
            console.warn(`[AIClient] Dropping first message as it is 'tool'.`);
            continue;
          }
          if (m.role === 'tool' && m.tool_call_id) {
            seenToolCallIds.add(m.tool_call_id);
          }
        }
        finalMessages.push(m);
      }

      // Final check for pending images at the end of conversation
      if (pendingImages.length > 0 && !this.supportsVision()) {
        console.warn(`[AIClient] Dropping ${pendingImages.length} pending image(s) — model does not support vision`);
        pendingImages = [];
      }
      if (pendingImages.length > 0) {
        finalMessages.push({ role: 'assistant', content: 'Action completed.' });
        finalMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Screenshot(s) provided from the system:' },
            ...pendingImages
          ]
        });
      }

      // Final synchronization pass for NVIDIA NIM:
      // Ensure EVERY tool call ID in an assistant message has a corresponding 'tool' response following it.
      const syncMessages: any[] = [];
      const outstandingIds = new Set<string>();
      for (const m of finalMessages) {
        // If we see a non-tool message but have outstanding tool calls, we MUST close them first.
        if (m.role !== 'tool' && outstandingIds.size > 0) {
          for (const id of outstandingIds) {
            console.warn(`[AIClient] Injecting missing tool response for ID: ${id} to satisfy NIM strictness.`);
            syncMessages.push({
              role: 'tool',
              tool_call_id: id,
              content: 'Action acknowledged.'
            });
          }
          outstandingIds.clear();

          // If the message we are about to push is a 'user' message, bridge the gap
          if (m.role === 'user') {
            syncMessages.push({ role: 'assistant', content: 'Action completed.' });
          }
        }

        if (m.role === 'assistant' && m.tool_calls) {
          for (const tc of m.tool_calls) {
            outstandingIds.add(tc.id);
          }
        } else if (m.role === 'tool' && m.tool_call_id) {
          if (!outstandingIds.has(m.tool_call_id)) {
            // This is an orphan tool message with no call in this slice.
            // Strict NIM usually rejects this. We'll drop it.
            console.warn(`[AIClient] Dropping orphan tool result (ID: ${m.tool_call_id}) with no preceding call.`);
            continue;
          }
          outstandingIds.delete(m.tool_call_id);
        }

        syncMessages.push(m);
      }

      // Close any remaining outstanding IDs at the very end
      for (const id of outstandingIds) {
        syncMessages.push({
          role: 'tool',
          tool_call_id: id,
          content: 'Action acknowledged.'
        });
      }

      processedMessages = syncMessages;
    }

    // NVIDIA NIM (and OpenAI-compatible HF-templated endpoints) require that the
    // last message is NOT from the assistant, otherwise the server-side HF chat
    // template raises: "Cannot set add_generation_prompt to True when the last
    // message is from the assistant."
    if ((this.config.provider === 'nvidia' || this.config.provider === 'minimax') && processedMessages.length > 0) {
      const last = processedMessages[processedMessages.length - 1];
      if (last.role === 'assistant' && (!last.tool_calls || last.tool_calls.length === 0)) {
        console.warn('[AIClient] Stripping trailing assistant message for NVIDIA NIM HF template compatibility');
        processedMessages.pop();
      }

      if (processedMessages.length === 0) {
        processedMessages.push({ role: 'user', content: 'Please continue.' });
      }
    }

    if (this.config.provider === 'minimax') {
      processedMessages = processedMessages.map(m => {
        if (m.tool_call_id) {
          m.tool_call_id = String(m.tool_call_id).replace(/[^a-zA-Z0-9]/g, '');
        }
        if (m.tool_calls) {
          m.tool_calls.forEach((tc: any) => {
            if (tc.id) tc.id = String(tc.id).replace(/[^a-zA-Z0-9]/g, '');
          });
        }
        return m;
      });
    }

    return processedMessages;
  }

  private async _openAISDKChat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized for ' + this.config.provider);
    }

    const isStreaming = !!req.onStreamChunk;
    console.log(`[AIClient] _openAISDKChat called: provider=${this.config.provider}, model=${req.model ?? this.config.model}, isStreaming=${isStreaming}, messages=${req.messages.length}`);
    const messages = this._mapMessagesForOpenAI(req.messages);

    // Build request options
    let model = req.model ?? this.config.model;
    if (this.config.provider === 'everfern') {
      model = CLOUD_MODEL_MAP[model] || model;
    }

    const options: any = {
      model,
      messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: isStreaming
    };

    this._maybeInjectComputerUseTools(options, req);

    if (req.reasoningEffort) {
      if (req.reasoningEffort === 'ultra' || req.reasoningEffort === 'ultra-delegate') {
        options.reasoning_effort = 'high';
      } else {
        options.reasoning_effort = req.reasoningEffort;
      }
    }

    // Helper function for retrying with exponential backoff
    // Retry policy: 5xx/timeout/reset errors plus (opt-in) SDK JSON parse
    // failures — a truncated non-stream response can parse as JSON garbage,
    // hence retryOnJsonError for the non-streaming path.
    const retryWithBackoff = async <T>(
      fn: () => Promise<T>,
      maxRetries = 3,
      baseDelayMs = 1000,
      retryOnJsonError = false
    ): Promise<T> => {
      let lastError: any;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err: any) {
          lastError = err;
          // Retry on 500, 502, 503, 504 errors or timeout
          const status = err.status;
          const isRetryable = status >= 500 || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
          const isJsonError = retryOnJsonError && err instanceof SyntaxError && err.message?.includes('JSON');
          if ((!isRetryable && !isJsonError) || attempt === maxRetries - 1) {
            throw err;
          }
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          console.warn(`[AIClient] Request failed (${isJsonError ? 'JSON parse' : `status ${status}`}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
      throw lastError;
    };

    // Add NVIDIA-specific parameters
    if (this.config.provider === 'nvidia') {
      const modelName = req.model ?? this.config.model;
      if (modelName?.includes('qwen')) {
        options.chat_template_kwargs = { enable_thinking: true };
        options.temperature = req.temperature ?? 0.6;
        options.top_p = 0.95;
      } else if (modelName?.includes('glm')) {
        options.chat_template_kwargs = { enable_thinking: true, clear_thinking: false };
      } else if (modelName?.includes('kimi')) {
        options.chat_template_kwargs = { thinking: true };
      } else if (modelName?.includes('mistral')) {
        options.reasoning_effort = 'medium';
        options.max_tokens = req.maxTokens ?? 16384;
        options.temperature = req.temperature ?? 0.10;
        options.top_p = 1.0;
      } else if (modelName?.includes('gemma')) {
        options.chat_template_kwargs = { enable_thinking: true };
        options.max_tokens = req.maxTokens ?? 16384;
        options.temperature = req.temperature ?? 1.0;
        options.top_p = 0.95;
      }
    }

    // Add tools if provided
    if (req.tools?.length) {
      options.tools = req.tools.map(t => {
        if (t && (t as any).type === 'function' && (t as any).function) {
          return t;
        }
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        };
      });
      // Use provided toolChoice or default to 'auto'
      options.tool_choice = req.toolChoice || 'auto';
    }

    // Add JSON response format
    if (req.responseFormat === 'json') {
      if (this.config.provider === 'nvidia' && req.guidedJson) {
        options.nvext = { guided_json: req.guidedJson };
      } else if (this.config.provider === 'everfern') {
        // EverFern Cloud models (like fern-1) may not support response_format: json_object.
        // Instead, inject the JSON schema into the prompt (like Ollama fallback).
        // Only set response_format for models known to support it.
        const modelLower = (req.model ?? this.config.model).toLowerCase();
        const supportsResponseFormat = modelLower.includes('gemini') || modelLower.includes('gpt');
        if (supportsResponseFormat) {
          options.response_format = { type: 'json_object' };
        }
        // Schema injection is handled below for all providers
      } else {
        options.response_format = { type: 'json_object' };
      }
    }

    // Inject JSON schema into prompt for providers that don't support structured output natively
    if (req.jsonSchema && this.config.provider !== 'nvidia' && this.config.provider !== 'openai') {
      const schemaHint = `\n\nIMPORTANT: You MUST respond with a JSON object that matches this schema:\n${JSON.stringify(req.jsonSchema, null, 2)}\n\nReturn ONLY valid JSON matching this schema. No extra text, no markdown fences.`;
      const sysIdx = messages.findIndex((m: any) => m.role === 'system');
      if (sysIdx !== -1) {
        messages[sysIdx] = { ...messages[sysIdx], content: (messages[sysIdx].content || '') + schemaHint };
      } else {
        messages.unshift({ role: 'system', content: schemaHint });
      }
    }

    try {
      DebugEmitter.emit('log', 'OpenAI SDK Call', {
        provider: this.config.provider,
        model: options.model,
        messageCount: messages.length
      });

      if (isStreaming) {
        // Streaming mode - cast through unknown to handle type mismatch
        const stream = await retryWithBackoff(() =>
          this.openaiClient!.chat.completions.create({
            ...options,
            // AI-CORR-02: thread the caller's abort signal into the SDK request
            ...(req.abortSignal && { signal: req.abortSignal }),
            stream: true,
            stream_options: { include_usage: true }
          }) as unknown as Promise<AsyncIterable<any>>
        );

        let fullContent = '';
        let fullReasoning = '';
        const thinkState = { inThinking: false };
        const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
        let finishReason: any = 'stop';
        let responseId = `${this.config.provider}-${Date.now()}`;
        let finalUsage: any = undefined;

        for await (const chunk of stream) {
          // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
          // AbortError-named rejection so runner cleanup is uniform.
          if (req.abortSignal?.aborted) {
            throw new DOMException('Stream aborted by user', 'AbortError');
          }
          if (chunk.id) responseId = chunk.id;
          if (chunk.usage) {
            finalUsage = chunk.usage;
          }
          const delta = chunk.choices?.[0]?.delta;

          if ((delta as any)?.reasoning_content) {
            const piece = (delta as any).reasoning_content as string;
            fullReasoning += piece;
            if (!thinkState.inThinking) {
              thinkState.inThinking = true;
              req.onStreamChunk?.(`<think>${piece}`);
            } else {
              req.onStreamChunk?.(piece);
            }
          } else if (delta?.content && thinkState.inThinking) {
            thinkState.inThinking = false;
            req.onStreamChunk?.('</think>');
          }

          if (delta?.content) {
            fullContent += delta.content;
            req.onStreamChunk!(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCallsMap[tc.index]) {
                  toolCallsMap[tc.index] = { id: '', name: '', arguments: '' };
                }
                const entry = toolCallsMap[tc.index];
                if (tc.id) entry.id = tc.id;
                
                const name = tc.function?.name || tc.name || '';
                const args = tc.function?.arguments || tc.arguments || '';
                
                entry.name += name;
                entry.arguments += args;
              }
            }
          }

          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
        }

        if (thinkState.inThinking) {
          thinkState.inThinking = false;
          req.onStreamChunk?.('</think>');
        }

        const toolCalls = Object.values(toolCallsMap).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: safeParseJSON(tc.arguments)
        }));

        return {
          id: responseId,
          content: fullContent,
          reasoning_content: fullReasoning || undefined,
          model: this.config.model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: finalUsage ? {
            promptTokens: finalUsage.prompt_tokens,
            completionTokens: finalUsage.completion_tokens,
            totalTokens: finalUsage.total_tokens,
            promptTokensCost: finalUsage.prompt_tokens_cost,
            completionTokensCost: finalUsage.completion_tokens_cost,
            imageInputCost: finalUsage.image_input_cost,
            imageOutputCost: finalUsage.image_output_cost,
            totalCost: finalUsage.total_cost,
          } : undefined,
          finishReason: finishReason === 'tool_calls' || toolCalls.length > 0 ? 'tool_calls' : 'stop'
        };
      } else {
        // Non-streaming mode — retry on JSON parse errors too
        const response = await retryWithBackoff(() =>
          this.openaiClient!.chat.completions.create({
            ...options,
            // AI-CORR-02: thread the caller's abort signal into the SDK request
            ...(req.abortSignal && { signal: req.abortSignal }),
          }) as Promise<any>,
          3, 1000, true // true = retry on JSON parse errors
        );
        const choice = response.choices?.[0];
        const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name || tc.name,
          arguments: safeParseJSON(tc.function?.arguments || tc.arguments)
        }));

        return {
          id: response.id,
          content: choice?.message?.content ?? '',
          reasoning_content: (choice?.message as any)?.reasoning_content,
          model: response.model,
          toolCalls,
          usage: response.usage ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            promptTokensCost: response.usage.prompt_tokens_cost,
            completionTokensCost: response.usage.completion_tokens_cost,
            imageInputCost: response.usage.image_input_cost,
            imageOutputCost: response.usage.image_output_cost,
            totalCost: response.usage.total_cost,
          } : undefined,
          finishReason: choice?.finish_reason === 'tool_calls' || toolCalls?.length > 0 ? 'tool_calls' :
            (choice?.finish_reason as ChatResponse['finishReason']) ?? 'stop'
        };
      }
    } catch (err: any) {
      console.error(`[${this.config.provider}] OpenAI SDK Error:`, err);

      if (this.config.provider === 'minimax' && err.status === 401) {
        throw new Error(
          'MiniMax authentication failed. Check that the MiniMax API key saved in Settings > Vision Grounding > MiniMax API is correct and active.'
        );
      }

      // Log detailed error info for debugging
      if (err.status === 500) {
        console.error(`[${this.config.provider}] 500 Error Details:`, {
          requestID: err.requestID,
          error: err.error,
          provider: this.config.provider,
          model: this.config.model,
          baseUrl: this.config.baseUrl,
          messageCount: messages.length
        });
      }
      throw err;
    }
  }

  private async *_openAISDKStream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized for ' + this.config.provider);
    }

    const messages = this._mapMessagesForOpenAI(req.messages);

    let model = req.model ?? this.config.model;
    if (this.config.provider === 'everfern') {
      model = CLOUD_MODEL_MAP[model] || model;
    }

    const options: any = {
      model,
      messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: true
    };

    this._maybeInjectComputerUseTools(options, req);

    if (req.reasoningEffort) {
      if (req.reasoningEffort === 'ultra' || req.reasoningEffort === 'ultra-delegate') {
        options.reasoning_effort = 'high';
      } else {
        options.reasoning_effort = req.reasoningEffort;
      }
    }

    if (req.tools?.length) {
      options.tools = req.tools.map(t => {
        if (t && (t as any).type === 'function' && (t as any).function) {
          return t;
        }
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        };
      });
      options.tool_choice = 'auto';
    }

    if (req.responseFormat === 'json') {
      if (this.config.provider === 'nvidia' && req.guidedJson) {
        options.nvext = { guided_json: req.guidedJson };
      } else {
        options.response_format = { type: 'json_object' };
      }
    }

    try {
      // Helper function for retrying with exponential backoff
      // Only the create() call is wrapped — once chunks are yielded, a retry
      // can't replay the partial output already handed to the consumer.
      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        maxRetries = 3,
        baseDelayMs = 1000
      ): Promise<T> => {
        let lastError: any;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err: any) {
            lastError = err;
            // Retry on 500, 502, 503, 504 errors or timeout
            const status = err.status;
            const isRetryable = status >= 500 || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
            if (!isRetryable || attempt === maxRetries - 1) {
              throw err;
            }
            const delayMs = baseDelayMs * Math.pow(2, attempt);
            console.warn(`[AIClient] Stream request failed with status ${status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
        throw lastError;
      };

      const stream = await retryWithBackoff(() =>
        this.openaiClient!.chat.completions.create({
          ...options,
          // AI-CORR-02: thread the caller's abort signal into the SDK request
          ...(req.abortSignal && { signal: req.abortSignal }),
        }) as unknown as Promise<AsyncIterable<any>>
      );
      let id = `${this.config.provider}-${Date.now()}`;
      const thinkState = { inThinking: false };

      for await (const chunk of stream) {
        // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
        // AbortError-named rejection so runner cleanup is uniform.
        if (req.abortSignal?.aborted) {
          throw new DOMException('Stream aborted by user', 'AbortError');
        }
        if (chunk.id) id = chunk.id;
        const delta = chunk.choices?.[0]?.delta;

        if ((delta as any)?.reasoning_content) {
          const piece = (delta as any).reasoning_content as string;
          if (!thinkState.inThinking) {
            thinkState.inThinking = true;
            yield { id, delta: `<think>${piece}`, done: false, model: chunk.model };
          } else {
            yield { id, delta: piece, done: false, model: chunk.model };
          }
        }

        if (delta?.content && thinkState.inThinking) {
          thinkState.inThinking = false;
          yield { id, delta: '</think>', done: false };
        }

        if (delta?.content || delta?.tool_calls) {
          yield {
            id,
            delta: delta?.content ?? '',
            toolCalls: delta?.tool_calls,
            done: false,
            model: chunk.model
          };
        }

        if (chunk.choices?.[0]?.finish_reason) {
          if (thinkState.inThinking) {
            thinkState.inThinking = false;
            yield { id, delta: '</think>', done: false };
          }
          yield { id, delta: '', done: true };
          return;
        }
      }
    } catch (err) {
      console.error(`[${this.config.provider}] OpenAI SDK Stream Error:`, err);
      if (this.config.provider === 'minimax' && (err as any)?.status === 401) {
        throw new Error(
          'MiniMax authentication failed. Check that the MiniMax API key saved in Settings > Vision Grounding > MiniMax API is correct and active.'
        );
      }
      throw err;
    }
  }

  /**
   * LP-07: resolve the 'local-model' sentinel (or an empty model id) to the
   * first model id the local daemon reports, before the first send. Cached
   * per baseUrl for the process lifetime so repeated clients skip re-probing.
   * If the daemon reports no models, fails with the actionable LP-02-style
   * error instead of sending the literal 'local-model' to strict servers.
   * No-op for non-local providers and already-concrete model ids.
   */
  private async _ensureLocalModelResolved(): Promise<void> {
    if (this.localModelResolved) return;
    if (this.config.provider !== 'lmstudio' && this.config.provider !== 'ollama') {
      this.localModelResolved = true;
      return;
    }
    const current = this.config.model ?? '';
    if (current && current !== 'local-model') {
      this.localModelResolved = true;
      return;
    }
    // LP-07: mark resolved up-front so a throwing listModels probe can never
    // re-enter (listModels does not call chat, but the guard is cheap).
    this.localModelResolved = true;

    const providerLabel = this.config.provider === 'ollama' ? 'Ollama' : 'LM Studio';
    const cached = AIClient.resolvedLocalDefaultModels.get(this.config.baseUrl);
    if (cached) {
      this.config.model = cached;
      return;
    }
    try {
      const models = await this.listModels();
      if (models.length > 0) {
        AIClient.resolvedLocalDefaultModels.set(this.config.baseUrl, models[0]);
        this.config.model = models[0];
        console.log(`[AIClient] LP-07: resolved local default model to '${models[0]}' (was '${current || '(empty)'}')`);
        return;
      }
      // LP-07: empty model list — surface an actionable error, never send the
      // 'local-model' sentinel verbatim (rejected unless the daemon JIT-loads).
      throw new Error(
        `${providerLabel} reports no models loaded at ${this.config.baseUrl}. Load a model in ${providerLabel} (or pick one in Settings → Local AI), then retry.`
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('reports no models loaded')) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${providerLabel} could not list models at ${this.config.baseUrl} (${detail}). Start the server or fix Settings → Base URL, then retry.`
      );
    }
  }

  /**
   * LP-04: cached per-model tools-capability probe for local OpenAI-compat
   * servers (LM Studio /v1/models exposes `capabilities.tools`). Absent
   * capabilities or a failed probe are treated as supported (= current
   * behavior, no regression); only an explicit false/0 is definitive and
   * cached for the process lifetime. Ollama native is skipped (/api/tags
   * exposes no capabilities field).
   */
  private async _localModelSupportsTools(model: string): Promise<boolean> {
    const key = `${this.config.baseUrl}|${model}`;
    const cached = localToolsCapabilityCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const res = await this._fetchWithRetry(
        `${normalizeLocalUrl(this.config.baseUrl) ?? this.config.baseUrl}/models`,
        { headers: this._oaiHeaders },
        0
      );
      if (!res.ok) return true; // inconclusive → current behavior (tools + nudges)
      const data: any = await res.json();
      const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      const entry = rawModels.find((mm: any) => mm?.id === model || mm?.name === model);
      const caps = entry?.capabilities;
      if (!caps || typeof caps !== 'object') return true; // absent → assume supported, uncached (re-probe later)
      const toolsCap = caps.tools;
      if (toolsCap !== false && toolsCap !== 0) return true; // definitive support — cache below
      const supported = !(toolsCap === false || toolsCap === 0);
      localToolsCapabilityCache.set(key, supported);
      console.warn(`[AIClient] LP-04: model '${model}' reports no native tool support — using prompt-embedded tool JSON instead of the nudge loop.`);
      return supported;
    } catch {
      return true; // probe unreachable → current behavior (tools + nudges)
    }
  }

  /** LP-04: instruction appended to the system message when tools are embedded in the prompt. */
  private _embeddedToolsInstruction(tools: ToolDefinition[]): string {
    const roster = tools
      .map(t => `- ${t.name}: ${t.description} (arguments JSON schema: ${JSON.stringify(t.parameters)})`)
      .join('\n');
    return [
      'This server does not support native tool-calling. The available tools are listed below.',
      'When you decide to call a tool, reply with ONLY a single fenced JSON code block in exactly this format:',
      '```json',
      '{"tool": "<tool name>", "arguments": {<arguments object matching the tool schema>}}',
      '```',
      'If no tool is needed, answer normally in plain text (or reply {"tool":"none","arguments":{}}). Do not narrate tool usage in prose.',
      'Available tools:',
      roster,
    ].join('\n');
  }

  /**
   * LP-04: append the embedded-tools instruction to the system message (or
   * prepend a fresh system message when none exists). Mutates the messages
   * array in place — the request body holds the same reference.
   */
  private _injectEmbeddedToolsInstruction(messages: any[], tools: ToolDefinition[]): void {
    const instruction = this._embeddedToolsInstruction(tools);
    const sysIdx = messages.findIndex(mm => mm?.role === 'system');
    if (sysIdx !== -1) {
      const sys = messages[sysIdx];
      if (typeof sys.content === 'string') {
        sys.content = sys.content + '\n\n' + instruction;
      } else if (Array.isArray(sys.content)) {
        sys.content = [...sys.content, { type: 'text', text: instruction }];
      } else {
        sys.content = instruction;
      }
    } else {
      messages.unshift({ role: 'system', content: instruction });
    }
  }

  /**
   * LP-12: adaptive num_ctx — configurable via config.ollamaNumCtx, otherwise
   * clamp(ceil(estTokens×1.5), 2048, 16384) so 8 GB GPUs avoid forced KV spill.
   * Warns when the estimated prompt exceeds the effective context (Ollama
   * silently left-truncates long prompts otherwise).
   */
  private _adaptiveOllamaNumCtx(messages: any[]): number {
    const estTokens = estimatePromptTokens(messages);
    const numCtx = this.config.ollamaNumCtx ?? Math.min(16384, Math.max(2048, Math.ceil(estTokens * 1.5)));
    if (estTokens > numCtx) {
      console.warn(
        `[Ollama] LP-12: prompt-token estimate ${estTokens} exceeds num_ctx ${numCtx} — Ollama will left-truncate the prompt silently. Reduce context or raise ollamaNumCtx.`
      );
    }
    return numCtx;
  }

  /** List model IDs exposed by the provider (per-provider endpoint/format). */
  async listModels(): Promise<string[]> {
    switch (this.config.provider) {
      case 'ollama': return this._ollamaListModels();
      case 'anthropic': return this._anthropicListModels();
      default: return this._openAICompatListModels();
    }
  }

  /** Connectivity probe via listModels(): reports ok plus round-trip latencyMs (and a reason when no models respond). */
  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string; reason?: string }> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      if (models.length === 0) {
        return { ok: models.length > 0, reason: 'No models reported — is the server running?', latencyMs: Date.now() - start };
      }
      return { ok: models.length > 0, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * AI-CORR-02: builds a composite abort signal that fires when EITHER the
   * per-attempt timeout controller aborts (existing behavior) OR the caller's
   * request abortSignal aborts. Returns undefined when no caller signal exists,
   * keeping the pre-existing timeout-only behavior byte-for-byte.
   * Node 20.3+/Electron's Node 22 provide AbortSignal.any; if it is somehow
   * unavailable we mirror the caller's abort onto the timeout controller.
   */
  /**
   * XI.C: parse a 429 response's Retry-After header (seconds or HTTP date)
   * into milliseconds; null when absent/unparseable. Mirrors the value
   * semantics of retry-logic.ts extractRateLimitWaitTime but reads directly
   * from the Response object in the fetch retry loop.
   */
  private _parseRetryAfterHeader(res: Response): number | null {
    try {
      const v = res.headers?.get?.('retry-after');
      if (!v) return null;
      const asNum = Number(v);
      if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum * 1000);
      const asDate = Date.parse(v);
      if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    } catch { /* headers unavailable */ }
    return null;
  }

  private _composeAbortSignals(timeoutController: AbortController, abortSignal?: AbortSignal): AbortSignal | undefined {
    if (!abortSignal) return undefined;
    const timeoutSignal = timeoutController.signal;
    if (typeof (AbortSignal as any).any === 'function') {
      return (AbortSignal as any).any([timeoutSignal, abortSignal]);
    }
    if (abortSignal.aborted) {
      return abortSignal;
    }
    // No AbortSignal.any — compose a fresh controller mirroring BOTH sources
    // (the internal fetch timeout and the caller's user abort).
    const composite = new AbortController();
    const relay = (reason?: any) => {
      if (!composite.signal.aborted) composite.abort(reason);
    };
    if (timeoutSignal.aborted) {
      relay(timeoutSignal.reason);
    } else {
      timeoutSignal.addEventListener('abort', () => relay(timeoutSignal.reason), { once: true });
    }
    abortSignal.addEventListener('abort', () => relay(abortSignal.reason), { once: true });
    return composite.signal;
  }

  /**
   * AI-CORR-02: fetch wrapper with bounded retries and exponential backoff
   * (1s doubling + jitter). Retries 429/5xx responses and network errors, but
   * NEVER a user abort, and skips retries entirely for offline local daemons.
   * `abortSignal` (when provided) both fail-fasts the loop and aborts the
   * in-flight fetch via a composite signal with the per-attempt timeout.
   */
  private async _fetchWithRetry(url: string, options: RequestInit, maxRetries = 3, abortSignal?: AbortSignal): Promise<Response> {
    // Normalize loopback hosts (::1/localhost → 127.0.0.1) so Node fetch doesn't dial IPv6 first
    const requestUrl = normalizeLocalUrl(url) ?? url;
    // LP-05: local requests never spend more than 1 retry — the audit's 6×
    // 5xx retry loop was ≈47s dead air plus 7× prompt processing on a local
    // model. Cloud keeps the caller-supplied matrix untouched.
    const isLocalRequest = this.isLocal() || requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1');
    const effectiveMaxRetries = isLocalRequest ? Math.min(maxRetries, 1) : maxRetries;
    maxRetries = effectiveMaxRetries;
    let lastError: Error | null = null;
    let delay = 1000; // Start with 1s instead of 2s for faster initial retry

    for (let i = 0; i <= maxRetries; i++) {
      try {
        // AI-CORR-02: user-requested abort is never retried — fail fast with a
        // DOMException AbortError so runner cleanup is uniform.
        if (abortSignal?.aborted) {
          throw new DOMException('Request aborted by user', 'AbortError');
        }

        if (requestUrl.includes('nvidia') || i > 0) {
          console.log(`[AIClient] Fetching: ${requestUrl} (Attempt ${i + 1}/${maxRetries + 1})`);
        }

        // Fresh controller per attempt so a timeout on attempt N can't poison
        // attempt N+1 (the timer/signal are attempt-scoped by design).
        const controller = new AbortController();
        // LP-05: 15s per local non-stream attempt (was 300s). Whole-request
        // timeouts would kill healthy local STREAMING generations, so
        // bodies declaring "stream":true keep the cloud-style 60s ceiling.
        const isStreamBody = typeof options.body === 'string' && options.body.includes('"stream":true');
        const timeoutMs = isLocalRequest
          ? (isStreamBody ? CLOUD_FETCH_TIMEOUT_MS : LOCAL_FETCH_TIMEOUT_MS)
          : CLOUD_FETCH_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // AI-CORR-02: thread the caller's abortSignal through to fetch — the
        // composite fires on either the internal timeout or the user abort.
        const compositeSignal = this._composeAbortSignals(controller, abortSignal);
        const enhancedOptions: RequestInit = {
          ...options,
          signal: compositeSignal ?? controller.signal,
          headers: {
            ...options.headers,
            'User-Agent': 'EverFern/1.0'
          },
          // Disable keep-alive to avoid Node 22 undici "invalid keep-alive header" errors
          // from NVIDIA NIM and other providers that may send malformed keep-alive responses.
          keepalive: false
        };

        try {
          const res = await fetch(requestUrl, enhancedOptions);
          clearTimeout(timeoutId);

          if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            // LP-05: local 5xx (incl. context-overflow errors) is a hard fault —
            // the request payload won't heal by resending it to a local daemon.
            if (isLocalRequest && res.status >= 500) {
              console.warn(`[AIClient] LP-05: local server error ${res.status} on ${requestUrl} — failing fast (no retry).`);
              return res;
            }
            if (i < maxRetries) {
              // XI.C: honor Retry-After on 429 instead of plain exponential
              // backoff — a provider-declared reset time beats guessing.
              let waitTime = delay + Math.random() * 500;
              if (res.status === 429) {
                const retryAfterMs = this._parseRetryAfterHeader(res);
                if (retryAfterMs != null) {
                  // Cap honored value at 60s so a hostile header can't stall
                  // the conversation beyond one bounded wait.
                  waitTime = Math.min(retryAfterMs, 60_000);
                  console.log(`[AIClient] 429 Retry-After honored: waiting ${Math.round(waitTime)}ms`);
                }
              }
              console.warn(`[AIClient] Received ${res.status}. ${res.status === 429 ? 'Rate limit hit — backing off.' : 'Server error.'} Retrying in ${Math.round(waitTime)}ms... (Attempt ${i + 1}/${maxRetries})`);
              await new Promise(r => setTimeout(r, waitTime));
              delay *= 2;
              continue;
            }
          }
          return res;
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          throw fetchErr;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // AI-CORR-02: caller-requested abort — never retried; rethrow a
        // uniformly-named AbortError so runner cleanup treats it as user stop.
        if (abortSignal?.aborted) {
          if (lastError.name === 'AbortError') throw lastError;
          const abortErr = new DOMException('Request aborted by user', 'AbortError');
          if (lastError.stack) abortErr.stack = lastError.stack;
          throw abortErr;
        }

        // If local daemon (Ollama 11434, LM Studio 1234, local server) is offline, fail fast immediately without noisy retries
        const isLocalEndpoint = requestUrl.includes('11434') || requestUrl.includes('1234') || requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1');
        if (isLocalEndpoint && (lastError.message.includes('fetch failed') || (lastError as any).cause?.code === 'ECONNREFUSED' || lastError.message.includes('ECONNREFUSED'))) {
          console.log(`[AIClient] Local endpoint offline (${requestUrl}), failing fast.`);
          const providerLabel = requestUrl.includes('11434') ? 'Ollama' : 'LM Studio';
          throw new Error(`${providerLabel} not reachable at ${requestUrl} (${(lastError as any)?.cause?.code ?? lastError?.message}). Start the server or fix Settings → Base URL.`);
        }

        // Check if it's an abort error (timeout)
        if (lastError.name === 'AbortError') {
          // LP-05: derive the logged timeout from the same constants that arm
          // it — was a stale hardcoded "30s" that matched no actual ceiling.
          const isStreamBody = typeof options.body === 'string' && options.body.includes('"stream":true');
          const timeoutMs = isLocalRequest
            ? (isStreamBody ? CLOUD_FETCH_TIMEOUT_MS : LOCAL_FETCH_TIMEOUT_MS)
            : CLOUD_FETCH_TIMEOUT_MS;
          console.warn(`[AIClient] Request timeout after ${Math.round(timeoutMs / 1000)}s. Retrying... (attempt ${i + 1}/${maxRetries + 1})`);
          // Log Ollama-specific timeout info
          if (requestUrl.includes('/api/chat')) {
            console.log(`[Ollama] Timeout on ${requestUrl} - No response received within timeout window`);
          }
        } else {
          console.warn(`[AIClient] Network error: ${lastError.message}. Retrying in ${delay}ms...`);
          // Log error details for debugging
          if (requestUrl.includes('/api/chat')) {
            console.log(`[Ollama] Error details:`, {
              message: lastError.message,
              name: lastError.name,
              url: requestUrl
            });
          }
        }

        if (i < maxRetries) {
          await new Promise(r => setTimeout(r, delay));
          delay = Math.min(delay * 2, 16000); // Cap at 16s max delay
          continue;
        }
      }
    }
    throw lastError || new Error(`Failed to fetch ${requestUrl} after ${maxRetries + 1} attempts`);
  }

  // ── OpenAI-Compatible (OpenAI, DeepSeek, LM Studio, EverFern) ───

  private get _oaiHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) h['Authorization'] = `Bearer ${this.config.apiKey}`;
    if (this.config.provider === 'openrouter') {
      h['HTTP-Referer'] = 'https://everfern.app';
      h['X-OpenRouter-Title'] = 'EverFern';
    }
    return h;
  }

  // ── Ollama Headers (Local and Cloud) ────────────────────────────

  private get _ollamaHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Ollama Cloud / Remote Ollama requires Authorization header
    const isRemote = this.config.provider === 'ollama-cloud' ||
      this.config.baseUrl.includes('ollama.com') ||
      !this.config.baseUrl.includes('localhost') && !this.config.baseUrl.includes('127.0.0.1');

    if (isRemote && this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async _openAICompatChat(req: ChatRequest): Promise<ChatResponse> {
    const isStreaming = !!req.onStreamChunk;
    let processedMessages = this._mapMessagesForOpenAI(req.messages);

    // Local providers (LM Studio, everfern) use HuggingFace chat templates which reject
    // conversations ending with an assistant message.
    const isLocalProvider = this.config.provider === 'lmstudio' || this.config.provider === 'everfern';
    if (isLocalProvider) {
      processedMessages = this._sanitizeForLocalProvider(processedMessages);
    }

    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages: processedMessages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: isStreaming,
      ...(isStreaming && { stream_options: { include_usage: true } }),
      ...(req.agent && { agent: req.agent }),
    };

    this._maybeInjectComputerUseTools(body, req);

    if (this.config.provider === 'nvidia') {
      const modelName = req.model ?? this.config.model;
      if (modelName?.includes('qwen')) {
        body['chat_template_kwargs'] = { enable_thinking: true };
        body['temperature'] = req.temperature ?? 0.6;
        body['top_p'] = 0.95;
      } else if (modelName?.includes('glm')) {
        body['chat_template_kwargs'] = { enable_thinking: true, clear_thinking: false };
      } else if (modelName?.includes('kimi')) {
        body['chat_template_kwargs'] = { thinking: true };
      } else if (modelName?.includes('mistral')) {
        body['reasoning_effort'] = 'medium';
        body['max_tokens'] = req.maxTokens ?? 16384;
        body['temperature'] = req.temperature ?? 0.10;
        body['top_p'] = 1.0;
      } else if (modelName?.includes('gemma')) {
        body['chat_template_kwargs'] = { enable_thinking: true };
        body['max_tokens'] = req.maxTokens ?? 16384;
        body['temperature'] = req.temperature ?? 1.0;
        body['top_p'] = 0.95;
      } else if (modelName?.includes('qwen') && modelName?.includes('thinking')) {
        body['chat_template_kwargs'] = { thinking: true };
      } else if (modelName?.includes('llama') && modelName?.includes('reasoning')) {
        body['reasoning_effort'] = 'medium';
      }
    }
    // LP-04: track whether tools were embedded in the prompt because the local
    // model lacks native tool support (the nudge loop is then bypassed by
    // converting the model's embedded-JSON answer into synthetic tool calls).
    let toolsEmbedded = false;
    if (req.tools?.length) {
      // LP-04: local compat models probed tools-incapable get the tools array
      // stripped and re-embedded in the system prompt as a JSON contract;
      // cloud and probes-without-capabilities keep native tools + nudges.
      let toolsAllowed = true;
      if (this.isLocal()) {
        toolsAllowed = await this._localModelSupportsTools(req.model ?? this.config.model);
      }
      if (toolsAllowed) {
        body['tools'] = req.tools.map(t => {
          if (t && (t as any).type === 'function' && (t as any).function) {
            return t;
          }
          return {
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          };
        });
        body['tool_choice'] = 'auto';
      } else {
        toolsEmbedded = true;
        this._injectEmbeddedToolsInstruction(processedMessages, req.tools);
      }
    }
    if (req.responseFormat === 'json' && (this.config.provider === 'openai' || this.config.provider === 'deepseek')) {
      // OpenAI: use json_schema if provided for structured output, fallback to json_object
      if (req.jsonSchema && this.config.provider === 'openai') {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: {
            name: req.jsonSchema.$name || 'response',
            schema: req.jsonSchema,
            strict: true
          }
        };
      } else {
        body['response_format'] = { type: 'json_object' };
      }
    }
    // Nvidia: use nvext.guided_json for reliable structured output
    if (req.responseFormat === 'json' && this.config.provider === 'nvidia') {
      if (req.guidedJson) {
        body['nvext'] = { guided_json: req.guidedJson };
      } else {
        body['response_format'] = { type: 'json_object' };
      }
    }
    // Gemini: use text mode for response_format (json_object not supported)
    if (req.responseFormat === 'json' && this.config.provider === 'gemini') {
      // Gemini doesn't support json_object — we handle JSON parsing on our end
    }

    // EverFern Cloud: forward agent name for backend model routing
    if (req.agent && this.config.provider === 'everfern') {
      body['agent'] = req.agent;
    }

    const headers = { ...this._oaiHeaders };
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Accept'] = 'application/json';
    }

    // AI-CORR-04: never emit raw auth headers to the debug log ring/window.
    DebugEmitter.emit('log', 'API Call POST /chat/completions', {
      url: `${this.config.baseUrl}/chat/completions`,
      headers: redactHeadersForLog(headers),
      body
    });

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body),
    }, 6, req.abortSignal);

    DebugEmitter.emit('log', 'API Response status', {
      status: res.status,
      statusText: res.statusText
    });
    if (!res.ok) {
      const txt = await res.text();
      let errorMsg = res.statusText;
      let isFormatError = false;
      try {
        const json = JSON.parse(txt);
        if (json.error) errorMsg = json.error.message || json.error;
        if (txt.toLowerCase().includes('image') || txt.toLowerCase().includes('vision') || txt.toLowerCase().includes('format') || txt.toLowerCase().includes('validation') || res.status === 422) {
          isFormatError = true;
        }
      } catch { }

      // XI.C: classify context-window overflow before generic 400 surfacing
      const overflowMsg = classifyProviderError(res.status, txt);
      if (overflowMsg) throw new Error(overflowMsg);

      // If Nvidia rejects an image payload (e.g. text-only model receives screenshot)
      if (this.config.provider === 'nvidia' && (res.status === 400 || res.status === 422 || isFormatError)) {
        throw new Error(`[${this.config.provider}] HTTP ${res.status}: ${errorMsg}. No vision capability for this model. Please select a valid vision endpoint.`);
      }

      if (res.status === 401) {
        throw new Error(errorMsg && errorMsg !== res.statusText ? errorMsg : '401 Unauthorized: Please sign in to your EverFern Cloud account.');
      }

      // Daily usage limit reached (EverFern Cloud) — surface a clean message.
      if (res.status === 429) {
        throw new Error(errorMsg && errorMsg !== res.statusText ? errorMsg : 'You have used your daily limit. Your usage resets at midnight.');
      }

      throw new Error(`[${this.config.provider}] HTTP ${res.status}: ${errorMsg}`);
    }

    if (!isStreaming) {
      const data = await res.json();
      if (data.actual_model) {
        DebugEmitter.emit('log', `EverFern Cloud Model: ${data.actual_model}`, {
          requestedModel: req.model ?? this.config.model,
          actualModel: data.actual_model,
          agent: req.agent
        });
      }
      const choice = data.choices?.[0];
      let toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJSON(tc.function.arguments),
      }));
      // LP-04: tools-incapable local model — convert the embedded-JSON answer
      // into a synthetic tool call so the runner loop proceeds instead of nudging.
      if (toolsEmbedded && !toolCalls?.length) {
        const embedded = extractEmbeddedToolCall(choice?.message?.content ?? '');
        if (embedded) {
          toolCalls = [{
            id: `embedded-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: embedded.name,
            arguments: embedded.arguments as Record<string, unknown>,
          }];
        }
      }
      return {
        id: data.id ?? `${this.config.provider}-${Date.now()}`,
        content: choice?.message?.content ?? '',
        model: data.model ?? this.config.model,
        toolCalls,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          promptTokensCost: data.usage.prompt_tokens_cost,
          completionTokensCost: data.usage.completion_tokens_cost,
          imageInputCost: data.usage.image_input_cost,
          imageOutputCost: data.usage.image_output_cost,
          totalCost: data.usage.total_cost,
        } : undefined,
        finishReason: choice?.finish_reason === 'tool_calls' || toolCalls?.length > 0 ? 'tool_calls' :
          (choice?.finish_reason as ChatResponse['finishReason']) ?? 'stop',
      };
    }

    // --- Streaming Mode ---
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let fullContent = '';
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
    let finishReason: any = 'stop';
    let responseId = `${this.config.provider}-${Date.now()}`;
    let isReasoning = false;
    let finalUsage: any = undefined;

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const payload = t.slice(6);
        if (payload === '[DONE]') {
          if (isReasoning) {
            if (req.onStreamChunk) req.onStreamChunk('</think>');
            fullContent += '</think>';
          }
          break;
        }
        // AI-CORR-01: parse via the shared helper so malformed SSE lines are
        // counted (rate-limited warn) instead of silently swallowed.
        const d = parseSSELine(line);
        if (d === undefined) {
          this._noteSSEParseError(line);
          continue;
        }
        try {
          if (d.id) responseId = d.id;
          if (d.usage) {
            finalUsage = d.usage;
          }
          const delta = d.choices?.[0]?.delta;

          let deltaContent = delta?.content ?? '';
          if (delta?.reasoning_content !== undefined) {
            if (!isReasoning) {
              isReasoning = true;
              deltaContent = '<think>' + delta.reasoning_content;
            } else {
              deltaContent = delta.reasoning_content;
            }
          } else if (isReasoning && delta?.content !== undefined) {
            isReasoning = false;
            deltaContent = '</think>' + delta.content;
          }

          if (deltaContent) {
            fullContent += deltaContent;
            req.onStreamChunk!(deltaContent);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCallsMap[tc.index]) {
                  toolCallsMap[tc.index] = { id: '', name: '', arguments: '' };
                }
                const entry = toolCallsMap[tc.index];
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name += tc.function.name;
                if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                if (req.onToolCallChunk && tc.function?.arguments) {
                  req.onToolCallChunk(tc.index, toolCallsMap[tc.index].name, tc.function.arguments);
                }
              }
            }
          }
          if (d.choices?.[0]?.finish_reason) {
            finishReason = d.choices[0].finish_reason;
          }
        } catch { }
      }
    }

    // Fallback if stream ends without [DONE] but isReasoning is still true
    if (isReasoning) {
      if (req.onStreamChunk) req.onStreamChunk('</think>');
      fullContent += '</think>';
    }

    const toolCalls = Object.values(toolCallsMap).map((tc: any) => {
      const args = safeParseJSON(tc.arguments);
      return {
        id: tc.id,
        name: tc.name,
        arguments: args,
      };
    });

    // LP-04: when tools were embedded in the prompt (tools-incapable local
    // model), convert the fenced {"tool":...,"arguments":{...}} answer into a
    // synthetic tool call so the runner loop proceeds instead of nudging.
    if (toolsEmbedded && toolCalls.length === 0) {
      const embedded = extractEmbeddedToolCall(fullContent);
      if (embedded) {
        toolCalls.push({
          id: `embedded-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: embedded.name,
          arguments: embedded.arguments,
        });
      }
    }

    return {
      id: responseId,
      content: fullContent,
      model: this.config.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: finalUsage ? {
        promptTokens: finalUsage.prompt_tokens,
        completionTokens: finalUsage.completion_tokens,
        totalTokens: finalUsage.total_tokens,
        promptTokensCost: finalUsage.prompt_tokens_cost,
        completionTokensCost: finalUsage.completion_tokens_cost,
        imageInputCost: finalUsage.image_input_cost,
        imageOutputCost: finalUsage.image_output_cost,
        totalCost: finalUsage.total_cost,
      } : undefined,
      finishReason: finishReason === 'tool_calls' || toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private async *_openAICompatStream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    let messages = this._mapMessagesForOpenAI(req.messages);

    // Local providers use HuggingFace chat templates that reject trailing assistant messages.
    const isLocalProvider = this.config.provider === 'lmstudio' || this.config.provider === 'everfern';
    if (isLocalProvider) {
      messages = this._sanitizeForLocalProvider(messages);
    }

    const streamBody: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages: messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: true,
      ...(req.agent && { agent: req.agent }),
    };

    this._maybeInjectComputerUseTools(streamBody, req);

    if (req.reasoningEffort) {
      if (req.reasoningEffort === 'ultra' || req.reasoningEffort === 'ultra-delegate') {
        streamBody['reasoning_effort'] = 'high';
      } else {
        streamBody['reasoning_effort'] = req.reasoningEffort;
      }
    }

    if (this.config.provider === 'nvidia') {
      const modelName = req.model ?? this.config.model;
      if (modelName?.includes('glm')) {
        streamBody['chat_template_kwargs'] = { enable_thinking: true, clear_thinking: false };
      } else if (modelName?.includes('kimi')) {
        streamBody['chat_template_kwargs'] = { thinking: true };
      } else if (modelName?.includes('mistral')) {
        streamBody['reasoning_effort'] = 'medium';
        streamBody['max_tokens'] = req.maxTokens ?? 16384;
        streamBody['temperature'] = req.temperature ?? 0.10;
        streamBody['top_p'] = 1.0;
      } else if (modelName?.includes('gemma')) {
        streamBody['chat_template_kwargs'] = { enable_thinking: true };
        streamBody['max_tokens'] = req.maxTokens ?? 16384;
        streamBody['temperature'] = req.temperature ?? 1.0;
        streamBody['top_p'] = 0.95;
      } else if (modelName?.includes('qwen') && modelName?.includes('thinking')) {
        streamBody['chat_template_kwargs'] = { thinking: true };
      } else if (modelName?.includes('llama') && modelName?.includes('reasoning')) {
        streamBody['reasoning_effort'] = 'medium';
      }
    }
    // Include tools in the streaming request so models can trigger tool calls
    // LP-04: local tools-incapable models get the prompt-embedded JSON
    // contract instead (mirrors the non-streaming path).
    let toolsEmbedded = false;
    if (req.tools?.length) {
      let toolsAllowed = true;
      if (this.isLocal()) {
        toolsAllowed = await this._localModelSupportsTools(req.model ?? this.config.model);
      }
      if (toolsAllowed) {
        streamBody['tools'] = req.tools.map(t => {
          if (t && (t as any).type === 'function' && (t as any).function) {
            return t;
          }
          return {
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          };
        });
        streamBody['tool_choice'] = 'auto';
      } else {
        toolsEmbedded = true;
        this._injectEmbeddedToolsInstruction(messages, req.tools);
      }
    }

    // Handle JSON response formats in stream
    if (req.responseFormat === 'json') {
      if (this.config.provider === 'openai') {
        if (req.jsonSchema) {
          streamBody['response_format'] = {
            type: 'json_schema',
            json_schema: {
              name: req.jsonSchema.$name || 'response',
              schema: req.jsonSchema,
              strict: true
            }
          };
        } else {
          streamBody['response_format'] = { type: 'json_object' };
        }
      } else if (this.config.provider === 'deepseek') {
        streamBody['response_format'] = { type: 'json_object' };
      } else if (this.config.provider === 'nvidia') {
        if (req.guidedJson) {
          streamBody['nvext'] = { guided_json: req.guidedJson };
        } else {
          streamBody['response_format'] = { type: 'json_object' };
        }
      }
    }
    const headers = { ...this._oaiHeaders };
    headers['Accept'] = 'text/event-stream';
    headers['Accept-Encoding'] = 'identity'; // Prevent Node.js undici fetch from buffering gzip chunks
    headers['Connection'] = 'keep-alive';

    // AI-CORR-04: never emit raw auth headers to the debug log ring/window.
    DebugEmitter.emit('log', 'API Call POST /chat/completions (Stream)', {
      url: `${this.config.baseUrl}/chat/completions`,
      headers: redactHeadersForLog(headers),
      body: streamBody
    });

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify(streamBody),
    });

    DebugEmitter.emit('log', 'API Response status (Stream)', {
      status: res.status,
      statusText: res.statusText
    });
    if (!res.ok) {
      const txt = await res.text();
      let errorMsg = res.statusText;
      try {
        const json = JSON.parse(txt);
        if (json.error) errorMsg = json.error.message || json.error;
      } catch { }
      // XI.C: classify context-window overflow before generic 400 surfacing
      const overflowMsg = classifyProviderError(res.status, txt);
      if (overflowMsg) throw new Error(overflowMsg);
      if (res.status === 401) {
        throw new Error(errorMsg && errorMsg !== res.statusText ? errorMsg : '401 Unauthorized: Please sign in to your EverFern Cloud account.');
      }
      // Daily usage limit reached (EverFern Cloud) — surface a clean message.
      if (res.status === 429) {
        throw new Error(errorMsg && errorMsg !== res.statusText ? errorMsg : 'You have used your daily limit. Your usage resets at midnight.');
      }
      throw new Error(`[${this.config.provider}] Stream HTTP ${res.status}: ${errorMsg}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let id = `${this.config.provider}-${Date.now()}`;
    let isFirstChunk = true;
    let isReasoning = false;
    // LP-04: accumulate the streamed answer so an embedded-JSON tool call can
    // be converted into a synthetic toolCalls chunk at stream end.
    let fullContent = '';
    let sawToolCall = false;

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (isFirstChunk) {
        isFirstChunk = false;
        DebugEmitter.emit('log', 'Received First Stream Chunk ArrayBuffer', { byteLength: value.byteLength });
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const payload = t.slice(6);
        if (payload === '[DONE]') {
          if (isReasoning) yield { id, delta: '```', done: false };
          // LP-04: convert the prompt-embedded tool JSON (tools-incapable
          // local model) into a synthetic toolCalls chunk before the sentinel.
          if (toolsEmbedded && !sawToolCall) {
            const embedded = extractEmbeddedToolCall(fullContent);
            if (embedded) {
              yield {
                id,
                delta: '',
                toolCalls: [{
                  index: 0,
                  id: `embedded-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  type: 'function',
                  function: { name: embedded.name, arguments: JSON.stringify(embedded.arguments) },
                }],
                done: false,
                model: this.config.model,
              };
            }
          }
          yield { id, delta: '', done: true };
          return;
        }
        // AI-CORR-01: parse via the shared helper so malformed SSE lines are
        // counted (rate-limited warn) instead of silently swallowed.
        const d = parseSSELine(line);
        if (d === undefined) {
          this._noteSSEParseError(line);
          continue;
        }
        try {
          if (d.actual_model && isFirstChunk) {
            DebugEmitter.emit('log', `EverFern Cloud Model (Stream): ${d.actual_model}`, {
              requestedModel: req.model ?? this.config.model,
              actualModel: d.actual_model,
              agent: req.agent
            });
          }
          const choice = d.choices?.[0];
          const delta = choice?.delta;

          let deltaContent = delta?.content ?? '';
          if (delta?.reasoning_content !== undefined) {
            if (!isReasoning) {
              isReasoning = true;
              deltaContent = '<think>' + delta.reasoning_content;
            } else {
              deltaContent = delta.reasoning_content;
            }
          } else if (isReasoning && delta?.content !== undefined) {
            isReasoning = false;
            deltaContent = '</think>' + delta.content;
          }

          yield {
            id,
            delta: deltaContent,
            toolCalls: delta?.tool_calls,
            done: false,
            model: d.model
          };
          // LP-04: track accumulated content / native tool-call presence for
          // the end-of-stream embedded-tool-call conversion.
          fullContent += deltaContent;
          if (delta?.tool_calls) sawToolCall = true;
        } catch { /* skip malformed */ }
      }
    }

    if (isReasoning) {
      yield { id, delta: '```', done: false };
    }

    // LP-04: stream ended without [DONE] — still convert an embedded tool
    // call (tools-incapable local model) into a synthetic toolCalls chunk.
    if (toolsEmbedded && !sawToolCall) {
      const embedded = extractEmbeddedToolCall(fullContent);
      if (embedded) {
        yield {
          id,
          delta: '',
          toolCalls: [{
            index: 0,
            id: `embedded-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: { name: embedded.name, arguments: JSON.stringify(embedded.arguments) },
          }],
          done: false,
          model: this.config.model,
        };
      }
    }
  }

  private async _openAICompatListModels(): Promise<string[]> {
    try {
      const isLocal = this.isLocal() || this.config.provider === 'lmstudio' || this.config.baseUrl.includes('localhost') || this.config.baseUrl.includes('127.0.0.1');
      const retries = isLocal ? 0 : 2;
      const res = await this._fetchWithRetry(`${normalizeLocalUrl(this.config.baseUrl) ?? this.config.baseUrl}/models`, { headers: this._oaiHeaders }, retries);
      if (!res.ok) return [];
      const data = await res.json();
      const rawModels = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.models)
          ? data.models
          : Array.isArray(data)
            ? data
            : [];
      return rawModels
        .map((m: any) => typeof m === 'string' ? m : m?.id || m?.name || m?.model)
        .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0);
    } catch { return []; }
  }

  // ── Google Gemini Native API (for Computer Use) ──────────────────

  private async _googleGeminiChat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.config.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const stripAdditionalProperties = (schema: any): any => {
      if (!schema || typeof schema !== 'object') return schema;
      if (Array.isArray(schema)) {
        return schema.map(stripAdditionalProperties);
      }
      const copy: any = {};
      for (const key in schema) {
        if (key === 'additionalProperties') {
          continue;
        }
        copy[key] = stripAdditionalProperties(schema[key]);
      }
      return copy;
    };

    const groupedMessages: { role: 'user' | 'model'; parts: any[] }[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];
      if (m.role === 'tool') {
        let responseVal: any = {};
        if (typeof m.content === 'string') {
          responseVal = { result: m.content };
        } else if (Array.isArray(m.content)) {
          const txt = (m.content.find((c: any) => c.type === 'text') as any)?.text;
          responseVal = txt ? safeParseJSON(txt) : m.content;
        } else {
          responseVal = m.content;
        }

        parts.push({
          function_response: {
            name: (m as any).tool_name || 'unknown',
            response: responseVal
          }
        });
        if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c.type === 'image_url') {
              const b64 = c.image_url.url.split(',')[1];
              parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
            }
          }
        }
      } else if (typeof m.content === 'string') {
        if (m.content) parts.push({ text: m.content });
      } else {
        for (const c of m.content) {
          if (c.type === 'text' && c.text) parts.push({ text: c.text });
          if (c.type === 'image_url') {
            const b64 = c.image_url.url.split(',')[1] || c.image_url.url;
            parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
          }
        }
      }

      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          parts.push({
            function_call: {
              name: tc.name,
              args: safeParseJSON(tc.arguments)
            }
          });
        }
      }

      const lastGroup = groupedMessages[groupedMessages.length - 1];
      if (lastGroup && lastGroup.role === role) {
        lastGroup.parts.push(...parts);
      } else {
        groupedMessages.push({ role, parts });
      }
    }

    const systemInstruction = req.messages
      .filter(m => m.role === 'system')
      .map(m => ({ parts: [{ text: typeof m.content === 'string' ? m.content : '' }] }))[0];

    const functionDeclarations = req.tools
      ?.filter(t => t.name !== 'computer_use')
      ?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: stripAdditionalProperties(t.parameters)
      }));

    const tools: any[] = [{ computer_use: { environment: 'ENVIRONMENT_BROWSER' } }];
    if (functionDeclarations?.length) {
      tools.push({ function_declarations: functionDeclarations });
    }

    const body: any = {
      contents: groupedMessages,
      tools,
      generationConfig: {
        temperature: req.temperature ?? this.config.temperature,
        maxOutputTokens: req.maxTokens ?? this.config.maxTokens,
      }
    };
    if (req.userConfirmation) body.user_confirmation = req.userConfirmation;
    if (systemInstruction) body.systemInstruction = systemInstruction;

    console.log('[AIClient] Gemini Native Request:', JSON.stringify(body, null, 2).slice(0, 1000) + '...');
    const startTime = Date.now();
    const res = await this._fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey || ''
      },
      body: JSON.stringify(body),
    }, 6, req.abortSignal);
    console.log(`[AIClient] Gemini Native Response received in ${Date.now() - startTime}ms. Status: ${res.status}`);

    if (!res.ok) {
      const txt = await res.text();
      console.error(`[AIClient] Gemini Native Error: ${txt}`);
      const geminiOverflow = classifyProviderError(res.status, txt);
      if (geminiOverflow) throw new Error(geminiOverflow);
      throw new Error(`[gemini-native] HTTP ${res.status}: ${txt}`);
    }

    const data = await res.json();
    console.log('[AIClient] Gemini Native Data:', JSON.stringify(data, null, 2).slice(0, 1000) + '...');
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.find((p: any) => p.text)?.text ?? '';
    const googleCalls = candidate?.content?.parts?.filter((p: any) => p.function_call);

    // Extract safety_decision from function_call args if present
    let safetyDecision = undefined;
    for (const gc of (googleCalls || [])) {
      if (gc.function_call.args?.safety_decision) {
        safetyDecision = gc.function_call.args.safety_decision;
        break;
      }
    }

    const toolCalls = googleCalls?.map((gc: any): ToolCall => ({
      id: `gc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: gc.function_call.name,
      arguments: gc.function_call.args
    }));

    return {
      id: data.id ?? `gemini-${Date.now()}`,
      content,
      model,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      safetyDecision: safetyDecision,
      finishReason: candidate?.finishReason === 'RECITATION' ? 'stop' :
        candidate?.finishReason === 'MAX_TOKENS' ? 'length' :
          toolCalls?.length ? 'tool_calls' : 'stop',
    };
  }

  // ── Anthropic Messages API ───────────────────────────────────────

  private get _anthropicHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'computer-use-2024-10-22,prompt-caching-2024-07-31,token-counting-2024-11-01',
    };
  }

  private _splitSystemMessages(messages: ChatMessage[]): {
    system: string | undefined;
    msgs: ChatMessage[];
  } {
    const system = messages
      .filter(m => m.role === 'system')
      .map(m => typeof m.content === 'string' ? m.content : m.content.map(c => 'text' in c ? c.text : '').join('\n'))
      .join('\n\n');
    const msgs = messages.filter(m => m.role !== 'system');
    return { system: system || undefined, msgs };
  }

  private async _anthropicChat(req: ChatRequest): Promise<ChatResponse> {
    const isStreaming = !!req.onStreamChunk;
    const { system, msgs } = this._splitSystemMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      messages: msgs.map(m => {
        // Anthropic: Tool results go into a 'user' message with type: 'tool_result' content blocks
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.tool_call_id,
                content: typeof m.content === 'string' ? m.content : m.content.map(c => 'text' in c ? c.text : '').join('\n')
              }
            ]
          };
        }
        // Assistant tool calls go into 'assistant' message with type: 'tool_use'
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content: any[] = [];
          if (m.content) {
            content.push({ type: 'text', text: typeof m.content === 'string' ? m.content : m.content.map(c => 'text' in c ? c.text : '').join('\n') });
          }
          for (const tc of m.tool_calls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
          }
          return { role: 'assistant', content };
        }
        // Message with image parts or text array
        if (Array.isArray(m.content)) {
          const contentBlocks = m.content.map(c => {
            if (c.type === 'image_url' && c.image_url?.url) {
              const url = c.image_url.url;
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: match[1],
                    data: match[2]
                  }
                };
              }
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: url.replace(/^data:image\/[a-z]+;base64,/, '')
                }
              };
            }
            if (c.type === 'text') {
              return { type: 'text', text: c.text };
            }
            return c;
          });
          return { role: m.role, content: contentBlocks };
        }
        return m;
      }),
      stream: isStreaming,
    };
    if (system) {
      body['system'] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    }
    if (req.tools?.length) {
      body['tools'] = req.tools.map((t, index, arr) => {
        let name, description, input_schema;
        if (t && (t as any).type === 'function' && (t as any).function) {
          const fn = (t as any).function;
          name = fn.name;
          description = fn.description;
          input_schema = fn.parameters;
        } else {
          name = t.name;
          description = t.description;
          input_schema = t.parameters;
        }
        const toolObj: any = { name, description, input_schema };
        if (index === arr.length - 1) {
          toolObj.cache_control = { type: 'ephemeral' };
        }
        return toolObj;
      });
    }

    const headers = this._anthropicHeaders;
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    }

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, 6, req.abortSignal);
    if (!res.ok) {
      const txt = await res.text();
      const anthropicOverflow = classifyProviderError(res.status, txt);
      if (anthropicOverflow) throw new Error(anthropicOverflow);
      throw new Error(`[anthropic] HTTP ${res.status}: ${txt}`);
    }

    if (!isStreaming) {
      const data = await res.json();
      const text = data.content?.find((b: any) => b.type === 'text')?.text ?? '';
      const toolUses = data.content
        ?.filter((b: any) => b.type === 'tool_use')
        ?.map((tc: any): ToolCall => ({ id: tc.id, name: tc.name, arguments: tc.input }));

      return {
        id: data.id ?? `anthropic-${Date.now()}`,
        content: text,
        model: data.model ?? this.config.model,
        toolCalls: toolUses?.length ? toolUses : undefined,
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens + data.usage.output_tokens),
        } : undefined,
        finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' :
          data.stop_reason === 'max_tokens' ? 'length' : 'stop',
      };
    }

    // --- Streaming Mode ---
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let fullContent = '';
    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
    let finishReason: any = 'stop';
    let responseId = `anthropic-${Date.now()}`;
    const thinkState = { inThinking: false };

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        // AI-CORR-01: parse via the shared helper so malformed SSE lines are
        // counted (rate-limited warn) instead of silently swallowed.
        const d = parseSSELine(line);
        if (d === undefined) {
          this._noteSSEParseError(line);
          continue;
        }
        try {
          if (d.type === 'message_start') {
            responseId = d.message?.id ?? responseId;
          }
          if (d.type === 'content_block_delta' && d.delta?.type === 'thinking_delta') {
            const piece = d.delta.thinking ?? '';
            if (!thinkState.inThinking) {
              thinkState.inThinking = true;
              req.onStreamChunk?.(`<think>${piece}`);
            } else {
              req.onStreamChunk?.(piece);
            }
          }
          if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
            if (thinkState.inThinking) {
              thinkState.inThinking = false;
              req.onStreamChunk?.('</think>');
            }
            fullContent += d.delta.text;
            req.onStreamChunk!(d.delta.text);
          }
          if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
            toolCallsMap[d.index] = { id: d.content_block.id, name: d.content_block.name, arguments: '' };
          }
          if (d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta') {
            if (toolCallsMap[d.index]) toolCallsMap[d.index].arguments += d.delta.partial_json;
            if (req.onToolCallChunk && d.delta.partial_json) {
              const toolIndex = d.index;
              const currentToolName = toolCallsMap[toolIndex]?.name ?? '';
              req.onToolCallChunk(toolIndex, currentToolName, d.delta.partial_json);
            }
          }
          if (d.type === 'message_delta' && d.delta?.stop_reason) {
            finishReason = d.delta.stop_reason;
          }
        } catch { }
      }
    }

    if (thinkState.inThinking) {
      thinkState.inThinking = false;
      req.onStreamChunk?.('</think>');
    }

    const toolCalls = Object.values(toolCallsMap).map((tc: any) => ({
      id: tc.id,
      name: tc.name,
      arguments: safeParseJSON(tc.arguments),
    }));

    return {
      id: responseId,
      content: fullContent,
      model: this.config.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: finishReason === 'tool_use' || toolCalls.length > 0 ? 'tool_calls' :
        finishReason === 'max_tokens' ? 'length' : 'stop',
    };
  }

  private async *_anthropicStream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const { system, msgs } = this._splitSystemMessages(req.messages);
    const isStreaming = !!req.onStreamChunk;
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      messages: msgs,
      stream: true,
    };
    if (system) {
      body['system'] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    }
    
    if (req.tools?.length) {
      body['tools'] = req.tools.map((t, index, arr) => {
        let name, description, input_schema;
        if (t && (t as any).type === 'function' && (t as any).function) {
          const fn = (t as any).function;
          name = fn.name;
          description = fn.description;
          input_schema = fn.parameters;
        } else {
          name = t.name;
          description = t.description;
          input_schema = t.parameters;
        }
        const toolObj: any = { name, description, input_schema };
        if (index === arr.length - 1) {
          toolObj.cache_control = { type: 'ephemeral' };
        }
        return toolObj;
      });
    }

    const headers = this._anthropicHeaders;
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    }

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, 6, req.abortSignal);
    if (!res.ok) {
      // XI.C: read body for overflow classification before the generic stream error
      const txt = await res.text();
      const anthropicStreamOverflow = classifyProviderError(res.status, txt);
      if (anthropicStreamOverflow) throw new Error(anthropicStreamOverflow);
      throw new Error(`[anthropic] Stream HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let id = `anthropic-${Date.now()}`;
    const thinkState = { inThinking: false };

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        // AI-CORR-01: parse via the shared helper so malformed SSE lines are
        // counted (rate-limited warn) instead of silently swallowed.
        const d = parseSSELine(line);
        if (d === undefined) {
          this._noteSSEParseError(line);
          continue;
        }
        try {
          if (d.type === 'message_start') id = d.message?.id ?? id;
          if (d.type === 'content_block_delta') {
            if (d.delta?.type === 'thinking_delta') {
              const piece = d.delta.thinking ?? '';
              if (!thinkState.inThinking) {
                thinkState.inThinking = true;
                yield { id, delta: `<think>${piece}`, done: false };
              } else {
                yield { id, delta: piece, done: false };
              }
            } else {
              if (d.delta?.type === 'text_delta' && thinkState.inThinking) {
                thinkState.inThinking = false;
                yield { id, delta: '</think>', done: false };
              }
              yield { id, delta: d.delta?.text ?? '', done: false };
            }
          }
          if (d.type === 'message_stop') {
            if (thinkState.inThinking) {
              thinkState.inThinking = false;
              yield { id, delta: '</think>', done: false };
            }
            yield { id, delta: '', done: true }; return;
          }
        } catch { /* skip */ }
      }
    }
  }

  private async _anthropicListModels(): Promise<string[]> {
    // XI.C: probe the live /v1/models endpoint (it exists — the old static
    // list reported unauthorized/quota-dead keys as healthy). Fail-fast (0
    // retries) like other list-model calls; any error ⇒ [] so healthCheck
    // correctly reports not-ok.
    try {
      const res = await this._fetchWithRetry(`${this.config.baseUrl}/v1/models`, {
        headers: {
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
      }, 0);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((m: any) => m.id as string);
    } catch { return []; }
  }

  // ── Ollama Native API ────────────────────────────────────────────

  /**
   * Strips trailing assistant messages from a message list.
   * Required for local HuggingFace-templated endpoints (Ollama, LM Studio, EverFern)
   * that raise: "Cannot set add_generation_prompt to True when the last message is from the assistant."
   *
   * Also drops assistant messages that have tool_calls but no following tool response
   * when they end up at the tail — they are incomplete turns.
   */
  private _sanitizeForLocalProvider(messages: any[]): any[] {
    let sanitized = [...messages];
    // Drop trailing assistant messages
    while (sanitized.length > 0 && sanitized[sanitized.length - 1].role === 'assistant') {
      console.warn('[AIClient] Dropping trailing assistant message to satisfy local HF chat template.');
      sanitized.pop();
    }
    // If we stripped everything, return at minimum a single user message
    if (sanitized.length === 0) {
      return [{ role: 'user', content: 'Continue.' }];
    }
    return sanitized;
  }

  private _mapOllamaMessages(messages: ChatMessage[]): any[] {
    const supportsVision = this.supportsVision();
    const sanitized = this._sanitizeForLocalProvider(messages);
    return sanitized.map((m: any) => {
      let content = '';
      const images: string[] = [];

      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') {
            content += part.text;
          } else if (part.type === 'image_url') {
            if (supportsVision) {
              const b64 = part.image_url.url.split(',')[1] || part.image_url.url;
              images.push(b64);
            }
          }
        }
      }

      return {
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content,
        images: images.length > 0 ? images : undefined
      };
    });
  }


  private async _ollamaChat(req: ChatRequest): Promise<ChatResponse> {
    const isStreaming = !!req.onStreamChunk;
    const messages = this._mapOllamaMessages(req.messages);

    // Ollama doesn't support JSON schema natively — append schema hint to system prompt
    if (req.jsonSchema) {
      const schemaHint = `\n\nIMPORTANT: You MUST respond with a JSON object that matches this schema:\n${JSON.stringify(req.jsonSchema, null, 2)}\n\nReturn ONLY valid JSON matching this schema. No extra text, no markdown fences.`;

      // Inject schema hint into the system message
      const systemIdx = messages.findIndex((m: any) => m.role === 'system');
      if (systemIdx !== -1) {
        messages[systemIdx].content += schemaHint;
      } else {
        messages.unshift({ role: 'system', content: schemaHint });
      }
    }

    // LP-12: adaptive num_ctx — configurable, else clamp(ceil(est×1.5), 2048, 16384),
    // warning when the prompt estimate exceeds the effective context window.
    const numCtx = this._adaptiveOllamaNumCtx(messages);
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages,
      stream: isStreaming,
      keep_alive: '30m',
      options: {
        temperature: req.temperature ?? this.config.temperature ?? 0.2,
        num_ctx: numCtx,
        num_predict: 4096,
      },
    };
    if (req.responseFormat === 'json') body['format'] = 'json';

    // Pass tools to Ollama if provided
    if (req.tools && req.tools.length > 0) {
      body['tools'] = _formatOllamaTools(req.tools);
    }

    const headers = this._ollamaHeaders;
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    }

    let res: Response;
    try {
      res = await this._fetchWithRetry(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, 6, req.abortSignal);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Ollama] Chat request failed:`, {
        error: errorMsg,
        baseUrl: this.config.baseUrl,
        model: req.model ?? this.config.model,
        timestamp: new Date().toISOString()
      });
      throw err;
    }

    if (!res.ok) {
      const txt = await res.text();
      let errorMsg = res.statusText;
      try {
        const json = JSON.parse(txt);
        if (json.error) errorMsg = json.error.message || json.error;
      } catch { }
      console.error(`[Ollama] HTTP ${res.status} response:`, {
        status: res.status,
        statusText: res.statusText,
        body: txt.substring(0, 500),
        error: errorMsg
      });
      const ollamaOverflow = classifyProviderError(res.status, txt);
      if (ollamaOverflow) throw new Error(ollamaOverflow);
      throw new Error(`[ollama] HTTP ${res.status}: ${errorMsg}`);
    }

    if (!isStreaming) {
      const data = await res.json();
      const toolCalls = data.message?.tool_calls?.map((tc: any) => ({
        id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: tc.function?.name || tc.name,
        arguments: tc.function?.arguments || tc.args || {}
      }));

      return {
        id: `ollama-${Date.now()}`,
        content: data.message?.content ?? '',
        model: data.model ?? this.config.model,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        usage: data.eval_count ? {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        } : undefined,
        finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
      };
    }

    // --- Streaming Mode ---
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let fullContent = '';
    let responseId = `ollama-${Date.now()}`;
    let promptTokens = 0;
    let completionTokens = 0;
    let lineBuffer = '';

    const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
    const thinkState = { inThinking: false };

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += dec.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      // Keep the last partial line in the buffer
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          const thinkingPiece = d.message?.thinking ?? d.message?.reasoning;
          if (thinkingPiece) {
            if (!thinkState.inThinking) {
              thinkState.inThinking = true;
              req.onStreamChunk?.(`<think>${thinkingPiece}`);
            } else {
              req.onStreamChunk?.(thinkingPiece);
            }
          } else if (d.message?.content && thinkState.inThinking) {
            thinkState.inThinking = false;
            req.onStreamChunk?.('</think>');
          }

          if (d.message?.content) {
            fullContent += d.message.content;
            req.onStreamChunk!(d.message.content);
          }

          if (d.message?.tool_calls) {
            for (let i = 0; i < d.message.tool_calls.length; i++) {
              const tc = d.message.tool_calls[i];
              if (!toolCallsMap[i]) {
                toolCallsMap[i] = {
                  id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  name: tc.function?.name || tc.name || '',
                  arguments: ''
                };
              }
              const entry = toolCallsMap[i];
              if (tc.function?.arguments) {
                entry.arguments += typeof tc.function.arguments === 'string'
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments);
              }
            }
          }

          if (d.prompt_eval_count) promptTokens = d.prompt_eval_count;
          if (d.eval_count) completionTokens = d.eval_count;
        } catch (e) {
          // AI-CORR-01: keep counting (rate-limited warn) instead of a
          // full-error dump per line — the counter drives health telemetry.
          this._noteSSEParseError(line);
          if (this.sseParseErrors <= 3) {
            console.error('[AIClient] Failed to parse Ollama stream line:', line.slice(0, 120), e);
          }
        }
      }
    }

    if (thinkState.inThinking) {
      thinkState.inThinking = false;
      req.onStreamChunk?.('</think>');
    }

    const toolCalls = Object.values(toolCallsMap).map(tc => {
      const args = safeParseJSON(tc.arguments);
      return { id: tc.id, name: tc.name, arguments: args as Record<string, any> };
    });

    return {
      id: responseId,
      content: fullContent,
      model: this.config.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: completionTokens ? {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      } : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private async *_ollamaStream(req: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    // LP-12: adaptive num_ctx for the streaming body too (see _ollamaChat).
    const messages = this._mapOllamaMessages(req.messages);
    const numCtx = this._adaptiveOllamaNumCtx(messages);
    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages,
      stream: true,
      keep_alive: '30m',
      options: {
        temperature: req.temperature ?? this.config.temperature ?? 0.2,
        num_ctx: numCtx,
        num_predict: 4096,
      },
    };

    // Pass tools to Ollama if provided (mirrors non-streaming path)
    if (req.tools && req.tools.length > 0) {
      body['tools'] = _formatOllamaTools(req.tools);
    }

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { ...this._ollamaHeaders, 'Accept': 'text/event-stream' },
      body: JSON.stringify(body),
    }, 6, req.abortSignal);
    if (!res.ok) {
      const txt = await res.text();
      let errorMsg = res.statusText;
      try {
        const json = JSON.parse(txt);
        if (json.error) errorMsg = json.error.message || json.error;
      } catch { }
      const ollamaStreamOverflow = classifyProviderError(res.status, txt);
      if (ollamaStreamOverflow) throw new Error(ollamaStreamOverflow);
      throw new Error(`[ollama] Stream HTTP ${res.status}: ${errorMsg}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    const id = `ollama-${Date.now()}`;
    let buffer = '';
    const thinkState = { inThinking: false };

    while (true) {
      // AI-CORR-02: honor caller abort mid-stream — exit cleanly with an
      // AbortError-named rejection so runner cleanup is uniform.
      if (req.abortSignal?.aborted) {
        try { await reader.cancel(); } catch { /* reader already closed */ }
        throw new DOMException('Stream aborted by user', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        // AI-CORR-01: parse via the shared helper so malformed NDJSON lines
        // are counted (rate-limited warn) instead of silently swallowed.
        const d = parseNDJSONLine(line);
        if (d === undefined) {
          this._noteSSEParseError(line);
          continue;
        }
        try {
          if (d.message?.tool_calls) {
            for (let i = 0; i < d.message.tool_calls.length; i++) {
              const tc = d.message.tool_calls[i];
              const argsDelta = tc.function?.arguments
                ? (typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments))
                : '';
              if (req.onToolCallChunk && argsDelta) {
                req.onToolCallChunk(i, tc.function?.name || tc.name || '', argsDelta);
              }
            }
          }
          const thinkingPiece = d.message?.thinking ?? d.message?.reasoning;
          if (thinkingPiece) {
            if (!thinkState.inThinking) {
              thinkState.inThinking = true;
              yield { id, delta: `<think>${thinkingPiece}`, done: false, model: d.model };
            } else {
              yield { id, delta: thinkingPiece, done: false, model: d.model };
            }
          }
          if (d.message?.content && thinkState.inThinking) {
            thinkState.inThinking = false;
            yield { id, delta: '</think>', done: false };
          }
          if (d.done && thinkState.inThinking) {
            thinkState.inThinking = false;
            yield { id, delta: '</think>', done: false };
          }
          yield {
            id,
            delta: d.message?.content ?? '',
            toolCalls: d.message?.tool_calls,
            done: d.done ?? false,
            model: d.model
          };
          if (d.done) return;
        } catch { /* handler error — skip chunk */ }
      }
    }
  }

  private async _ollamaListModels(): Promise<string[]> {
    try {
      const res = await this._fetchWithRetry(`${this.config.baseUrl}/api/tags`, { headers: this._ollamaHeaders }, 2);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map((m: any) => m.name as string);
    } catch { return []; }
  }

  /**
   * EverFern Cloud Vision Grounding
   *
   * When using EverFern Cloud as the provider, send a screenshot to the API
   * for vision grounding and get back a plain-English instruction.
   *
   * Usage:
   *   const instruction = await client.everfernCloudVisionGrounding({
   *     screenshot: 'data:image/png;base64,...',
   *     objective: 'click the search button',
   *     history: ['previous instruction -> actions', ...]
   *   });
   */
  async everfernCloudVisionGrounding(params: {
    screenshot: string;
    objective: string;
    dom?: string;
    history?: string[];
    apiBaseUrl?: string;
    token?: string;
    onlyVision?: boolean;
  }): Promise<{ instruction: string; actions: string[]; screenshot: string }> {
    if (this.config.provider !== 'everfern') {
      throw new Error(`everfernCloudVisionGrounding() only works with provider='everfern', got '${this.config.provider}'`);
    }

    const { screenshot, objective, dom = '', history = [], apiBaseUrl = 'https://api.everfern.app', token, onlyVision = false } = params;

    if (!screenshot) {
      throw new Error('screenshot is required');
    }

    try {
      // Route to /api/chat/completions which supports DOM context
      const response = await fetch(`${apiBaseUrl}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          screenshot,
          dom: onlyVision ? '' : dom,
          objective,
          history,
          only_vision: onlyVision
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      if (!data.instruction) {
        throw new Error('No instruction in response');
      }

      return {
        instruction: data.instruction,
        actions: data.actions || [],
        screenshot: data.screenshot || screenshot
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[EverFern Cloud Vision Grounding] ${message}`);
    }
  }
}

// ── Factory Functions for Client Pooling ────────────────────────────

/**
 * Get a pooled AI client instance for better performance.
 * Falls back to an unpooled temporary client once the per-key pool is full;
 * callers must still call releasePooledAIClient (a no-op for temporaries).
 */
export function getPooledAIClient(config: AIClientConfig): AIClient {
  return globalClientPool.get(config);
}

/**
 * Release a pooled AI client back to the pool
 */
export function releasePooledAIClient(client: AIClient, config: AIClientConfig): void {
  globalClientPool.release(client, config);
}
