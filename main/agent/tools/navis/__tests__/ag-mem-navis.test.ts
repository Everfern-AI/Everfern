/**
 * AG-MEM-05 / AG-MEM-08 / AG-MEM-09 / AG-MEM-10 — Navis memory-leak regression tests.
 *
 * Covers:
 *  (a) NavisLogger ring buffer caps at 12 and clear() empties it (AG-MEM-10)
 *  (b) tool.ts screenshots array cap ≤ 3 via pushBoundedScreenshot (AG-MEM-05)
 *  (c) probe token deletion in locatorClickProbeFired + document-level click probe (AG-MEM-08)
 *  (d) session.ts single framenavigated wiring via ensureNavListener guard (AG-MEM-09)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { NavisLogger } from '../logger';
import { pushBoundedScreenshot, MAX_RESULT_SCREENSHOTS } from '../tool';
import { installLocatorClickProbe, locatorClickProbeFired, performReliableClick } from '../actions';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// (a) AG-MEM-10: NavisLogger ring buffer + clear()
// ─────────────────────────────────────────────────────────────────────────────

describe('AG-MEM-10: NavisLogger ring buffer', () => {
  it('caps the screenshot buffer at 12 entries', () => {
    const logger = new NavisLogger();
    for (let step = 1; step <= 20; step++) {
      logger.screenshot(step, 20, `b64-payload-${step}`);
    }
    // Steps 1-8 evicted; steps 9-20 retained
    expect(logger.getScreenshot(1)).toBeUndefined();
    expect(logger.getScreenshot(8)).toBeUndefined();
    expect(logger.getScreenshot(9)).toBe('b64-payload-9');
    expect(logger.getScreenshot(20)).toBe('b64-payload-20');
  });

  it('clear() empties the screenshot buffer but keeps listeners intact', () => {
    const logger = new NavisLogger();
    logger.screenshot(1, 5, 'b64-a');
    logger.screenshot(2, 5, 'b64-b');

    const seen: string[] = [];
    const unsubscribe = logger.on((event) => {
      if (event.type === 'extract') seen.push(event.detail || '');
    });

    logger.clear();

    expect(logger.getScreenshot(1)).toBeUndefined();
    expect(logger.getScreenshot(2)).toBeUndefined();

    // Listener must survive clear()
    logger.extract(1, 5, 'still-listening');
    expect(seen).toEqual(['still-listening']);

    unsubscribe();
  });

  it('logger.ts sets MAX_SCREENSHOT_BUFFER to 12 (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'logger.ts'), 'utf-8');
    expect(src).toContain('const MAX_SCREENSHOT_BUFFER = 12;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) AG-MEM-05: bounded screenshots array in tool.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('AG-MEM-05: pushBoundedScreenshot caps tool-result screenshots at 3', () => {
  it('keeps only the last 3 entries', () => {
    const arr: number[] = [];
    for (let i = 1; i <= 10; i++) {
      pushBoundedScreenshot(arr, i);
    }
    expect(arr).toEqual([8, 9, 10]);
    expect(arr.length).toBeLessThanOrEqual(3);
  });

  it('does not evict when under the cap', () => {
    const arr: string[] = [];
    pushBoundedScreenshot(arr, 'a');
    pushBoundedScreenshot(arr, 'b');
    expect(arr).toEqual(['a', 'b']);
  });

  it('honors custom caps', () => {
    const arr: number[] = [];
    pushBoundedScreenshot(arr, 1, 1);
    pushBoundedScreenshot(arr, 2, 1);
    pushBoundedScreenshot(arr, 3, 1);
    expect(arr).toEqual([3]);
  });

  it('exposes MAX_RESULT_SCREENSHOTS = 3', () => {
    expect(MAX_RESULT_SCREENSHOTS).toBe(3);
  });

  it('tool.ts listener path uses pushBoundedScreenshot (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tool.ts'), 'utf-8');
    expect(src).toContain('pushBoundedScreenshot(screenshots, {');
    // IPC payload dedupe: no base64 in content for screenshot events
    expect(src).toMatch(/content: isScreenshotEvent\s*\n?\s*\? undefined/);
  });

  it('tool.ts clears the logger at end of run (source check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tool.ts'), 'utf-8');
    expect(src).toContain('logger.clear()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) AG-MEM-08: click-probe token cleanup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fake Page/Locator harness: runs locator.evaluate / page.evaluate callbacks
 * against a fake `window` object, exactly like a real browser page would.
 * The in-page callback bodies reference `window`, so the fake is installed on
 * globalThis for the duration of the test.
 */
function makeFakeWorld() {
  const win: Record<string, any> = {};
  const listeners: Array<() => void> = [];
  (globalThis as any).window = win;

  const el: any = {
    addEventListener: (_t: string, cb: () => void) => { listeners.push(cb); },
    click: () => { listeners.forEach((cb) => cb()); },
  };

  const fireClicks = () => { listeners.forEach((cb) => cb()); };

  const locator: any = {
    evaluate: vi.fn(async (pageFn: (el: any, arg: any) => any, arg?: any) => pageFn(el, arg)),
    click: vi.fn(async () => { fireClicks(); return true; }),
    boundingBox: vi.fn(async () => ({ x: 0, y: 0, width: 10, height: 10 })),
  };

  const page: any = {
    evaluate: vi.fn(async (pageFn: (arg: any) => any, arg?: any) => pageFn(arg)),
    mouse: {
      move: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      click: vi.fn(async () => { fireClicks(); }),
    },
  };

  return { win, locator, page, fireClicks };
}

describe('AG-MEM-08: locator click-probe token cleanup', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('locatorClickProbeFired deletes the token after reading it', async () => {
    const { win, locator } = makeFakeWorld();

    // Install a probe manually
    const token = await installLocatorClickProbe(locator);
    expect(token).toBeTruthy();
    expect(Object.keys(win.__navisElementClickProbe ?? {})).toHaveLength(1);

    // Probe has NOT fired yet → false, and token must be deleted in the same call
    const fired = await locatorClickProbeFired(locator, token);
    expect(fired).toBe(false);
    expect(win.__navisElementClickProbe ?? {}).toEqual({});
  });

  it('locatorClickProbeFired returns true when the probe fired, and still deletes the token', async () => {
    const { win, locator, fireClicks } = makeFakeWorld();

    const token = await installLocatorClickProbe(locator);
    fireClicks(); // element click listener fires the probe

    const fired = await locatorClickProbeFired(locator, token);
    expect(fired).toBe(true);
    expect(win.__navisElementClickProbe ?? {}).toEqual({});
  });

  it('locatorClickProbeFired returns true for null token (no probe installed)', async () => {
    const { locator } = makeFakeWorld();
    await expect(locatorClickProbeFired(locator, null)).resolves.toBe(true);
  });

  it('performReliableClick cleans up all installed probe tokens on success', async () => {
    const { win, locator, page } = makeFakeWorld();

    // First attempt (playwright click) succeeds and fires the probe
    const result = await performReliableClick(page, locator);
    expect(result.ok).toBe(true);
    expect(result.method).toBe('playwright');
    expect(win.__navisElementClickProbe ?? {}).toEqual({});
  });

  it('performReliableClick cleans up all installed probe tokens when every attempt fails', async () => {
    const { win, locator, page } = makeFakeWorld();

    // Every click attempt "succeeds" at the Playwright level but never fires
    // the element's click listener, so the probe reports failure each time.
    locator.click.mockImplementation(async () => true);

    const result = await performReliableClick(page, locator);
    expect(result.ok).toBe(false);
    expect(result.method).toBe('none');
    expect(win.__navisElementClickProbe ?? {}).toEqual({});
  });
});

describe('AG-MEM-08: document-level click probe cleanup (source check)', () => {
  it('executeBrowserClick reads + deletes __navisClickProbe in one evaluate', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'actions.ts'), 'utf-8');
    // The read site must delete the token in the same evaluate call
    expect(src).toMatch(/const clickFired = await page\.evaluate\(\(token: string\) => \{[\s\S]*?delete w\.__navisClickProbe\?\.\[token\][\s\S]*?\}, clickProbe\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) AG-MEM-09: single framenavigated handler per page
// ─────────────────────────────────────────────────────────────────────────────

describe('AG-MEM-09: single framenavigated handler per page (source checks)', () => {
  const sessionSrc = () => fs.readFileSync(path.join(__dirname, '..', 'session.ts'), 'utf-8');

  it('defines ensureNavListener with a double-registration guard', () => {
    const src = sessionSrc();
    expect(src).toContain('private ensureNavListener(page: Page): void');
    expect(src).toContain('__navisFramenavWired');
  });

  it('registers framenavigated handlers ONLY inside ensureNavListener', () => {
    const src = sessionSrc();
    // All handler registrations must go through the guarded helper
    const registrationSites = src.match(/\.on\('framenavigated'/g) ?? [];
    expect(registrationSites).toHaveLength(1); // the helper body itself
  });

  it('openTab no longer registers its own duplicate framenavigated handler', () => {
    const src = sessionSrc();
    const openTabFn = src.match(/async openTab[\s\S]*?\n  \}/);
    expect(openTabFn).toBeDefined();
    expect(openTabFn![0]).toContain('this.ensureNavListener(targetPage)');
    expect(openTabFn![0]).not.toContain(".on('framenavigated'");
    // Download listener untouched
    expect(openTabFn![0]).toContain(".on('download'");
    expect(openTabFn![0]).toContain('return targetPage;');
  });

  it('ensureNavListener guard actually prevents double wiring', async () => {
    const { BrowserSession } = await import('../session');
    const session = new BrowserSession();
    const handler = (session as any).ensureNavListener.bind(session);

    const registered: number[] = [];
    const fakePage: any = {
      on: (evt: string, cb: any) => { registered.push(1); },
      mainFrame: () => ({}),
    };

    handler(fakePage);
    handler(fakePage); // second call must be a no-op thanks to the guard
    expect(registered).toHaveLength(1);
    expect((fakePage as any).__navisFramenavWired).toBe(true);
  });
});
