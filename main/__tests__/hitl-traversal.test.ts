/**
 * MP-SEC-13 — HITL storage path traversal.
 *
 * The hitl:resolve IPC handler persists renderer-supplied
 * conversationId/requestId under ~/.everfern/hitl/<conversationId>/. Both ids
 * must be constrained to a single safe path segment; ../../x payloads must be
 * rejected before any file is created.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { registerHistoryHandlers } from '../ipc/history';
import {
  saveHitlRequest,
  saveHitlResponse,
  getHitlRecord,
  HitlRequest,
  HitlResponse,
} from '../store/hitl';
import { ipcMain } from 'electron';

type Handler = (...args: any[]) => any;
const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as Handler;
}

// HERMETIC HOME (vi.mock('os') — same pattern as path-guard.test.ts /
// secret-redaction.test.ts): os.homedir() resolves to a throwaway fixture for
// EVERY module (this file, store/hitl, ipc/history). Previous assignment-based
// patching raced with async handlers and wrote conv-1/req-1.json into the
// developer's REAL ~/.everfern/hitl — never again.
const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-hitl-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

let hitlResolve: Handler;

beforeEach(() => {
  handleMock.mockClear();
  registerHistoryHandlers({} as any);
  hitlResolve = getHandler('hitl:resolve');
});

afterAll(() => {
  if (fixtureHome.home) fs.rmSync(fixtureHome.home, { recursive: true, force: true });
});

describe('hitl:resolve traversal rejection', () => {
  it('rejects a traversal conversationId (../../x)', async () => {
    const res = await hitlResolve(null, '../../evil', 'req-1', true);
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/Unsafe conversationId/);
    // No directory may be created outside the sandbox root.
    expect(fs.existsSync(path.join(fixtureHome.home!, 'evil'))).toBe(false);
  });

  it('rejects a traversal requestId in the filename', async () => {
    const res = await hitlResolve(null, 'conv-1', '../../../outside/evil', true);
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/Unsafe requestId/);
    expect(fs.existsSync(path.join(fixtureHome.home!, 'outside'))).toBe(false);
  });

  it('accepts a safe id pair and writes inside the sandbox', async () => {
    const res = await hitlResolve(null, 'conv-1', 'req-1', true);
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(fixtureHome.home!, '.everfern', 'hitl', 'conv-1', 'req-1.json'))).toBe(true);
  });

  it('rejects absolute-path ids', async () => {
    const res = await hitlResolve(null, '/etc/passwd', 'req-1', true);
    expect(res.success).toBe(false);
  });

  it('rejects empty conversationId', async () => {
    const res = await hitlResolve(null, '', 'req-1', true);
    expect(res.success).toBe(false);
  });
});

describe('hitl store direct traversal rejection', () => {
  it('saveHitlRequest swallows traversal ids without writing', () => {
    const req: HitlRequest = {
      id: '..',
      conversationId: '../../evil',
      timestamp: new Date().toISOString(),
      question: 'q',
      details: { tools: [], summary: '', reasoning: '' },
      options: [],
    };
    saveHitlRequest(req);
    expect(fs.existsSync(path.join(fixtureHome.home!, 'evil'))).toBe(false);
  });

  it('getHitlRecord returns null for traversal ids without touching disk', () => {
    const rec = getHitlRecord('../../etc', 'passwd');
    expect(rec).toBeNull();
    expect(fs.existsSync(path.join(fixtureHome.home!, 'etc'))).toBe(false);
  });

  it('saveHitlResponse with traversal requestId writes nothing', () => {
    const res: HitlResponse = {
      id: 'resp-1',
      requestId: '../../../evil/req',
      conversationId: 'conv-1',
      timestamp: new Date().toISOString(),
      approved: true,
      response: '[HITL_APPROVED]',
    };
    saveHitlResponse(res);
    expect(fs.existsSync(path.join(fixtureHome.home!, 'evil'))).toBe(false);
  });
});
