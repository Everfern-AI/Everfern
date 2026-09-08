/**
 * AG-CORR-06 — Navis-side mouse release for hold_element with holdTimeMs=0.
 *
 * Before the fix, hold_element with holdTimeMs=0 called page.mouse.down() and
 * returned success — the Playwright button stayed DOWN for the whole session
 * (and beyond, since the orchestrator finally keeps sessions open for HITL).
 * Nothing ever called page.mouse.up().
 *
 * Fix: executeHoldElement/executeDragElement record the held button on
 * session.heldMouseButtons + a module-level registry; the orchestrator
 * finally calls releaseAllHeldMice() before session.close(...).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { executeAction, releaseAllHeldMice } from '../actions';

const NAVIS_DIR = path.join(__dirname, '..');
function read(file: string): string {
  return fs.readFileSync(path.join(NAVIS_DIR, file), 'utf-8');
}

function makeMockPage() {
  return {
    url: () => 'https://test.local/hold',
    context: () => ({ browser: () => null }),
    mouse: {
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
    },
  } as any;
}

function makeMockSession(page: any) {
  return {
    page,
    moveCursor: vi.fn(async () => {}),
    highlightElement: vi.fn(async () => {}),
    setOverlayStatus: vi.fn(async () => {}),
    setActivePage: vi.fn(),
    heldMouseButtons: new Set<string>(),
    releaseHeldMouse: vi.fn(async function (this: any) {
      if (this.heldMouseButtons.size > 0 && this.page) {
        try {
          await this.page.mouse.up();
        } catch { /* page gone */ }
      }
      this.heldMouseButtons.clear();
    }),
  } as any;
}

// The module-level sessionsWithHeldMouse registry can hold sessions from
// earlier tests — drain it so each test starts clean.
beforeEach(async () => {
  await releaseAllHeldMice();
});

describe('AG-CORR-06: hold_element with holdTimeMs=0 tracks and releases the held button', () => {
  it('holdTimeMs=0: button stays down, session tracks it, releaseAllHeldMice() releases', async () => {
    const page = makeMockPage();
    const session = makeMockSession(page);

    const result = await executeAction('hold_element', { x: 100, y: 200 }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Holding');
    // Down was pressed; up must NOT have been called yet.
    expect(page.mouse.down).toHaveBeenCalledTimes(1);
    expect(page.mouse.up).not.toHaveBeenCalled();
    // The session records the stuck button.
    expect(session.heldMouseButtons.contains?.('left') ?? session.heldMouseButtons.has('left')).toBe(true);

    // Turn-end release (what the orchestrator finally invokes).
    await releaseAllHeldMice();

    expect(page.mouse.up).toHaveBeenCalledTimes(1);
    expect(session.heldMouseButtons.size).toBe(0);
  });

  it('holdTimeMs>0: up() is called inline and the held set ends empty', async () => {
    const page = makeMockPage();
    const session = makeMockSession(page);

    const result = await executeAction('hold_element', { x: 10, y: 20, holdTimeMs: 30 }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Held');
    expect(page.mouse.down).toHaveBeenCalledTimes(1);
    expect(page.mouse.up).toHaveBeenCalledTimes(1);
    expect(session.heldMouseButtons.size).toBe(0);

    // A later turn-end release must be a no-op (no double up()).
    await releaseAllHeldMice();
    expect(page.mouse.up).toHaveBeenCalledTimes(1);
  });

  it('releaseAllHeldMice() is a safe no-op when nothing is held', async () => {
    const page = makeMockPage();
    await releaseAllHeldMice();
    expect(page.mouse.up).not.toHaveBeenCalled();
  });
});

describe('AG-CORR-06: orchestrator wiring (source assertions)', () => {
  it('orchestrator finally releases held mice BEFORE session.close', () => {
    const src = read('orchestrator.ts');
    const releaseIdx = src.indexOf('await releaseAllHeldMice()');
    const closeIdx = src.indexOf('session.close(true)');
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeLessThan(closeIdx);
    // Guarded call so teardown never breaks on release errors.
    expect(src).toContain('AG-CORR-06');
  });

  it('hold and drag paths register held buttons (source assertions)', () => {
    const src = read('actions.ts');
    // Held tracking after every bare mouse.down in hold/drag paths.
    expect(src).toContain("session.heldMouseButtons.add('left')");
    expect(src).toContain('sessionsWithHeldMouse.add(session)');
    expect(src).toContain('sessionsWithHeldMouse.delete(session)');
    expect(src).toContain('export async function releaseAllHeldMice');
  });

  it('BrowserSession owns releaseHeldMouse (source assertions)', () => {
    const src = read('session.ts');
    expect(src).toContain('heldMouseButtons');
    expect(src).toContain('async releaseHeldMouse()');
    expect(src).toContain('mouse.up()');
  });
});
