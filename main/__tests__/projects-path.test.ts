/**
 * MP-SEC-03 — projects:readFile / projects:readFileDataUrl path containment.
 *
 * Exercises the real handler implementations (via the exported
 * registerProjectsHandlers surface) against real temp dirs:
 * - renderer-supplied paths that escape the project root are rejected
 * - symlinked project dirs still resolve to their real location
 * - happy-path reads are unchanged (utf-8 text / base64 data URLs)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../store/projects/projects', () => ({
  projectsStore: {},
}));

import { registerProjectsHandlers } from '../ipc/projects';
import { ipcMain } from 'electron';

type Handler = (...args: any[]) => any;

const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as Handler;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-path-guard-'));
const cleanups: string[] = [];

function makeProject(): { projectPath: string; secretFile: string } {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'project-'));
  cleanups.push(dir);
  const secretDir = fs.mkdtempSync(path.join(tmpRoot, 'secret-'));
  cleanups.push(secretDir);
  const secretFile = path.join(secretDir, 'outside.txt');
  fs.writeFileSync(secretFile, 'TOP SECRET');
  return { projectPath: dir, secretFile };
}

let readFile: Handler;
let readFileDataUrl: Handler;

beforeEach(() => {
  handleMock.mockClear();
  registerProjectsHandlers();
  readFile = getHandler('projects:readFile');
  readFileDataUrl = getHandler('projects:readFileDataUrl');
});

afterAll(() => {
  for (const dir of [...cleanups, tmpRoot]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('projects:readFile containment', () => {
  it('reads files inside the project (happy path preserved)', async () => {
    const { projectPath } = makeProject();
    fs.writeFileSync(path.join(projectPath, 'notes.txt'), 'hello everfern');
    await expect(readFile(null, projectPath, 'notes.txt')).resolves.toBe('hello everfern');
  });

  it('reads files in nested subdirectories of the project', async () => {
    const { projectPath } = makeProject();
    fs.mkdirSync(path.join(projectPath, 'sub'));
    fs.writeFileSync(path.join(projectPath, 'sub', 'a.txt'), 'nested');
    await expect(readFile(null, projectPath, path.join('sub', 'a.txt'))).resolves.toBe('nested');
  });

  it('rejects simple ../ traversal out of the project', async () => {
    const { projectPath, secretFile } = makeProject();
    const rel = path.relative(projectPath, secretFile);
    await expect(readFile(null, projectPath, rel)).resolves.toBeNull();
  });

  it('rejects deep ../ traversal that re-enters the tree lexically but lands outside', async () => {
    const { projectPath, secretFile } = makeProject();
    fs.mkdirSync(path.join(projectPath, 'sub'));
    const rel = path.join('sub', '..', '..', path.basename(path.dirname(secretFile)), 'outside.txt');
    await expect(readFile(null, projectPath, rel)).resolves.toBeNull();
  });

  it('rejects absolute paths outside the project', async () => {
    const { projectPath, secretFile } = makeProject();
    await expect(readFile(null, projectPath, secretFile)).resolves.toBeNull();
  });

  it('rejects the empty/identity path that resolves to the directory itself', async () => {
    const { projectPath } = makeProject();
    // resolves to the root dir → readFileSync EISDIR → null (same as before the fix)
    await expect(readFile(null, projectPath, '.')).resolves.toBeNull();
  });

  it('returns null when the project dir does not exist (realpath throws)', async () => {
    await expect(readFile(null, '/nonexistent/project/dir', 'x.txt')).resolves.toBeNull();
  });

  it('resolves symlinked project dirs via realpath and still contains paths', async () => {
    const { projectPath, secretFile } = makeProject();
    const linkPath = path.join(tmpRoot, `link-${path.basename(projectPath)}`);
    try {
      fs.symlinkSync(projectPath, linkPath);
      cleanups.push(linkPath);
      fs.writeFileSync(path.join(projectPath, 'inside.txt'), 'via symlink');
      await expect(readFile(null, linkPath, 'inside.txt')).resolves.toBe('via symlink');
      await expect(readFile(null, linkPath, secretFile)).resolves.toBeNull();
    } finally {
      try { fs.unlinkSync(linkPath); } catch { /* already cleaned */ }
    }
  });

  it('rejects a symlink FILE inside the project whose target is outside', async () => {
    const { projectPath, secretFile } = makeProject();
    // notes.txt -> <outside secret>: lexical resolution stays contained, but the
    // physical read would leak the target. Must return null, never the content.
    fs.symlinkSync(secretFile, path.join(projectPath, 'notes.txt'));
    await expect(readFile(null, projectPath, 'notes.txt')).resolves.toBeNull();
  });

  it('blocks reads of /etc/passwd through a planted symlink (no content leak)', async () => {
    const { projectPath } = makeProject();
    fs.symlinkSync('/etc/passwd', path.join(projectPath, 'passwd-link.txt'));
    const res = await readFile(null, projectPath, 'passwd-link.txt');
    expect(res).toBeNull();
    expect(String(res)).not.toContain('root:');
    expect(fs.readFileSync('/etc/passwd', 'utf-8').length).toBeGreaterThan(0); // sanity: readable outside
  });
});

describe('projects:readFileDataUrl containment', () => {
  it('builds a base64 data URL for files inside the project (happy path preserved)', async () => {
    const { projectPath } = makeProject();
    fs.writeFileSync(path.join(projectPath, 'img.bin'), Buffer.from([0xff, 0xd8, 0xff]));
    const res = await readFileDataUrl(null, projectPath, 'img.bin');
    expect(res.success).toBe(true);
    expect(res.mimeType).toBe('application/octet-stream');
    expect(res.size).toBe(3);
    expect(res.dataUrl).toBe(`data:application/octet-stream;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`);
  });

  it('rejects traversal escapes with the standard error shape', async () => {
    const { projectPath, secretFile } = makeProject();
    const res = await readFileDataUrl(null, projectPath, path.relative(projectPath, secretFile));
    expect(res).toEqual({ success: false, error: expect.any(String) });
    expect((res as any).dataUrl).toBeUndefined();
  });

  it('rejects absolute paths outside the project', async () => {
    const { projectPath, secretFile } = makeProject();
    const res = await readFileDataUrl(null, projectPath, secretFile);
    expect(res.success).toBe(false);
  });

  it('returns error shape when project dir does not exist', async () => {
    const res = await readFileDataUrl(null, '/nonexistent/project/dir', 'x.png');
    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
  });

  it('symlinked project dir works for inside files, blocks escapes', async () => {
    const { projectPath, secretFile } = makeProject();
    const linkPath = path.join(tmpRoot, `link-b64-${path.basename(projectPath)}`);
    try {
      fs.symlinkSync(projectPath, linkPath);
      fs.writeFileSync(path.join(projectPath, 'ok.png'), Buffer.from([0x89, 0x50]));
      const okRes = await readFileDataUrl(null, linkPath, 'ok.png');
      expect(okRes.success).toBe(true);
      expect(okRes.mimeType).toBe('image/png');
      const badRes = await readFileDataUrl(null, linkPath, secretFile);
      expect(badRes.success).toBe(false);
    } finally {
      try { fs.unlinkSync(linkPath); } catch { /* already cleaned */ }
    }
  });

  it('returns the standard error shape for a symlink FILE escaping via /etc/passwd', async () => {
    const { projectPath } = makeProject();
    fs.symlinkSync('/etc/passwd', path.join(projectPath, 'leak.png'));
    const res = await readFileDataUrl(null, projectPath, 'leak.png');
    expect(res).toEqual({ success: false, error: 'Invalid file path' });
    expect((res as any).dataUrl).toBeUndefined(); // no base64 of /etc content
  });
});
