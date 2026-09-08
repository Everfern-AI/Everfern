/**
 * AG-SAF-10 — silent Tesseract installer download+install hardening tests.
 *
 * - Consent gate: silent auto-provision (provisionTesseractSilently) may only
 *   download/spawn after consent — injectable handler, remembered flag, or
 *   native dialog; with neither handler nor Electron available it must
 *   DENY (fail-closed).
 * - Checksum gate: the installer is only spawned when a pinned SHA-256 is
 *   present AND matches the downloaded bytes (streaming crypto hash). Empty
 *   pin or mismatch → refuse to spawn.
 * - Redirect hardening: the download follows only https: redirects, max 5
 *   hops, rejecting every other protocol.
 *
 * Mocking notes:
 * - child_process/https are mocked with vi.mock (vitest's ESM layer), so the
 *   module under test never touches the real network or spawns real
 *   processes.
 * - electron is loaded by ocr.ts via a runtime require() inside the dialog
 *   helper; vi.mock cannot intercept that in the node env, so we patch
 *   Module._load BEFORE importing the module under test (pattern from
 *   computer-use-safety.test.ts) and restore it in afterAll.
 * - os.homedir() honors $HOME on POSIX, so each test points HOME at a temp
 *   fixture dir: the win32-only probe logic never reads the real ~/.everfern
 *   and nothing is ever downloaded.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

// ── vi.mock: child_process + https (intercepted for the SUT's ESM imports) ──

const g: any = globalThis;
g.__ocrSpawnLog = [];
g.__ocrHttpsLog = [];
g.__ocrHttpsHandler = null;

vi.mock('child_process', () => ({
  spawn: (...a: any[]) => {
    g.__ocrSpawnLog.push(a);
    return { unref: () => {}, on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } };
  },
}));

vi.mock('https', () => ({
  get: (url: string, _opts: any, cb: any) => {
    g.__ocrHttpsLog.push(url);
    const handler = g.__ocrHttpsHandler as ((url: string) => { statusCode: number; headers: any; body: Buffer }) | null;
    if (!handler) {
      const ee: any = new (require('events').EventEmitter)();
      setTimeout(() => ee.emit('error', new Error('network disabled in tests')), 0);
      ee.resume = () => {};
      cb(ee);
      return ee;
    }
    const res = handler(url);
    const ee: any = new (require('events').EventEmitter)();
    ee.statusCode = res.statusCode;
    ee.headers = res.headers;
    ee.pipe = (w: any) => { w.write(res.body); w.end(); };
    ee.resume = () => {};
    cb(ee);
    setTimeout(() => ee.emit('end'), 0);
    return ee;
  },
}));

// ── Module._load patch (runtime require('electron') interception) ───────────

const electronStub = {
  dialog: {
    showMessageBox: async (_win: any, _opts: any) => ({ response: 1, checkboxChecked: false }),
  },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false }],
  },
};

const NodeModule = require('module');
const origLoad = NodeModule._load;
NodeModule._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

afterAll(() => {
  NodeModule._load = origLoad;
});

// ── Import module under test (after the mocks) ──────────────────────────────

const ocr = await import('../ocr');
const {
  provisionTesseractSilently,
  setOcrConsentHandler,
  isSafeRedirect,
  readOcrConsentFlag,
  TESSERACT_SETUP_URL,
}: any = ocr;

// ── Temp HOME fixture ───────────────────────────────────────────────────────

let fixtureHome: string | null = null;
const realHomeEnv: string | undefined = process.env.HOME;

beforeEach(() => {
  g.__ocrSpawnLog = [];
  g.__ocrHttpsLog = [];
  g.__ocrHttpsHandler = null;
  setOcrConsentHandler(undefined);
  fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-ocr-safety-'));
  // os.homedir() on POSIX resolves $HOME first, so pointing HOME at the
  // fixture isolates every ~/.everfern write without touching the real home.
  process.env.HOME = fixtureHome;
});

afterEach(() => {
  if (realHomeEnv !== undefined) process.env.HOME = realHomeEnv;
  if (fixtureHome) {
    try { fs.rmSync(fixtureHome, { recursive: true, force: true }); } catch { /* ignore */ }
    fixtureHome = null;
  }
});

function setupPath(): string {
  return path.join(fixtureHome!, '.everfern', 'tesseract-setup.exe');
}

function writeInstaller(bytes: Buffer): string {
  const p = setupPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function expectNoSpawn(): void {
  expect(g.__ocrSpawnLog.length).toBe(0);
}

function expectNoDownload(): void {
  expect(g.__ocrHttpsLog.length).toBe(0);
}

// ── AG-SAF-10a: checksum enforcement ────────────────────────────────────────

describe('AG-SAF-10 — checksum enforcement', () => {
  it('consent approved but empty checksum constant → REFUSED, no download, no spawn', async () => {
    setOcrConsentHandler(async () => true);
    const result = await provisionTesseractSilently(setupPath());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SHA-256/i);
    expectNoDownload();
    expectNoSpawn();
  });

  it('consent approved + checksum mismatch → spawn refused, bad file deleted', async () => {
    setOcrConsentHandler(async () => true);
    const bad = writeInstaller(Buffer.from('not the real installer'));
    const result = await provisionTesseractSilently(bad, sha256(Buffer.from('good bytes')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/checksum mismatch/i);
    expectNoDownload();
    expectNoSpawn();
    expect(fs.existsSync(bad)).toBe(false);
  });

  it('consent approved + checksum match → spawns silent installer detached', async () => {
    setOcrConsentHandler(async () => true);
    const bytes = Buffer.from('installer bytes');
    const p = writeInstaller(bytes);
    const result = await provisionTesseractSilently(p, sha256(bytes));
    expect(result.ok).toBe(true);
    expect(g.__ocrSpawnLog.length).toBe(1);
    const [cmd, args, opts] = g.__ocrSpawnLog[0];
    expect(cmd).toBe(p);
    expect(args).toEqual(['/VERYSILENT', '/NORESTART']);
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');
  });

  it('uppercase pinned checksum still matches (hex compare case-insensitive)', async () => {
    setOcrConsentHandler(async () => true);
    const bytes = Buffer.from('installer bytes');
    const p = writeInstaller(bytes);
    const result = await provisionTesseractSilently(p, sha256(bytes).toUpperCase());
    expect(result.ok).toBe(true);
    expect(g.__ocrSpawnLog.length).toBe(1);
  });

  it('downloads via mocked https when file missing, then verifies+spawns', async () => {
    setOcrConsentHandler(async () => true);
    const bytes = Buffer.from('downloaded installer');
    g.__ocrHttpsHandler = () => ({ statusCode: 200, headers: {}, body: bytes });
    const result = await provisionTesseractSilently(setupPath(), sha256(bytes));
    expect(result.ok).toBe(true);
    expect(g.__ocrHttpsLog.length).toBe(1);
    expect(g.__ocrHttpsLog[0]).toBe(TESSERACT_SETUP_URL);
    expect(g.__ocrSpawnLog.length).toBe(1);
  });

  it('download failure is reported and never spawns', async () => {
    setOcrConsentHandler(async () => true);
    g.__ocrHttpsHandler = null; // network error path
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/download failed/i);
    expectNoSpawn();
  });
});

// ── AG-SAF-10b: consent gate ─────────────────────────────────────────────────

describe('AG-SAF-10 — consent gate', () => {
  it('no consent handler + no remembered flag + dialog unavailable (non-Electron) → DENIED, no download, no spawn', async () => {
    // Make the lazy require('electron') throw, simulating a non-Electron env.
    const realLoad = NodeModule._load;
    NodeModule._load = function (request: string, parent: any, isMain: boolean) {
      if (request === 'electron') throw new Error('electron unavailable');
      return realLoad.apply(this, arguments);
    };
    try {
      const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not approved/i);
      expectNoDownload();
      expectNoSpawn();
    } finally {
      NodeModule._load = realLoad;
    }
  });

  it('consent handler returns false → no download', async () => {
    setOcrConsentHandler(async () => false);
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not approved/i);
    expectNoDownload();
    expectNoSpawn();
  });

  it('consent handler throws → fail-closed deny', async () => {
    setOcrConsentHandler(async () => { throw new Error('handler blew up'); });
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expectNoDownload();
    expectNoSpawn();
  });

  it('remembered-allow flag skips the dialog and proceeds', async () => {
    const flagDir = path.join(fixtureHome!, '.everfern');
    fs.mkdirSync(flagDir, { recursive: true });
    fs.writeFileSync(path.join(flagDir, 'ocr-install-consent.json'), JSON.stringify({ allowSilent: true }));
    const bytes = Buffer.from('installer bytes');
    const p = writeInstaller(bytes);
    const result = await provisionTesseractSilently(p, sha256(bytes));
    expect(result.ok).toBe(true);
    expect(g.__ocrSpawnLog.length).toBe(1);
  });

  it('remembered-deny flag skips the dialog and denies', async () => {
    const flagDir = path.join(fixtureHome!, '.everfern');
    fs.mkdirSync(flagDir, { recursive: true });
    fs.writeFileSync(path.join(flagDir, 'ocr-install-consent.json'), JSON.stringify({ allowSilent: false }));
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not approved/i);
    expectNoDownload();
    expectNoSpawn();
  });

  it('dialog approve (response 0) without remember → proceeds this time, nothing persisted', async () => {
    const realDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    try {
      const bytes = Buffer.from('installer bytes');
      const p = writeInstaller(bytes);
      const result = await provisionTesseractSilently(p, sha256(bytes));
      expect(result.ok).toBe(true);
      expect(g.__ocrSpawnLog.length).toBe(1);
      expect(readOcrConsentFlag()).toBe(null);
    } finally {
      electronStub.dialog.showMessageBox = realDialog;
    }
  });

  it('dialog decline (response 1) → deny', async () => {
    const realDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    try {
      const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
      expect(result.ok).toBe(false);
      expectNoDownload();
      expectNoSpawn();
    } finally {
      electronStub.dialog.showMessageBox = realDialog;
    }
  });

  it('dialog approve with remember → allowSilent=true persisted', async () => {
    const realDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: true });
    try {
      const bytes = Buffer.from('installer bytes');
      const p = writeInstaller(bytes);
      const result = await provisionTesseractSilently(p, sha256(bytes));
      expect(result.ok).toBe(true);
      expect(readOcrConsentFlag()).toEqual({ allowSilent: true });
    } finally {
      electronStub.dialog.showMessageBox = realDialog;
    }
  });

  it('dialog decline with remember → allowSilent=false persisted', async () => {
    const realDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
    try {
      const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
      expect(result.ok).toBe(false);
      expect(readOcrConsentFlag()).toEqual({ allowSilent: false });
      expectNoSpawn();
    } finally {
      electronStub.dialog.showMessageBox = realDialog;
    }
  });

  it('dialog shows a warning-type consent message with Cancel as default', async () => {
    const seen: any[] = [];
    const realDialog = electronStub.dialog.showMessageBox;
    electronStub.dialog.showMessageBox = async (_win: any, opts: any) => {
      seen.push(opts);
      return { response: 1, checkboxChecked: false };
    };
    try {
      await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
      expect(seen.length).toBe(1);
      const opts = seen[0];
      expect(opts.type).toBe('warning');
      expect(opts.title).toBe('EverFern — OCR Setup');
      expect(opts.buttons).toEqual(['Install', 'Cancel']);
      expect(opts.defaultId).toBe(1);
      expect(opts.cancelId).toBe(1);
      expect(opts.noLink).toBe(true);
      expect(opts.checkboxLabel).toMatch(/remember my choice/i);
      expect(opts.message + ' ' + (opts.detail || '')).toMatch(/tesseract-ocr\/tesseract\/releases/);
    } finally {
      electronStub.dialog.showMessageBox = realDialog;
    }
  });

  it('consent request carries the pinned URL and checksum', async () => {
    const seen: any[] = [];
    setOcrConsentHandler(async (req: any) => {
      seen.push(req);
      return false;
    });
    await provisionTesseractSilently(setupPath(), 'abc123');
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe(TESSERACT_SETUP_URL);
    expect(seen[0].url).toMatch(/^https:/);
    expect(seen[0].expectedSha256).toBe('abc123');
  });
});

// ── AG-SAF-10d: redirect hardening ──────────────────────────────────────────

describe('AG-SAF-10 — isSafeRedirect', () => {
  it('accepts https: redirect locations', () => {
    expect(isSafeRedirect('https://objects.githubusercontent.com/whatever')).toBe(true);
  });

  it('rejects http:, javascript:, file:, ftp:, data: and garbage', () => {
    expect(isSafeRedirect('http://evil.example.com')).toBe(false);
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirect('file:///etc/passwd')).toBe(false);
    expect(isSafeRedirect('ftp://mirror.example.com')).toBe(false);
    expect(isSafeRedirect('data:text/html,hello')).toBe(false);
    expect(isSafeRedirect('not a url')).toBe(false);
    expect(isSafeRedirect('')).toBe(false);
  });

  it('download aborts on an http:// redirect', async () => {
    setOcrConsentHandler(async () => true);
    g.__ocrHttpsHandler = () => ({
      statusCode: 302,
      headers: { location: 'http://evil.example.com/setup.exe' },
      body: Buffer.alloc(0),
    });
    const pinned = sha256(Buffer.from('x'));
    const result = await provisionTesseractSilently(setupPath(), pinned);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/download failed/i);
    expect(result.message).toMatch(/unsafe redirect/i);
    expectNoSpawn();
  });

  it('download aborts on a javascript: redirect', async () => {
    setOcrConsentHandler(async () => true);
    g.__ocrHttpsHandler = () => ({
      statusCode: 302,
      headers: { location: 'javascript:alert(1)' },
      body: Buffer.alloc(0),
    });
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unsafe redirect/i);
    expectNoSpawn();
  });

  it('download follows https: redirects but caps hops at 5', async () => {
    setOcrConsentHandler(async () => true);
    let hop = 0;
    g.__ocrHttpsHandler = () => {
      hop++;
      if (hop <= 6) {
        return { statusCode: 302, headers: { location: `https://example.test/hop${hop}` }, body: Buffer.alloc(0) };
      }
      return { statusCode: 200, headers: {}, body: Buffer.from('never reached') };
    };
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/too many redirects/i);
    // 1 initial + 5 followed hops = 6 requests, the 7th never starts.
    expect(g.__ocrHttpsLog.length).toBe(6);
    expectNoSpawn();
  });

  it('successful redirect chain: https hop then verified body spawns', async () => {
    setOcrConsentHandler(async () => true);
    const bytes = Buffer.from('redirected installer');
    let hop = 0;
    g.__ocrHttpsHandler = () => {
      hop++;
      if (hop === 1) return { statusCode: 302, headers: { location: 'https://objects.example.test/setup.exe' }, body: Buffer.alloc(0) };
      return { statusCode: 200, headers: {}, body: bytes };
    };
    const result = await provisionTesseractSilently(setupPath(), sha256(bytes));
    expect(result.ok).toBe(true);
    expect(g.__ocrHttpsLog.length).toBe(2);
    expect(g.__ocrHttpsLog[1]).toBe('https://objects.example.test/setup.exe');
    expect(g.__ocrSpawnLog.length).toBe(1);
  });

  it('rejects non-200 non-redirect statuses', async () => {
    setOcrConsentHandler(async () => true);
    g.__ocrHttpsHandler = () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) });
    const result = await provisionTesseractSilently(setupPath(), sha256(Buffer.from('x')));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/HTTP 404/);
    expectNoSpawn();
  });
});

// ── Regression guards on the source ────────────────────────────────────────

describe('AG-SAF-10 — source-level regression guards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ocr.ts'), 'utf-8');

  it('pins the checksum constant next to the URL', () => {
    expect(source).toContain('TESSERACT_SETUP_SHA256');
    expect(source).toContain('TESSERACT_SETUP_URL');
    expect(source).toMatch(/crypto\.createHash\('sha256'\)/);
  });

  it('fail-closed default: empty pin blocks the installer', () => {
    expect(ocr.TESSERACT_SETUP_SHA256).toBe('');
  });

  it('still spawns silently with the same argv when fully allowed', () => {
    expect(source).toContain("spawn(setupPath, ['/VERYSILENT', '/NORESTART'], { detached: true, stdio: 'ignore' })");
  });
});
