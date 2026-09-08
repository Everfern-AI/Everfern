/**
 * MP-SEC-16 — screenshot:load symlink containment.
 *
 * A symlink planted inside ~/.everfern/screenshots that points at a file
 * outside the sandbox must be rejected after realpath resolution, while
 * regular files and legitimate symlinks that stay inside keep working.
 *
 * The handler reads os.homedir(), so tests patch it to a temp root.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// HERMETIC HOME (vi.mock('os') — pattern from path-guard.test.ts): the
// handler resolves the sandbox root via os.homedir() at INVOCATION time, so
// the fixture must stay patched for the whole run. The old registration-time
// patch made passes vacuous (rejects passed for the wrong reason; legit files
// compared against the real home and failed).
const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-shot-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

import { registerProviderModelHandlers } from '../ipc/agent/provider-models';
import { ipcMain } from 'electron';

type Handler = (...args: any[]) => any;
const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as Handler;
}

const tmpRoot = () => fixtureHome.home!;
const screenshotsDir = () => path.join(tmpRoot(), '.everfern', 'screenshots');

let screenshotLoad: Handler;
let insideFile: string;
let escapingLink: string;
let secretFile: string;
let insideLink: string;

beforeAll(() => {
  fs.mkdirSync(screenshotsDir(), { recursive: true });

  // Outside-sandbox secret file.
  secretFile = path.join(tmpRoot(), 'secret-outside.png');
  fs.writeFileSync(secretFile, Buffer.from('TOP SECRET PNG'));

  // Legit file inside the sandbox.
  insideFile = path.join(screenshotsDir(), 'real.png');
  fs.writeFileSync(insideFile, Buffer.from('legit png'));

  // Symlink inside the sandbox pointing OUTSIDE (the escape vector).
  escapingLink = path.join(screenshotsDir(), 'escape.png');
  fs.symlinkSync(secretFile, escapingLink);

  // Symlink inside pointing to another file INSIDE (legitimate).
  insideLink = path.join(screenshotsDir(), 'inside-link.png');
  fs.symlinkSync(insideFile, insideLink);
});

beforeEach(() => {
  handleMock.mockClear();
  registerProviderModelHandlers();
  screenshotLoad = getHandler('screenshot:load');
});

afterAll(() => {
  if (fixtureHome.home) fs.rmSync(fixtureHome.home, { recursive: true, force: true });
});

describe('screenshot:load symlink containment (MP-SEC-16)', () => {
  it('serves a regular file inside the sandbox', async () => {
    const res = await screenshotLoad(null, insideFile);
    expect(res.error).toBeUndefined();
    expect(res.base64).toBe(Buffer.from('legit png').toString('base64'));
  });

  it('rejects a symlink that escapes the screenshots dir', async () => {
    const res = await screenshotLoad(null, escapingLink);
    expect(res.error).toMatch(/outside the screenshots directory/i);
    expect(res.base64).toBeUndefined();
  });

  it('rejects a direct path outside the sandbox', async () => {
    const res = await screenshotLoad(null, secretFile);
    expect(res.error).toMatch(/outside the screenshots directory/i);
  });

  it('allows a symlink whose target stays inside the sandbox', async () => {
    const res = await screenshotLoad(null, insideLink);
    expect(res.error).toBeUndefined();
    expect(res.dataUrl).toContain('data:image/png;base64,');
  });
});
