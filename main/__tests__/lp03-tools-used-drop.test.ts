// @vitest-environment node

/**
 * LP-03: the non-standard `tools_used` name-array must be dropped from ALL
 * outgoing OpenAI-compat request bodies — non-streaming chat, streaming chat
 * (onStreamChunk branch), and the streamChat() generator — with and without
 * tools present. All fetches are stubbed; no network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

const BASE = 'http://127.0.0.1:1234/v1';

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(lines.join('\n') + '\n\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200, statusText: 'OK' });
}

const TOOLS = [
  { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
];

describe('LP-03 — tools_used dropped from compat request bodies', () => {
  let client: AIClient;
  let bodies: any[];
  let origFetch: typeof globalThis.fetch;

  const newClient = (model = 'test-model') =>
    new AIClient({ provider: 'lmstudio', baseUrl: BASE, model });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bodies = [];
    client = newClient();
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        // No capabilities field → tools assumed supported (LP-04 default), so
        // the native tools array should still be present in these bodies.
        return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200 });
      }
      bodies.push(JSON.parse(init?.body ?? '{}'));
      if (String(init?.body ?? '').includes('"stream":true')) {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"hi"}}]}',
          'data: [DONE]',
        ]);
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('non-stream chat WITH tools sends the tools array but no tools_used key', async () => {
    await client.chat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty('tools_used');
    expect(Array.isArray(bodies[0].tools)).toBe(true);
    expect(bodies[0].tools[0].function.name).toBe('search');
  });

  it('non-stream chat WITHOUT tools sends no tools_used key', async () => {
    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty('tools_used');
    expect(bodies[0]).not.toHaveProperty('tools');
  });

  it('streaming chat (onStreamChunk branch) WITH tools sends no tools_used key', async () => {
    const chunks: string[] = [];
    const res = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
      onStreamChunk: (c) => chunks.push(c),
    });
    expect(res.content).toBe('hi');
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty('tools_used');
    expect(bodies[0].stream).toBe(true);
    expect(Array.isArray(bodies[0].tools)).toBe(true);
  });

  it('streamChat() generator WITH tools sends no tools_used key', async () => {
    const collected: any[] = [];
    for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS })) {
      collected.push(chunk);
      if (chunk.done) break;
    }
    expect(collected.length).toBeGreaterThan(0);
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty('tools_used');
    expect(bodies[0].stream).toBe(true);
    expect(Array.isArray(bodies[0].tools)).toBe(true);
  });
});
