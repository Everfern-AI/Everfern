/**
 * EverFern Desktop — Memoized Embeddings Accessor (AI-PERF-02/03)
 *
 * Wraps lib/embeddings with two layers of memoization so hot paths
 * (semantic-cache lookups, per-message indexing) stop rebuilding provider
 * clients and stop re-embedding identical text:
 *   1. Embedding-model memo: one resolved model per
 *      (provider|model|baseUrl|keyFingerprint).
 *   2. embedQuery memo: LRU of prompt-hash → vector, so a repeated prompt
 *      costs zero network.
 *   3. Short-TTL memo of getSystemEmbeddingConfig() to avoid re-reading
 *      config.json on every indexed message.
 */

import { createHash } from 'crypto';
import { EmbeddingConfig, getSystemEmbeddingConfig, getEmbeddingModel } from './embeddings';

interface MemoizedEmbeddingModel {
  embeddings: {
    embedQuery: (text: string) => Promise<number[]>;
  };
  dimensions: number;
}

const MODEL_CACHE_CAP = 8;
const QUERY_CACHE_CAP = 200;
const CONFIG_TTL_MS = 5000;

const modelCache = new Map<string, MemoizedEmbeddingModel>();
const queryCache = new Map<string, number[]>();

let cachedConfig: EmbeddingConfig | null = null;
let cachedConfigAt = 0;

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt.trim()).digest('hex');
}

function fingerprintSecret(value?: string): string {
  if (!value) return 'none';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function configFingerprint(config: EmbeddingConfig): string {
  return [
    config.provider,
    config.model || '',
    config.baseUrl || '',
    fingerprintSecret(config.apiKey),
  ].join('|');
}

function evictOldest<T>(cache: Map<string, T>, cap: number): void {
  if (cache.size <= cap) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

export function getMemoizedEmbeddingModel(config: EmbeddingConfig): MemoizedEmbeddingModel {
  const fingerprint = configFingerprint(config);
  const cached = modelCache.get(fingerprint);
  if (cached) return cached;

  const resolved = getEmbeddingModel(config) as unknown as MemoizedEmbeddingModel;
  const target = resolved.embeddings as { embedQuery: (text: string) => Promise<number[]> };
  const originalEmbedQuery = target.embedQuery.bind(target);

  target.embedQuery = async (text: string): Promise<number[]> => {
    const cacheKey = `${fingerprint}:${hashPrompt(text)}`;
    const hit = queryCache.get(cacheKey);
    if (hit) {
      queryCache.delete(cacheKey);
      queryCache.set(cacheKey, hit);
      return hit;
    }
    const vector = await originalEmbedQuery(text);
    if (queryCache.has(cacheKey)) queryCache.delete(cacheKey);
    queryCache.set(cacheKey, vector);
    evictOldest(queryCache, QUERY_CACHE_CAP);
    return vector;
  };

  modelCache.set(fingerprint, resolved);
  evictOldest(modelCache, MODEL_CACHE_CAP);
  return resolved;
}

export function getMemoizedSystemEmbeddingConfig(): EmbeddingConfig {
  const now = Date.now();
  if (cachedConfig && now - cachedConfigAt < CONFIG_TTL_MS) {
    return cachedConfig;
  }
  cachedConfig = getSystemEmbeddingConfig();
  cachedConfigAt = now;
  return cachedConfig;
}
