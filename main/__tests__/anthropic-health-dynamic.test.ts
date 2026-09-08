// @vitest-environment node

/**
 * XI.C: anthropic healthCheck must probe the LIVE /v1/models endpoint —
 * never a static list. ok:false when the endpoint errors (bad key/quota),
 * ok:true + parsed ids when a models payload responds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

describe('AIClient anthropic healthCheck (XI.C dynamic /v1/models)', () => {
  let client: AIClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof globalThis.fetch;

  const newClient = () => new AIClient({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-6',
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
    vi.restoreAllMocks();
  });

  it('ok:false when /v1/models errors (e.g. 401 unauthorized)', async () => {
    fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const health = await client.healthCheck();
    expect(health.ok).toBe(false);

    // Exactly one probe — fail-fast, no retries on a list-model call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/models');
    expect((init as any).headers['x-api-key']).toBe('sk-ant-test');
    expect((init as any).headers['anthropic-version']).toBe('2023-06-01');
  });

  it('ok:false on network failure (endpoint unreachable)', async () => {
    fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const health = await client.healthCheck();
    expect(health.ok).toBe(false);
  });

  it('ok:true + parsed ids when /v1/models returns a models payload', async () => {
    fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ data: [{ id: 'claude-opus-4-5' }, { id: 'claude-sonnet-4-6' }] }),
      { status: 200 }
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const health = await client.healthCheck();
    expect(health.ok).toBe(true);
    expect(typeof health.latencyMs).toBe('number');

    const models = await client.listModels();
    expect(models).toEqual(['claude-opus-4-5', 'claude-sonnet-4-6']);
  });
});
