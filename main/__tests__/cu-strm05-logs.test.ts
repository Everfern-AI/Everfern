import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * CU-STRM-05 — hot-path console.log DEV-gating (page.tsx source contract).
 *
 * DOM-free preservation test: reads page.tsx source and verifies that every
 * console.log in the hot streaming regions is gated behind import.meta.env.DEV,
 * while one-off mount/UX logs may remain ungated. Also pins the CU-UI-07
 * Escape behavior (dismiss-only, never setInputValue('')) and the CU-UI-05
 * custom-keybind early return.
 *
 * EXPECTED OUTCOME: PASS on fixed code. Fails if a hot-path logger is added
 * unguarded or if the Escape-clears-input regression returns.
 */

const PAGE = path.resolve(__dirname, '../../src/app/chat/page.tsx');
const src = readFileSync(PAGE, 'utf-8');
const lines = src.split('\n');

function consoleLogLines(): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (l.includes('console.log')) out.push(i + 1);
  });
  return out;
}

/** Hot-path regions (1-indexed line windows) — the stream-handler IIFE
 * (handleSend body) plus mount-registered per-event listeners. Windows are
 * located by anchor strings, not fixed line numbers, so this stays robust
 * against unrelated edits. */
function regionFor(anchor: RegExp, endAnchor: RegExp): [number, number] | null {
  const start = lines.findIndex((l) => anchor.test(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, idx) => idx > start && endAnchor.test(l));
  return end === -1 ? null : [start + 1, end + 1];
}

function assertRegionGated(region: [number, number] | null, name: string): number {
  expect(region, `anchor for ${name} region not found`).not.toBeNull();
  let ungated = 0;
  const [s, e] = region!;
  for (let n = s; n <= e; n++) {
    const l = lines[n - 1];
    if (!l.includes('console.log')) continue;
    // catch-block audio failure logs are intentionally left ungated
    if (l.includes('[Audio]')) continue;
    if (!l.includes('import.meta.env.DEV')) {
      ungated++;
      console.error(`ungated console.log at line ${n}: ${l.trim().slice(0, 90)}`);
    }
  }
  expect(ungated, `${name}: ${ungated} ungated console.log calls`).toBe(0);
  return e - s;
}

describe('CU-STRM-05: DEV-gated hot-path logging in page.tsx', () => {
  it('has at least 60 DEV-gated console.log calls', () => {
    const gated = src.match(/if \(import\.meta\.env\.DEV\) console\.log/g)?.length ?? 0;
    expect(gated).toBeGreaterThanOrEqual(60);
  });

  it('gates the handleSend stream-handler IIFE region (tool-call/HITL/normalize hot path)', () => {
    const region = regionFor(/const handleSend = useCallback/, /^    }, \[inputValue/);
    const span = assertRegionGated(region, 'handleSend IIFE');
    expect(span).toBeGreaterThan(400); // sanity: matched the real region
  });

  it('gates the mount-registered mission/HITL/local-execution event listeners', () => {
    // Local execution listeners (persistent)
    assertRegionGated(regionFor(/onLocalExecutionRequest\(\(request/, /setLocalExecutionRequest\(request\)/), 'local-exec request');
    // activeUserQuestions debug effect
    assertRegionGated(regionFor(/Debug: Log when activeUserQuestions changes/, /\}, \[activeUserQuestions\]\)/), 'activeUserQuestions effect');
    // HITL mount listener
    assertRegionGated(regionFor(/Register HITL listener at mount/, /removeHitlRequestListener/), 'HITL mount listener');
    // Mission timeline persistent listeners
    assertRegionGated(regionFor(/Persistent Mission Timeline Listeners/, /onMissionComplete\(/), 'mission listeners');
    // ask_user_question branch in mount-region onToolStart / onToolCall
    assertRegionGated(regionFor(/Received ask_user_question tool_start/, /handled exclusively by the/), 'ask_user_question tool_start');
  });

  it('leaves console.error and console.warn untouched', () => {
    expect(src).toMatch(/console\.error\('\[Frontend\] ❌/);
    expect(src).toMatch(/console\.warn\('\[DOCX\]/);
  });
});

describe('CU-UI-07 / CU-UI-05 pinning', () => {
  it('Escape in the slash-menu keydown handler dismisses the menu, never clears input', () => {
    const escIdx = lines.findIndex((l) => l.includes("if (e.key === 'Escape')"));
    expect(escIdx).toBeGreaterThan(-1);
    const block = lines.slice(escIdx, escIdx + 6).join('\n');
    expect(block).toContain('setSlashMenuDismissed(true)');
    expect(block).not.toContain("setInputValue('')");
  });

  it('slash menu activity honors the dismissed flag', () => {
    expect(src).toMatch(/const isSlashActive = !slashMenuDismissed && inputValue\.startsWith\('\/'\)/);
  });

  it('custom-keybind match returns before the Ctrl+U / Ctrl+Shift+J built-ins', () => {
    const matchIdx = lines.findIndex((l) => l.includes('const match = keybinds.find'));
    expect(matchIdx).toBeGreaterThan(-1);
    const ctrlUIdx = lines.findIndex((l) => l.includes('// File attachment shortcut (Ctrl+U)'));
    expect(ctrlUIdx).toBeGreaterThan(matchIdx);
    const between = lines.slice(matchIdx, ctrlUIdx).join('\n');
    expect(between).toContain('return;');
  });
});
