// @vitest-environment node

/**
 * CU-STRM-02: per-line syntax token cache (ArtifactsPanel SyntaxHighlighter).
 *
 * During streaming the `code` prop changes per chunk, which previously forced
 * a full 3× matchAll + sort + token-map retokenization of every line on every
 * render. highlightLine now fronts a module-level LRU keyed by
 * `${language}\n${line}`. These tests exercise the pure tokenizer + cache
 * semantics via the exported __strm02Internals hooks (pattern:
 * LazyBase64Thumb's __strm06TestHooks / MarkdownComponents' getBlockCacheStats).
 * DOM-free node environment — react-test-renderer is not installed, and the
 * pure helpers make rendering unnecessary: React elements are plain objects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import {
    resetSyntaxLineCache,
    getSyntaxLineCacheStats,
    __strm02Internals,
} from '../../src/app/chat/ArtifactsPanel';

const { lineCache, cacheKeyFor, tokenizeLine, tokenizeLineCached } = __strm02Internals;

// ── helpers ───────────────────────────────────────────────────────────────────
type Span = { color: string; text: string };

const spanColorOf = (node: unknown): string | undefined =>
    (node as React.ReactElement)?.props?.style?.color as string | undefined;

const spanTextOf = (node: unknown): string | undefined => {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return typeof el?.props?.children === 'string' ? el.props.children : undefined;
};

const collectSpans = (nodes: React.ReactNode[]): Span[] => {
    const spans: Span[] = [];
    for (const node of nodes) {
        const el = node as React.ReactElement<{ children?: React.ReactNode }>;
        if (!el?.props) continue;
        if (el.props.style?.color !== undefined && typeof el.props.children === 'string') {
            spans.push({ color: el.props.style.color as string, text: el.props.children });
        } else if (el.props.children !== undefined && el.props.children !== null) {
            spans.push(...collectSpans([el.props.children]));
        }
    }
    return spans;
};

beforeEach(() => {
    resetSyntaxLineCache();
});

// ── cache key derivation ──────────────────────────────────────────────────────
describe('cacheKeyFor', () => {
    it('keys by language + newline + line text', () => {
        expect(cacheKeyFor('python', 'x = 1')).toBe('python\nx = 1');
    });

    it('different languages or lines produce different keys', () => {
        expect(cacheKeyFor('python', 'x = 1')).not.toBe(cacheKeyFor('javascript', 'x = 1'));
        expect(cacheKeyFor('python', 'x = 1')).not.toBe(cacheKeyFor('python', 'x = 2'));
    });
});

// ── pure tokenizer output ─────────────────────────────────────────────────────
describe('tokenizeLine (pure)', () => {
    it('returns keyword/string/number spans with SYNTAX_COLORS-derived colors', () => {
        const out = tokenizeLine('const x = "hi" + 42;', {
            keyword: 'var(--color-syntax-keyword)',
            string: 'var(--color-success)',
            number: 'var(--color-info)',
            comment: 'var(--color-syntax-comment)',
            function: 'var(--color-accent)',
        });
        const spans = collectSpans(out);
        const colors = spans.map(s => s.color);

        expect(colors).toContain('var(--color-syntax-keyword)');
        expect(colors).toContain('var(--color-success)');
        expect(colors).toContain('var(--color-info)');
        expect(spans.find(s => s.text === 'const')?.color).toBe('var(--color-syntax-keyword)');
        expect(spans.find(s => s.text === '"hi"')?.color).toBe('var(--color-success)');
        expect(spans.find(s => s.text === '42')?.color).toBe('var(--color-info)');
    });

    it('concatenated span text reproduces the original line', () => {
        const line = 'const x = "hi" + 42;';
        const out = tokenizeLine(line, {
            keyword: 'var(--color-syntax-keyword)',
            string: 'var(--color-success)',
            number: 'var(--color-info)',
            comment: 'var(--color-syntax-comment)',
        });
        expect(spansToText(out)).toBe(line);
    });

    it('comment early-return produces a single comment-colored span', () => {
        for (const line of ['  # hash comment', '// slash comment', '/* block', '<!-- html']) {
            const out = tokenizeLine(line, { comment: 'var(--color-syntax-comment)' });
            expect(out).toHaveLength(1);
            expect(spanColorOf(out[0])).toBe('var(--color-syntax-comment)');
            expect(spanTextOf(out[0])).toBe(line);
        }
    });

    it('unsupported language (empty scheme) falls back to primary text color', () => {
        const out = tokenizeLine('plain words only', {});
        expect(out).toHaveLength(1);
        expect(spanColorOf(out[0])).toBe('var(--color-text-primary)');
    });
});

const spansToText = (nodes: React.ReactNode[]): string =>
    collectSpans(nodes).map(s => s.text).join('');

// ── cache semantics via tokenizeLineCached ────────────────────────────────────
describe('tokenizeLineCached', () => {
    it('second tokenize of the same (language, line) is a cache hit returning the same array by reference', () => {
        const first = tokenizeLineCached('const a = 1;', 'javascript');
        const stats1 = getSyntaxLineCacheStats();
        expect(stats1.misses).toBe(1);
        expect(stats1.hits).toBe(0);

        const second = tokenizeLineCached('const a = 1;', 'javascript');
        const stats2 = getSyntaxLineCacheStats();
        expect(stats2.hits).toBe(1);
        expect(stats2.misses).toBe(1);

        expect(second).toBe(first);
    });

    it('different language → different key → miss, not a false hit', () => {
        tokenizeLineCached('const a = 1;', 'javascript');
        tokenizeLineCached('const a = 1;', 'python');

        const stats = getSyntaxLineCacheStats();
        expect(stats.misses).toBe(2);
        expect(stats.hits).toBe(0);
        expect(lineCache.size).toBe(2);
        expect(lineCache.has('javascript\nconst a = 1;')).toBe(true);
        expect(lineCache.has('python\nconst a = 1;')).toBe(true);
    });

    it('comment early-return path is cached under the same key scheme', () => {
        const first = tokenizeLineCached('// note', 'python');
        const second = tokenizeLineCached('// note', 'python');

        expect(second).toBe(first);
        const stats = getSyntaxLineCacheStats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(1);
    });

    it('evicts oldest entries once size exceeds the cap (size stays ≤ cap)', () => {
        const { cap } = getSyntaxLineCacheStats();
        expect(cap).toBeGreaterThan(0);

        for (let i = 0; i <= cap; i++) {
            tokenizeLineCached(`line number ${i}`, 'javascript');
        }
        const stats = getSyntaxLineCacheStats();
        expect(stats.size).toBe(cap);
        // First (oldest) entry evicted; newest retained.
        expect(lineCache.has(`javascript\nline number 0`)).toBe(false);
        expect(lineCache.has(`javascript\nline number ${cap}`)).toBe(true);
    });

    it('LRU refresh on hit spares recently used lines', () => {
        const { cap } = getSyntaxLineCacheStats();

        tokenizeLineCached('keep me', 'javascript'); // oldest
        // Fill to exactly the cap WITHOUT triggering eviction (cap-1 fillers
        // + 'keep me' = cap entries resident).
        for (let i = 0; i < cap - 1; i++) {
            tokenizeLineCached(`filler ${i}`, 'javascript');
        }
        expect(getSyntaxLineCacheStats().size).toBe(cap);
        // Touch 'keep me' so it becomes most recently used, then push one more.
        expect(getSyntaxLineCacheStats().hits).toBe(0);
        tokenizeLineCached('keep me', 'javascript');
        expect(getSyntaxLineCacheStats().hits).toBe(1);
        tokenizeLineCached('one more', 'javascript');

        expect(lineCache.has('javascript\nkeep me')).toBe(true); // survived via LRU touch
        expect(lineCache.has('javascript\nfiller 0')).toBe(false); // became the oldest
        expect(lineCache.size).toBe(cap);
    });

    it('resetSyntaxLineCache clears entries and counters', () => {
        tokenizeLineCached('const a = 1;', 'javascript');
        expect(getSyntaxLineCacheStats().size).toBe(1);

        resetSyntaxLineCache();
        const stats = getSyntaxLineCacheStats();
        expect(stats.size).toBe(0);
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
    });

    it('repeated tokenize of the same line across many calls only misses once', () => {
        const line = 'return await fetch(url, { timeout: 30 });';
        for (let i = 0; i < 10; i++) tokenizeLineCached(line, 'typescript');
        const stats = getSyntaxLineCacheStats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(9);
    });
});

// ── stats shape ────────────────────────────────────────────────────────────────
describe('getSyntaxLineCacheStats', () => {
    it('exposes { size, hits, misses, cap } with cap 400', () => {
        const stats = getSyntaxLineCacheStats();
        expect(stats).toEqual({ size: 0, hits: 0, misses: 0, cap: 400 });
    });
});
