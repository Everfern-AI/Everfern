// @vitest-environment node

/**
 * AI-KEYS-01 tests — env-var key fallback registry: active-fallback
 * detection, warn-once idempotence, and last4-only display (never the
 * full key). Node environment, DOM-free.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENV_KEY_PROVIDERS,
  getActiveEnvKeyFallbacks,
  warnOnceEnvKeyFallback,
  warnOnceEnvKeyFallbacks,
} from '../lib/env-key-fallback';

const ALL_ENV_VARS = Object.values(ENV_KEY_PROVIDERS);

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const envVar of ALL_ENV_VARS) {
    savedEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const envVar of ALL_ENV_VARS) {
    if (savedEnv[envVar] === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = savedEnv[envVar];
    }
  }
  vi.restoreAllMocks();
});

describe('AI-KEYS-01 env-key-fallback', () => {
  it('ENV_KEY_PROVIDERS maps every audited provider to its env var', () => {
    expect(ENV_KEY_PROVIDERS).toEqual({
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      groq: 'GROQ_API_KEY',
      gemini: 'GEMINI_API_KEY',
      everfern: 'EVERFERN_API_KEY',
      'embeddings-openai': 'OPENAI_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY',
    });
  });

  it('getActiveEnvKeyFallbacks returns only set, non-empty env vars with last4', () => {
    process.env.OPENAI_API_KEY = 'sk-test-abcd1234';
    process.env.DEEPGRAM_API_KEY = 'dg-full-key-value-9999';
    // Empty-string env var must NOT count as an active fallback.
    process.env.GROQ_API_KEY = '';

    const active = getActiveEnvKeyFallbacks();

    // openai + embeddings-openai share OPENAI_API_KEY → 3 entries total
    expect(active).toHaveLength(3);
    const byProvider = Object.fromEntries(active.map((a) => [a.provider, a]));
    expect(byProvider.openai).toEqual({
      provider: 'openai',
      envVar: 'OPENAI_API_KEY',
      last4: '1234',
    });
    expect(byProvider['embeddings-openai']).toEqual({
      provider: 'embeddings-openai',
      envVar: 'OPENAI_API_KEY',
      last4: '1234',
    });
    expect(byProvider.deepgram).toEqual({
      provider: 'deepgram',
      envVar: 'DEEPGRAM_API_KEY',
      last4: '9999',
    });
    expect(active.some((a) => a.provider === 'groq')).toBe(false); // empty string excluded
  });

  it('getActiveEnvKeyFallbacks is empty when no env keys are set', () => {
    expect(getActiveEnvKeyFallbacks()).toEqual([]);
  });

  it('warnOnceEnvKeyFallbacks warns once per active provider and is idempotent', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-key-xyz-7777';
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-route-8888';

    warnOnceEnvKeyFallbacks();
    warnOnceEnvKeyFallbacks();
    warnOnceEnvKeyFallbacks();

    const warns = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(warns).toHaveLength(2);
    expect(warns.some((w) => w.includes('anthropic (ANTHROPIC_API_KEY') && w.includes('…7777'))).toBe(true);
    expect(warns.some((w) => w.includes('openrouter (OPENROUTER_API_KEY') && w.includes('…8888'))).toBe(true);
    expect(warns.every((w) => w.includes('[Keys] Env-var fallback active:'))).toBe(true);
    expect(warns.every((w) => w.includes('File keys in ~/.everfern/keys take precedence'))).toBe(true);
  });

  it('warnOnceEnvKeyFallback (single provider) warns once and is a no-op afterwards', () => {
    process.env.GEMINI_API_KEY = 'g-key-aib2c3d4e5';

    warnOnceEnvKeyFallback('gemini');
    warnOnceEnvKeyFallback('gemini');

    expect(console.warn).toHaveBeenCalledTimes(1);
    const msg = String((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).toContain('[Keys] Env-var fallback active: gemini (GEMINI_API_KEY');
    expect(msg).toContain('…d4e5');
  });

  it('warnOnceEnvKeyFallback does not warn for unset providers or unknown providers', () => {
    warnOnceEnvKeyFallback('openai'); // not set in this test
    warnOnceEnvKeyFallback('does-not-exist');

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('last4 never equals or contains the full key value', () => {
    const fullKey = 'sk-super-secret-very-long-key-value-99AA';
    process.env.OPENAI_API_KEY = fullKey;

    const active = getActiveEnvKeyFallbacks();
    // openai and embeddings-openai share OPENAI_API_KEY so both appear
    const providers = active.map((a) => a.provider).sort();
    expect(providers).toEqual(['embeddings-openai', 'openai']);

    for (const entry of active) {
      expect(entry.last4).not.toBe(fullKey);
      expect(entry.last4).toHaveLength(4);
      expect(fullKey.endsWith(entry.last4)).toBe(true);
    }

    warnOnceEnvKeyFallback('openai');
    const msg = String((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg).not.toContain(fullKey);
    expect(msg).toContain('…99AA');
  });
});
