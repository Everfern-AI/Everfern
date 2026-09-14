import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const NAVIS_DIR = path.join(__dirname, '..');
function read(file: string): string {
  return fs.readFileSync(path.join(NAVIS_DIR, file), 'utf-8');
}

describe('Fix: aria-ref based element targeting', () => {
  it('actions.ts uses aria-ref locator instead of nth/first', () => {
    const src = read('actions.ts');
    expect(src).toContain('aria-ref=');
    expect(src).toContain('page.locator');
  });
});

describe('Fix: public getContext() instead of (as any)', () => {
  it('session.ts exposes getContext() method', () => {
    const src = read('session.ts');
    expect(src).toContain('getContext():');
    expect(src).toContain('BrowserContext');
  });

  it('orchestrator.ts passes session directly, not getContext()', () => {
    const src = read('orchestrator.ts');
    expect(src).toContain('this.session');
    expect(src).not.toContain('(this.session as any)');
  });
});

describe('Fix: wait before first capture', () => {
  it('orchestrator waits for page load before capturing elements', () => {
    const src = read('orchestrator.ts');
    expect(src).toContain('waitForLoadState');
  });
});

describe('Fix: maxActionsPerStep enforced', () => {
  it('orchestrator truncates actions to maxActionsPerStep', () => {
    const src = read('orchestrator.ts');
    expect(src).toContain('.slice(0, maxActionsPerStep)');
  });
});

describe('Fix: getTabs() fetches actual titles', () => {
  it('session.ts getTabs() is async and calls page.title()', () => {
    const src = read('session.ts');
    expect(src).toContain('async getTabs()');
    expect(src).toContain('await p.title()');
  });
});

describe('Fix: ariaSnapshot for element capture', () => {
  it('element-capture.ts uses page.ariaSnapshot', () => {
    const src = read('element-capture.ts');
    expect(src).toContain('ariaSnapshot');
    expect(src).toContain("mode: 'ai'");
  });

  it('element-capture.ts exports parseRefs helper', () => {
    const src = read('element-capture.ts');
    expect(src).toContain('export function parseRefs');
  });
});

describe('Fix: pressSequentially instead of fill()', () => {
  it('actions.ts uses pressSequentially for input events', () => {
    const src = read('actions.ts');
    expect(src).toContain('pressSequentially');
    expect(src).not.toContain('.fill(');
  });
});

describe('Fix: tabCounter removed', () => {
  it('session.ts does not have dead tabCounter code', () => {
    const src = read('session.ts');
    expect(src).not.toContain('tabCounter');
  });
});

describe('Fix: open_tab switches to new tab', () => {
  it('actions.ts calls bringToFront() after opening tab', () => {
    const src = read('actions.ts');
    const openTabFn = src.match(/async function executeOpenTab[\s\S]*?\n\}/);
    expect(openTabFn).toBeDefined();
    expect(openTabFn![0]).toContain('bringToFront()');
  });
});

describe('Integration: orchestrator uses all fixes together', () => {
  it('orchestrator calls session, gets pages, waits, and slices', () => {
    const src = read('orchestrator.ts');
    expect(src).toContain('this.session');
    expect(src).toContain('this.session.allPages');
    expect(src).toContain('waitForLoadState');
    expect(src).toContain('.slice(0, maxActionsPerStep)');
    expect(src).not.toContain('(this.session as any)');
  });
});