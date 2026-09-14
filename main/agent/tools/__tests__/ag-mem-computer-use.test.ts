/**
 * AG-MEM-01..04 memory-leak regression tests for computer-use.ts
 *
 * AG-MEM-01: captureScreen() must reuse a lazy singleton ComputerUseTool
 *            (no per-call overlay BrowserWindow leak).
 * AG-MEM-02: live tool overlays are tracked and destroyAllComputerUseOverlays()
 *            reaps them; hide paths are null-safe.
 * AG-MEM-03: agent message history elides stale screenshot data-URLs and is
 *            bounded by trimMessages.
 * AG-MEM-04: pruneScreenshotDir caps the on-disk screenshot directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents = { send: vi.fn() };
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setContentProtection = vi.fn();
    loadURL = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
  }
  return {
    screen: {
      getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }]),
      getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 })),
    },
    desktopCapturer: {
      getSources: vi.fn().mockResolvedValue([]),
    },
    BrowserWindow: FakeBrowserWindow,
  };
});

vi.mock('@jitsi/robotjs', () => ({
  moveMouse: vi.fn(),
  mouseClick: vi.fn(),
  typeString: vi.fn(),
  keyTap: vi.fn(),
  setMouseDelay: vi.fn(),
  getMousePos: vi.fn(() => ({ x: 0, y: 0 })),
}));

vi.mock('sharp', () => {
  const sharpMock: any = vi.fn().mockReturnValue({
    composite: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
  });
  return { default: sharpMock };
});

import {
  getSharedCaptureTool,
  shutdownComputerUseCapture,
  destroyAllComputerUseOverlays,
  pruneScreenshotDir,
  ComputerUseAgent,
} from '../computer-use';

describe('AG-MEM-01: shared capture tool singleton', () => {
  beforeEach(() => {
    shutdownComputerUseCapture();
  });
  afterEach(() => {
    shutdownComputerUseCapture();
  });

  it('returns the same instance on repeated calls', () => {
    const a = getSharedCaptureTool();
    const b = getSharedCaptureTool();
    expect(a).toBe(b);
  });

  it('returns a NEW instance after shutdownComputerUseCapture()', () => {
    const a = getSharedCaptureTool();
    shutdownComputerUseCapture();
    const b = getSharedCaptureTool();
    expect(b).not.toBe(a);
  });

  it('shutdownComputerUseCapture is idempotent (safe to call twice)', () => {
    expect(() => {
      shutdownComputerUseCapture();
      shutdownComputerUseCapture();
    }).not.toThrow();
  });
});

describe('AG-MEM-02: destroyAllComputerUseOverlays', () => {
  afterEach(() => {
    destroyAllComputerUseOverlays();
    shutdownComputerUseCapture();
  });

  it('is safe when no overlays exist', () => {
    expect(() => destroyAllComputerUseOverlays()).not.toThrow();
  });

  it('reaps overlays created via the shared tool, then is a no-op again', () => {
    const tool = getSharedCaptureTool();
    // The shared tool was registered in the live set on construction.
    destroyAllComputerUseOverlays();
    // cleanup() removed it from the set — a second sweep has nothing to do.
    expect(() => destroyAllComputerUseOverlays()).not.toThrow();
    // Overlay was destroyed, so the tracked slot is gone.
    expect((tool as any).overlay).toBe(null);
    // The singleton itself survives until shutdown (design: idle timer owns it),
    // but its overlay must be gone.
    expect(getSharedCaptureTool()).toBe(tool);
  });
});

describe('AG-MEM-03: message history bounding (elideStaleScreenshots + trimMessages)', () => {
  function makeAgent(): ComputerUseAgent {
    const fakeClient = { provider: 'test', model: 'm', chat: vi.fn() } as any;
    const fakeTool = {
      overlay: null,
      captureObservation: vi.fn(),
      call: vi.fn(),
    } as any;
    // constructor(client, tool, model, task, temperature, maxTurns, historyWindow, toolCallId)
    return new ComputerUseAgent(fakeClient, fakeTool, 'test-model', 'test task', 0, 200, 12, 'tc-mem');
  }

  it('elides stale screenshot payloads older than the recent window', () => {
    const agent = makeAgent();
    const msgs: any[] = (agent as any).messages;
    const dataUrl = 'data:image/png;base64,AAAA';
    // baseCount is 1 (system message). Push 10 dynamic messages with screenshots.
    for (let i = 0; i < 10; i++) {
      msgs.push({
        role: 'user',
        content: [
          { type: 'text', text: `step ${i}` },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      });
    }
    (agent as any).elideStaleScreenshots();

    const lastIdx = msgs.length - 1;
    for (let i = 1; i < msgs.length; i++) {
      const imgParts = msgs[i].content.filter((c: any) => c.type === 'image_url');
      if (i >= msgs.length - 4) {
        // kept window: last 4 messages keep their images
        expect(imgParts.length).toBe(1);
      } else {
        expect(imgParts.length).toBe(0);
        expect(msgs[i].content.some((c: any) => c.type === 'text' && c.text === '[screenshot elided]')).toBe(true);
      }
    }
    // last message untouched
    expect(msgs[lastIdx].content[1].image_url.url).toBe(dataUrl);
  });

  it('elideStaleScreenshots leaves non-image content untouched', () => {
    const agent = makeAgent();
    const msgs: any[] = (agent as any).messages;
    msgs.push({
      role: 'user',
      content: [
        { type: 'text', text: 'only text' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } }, // not a data: URL
      ],
    });
    (agent as any).elideStaleScreenshots();
    const m = msgs[1];
    expect(m.content[0].text).toBe('only text');
    expect(m.content[1].image_url.url).toBe('https://example.com/img.png');
  });

  it('trimMessages(true) bounds dynamic history to historyWindow*2', () => {
    const agent = makeAgent();
    const msgs: any[] = (agent as any).messages;
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: 'user',
        content: [
          { type: 'text', text: `step ${i}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${i}` } },
        ],
      });
    }
    (agent as any).trimMessages(true);
    // trimMessages reassigns this.messages — read the fresh array.
    const trimmed: any[] = (agent as any).messages;
    // historyWindow=12 → max dynamic = 24, plus base system message
    expect(trimmed.length).toBe(1 + 24);
    // Elision ran before slicing: the earliest surviving dynamic message is old
    // enough to have been elided, the last keeps its image.
    const firstDynamic = trimmed[1];
    const last = trimmed[trimmed.length - 1];
    expect(firstDynamic.content.some((c: any) => c.type === 'image_url')).toBe(false);
    expect(last.content.some((c: any) => c.type === 'image_url')).toBe(true);
  });

  it('trimMessages() without force does nothing when under the cap', () => {
    const agent = makeAgent();
    const msgs: any[] = (agent as any).messages;
    msgs.push({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
    (agent as any).trimMessages();
    expect(msgs.length).toBe(2);
  });
});

describe('AG-MEM-04: pruneScreenshotDir bounds on-disk screenshots', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-mem-prune-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps only the newest maxFiles .png files', async () => {
    const total = 505;
    for (let i = 0; i < total; i++) {
      const f = path.join(dir, `shot-${String(i).padStart(4, '0')}.png`);
      fs.writeFileSync(f, 'x');
      // Stagger mtimes oldest → newest by index.
      const t = new Date(Date.now() - (total - i) * 1000);
      fs.utimesSync(f, t, t);
    }
    // A non-png file must be left alone.
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');

    await pruneScreenshotDir(dir, 500);

    const remaining = fs.readdirSync(dir).filter(n => n.endsWith('.png'));
    expect(remaining.length).toBe(500);
    // Oldest file gone, newest kept.
    expect(remaining.includes('shot-0000.png')).toBe(false);
    expect(remaining.includes('shot-0504.png')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true);
  });

  it('is a no-op when at or under the cap', async () => {
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dir, `shot-${i}.png`), 'x');
    }
    await expect(pruneScreenshotDir(dir, 500)).resolves.toBeUndefined();
    expect(fs.readdirSync(dir).length).toBe(3);
  });
});
