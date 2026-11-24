import { ipcMain } from 'electron';
import { ensureDockerContainer, checkEnvironmentDependencies, setupEnvironmentDependencies, broadcastVMSetupLog, ensureWSLSetup, runInLinuxVM, setWslKeepAlive, resetWslIdleTimer } from '../../agent/tools/linux-vm-executor';
import { ALPINE_DISTRO, isAlpineInstalled, installAlpineVM, startAlpineDesktop, openAlpineBrowser } from '../../agent/tools/alpine-vm';
import { ocrProgressEmitter } from '../../ocr/ocr';
import { restoreLocalVmBrowserState, saveLocalVmBrowserState } from '../../lib/local-vm-browser-state';

// The Alpine VM's XFCE desktop, streamed over noVNC on 127.0.0.1. One stream is shared by
// every window, by workers, and by chat tasks the user chose to run in the VM.
let desktop: { url: string; proc: { kill: () => void; exitCode: number | null } } | null = null;
let starting: Promise<{ url: string }> | null = null;
let cookieTimer: ReturnType<typeof setInterval> | null = null;
const desktopUp = () => Boolean(desktop && desktop.proc.exitCode === null);

/** One desktop for every caller: a window opening it, a prewarm, or a chat task in the VM. */
const ensureDesktop = async (): Promise<{ url: string }> => {
  if (desktopUp()) return desktop!;
  starting ??= restoreLocalVmBrowserState().then(() => startAlpineDesktop()).then((d) => {
    desktop = d as any;
    cookieTimer = setInterval(() => void saveLocalVmBrowserState(), 15_000);
    cookieTimer.unref();
    d.proc.on('close', () => {
      if (cookieTimer) clearInterval(cookieTimer);
      cookieTimer = null;
      desktop = null;
    });
    return d;
  }).finally(() => { starting = null; });
  return starting;
};

/**
 * Brings up the VM desktop and its Chromium (DevTools on 127.0.0.1:19222 inside the VM)
 * at `url`, for a chat task the user chose to run in the EverFern VM. Windows only for now.
 */
export async function ensureVmBrowser(url: string): Promise<{ url: string }> {
  if (process.platform !== 'win32') throw new Error('Running browser tasks in the EverFern VM is available on Windows for now.');
  if (!(await isAlpineInstalled())) throw new Error('The EverFern VM is not set up yet. Set it up in Settings, then try again.');
  await ensureWSLSetup();
  const d = await ensureDesktop();
  await openAlpineBrowser(/^https?:\/\//i.test(url) ? url : 'https://duckduckgo.com', 1, false);
  return d;
}

export function registerEnvironmentHandlers(): void {
  // While the desktop streams, WSL stays up: its idle shutdown would make the next action a cold boot.
  setWslKeepAlive(desktopUp);

  /** A web app opens as its own window with no tabs or address bar; only the browser apps show them. */
  const asApp = (app: unknown) => typeof app === 'string' && !['browser', 'chrome'].includes(app);

  ipcMain.handle('system:startVMDesktop', async (_e, opts?: { openUrl?: string; app?: string }) => {
    if (process.platform !== 'win32') return { success: false, error: 'The VM desktop is available on Windows for now.' };
    try {
      const d = await ensureDesktop();
      if (opts?.openUrl) await openAlpineBrowser(opts.openUrl, 1, asApp(opts.app));
      return { success: true, url: d.url };
    } catch (e: any) {
      return { success: false, error: e?.message || 'The VM desktop did not start.' };
    }
  });

  /**
   * Warm the worker VM before any of its windows opens: boot the distro, finish the
   * one-time setup, run one command so the first real one finds bash and the
   * workspace hot, and bring the desktop stream up. Returns immediately; repeat calls
   * share the work in flight.
   */
  let prewarming: Promise<void> | null = null;
  const prewarm = (workerId?: string) => {
    if (process.platform !== 'win32') return;
    resetWslIdleTimer();
    const ws = typeof workerId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(workerId) ? `"$HOME/everfern-workers/${workerId}"` : '';
    prewarming ??= (async () => {
      if (!(await isAlpineInstalled())) return;
      await ensureWSLSetup();
      await Promise.all([
        runInLinuxVM('true'),
        ensureDesktop(),
      ]);
    })().catch((e) => console.warn('[VM] prewarm failed:', e?.message || e)).finally(() => { prewarming = null; });
    // This worker's folders (shared by Files, downloads and uploads) exist before its first action.
    if (ws) void prewarming.then(() => runInLinuxVM(`mkdir -p ${ws}/Documents ${ws}/Downloads`)).catch(() => undefined);
  };
  ipcMain.handle('system:prewarmVM', (_e, workerId?: string) => { prewarm(workerId); return { success: true }; });

  ipcMain.handle('system:openVMBrowser', async (_e, url: string, app?: string) => {
    if (process.platform !== 'win32' || !desktop) return { success: false };
    await openAlpineBrowser(String(url || ''), 1, asApp(app));
    return { success: true };
  });
  ipcMain.handle('system:stopVMDesktop', async () => {
    if (cookieTimer) clearInterval(cookieTimer);
    cookieTimer = null;
    if (desktop) await saveLocalVmBrowserState();
    try { desktop?.proc.kill(); } catch { /* already gone */ }
    desktop = null;
    return { success: true };
  });
  // True once EverFern's own Alpine VM exists (other WSL distros do not count).
  ipcMain.handle('system:checkWSL', async () => isAlpineInstalled());

  ipcMain.handle('system:checkDocker', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      await execAsync('docker info', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:getWSLInfo', async () => {
    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      const run = (cmd: string) => execFileAsync('wsl.exe', ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', '/bin/sh', '-c', cmd], { encoding: 'utf8', timeout: 15000 });

      await run('true');
      let osName = 'Alpine Linux';
      let uptime = 'Active';
      try {
        const { stdout } = await run('cat /etc/os-release');
        const m = stdout.match(/PRETTY_NAME="([^"]+)"/);
        if (m) osName = m[1];
      } catch {}
      try {
        const { stdout } = await run('cat /proc/uptime');
        const totalSecs = Math.floor(parseFloat(stdout.trim().split(' ')[0]) || 0);
        if (totalSecs < 60) uptime = `Active (${totalSecs}s)`;
        else {
          const d = Math.floor(totalSecs / 86400), h = Math.floor((totalSecs % 86400) / 3600), m = Math.floor((totalSecs % 3600) / 60);
          uptime = `Active (${[d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ')})`;
        }
      } catch {}
      return { healthy: true, osName, uptime, distro: ALPINE_DISTRO };
    } catch (err: any) {
      return { healthy: false, error: err.message, distro: ALPINE_DISTRO };
    }
  });

  // Creates EverFern's Alpine VM (imports the official minirootfs into WSL 2).
  ipcMain.handle('system:installWSL', async () => {
    return installAlpineVM((m, level) => broadcastVMSetupLog(m, level || 'info', 1));
  });

  ipcMain.handle('system:setupDockerUbuntu', async () => {
    try {
      await ensureDockerContainer();
      return { success: true };
    } catch (err: any) {
      console.error('[Docker Installer] Container setup failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:checkEnvironmentDependencies', async () => {
    return await checkEnvironmentDependencies();
  });

  ipcMain.handle('system:setupEnvironmentDependencies', async () => {
    const onProgress = (data: any) => {
      try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach((win: any) => {
          win?.webContents?.send?.('system:ocr-progress', data);
        });
      } catch { /* ignore */ }
    };
    ocrProgressEmitter.on('progress', onProgress);
    try {
      return await setupEnvironmentDependencies();
    } finally {
      ocrProgressEmitter.off('progress', onProgress);
    }
  });

  const translateHostPath = (_event: unknown, pathStr: string) => {
    try {
      const { translateLinuxPathToHost } = require('../../agent/tools/linux-vm-executor');
      return translateLinuxPathToHost(pathStr);
    } catch {
      return pathStr;
    }
  };
  ipcMain.handle('system:toHostPath', translateHostPath);
  ipcMain.handle('system:to-host-path', translateHostPath);
}
