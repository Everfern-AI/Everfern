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

// ── Safe JSON Parsing ───────────────────────────────────────────────

/**
 * Safely parse JSON with auto-repair for common LLM issues:
 * - Bad escape characters (e.g. "C:\Users" → "C:\\Users")
 * - Truncated JSON
 * - Single quotes instead of double quotes
 */
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
      } catch {}
      // Also try the original with stripped control chars
      try {
        const stripped = input.replace(/[\x00-\x1f\x7f]/g, '');
        return JSON.parse(stripped);
      } catch {}
      console.warn(`[AIClient] Failed to parse JSON, using fallback. Input: "${input.slice(0, 200)}..."`);
      return fallback;
    }
  }
}

// ── Client Pool for Connection Reuse ────────────────────────────────

interface ClientPoolEntry {
  client: AIClient;
  lastUsed: number;
  inUse: boolean;
}

class AIClientPool {
  private pool = new Map<string, ClientPoolEntry[]>();
  private maxPoolSize = 5;
  private maxIdleTime = 300000; // 5 minutes

  private getPoolKey(config: AIClientConfig): string {
    return `${config.provider}:${config.baseUrl}:${config.model}`;
  }

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
    return new AIClient(config);
  }

  release(client: AIClient, config: AIClientConfig): void {
    const key = this.getPoolKey(config);
    const entries = this.pool.get(key) || [];
    const entry = entries.find(e => e.client === client);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
    }
  }

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

export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'everfern' | 'gemini' | 'nvidia' | 'openrouter';

export interface AIClientConfig {
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Decoupled Vision AI configuration */
  vlm?: {
    engine: 'online' | 'local' | 'cloud';
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
}

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
  /** Optional array of tool calls generated by the assistant */
  tool_calls?: ToolCall[];
  missionTimeline?: any;
}

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
}

export interface ChatResponse {
  id: string;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
  /** Optional reasoning/thinking content (from DeepSeek/NVIDIA NIM) */
  reasoning_content?: string;
  model: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  /** Gemini native: Safety decision for computer use actions */
  safetyDecision?: 'NOMINAL' | 'OFF-NOMINAL';
}

export interface StreamChunk {
  id: string;
  delta: string;
  done: boolean;
  model?: string;
  toolCalls?: any[]; // Incremental tool call deltas
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ── Provider Base URLs ───────────────────────────────────────────────

const DEFAULT_URLS: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.io/v1',
  everfern: 'https://api.everfern.app/api',  // Production EverFern API
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://localhost:11434',
  'ollama-cloud': 'https://ollama.com/v1',  // Fixed: was /api, should be /v1
  lmstudio: 'http://localhost:1234/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-v4-pro',
  minimax: 'minimax-m2.7',
  everfern: 'qwen/qwen3-vl-235b-a22b-instruct',
  gemini: 'gemini-3.1-pro-preview',
  ollama: 'llama3',
  'ollama-cloud': 'llama3.3',
  lmstudio: 'local-model',
  nvidia: 'meta/llama-3.1-8b-instruct',
  openrouter: 'openai/gpt-5.2',
};

// ── AIClient ─────────────────────────────────────────────────────────

export class AIClient {
  private config: Required<Omit<AIClientConfig, 'vlm'>> & { vlm?: AIClientConfig['vlm'] };
  private openaiClient?: OpenAI; // For NVIDIA NIM and DeepSeek

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

    let finalBaseUrl = config.baseUrl ?? DEFAULT_URLS[config.provider];
    // Ollama Cloud uses /v1 for OpenAI-compatible API, not /api
    if (config.provider === 'ollama-cloud') {
      if (finalBaseUrl === 'https://ollama.com' || finalBaseUrl === 'https://ollama.com/api') {
        finalBaseUrl = 'https://ollama.com/v1';
      }
    }

    console.log(`[AIClient] Constructor: provider=${config.provider}, model=${config.model}, baseUrl=${finalBaseUrl}, apiKey=${finalApiKey ? '***' : '(empty)'}`);

    this.config = {
      provider: config.provider,
      apiKey: finalApiKey,
      baseUrl: finalBaseUrl,
      model: config.model ?? DEFAULT_MODELS[config.provider],
      temperature: config.temperature ?? (config.provider === 'nvidia' ? 0.1 : 0.7),
      maxTokens: config.maxTokens ?? (config.provider === 'nvidia' ? 16383 : config.provider === 'openrouter' ? 8192 : 4096),
      vlm: config.vlm,
    };

    // Initialize OpenAI client for NVIDIA NIM, DeepSeek, OpenRouter, MiniMax, EverFern and Ollama Cloud
    if (config.provider === 'nvidia' || config.provider === 'deepseek' || config.provider === 'openrouter' || config.provider === 'minimax' || config.provider === 'everfern' || config.provider === 'ollama-cloud') {
      const headers: Record<string, string> = {
        'User-Agent': 'EverFern/1.0'
      };

      if (config.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://everfern.app';
        headers['X-OpenRouter-Title'] = 'EverFern';
      }

      this.openaiClient = new OpenAI({
        apiKey: this.config.apiKey || 'dummy-key',
        baseURL: this.config.baseUrl,
        timeout: 120000,
        maxRetries: 3,
        defaultHeaders: headers,
        // Disable keep-alive to avoid Node 22 undici "invalid keep-alive header" errors
        // from NVIDIA NIM and other providers that may send malformed keep-alive responses.
        fetch: (url: RequestInfo | URL, init?: RequestInit) => {
          console.log(`[AIClient Fetch] URL: ${url}, method: ${init?.method || 'GET'}`);
          const safeInit = { ...init, keepalive: false };
          if (safeInit.headers) {
            const h = safeInit.headers as Record<string, string>;
            delete h['connection'];
            delete h['Connection'];
            delete h['keep-alive'];
            delete h['Keep-Alive'];
          }
          const result = fetch(url, safeInit);
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

  supportsVision(): boolean {
    if (this.config.vlm) return false;
    if (this.config.provider === 'everfern') return true;
    const modelName = this.config.model?.toLowerCase() || '';
    const visionKeywords = ['vision', 'image', 'vl-', 'vl:'];
    if (visionKeywords.some(kw => modelName.includes(kw))) return true;
    if (this.config.provider === 'anthropic') return true;
    if (this.config.provider === 'gemini') return true;
    if (this.config.provider === 'openai' && modelName.startsWith('gpt-4')) return true;
    return false;
  }

  private _parseActionsFromContent(content: string): string[] {
    // Parse action strings from the response content
    // Format: "action1 | action2 | action3" or just "action1"
    if (!content) return [];

    const actions = content
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.toLowerCase().includes('done'));

    return actions;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    console.log(`[AIClient] chat() called: provider=${this.config.provider}, model=${request.model ?? this.config.model}, hasOnStreamChunk=${!!request.onStreamChunk}, messages=${request.messages.length}`);
    // For EverFern Cloud, route vision requests using direct HTTP (not OpenAI SDK)
    if (this.config.provider === 'everfern') {
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
              // Use direct HTTP request to /api/chat/completions for computer use
              const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
                },
                body: JSON.stringify({
                  messages: request.messages,
                  model: this.config.model,
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

              // Parse actions from the response
              const actions = this._parseActionsFromContent(content);

              console.log('[EverFern Vision] Parsed actions:', actions);

              // If we have actions, return them as a computer_use tool call
              if (actions.length > 0) {
                console.log('[EverFern Vision] Creating computer_use tool call with', actions.length, 'actions');
                return {
                  id: data.id || `everfern-${Date.now()}`,
                  content: content,
                  model: this.config.model,
                  toolCalls: [{
                    id: `call_${Date.now()}`,
                    name: 'computer_use',
                    arguments: {
                      action: 'execute_actions',
                      actions: actions
                    }
                  }],
                  finishReason: 'tool_calls'
                };
              }

              // No actions, just return the content
              console.log('[EverFern Vision] No actions found, returning content only');
              return {
                id: data.id || `everfern-${Date.now()}`,
                content: content,
                model: this.config.model,
                finishReason: 'stop'
              };
            } catch (err) {
              console.error('[EverFern Cloud] Vision grounding failed:', err);
              throw err;
            }
          }
        }
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
      // All Gemini models (including gemini-2.5-computer-use-preview-10-2025) use
      // the OpenAI-compatible v1beta/openai endpoint. The crosshair grounding loop
      // does not require the proprietary Gemini native `computer_use` tool.
      default: return this._openAICompatChat(request);
    }
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
    // For EverFern Cloud, route vision requests to /api/tars/vision
    if (this.config.provider === 'everfern') {
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
                apiBaseUrl: 'http://localhost:5000',
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
      }

      // Nvidia NIM/OpenAI strict validation:
      if (this.config.provider === 'nvidia') {
        // Flatten assistant/system messages as before to prevent format errors
        if (m.role === 'assistant' || m.role === 'system') {
          content = typeof m.content === 'string'
            ? m.content
            : m.content.filter(c => c.type === 'text').map(c => 'text' in c ? c.text : '').join('\n');
        }
        // Tool responses CANNOT contain image_url blocks in strict OpenAI schemas (like NIM).
        // We must defer the image into a subsequent user message AFTER all tools.
        else if (m.role === 'tool' && Array.isArray(m.content)) {
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
    const options: any = {
      model: req.model ?? this.config.model,
      messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: isStreaming
    };

    // Helper function for retrying with exponential backoff
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
        options.reasoning_effort = 'high';
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
      } else {
        options.response_format = { type: 'json_object' };
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
            stream: true
          }) as unknown as Promise<AsyncIterable<any>>
        );

        let fullContent = '';
        let fullReasoning = '';
        const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};
        let finishReason: any = 'stop';
        let responseId = `${this.config.provider}-${Date.now()}`;

        for await (const chunk of stream) {
          if (chunk.id) responseId = chunk.id;
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            fullContent += delta.content;
            req.onStreamChunk!(delta.content);
          }

          if ((delta as any)?.reasoning_content) {
            fullReasoning += (delta as any).reasoning_content;
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
              }
            }
          }

          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
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
          finishReason: finishReason === 'tool_calls' || toolCalls.length > 0 ? 'tool_calls' : 'stop'
        };
      } else {
        // Non-streaming mode — retry on JSON parse errors too
        const response = await retryWithBackoff(() =>
          this.openaiClient!.chat.completions.create(options) as Promise<any>,
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
            totalTokens: response.usage.total_tokens
          } : undefined,
          finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' :
            (choice?.finish_reason as ChatResponse['finishReason']) ?? 'stop'
        };
      }
    } catch (err: any) {
      console.error(`[${this.config.provider}] OpenAI SDK Error:`, err);

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

    const options: any = {
      model: req.model ?? this.config.model,
      messages,
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      stream: true
    };

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
        this.openaiClient!.chat.completions.create(options) as unknown as Promise<AsyncIterable<any>>
      );
      let id = `${this.config.provider}-${Date.now()}`;

      for await (const chunk of stream) {
        if (chunk.id) id = chunk.id;
        const delta = chunk.choices?.[0]?.delta;

        yield {
          id,
          delta: delta?.content ?? '',
          toolCalls: delta?.tool_calls,
          done: false,
          model: chunk.model
        };

        if (chunk.choices?.[0]?.finish_reason) {
          yield { id, delta: '', done: true };
          return;
        }
      }
    } catch (err) {
      console.error(`[${this.config.provider}] OpenAI SDK Stream Error:`, err);
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    switch (this.config.provider) {
      case 'ollama': return this._ollamaListModels();
      case 'anthropic': return this._anthropicListModels();
      default: return this._openAICompatListModels();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      return { ok: models.length >= 0, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async _fetchWithRetry(url: string, options: RequestInit, maxRetries = 6): Promise<Response> {
    let lastError: Error | null = null;
    let delay = 1000; // Start with 1s instead of 2s for faster initial retry

    for (let i = 0; i <= maxRetries; i++) {
      try {
        if (url.includes('nvidia') || i > 0) {
          console.log(`[AIClient] Fetching: ${url} (Attempt ${i + 1}/${maxRetries + 1})`);
        }

        // Create a new AbortController for each attempt with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout per request

        const enhancedOptions: RequestInit = {
          ...options,
          signal: controller.signal,
          headers: {
            ...options.headers,
            'User-Agent': 'EverFern/1.0'
          },
          // Disable keep-alive to avoid Node 22 undici "invalid keep-alive header" errors
          // from NVIDIA NIM and other providers that may send malformed keep-alive responses.
          keepalive: false
        };

        try {
          const res = await fetch(url, enhancedOptions);
          clearTimeout(timeoutId);

          if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            if (i < maxRetries) {
              const jitter = Math.random() * 500;
              const waitTime = delay + jitter;
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

        // Check if it's an abort error (timeout)
        if (lastError.name === 'AbortError') {
          console.warn(`[AIClient] Request timeout after 30s. Retrying...`);
          // Log Ollama-specific timeout info
          if (url.includes('/api/chat')) {
            console.log(`[Ollama] Timeout on ${url} - No response received within timeout window`);
          }
        } else {
          console.warn(`[AIClient] Network error: ${lastError.message}. Retrying in ${delay}ms...`);
          // Log error details for debugging
          if (url.includes('/api/chat')) {
            console.log(`[Ollama] Error details:`, {
              message: lastError.message,
              name: lastError.name,
              url: url
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
    throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
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
    };
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
        body['reasoning_effort'] = 'high';
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
        body['reasoning_effort'] = 'high';
      }
    }
    if (req.tools?.length) {
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

    const headers = { ...this._oaiHeaders };
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Accept'] = 'application/json';
    }

    DebugEmitter.emit('log', 'API Call POST /chat/completions', {
      url: `${this.config.baseUrl}/chat/completions`,
      headers,
      body
    });

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });

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

      // If Nvidia rejects an image payload (e.g. text-only model receives screenshot)
      if (this.config.provider === 'nvidia' && (res.status === 400 || res.status === 422 || isFormatError)) {
        throw new Error(`[${this.config.provider}] HTTP ${res.status}: ${errorMsg}. No vision capability for this model. Please select a valid vision endpoint.`);
      }

      throw new Error(`[${this.config.provider}] HTTP ${res.status}: ${errorMsg}`);
    }

    if (!isStreaming) {
      const data = await res.json();
      const choice = data.choices?.[0];
      const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJSON(tc.function.arguments),
      }));
      return {
        id: data.id ?? `${this.config.provider}-${Date.now()}`,
        content: choice?.message?.content ?? '',
        model: data.model ?? this.config.model,
        toolCalls,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' :
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const payload = t.slice(6);
        if (payload === '[DONE]') break;
        try {
          const d = JSON.parse(payload);
          if (d.id) responseId = d.id;
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

    const toolCalls = Object.values(toolCallsMap).map((tc: any) => {
      const args = safeParseJSON(tc.arguments);
      return {
        id: tc.id,
        name: tc.name,
        arguments: args,
      };
    });

    return {
      id: responseId,
      content: fullContent,
      model: this.config.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
    };
    if (this.config.provider === 'nvidia') {
      const modelName = req.model ?? this.config.model;
      if (modelName?.includes('glm')) {
        streamBody['chat_template_kwargs'] = { enable_thinking: true, clear_thinking: false };
      } else if (modelName?.includes('kimi')) {
        streamBody['chat_template_kwargs'] = { thinking: true };
      } else if (modelName?.includes('mistral')) {
        streamBody['reasoning_effort'] = 'high';
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
        streamBody['reasoning_effort'] = 'high';
      }
    }
    // Include tools in the streaming request so models can trigger tool calls
    if (req.tools?.length) {
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

    DebugEmitter.emit('log', 'API Call POST /chat/completions (Stream)', {
      url: `${this.config.baseUrl}/chat/completions`,
      headers,
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
      throw new Error(`[${this.config.provider}] Stream HTTP ${res.status}: ${errorMsg}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let id = `${this.config.provider}-${Date.now()}`;
    let isFirstChunk = true;
    let isReasoning = false;

    while (true) {
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
        if (payload === '[DONE]') { yield { id, delta: '', done: true }; return; }
        try {
          const d = JSON.parse(payload);
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
        } catch { /* skip malformed */ }
      }
    }
  }

  private async _openAICompatListModels(): Promise<string[]> {
    try {
      const res = await this._fetchWithRetry(`${this.config.baseUrl}/models`, { headers: this._oaiHeaders }, 2);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data as any[]).map((m: any) => m.id as string);
    } catch { return []; }
  }

  // ── Google Gemini Native API (for Computer Use) ──────────────────

  private async _googleGeminiChat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.config.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

    const contents = req.messages
      .filter(m => m.role !== 'system') // System instructions go in systemInstruction
      .map(m => {
        const parts: any[] = [];
        if (m.role === 'tool') {
          // Map to function_response part
          parts.push({
            function_response: {
              name: (m as any).tool_name || 'unknown', // We might need to pass this down
              response: {
                result: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                // If it was a computer_use tool, we might have safety_acknowledgement: "true"
                ...(typeof m.content !== 'string' && (m.content as any).safety_acknowledgement ? { safety_acknowledgement: "true" } : {})
              }
            }
          });
          // Also append screenshots if present in tool content
          if (Array.isArray(m.content)) {
            for (const c of m.content) {
              if (c.type === 'image_url') {
                const b64 = c.image_url.url.split(',')[1];
                // In Gemini CU, screenshots for function results can be inline_data parts
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

        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      });

    const systemInstruction = req.messages
      .filter(m => m.role === 'system')
      .map(m => ({ parts: [{ text: typeof m.content === 'string' ? m.content : '' }] }))[0];

    // Map regular tools to Google's function_declarations
    const functionDeclarations = req.tools
      ?.filter(t => t.name !== 'computer_use') // Use the native computer_use tool instead
      ?.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));

    const tools: any[] = [{ computer_use: { environment: 'ENVIRONMENT_BROWSER' } }];
    if (functionDeclarations?.length) {
      tools.push({ function_declarations: functionDeclarations });
    }

    const body: any = {
      contents,
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
    });
    console.log(`[AIClient] Gemini Native Response received in ${Date.now() - startTime}ms. Status: ${res.status}`);

    if (!res.ok) {
      const txt = await res.text();
      console.error(`[AIClient] Gemini Native Error: ${txt}`);
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
        return m;
      }),
      stream: isStreaming,
    };
    if (system) body['system'] = system;
    if (req.tools?.length) {
      body['tools'] = req.tools.map(t => {
        if (t && (t as any).type === 'function' && (t as any).function) {
          const fn = (t as any).function;
          return {
            name: fn.name,
            description: fn.description,
            input_schema: fn.parameters
          };
        }
        return {
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        };
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
    });
    if (!res.ok) {
      const txt = await res.text();
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          if (d.type === 'message_start') {
            responseId = d.message?.id ?? responseId;
          }
          if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
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
    if (system) body['system'] = system;

    const headers = this._anthropicHeaders;
    if (isStreaming) {
      headers['Accept'] = 'text/event-stream';
    }

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`[anthropic] Stream HTTP ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    let buf = '';
    let id = `anthropic-${Date.now()}`;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          if (d.type === 'message_start') id = d.message?.id ?? id;
          if (d.type === 'content_block_delta') {
            yield { id, delta: d.delta?.text ?? '', done: false };
          }
          if (d.type === 'message_stop') {
            yield { id, delta: '', done: true }; return;
          }
        } catch { /* skip */ }
      }
    }
  }

  private async _anthropicListModels(): Promise<string[]> {
    // Anthropic doesn't expose a /models endpoint; return known models
    return [
      'claude-opus-4-5', 'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    ];
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

    const body: Record<string, unknown> = {
      model: req.model ?? this.config.model,
      messages,
      stream: isStreaming,
      options: { temperature: req.temperature ?? this.config.temperature },
    };
    if (req.responseFormat === 'json') body['format'] = 'json';

    // Pass tools to Ollama if provided
    if (req.tools && req.tools.length > 0) {
      body['tools'] = req.tools.map(t => {
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
      });
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

    while (true) {
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
          console.error('[AIClient] Failed to parse Ollama stream line:', line, e);
        }
      }
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
    const res = await this._fetchWithRetry(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { ...this._ollamaHeaders, 'Accept': 'text/event-stream' },
      body: JSON.stringify({
        model: req.model ?? this.config.model,
        messages: this._mapOllamaMessages(req.messages),
        stream: true,
        options: { temperature: req.temperature ?? this.config.temperature },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      let errorMsg = res.statusText;
      try {
        const json = JSON.parse(txt);
        if (json.error) errorMsg = json.error.message || json.error;
      } catch { }
      throw new Error(`[ollama] Stream HTTP ${res.status}: ${errorMsg}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const dec = new TextDecoder();
    const id = `ollama-${Date.now()}`;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = dec.decode(value, { stream: true });
      const lines = text.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const d = JSON.parse(line);
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
          yield {
            id,
            delta: d.message?.content ?? '',
            toolCalls: d.message?.tool_calls,
            done: d.done ?? false,
            model: d.model
          };
          if (d.done) return;
        } catch { /* skip */ }
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
  }): Promise<{ instruction: string; actions: string[]; screenshot: string }> {
    if (this.config.provider !== 'everfern') {
      throw new Error(`everfernCloudVisionGrounding() only works with provider='everfern', got '${this.config.provider}'`);
    }

    const { screenshot, objective, dom = '', history = [], apiBaseUrl = 'http://localhost:5000', token } = params;

    if (!screenshot) {
      throw new Error('screenshot is required');
    }

    try {
      // Route to /api/navis/vision which supports DOM context
      const response = await fetch(`${apiBaseUrl}/api/navis/vision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` })
        },
        body: JSON.stringify({
          screenshot,
          dom,
          objective,
          history
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
 * Get a pooled AI client instance for better performance
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

/**
 * Create a client with automatic pooling management
 */
export function createManagedAIClient(config: AIClientConfig): {
  client: AIClient;
  release: () => void;
} {
  const client = getPooledAIClient(config);
  return {
    client,
    release: () => releasePooledAIClient(client, config)
  };
}
