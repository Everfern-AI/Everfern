// @vitest-environment node

/**
 * AI-PERF-03: config mtime cache — two loads with unchanged mtime perform
 * exactly one read; touching the file re-reads. Uses a real temp config
 * file in os.tmpdir pointed at via the loader's path parameter.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfigWithCache, clearConfigCache, everfernConfigPath } from '../lib/config-cache';

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-config-cache-'));
  configPath = path.join(tmpDir, 'config.json');
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadConfigWithCache (AI-PERF-03 mtime cache)', () => {
  it('reads the file once when mtime is unchanged across two loads', () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai', apiKey: 'sk-test-1234' }), 'utf-8');

    // Count actual disk reads by making the file unreadable-but-statable after
    // the first load: if the second load re-read the file it would throw/return
    // null; with a cache hit it returns the identical object.
    const first = loadConfigWithCache(configPath);
    expect(first?.provider).toBe('openai');

    // chmod 000 the file (stat still works, readFileSync now fails).
    fs.chmodSync(configPath, 0o000);
    try {
      const second = loadConfigWithCache(configPath);
      expect(second).not.toBeNull();
      // Same reference — the second load never touched the disk.
      expect(Object.is(first, second)).toBe(true);
      expect(second?.apiKey).toBe('sk-test-1234');
    } finally {
      fs.chmodSync(configPath, 0o644);
    }
  });

  it('returns the SAME object reference on a cache hit (no re-hydration)', () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai' }), 'utf-8');
    const first = loadConfigWithCache(configPath);
    const second = loadConfigWithCache(configPath);
    expect(Object.is(first, second)).toBe(true);
  });

  it('re-reads when the file mtime changes', () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai' }), 'utf-8');
    const first = loadConfigWithCache(configPath);
    expect(first?.provider).toBe('openai');

    // Rewrite content (new mtime — forced distinct at mtimeMs granularity).
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'anthropic' }), 'utf-8');
    const st = fs.statSync(configPath);
    fs.utimesSync(configPath, st.atime, new Date(st.mtimeMs + 2000));

    const second = loadConfigWithCache(configPath);
    expect(second?.provider).toBe('anthropic');
    expect(Object.is(first, second)).toBe(false);

    // And the fresh value is itself cached again.
    const third = loadConfigWithCache(configPath);
    expect(Object.is(second, third)).toBe(true);
  });

  it('re-reads after the file is deleted and recreated (missing → null)', () => {
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai' }), 'utf-8');
    expect(loadConfigWithCache(configPath)?.provider).toBe('openai');

    fs.unlinkSync(configPath);
    expect(loadConfigWithCache(configPath)).toBeNull();

    fs.writeFileSync(configPath, JSON.stringify({ provider: 'ollama' }), 'utf-8');
    const st = fs.statSync(configPath);
    fs.utimesSync(configPath, st.atime, new Date(st.mtimeMs + 2000));
    expect(loadConfigWithCache(configPath)?.provider).toBe('ollama');
  });

  it('missing file returns null (same contract as the previous loader)', () => {
    expect(loadConfigWithCache(path.join(tmpDir, 'nope.json'))).toBeNull();
    expect(loadConfigWithCache(path.join(tmpDir, 'nope.json'))).toBeNull();
  });

  it('malformed JSON returns null without throwing', () => {
    fs.writeFileSync(configPath, '{not-json', 'utf-8');
    expect(loadConfigWithCache(configPath)).toBeNull();
  });

  it('hydrates isolated keys from the keys/ directory next to the config', () => {
    const keysDir = path.join(tmpDir, 'keys');
    fs.mkdirSync(keysDir);
    fs.writeFileSync(path.join(keysDir, 'openai.key'), 'sk-isolated-9999', 'utf-8');
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai' }), 'utf-8');

    const config = loadConfigWithCache(configPath);
    expect(config?.keys?.openai).toBe('sk-isolated-9999');
    expect(config?.apiKey).toBe('sk-isolated-9999');
  });

  it('default path points at ~/.everfern/config.json (wiring preserved)', () => {
    expect(everfernConfigPath()).toBe(path.join(os.homedir(), '.everfern', 'config.json'));
  });

  it('distinct paths maintain independent cache entries', () => {
    const otherPath = path.join(tmpDir, 'other.json');
    fs.writeFileSync(configPath, JSON.stringify({ provider: 'openai' }), 'utf-8');
    fs.writeFileSync(otherPath, JSON.stringify({ provider: 'anthropic' }), 'utf-8');

    expect(loadConfigWithCache(configPath)?.provider).toBe('openai');
    expect(loadConfigWithCache(otherPath)?.provider).toBe('anthropic');
    expect(loadConfigWithCache(configPath)?.provider).toBe('openai');
  });
});
