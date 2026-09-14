// @vitest-environment node

/**
 * LP-08 / LP-09: local embeddings routing + no silent Transformers.js fallback.
 *
 * LP-09: LM Studio embeddings must POST to <lmstudio baseUrl>/embeddings
 *        (OpenAI-compatible, port 1234) — never OllamaEmbeddings (port 11434).
 * LP-08: ollama/lmstudio embed failures must rethrow, never fall back to
 *        @xenova/transformers (CPU download competing with the local daemon).
 *        Cloud providers keep the fallback (cloud-path preservation).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  // Regression-guard state: OllamaEmbeddings constructor calls + transformers
  // module access. Hoisted so vi.mock factories (also hoisted) can close over it.
  const ollamaCtorCalls: any[] = [];
  const state = { transformersAccessed: false };
  return { ollamaCtorCalls, state };
});

// LP-08: mock @xenova/transformers so fallback tests never download a model
// and we can assert whether the module was imported at all.
vi.mock('@xenova/transformers', () => {
  h.state.transformersAccessed = true;
  return {
    env: { allowLocalModels: false },
    pipeline: async () => async () => ({ data: new Float32Array(384).fill(0.5) }),
  };
});

// LP-09 regression guard: spy on OllamaEmbeddings construction.
vi.mock('@langchain/ollama', () => {
  return {
    OllamaEmbeddings: class {
      constructor(opts: any) { h.ollamaCtorCalls.push(opts); }
      embedQuery = async () => { throw new Error('ollama daemon down'); };
      embedDocuments = async () => { throw new Error('ollama daemon down'); };
    },
  };
});

// Fresh module per test: clears embeddings.ts module state (localPipeline) and
// re-runs mock factories, so transformersAccessed reflects this test's imports.
async function freshEmbeddings() {
  vi.resetModules();
  return await import('../lib/embeddings');
}

const makeRes = (body: any, ok = true, status = 200, statusText = 'OK'): any => ({
  ok,
  status,
  statusText,
  text: async () => JSON.stringify(body),
});

const unit = (idx: number, len = 768): number[] =>
  Array.from({ length: len }, (_, i) => (i === idx ? 1 : 0));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  h.ollamaCtorCalls.length = 0;
  h.state.transformersAccessed = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LP-09: lmstudio embeddings routing', () => {
  it('embedQuery POSTs {model, input} to <baseUrl>/embeddings and resizes to 1536', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockResolvedValueOnce(makeRes({ data: [{ embedding: unit(0) }] }));

    const model = getEmbeddingModel({
      provider: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'text-embedding-test',
    });
    const vec = await model.embeddings.embedQuery('hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1234/v1/embeddings');
    expect((init as any).method).toBe('POST');
    expect(JSON.parse((init as any).body)).toEqual({
      model: 'text-embedding-test',
      input: 'hello',
    });
    // Wrapper must pass through resizeAndNormalizeEmbedding (LP-09 spec).
    expect(vec).toHaveLength(1536);
    expect(vec[0]).toBeCloseTo(1, 6);
    expect(vec[1]).toBe(0);
  });

  it('defaults baseUrl to 127.0.0.1:1234/v1 when unset', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockResolvedValueOnce(makeRes({ data: [{ embedding: unit(0) }] }));

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    await model.embeddings.embedQuery('x');

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:1234/v1/embeddings');
  });

  it('embedDocuments maps data[i] to texts[i] in order', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockResolvedValueOnce(
      makeRes({ data: [{ embedding: unit(0) }, { embedding: unit(1) }] })
    );

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    const vecs = await model.embeddings.embedDocuments(['first', 'second']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).input).toEqual(['first', 'second']);
    expect(vecs).toHaveLength(2);
    expect(vecs.every(v => v.length === 1536)).toBe(true);
    // Order-preserving: doc 0 -> marker at 0, doc 1 -> marker at 1.
    expect(vecs[0][0]).toBeCloseTo(1, 6);
    expect(vecs[0][1]).toBe(0);
    expect(vecs[1][0]).toBe(0);
    expect(vecs[1][1]).toBeCloseTo(1, 6);
  });

  it('mismatched vector count is rejected (order/length integrity)', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockResolvedValueOnce(makeRes({ data: [{ embedding: unit(0) }] }));

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    await expect(model.embeddings.embedDocuments(['a', 'b'])).rejects.toThrow(
      /2 vectors|returned 1 vector/
    );
  });

  it('missing model gives an actionable error and makes no request', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    const model = getEmbeddingModel({ provider: 'lmstudio' });

    await expect(model.embeddings.embedQuery('x')).rejects.toThrow(
      /LM Studio embeddings require a model/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-ok response gives the actionable "not reachable" error with status', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockResolvedValueOnce(makeRes({ error: { message: 'no model loaded' } }, false, 404, 'Not Found'));

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    await expect(model.embeddings.embedQuery('x')).rejects.toThrow(
      /LM Studio embeddings not reachable at .*404.*start LM Studio/
    );
  });
});

describe('LP-09: ollama regression guard (cloud-untouched)', () => {
  it('ollama still constructs OllamaEmbeddings with the 11434 daemon', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    getEmbeddingModel({ provider: 'ollama', model: 'nomic-embed-text' });

    expect(h.ollamaCtorCalls).toHaveLength(1);
    expect(h.ollamaCtorCalls[0].model).toBe('nomic-embed-text');
    expect(h.ollamaCtorCalls[0].baseUrl).toBe('http://localhost:11434');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LP-08: no Transformers.js fallback for local providers', () => {
  it('lmstudio embedQuery failure rejects with no-fallback message and no @xenova import', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    await expect(model.embeddings.embedQuery('x')).rejects.toThrow(
      /\[Embeddings\] Local provider 'lmstudio' failed .* not falling back to Transformers\.js/
    );
    expect(h.state.transformersAccessed).toBe(false);
  });

  it('lmstudio embedDocuments failure also rejects without fallback', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    const model = getEmbeddingModel({ provider: 'lmstudio', model: 'm1' });
    await expect(model.embeddings.embedDocuments(['a', 'b'])).rejects.toThrow(
      /not falling back to Transformers\.js/
    );
    expect(h.state.transformersAccessed).toBe(false);
  });

  it('ollama failure rejects with no-fallback message and no @xenova import', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    const model = getEmbeddingModel({ provider: 'ollama', model: 'nomic-embed-text' });

    await expect(model.embeddings.embedQuery('x')).rejects.toThrow(
      /\[Embeddings\] Local provider 'ollama' failed \(ollama daemon down\) — not falling back to Transformers\.js/
    );
    await expect(model.embeddings.embedDocuments(['x'])).rejects.toThrow(
      /not falling back to Transformers\.js/
    );
    expect(h.state.transformersAccessed).toBe(false);
  });
});

describe('LP-08: cloud fallback preserved (cloud-path unchanged)', () => {
  it('nvidia embedQuery failure falls back to Transformers.js and still returns 1536 dims', async () => {
    const { getEmbeddingModel } = await freshEmbeddings();
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    const model = getEmbeddingModel({ provider: 'nvidia', apiKey: 'k', model: 'nvidia/nv-embedqa-e5-v5' });
    const vec = await model.embeddings.embedQuery('cloud prompt');

    expect(h.state.transformersAccessed).toBe(true);
    expect(vec).toHaveLength(1536);
    // Mocked pipeline yields 384-dim 0.5-filled vector -> normalized, zero-padded to 1536.
    expect(vec[0]).toBeGreaterThan(0);
    expect(vec[383]).toBeGreaterThan(0);
    expect(vec[384]).toBe(0);
  });
});
