/**
 * MP-SEC-15 — ComputerUseTool.call permission gate tests.
 *
 * Expected behavior:
 *  - `call` fails closed with a permission error unless
 *    isPermissionGranted() returns true.
 *  - When granted, `call` proceeds past the gate to real action dispatch.
 *
 * BUG-CONDITION NOTE (mirrors ollama-cloud-auth.bug.test.ts): the gate is
 * NOT yet implemented in computer-use.ts at the time this draft was
 * written — the fail-closed tests below are EXPECTED TO FAIL until the
 * gate lands; they go green the moment it does.
 *
 * Import-path note: isPermissionGranted() currently lives in
 * main/ipc/terminal-process-handlers.ts:6 (re-exported by main/main.ts:1402
 * and main/ipc/index.ts:54 via `export *`). The parent plans to move the
 * state to a new leaf module main/ipc/computer-use-permission.ts so the
 * tool does not drag electron/ipcMain + CommandRegistry into its import
 * graph. BOTH module paths are mocked below with the same controllable
 * implementation, so the tests survive either landing choice.
 * TODO(parent): if the gate imports a different path, update the
 * vi.mock specifiers below (they resolve relative to this test file).
 *
 * Mocking note (copied from computer-use-safety.test.ts): computer-use.ts
 * loads robotjs/electron via runtime CJS require(), which vi.mock cannot
 * intercept in the node environment. We therefore patch Module._load
 * BEFORE dynamically importing the module under test, and restore the
 * patch in afterAll.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// DesktopOverlay imports electron via ESM — keep it non-throwing.
vi.mock('electron', () => ({
  screen: {
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
  desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

// Permission state shared with the mock factories. vi.hoisted runs before
// the hoisted vi.mock factories are invoked, avoiding TDZ issues.
const perm = vi.hoisted(() => ({ granted: false }));

// Future home of the permission state (parent will create this module).
// Mocking a not-yet-existing path is harmless while nothing imports it;
// the moment computer-use.ts imports it, this factory takes over.
vi.mock('../../../ipc/computer-use-permission', () => ({
  isPermissionGranted: () => perm.granted,
}));

// Current home of isPermissionGranted (terminal-process-handlers.ts:6).
// Factory mock => the real module (electron, ipcMain, CommandRegistry)
// never loads.
vi.mock('../../../ipc/terminal-process-handlers', () => ({
  isPermissionGranted: () => perm.granted,
  registerTerminalProcessHandlers: vi.fn(),
}));

// ── Module._load patch (runtime require() interception) ──────────────────────

const g: any = globalThis;
g.__robotLog = [];

const electronStub = {
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
  },
  desktopCapturer: { getSources: async () => [] },
  shell: { openExternal: async () => undefined },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  BrowserWindow: { getAllWindows: () => [] },
};

const robotStub = {
  setMouseDelay: () => {},
  moveMouse: (...a: any[]) => { g.__robotLog.push(['moveMouse', ...a]); },
  mouseToggle: (...a: any[]) => { g.__robotLog.push(['mouseToggle', ...a]); },
  keyToggle: (...a: any[]) => { g.__robotLog.push(['keyToggle', ...a]); },
  keyTap: (...a: any[]) => { g.__robotLog.push(['keyTap', ...a]); },
  typeString: (...a: any[]) => { g.__robotLog.push(['typeString', ...a]); },
  dragMouse: (...a: any[]) => { g.__robotLog.push(['dragMouse', ...a]); },
  getMousePos: () => ({ x: 0, y: 0 }),
};

const NodeModule = require('module');
const origLoad = NodeModule._load;
NodeModule._load = function (request: string, parent: any, isMain: boolean) {
  if (request === '@jitsi/robotjs') return robotStub;
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

afterAll(() => {
  NodeModule._load = origLoad;
});

const { ComputerUseTool } = await import('../computer-use');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool() {
  const home = process.env.HOME ?? '/tmp';
  return new ComputerUseTool(`${home}/.everfern/test-perm-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

/**
 * Run `call`, flattening both possible failure modes into one string:
 * a thrown Error, or a returned error-status ToolResult payload. The
 * fail-closed assertion only needs /permission/i to appear in either.
 */
async function callOutcome(tool: ComputerUseTool, params: Record<string, any>): Promise<string> {
  try {
    const r: any = await tool.call(params);
    return JSON.stringify(r?.payload ?? r);
  } catch (e: any) {
    return `THROWN: ${e?.message ?? String(e)}`;
  }
}

// ── MP-SEC-15 gate ────────────────────────────────────────────────────────────

describe('MP-SEC-15 — ComputerUseTool.call permission gate', () => {
  beforeEach(() => {
    perm.granted = false;
    g.__robotLog.length = 0;
  });

  it('fails closed with a permission error when permission is not granted', async () => {
    const out = await callOutcome(makeTool(), { action: 'answer', text: 'x' });
    expect(out).toMatch(/permission/i);
    // Never reached execution: the answer payload must not come back.
    expect(out).not.toMatch(/"status":"answer"/);
  }, 20000);

  it('blocks a hardware action before any robot call when not granted', async () => {
    const tool = makeTool();
    g.__robotLog.length = 0; // clear constructor-time setMouseDelay log
    const out = await callOutcome(tool, { action: 'type', text: 'secret' });
    expect(out).toMatch(/permission/i);
    expect(g.__robotLog.length).toBe(0);
  }, 20000);

  describe('when permission is granted', () => {
    it('passes the gate and executes the action (answer — no hardware, no screenshot)', async () => {
      perm.granted = true;
      const tool = makeTool();
      const r: any = await tool.call({ action: 'answer', text: 'done' });
      expect(r?.payload?.status).toBe('answer');
      expect(r?.payload?.text).toBe('done');
    }, 20000);
  });
});
