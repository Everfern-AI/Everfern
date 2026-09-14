// @vitest-environment node

/**
 * AI-PERF-02 — semantic-cache exact-hash pre-check
 *
 * (a) exact-hash hit returns the cached response with ZERO embedQuery calls,
 * (b) a repeated prompt triggers embedQuery at most once (memoized),
 * (c) telemetry counters move on each path.
 *
 * Network and disk paths (db, embeddings provider clients) are mocked away —
 * these tests are DOM-free and never touch ~/.everfern or a provider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../lib/db', () => ({
  dbOps: {
    get: vi.fn(async () => null),
    run: vi.fn(async () => {}),
    all: vi.fn(async () => []),
  },
  ensureVectorTable: vi.fn(async () => {}),
}));

const embedQueryMock = vi.fn(async () => [0.1, 0.2, 0.3]);

vi.mock('../lib/embeddings', () => ({
  getSystemEmbeddingConfig: vi.fn(() => ({ provider: 'openai', apiKey: 'test-key' })),
  getEmbeddingModel: vi.fn(() => ({
    embeddings: { embedQuery: (...args: any[]) => embedQueryMock(...args) },
    dimensions: 1536,
  })),
}));

import { lookupCache, saveCache, getCacheTelemetry, resetCacheTelemetry, clearExactCache } from '../lib/cache';
import { dbOps } from '../lib/db';

describe('AI-PERF-02 · semantic-cache exact-hash pre-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCacheTelemetry();
    clearExactCache();
  });

  it('an exact-hash hit returns the response with ZERO embedQuery calls', async () => {
    const prompt = 'What is the capital of France?';
    const response = { id: 'r1', content: 'Paris', model: 'gpt-test', finishReason: 'stop' } as any;

    await saveCache(prompt, response);
    // The DB write path itself embeds once to persist the vector — that's fine.
    embedQueryMock.mockClear();
    (dbOps.get as any).mockClear();
    (dbOps.run as any).mockClear();

    const cached = await lookupCache(prompt);

    expect(cached).toEqual(response);
    expect(embedQueryMock).not.toHaveBeenCalled();
    expect((dbOps.get as any).mock.calls.length).toBe(0);
    expect(getCacheTelemetry().exactHits).toBe(1);
    expect(getCacheTelemetry().embeds).toBe(0);
  });

  it('a repeated prompt embeds at most once (query memoization)', async () => {
    (dbOps.get as any).mockResolvedValue(null);

    const prompt = 'Write a haiku about the sea.';
    const first = await lookupCache(prompt);
    const second = await lookupCache(prompt);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(embedQueryMock.mock.calls.length).toBeLessThanOrEqual(1);
    expect(embedQueryMock).toHaveBeenCalledWith(prompt);
  });

  it('telemetry counters move on miss, semantic hit, and exact hit', async () => {
    // Semantic hit: vector row returned by the DB.
    const prompt = 'Summarize quantum entanglement.';
    (dbOps.get as any).mockResolvedValue({
      response_json: JSON.stringify({ id: 'q', content: 'Spooky action', model: 'm', finishReason: 'stop' }),
      distance: 0.01,
    });

    const semantic = await lookupCache(prompt);
    expect(semantic?.content).toBe('Spooky action');
    expect(getCacheTelemetry().semanticHits).toBe(1);

    // Exact hit on the same prompt now that it's been promoted to the LRU.
    const exact = await lookupCache(prompt);
    expect(exact?.content).toBe('Spooky action');
    expect(getCacheTelemetry().exactHits).toBe(1);

    // Miss path.
    (dbOps.get as any).mockResolvedValue(null);
    const miss = await lookupCache('A totally different prompt about pottery.');
    expect(miss).toBeNull();
    expect(getCacheTelemetry().misses).toBe(1);
  });
});
