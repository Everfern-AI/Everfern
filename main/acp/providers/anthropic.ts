/**
 * EverFern Desktop — Anthropic Provider
 * 
 * Connects to Anthropic's Messages API for Claude models.
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

export class AnthropicProvider implements ACPProvider {
  private apiKey = '';
  private baseUrl = 'https://api.anthropic.com';
  private model = 'claude-sonnet-5';

  readonly info: ProviderInfo = {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 5 and 4 models via Anthropic API',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-5',
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
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  /**
   * Anthropic uses a different message format.
   * System messages are passed as a top-level `system` param.
   */
  private formatMessages(messages: ChatCompletionRequest['messages']) {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const chat = messages.filter(m => m.role !== 'system');
    return { system: system || undefined, messages: chat };
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { system, messages } = this.formatMessages(request.messages);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.model,
        messages,
        system,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const textBlock = data.content?.find((b: any) => b.type === 'text');
    return {
      id: data.id,
      content: textBlock?.text || '',
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
      finishReason: data.stop_reason === 'max_tokens' ? 'length' : 'stop',
    };
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const { system, messages } = this.formatMessages(request.messages);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: request.model || this.model,
        messages,
        system,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic stream error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = `anthropic-${Date.now()}`;
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
        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.type === 'content_block_delta' && data.delta?.text) {
            yield { id, delta: data.delta.text, done: false };
          } else if (data.type === 'message_stop') {
            yield { id, delta: '', done: true };
            return;
          }
        } catch {
          // skip
        }
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      if (response.ok) return { ok: true };
      return { ok: false, error: `Status ${response.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async listModels(): Promise<string[]> {
    return PROVIDER_MODELS.anthropic;
  }
}
