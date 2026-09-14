// @vitest-environment node

/**
 * AI-PERF-03: retry stacking cap — _fetchWithRetry gives up after the
 * reduced default (3 retries / 4 attempts) on persistent 5xx, honors a
 * numeric Retry-After header, and never retries a user-requested abort.
 * All fetches are stubbed and backoff waits run on fake timers — no real
 * network and no wall-clock sleeping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

describe('AIClient._fetchWithRetry retry cap (AI-PERF-03)', () => {
  let client: AIClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof globalThis.fetch;

  // LP-05: this suite pins the CLOUD retry matrix — the baseUrl is a fake
  // remote host (loopback would now clamp retries/timeout per the local matrix).
  const newClient = () => new AIClient({
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.fakecloud.test/v1',
    model: 'gpt-test',
  });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    client = newClient();
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('default maxRetries is 3 — persistent 500 gives up after 4 attempts total', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock = vi.fn(async () => new Response('server boom', { status: 500, statusText: 'Internal Server Error' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Exhausted retries RETURN the final 500 response (callers check res.ok).
    const pending = (client as any)._fetchWithRetry('https://api.fakecloud.test/v1/chat/completions', { method: 'POST' });
    // Flush the exponential backoff waits (1s + 2s + 4s + jitter).
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;
    expect(res.status).toBe(500);

    // 1 initial attempt + 3 retries = 4 total.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('an explicit lower maxRetries is still honored by callers that pass it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock = vi.fn(async () => new Response('server boom', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

      const pending = (client as any)._fetchWithRetry('https://api.fakecloud.test/v1/x', { method: 'POST' }, 1);
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('honors a numeric Retry-After header (seconds) in the backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    fetchMock = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } });
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = (client as any)._fetchWithRetry('https://api.fakecloud.test/v1/x', { method: 'POST' });
    // Advance virtual time enough to cover the Retry-After-driven waits.
    await vi.advanceTimersByTimeAsync(121_000);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('user-requested abort is never retried (fails fast with AbortError)', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchMock = vi.fn(async () => {
      throw new Error('fetch should not be reached');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      (client as any)._fetchWithRetry('https://api.fakecloud.test/v1/x', { method: 'POST' }, 3, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('5xx that recovers returns the successful response without exhausting attempts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('boom', { status: 500 });
      return new Response('{"ok":true}', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = (client as any)._fetchWithRetry('https://api.fakecloud.test/v1/x', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(10_000); // covers the single ~1s backoff
    const res = await pending;
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
});
