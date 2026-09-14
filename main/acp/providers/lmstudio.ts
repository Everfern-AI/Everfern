/**
 * EverFern Desktop — LM Studio Provider
 * 
 * Connects to a locally-running LM Studio server.
 * Uses OpenAI-compatible API at http://localhost:1234/v1
 */

import type {
  ACPProvider,
  ProviderInfo,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from '../types';

export class LMStudioProvider implements ACPProvider {
  private baseUrl = 'http://localhost:1234/v1';
  private model = 'local-model';

  readonly info: ProviderInfo = {
    type: 'lmstudio',
    name: 'LM Studio',
    description: 'Run models locally via LM Studio (OpenAI-compatible)',
    requiresApiKey: false,
    defaultModel: 'local-model',
    isLocal: true,
  };

  initialize(config: ProviderConfig): void {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.model) this.model = config.model;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      id: data.id || `lmstudio-${Date.now()}`,
      content: choice?.message?.content || '',
      model: data.model || this.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
      finishReason: (choice?.finish_reason as 'stop' | 'length') || 'stop',
    };
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 2048,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio stream error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = `lmstudio-${Date.now()}`;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          yield { id, delta: '', done: true };
          return;
        }
        try {
          const data = JSON.parse(payload);
          const delta = data.choices?.[0]?.delta?.content || '';
          yield { id, delta, done: false, model: data.model };
        } catch {
          // skip
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      if (response.ok) return { ok: true };
      return { ok: false, error: `Status ${response.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }
}
