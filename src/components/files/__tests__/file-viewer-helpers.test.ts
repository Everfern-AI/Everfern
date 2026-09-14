/**
 * NR-PERF-02 / NR-PERF-03 / NR-PERF-08 unit tests for the pure helpers
 * extracted from FileViewerModal during the fix-wave. Node environment.
 */
import { describe, it, expect } from 'vitest';
import {
    capViewerContent,
    sliceRenderLines,
    chunkedBase64ToUint8Array,
    parseDelimitedContent,
    MAX_VIEWER_CHARS,
    MAX_RENDER_LINES,
} from '../file-viewer-helpers';

describe('capViewerContent (NR-PERF-02)', () => {
    it('passes small files through byte-identically', () => {
        const text = 'const a = 1;\nconst b = 2;\n';
        const res = capViewerContent(text);
        expect(res.text).toBe(text);
        expect(res.truncatedLines).toBe(0);
        expect(res.charLimited).toBe(false);
        // single trailing newline semantics: "a\nb\n" is 3 lines by split('\n')
        expect(res.totalLines).toBe(3);
    });

    it('caps oversized content at a line boundary and reports truncation', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`);
        const text = lines.join('\n');
        const res = capViewerContent(text, 1000);
        expect(res.charLimited).toBe(true);
        expect(res.text.length).toBeLessThanOrEqual(1000);
        // cut on line boundary only when a newline exists past position 0
        expect(res.text.endsWith('\n') || res.text === text.substring(0, 1000).split('\n').slice(0, -1).join('\n')).toBe(true);
        expect(res.totalLines).toBe(500);
        const renderedLineCount = res.text.split('\n').length;
        expect(res.truncatedLines).toBe(500 - renderedLineCount);
        expect(res.text).not.toContain('line-499');
    });

    it('caps at default 50k chars', () => {
        const text = 'x'.repeat(MAX_VIEWER_CHARS + 1);
        const res = capViewerContent(text);
        expect(res.charLimited).toBe(true);
        expect(res.text.length).toBeLessThanOrEqual(MAX_VIEWER_CHARS);
    });
});

describe('sliceRenderLines (NR-PERF-02)', () => {
    it('returns all lines under the cap with no hidden lines', () => {
        const lines = ['a', 'b', 'c'];
        const res = sliceRenderLines(lines);
        expect(res.lines).toEqual(lines);
        expect(res.hiddenLines).toBe(0);
    });

    it('slices to the first 2000 lines by default and reports the remainder', () => {
        const lines = Array.from({ length: 2500 }, (_, i) => `l${i}`);
        const res = sliceRenderLines(lines);
        expect(res.lines.length).toBe(MAX_RENDER_LINES);
        expect(res.lines[0]).toBe('l0');
        expect(res.lines[MAX_RENDER_LINES - 1]).toBe(`l${MAX_RENDER_LINES - 1}`);
        expect(res.hiddenLines).toBe(500);
    });
});

describe('chunkedBase64ToUint8Array (NR-PERF-03)', () => {
    it('round-trips arbitrary bytes exactly like a single atob pass', () => {
        const bytes = new Uint8Array(5000);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) % 256;
        const b64 = Buffer.from(bytes).toString('base64');
        const out = chunkedBase64ToUint8Array(b64, 64);
        expect(out.length).toBe(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            if (out[i] !== bytes[i]) throw new Error(`mismatch at ${i}`);
        }
    });

    it('accepts a full data URL prefix', () => {
        const out = chunkedBase64ToUint8Array('data:application/pdf;base64,QUJD');
        expect(Array.from(out)).toEqual([65, 66, 67]);
    });

    it('returns empty array for empty input', () => {
        expect(chunkedBase64ToUint8Array('')).toHaveLength(0);
    });

    it('handles padded payloads', () => {
        expect(Array.from(chunkedBase64ToUint8Array('QQ=='))).toEqual([65]);
        expect(Array.from(chunkedBase64ToUint8Array('QUI='))).toEqual([65, 66]);
        expect(Array.from(chunkedBase64ToUint8Array('QUJD'))).toEqual([65, 66, 67]);
    });

    it('rejects invalid base64 length', () => {
        expect(() => chunkedBase64ToUint8Array('ABCDE')).toThrow();
    });

    it('rejects non-multiple-of-4 chunk sizes', () => {
        expect(() => chunkedBase64ToUint8Array('QUJD', 50)).toThrow();
    });
});

describe('parseDelimitedContent (NR-PERF-08)', () => {
    it('parses simple CSV', () => {
        const rows = parseDelimitedContent('data.csv', 'a,b,c\n1,2,3\n4,5,6');
        expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
    });

    it('respects quoted cells with embedded delimiters (parity with original parser)', () => {
        // NOTE: the original ExcelViewer parser treats every '"' as a bare
        // insideQuote toggle (no escaping), so doubled quotes are dropped.
        // The extracted helper is intentionally byte-for-byte identical.
        const rows = parseDelimitedContent('data.csv', 'name,note\n"Smith, John","said ""hi"""\n');
        expect(rows).toEqual([
            ['name', 'note'],
            ['Smith, John', 'said hi'],
        ]);
    });

    it('uses tab delimiter for .tsv files', () => {
        const rows = parseDelimitedContent('data.tsv', 'a\tb\n1\t2');
        expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('returns empty for content with no delimiter signal', () => {
        expect(parseDelimitedContent('notes.txt', 'plain text line')).toEqual([]);
        expect(parseDelimitedContent('data.csv', null)).toEqual([]);
    });

    it('drops empty trailing rows', () => {
        const rows = parseDelimitedContent('data.csv', 'a,b\n1,2\n\n');
        expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    });
});
