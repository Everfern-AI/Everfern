/**
 * CU-UI-08 — named z-index tier adoption (settings + health-check splash).
 *
 * DOM-free source contract: the fixed full-screen overlays in MemorySection,
 * PrivacySection must stack at the modal tier (`var(--z-modal)`), and the
 * HealthCheckScreen app gate must sit above modals at the chrome tier
 * (`var(--z-chrome)`, still below `--z-toast`). No legacy ad-hoc `zIndex: 9999`
 * may remain in any of the three files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string =>
    readFileSync(resolve(__dirname, rel), 'utf8');

const memory = read('../../src/app/chat/settings/MemorySection.tsx');
const privacy = read('../../src/app/chat/settings/PrivacySection.tsx');
const health = read('../../src/app/chat/components/HealthCheckScreen.tsx');

const files: Array<[string, string]> = [
    ['MemorySection.tsx', memory],
    ['PrivacySection.tsx', privacy],
    ['HealthCheckScreen.tsx', health],
];

describe('CU-UI-08 z-tier adoption', () => {
    it.each(files)('%s contains no legacy ad-hoc zIndex: 9999', (_name, src) => {
        expect(src).not.toContain('zIndex: 9999');
        expect(src).not.toContain('zIndex: 10000');
    });

    it('MemorySection modal overlay uses the modal tier token', () => {
        expect(memory).toContain("zIndex: 'var(--z-modal)'");
    });

    it('PrivacySection vector modal overlay uses the modal tier token', () => {
        expect(privacy).toContain("zIndex: 'var(--z-modal)'");
    });

    it('HealthCheckScreen app gate splash uses the chrome tier token', () => {
        expect(health).toContain("zIndex: 'var(--z-chrome)'");
        expect(health).not.toContain("zIndex: 'var(--z-modal)'");
    });
});
