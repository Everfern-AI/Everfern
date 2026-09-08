// @vitest-environment node

/**
 * LP-12: adaptive num_ctx on native Ollama bodies — configurable via
 * config.ollamaNumCtx, else clamp(ceil(estTokens×1.5), 2048, 16384), with a
 * warning when the prompt estimate exceeds the effective context (silent
 * left-trunction). Also pins the LP-11 keep_alive:'30m' regression. The
 * pure estimator gets direct unit tests (text-only, image-free).
 * Fetches stubbed; no network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient, estimatePromptTokens } from '../lib/ai-client';

describe('estimatePromptTokens (LP-12 pure helper)', () => {
  it('counts string content + role tags as chars/4 (ceil)', () => {
    // role 'user' (4) + content (40) = 44 chars → 11 tokens
    expect(estimatePromptTokens([{ role: 'user', content: 'a'.repeat(40) }])).toBe(11);
  });

  it('sums text parts of array content and ignores image parts', () => {
    const est = estimatePromptTokens([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'b'.repeat(80) },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'x'.repeat(10_000) } },
          { type: 'text', text: 'c'.repeat(40) },
        ],
      },
    ]);
    expect(est).toBe(Math.ceil((4 + 80 + 40) / 4));
  });

  it('handles null/undefined/empty inputs without throwing', () => {
    expect(estimatePromptTokens(undefined)).toBe(0);
    expect(estimatePromptTokens(null)).toBe(0);
    expect(estimatePromptTokens([])).toBe(0);
  });
});

describe('LP-12 — adaptive num_ctx on Ollama native bodies', () => {
  let bodies: any[];
  let origFetch: typeof globalThis.fetch;

  const newClient = (opts: { ollamaNumCtx?: number; base?: string } = {}) =>
    new AIClient({ provider: 'ollama', baseUrl: opts.base ?? 'http://127.0.0.1:11434', model: 'llama3', ollamaNumCtx: opts.ollamaNumCtx });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bodies = [];
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('small prompt → clamp(ceil(est×1.5), 2048, 16384)', async () => {
    const client = newClient();
    const messages = [{ role: 'user', content: 'x'.repeat(400) }];
    await client.chat({ messages });

    const est = estimatePromptTokens(messages);
    const expected = Math.min(16384, Math.max(2048, Math.ceil(est * 1.5)));
    expect(bodies[0].options.num_ctx).toBe(expected);
    expect(bodies[0].keep_alive).toBe('30m'); // LP-11 regression pin
  });

  it('giant prompt clamps at 16384 and warns about silent truncation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = newClient();
    const messages = [{ role: 'user', content: 'x'.repeat(200_000) }]; // ~50k tokens
    await client.chat({ messages });

    expect(bodies[0].options.num_ctx).toBe(16384);
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.map((c: any[]) => c.join(' ')).find((t: string) => t.includes('LP-12'));
    expect(msg).toBeTruthy();
    expect(msg).toContain('exceeds num_ctx 16384');
  });

  it('explicit ollamaNumCtx is honored verbatim (no adaptive rewrite)', async () => {
    const client = newClient({ ollamaNumCtx: 8192 });
    await client.chat({ messages: [{ role: 'user', content: 'small prompt' }] });
    expect(bodies[0].options.num_ctx).toBe(8192);
  });

  it('warns when estTokens exceeds an explicit small ollamaNumCtx', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = newClient({ ollamaNumCtx: 2048 });
    await client.chat({ messages: [{ role: 'user', content: 'y'.repeat(40_000) }] }); // ~10k tokens
    expect(bodies[0].options.num_ctx).toBe(2048);
    const msg = warn.mock.calls.map((c: any[]) => c.join(' ')).find((t: string) => t.includes('LP-12'));
    expect(msg).toBeTruthy();
    expect(msg).toContain('exceeds num_ctx 2048');
  });

  it('streaming body (_ollamaStream) gets the same adaptive num_ctx', async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('{"message":{"content":"ok"},"done":false}\n{"message":{},"done":true}\n'));
          c.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const client = newClient();
    const messages = [{ role: 'user', content: 'z'.repeat(2_000) }];
    for await (const _chunk of client.streamChat({ messages })) break;

    const est = estimatePromptTokens(messages);
    expect(bodies[0].options.num_ctx).toBe(Math.min(16384, Math.max(2048, Math.ceil(est * 1.5))));
    expect(bodies[0].keep_alive).toBe('30m');
  });
});
