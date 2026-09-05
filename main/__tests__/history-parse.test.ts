/**
 * parseJsonField — defensive JSON column parser used by ChatHistoryStore.load().
 *
 * Contract: one corrupted column must never null out a whole conversation.
 * Corrupt JSON -> fallback + console.warn; null/undefined -> silent fallback;
 * valid payloads pass through unchanged. The helper is exercised directly
 * (exported for testability); its call sites in load() rely on exactly this
 * behavior per-field (tool_calls / mission_timeline / attachments).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/db', () => ({
  dbOps: { run: vi.fn(), get: vi.fn(), all: vi.fn(async () => []) },
}));
vi.mock('../lib/embeddings', () => ({
  getSystemEmbeddingConfig: vi.fn(async () => ({})),
  getEmbeddingModel: vi.fn(() => 'test-model'),
}));

import { parseJsonField } from '../store/history';

describe('parseJsonField', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns fallback and warns on corrupt JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallback: any[] = [];

    const result = parseJsonField<any[]>('{not valid json,,', fallback, 'attachments');

    expect(result).toBe(fallback);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [labelArg, errArg] = warnSpy.mock.calls[0];
    expect(String(labelArg)).toContain('Corrupt');
    expect(String(labelArg)).toContain('attachments');
    // history.ts passes err instanceof Error ? err.message : err
    expect(typeof errArg).toBe('string');
    expect(String(errArg)).toMatch(/JSON|property|token/i);
  });

  it('returns fallback silently for null/undefined (no warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseJsonField(null, 'fb-null', 'tool_calls')).toBe('fb-null');
    expect(parseJsonField(undefined, 'fb-undef', 'tool_calls')).toBe('fb-undef');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('passes valid JSON through with types preserved', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseJsonField('{"a":1}', undefined as any, 'mission_timeline')).toEqual({ a: 1 });
    expect(parseJsonField('[1,"two",{"three":3}]', [], 'attachments')).toEqual([
      1,
      'two',
      { three: 3 },
    ]);
    expect(parseJsonField('true', false, 'flag')).toBe(true);
    expect(parseJsonField('42', 0, 'count')).toBe(42);
    expect(parseJsonField('"hello"', '', 'title')).toBe('hello');

    // Fallback identity is only substituted on failure — literal 'null' parses through
    const fb = { keep: true };
    expect(parseJsonField('null', fb, 'x')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
