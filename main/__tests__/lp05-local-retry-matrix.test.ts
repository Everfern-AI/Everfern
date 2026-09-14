// @vitest-environment node

/**
 * LP-05: local retry matrix — per-attempt timeout 15s for non-stream calls,
 * maxRetries clamped to 1, local 5xx returned immediately (never retried),
 * ECONNREFUSED fast-fail preserved, and streaming bodies keep the 60s ceiling
 * so healthy local generations are not killed. Cloud path unchanged
 * (60s, caller-supplied retry count). Fake timers; no network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

const LOCAL_BASE = 'http://127.0.0.1:1234/v1';
const CLOUD_BASE = 'https://api.fakecloud.test/v1';

describe('LP-05 — local retry matrix', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const newLocalClient = () =>
    new AIClient({ provider: 'lmstudio', baseUrl: LOCAL_BASE, model: 'test-model' });

  it('local 5xx is returned immediately — never retried (even with maxRetries 6)', async () => {
    fetchMock = vi.fn(async () => new Response('server boom', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = newLocalClient();

    const res = await (client as any)._fetchWithRetry(
      `${LOCAL_BASE}/chat/completions`,
      { method: 'POST', body: '{"x":1}' },
      6
    );
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('local generic network error with maxRetries 6 stops after 1 retry (2 attempts)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock = vi.fn(async () => { throw new Error('socket kaboom'); });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = newLocalClient();

    const pending = (client as any)._fetchWithRetry(
      `${LOCAL_BASE}/chat/completions`,
      { method: 'POST', body: '{"x":1}' },
      6
    );
    // Attach the rejection expectation BEFORE advancing timers so the
    // rejection is always handled the moment fake timers fire it.
    const expectation = expect(pending).rejects.toThrow('socket kaboom');
    await vi.advanceTimersByTimeAsync(5_000); // covers the single ~1s backoff
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('local non-stream timeout is 15s — aborts, retries once, then fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let aborts = 0;
    fetchMock = vi.fn((_url: any, init?: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborts++;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = newLocalClient();

    const pending = (client as any)._fetchWithRetry(
      `${LOCAL_BASE}/chat/completions`,
      { method: 'POST', body: '{"x":1,"stream":false}' },
      6
    );
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_000); // first 15s timeout fires
    await vi.advanceTimersByTimeAsync(1_000);  // 1s backoff → retry
    await vi.advanceTimersByTimeAsync(15_000); // second 15s timeout fires
    await expectation;
    expect(aborts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('local STREAMING bodies keep the 60s ceiling — no abort at 15s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let aborts = 0;
    fetchMock = vi.fn((_url: any, init?: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborts++;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = newLocalClient();

    const pending = (client as any)._fetchWithRetry(
      `${LOCAL_BASE}/chat/completions`,
      { method: 'POST', body: '{"x":1,"stream":true}' },
      6
    );
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(15_000); // former local timeout point
    expect(aborts).toBe(0); // healthy stream not killed at 15s
    await vi.advanceTimersByTimeAsync(45_000); // 60s total → abort
    await vi.advanceTimersByTimeAsync(1_000);  // 1s backoff → retry
    await vi.advanceTimersByTimeAsync(60_000); // second 60s timeout
    await expectation;
    expect(aborts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ECONNREFUSED from a local daemon still fails fast with the actionable error', async () => {
    const connRefused = new TypeError('fetch failed');
    (connRefused as any).cause = { code: 'ECONNREFUSED' };
    fetchMock = vi.fn(async () => { throw connRefused; });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = newLocalClient();

    await expect(
      (client as any)._fetchWithRetry(`${LOCAL_BASE}/chat/completions`, { method: 'POST' }, 3)
    ).rejects.toThrow(/LM Studio not reachable/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cloud path unchanged — persistent 5xx still exhausts the full caller-supplied retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock = vi.fn(async () => new Response('boom', { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new AIClient({ provider: 'openai', apiKey: 'sk-test', baseUrl: CLOUD_BASE, model: 'gpt-test' });

    const pending = (client as any)._fetchWithRetry(`${CLOUD_BASE}/x`, { method: 'POST' });
    await vi.advanceTimersByTimeAsync(30_000); // 1s + 2s + 4s backoffs (+jitter)
    const res = await pending;
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(4); // default maxRetries=3
  });
});
