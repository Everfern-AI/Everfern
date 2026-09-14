// @vitest-environment node

/**
 * LP-07 (sentinel sites — providers.ts + acp/providers/lmstudio.ts):
 *
 * - lib/providers.ts lmstudio entry keeps 'local-model' as the SENTINEL
 *   defaultModel (resolved client-side by AIClient at first send — see
 *   lp07-local-model-resolution.test.ts for the ai-client side), and no
 *   provider entry in the registry carries a provider-prefixed id
 *   ('lmstudio:'/'ollama:') that could leak to the wire.
 * - acp/providers/lmstudio.ts: sentinel default model, loopback-normalized
 *   base URL (127.0.0.1, not 'localhost' — LP-10 note), and the
 *   'lmstudio:'-prefix strip at both config-in and wire boundaries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PROVIDER_REGISTRY, PROVIDER_MODELS, getDefaultModel } from '../providers';
import { LMStudioProvider } from '../../acp/providers/lmstudio';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LP-07 lib/providers.ts sentinel', () => {
  it('lmstudio registry entry carries the local-model sentinel, not a real id', () => {
    expect(PROVIDER_REGISTRY.lmstudio.defaultModel).toBe('local-model');
    expect(getDefaultModel('lmstudio')).toBe('local-model');
    expect(PROVIDER_REGISTRY.lmstudio.isLocal).toBe(true);
  });

  it('no registry default model is provider-prefixed (lmstudio:/ollama:)', () => {
    for (const meta of Object.values(PROVIDER_REGISTRY)) {
      expect(meta.defaultModel.startsWith('lmstudio:')).toBe(false);
      expect(meta.defaultModel.startsWith('ollama:')).toBe(false);
    }
  });

  it('no static model list contains provider-prefixed ids', () => {
    for (const models of Object.values(PROVIDER_MODELS)) {
      for (const m of models) {
        expect(m.startsWith('lmstudio:')).toBe(false);
        expect(m.startsWith('ollama:')).toBe(false);
      }
    }
  });
});

describe('LP-07 acp LMStudioProvider sentinel + prefix strip', () => {
  it('info.defaultModel is the sentinel, never a real id', () => {
    const p = new LMStudioProvider();
    expect(p.info.defaultModel).toBe('local-model');
    expect(p.info.isLocal).toBe(true);
  });

  it('initialize() strips a renderer lmstudio: prefix before storing the model', () => {
    const p = new LMStudioProvider();
    p.initialize({ type: 'lmstudio', model: 'lmstudio:qwen-2.5-7b' });
    // Observable via the wire body: the stored model must be prefix-free.
    expect((p as any).model).toBe('qwen-2.5-7b');
  });

  it('initialize() normalizes localhost/::1 base URLs to 127.0.0.1 (LP-10)', () => {
    const p = new LMStudioProvider();
    p.initialize({ type: 'lmstudio', baseUrl: 'http://localhost:1234/v1' });
    expect((p as any).baseUrl).toBe('http://127.0.0.1:1234/v1');

    const p2 = new LMStudioProvider();
    p2.initialize({ type: 'lmstudio', baseUrl: 'http://[::1]:1234/v1' });
    expect((p2 as any).baseUrl).toBe('http://127.0.0.1:1234/v1');

    const p3 = new LMStudioProvider();
    p3.initialize({ type: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' });
    expect((p3 as any).baseUrl).toBe('http://127.0.0.1:1234/v1');
  });

  it('chat() strips a lmstudio: prefix at the wire boundary and sends the sentinel when unset', async () => {
    const bodies: any[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (_url: any, init?: any) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({ id: 'x', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], model: 'qwen' }),
        { status: 200 },
      );
    }) as any;

    try {
      const p = new LMStudioProvider();
      // No request.model → falls back to the stored sentinel.
      await p.chat({ messages: [{ role: 'user', content: 'hi' }] } as any);
      expect(bodies[0].model).toBe('local-model');

      // Prefixed request.model → stripped before the wire.
      await p.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'lmstudio:llama-3.2' } as any);
      expect(bodies[1].model).toBe('llama-3.2');

      // Bare request.model → unchanged.
      await p.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'qwen-2.5-7b' } as any);
      expect(bodies[2].model).toBe('qwen-2.5-7b');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('streamChat() strips a lmstudio: prefix at the wire boundary', async () => {
    const bodies: any[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (_url: any, init?: any) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200 });
    }) as any;

    try {
      const p = new LMStudioProvider();
      const chunks: any[] = [];
      for await (const chunk of p.streamChat({ messages: [{ role: 'user', content: 'hi' }], model: 'lmstudio:llama-3.2' } as any)) {
        chunks.push(chunk);
      }
      expect(bodies[0].model).toBe('llama-3.2');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[chunks.length - 1].done).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
