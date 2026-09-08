/**
 * EverFern Desktop — Config mtime Cache (AI-PERF-03)
 *
 * loadConfigSync() in stream-handlers was called per acp:chat/acp:stream
 * request and performed synchronous fs reads of config.json plus the
 * isolated-keys directory every time. This module memoizes the hydrated
 * config keyed by the file's mtimeMs: a stat() per call replaces the full
 * read+parse+key-dir scan, and the config is re-hydrated only when the
 * file actually changed. Sub-50ms staleness from an in-flight write is
 * acceptable for request routing.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hydrateConfigWithIsolatedKeys } from './vlm-config';

interface ConfigCacheEntry {
  mtimeMs: number;
  config: any;
}

const cache = new Map<string, ConfigCacheEntry>();

export function everfernConfigPath(): string {
  return path.join(os.homedir(), '.everfern', 'config.json');
}

/**
 * Load and hydrate the config at `configPath`, returning a cached instance
 * when the file's mtime is unchanged. Returns null when the file does not
 * exist or cannot be read/parsed (same contract as the previous loader).
 */
export function loadConfigWithCache(configPath = everfernConfigPath()): any {
  try {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(configPath);
    } catch {
      stat = null;
    }

    if (!stat) {
      // File missing/removed — drop any stale cache entry and report null.
      cache.delete(configPath);
      return null;
    }

    const cached = cache.get(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.config;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const configDir = path.dirname(configPath);
    const hydrated = hydrateConfigWithIsolatedKeys(config, configDir);
    cache.set(configPath, { mtimeMs: stat.mtimeMs, config: hydrated });
    return hydrated;
  } catch (err) {
    console.error('[Config] Error loading config:', err);
    return null;
  }
}

/** Test hook: forget all memoized entries. */
export function clearConfigCache(): void {
  cache.clear();
}
