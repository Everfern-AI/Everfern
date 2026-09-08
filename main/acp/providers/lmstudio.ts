/**
 * EverFern Desktop — LM Studio Provider
 * 
 * Connects to a locally-running LM Studio server.
 * Uses OpenAI-compatible API at http://127.0.0.1:1234/v1
 * 
 * LP-07: 'local-model' is a sentinel — AIClient resolves it to a real model
 * id via listModels() at first send; never send it verbatim on the wire and
 * never persist resolved ids back into provider metadata.
 */

import type {
  ACPProvider,
  ProviderInfo,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
} from '../types';

// LP-10: normalize loopback — bare 'localhost' may dial ::1 while LM Studio
// binds IPv4 only, producing bare "fetch failed" (see ai-client
// normalizeLocalUrl for the same fix on the AIClient side).
function normalizeLmStudioBaseUrl(url: string): string {
  return url
    .replace(/^http:\/\/\[?::1\]?(:\d+)?/i, 'http://127.0.0.1$1')
    .replace(/^http:\/\/localhost(:\d+)?/i, 'http://127.0.0.1$1');
}

// LP-07: strip renderer-scoped prefixes ('lmstudio:<id>') so a prefixed id
// can never leak to the wire. Mirrors normalizeRequestedModel in
// ipc/agent/stream-handlers.ts (the live path); this class is currently
// unimported but kept safe for any future wiring.
function stripLmStudioPrefix(model: string): string {
  return model.startsWith('lmstudio:') ? model.slice('lmstudio:'.length) : model;
}

export class LMStudioProvider implements ACPProvider {
  // LP-10: 127.0.0.1 (not 'localhost') per the un-normalized-localhost note.
  private baseUrl = 'http://127.0.0.1:1234/v1';
  // LP-07: sentinel — resolved client-side at first send, never a real id.
  private model = 'local-model';

  readonly info: ProviderInfo = {
    type: 'lmstudio',
    name: 'LM Studio',
    description: 'Run models locally via LM Studio (OpenAI-compatible)',
    requiresApiKey: false,
    // LP-07: sentinel — AIClient resolves it via listModels() at first send.
    defaultModel: 'local-model',
    isLocal: true,
  };

  initialize(config: ProviderConfig): void {
    if (config.baseUrl) this.baseUrl = normalizeLmStudioBaseUrl(config.baseUrl);
    // LP-07: strip any renderer 'lmstudio:' prefix before storing.
    if (config.model) this.model = stripLmStudioPrefix(config.model);
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // LP-07: strip renderer 'lmstudio:' prefix at the wire boundary.
        model: request.model ? stripLmStudioPrefix(request.model) : this.model,
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
        // LP-07: strip renderer 'lmstudio:' prefix at the wire boundary.
        model: request.model ? stripLmStudioPrefix(request.model) : this.model,
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
