// @vitest-environment node

/**
 * LP-11: local model warm-up — URL/body contract, timeout, no-throw, VITEST
 * guard. The guard means warmupLocalModel itself no-ops under vitest, so the
 * request-contract cases temporarily clear process.env.VITEST (restored in
 * afterEach) to exercise the real fetch path with a mocked global.fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { warmupLocalModel, warmupFromActiveConfig } from '../lib/model-warmup';

describe('LP-11 model-warmup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const hadVitest = process.env.VITEST;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    if (hadVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = hadVitest;
    vi.restoreAllMocks();
  });

  it('VITEST guard: skips all fetch when process.env.VITEST is set', async () => {
    process.env.VITEST = 'true';
    await warmupLocalModel({ provider: 'ollama', model: 'llama3' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ollama: POSTs {base}/api/generate with keep_alive 30m + num_predict 1', async () => {
    delete process.env.VITEST;
    await warmupLocalModel({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/',
      model: 'qwen3-vl:2b',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      model: 'qwen3-vl:2b',
      prompt: '.',
      keep_alive: '30m',
      options: { num_predict: 1 },
    });
  });

  it('ollama: defaults baseUrl to localhost:11434 when unset', async () => {
    delete process.env.VITEST;
    await warmupLocalModel({ provider: 'ollama', model: 'llama3' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
  });

  it('ollama: sentinel/empty model id skips warmup (would 404)', async () => {
    delete process.env.VITEST;
    await warmupLocalModel({ provider: 'ollama', model: 'local-model' });
    await warmupLocalModel({ provider: 'ollama', model: '' });
    await warmupLocalModel({ provider: 'ollama' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lmstudio: GETs {base}/v1/models (reachability ping)', async () => {
    delete process.env.VITEST;
    await warmupLocalModel({ provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/models');
    expect(init.method).toBeUndefined(); // GET (default)
    expect(init.body).toBeUndefined();
  });

  it('non-local providers: zero fetch calls', async () => {
    delete process.env.VITEST;
    await warmupLocalModel({ provider: 'openai', model: 'gpt-4' });
    await warmupLocalModel({ provider: 'anthropic', model: 'claude-3' });
    await warmupLocalModel({ provider: 'everfern' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch rejection: never throws (logged and swallowed)', async () => {
    delete process.env.VITEST;
    fetchMock.mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    await expect(
      warmupLocalModel({ provider: 'ollama', model: 'llama3' })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout path: aborts after 10s without throwing', async () => {
    delete process.env.VITEST;
    // Never-resolving fetch that respects the abort signal.
    fetchMock.mockImplementation((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        );
      })
    );
    const t0 = Date.now();
    await expect(
      warmupLocalModel({ provider: 'ollama', model: 'llama3' })
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(9000);
    expect(elapsed).toBeLessThan(30000);
  }, 40000);

  it('warmupFromActiveConfig: no provider configured → no fetch, no throw', async () => {
    delete process.env.VITEST;
    await expect(warmupFromActiveConfig(() => null)).resolves.toBeUndefined();
    await expect(warmupFromActiveConfig(() => ({ provider: 'everfern' }))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warmupFromActiveConfig: local chat provider + local vlm → warms both', async () => {
    delete process.env.VITEST;
    await warmupFromActiveConfig(() => ({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      vlm: { engine: 'local', provider: 'ollama', model: 'qwen3-vl:2b', baseUrl: 'http://localhost:11434' },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(c => JSON.parse(c[1].body));
    expect(bodies[0].model).toBe('llama3');
    expect(bodies[1].model).toBe('qwen3-vl:2b');
  });
});
