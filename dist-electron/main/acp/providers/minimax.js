"use strict";
/**
 * EverFern Desktop — MiniMax Provider
 *
 * Connects to MiniMax's OpenAI-compatible API.
 * Requires a user-provided API key.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiniMaxProvider = void 0;
class MiniMaxProvider {
    apiKey = '';
    baseUrl = 'https://api.minimax.io/v1';
    model = 'minimax-m2.7';
    info = {
        type: 'minimax',
        name: 'MiniMax',
        description: 'MiniMax M2.5 and M2.7 via API',
        requiresApiKey: true,
        defaultModel: 'minimax-m2.7',
        isLocal: false,
    };
    initialize(config) {
        if (config.apiKey)
            this.apiKey = config.apiKey;
        if (config.baseUrl)
            this.baseUrl = config.baseUrl;
        if (config.model)
            this.model = config.model;
    }
    get headers() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };
    }
    async chat(request) {
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
            throw new Error(`MiniMax error ${response.status}: ${err}`);
        }
        const data = await response.json();
        const choice = data.choices?.[0];
        return {
            id: data.id || `minimax-${Date.now()}`,
            content: choice?.message?.content || '',
            model: data.model || this.model,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
            } : undefined,
            finishReason: choice?.finish_reason || 'stop',
        };
    }
    async *streamChat(request) {
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
            throw new Error(`MiniMax stream error: ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const payload = trimmed.slice(6);
                if (payload === '[DONE]') {
                    yield { id: `minimax-${Date.now()}`, delta: '', done: true };
                    return;
                }
                try {
                    const data = JSON.parse(payload);
                    yield {
                        id: data.id || `minimax-${Date.now()}`,
                        delta: data.choices?.[0]?.delta?.content || '',
                        done: false,
                        model: data.model,
                    };
                }
                catch {
                    // skip
                }
            }
        }
    }
    async healthCheck() {
        try {
            const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
            if (response.ok)
                return { ok: true };
            return { ok: false, error: `Status ${response.status}` };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
        }
    }
    async listModels() {
        return ['minimax-m2.5', 'minimax-m2.7'];
    }
}
exports.MiniMaxProvider = MiniMaxProvider;
