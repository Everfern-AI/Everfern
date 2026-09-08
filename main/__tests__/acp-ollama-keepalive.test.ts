// @vitest-environment node

/**
 * LP-11: ACP OllamaProvider native request bodies carry keep_alive:'30m'
 * in BOTH chat and streamChat (spec: "add to ACP provider too"). The AIClient
 * bodies already landed keep_alive (ai-client.ts :3420/:3607) — this covers the
 * divergent ACP-side body builders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../acp/providers/ollama';

const msg = [{ role: 'user' as const, content: 'ping' }];

describe('LP-11: ACP OllamaProvider keep_alive', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'pong' }, done: true }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chat(): /api/chat body includes keep_alive 30m', async () => {
    const p = new OllamaProvider();
    p.initialize({ baseUrl: 'http://localhost:11434', model: 'llama3' } as any);
    await p.chat({ messages: msg } as any);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.keep_alive).toBe('30m');
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
  });

  it('streamChat(): /api/chat body includes keep_alive 30m', async () => {
    const p = new OllamaProvider();
    p.initialize({ baseUrl: 'http://localhost:11434', model: 'llama3' } as any);
    for await (const _chunk of p.streamChat({ messages: msg } as any)) {
      // drain (mock reader yields done immediately — zero chunks)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.keep_alive).toBe('30m');
    expect(body.stream).toBe(true);
  });
});
