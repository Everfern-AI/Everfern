// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../ai-client';
import { getProvidersByEngine, requiresApiKey } from '../providers';

vi.mock('../debug', () => ({ DebugEmitter: { emit: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

describe('llama.cpp provider', () => {
  it('is offered as a local provider without a required key', () => {
    expect(getProvidersByEngine('local').map(p => p.type)).toContain('llamacpp');
    expect(requiresApiKey('llamacpp')).toBe(false);
  });

  it.each([
    [undefined, 'http://127.0.0.1:8080/v1/models'],
    ['http://localhost:9090/', 'http://127.0.0.1:9090/v1/models'],
    ['http://192.168.1.2:8080/v1/', 'http://192.168.1.2:8080/v1/models'],
  ])('discovers models from %s', async (baseUrl, expected) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'my-model.gguf' }] })));
    vi.stubGlobal('fetch', fetch);
    const client = new AIClient({ provider: 'llamacpp', baseUrl });
    expect(client.isLocal()).toBe(true);
    expect(await client.listModels()).toEqual(['my-model.gguf']);
    expect(fetch.mock.calls[0][0]).toBe(expected);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('sends chat and tools using the OpenAI-compatible endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'reply', choices: [{ message: { content: '', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'lookup', arguments: '{"query":"hi"}' } }] }, finish_reason: 'tool_calls' }],
    })));
    vi.stubGlobal('fetch', fetch);
    const client = new AIClient({ provider: 'llamacpp', model: 'my-model.gguf', apiKey: 'optional-key' });
    const response = await client.chat({ messages: [{ role: 'user', content: 'Hi' }], tools: [{ name: 'lookup', description: 'Look up a value', parameters: { type: 'object', properties: { query: { type: 'string' } } } }] });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer optional-key');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('my-model.gguf');
    expect(body.tools[0].function.name).toBe('lookup');
    expect(response.toolCalls?.[0].name).toBe('lookup');
  });

  it('streams text from llama-server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'data: {"id":"reply","choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )));
    const client = new AIClient({ provider: 'llamacpp', model: 'my-model.gguf' });
    const chunks = [];
    for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) chunks.push(chunk);
    expect(chunks.map(c => c.delta).join('')).toBe('Hello');
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it('reports an unsuccessful health check when no model is loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"data":[]}')));
    const client = new AIClient({ provider: 'llamacpp' });
    expect((await client.healthCheck()).ok).toBe(false);
  });
});
