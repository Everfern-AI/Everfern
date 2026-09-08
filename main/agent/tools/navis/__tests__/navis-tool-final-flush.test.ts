import { describe, it, expect, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// AG-PERF-02: focused test for the guaranteed final report flush in the
// navis tool's inner finally. Heavy / side-effectful deps of ../tool are
// factory-mocked so the real modules (playwright orchestrator, the
// bridge HTTP server, companion broadcasting, stores) never load.

vi.mock('../orchestrator', () => ({
  NavisOrchestrator: class NavisOrchestrator {},
}));
vi.mock('../companion-extension', () => ({
  broadcastNavisCompanionProgress: vi.fn(),
}));
vi.mock('../../permission-checker', () => ({
  checkToolPermission: vi.fn(async () => ({ approved: true })),
}));
vi.mock('../../../../store/tool-settings', () => ({
  toolSettingsStore: {
    get: () => ({
      navis: { maxSteps: 5, headless: true, useVision: false, onlyVision: false, selectedBrowserId: 'chrome' },
    }),
  },
}));
vi.mock('../../../../lib/extension-server', () => ({
  bridgeServer: { setSession: vi.fn() },
}));

// Redirect os.homedir() to an isolated temp dir so report/findings writes
// never touch the real ~/.everfern.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const home = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'navis-final-flush-'));
  return {
    ...actual,
    default: { ...actual, homedir: () => home },
    homedir: () => home,
  };
});

import { createNavisTool } from '../tool';
import { NavisLogger } from '../logger';

const toolSrcPath = fileURLToPath(new URL('../tool.ts', import.meta.url));

describe('AG-PERF-02: Navis tool guaranteed final report flush', () => {
  afterAll(() => {
    try { fs.rmSync(os.homedir(), { recursive: true, force: true }); } catch {}
  });

  it('source-order: inner finally flushes the report BEFORE setSession(null)', () => {
    const src = fs.readFileSync(toolSrcPath, 'utf8');
    const innerFinallyIdx = src.indexOf('} finally {');
    const flushCallIdx = src.indexOf('flushReportFile();');
    const setSessionIdx = src.indexOf('bridgeServer.setSession(null)');

    expect(innerFinallyIdx).toBeGreaterThan(-1);
    expect(flushCallIdx).toBeGreaterThan(innerFinallyIdx);
    expect(flushCallIdx).toBeLessThan(setSessionIdx);
    expect(src).toContain('AG-PERF-02');
    expect(src).toContain('Final report flush failed');
  });

  it('behavioral: run ending inside the 750ms debounce window still flushes the final report', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const toolCallId = 'final-flush-test';
      const reportPath = path.join(os.homedir(), '.everfern', 'navis', `${toolCallId}.md`);

      const logger = new NavisLogger();
      const fakeOrchestrator = {
        getEventLogger: () => logger,
        run: vi.fn(async () => {
          // Let the initial (pre-event) report write finish on the real event
          // loop so it cannot race with the final flush's full write.
          for (let i = 0; i < 100; i++) {
            if (fs.existsSync(reportPath) && fs.readFileSync(reportPath, 'utf8').includes('## Activity Log')) break;
            await new Promise((r) => setImmediate(r));
          }
          logger.browserLaunch('test browser');
          logger.aiDecision(1, 5, 'Decide: inspect page');
          logger.stepComplete(1, 5, 'clicked the target');
          logger.taskComplete(true, 1, 'found the answer');
          return { success: true, output: 'Done', steps: 1 };
        }),
      } as any;

      const tool = createNavisTool(fakeOrchestrator, { workspaceDir: os.homedir() } as any);
      await tool.execute({ task: 'AG-PERF-02 final flush' }, undefined, undefined, toolCallId);

      // The pending 750ms debounce timer must have been cleared by the
      // guaranteed final flush (without the fix, exactly 1 timer remains).
      expect(vi.getTimerCount()).toBe(0);

      // Without ever advancing the 750ms debounce window, the flushed write
      // must land on disk. Poll with small fake-time steps (total far below
      // 750ms) to let the real fs I/O complete.
      let content = '';
      for (let i = 0; i < 60 && !content.includes('🏁 Task Complete'); i++) {
        await vi.advanceTimersByTimeAsync(10);
        content = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
      }

      expect(content).toContain('## 🏁 Task Complete');
      expect(content).toContain('found the answer');
      expect(content).toContain('**Status:** ✅ Completed');
    } finally {
      vi.useRealTimers();
    }
  });
});
