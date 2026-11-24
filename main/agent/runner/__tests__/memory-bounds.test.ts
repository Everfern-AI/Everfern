import { describe, expect, it } from 'vitest';
import { setIntentCacheEntry, getIntentCacheSize, clearIntentCache } from '../triage';
import { canSpawnChildren, MAX_SPAWN_DEPTH } from '../subagent-spawn';
import { fileCacheSet, fileCacheGet, getFileReadCacheStats, resetPiCodingToolsCache } from '../../tools/pi-tools';

/**
 * Long-running sessions: the module-level caches must stay bounded, and the spawn
 * tools must be hidden exactly when the spawner would reject the call.
 */
describe('intent cache', () => {
  it('evicts the oldest entries past its cap', () => {
    clearIntentCache();
    for (let i = 0; i < 1000; i++) {
      setIntentCacheEntry(`msg ${i}:hash:false`, { intent: 'chat', confidence: 1, reasoning: '' } as any);
    }
    expect(getIntentCacheSize()).toBeLessThanOrEqual(200);
    clearIntentCache();
  });
});

describe('file read cache', () => {
  it('caps entries and total size and skips huge files', () => {
    resetPiCodingToolsCache();
    for (let i = 0; i < 500; i++) fileCacheSet(`/f${i}|0|`, 'x'.repeat(50_000), 1);
    const stats = getFileReadCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(64);
    expect(stats.chars).toBeLessThanOrEqual(4_000_000);

    fileCacheSet('/huge||', 'x'.repeat(1_000_000), 1);
    expect(fileCacheGet('/huge||', 1)).toBeUndefined();
    resetPiCodingToolsCache();
  });

  it('misses on a changed mtime and keeps ranges apart', () => {
    resetPiCodingToolsCache();
    fileCacheSet('/a.ts||', 'whole', 1);
    fileCacheSet('/a.ts|100|50', 'slice', 1);
    expect(fileCacheGet('/a.ts||', 1)).toBe('whole');
    expect(fileCacheGet('/a.ts|100|50', 1)).toBe('slice');
    expect(fileCacheGet('/a.ts||', 2)).toBeUndefined();
    resetPiCodingToolsCache();
    expect(getFileReadCacheStats()).toEqual({ entries: 0, chars: 0 });
  });
});

describe('spawn depth', () => {
  it('lets the root and shallow agents spawn', () => {
    expect(canSpawnChildren(undefined)).toBe(true);
    expect(canSpawnChildren({ currentDepth: 1, maxDepth: 3 })).toBe(true);
  });

  it('hides spawning when the agent maxDepth is reached', () => {
    expect(canSpawnChildren({ currentDepth: 2, maxDepth: 2 })).toBe(false);
  });

  it('hides spawning at the hard ceiling', () => {
    expect(canSpawnChildren({ currentDepth: MAX_SPAWN_DEPTH, maxDepth: 99 })).toBe(false);
    expect(canSpawnChildren({ currentDepth: MAX_SPAWN_DEPTH - 1 })).toBe(true);
  });
});
