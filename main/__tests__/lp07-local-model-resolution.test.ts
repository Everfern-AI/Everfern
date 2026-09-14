// @vitest-environment node

/**
 * LP-07 (ai-client site): the 'local-model' sentinel is resolved centrally —
 * prefix-stripped ids, listModels()-based resolution cached per baseUrl, an
 * actionable error when no models are loaded (the sentinel is never sent
 * verbatim), and per-request sentinel fallback. Fetches stubbed; no network.
 * Each test uses a UNIQUE port so the module-level per-baseUrl caches stay isolated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

describe('LP-07 — local default-model resolution (ai-client site)', () => {
  let bodies: any[];
  let modelsCalls: number;
  let chatCalls: number;
  let origFetch: typeof globalThis.fetch;

  const stub = (base: string, modelsPayload: any) => {
    bodies = [];
    modelsCalls = 0;
    chatCalls = 0;
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/models')) {
        modelsCalls++;
        return new Response(JSON.stringify(modelsPayload), { status: 200 });
      }
      chatCalls++;
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('resolves the lmstudio sentinel to the first listed model before first send', async () => {
    const base = 'http://127.0.0.1:2311/v1';
    stub(base, { data: [{ id: 'qwen-2.5-7b' }, { id: 'llama-3.2' }] });
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });

    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('ok');
    expect(modelsCalls).toBe(1);
    expect(chatCalls).toBe(1);
    expect(bodies[0].model).toBe('qwen-2.5-7b'); // resolved id, not 'local-model'
  });

  it('caches the resolution per baseUrl — a second client does not re-probe', async () => {
    const base = 'http://127.0.0.1:2312/v1';
    stub(base, { data: [{ id: 'qwen-2.5-7b' }] });
    const first = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });
    await first.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(modelsCalls).toBe(1);

    const second = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });
    await second.chat({ messages: [{ role: 'user', content: 'hi again' }] });
    expect(modelsCalls).toBe(1); // cache hit, no new /models fetch
    expect(bodies[1].model).toBe('qwen-2.5-7b');
  });

  it('empty model list fails with the actionable error and never sends the sentinel', async () => {
    const base = 'http://127.0.0.1:2313/v1';
    stub(base, { data: [] });
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });

    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/LM Studio reports no models loaded/);
    expect(chatCalls).toBe(0); // 'local-model' was never sent anywhere
    expect(bodies.length).toBe(0);
  });

  it('unreachable listModels surfaces the actionable transport error, not the sentinel', async () => {
    const base = 'http://127.0.0.1:2314/v1';
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/models')) {
        return new Response('nope', { status: 404 });
      }
      throw new Error('chat should not be reached');
    }) as unknown as typeof fetch;

    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });
    // /models 404 → listModels swallows to [] → the actionable empty-list error.
    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/no models loaded/);
  });

  it("strips 'lmstudio:'/'ollama:' id prefixes in the constructor (local providers only)", async () => {
    const base = 'http://127.0.0.1:2315/v1';
    stub(base, { data: [{ id: 'whatever' }] });
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'lmstudio:my-model' });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(modelsCalls).toBe(0); // concrete model — no probe
    expect(bodies[0].model).toBe('my-model');
    expect(client.model).toBe('my-model');
  });

  it('a concrete (non-sentinel) model id is untouched and triggers no probe', async () => {
    const base = 'http://127.0.0.1:2316/v1';
    stub(base, { data: [{ id: 'whatever' }] });
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'my-model' });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(modelsCalls).toBe(0);
    expect(bodies[0].model).toBe('my-model');
  });

  it("a per-request 'local-model' model falls back to the resolved config model", async () => {
    const base = 'http://127.0.0.1:2317/v1';
    stub(base, { data: [{ id: 'resolved-m1' }] });
    const client = new AIClient({ provider: 'lmstudio', baseUrl: base, model: 'local-model' });

    await client.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'local-model' });
    expect(bodies[0].model).toBe('resolved-m1');
  });

  it('ollama provider sentinel resolves via /api/tags the same way', async () => {
    const base = 'http://127.0.0.1:2318';
    bodies = [];
    origFetch = globalThis.fetch;
    let tagsCalls = 0;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/api/tags')) {
        tagsCalls++;
        return new Response(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }), { status: 200 });
      }
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new AIClient({ provider: 'ollama', baseUrl: base, model: 'local-model' });
    await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(tagsCalls).toBe(1);
    expect(bodies[0].model).toBe('llama3.1:8b');
  });
});
