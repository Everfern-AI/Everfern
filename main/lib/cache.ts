import { dbOps, ensureVectorTable } from './db';
import { getEmbeddingModel, EmbeddingConfig, getSystemEmbeddingConfig } from './embeddings';
import { ChatResponse } from './ai-client';
import crypto from 'crypto';

const SIMILARITY_THRESHOLD = 0.96;
const CACHE_RETRY_ATTEMPTS = 3;
const CACHE_TIMEOUT_MS = 5000;

let isCacheDisabled = false;
let cacheHealthy = true;
let lastHealthCheck = 0;
let cacheSavepointCounter = 0;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

// Circuit breaker pattern for cache reliability
class CacheCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly maxFailures = 5;
  private readonly resetTimeout = 30000; // 30 seconds

  isOpen(): boolean {
    if (this.failures >= this.maxFailures) {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.reset();
        return false;
      }
      return true;
    }
    return false;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }

  recordSuccess(): void {
    this.failures = Math.max(0, this.failures - 1);
  }

  reset(): void {
    this.failures = 0;
    this.lastFailure = 0;
  }
}

const circuitBreaker = new CacheCircuitBreaker();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Cache operation timed out')), timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkCacheHealth(): Promise<boolean> {
  if (Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return cacheHealthy;
  }

  try {
    // Simple health check - try to query the database
    await withTimeout(dbOps.get('SELECT 1'), 2000);
    cacheHealthy = true;
    lastHealthCheck = Date.now();
    return true;
  } catch (err) {
    cacheHealthy = false;
    lastHealthCheck = Date.now();
    console.warn('[Cache] Health check failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function lookupCache(prompt: string): Promise<ChatResponse | null> {
  if (isCacheDisabled || circuitBreaker.isOpen()) return null;

  // Check cache health before proceeding
  if (!(await checkCacheHealth())) {
    return null;
  }

  for (let attempt = 1; attempt <= CACHE_RETRY_ATTEMPTS; attempt++) {
    try {
      const config = getSystemEmbeddingConfig();
      const { embeddings, dimensions } = getEmbeddingModel(config);

      await ensureVectorTable(dimensions);

      const promptVector = await withTimeout(
        embeddings.embedQuery(prompt), 
        CACHE_TIMEOUT_MS
      );
      const vectorBuffer = Buffer.from(new Float32Array(promptVector).buffer);

      const row = await withTimeout(
        dbOps.get(
          'SELECT c.response_json, vec_distance_cosine(v.embedding, ?) as distance FROM semantic_cache_vec v JOIN semantic_cache c ON v.id = c.id WHERE distance < ? ORDER BY distance ASC LIMIT 1', 
          [vectorBuffer, 1 - SIMILARITY_THRESHOLD]
        ),
        CACHE_TIMEOUT_MS
      );

      if (row) {
        const score = (1 - row.distance).toFixed(4);
        console.log('[Optima] Semantic Cache Hit! (Score: ' + score + ')');
        circuitBreaker.recordSuccess();
        return JSON.parse(row.response_json) as ChatResponse;
      }
      
      // No cache hit, but operation succeeded
      circuitBreaker.recordSuccess();
      return null;
      
    } catch (err) {
      const isConnectionError = err instanceof Error && (
        err.message.includes('fetch failed') || 
        err.message.includes('ECONNREFUSED') || 
        err.message.includes('ENOTFOUND') ||
        err.message.includes('timed out')
      );
      
      if (isConnectionError) {
        console.warn(`[Optima] Cache lookup failed (attempt ${attempt}/${CACHE_RETRY_ATTEMPTS}):`, err instanceof Error ? err.message : String(err));
        circuitBreaker.recordFailure();
        
        if (attempt === CACHE_RETRY_ATTEMPTS) {
          console.warn('[Optima] Semantic cache disabled for this session due to repeated failures.');
          isCacheDisabled = true;
        }
      } else {
        console.warn('[Optima] Cache lookup failed', err);
        circuitBreaker.recordFailure();
      }
      
      // Don't retry on non-connection errors
      if (!isConnectionError) break;
    }
  }
  
  return null;
}

export async function saveCache(prompt: string, response: ChatResponse) {
  if (isCacheDisabled || circuitBreaker.isOpen()) return;

  // Check cache health before proceeding
  if (!(await checkCacheHealth())) {
    return;
  }

  // Unique-named SAVEPOINT instead of BEGIN/COMMIT to avoid colliding with
  // other SAVEPOINT users of the shared connection under concurrency.
  const spName = `sp_cache_${Date.now()}_${++cacheSavepointCounter}`;

  for (let attempt = 1; attempt <= CACHE_RETRY_ATTEMPTS; attempt++) {
    try {
      const config = getSystemEmbeddingConfig();
      const { embeddings, dimensions } = getEmbeddingModel(config);

      await ensureVectorTable(dimensions);

      const id = crypto.createHash('sha256').update(prompt).digest('hex');
      const promptVector = await withTimeout(
        embeddings.embedQuery(prompt), 
        CACHE_TIMEOUT_MS
      );
      const vectorBuffer = Buffer.from(new Float32Array(promptVector).buffer);

      await withTimeout(dbOps.run(`SAVEPOINT ${spName}`), CACHE_TIMEOUT_MS);
      try {
        await withTimeout(
          dbOps.run(
            'INSERT OR REPLACE INTO semantic_cache (id, prompt_text, response_json, provider, model) VALUES (?, ?, ?, ?, ?)', 
            [id, prompt, JSON.stringify(response), config.provider, response.model]
          ),
          CACHE_TIMEOUT_MS
        );
        await withTimeout(
          dbOps.run('INSERT OR REPLACE INTO semantic_cache_vec (id, embedding) VALUES (?, ?)', [id, vectorBuffer]),
          CACHE_TIMEOUT_MS
        );
        await withTimeout(dbOps.run(`RELEASE SAVEPOINT ${spName}`), CACHE_TIMEOUT_MS);
        
        console.log('[Optima] Saved to Semantic Cache');
        circuitBreaker.recordSuccess();
        return;
        
      } catch (e) {
        await dbOps.run(`ROLLBACK TO SAVEPOINT ${spName}`).catch(() => {}); // Ignore rollback errors
        await dbOps.run(`RELEASE SAVEPOINT ${spName}`).catch(() => {});
        throw e;
      }
    } catch (err) {
      const isConnectionError = err instanceof Error && (
        err.message.includes('fetch failed') || 
        err.message.includes('ECONNREFUSED') || 
        err.message.includes('ENOTFOUND') ||
        err.message.includes('timed out')
      );
      
      if (isConnectionError) {
        console.warn(`[Optima] Cache save failed (attempt ${attempt}/${CACHE_RETRY_ATTEMPTS}):`, err instanceof Error ? err.message : String(err));
        circuitBreaker.recordFailure();
        
        if (attempt === CACHE_RETRY_ATTEMPTS) {
          isCacheDisabled = true;
        }
      } else {
        console.warn('[Optima] Cache save failed', err);
        circuitBreaker.recordFailure();
      }
      
      // Don't retry on non-connection errors
      if (!isConnectionError) break;
    }
  }
}
