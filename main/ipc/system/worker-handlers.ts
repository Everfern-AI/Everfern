/**
 * Workers: persistent store + each worker's own computer (the Linux VM).
 *
 *  workers:list / workers:save / workers:delete  → userData/workers.json
 *  workers:vm-status                             → is the WSL/Docker VM up?
 *  workers:vm-exec (workerId, command)           → run a command in the worker's
 *                                                  workspace (~/everfern-workers/<id>)
 *  workers:vm-ls (workerId)                      → list that workspace
 *  workers:browser-state-load / -save (scope)    → the cloud VM browser's cookies, kept on this
 *                                                  computer (encrypted) so every new VM starts signed in
 *  workers:webview-register / -unregister        → a worker's browser window, so its Navis runs drive it
 *  workers:cloudvm-register / -unregister        → a cloud worker's window (its VM's screen), so its Navis
 *                                                  runs drive the VM's browser
 */
import { app, ipcMain, safeStorage, webContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { runInLinuxVM, isLinuxVMAvailable } from '../../agent/tools/linux-vm-executor';
import { registerWorkerWebview, unregisterWorkerWebview, registerWorkerCloudVm, unregisterWorkerCloudVm } from '../../agent/tools/navis/core/webview-registry';
import { registerWorkerLocalVm, unregisterWorkerLocalVm } from '../../agent/tools/navis/core/webview-registry';

const storeFile = () => path.join(app.getPath('userData'), 'workers.json');

function readAll(): any[] {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf-8')); } catch { return []; }
}
function writeAll(list: any[]) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2), 'utf-8');
}

/** Worker ids are UUIDs (or timestamps); anything else is rejected before it reaches a shell. */
const safeId = (id: unknown) => (typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null);
const workspace = (id: string) => `$HOME/everfern-workers/${id}`;
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** "<account>" (the VM's own browser) or "<account>.bb.<worker>" (a worker's Browserbase browser). */
const safeScope = (s: unknown) => (typeof s === 'string' && /^[A-Za-z0-9-]{1,64}(\.bb\.[A-Za-z0-9_-]{1,80}(\.app\.[A-Za-z0-9_-]{1,40})?)?$/.test(s) ? s : null);
const stateFile = (scope: string) => path.join(app.getPath('userData'), 'cloud-browser', `${scope}.bin`);

export function registerWorkerHandlers(): void {
  // Cloud VM browser cookies: { id: sha256, data: base64 gzipped SQLite } encrypted with the OS keychain.
  ipcMain.handle('workers:browser-state-load', (_e, scope: string) => {
    const s = safeScope(scope);
    if (!s) return null;
    try {
      const buf = fs.readFileSync(stateFile(s));
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8');
      const v = JSON.parse(json);
      return typeof v?.id === 'string' && typeof v?.data === 'string' ? v : null;
    } catch { return null; }
  });
  ipcMain.handle('workers:browser-state-save', (_e, scope: string, id: string, data: string, kind?: string) => {
    const s = safeScope(scope);
    if (!s || !/^[0-9a-f]{64}$/.test(String(id)) || typeof data !== 'string' || data.length > 30 * 1024 * 1024) return { success: false };
    const json = JSON.stringify({ id, data, ...(kind === 'cookies' ? { kind } : {}), savedAt: Date.now() });
    const out = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf-8');
    fs.mkdirSync(path.dirname(stateFile(s)), { recursive: true });
    // Keep the previous clone intact if the app exits during a write.
    const file = stateFile(s);
    fs.writeFileSync(`${file}.tmp`, out);
    fs.renameSync(`${file}.tmp`, file);
    return { success: true };
  });

  ipcMain.handle('workers:webview-register', (_e, partition: string, appId: string, wcId: number) => registerWorkerWebview(partition, appId, wcId));
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


  ipcMain.handle('workers:cloudvm-register', (_e, partition: string, appId: string, vmId: string, apiUrl: string, token: string) => registerWorkerCloudVm(partition, appId, vmId, apiUrl, token));
  ipcMain.handle('workers:cloudvm-unregister', (_e, partition: string, appId: string) => { unregisterWorkerCloudVm(partition, appId); return true; });

  ipcMain.handle('workers:list', () => readAll());
  ipcMain.handle('workers:save', (_e, w: any) => {
    if (!w || !safeId(w.id)) return { success: false };
    const list = readAll();
    const i = list.findIndex((x) => x.id === w.id);
    if (i >= 0) list[i] = w; else list.push(w);
    writeAll(list);
    return { success: true };
  });
  ipcMain.handle('workers:delete', (_e, id: string) => {
    writeAll(readAll().filter((x) => x.id !== id));
    return { success: true };
  });

  ipcMain.handle('workers:vm-status', async () => {
    try { return await isLinuxVMAvailable(); } catch (e) { return { available: false, reason: String(e) }; }
  });

  ipcMain.handle('workers:vm-exec', async (_e, workerId: string, command: string) => {
    const id = safeId(workerId);
    if (!id || typeof command !== 'string' || !command.trim()) return { stdout: '', stderr: 'Invalid request', exitCode: -1 };
    const ws = workspace(id);
    return runInLinuxVM(`mkdir -p "${ws}" && cd "${ws}" && ${command}`);
  });

  ipcMain.handle('workers:vm-ls', async (_e, workerId: string, subpath?: string) => {
    const id = safeId(workerId);
    if (!id) return { files: [], error: 'Invalid worker' };
    const sub = typeof subpath === 'string' ? subpath.trim().replace(/^\/+|\/+$/g, '') : '';
    if (sub.split(/[\\/]/).includes('..')) return { files: [], error: 'Invalid path' };
    const ws = workspace(id);
    const dir = sub ? `"${ws}/"${shellQuote(sub)}` : `"${ws}"`;
    const r = await runInLinuxVM(`mkdir -p "${ws}" && cd ${dir} 2>/dev/null && ls -1Ap --group-directories-first 2>/dev/null | head -200`);
    if (r.exitCode !== 0) return { files: [], subpath: sub, error: r.stderr || 'VM unavailable' };
    return {
      files: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
      path: `~/everfern-workers/${id}${sub ? '/' + sub.replace(/^\/+|\/+$/g, '') : ''}`,
      subpath: sub,
    };
  });

  ipcMain.handle('workers:vm-read', async (_e, workerId: string, filePath: string) => {
    const id = safeId(workerId);
    if (!id || typeof filePath !== 'string' || !filePath.trim()) return { error: 'Invalid request' };
    const clean = filePath.trim().replace(/^\/+/, '');
    if (clean.split(/[\\/]/).includes('..')) return { error: 'Invalid path' };
    const ws = workspace(id);
    const r = await runInLinuxVM(`cd "${ws}" 2>/dev/null && head -c 200000 -- ${shellQuote(clean)}`);
    if (r.exitCode !== 0) return { error: r.stderr || 'File not readable' };
    return { content: r.stdout, path: clean };
  });
}
