// @vitest-environment node

/**
 * CU-STRM-04 / CU-STRM-06: ToolCallComponents streaming-render audit fixes.
 *
 * CU-STRM-04 — "no entry animations for history rows; drop layout on live row":
 *   1. ToolCallRow's outer motion.div keeps layout="position" (cheap, keeps
 *      sibling shift smoothness) but must gate its entry spring: rows whose
 *      tc.status is done/error (committed history) render with initial={false}
 *      (no mount spring on conversation load); only running rows keep the
 *      spring. An optional isHistory prop overrides explicitly.
 *   2. LiveToolCallCard's two motion.div sites must NOT carry the bare `layout`
 *      prop (forced per-chunk measure/relayout of the streaming card).
 *   3. ToolCallTag's layout="position" is within-row and cheap — allowed.
 *
 * CU-STRM-06 — full-size base64 screenshots painted inline:
 *   Both inline screenshot <img> sites must go through the local
 *   InlineScreenshot component (loading="lazy" + decoding="async"; >2M-char
 *   payloads downscale once via canvas to an objectURL, revoked on unmount).
 *
 * CU-REND-06 (prior wave) — memo exports must remain untouched:
 *   ToolCallTag/ToolCallRow/ComputerUseResultCard/LiveToolCallCard stay memo()
 *   wrapped with their original comparators.
 *
 * Source-reading style (fs.readFileSync) keeps this hermetic and DOM-free,
 * mirroring main/__tests__/wave3-fixes.test.ts / cu-strm02 patterns.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
    join(__dirname, '../../src/app/chat/components/ToolCallComponents.tsx'),
    'utf-8'
);

// ── Helpers ─────────────────────────────────────────────────────────────────
const liveCardSource = () => {
    const start = src.indexOf('const LiveToolCallCardBase');
    const end = src.indexOf('export const LiveToolCallCard');
    expect(start, 'LiveToolCallCardBase definition found').toBeGreaterThan(-1);
    expect(end, 'LiveToolCallCard export found').toBeGreaterThan(start);
    return src.slice(start, end);
};

const toolCallRowSource = () => {
    const start = src.indexOf('const ToolCallRowBase');
    const end = src.indexOf('export const ToolCallRow');
    expect(start, 'ToolCallRowBase definition found').toBeGreaterThan(-1);
    expect(end, 'ToolCallRow export found').toBeGreaterThan(start);
    return src.slice(start, end);
};

// ── CU-STRM-04 ──────────────────────────────────────────────────────────────
describe('CU-STRM-04: drop bare layout on LiveToolCallCard (live streaming row)', () => {
    it('contains no bare `layout` prop anywhere in LiveToolCallCardBase', () => {
        const live = liveCardSource();
        // bare `layout` as a JSX prop line, or layout={...} shorthand usage
        const bareLayout = /^\s+layout\s*$/m;
        expect(bareLayout.test(live), 'no bare `layout` line in LiveToolCallCard motion.div props').toBe(false);
        expect(live).not.toMatch(/<motion\.div[^>]*\blayout\b(?!=")(?!\s*=)/s);
    });

    it('keeps its entry/exit animations (initial/animate/exit intact)', () => {
        const live = liveCardSource();
        expect(live).toMatch(/initial=\{\s*\{\s*opacity:\s*0,\s*y:\s*8,\s*scale:\s*0\.98\s*\}\s*\}/);
        expect(live).toMatch(/animate=\{\s*\{\s*opacity:\s*1,\s*y:\s*0,\s*scale:\s*1\s*\}\s*\}/);
        expect(live).toMatch(/exit=\{\s*\{\s*opacity:\s*0,\s*scale:\s*0\.95\s*\}\s*\}/);
    });
});

describe('CU-STRM-04: ToolCallRow history gating (no entry springs on mount)', () => {
    it('derives isHistoryRow from tc.status (running = live; done/error = history)', () => {
        const row = toolCallRowSource();
        expect(row).toMatch(/const isHistoryRow\s*=\s*isHistory\s*\?\?\s*!isRunning/);
    });

    it('outer motion.div gates initial/transition on isHistoryRow (initial={false} for history)', () => {
        const row = toolCallRowSource();
        expect(row).toMatch(/initial=\{isHistoryRow\s*\?\s*false\s*:\s*\{\s*opacity:\s*0,\s*y:\s*4\s*\}\s*\}/);
        expect(row).toMatch(/transition=\{isHistoryRow\s*\?\s*\{\s*duration:\s*0\s*\}\s*:\s*\{\s*type:\s*"spring"/);
    });

    it('keeps layout="position" on the row (cheap sibling-shift smoothing)', () => {
        const row = toolCallRowSource();
        expect(row).toMatch(/layout="position"/);
    });

    it('accepts optional isHistory prop and the pill comparator gates on it', () => {
        expect(src).toMatch(/isHistory\?:\s*boolean/);
        expect(src).toMatch(/prev\.isHistory\s*!==\s*next\.isHistory/);
    });
});

describe('CU-STRM-04: within-row layout="position" is allowed to stay', () => {
    it('ToolCallRow still uses layout="position" (cheap, within-group smoothing)', () => {
        const row = toolCallRowSource();
        expect(row).toMatch(/layout="position"/);
    });

    it('no bare `layout` prop remains anywhere in the file', () => {
        expect(src).not.toMatch(/^\s+layout\s*$/m);
    });
});

// ── CU-STRM-06 ──────────────────────────────────────────────────────────────
describe('CU-STRM-06: inline base64 screenshots are guarded', () => {
    it('InlineScreenshot local component exists with lazy/async attributes and a decode cap', () => {
        expect(src).toMatch(/const InlineScreenshot\s*=/);
        expect(src).toMatch(/INLINE_BASE64_CAP\s*=\s*2_?000_?000/);
        expect(src).toMatch(/loading="lazy"/);
        expect(src).toMatch(/decoding="async"/);
    });

    it('downscales oversized payloads once via canvas and revokes the objectURL on cleanup', () => {
        const start = src.indexOf('const InlineScreenshot');
        const end = src.indexOf('// ── Tool Call Tag Component');
        expect(start).toBeGreaterThan(-1);
        const comp = src.slice(start, end);
        expect(comp).toMatch(/URL\.createObjectURL/);
        expect(comp).toMatch(/URL\.revokeObjectURL/);
        expect(comp).toMatch(/typeof document === 'undefined'/);
    });

    it('both former raw img screenshot sites now render InlineScreenshot', () => {
        const jpegSite = /<InlineScreenshot\s+src=\{`data:image\/jpeg;base64,\$\{/;
        const pngSite = /<InlineScreenshot\s+src=\{`data:image\/png;base64,\$\{tc\.data\.preClickB64\}`\}/;
        expect(jpegSite.test(src), 'jpeg screenshot site uses InlineScreenshot').toBe(true);
        expect(pngSite.test(src), 'preClickB64 site uses InlineScreenshot').toBe(true);
    });

    it('no raw full-size screenshot <img data:...> remains in the file', () => {
        // raw img with a data: URL template literal (the old pattern)
        expect(src).not.toMatch(/<img\s+src=\{`data:image/);
    });
});

// ── CU-REND-06 (prior wave, must remain intact) ─────────────────────────────
describe('CU-REND-06: memo exports unchanged', () => {
    it('all four components remain memo() wrapped with original comparators', () => {
        expect(src).toMatch(/export const ToolCallTag = memo\(ToolCallTagBase,\s*toolCallPillPropsAreEqual\)/);
        expect(src).toMatch(/export const ToolCallRow = memo\(ToolCallRowBase,\s*toolCallPillPropsAreEqual\)/);
        expect(src).toMatch(/export const ComputerUseResultCard = memo\(ComputerUseResultCardBase,\s*computerUseResultPropsAreEqual\)/);
        expect(src).toMatch(/export const LiveToolCallCard = memo\(LiveToolCallCardBase\)/);
    });

    it('comparator hooks export intact', () => {
        expect(src).toMatch(/export const __cuRend06MemoHooks = \{\s*areToolCallDisplaysEqual,\s*toolCallPillPropsAreEqual\s*\}/);
        expect(src).toMatch(/export const __cuRend06ExtractionStats = \{\s*calls:\s*0\s*\}/);
    });
});
