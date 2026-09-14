/**
 * CU-REND-05 — incremental tool-call tag scan (page.tsx streaming core).
 *
 * The scan state { pos, count, seenUnclosedStart } mirrors the object created
 * inside handleSend's IIFE in src/app/chat/page.tsx. These tests verify the
 * algorithm's contract (as lifted from the implementation) against streamed
 * chunk sequences: ordinals must match the old whole-buffer matchAll ordering,
 * tags must be counted exactly once, and rescans must stay O(delta).
 */
import { describe, it, expect } from 'vitest';

const TC = String.fromCharCode(60) + 'tool_call' + String.fromCharCode(62);
const TC_CLOSE = String.fromCharCode(60) + '/tool_call' + String.fromCharCode(62);
const RE = new RegExp(TC.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '([\\s\\S]*?)(?:' + TC_CLOSE.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '|$)', 'gi');

interface Scan { pos: number; count: number; seenUnclosedStart: number; }

function makeScan(): Scan { return { pos: 0, count: 0, seenUnclosedStart: -1 }; }

/** Port of the page.tsx per-chunk scan body. Returns discovered tags this chunk. */
function scanChunk(accumulated: string, scan: Scan): { name?: string; id: string; closed: boolean }[] {
    const found: { name?: string; id: string; closed: boolean }[] = [];
    const region = accumulated.slice(scan.pos);
    const regionOffset = scan.pos;
    let pendingTag = false;
    for (const match of region.matchAll(RE)) {
        const absStart = regionOffset + (match.index ?? 0);
        const closed = match[0].endsWith(TC_CLOSE);
        const content = (match[1] || '').trim();
        const nameMatch = content.match(/"name":\s*"([^"]+)"/);

        if (scan.seenUnclosedStart === absStart) {
            if (closed) {
                scan.pos = absStart + match[0].length;
                scan.seenUnclosedStart = -1;
            } else {
                scan.pos = absStart;
                pendingTag = true;
            }
            continue;
        }
        if (!nameMatch) {
            scan.pos = absStart;
            pendingTag = true;
            break;
        }
        const id = `streaming-${scan.count++}`;
        found.push({ name: nameMatch[1], id, closed });
        if (closed) {
            scan.pos = absStart + match[0].length;
        } else {
            scan.seenUnclosedStart = absStart;
            scan.pos = absStart;
            pendingTag = true;
        }
    }
    if (!pendingTag) {
        // No open tag awaiting data — advance past tagless text, keeping a
        // partial opener suffix so chunk-boundary openers still resolve.
        let keep = 0;
        for (let k = Math.min(TC.length - 1, region.length); k > 0; k--) {
            if (region.endsWith(TC.slice(0, k))) { keep = k; break; }
        }
        scan.pos = regionOffset + region.length - keep;
    }
    return found;
}

/** Reference implementation: old whole-buffer matchAll ordering. */
function referenceIds(accumulated: string): string[] {
    return Array.from(accumulated.matchAll(RE)).map((_, index) => `streaming-${index}`);
}

describe('CU-REND-05 incremental tool-call scan', () => {
    it('matches whole-buffer matchAll ordinals for fully streamed sequences', () => {
        const chunks = [
            `Hello ${TC}`,
            `{"name": "read_file", "ar`,
            `gs": {"path": "a.txt"}}${TC} and more text`,
            ` ${TC}{"name": "write_file"}${TC}`,
        ];
        const scan = makeScan();
        let accumulated = '';
        const seen = new Set<string>();
        for (const chunk of chunks) {
            accumulated += chunk;
            for (const tag of scanChunk(accumulated, scan)) {
                expect(seen.has(tag.id)).toBe(false);
                seen.add(tag.id);
            }
        }
        const ref = referenceIds(accumulated);
        expect([...seen].sort()).toEqual(ref.sort());
    });

    it('counts a tag exactly once when its name spans chunk boundaries', () => {
        const scan = makeScan();
        let accumulated = `x ${TC}`;
        expect(scanChunk(accumulated, scan)).toEqual([]); // no name yet
        accumulated += `{"na`;
        expect(scanChunk(accumulated, scan)).toEqual([]); // still partial
        accumulated += `me": "search_web"}`;
        const tags = scanChunk(accumulated, scan);
        expect(tags).toEqual([{ name: 'search_web', id: 'streaming-0', closed: false }]);
        // more args stream in — must NOT recount
        accumulated += `,{"q": "hi"} still unclosed`;
        expect(scanChunk(accumulated, scan)).toEqual([]);
        expect(scan.count).toBe(1);
    });

    it('advances past closed tags and never rescans them (pos monotonic)', () => {
        const scan = makeScan();
        let accumulated = `${TC}{"name":"a"}${TC_CLOSE}mid${TC}{"name":"b"}${TC_CLOSE}`;
        scanChunk(accumulated, scan);
        const posAfterFirstPass = scan.pos;
        expect(posAfterFirstPass).toBe(accumulated.length);
        accumulated += 'trailing text without tags';
        expect(scanChunk(accumulated, scan)).toEqual([]);
        // pos advances monotonically past tagless text (O(delta) requirement),
        // but the closed region is never rescanned and tags stay counted once.
        expect(scan.pos).toBeGreaterThanOrEqual(posAfterFirstPass);
        expect(scan.count).toBe(2);
    });

    it('handles a nameless closed tag by rescanning only it, then moving on', () => {
        const scan = makeScan();
        let accumulated = `${TC}{bad}${TC}`;
        // nameless closed tag: algorithm breaks with pos at its start
        expect(scanChunk(accumulated, scan)).toEqual([]);
        // next chunk still can't find a name in it, but a NEW tag appears after
        accumulated += ` ${TC}{"name":"c"}${TC}`;
        const tags = scanChunk(accumulated, scan);
        expect(tags.map(t => t.name)).toEqual(['c']);
        expect(scan.count).toBe(1);
    });

    it('is O(delta): scanned region length never exceeds buffer growth + one tag', () => {
        const scan = makeScan();
        let accumulated = '';
        const scannedLengths: number[] = [];
        for (let i = 0; i < 200; i++) {
            const chunk = (i % 20 === 0)
                ? `${TC}{"name":"tool${i}"}${TC_CLOSE}`
                : `plain text chunk number ${i} `.repeat(10);
            accumulated += chunk;
            const before = scan.pos;
            scanChunk(accumulated, scan);
            scannedLengths.push(accumulated.length - before);
        }
        // every scan only looked at the tail it hadn't consumed (plus one open tag)
        const maxScanned = Math.max(...scannedLengths);
        expect(maxScanned).toBeLessThan(500); // vs 200-chunk full buffer (~ tens of KB)
    });
});
