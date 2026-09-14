/**
 * AG-SAF-06 / AG-SAF-07 / AG-SAF-11 — Computer Use safety hardening tests.
 *
 * - AG-SAF-06: shell.openExternal must only ever receive http(s) URLs
 *   (isSafeExternalUrl guard at the model-driven `navigate` and the
 *   hardcoded `search` call sites).
 * - AG-SAF-07: hold actions are capped at MAX_HOLD_MS with an auto-release
 *   timer; held mouse buttons are tracked and released by releaseAll() at
 *   abort and turn end.
 * - AG-SAF-11: a destructive-keyword heuristic (looksDestructive) backstops
 *   the model-driven safetyDecision gate and also covers the text-action
 *   dispatch paths (dispatchAll / Thought-Action loop).
 *
 * Mocking note: computer-use.ts loads robotjs/electron via runtime CJS
 * require(), which vi.mock cannot intercept in the node environment. We
 * therefore patch Module._load BEFORE dynamically importing the module
 * under test, and restore the patch in afterAll.
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

// MP-SEC-15: these suites exercise real action execution past the
// permission gate, so the gate must read as granted here. The gate's
// fail-closed behavior is covered by computer-use-permission-gate.test.ts.
vi.mock('../../../ipc/computer-use-permission', () => ({
  isPermissionGranted: () => true,
}));

// ── Module._load patch (runtime require() interception) ──────────────────────

const g: any = globalThis;
g.__robotLog = [];
g.__shellLog = [];
g.__dialogLog = [];

const electronStub = {
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
  },
  desktopCapturer: { getSources: async () => [] },
  shell: {
    openExternal: async (url: string) => { g.__shellLog.push(url); return undefined; },
  },
  dialog: {
    showMessageBox: async (opts: any) => { g.__dialogLog.push(opts); return { response: 0 }; },
  },
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

const {
  isSafeExternalUrl,
  looksDestructive,
  DESTRUCTIVE_ACTION_PATTERN,
  MAX_HOLD_MS,
  createComputerUseTool,
  ComputerUseTool,
} = await import('../computer-use');
import type { AIClient } from '../../../lib/ai-client';

function makeTool() {
  const home = process.env.HOME ?? '/tmp';
  return new ComputerUseTool(`${home}/.everfern/test-screenshots-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

function robotCalls(method: string): any[][] {
  return g.__robotLog.filter((c: any[]) => c[0] === method);
}

// ── AG-SAF-06: isSafeExternalUrl ─────────────────────────────────────────────

describe('AG-SAF-06 — isSafeExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/path?query=1')).toBe(true);
    expect(isSafeExternalUrl('https://www.google.com')).toBe(true);
  });

  it('rejects javascript:, file:, ftp:, data:, non-URLs and non-strings', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('ftp://example.com')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(42)).toBe(false);
    expect(isSafeExternalUrl({ url: 'https://x.com' })).toBe(false);
  });
});

// ── AG-SAF-06: navigate toolCall is blocked fail-closed at dispatch ───────────

describe('AG-SAF-06 — navigate gate at dispatch', () => {
  beforeEach(() => {
    g.__shellLog.length = 0;
    g.__dialogLog.length = 0;
  });

  /**
   * Anthropic provider → ComputerUseAgent.run() takes the toolCall runner,
   * which contains the navigate handler and the AG-SAF-11 gate.
   * chat() sequence: 1st = plan generation (maxTokens 512), 2nd = action turn
   * (returns the navigate toolCall), 3rd = done (no toolCalls → loop breaks).
   */
  function makeClient(toolCalls: any[]): AIClient {
    let actionTurn = false;
    const chat = vi.fn().mockImplementation(async (req: any) => {
      if (req.maxTokens === 512) return { content: '1. plan step' }; // plan call
      if (!actionTurn) {
        actionTurn = true;
        return { content: 'Navigating.', toolCalls };
      }
      return { content: 'Task finished.', toolCalls: [] };
    });
    return {
      provider: 'anthropic',
      model: 'claude-test',
      chat,
    } as unknown as AIClient;
  }

  it('blocks a javascript: navigate URL and never calls openExternal with it', async () => {
    const tool = createComputerUseTool(makeClient([
      { id: 'tc1', name: 'navigate', arguments: { url: 'javascript:alert(document.domain)' } },
    ]));

    await tool.execute({ task: 'open the page' }, () => {}, undefined, 't1');

    const bad = g.__shellLog.filter((u: string) => String(u).includes('javascript:'));
    expect(bad.length).toBe(0);
  }, 60000);

  it('allows an https navigate URL through to openExternal', async () => {
    const tool = createComputerUseTool(makeClient([
      { id: 'tc1', name: 'navigate', arguments: { url: 'https://example.com' } },
    ]));

    await tool.execute({ task: 'open the page' }, () => {}, undefined, 't2');

    expect(g.__shellLog).toContain('https://example.com');
  }, 60000);
});

// ── AG-SAF-07: MAX_HOLD_MS, auto-release, heldMouse, releaseAll ───────────────

describe('AG-SAF-07 — hold cap and auto-release', () => {
  beforeEach(() => {
    g.__robotLog.length = 0;
  });

  it('exports MAX_HOLD_MS = 30000', () => {
    expect(MAX_HOLD_MS).toBe(30000);
  });

  it('clamps an oversized hold_time to MAX_HOLD_MS and auto-releases by the cap (mouse)', async () => {
    vi.useFakeTimers();
    try {
      const tool = makeTool();
      const holdPromise = tool.call({ action: 'hold', coordinate: [100, 100], hold_time: 999_999 });
      await vi.advanceTimersByTimeAsync(0); // let the down-toggle + timers register
      expect(robotCalls('mouseToggle')).toContainEqual(['mouseToggle', 'down', 'left']);

      await vi.advanceTimersByTimeAsync(MAX_HOLD_MS); // exactly the cap
      await holdPromise;

      const ups = robotCalls('mouseToggle').filter(c => c[1] === 'up');
      expect(ups.length).toBeGreaterThanOrEqual(1);
      // 999_999 was clamped: the hold resolved at the 30s mark under fake
      // timers (without the clamp it would still be pending at 30s).
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it('schedules auto-release at MAX_HOLD_MS when hold_time is absent (mouse)', async () => {
    vi.useFakeTimers();
    try {
      const tool = makeTool();
      // No hold_time: promise resolves immediately, button stays down.
      await tool.call({ action: 'hold', coordinate: [100, 100] });
      expect(robotCalls('mouseToggle')).toContainEqual(['mouseToggle', 'down', 'left']);
      expect(robotCalls('mouseToggle').some(c => c[1] === 'up')).toBe(false);

      // Auto-release fires by the 30s cap even though nothing awaited it.
      await vi.advanceTimersByTimeAsync(MAX_HOLD_MS);
      expect(robotCalls('mouseToggle')).toContainEqual(['mouseToggle', 'up', 'left']);
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it('auto-releases held keys by MAX_HOLD_MS when hold_time is absent', async () => {
    vi.useFakeTimers();
    try {
      const tool = makeTool();
      await tool.call({ action: 'hold', keys: ['shift'] });
      expect(robotCalls('keyToggle')).toContainEqual(['keyToggle', 'shift', 'down']);
      expect(robotCalls('keyToggle').some(c => c[2] === 'up' || c[1] === 'up')).toBe(false);

      await vi.advanceTimersByTimeAsync(MAX_HOLD_MS);
      expect(robotCalls('keyToggle')).toContainEqual(['keyToggle', 'shift', 'up']);
    } finally {
      vi.useRealTimers();
    }
  }, 20000);
});

describe('AG-SAF-07 — heldMouse tracking and releaseAll', () => {
  beforeEach(() => {
    g.__robotLog.length = 0;
  });

  it('releaseHeldMouse sends mouseToggle("up", "left") after a coordinate hold', async () => {
    const tool = makeTool();
    await tool.call({ action: 'hold', coordinate: [50, 50] });
    expect(robotCalls('mouseToggle')).toContainEqual(['mouseToggle', 'down', 'left']);

    tool.releaseHeldMouse();
    expect(robotCalls('mouseToggle')).toContainEqual(['mouseToggle', 'up', 'left']);

    // Idempotent: a second release sends nothing new.
    const before = robotCalls('mouseToggle').length;
    tool.releaseHeldMouse();
    expect(robotCalls('mouseToggle').length).toBe(before);
  }, 20000);
});

// ── AG-SAF-11: looksDestructive + confirmation gate ───────────────────────────

describe('AG-SAF-11 — looksDestructive heuristic', () => {
  it('flags destructive phrasing', () => {
    expect(looksDestructive(['uninstall the app'])).toBe(true);
    expect(looksDestructive(['Delete all files'])).toBe(true);
    expect(looksDestructive(['format disk'])).toBe(true);
    expect(looksDestructive(['', null, undefined, 'wipe the drive'])).toBe(true);
  });

  it('passes benign phrasing', () => {
    expect(looksDestructive(['open settings'])).toBe(false);
    expect(looksDestructive(['click Submit'])).toBe(false);
    expect(looksDestructive(['scroll down'])).toBe(false);
    expect(looksDestructive([null, undefined, ''])).toBe(false);
    expect(looksDestructive([])).toBe(false);
  });

  it('pins the destructive word list', () => {
    for (const word of ['delete', 'remove', 'uninstall', 'format', 'purge', 'wipe', 'erase', 'trash', 'shred', 'reset', 'clear']) {
      expect(DESTRUCTIVE_ACTION_PATTERN.test(`please ${word} it`)).toBe(true);
    }
  });
});

// ── AG-SAF-11: gate fires on heuristic alone (no safetyDecision) ──────────────

describe('AG-SAF-11 — destructive gate without safetyDecision', () => {
  beforeEach(() => {
    g.__shellLog.length = 0;
    g.__dialogLog.length = 0;
  });

  /**
   * Anthropic provider → toolCall runner containing the AG-SAF-11 gate.
   * chat(): 1st = plan (maxTokens 512), 2nd = destructive action turn, 3rd =
   * done. No safetyDecision is ever set — the heuristic must trigger alone.
   */
  function makeClient(content: string, toolCalls: any[]): AIClient {
    let actionTurn = false;
    const chat = vi.fn().mockImplementation(async (req: any) => {
      if (req.maxTokens === 512) return { content: '1. plan step' }; // plan call
      if (!actionTurn) {
        actionTurn = true;
        return { content, toolCalls };
      }
      return { content: 'Task finished.', toolCalls: [] };
    });
    return {
      provider: 'anthropic',
      model: 'claude-test',
      chat,
    } as unknown as AIClient;
  }

  it('shows the confirmation dialog when action text is destructive and no safetyDecision exists', async () => {
    const tool = createComputerUseTool(makeClient('Deleting the files now — will delete all files.', [
      { id: 'tc1', name: 'computer_use', arguments: { action: 'left_click', coordinate: [10, 10] } },
    ]));

    await tool.execute({ task: 'click the button' }, () => {}, undefined, 't3');
    expect(g.__dialogLog.length).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('denies by default when the dialog throws (fail-closed)', async () => {
    const originalDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async () => { throw new Error('no renderer'); };
    try {
      const tool = createComputerUseTool(makeClient('I will delete the folder.', [
        { id: 'tc1', name: 'computer_use', arguments: { action: 'left_click', coordinate: [10, 10] } },
      ]));

      // Tool must still complete — denial marks the actions as error, not crash.
      const result = await tool.execute({ task: 'click start' }, () => {}, undefined, 't4');
      expect(result).toBeTruthy();
      expect((result as any).output).toBeTruthy();
    } finally {
      electronStub.dialog.showMessageBox = originalDialog;
    }
  }, 60000);

  it('does not show the dialog for benign action text', async () => {
    const tool = createComputerUseTool(makeClient('Clicking the icon.', [
      { id: 'tc1', name: 'computer_use', arguments: { action: 'left_click', coordinate: [10, 10] } },
    ]));

    await tool.execute({ task: 'open the app' }, () => {}, undefined, 't5');
    expect(g.__dialogLog.length).toBe(0);
  }, 60000);
});

// ── AG-SAF-11: dispatchAll (text-action path) also gated ───────────────────────

describe('AG-SAF-11 — dispatchAll destructive gate', () => {
  beforeEach(() => {
    g.__robotLog.length = 0;
    g.__dialogLog.length = 0;
  });

  /**
   * Ollama provider → Dumb-Agent text loop. The model emits Thought/Action
   * text; destructive action lines must trigger the confirmation dialog via
   * dispatchAll's confirmDestructive before any hardware call runs.
   */
  function makeTextClient(modelOutput: string): AIClient {
    let emitted = false;
    const chat = vi.fn().mockImplementation(async () => {
      if (emitted) return { content: 'done', toolCalls: [] };
      emitted = true;
      return { content: modelOutput, toolCalls: [] };
    });
    return { provider: 'ollama', model: 'test-vlm', chat } as unknown as AIClient;
  }

  it('prompts before dispatching a destructive text action and skips it when denied', async () => {
    const originalDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async (opts: any) => {
      g.__dialogLog.push(opts);
      return { response: 1 }; // Deny
    };
    try {
      // type("...") is a valid structured action; the destructive verb lives in
      // the action text itself, so dispatchAll's gate must fire on it.
      const tool = createComputerUseTool(makeTextClient(
        'Thought: cleaning up\nAction: type("run the uninstall command")'
      ));

      await tool.execute({ task: 'clean up the folder' }, () => {}, undefined, 't6');
      // The destructive text triggered the gate…
      expect(g.__dialogLog.length).toBeGreaterThanOrEqual(1);
      // …and, denied, no typing was dispatched to the robot layer.
      expect(robotCalls('typeString').length).toBe(0);
    } finally {
      electronStub.dialog.showMessageBox = originalDialog;
    }
  }, 60000);
});
