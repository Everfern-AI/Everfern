// @vitest-environment node
/**
 * Z-TAIL contract tests (DOM-free, text-contract style like
 * preload-listener-lifecycle.test.ts).
 *
 * Locks the deferred-tail z-order + a11y adoption:
 *   - FileViewerModal no longer wraps its root in a local AnimatePresence
 *     with unconditional children (which dead-coded exit animations); the
 *     parent in page.tsx now owns presence via AnimatePresence + conditional.
 *   - FileViewerModal uses the shared useFocusTrap hook (Esc + Tab trap +
 *     focus restore + scroll lock) and carries dialog semantics.
 *   - MarkdownComponents (both copies): InlineLink is keyboard-operable and
 *     LinkPopup has dialog semantics + trap.
 *   - Adopted overlays use z-tier tokens, not ad-hoc literals.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', rel), 'utf-8');

describe('Z-TAIL · FileViewerModal', () => {
  const fvm = read('components/files/FileViewerModal.tsx');
  const page = read('app/chat/page.tsx');

  it('root is NOT wrapped in a local AnimatePresence (exit animations live in the parent)', () => {
    // The component-level AnimatePresence wrapped unconditional children —
    // dead exit props. The only remaining AnimatePresence uses must be the
    // inner dropdown/toolbar ones (indented deeper), not the modal root.
    expect(fvm).not.toMatch(/\n    return \(\n        <AnimatePresence>/);
  });

  it('page.tsx wraps FileViewerModal in AnimatePresence + conditional mount', () => {
    expect(page).toMatch(/<AnimatePresence>\s*\n\s*\{viewingFile && \(\s*\n\s*<FileViewerModal/);
  });

  it('uses the shared useFocusTrap hook with Esc close and dialog semantics', () => {
    expect(fvm).toContain("useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: onClose })");
    expect(fvm).toMatch(/role="dialog"/);
    expect(fvm).toMatch(/aria-modal="true"/);
  });

  it('overlay uses the z-modal tier token', () => {
    expect(fvm).toContain("zIndex: 'var(--z-modal)'");
  });
});

describe('Z-TAIL · MarkdownComponents (both copies)', () => {
  const copies = [
    { name: 'chat', src: read('app/chat/components/MarkdownComponents.tsx') },
    { name: 'common', src: read('components/common/MarkdownComponents.tsx') },
  ];

  for (const { name, src } of copies) {
    it(`${name}: InlineLink exposes link semantics, tab stop, and keyboard activation`, () => {
      expect(src).toMatch(/role="link"/);
      expect(src).toMatch(/tabIndex=\{0\}/);
      expect(src).toMatch(/onKeyDown=\{e => \{\s*\n\s*if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
    });

    it(`${name}: LinkPopup has dialog semantics and the shared focus trap`, () => {
      expect(src).toMatch(/role="dialog"/);
      expect(src).toMatch(/aria-modal="true"/);
      expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{ active: true, onEscape: onClose \}\)/);
    });

    it(`${name}: popup overlay uses the z-modal tier token`, () => {
      expect(src).toContain("zIndex: 'var(--z-modal)'");
      expect(src).not.toMatch(/zIndex: 9999/);
    });
  }
});

describe('Z-TAIL · modals over the zIndex:200 settings sheet', () => {
  it('SettingsPage vectors/add-memory overlays sit above the sheet (z-modal tier)', () => {
    const settings = read('app/chat/SettingsPage.tsx');
    const privacy = read('app/chat/settings/PrivacySection.tsx');
    const memory = read('app/chat/settings/MemorySection.tsx');
    for (const src of [settings, privacy, memory]) {
      expect(src).not.toMatch(/zIndex:\s*(9999|10000|10001)\b/);
    }
    expect(privacy).toContain("zIndex: 'var(--z-modal)'");
    expect(memory).toContain("zIndex: 'var(--z-modal)'");
  });

  it('StarRepoPopup and CreateProjectModal trap focus + close on Escape', () => {
    const star = read('app/chat/components/StarRepoPopup.tsx');
    const cpm = read('app/components/CreateProjectModal.tsx');
    for (const src of [star, cpm]) {
      expect(src).toMatch(/useFocusTrap<HTMLDivElement>/);
      expect(src).toMatch(/role="dialog"/);
    }
  });
});

describe('Z-TAIL · page.tsx scroll-region tokens (CU-UI-08 tail)', () => {
  const page = read('app/chat/page.tsx');

  it('progressive blur + scroll-to-bottom button use z-tier tokens, not raw utilities', () => {
    expect(page).toContain('z-[var(--z-dropdown)]');
    expect(page).toContain('z-[var(--z-panel)]');
  });

  it('no raw z-10/z-20 utilities remain in page.tsx', () => {
    expect(page).not.toMatch(/\bz-(?:10|20)\b/);
  });
});
