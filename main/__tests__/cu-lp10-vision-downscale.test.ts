// @vitest-environment node

/**
 * LP-10 (audit §X.C LP-09): local-VLM screenshot downscale.
 *
 * - shouldDownscaleForVlm: provider→bool decision helper delegating to
 *   AIClient.isLocal() — local true, cloud false, never a reimplemented
 *   heuristic.
 * - attachScreenshot encode path: local client → sharp resize(1024,1024,
 *   fit inside, no upscale) + jpeg q70 before base64, and lastViewport
 *   image_width/height track the DOWNSCALED dims while raw_/display_ keep
 *   display truth (absoluteXy correctness). Cloud client → full-res webp
 *   path untouched.
 *
 * Mocking note: computer-use.ts loads sharp via runtime CJS require(), so we
 * patch Module._load BEFORE the dynamic import (same pattern as
 * computer-use-safety.test.ts). The sharp stub records the options the
 * pipeline passed and returns downscaled dims for the resize branch.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const g: any = globalThis;
g.__sharpCalls = [] as any[];
g.__robotLog = [];

// ── Module._load patch (runtime require() interception) ──────────────────────

const NodeModule = require('module');
const origLoad = NodeModule._load;

const electronStub = {
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 2 }],
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 2 }),
  },
  // 3840×2160 PNG (physical pixels) — the header reader gets dims from the
  // buffer itself, so getSources returns a real PNG header at 3840×2160.
  desktopCapturer: {
    getSources: async () => [{
      thumbnail: { toPNG: () => makePngHeader(3840, 2160) },
    }],
  },
  shell: { openExternal: async () => {} },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  BrowserWindow: { getAllWindows: () => [] },
};

const robotStub = {
  setMouseDelay: () => {},
  moveMouse: (...a: any[]) => { g.__robotLog.push(['moveMouse', ...a]); },
  mouseToggle: () => {},
  keyToggle: () => {},
  keyTap: () => {},
  typeString: () => {},
  dragMouse: () => {},
  getMousePos: () => ({ x: 960, y: 540 }),
};

/** Minimal valid PNG header (IHDR) so pngDimensions() reads 3840×2160. */
function makePngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.write('\u0089PNG\r\n\u001a\n', 0, 'binary');   // signature (8 bytes)
  buf.writeUInt32BE(width, 16);                     // IHDR width @ offset 16
  buf.writeUInt32BE(height, 20);                    // IHDR height @ offset 20
  return buf;
}

/** sharp stub: records calls; the resize+jpeg branch yields downscaled dims. */
function makeSharpStub() {
  return function sharpStub(_input: any) {
    const state: any = {
      composite: vi.fn(() => state),
      resize: vi.fn((w: number, h: number, opts: any) => {
        g.__sharpCalls.push({ op: 'resize', w, h, opts });
        state.__resize = { w, h, opts };
        return state;
      }),
      webp: vi.fn((opts: any) => { g.__sharpCalls.push({ op: 'webp', opts }); return state; }),
      jpeg: vi.fn((opts: any) => { g.__sharpCalls.push({ op: 'jpeg', opts }); return state; }),
      toBuffer: vi.fn(async (arg?: any) => {
        // DOWNSCALED branch: report the resize target dims (fit inside →
        // 3840×2160 → 1024×576); full-res branch: raw dims.
        if (state.__resize) {
          const outW = 1024, outH = 576; // 16:9 fit inside 1024×1024
          g.__sharpCalls.push({ op: 'toBuffer', resolveWithObject: Boolean(arg?.resolveWithObject) });
          return arg?.resolveWithObject
            ? { data: Buffer.from('downscaled-jpeg-bytes'), info: { width: outW, height: outH } }
            : Buffer.from('downscaled-jpeg-bytes');
        }
        return Buffer.from('fullres-webp-bytes');
      }),
    };
    return state;
  };
}

let sharpAvailable: any = null;
NodeModule._load = function (request: string, parent: any, isMain: boolean) {
  if (request === '@jitsi/robotjs') return robotStub;
  if (request === 'electron') return electronStub;
  if (request === 'sharp') return sharpAvailable ?? origLoad.apply(this, arguments);
  return origLoad.apply(this, arguments);
};

// Install the stub BEFORE importing computer-use: the module binds sharp via
// runtime require() at load time, so a beforeEach swap would come too late.
sharpAvailable = makeSharpStub();

afterAll(() => {
  NodeModule._load = origLoad;
});

const { ComputerUseTool, shouldDownscaleForVlm, LOCAL_VLM_MAX_DIM } = await import('../agent/tools/computer-use');
import type { AIClient } from '../lib/ai-client';

function makeLocalClient(): AIClient {
  return { provider: 'ollama', isLocal: () => true, chat: vi.fn() } as unknown as AIClient;
}
function makeCloudClient(): AIClient {
  return { provider: 'openai', isLocal: () => false, chat: vi.fn() } as unknown as AIClient;
}
function makeTool(client: AIClient, dir: string): ComputerUseTool {
  const t = new ComputerUseTool(dir);
  (t as any).client = client;
  return t;
}
const testDir = () => `${process.env.HOME ?? '/tmp'}/.everfern/test-lp10-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('LP-10: shouldDownscaleForVlm decision helper', () => {
  it('local client (isLocal() true) → downscale', () => {
    expect(shouldDownscaleForVlm({ isLocal: () => true } as any)).toBe(true);
  });
  it('cloud client (isLocal() false) → NO downscale (full-res intentional)', () => {
    expect(shouldDownscaleForVlm({ isLocal: () => false, provider: 'openai' } as any)).toBe(false);
  });
  it('null/undefined client → false (never guess)', () => {
    expect(shouldDownscaleForVlm(null)).toBe(false);
    expect(shouldDownscaleForVlm(undefined)).toBe(false);
  });
  it('client without isLocal method → false (signal absent — do not guess)', () => {
    expect(shouldDownscaleForVlm({ provider: 'ollama' } as any)).toBe(false);
  });
  it('LOCAL_VLM_MAX_DIM is 1024', () => {
    expect(LOCAL_VLM_MAX_DIM).toBe(1024);
  });
});

describe('LP-10: attachScreenshot encode path', () => {
  beforeEach(() => {
    g.__sharpCalls = [];
    sharpAvailable = makeSharpStub(); // fresh per-test recorder state
  });
  it('LOCAL VLM: resizes fit-inside 1024, JPEG q70, dims track downscaled payload', async () => {
    const tool = makeTool(makeLocalClient(), testDir());
    const obs = await (tool as any).attachScreenshot({ status: 'observe' });

    // resize called with the audited contract
    const resizeCall = g.__sharpCalls.find(c => c.op === 'resize');
    expect(resizeCall.w).toBe(1024);
    expect(resizeCall.h).toBe(1024);
    expect(resizeCall.opts.fit).toBe('inside');
    expect(resizeCall.opts.withoutEnlargement).toBe(true);

    // JPEG q70 (not webp) on the local path
    const jpegCall = g.__sharpCalls.find(c => c.op === 'jpeg');
    expect(jpegCall.opts.quality).toBe(70);
    expect(g.__sharpCalls.find(c => c.op === 'webp')).toBeUndefined();

    // payload: downscaled data-URL, dims consistent with the encoded image
    expect(obs.screenshot).toContain('data:image/jpeg;base64,');
    expect(obs.screenshot).toContain(Buffer.from('downscaled-jpeg-bytes').toString('base64'));

    // viewport: image_* = DOWNSCALED, raw_/display_ = display truth
    expect(tool.lastViewport.image_width).toBe(1024);
    expect(tool.lastViewport.image_height).toBe(576);
    expect(tool.lastViewport.raw_width).toBe(3840);
    expect(tool.lastViewport.raw_height).toBe(2160);
    expect(tool.lastViewport.display_width).toBe(3840);
    expect(tool.lastViewport.display_height).toBe(2160);
    expect(obs.downscaled_size).toEqual({ width: 1024, height: 576 });
  });

  it('CLOUD VLM: full-res webp path untouched (no resize, q75)', async () => {
    const tool = makeTool(makeCloudClient(), testDir());
    const obs = await (tool as any).attachScreenshot({ status: 'observe' });

    expect(g.__sharpCalls.find(c => c.op === 'resize')).toBeUndefined();
    const webpCall = g.__sharpCalls.find(c => c.op === 'webp');
    expect(webpCall.opts.quality).toBe(75);
    expect(g.__sharpCalls.find(c => c.op === 'jpeg')).toBeUndefined();

    expect(obs.screenshot).toContain('data:image/webp;base64,');
    // all dims equal raw — cloud behavior byte-equivalent to pre-LP-10
    expect(tool.lastViewport.image_width).toBe(3840);
    expect(tool.lastViewport.image_height).toBe(2160);
    expect(tool.lastViewport.raw_width).toBe(3840);
    expect(obs.downscaled_size).toEqual({ width: 3840, height: 2160 });
  });

  it('absoluteXy maps a downscaled-image pixel back to display coords correctly', async () => {
    const tool = makeTool(makeLocalClient(), testDir());
    await (tool as any).attachScreenshot({ status: 'observe' });
    // Center of the 1024×576 image → display center (1920,1080 logical ×
    // scaleFactor 2 → 3840×2160 display space here).
    const [x, y] = (tool as any).absoluteXy([512, 288]);
    expect(x).toBe(1920); // 512 * 3840/1024
    expect(y).toBe(1080); // 288 * 2160/576
  });
});
