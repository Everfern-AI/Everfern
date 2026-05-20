/**
 * EverFern Desktop — ACP (AI Completion Provider) Type Definitions
 * 
 * These types define the contract that all AI providers must implement.
 * This enables a unified interface for local engines (Ollama, LM Studio)
 * and cloud providers (OpenAI, Anthropic, DeepSeek, EverFern Cloud).
 */

// ── Chat Message Types ──────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id?: string;
  role: MessageRole;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
  thought?: string;
  reasoning_content?: string;
  toolCalls?: any[];
  attachments?: any[];
  hasTimeline?: boolean;
  orderIndex?: number;
  thinkingDuration?: number;
  stopped?: boolean;
  createdAt?: string;
}

// ── Request / Response ──────────────────────────────────────────────

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
}

export interface StreamChunk {
  id: string;
  delta: string;
  done: boolean;
  model?: string;
  toolCalls?: any[];
}

// ── Provider Configuration ──────────────────────────────────────────

export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'everfern' | 'gemini' | 'nvidia' | 'openrouter';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ProviderInfo {
  type: ProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultModel: string;
  isLocal: boolean;
}

// ── Provider Interface ──────────────────────────────────────────────

export interface ACPProvider {
  readonly info: ProviderInfo;
  
  /**
   * Initialize the provider with config (API key, base URL, etc.)
   */
  initialize(config: ProviderConfig): void;

  /**
   * Send a non-streaming chat completion request.
   */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Send a streaming chat completion request.
   * Yields StreamChunk objects as tokens arrive.
   */
  streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Check if the provider is reachable and configured correctly.
   */
  healthCheck(): Promise<{ ok: boolean; error?: string }>;

  /**
   * List available models for this provider (if supported).
   */
  listModels?(): Promise<string[]>;
}

// ── Stored Config (persisted in ~/.everfern/store) ──────────────────

export interface ACPStoredConfig {
  engine: 'local' | 'online' | 'everfern';
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  vlm?: {
    engine: 'online' | 'local';
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
  timestamp: string;
}

// ── Conversation History ────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  provider: ProviderType;
  model?: string;
  projectId?: string;
  projectName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  provider: ProviderType;
  model?: string;
  projectId?: string;
  projectName?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}
