// @vitest-environment node

/**
 * AI-CORR-01 / AI-CORR-02 / AI-CORR-04 hardening tests — SSE parse-error
 * accounting, credential log redaction, and abort-signal threading in the
 * fetch layer. Node environment, DOM-free.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AIClient,
  parseSSELine,
  parseNDJSONLine,
  redactCredentialForLog,
} from '../lib/ai-client';
import { DebugEmitter } from '../lib/debug';

// ── AI-CORR-04: Authorization header redaction ─────────────────────

describe('redactCredentialForLog (AI-CORR-04)', () => {
  it('shows only scheme + last4 — never the token body', () => {
    const out = redactCredentialForLog('Bearer sk-proj-abcdef123456');
    expect(out).toBe('Bearer …3456');
    expect(out).not.toContain('sk-proj');
    expect(out).not.toContain('abcdef');
  });

  it('handles raw (scheme-less) keys and empty values', () => {
    expect(redactCredentialForLog('nvapi-zzzz9999')).toBe('…9999');
    expect(redactCredentialForLog('')).toBe('(empty)');
    expect(redactCredentialForLog(undefined)).toBe('(empty)');
  });
});

describe('AIClient fetch-wrapper Authorization logging (AI-CORR-04)', () => {
  const TOKEN = 'sk-secret-abcdef7890';

  /**
   * Invokes the custom fetch wrapper installed on the OpenAI SDK client
   * (the code path that previously logged the first 18 chars of the bearer
   * token) with a stubbed global fetch, capturing console output.
   */
  async function captureWrapperLog(): Promise<string[]> {
    const client = new AIClient({
      provider: 'openai',
      apiKey: TOKEN,
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const logs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.warn = () => {};
    console.error = () => {};

    const sdkClient = (client as any).openaiClient;
    expect(sdkClient).toBeDefined();
    const customFetch = (sdkClient as any).fetch as typeof fetch;
    expect(typeof customFetch).toBe('function');

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"ok":true}', { status: 200, statusText: 'OK' })) as unknown as typeof fetch;

    try {
      await customFetch('http://localhost:9/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
    } finally {
      globalThis.fetch = origFetch;
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
    return logs;
  }

  it('never logs raw Authorization fragments — only Bearer …last4', async () => {
    const logs = await captureWrapperLog();
    const authLog = logs.find((l) => l.includes('Authorization header present'));
    expect(authLog).toBeDefined();
    expect(authLog).toContain('…7890');
    expect(authLog).not.toContain('sk-secret');
    expect(authLog).not.toContain('abcdef');
    // No log line anywhere contains the raw token or an 18-char prefix.
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(TOKEN.slice(0, 18));
    }
  });
});

describe('AIClient compat-path DebugEmitter headers (AI-CORR-04)', () => {
  const TOKEN = 'sk-leaky-abcdef1234';

  /**
   * Runs chat()/streamChat() on the OpenAI-compat path (provider 'openai',
   * which dispatches to _openAICompatChat/_openAICompatStream) with a stubbed
   * global fetch, capturing every DebugEmitter 'log' entry. Both compat emit
   * sites ("API Call POST /chat/completions" and its "(Stream)" variant)
   * previously serialized the raw Authorization header into the debug ring.
   */
  function captureEmitEntries(): { titles: string[]; serialized: string } {
    const entries: { title: string; data: unknown }[] = [];
    const listener = (title: string, data: unknown) => entries.push({ title, data });
    DebugEmitter.on('log', listener as (...args: unknown[]) => void);
    return {
      titles: [] as string[],
      get serialized() {
        return entries
          .map((e) => `${e.title} ${typeof e.data === 'object' ? JSON.stringify(e.data) : String(e.data)}`)
          .join('\n');
      },
      cleanup() {
        DebugEmitter.removeListener('log', listener as (...args: unknown[]) => void);
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chat() emits redacted Authorization — never the raw bearer token', async () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: TOKEN,
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const capture = captureEmitEntries();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        status: 200,
        statusText: 'OK',
      })) as unknown as typeof fetch;

    try {
      const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res.content).toBe('hi');
    } finally {
      globalThis.fetch = origFetch;
      capture.cleanup();
    }

    const apiCall = capture.serialized;
    expect(apiCall).toContain('API Call POST /chat/completions');
    // Redacted form keeps scheme + last4; the raw token never crosses the wire.
    expect(apiCall).toContain('Bearer …1234');
    expect(apiCall).not.toContain(TOKEN);
    expect(apiCall).not.toContain('sk-leaky');
    expect(apiCall).not.toContain('abcdef1234');
  });

  it('streamChat() emits redacted Authorization — never the raw bearer token', async () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: TOKEN,
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const capture = captureEmitEntries();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, { status: 200, statusText: 'OK' })) as unknown as typeof fetch;

    const chunks: string[] = [];
    try {
      for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'hi' }] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
    } finally {
      globalThis.fetch = origFetch;
      capture.cleanup();
    }
    expect(chunks.join('')).toBe('hi');

    const apiCall = capture.serialized;
    expect(apiCall).toContain('API Call POST /chat/completions (Stream)');
    expect(apiCall).toContain('Bearer …1234');
    expect(apiCall).not.toContain(TOKEN);
    expect(apiCall).not.toContain('sk-leaky');
    expect(apiCall).not.toContain('abcdef1234');
  });
});

// ── AI-CORR-01: SSE parse helpers + counter ─────────────────────────

describe('parseSSELine (AI-CORR-01)', () => {
  it('parses well-formed data lines', () => {
    expect(parseSSELine('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({
      choices: [{ delta: { content: 'hi' } }],
    });
  });

  it('returns undefined for [DONE], blanks and non-data lines', () => {
    expect(parseSSELine('data: [DONE]')).toBeUndefined();
    expect(parseSSELine('')).toBeUndefined();
    expect(parseSSELine('event: ping')).toBeUndefined();
  });

  it('returns undefined for malformed JSON payloads', () => {
    expect(parseSSELine('data: {not-json')).toBeUndefined();
    expect(parseSSELine('data: [1,2,')).toBeUndefined();
  });

  it('rejects non-object JSON payloads (numbers/strings)', () => {
    expect(parseSSELine('data: 42')).toBeUndefined();
    expect(parseSSELine('data: "str"')).toBeUndefined();
  });
});

describe('parseNDJSONLine (AI-CORR-01)', () => {
  it('parses NDJSON lines and rejects malformed/blank ones', () => {
    expect(parseNDJSONLine('{"message":{"content":"x"}}')).toEqual({
      message: { content: 'x' },
    });
    expect(parseNDJSONLine('{broken')).toBeUndefined();
    expect(parseNDJSONLine('   ')).toBeUndefined();
  });
});

describe('AIClient.sseParseErrorCount (AI-CORR-01)', () => {
  let client: AIClient;
  let warnCalls: string[][];
  let origWarn: typeof console.warn;

  beforeEach(() => {
    client = new AIClient({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });
    expect(client.sseParseErrorCount).toBe(0);
    warnCalls = [];
    origWarn = console.warn;
    console.warn = ((...args: unknown[]) => {
      warnCalls.push(args.map(String));
    }) as typeof console.warn;
  });

  afterEach(() => {
    console.warn = origWarn;
    vi.restoreAllMocks();
  });

  /**
   * Streams malformed SSE lines through the OpenAI-compatible reader by
   * stubbing global fetch with an SSE response body, then asserts the
   * counter incremented and console.warn fired exactly once for 12 errors.
   */
  it('counts malformed SSE lines and rate-limits the warn to 1-per-10', async () => {
    const badLine = 'data: {this-is-not-valid-json';
    const sse = [
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      ...Array(12).fill(badLine),
      'data: [DONE]',
      '',
    ].join('\n');

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(body, { status: 200, statusText: 'OK' })
    ) as unknown as typeof fetch;

    const chunks: string[] = [];
    try {
      const res = await client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        onStreamChunk: (c) => chunks.push(c),
      });
      expect(res.content).toBe('a'); // well-formed line still delivered
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(client.sseParseErrorCount).toBe(12);
    // Rate-limited: 12 errors → warns on #1 and #10 only.
    expect(warnCalls.length).toBe(2);
    expect(warnCalls[0][0]).toContain('SSE parse error');
    // The logged fragment is truncated to 120 chars and never contains
    // more than the malformed line itself.
    const loggedLine = warnCalls[0][1] ?? '';
    expect(loggedLine.length).toBeLessThanOrEqual(120);
  });

  it('is exposed as a public getter for health telemetry', () => {
    expect(typeof client.sseParseErrorCount).toBe('number');
  });
});

// ── AI-CORR-02: abort signal reaches fetch ──────────────────────────

describe('AIClient abort threading (AI-CORR-02)', () => {
  it('chat() with a pre-aborted signal rejects with AbortError without calling fetch', async () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const origFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch should not be reached');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const controller = new AbortController();
      controller.abort();
      await client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        abortSignal: controller.signal,
      });
      throw new Error('expected chat() to reject');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('undefined abortSignal keeps timeout-only behavior (no fetch.signal mangling)', async () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n\n'));
        controller.close();
      },
    });

    const origFetch = globalThis.fetch;
    let seenSignal: AbortSignal | null | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response(body, { status: 200, statusText: 'OK' });
    }) as unknown as typeof fetch;

    try {
      const res = await client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        onStreamChunk: () => {},
      });
      expect(res.content).toBe('ok');
      // Without an abortSignal the internal timeout controller still drives fetch.
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('mid-stream abort rejects the reader loop with AbortError', async () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:9',
      model: 'gpt-test',
    });

    const controller = new AbortController();
    const encoder = new TextEncoder();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        reads++;
        if (reads === 1) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n'));
        } else if (reads === 2) {
          // Simulate user pressing stop between chunks.
          controller.abort();
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"second"}}]}\n'));
        } else {
          c.close();
        }
      },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(body, { status: 200, statusText: 'OK' })
    ) as unknown as typeof fetch;

    const chunks: string[] = [];
    try {
      await client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        onStreamChunk: (c) => chunks.push(c),
        abortSignal: controller.signal,
      });
      throw new Error('expected chat() to reject on abort');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(chunks[0]).toBe('first');
  });
});
