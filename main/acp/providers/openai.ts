/**
 * EverFern Desktop — OpenAI Provider
 * 
 * Connects to OpenAI's API for chat completions.
 * Requires a user-provided API key.
 */

import type {
  ACPProvider,
  ProviderInfo,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from '../types';
import { PROVIDER_MODELS } from '../../lib/providers';

export class OpenAIProvider implements ACPProvider {
  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';
  private model = 'gpt-5.5';

  readonly info: ProviderInfo = {
    type: 'openai',
    name: 'OpenAI',
    description: 'GPT-5.6, GPT-5.5, GPT-5.4, GPT-4o and o-series via OpenAI API',
    requiresApiKey: true,
    defaultModel: 'gpt-5.5',
    isLocal: false,
  };

  initialize(config: ProviderConfig): void {
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.model) this.model = config.model;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      id: data.id,
      content: choice?.message?.content || '',
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      finishReason: (choice?.finish_reason as 'stop' | 'length') || 'stop',
    };
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI stream error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
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
          yield { id: `openai-${Date.now()}`, delta: '', done: true };
          return;
        }
        try {
          const data = JSON.parse(payload);
          yield {
            id: data.id || `openai-${Date.now()}`,
            delta: data.choices?.[0]?.delta?.content || '',
            done: false,
            model: data.model,
          };
        } catch {
          // skip
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      if (response.ok) return { ok: true };
      return { ok: false, error: `Status ${response.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      if (!response.ok) return PROVIDER_MODELS.openai;
      const data = await response.json();
      const live = (data.data as any[])
        .map((m: any) => m.id as string)
        .filter(id => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'));
      return live.length > 0 ? live : PROVIDER_MODELS.openai;
    } catch {
      return PROVIDER_MODELS.openai;
    }
  }
}
