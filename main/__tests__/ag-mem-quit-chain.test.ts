/**
 * AG-MEM quit-chain wiring — source-scan regression test.
 *
 * Asserts that the AG-MEM cleanup hooks (computer-use overlay teardown,
 * agent-event final sweep, and the module-interval stop hooks) are wired
 * into main.ts's `app.on('before-quit', ...)` handler. Battery-leaks-style
 * static scan, robust to minor reformatting (slices the handler body out of
 * the source text rather than matching line numbers).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

/** Slice the full body of the before-quit handler out of main.ts source. */
function beforeQuitBody(): string {
  const main = read('main.ts');
  const startMatch = main.match(/app\.on\s*\(\s*['"]before-quit['"]/);
  expect(startMatch, 'main.ts must register a before-quit handler').not.toBeNull();
  const start = startMatch!.index!;
  // The handler closes with a top-level, un-indented `});` — nested closings
  // inside the body (e.g. the forceExit timer) are always indented, so the
  // first `\n});` after the handler opens is the handler's end.
  const end = main.indexOf('\n});', start);
  expect(end, 'before-quit handler should have a closing brace').toBeGreaterThan(start);
  return main.slice(start, end + 4);
}

describe('AG-MEM quit-chain: cleanup hooks wired into before-quit', () => {
  const body = beforeQuitBody();

  it('AG-MEM-01/02: computer-use capture + overlay teardown present', () => {
    expect(body).toMatch(/require\('\.\/agent\/tools\/computer-use'\)/);
    expect(body).toMatch(/shutdownComputerUseCapture\?\.\(\)/);
    expect(body).toMatch(/destroyAllComputerUseOverlays\?\.\(\)/);
  });

  it('AG-MEM-12: state-manager cleanup interval stopped', () => {
    expect(body).toMatch(/require\('\.\/agent\/runner\/state-manager'\)/);
    expect(body).toMatch(/stopStateCleanup\?\.\(\)/);
  });

  it('AG-MEM-12: analysis-session cleanup interval stopped', () => {
    expect(body).toMatch(/require\('\.\/agent\/sessions\/analysis-session'\)/);
    expect(body).toMatch(/stopAnalysisSessionCleanup\?\.\(\)/);
  });

  it('AG-MEM-12: system-prompt cache cleanup interval stopped', () => {
    expect(body).toMatch(/require\('\.\/agent\/runner\/system-prompt'\)/);
    expect(body).toMatch(/stopPromptCacheCleanup\?\.\(\)/);
  });

  it('AG-MEM-07: agent-event emitters final sweep present', () => {
    expect(body).toMatch(/require\('\.\/agent\/infra\/agent-events'\)/);
    expect(body).toMatch(/clearAllAgentEvents\?\.\(\)/);
  });
});
