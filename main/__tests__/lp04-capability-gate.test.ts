// @vitest-environment node

/**
 * LP-04: tools capability-gating for local compat models — cached
 * /v1/models capabilities.tools probe (1 fetch for N requests), tools array
 * stripped + embedded-JSON system instruction injected when unsupported,
 * the model's fenced {"tool":...,"arguments":{...}} answer converted into
 * synthetic tool_calls (chat + streamChat paths), and the pure extractor
 * unit-tested for fenced/unfenced/malformed/trailing-prose/none cases.
 * Absent capabilities → tools still sent (no regression). Cloud untouched.
 * Fetches stubbed; no network. Unique ports isolate the probe cache per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient, extractEmbeddedToolCall } from '../lib/ai-client';

const TOOLS = [
  { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
];

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

describe('extractEmbeddedToolCall (LP-04 pure extractor)', () => {
  it('parses a fenced json block', () => {
    expect(extractEmbeddedToolCall('Sure!\n```json\n{"tool":"search","arguments":{"q":"cats"}}\n```')).toEqual({
      name: 'search',
      arguments: { q: 'cats' },
    });
  });

  it('parses an unfenced bare JSON object', () => {
    expect(extractEmbeddedToolCall('{"tool":"search","arguments":{"q":"dogs"}}')).toEqual({
      name: 'search',
      arguments: { q: 'dogs' },
    });
  });

  it('parses JSON with surrounding trailing prose', () => {
    expect(extractEmbeddedToolCall('Here you go: {"tool":"search","arguments":{"q":"x"}} — hope that helps!')).toEqual({
      name: 'search',
      arguments: { q: 'x' },
    });
  });

  it('treats whitespace-only padding fine', () => {
    expect(extractEmbeddedToolCall('   \n{"tool":"t","arguments":{}}\n  ')).toEqual({ name: 't', arguments: {} });
  });

  it('returns null for the explicit "none" answer', () => {
    expect(extractEmbeddedToolCall('```json\n{"tool":"none","arguments":{}}\n```')).toBeNull();
  });

  it('returns null for prose / malformed JSON / empty input', () => {
    expect(extractEmbeddedToolCall('I will search the web for you now.')).toBeNull();
    expect(extractEmbeddedToolCall('```json\n{"tool": search, broken\n```')).toBeNull();
    expect(extractEmbeddedToolCall('')).toBeNull();
    expect(extractEmbeddedToolCall('no json here at all')).toBeNull();
  });

  it('ignores thinking blocks so reasoning prose never matches', () => {
    // reasoning block contains a decoy {"tool":...} shape; the real answer follows.
    // Built via concat so this source file itself stays parseable.
    const open = String.fromCharCode(60) + 'think>';
    const close = String.fromCharCode(60) + '/think>';
    const content = open + ' hmm maybe {"tool":"decoy","arguments":{}} not sure ' + close +
      '```json\n{"tool":"real","arguments":{}}\n```';
    expect(extractEmbeddedToolCall(content)).toEqual({
      name: 'real',
      arguments: {},
    });
  });
});

describe('LP-04 — capability gate on local compat requests', () => {
  let bodies: any[];
  let modelsCalls: number;
  let origFetch: typeof globalThis.fetch;

  const stub = (base: string, modelsPayload: any, content: any) => {
    bodies = [];
    modelsCalls = 0;
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/models')) {
        modelsCalls++;
        return new Response(JSON.stringify(modelsPayload), { status: 200 });
      }
      bodies.push(JSON.parse(init?.body ?? '{}'));
      if (String(init?.body ?? '').includes('"stream":true')) {
        return sseResponse(content);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('tools-UNsupported: probe cached (1 /models call for 2 requests), tools stripped, instruction injected', async () => {
    const base = 'http://127.0.0.1:2411/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: false } }] }, 'ok');
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    const messages = [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'find cats' }];
    await client.chat({ messages: [...messages], tools: TOOLS });
    await client.chat({ messages: [...messages], tools: TOOLS });

    expect(modelsCalls).toBe(1); // cached after the first probe
    expect(bodies.length).toBe(2);
    for (const b of bodies) {
      expect(b).not.toHaveProperty('tools');
      expect(b).not.toHaveProperty('tool_choice');
      const sys = b.messages.find((m: any) => m.role === 'system');
      expect(typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content)).toContain('does not support native tool-calling');
      expect(typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content)).toContain('"tool"');
      expect(b.messages.find((m: any) => m.role === 'user').content).toBe('find cats');
    }
  });

  it('tools-UNsupported: embedded JSON answer converted to synthetic tool_calls (non-stream)', async () => {
    const base = 'http://127.0.0.1:2412/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: 0 } }] },
      '```json\n{"tool":"search","arguments":{"q":"cats"}}\n```');
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    const res = await client.chat({ messages: [{ role: 'user', content: 'find cats' }], tools: TOOLS });
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe('search');
    expect(res.toolCalls![0].arguments).toEqual({ q: 'cats' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('tools-UNsupported: embedded JSON answer converted on the onStreamChunk branch', async () => {
    const base = 'http://127.0.0.1:2413/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: false } }] },
      [
        'data: {"choices":[{"delta":{"content":"```json\\n"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"tool\\":\\"search\\",\\"arguments\\":{\\"q\\":\\"cats\\"}}"}}]}',
        'data: {"choices":[{"delta":{"content":"\\n```\\n"}}]}',
        'data: [DONE]',
      ]);
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    const res = await client.chat({
      messages: [{ role: 'user', content: 'find cats' }],
      tools: TOOLS,
      onStreamChunk: () => {},
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].name).toBe('search');
    expect(res.toolCalls![0].arguments).toEqual({ q: 'cats' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('tools-UNsupported: streamChat() generator emits a synthetic toolCalls chunk', async () => {
    const base = 'http://127.0.0.1:2414/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: false } }] },
      [
        'data: {"choices":[{"delta":{"content":"{\\"tool\\":\\"search\\",\\"arguments\\":{\\"q\\":\\"dogs\\"}}"}}]}',
        'data: [DONE]',
      ]);
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    const chunks: any[] = [];
    for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS })) {
      chunks.push(chunk);
    }
    const toolChunk = chunks.find((c) => c.toolCalls && c.toolCalls.length);
    expect(toolChunk).toBeTruthy();
    expect(toolChunk.toolCalls[0].function.name).toBe('search');
    expect(JSON.parse(toolChunk.toolCalls[0].function.arguments)).toEqual({ q: 'dogs' });
    expect(chunks.some((c) => c.done)).toBe(true);
  });

  it('capabilities absent → native tools still sent (no regression, probe not cached)', async () => {
    const base = 'http://127.0.0.1:2415/v1';
    stub(base, { data: [{ id: 'test-model' }] }, 'ok'); // no capabilities field
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
    await client.chat({ messages: [{ role: 'user', content: 'hi again' }], tools: TOOLS });
    expect(bodies[0].tools).toBeTruthy();
    expect(bodies[0].tool_choice).toBe('auto');
    expect(bodies[1].tools).toBeTruthy();
    // absent capabilities are inconclusive → not cached, re-probed per request
    expect(modelsCalls).toBe(2);
  });

  it('capabilities.tools true → native tools sent', async () => {
    const base = 'http://127.0.0.1:2416/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: true } }] }, 'ok');
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
    expect(bodies[0].tools[0].function.name).toBe('search');
    expect(bodies[0].tool_choice).toBe('auto');
  });

  it('malformed embedded answer → null extraction, no synthetic tool_calls (nudge path stays available)', async () => {
    const base = 'http://127.0.0.1:2417/v1';
    stub(base, { data: [{ id: 'test-model', capabilities: { tools: false } }] }, 'I will pretend to call the tool now.');
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'test-model' });

    const res = await client.chat({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS });
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(res.toolCalls).toBeUndefined();
    expect(res.finishReason).toBe('stop');
  });
});
