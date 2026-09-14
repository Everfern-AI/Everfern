/**
 * CU-UI-11 — MarkdownComponents InlineLink/LinkPopup a11y + z-tier parity.
 *
 * DOM-free source contract (reads both copies with fs.readFileSync):
 *   1. InlineLink is a keyboard-operable tab stop (role + tabIndex + Enter/Space).
 *      Note: role is "link" (not "button") — the popup-opening span keeps link
 *      semantics and is locked by src/components/__tests__/z-tail-adoption.test.ts.
 *   2. LinkPopup carries dialog semantics (role="dialog" aria-modal) with a
 *      dynamic label naming the target link.
 *   3. The shared useFocusTrap hook is wired (Esc close + Tab cycling + focus
 *      restore), not a bespoke inline trap.
 *   4. No legacy ad-hoc `zIndex: 9999` remains; the overlay stacks at the
 *      modal tier token `var(--z-modal)`.
 *   5. The InlineLink/LinkPopup region is byte-identical across both copies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string =>
    readFileSync(resolve(__dirname, rel), 'utf8');

const chat = read('../../src/app/chat/components/MarkdownComponents.tsx');
const common = read('../../src/components/common/MarkdownComponents.tsx');

const copies: Array<[string, string]> = [
    ['chat', chat],
    ['common', common],
];

describe('CU-UI-11 MarkdownComponents InlineLink/LinkPopup (both copies)', () => {
    it.each(copies)('%s: InlineLink is keyboard-operable (role, tab stop, Enter/Space activation)', (_name, src) => {
        // role="link" (not "button") is deliberate and locked by the
        // z-tail-adoption contract test; both are valid ARIA patterns for
        // a span that opens a link-confirmation dialog.
        expect(src).toMatch(/role="link"/);
        expect(src).toMatch(/tabIndex=\{0\}/);
        expect(src).toMatch(/onKeyDown=\{e => \{\s*\n\s*if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
    });

    it.each(copies)('%s: LinkPopup has dialog semantics with a dynamic, link-naming label', (_name, src) => {
        expect(src).toMatch(/role="dialog"/);
        expect(src).toMatch(/aria-modal="true"/);
        expect(src).toMatch(/aria-label=\{`Open link: \$\{label\}`\}/);
    });

    it.each(copies)('%s: LinkPopup wires the shared useFocusTrap hook (Esc + Tab trap + focus restore)', (_name, src) => {
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{ active: true, onEscape: onClose \}\)/);
    });

    it.each(copies)('%s: no legacy ad-hoc z-index; overlay uses the modal tier token', (_name, src) => {
        expect(src).not.toContain('zIndex: 9999');
        expect(src).toContain("zIndex: 'var(--z-modal)'");
    });

    it('InlineLink/LinkPopup region is byte-identical across both copies', () => {
        const region = (src: string): string => {
            const start = src.indexOf('// ── Link Confirmation Popup');
            const inlineEnd = src.indexOf('\n\n', src.indexOf('showPopup && <LinkPopup'));
            return src.slice(start, inlineEnd);
        };
        expect(region(chat)).toBe(region(common));
    });
});
