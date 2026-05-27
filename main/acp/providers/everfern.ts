/**
 * EverFern Desktop — EverFern Cloud Provider
 * 
 * Connects to the EverFern backend for managed AI access.
 * No API key required — uses EverFern's managed infrastructure.
 */

import type {
  ACPProvider,
  ProviderInfo,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from '../types';

export class EverFernCloudProvider implements ACPProvider {
  private baseUrl = 'https://api.everfern.app';
  private model = 'everfern-1';

  readonly info: ProviderInfo = {
    type: 'everfern',
    name: 'EverFern Cloud',
    description: 'Managed AI infrastructure optimized for EverFern workflows',
    requiresApiKey: false,
    defaultModel: 'everfern-1',
    isLocal: false,
  };

  initialize(config: ProviderConfig): void {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.model) this.model = config.model;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      throw new Error(`EverFern Cloud error ${response.status}: ${err}`);
    }

    const data = await response.json();
    // Support both OpenAI-style and custom response shapes
    const content = data.choices?.[0]?.message?.content || data.content || data.response || '';
    return {
      id: data.id || `everfern-${Date.now()}`,
      content,
      model: data.model || this.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
      finishReason: 'stop',
    };
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await fetch(`${this.baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`EverFern Cloud stream error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = `everfern-${Date.now()}`;
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
          yield {
            id,
            delta: data.choices?.[0]?.delta?.content || data.delta || '',
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
      const response = await fetch(`${this.baseUrl}/health`);
      if (response.ok) return { ok: true };
      return { ok: false, error: `Status ${response.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }
}
