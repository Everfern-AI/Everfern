/**
 * Workers: persistent store + each worker's own computer (the Linux VM).
 *
 *  workers:list / workers:save / workers:delete  → userData/workers.json ({ version, workers }),
 *                                                  written atomically with a .bak copy
 *  workers:chat-load / workers:chat-save         → userData/worker-chats/<id>.json
 *  workers:vm-status                             → is the worker VM up?
 *  workers:vm-exec (workerId, command)           → run a command as the worker's own Linux user
 *                                                  in its workspace (worker-sandbox.ts)
 *  workers:vm-ls (workerId)                      → list that workspace
 *  workers:browser-state-load / -save (scope)    → the cloud VM browser's cookies, kept on this
 *                                                  computer (encrypted) so every new VM starts signed in
 *  workers:webview-register / -unregister        → a worker's browser window, so its Navis runs drive it
 *  workers:cloudvm-register / -unregister        → a cloud worker's window (its VM's screen), so its Navis
 *                                                  runs drive the VM's browser
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, webContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isWorkerVMAvailable } from '../../agent/tools/linux-vm-executor';
import { workspaceExec, workspaceList, workspaceRead, workspaceWrite, cleanRelPath, routeDownloadsToWorkspace, copyIntoWorkspace, copyOutOfWorkspace, watchWorkspace, unwatchWorkspace, unwatchAllWorkspaces, notifyFilesChanged, workspaceDir, hostScratchDir } from '../../agent/tools/worker-tools';
import { registerWorkerWebview, unregisterWorkerWebview, registerWorkerCloudVm, unregisterWorkerCloudVm, forgetWorkerWindows } from '../../agent/tools/navis/core/webview-registry';
import { registerWorkerLocalVm, unregisterWorkerLocalVm } from '../../agent/tools/navis/core/webview-registry';
import { registerWorkerPtyHandlers, killWorkerPtys, killWorkerPty } from './worker-pty';
import { activeConversationIds, stopConversation } from '../../agent/runner/abort-manager';
import { destroyWorkerVm } from '../../agent/tools/worker-sandbox';

/* ── The worker store ──
 * One JSON file, { version: 1, workers: [...] }. Writes go to a temp file that is renamed
 * over the old one (so a crash never leaves half a file), after copying the old one to
 * .bak. A file that cannot be parsed is kept as .corrupt-<time> and the backup is used;
 * if there is no usable backup the read fails instead of returning "no workers", so the
 * next save cannot overwrite everything. */

const STORE_VERSION = 1;
const MAX_WORKERS = 500;
const storeFile = () => path.join(app.getPath('userData'), 'workers.json');

function parseStore(text: string): any[] | null {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.workers)) return v.workers;
  } catch { /* not JSON */ }
  return null;
}

function readAll(): any[] {
  const file = storeFile();
  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw new Error(`Could not read your workers (${e?.message || e}).`);
  }
  const list = parseStore(text);
  if (list) return list.filter((w) => w && typeof w === 'object' && safeId(w.id));
  const kept = `${file}.corrupt-${Date.now()}`;
  try { fs.copyFileSync(file, kept); } catch { /* still try the backup */ }
  try {
    const bak = parseStore(fs.readFileSync(`${file}.bak`, 'utf-8'));
    if (bak) {
      console.warn(`[Workers] workers.json was damaged; kept it as ${path.basename(kept)} and restored the backup.`);
      writeAll(bak);
      return bak;
    }
  } catch { /* no backup */ }
  throw new Error(`Your workers file is damaged and no backup could be read. It was kept as ${path.basename(kept)} so nothing is lost.`);
}

function writeAll(list: any[]) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, workers: list }, null, 2), 'utf-8');
  try { if (parseStore(fs.readFileSync(file, 'utf-8'))) fs.copyFileSync(file, `${file}.bak`); } catch { /* first save */ }
  fs.renameSync(tmp, file);
}

/** For the scheduler (worker-scheduler.ts), which claims runs in the same store. */
export { readAll as readWorkers, writeAll as writeWorkers };

/** Worker ids are UUIDs (or timestamps); anything else is rejected before it reaches a shell. */
const safeId = (id: unknown) => (typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const isoDate = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined);

function cleanSchedule(v: any) {
  if (!v || typeof v !== 'object' || !['weekdays', 'daily', 'hourly', 'once'].includes(v.kind)) return undefined;
  const nextRun = isoDate(v.nextRun);
  if (!nextRun) return undefined;
  const int = (n: unknown, lo: number, hi: number) => (Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi ? (n as number) : undefined);
  return {
    kind: v.kind, label: str(v.label, 80) ?? 'Scheduled', nextRun, timeZone: str(v.timeZone, 64) ?? 'UTC',
    hour: int(v.hour, 0, 23), minute: int(v.minute, 0, 59), missed: int(v.missed, 1, 1000),
  };
}

/** Only the fields a worker has, each with a size limit. */
function cleanWorker(w: any): any | null {
  const id = safeId(w?.id);
  if (!id) return null;
  const runs = Array.isArray(w.runs)
    ? w.runs.slice(-20).map((r: any) => ({
        at: isoDate(r?.at), summary: str(r?.summary, 2000) ?? '', task: str(r?.task, 500) ?? '',
        ok: r?.ok === true, auto: r?.auto === true,
      })).filter((r: any) => r.at)
    : undefined;
  // Where a paused run stopped, so Continue can pick up there after a restart.
  const resumeSteps = Array.isArray(w.resume?.steps) ? w.resume.steps.slice(0, 50).map((s: unknown) => str(s, 2000)).filter(Boolean) : [];
  const resumeDone = w.resume?.done;
  const resume = resumeSteps.length && Number.isInteger(resumeDone) && resumeDone > 0 && resumeDone < resumeSteps.length
    ? { steps: resumeSteps, done: resumeDone }
    : undefined;
  return {
    id,
    name: str(w.name, 120)?.trim() || 'Worker',
    folder: str(w.folder, 64),
    hue: Number.isFinite(w.hue) ? ((Math.round(w.hue) % 360) + 360) % 360 : 200,
    tier: ['lite', 'balanced', 'pro'].includes(w.tier) ? w.tier : 'lite',
    status: ['draft', 'idle', 'running', 'paused'].includes(w.status) ? w.status : 'idle',
    apps: Array.isArray(w.apps) ? [...new Set(w.apps.filter((a: unknown) => typeof a === 'string' && /^[\w-]{1,40}$/.test(a)))].slice(0, 60) : [],
    templateId: str(w.templateId, 64),
    machine: w.machine === 'cloud' || w.machine === 'local' ? w.machine : undefined,
    cloudVmId: typeof w.cloudVmId === 'string' && /^[\w-]{1,64}$/.test(w.cloudVmId) ? w.cloudVmId : undefined,
    prompt: str(w.prompt, 20000) ?? '',
    schedule: cleanSchedule(w.schedule),
    createdAt: isoDate(w.createdAt) ?? new Date().toISOString(),
    runs,
    resume,
    pausedBy: w.pausedBy === 'you' || w.pausedBy === 'closed' ? w.pausedBy : undefined,
  };
}

/** A worker saved as "running" with no run behind it (the app closed mid-run) is shown as paused. */
function withLiveStatus(list: any[]): any[] {
  const live = activeConversationIds();
  // A run that is no longer going was cut off (EverFern closed or crashed): it waits, paused, for Continue.
  return list.map((w) => (w.status === 'running' && !live.some((c) => c === `worker-${w.id}` || c.startsWith(`worker-${w.id}-`)) ? { ...w, status: 'paused', pausedBy: 'closed' } : w));
}

/* ── Chat history per worker ── */
const chatDir = () => path.join(app.getPath('userData'), 'worker-chats');
const chatFile = (id: string) => path.join(chatDir(), `${id}.json`);
const MAX_CHAT_BYTES = 4 * 1024 * 1024;

/** Removes everything a worker left on this computer and in its VM. Each step runs even if another fails. */
async function deleteWorker(id: string): Promise<string[]> {
  const problems: string[] = [];
  const step = async (what: string, fn: () => unknown) => {
    try { await fn(); } catch (e) { problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  await step('stop its runs', () => { for (const c of activeConversationIds()) if (c === `worker-${id}` || c.startsWith(`worker-${id}-`)) stopConversation(c); });
  await step('close its terminal', () => killWorkerPty(id));
  await step('stop watching its files', () => unwatchWorkspace(id));
  await step('forget its windows', () => forgetWorkerWindows(`worker-${id}`));
  await step('clear its browser logins', async () => {
    const ses = session.fromPartition(`persist:worker-${id}`);
    await ses.clearStorageData();
    await ses.clearCache();
  });
  await step('remove its workspace', async () => {
    const vm = await isWorkerVMAvailable().catch(() => ({ available: false }));
    if (vm?.available) await destroyWorkerVm(id);
    else problems.push(`its workspace (${workspaceDir(id)}) is still in the worker VM, which is not running; it is removed the next time you delete a worker with the VM running`);
  });
  await step('remove its temporary files', () => fs.promises.rm(hostScratchDir(id), { recursive: true, force: true }));
  await step('remove its chat history', () => fs.promises.rm(chatFile(id), { force: true }));
  await step('remove its saved cloud browser logins', async () => {
    const dir = path.join(app.getPath('userData'), 'cloud-browser');
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    for (const n of names) if (n.includes(`.bb.${id}.`) || n.endsWith(`.bb.${id}.bin`)) await fs.promises.rm(path.join(dir, n), { force: true });
  });
  return problems;
}

/** "<account>" (the VM's own browser) or "<account>.bb.<worker>" (a worker's Browserbase browser). */
const safeScope = (s: unknown) => (typeof s === 'string' && /^[A-Za-z0-9-]{1,64}(\.bb\.[A-Za-z0-9_-]{1,80}(\.app\.[A-Za-z0-9_-]{1,40})?)?$/.test(s) ? s : null);
const stateFile = (scope: string) => path.join(app.getPath('userData'), 'cloud-browser', `${scope}.bin`);

export function registerWorkerHandlers(): void {
  registerWorkerPtyHandlers(safeId);
  app.on('before-quit', killWorkerPtys);

  // Cloud VM browser cookies: { id: sha256, data: base64 gzipped SQLite } encrypted with the OS keychain.
  ipcMain.handle('workers:browser-state-load', (_e, scope: string) => {
    const s = safeScope(scope);
    if (!s) return null;
    try {
      // Saved logins are only ever kept encrypted; without the OS keychain there is nothing to load.
      if (!safeStorage.isEncryptionAvailable()) return null;
      const buf = fs.readFileSync(stateFile(s));
      const json = safeStorage.decryptString(buf);
      const v = JSON.parse(json);
      return typeof v?.id === 'string' && typeof v?.data === 'string' ? v : null;
    } catch { return null; }
  });
  ipcMain.handle('workers:browser-state-save', (_e, scope: string, id: string, data: string, kind?: string) => {
    const s = safeScope(scope);
    if (!s || !/^[0-9a-f]{64}$/.test(String(id)) || typeof data !== 'string' || data.length > 30 * 1024 * 1024) return { success: false };
    // Live login sessions are never written in plain text.
    if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'This computer has no OS keychain available, so logins are not saved between sessions.' };
    const json = JSON.stringify({ id, data, ...(kind === 'cookies' ? { kind } : {}), savedAt: Date.now() });
    const out = safeStorage.encryptString(json);
    fs.mkdirSync(path.dirname(stateFile(s)), { recursive: true });
    // Keep the previous clone intact if the app exits during a write.
    const file = stateFile(s);
    fs.writeFileSync(`${file}.tmp`, out);
    fs.renameSync(`${file}.tmp`, file);
    return { success: true };
  });

  ipcMain.handle('workers:webview-register', (e, partition: string, appId: string, wcId: number) => {
    if (typeof partition !== 'string' || !/^persist:worker-[A-Za-z0-9-]{1,64}$/.test(partition)) return false;
    // Only a webview that this window hosts, and that really uses that worker's partition.
    let wc: Electron.WebContents | undefined;
    try { wc = typeof wcId === 'number' ? webContents.fromId(wcId) : undefined; } catch { wc = undefined; }
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return false;
    if (wc.session !== session.fromPartition(partition)) return false;
    if (wc.hostWebContents && wc.hostWebContents.id !== e.sender.id) return false;
    // Its downloads go to the worker's Files (Downloads/), where every app can upload them.
    routeDownloadsToWorkspace(partition);
    return registerWorkerWebview(partition, appId, wcId);
  });
  ipcMain.handle('workers:localvm-register', (_e, partition: string, appId: string, url: string) => registerWorkerLocalVm(partition, appId, url));
  ipcMain.handle('workers:localvm-unregister', (_e, partition: string, appId: string) => { unregisterWorkerLocalVm(partition, appId); return true; });
  ipcMain.handle('workers:webview-unregister', (_e, partition: string, appId: string, wcId: number) => { unregisterWorkerWebview(partition, appId, wcId); return true; });

  // ── Pixel automation into a worker's <webview> windows ───────────────
  // Synthetic DOM events from the host page cannot cross into a webview's
  // guest page, so worker_click / worker_type route here and use real
  // Chromium input events. Coordinates arrive normalized 0-1000 within the
  // webview's guest viewport; converted below to that page's CSS pixels.
  const webviewBywcId = (wcId: unknown): Electron.WebContents | null => {
    if (typeof wcId !== 'number' || !Number.isFinite(wcId)) return null;
    let wc: Electron.WebContents | null = null;
    try { wc = webContents.fromId(wcId) ?? null; } catch { return null; }
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return null;
    return wc;
  };

  ipcMain.on('worker:webview-click', (_e, p: { wcId?: number; kind?: string; nx?: number; ny?: number }) => {
    void (async () => {
      const wc = webviewBywcId(p?.wcId);
      if (!wc) return;
      const kind = p?.kind === 'double_click' || p?.kind === 'right_click' ? p.kind : 'click';
      const nx = Math.max(0, Math.min(1000, Math.round(Number(p?.nx) || 0)));
      const ny = Math.max(0, Math.min(1000, Math.round(Number(p?.ny) || 0)));
      try {
        const size = await wc.executeJavaScript('({ w: window.innerWidth, h: window.innerHeight })', true);
        if (!size || !size.w || !size.h) return;
        const x = Math.round((nx / 1000) * size.w);
        const y = Math.round((ny / 1000) * size.h);
        const button = kind === 'right_click' ? 'right' : 'left';
        const clickCount = kind === 'double_click' ? 2 : 1;
        wc.sendInputEvent({ type: 'mouseMove', x, y } as Electron.MouseInputEvent);
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount } as Electron.MouseInputEvent);
        wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount } as Electron.MouseInputEvent);
      } catch { /* guest not ready */ }
    })();
  });

  ipcMain.on('worker:webview-type', (_e, p: { wcId?: number; text?: string; submit?: boolean }) => {
    const wc = webviewBywcId(p?.wcId);
    if (!wc) return;
    const text = String(p?.text ?? '').slice(0, 20000);
    if (!text) return;
    for (const ch of text) {
      try { wc.sendInputEvent({ type: 'char', keyCode: ch } as any); } catch { break; }
    }
    if (p?.submit === true) {
      try {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' } as Electron.KeyboardInputEvent);
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' } as Electron.KeyboardInputEvent);
      } catch { /* ignore */ }
    }
  });

  ipcMain.handle('worker:webview-describe', async (_e, p: { wcId?: number }) => {
    const wc = webviewBywcId(p?.wcId);
    if (!wc) return null;
    const js = `(function () {
      try {
        const out = { w: window.innerWidth, h: window.innerHeight, items: [] };
        const nodes = document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [contenteditable="true"]');
        for (const el of Array.from(nodes)) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.value || el.textContent || '').trim().slice(0, 60);
          out.items.push({ role: el.getAttribute('role') || el.tagName.toLowerCase(), label, xpx: r.left + r.width / 2, ypx: r.top + r.height / 2 });
          if (out.items.length >= 200) break;
        }
        return out;
      } catch (e) { return { w: 0, h: 0, items: [] }; }
    })()`;
    try { return await wc.executeJavaScript(js, true); } catch { return null; }
  });


  ipcMain.handle('workers:cloudvm-register', (_e, partition: string, appId: string, vmId: string, apiUrl: string, token: string, homeUrl?: string) => registerWorkerCloudVm(partition, appId, vmId, apiUrl, token, homeUrl));
  ipcMain.handle('workers:cloudvm-unregister', (_e, partition: string, appId: string) => { unregisterWorkerCloudVm(partition, appId); return true; });

  // Throws when the store is damaged with no backup, so the renderer shows the error instead of an empty list.
  ipcMain.handle('workers:list', () => withLiveStatus(readAll()));
  ipcMain.handle('workers:save', (_e, w: any) => {
    const clean = cleanWorker(w);
    if (!clean) return { success: false, error: 'Invalid worker' };
    try {
      const list = readAll();
      const i = list.findIndex((x) => x.id === clean.id);
      if (i < 0 && list.length >= MAX_WORKERS) return { success: false, error: `You can have up to ${MAX_WORKERS} workers.` };
      if (i >= 0) list[i] = clean; else list.push(clean);
      writeAll(list);
      return { success: true };
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('workers:delete', async (_e, workerId: string) => {
    const id = safeId(workerId);
    if (!id) return { success: false, error: 'Invalid worker' };
    try {
      const problems = await deleteWorker(id);
      writeAll(readAll().filter((x) => x.id !== id));
      return { success: true, ...(problems.length ? { warnings: problems } : {}) };
    } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('workers:chat-load', async (_e, workerId: string) => {
    const id = safeId(workerId);
    if (!id) return [];
    try {
      const v = JSON.parse(await fs.promises.readFile(chatFile(id), 'utf-8'));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  });
  ipcMain.handle('workers:chat-save', async (_e, workerId: string, msgs: unknown) => {
    const id = safeId(workerId);
    if (!id || !Array.isArray(msgs)) return { success: false };
    let json = JSON.stringify(msgs.slice(-300));
    // Keep the newest messages that fit.
    for (let keep = 300; json.length > MAX_CHAT_BYTES && keep > 10; keep = Math.floor(keep / 2)) json = JSON.stringify(msgs.slice(-keep));
    if (json.length > MAX_CHAT_BYTES) return { success: false };
    await fs.promises.mkdir(chatDir(), { recursive: true });
    const tmp = `${chatFile(id)}.tmp`;
    await fs.promises.writeFile(tmp, json, 'utf-8');
    await fs.promises.rename(tmp, chatFile(id));
    return { success: true };
  });

  ipcMain.handle('workers:vm-status', async () => {
    try { return await isWorkerVMAvailable(); } catch (e) { return { available: false, reason: String(e) }; }
  });

  // Files and Terminal go through one helper: the cloud VM's workspace for a cloud
  // worker (its app windows registered the VM), else the local Linux VM.
  const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

  ipcMain.handle('workers:vm-exec', async (_e, workerId: string, command: string) => {
    const id = safeId(workerId);
    if (!id || typeof command !== 'string' || !command.trim()) return { stdout: '', stderr: 'Invalid request', exitCode: -1 };
    try { return await workspaceExec(id, command); } catch (e) { return { stdout: '', stderr: fail(e), exitCode: -1 }; }
    finally { notifyFilesChanged(id); }
  });

  // Live Files: main watches the folder Files shows and sends worker:files-changed.
  ipcMain.handle('workers:files-watch', async (_e, workerId: string, subpath?: string) => {
    const id = safeId(workerId);
    const sub = cleanRelPath(typeof subpath === 'string' ? subpath : '');
    if (!id || sub === null) return { ok: false };
    await watchWorkspace(id, sub);
    return { ok: true };
  });
  ipcMain.handle('workers:files-unwatch', (_e, workerId: string) => {
    const id = safeId(workerId);
    if (id) unwatchWorkspace(id);
    return { ok: true };
  });
  app.on('before-quit', unwatchAllWorkspaces);

  // Add files from this computer into a workspace folder (any type, any size).
  ipcMain.handle('workers:vm-import', async (e, workerId: string, subpath?: string) => {
    const id = safeId(workerId);
    const sub = cleanRelPath(typeof subpath === 'string' ? subpath : '');
    if (!id || sub === null) return { ok: false, error: 'Invalid request' };
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const pick = await (win ? dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }));
    if (pick.canceled || !pick.filePaths.length) return { ok: true, added: [] };
    const added: string[] = [];
    try {
      for (const f of pick.filePaths) {
        const rel = (sub ? sub + '/' : '') + path.basename(f);
        await copyIntoWorkspace(id, f, rel);
        added.push(rel);
      }
      return { ok: true, added };
    } catch (err) { return { ok: false, added, error: fail(err) }; }
    finally { notifyFilesChanged(id, sub); }
  });

  // Save a workspace file onto this computer.
  ipcMain.handle('workers:vm-export', async (e, workerId: string, filePath: string) => {
    const id = safeId(workerId);
    const clean = cleanRelPath(filePath);
    if (!id || !clean) return { ok: false, error: 'Invalid request' };
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts = { defaultPath: path.join(app.getPath('downloads'), path.posix.basename(clean)) };
    const pick = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts));
    if (pick.canceled || !pick.filePath) return { ok: true, saved: null };
    try {
      const tmp = await copyOutOfWorkspace(id, clean);
      await fs.promises.copyFile(tmp, pick.filePath);
      void fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      return { ok: true, saved: pick.filePath };
    } catch (err) { return { ok: false, error: fail(err) }; }
  });

  ipcMain.handle('workers:vm-ls', async (_e, workerId: string, subpath?: string) => {
    const id = safeId(workerId);
    if (!id) return { files: [], error: 'Invalid worker' };
    const sub = cleanRelPath(typeof subpath === 'string' ? subpath : '');
    if (sub === null) return { files: [], error: 'Invalid path' };
    try {
      const r = await workspaceList(id, sub);
      return { ...r, path: `${workspaceDir(id)}${sub ? '/' + sub : ''}`, subpath: sub };
    } catch (e) { return { files: [], subpath: sub, error: fail(e) }; }
  });

  ipcMain.handle('workers:vm-read', async (_e, workerId: string, filePath: string) => {
    const id = safeId(workerId);
    const clean = cleanRelPath(filePath);
    if (!id || !clean) return { error: 'Invalid request' };
    try { return { ...(await workspaceRead(id, clean)), path: clean }; } catch (e) { return { error: fail(e) }; }
  });

  ipcMain.handle('workers:vm-write', async (_e, workerId: string, filePath: string, content: string) => {
    const id = safeId(workerId);
    const clean = cleanRelPath(filePath);
    if (!id || !clean || typeof content !== 'string' || content.length > 50_000_000) return { ok: false, error: 'Invalid request' };
    try { return await workspaceWrite(id, clean, content); } catch (e) { return { ok: false, error: fail(e) }; }
  });
}
