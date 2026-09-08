// @vitest-environment node
/**
 * CU-LEAK-09 — ArtifactsPanel timer capture (preload + saveSuccess toast).
 *
 * DOM-free source contract: the [selectedCode] preload effect must capture its
 * 200ms `setTimeout` and return a cleanup that clears it (rapid file switches
 * must not let a stale preload overwrite `openApps` for the wrong file), and
 * `handleSave`'s toast timer must be ref-owned with clear-on-replace plus an
 * unmount cleanup so it can never fire after unmount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(__dirname, '..', '..', 'src', 'app', 'chat', 'ArtifactsPanel.tsx'),
    'utf8',
);

describe('CU-LEAK-09 ArtifactsPanel timer capture', () => {
    it('captures the preload timer in a const', () => {
        expect(source).toContain('const preloadTimer = setTimeout');
    });

    it('returns a cleanup that clears the preload timer', () => {
        expect(source).toMatch(/return \(\) => \{ clearTimeout\(preloadTimer\); \};/);
    });

    it('no bare preload setTimeout remains', () => {
        // Anchored to line start so the captured form
        // (`const preloadTimer = setTimeout(...)`) does not match.
        expect(source).not.toMatch(/^\s*setTimeout\(\(\) => \{\s*\n\s*const preloadPath/m);
    });

    it('declares the saveSuccess toast timer ref', () => {
        expect(source).toContain('const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)');
    });

    it('clears the previous toast timer before scheduling a new one', () => {
        expect(source).toMatch(/if \(saveSuccessTimerRef\.current\) clearTimeout\(saveSuccessTimerRef\.current\);/);
    });

    it('schedules the toast timer through the ref', () => {
        expect(source).toContain('saveSuccessTimerRef.current = setTimeout(() => setSaveSuccess(false), 2000);');
    });

    it('bare un-captured toast timer form is gone', () => {
        expect(source).not.toMatch(/^\s*setTimeout\(\(\) => setSaveSuccess\(false\), 2000\);$/m);
    });

    it('clears the toast timer on unmount', () => {
        expect(source).toMatch(/useEffect\(\(\) => \(\) => \{\s*\n\s*if \(saveSuccessTimerRef\.current\) clearTimeout\(saveSuccessTimerRef\.current\);/);
    });
});
