import { ipcMain } from 'electron';
import { ensureDockerContainer, checkEnvironmentDependencies, setupEnvironmentDependencies, broadcastVMSetupLog } from '../../agent/tools/linux-vm-executor';
import { ALPINE_DISTRO, isAlpineInstalled, installAlpineVM, startAlpineDesktop, openAlpineBrowser } from '../../agent/tools/alpine-vm';
import { ocrProgressEmitter } from '../../ocr/ocr';
import { restoreLocalVmBrowserState, saveLocalVmBrowserState } from '../../lib/local-vm-browser-state';

export function registerEnvironmentHandlers(): void {
  // The Alpine VM's XFCE desktop, streamed over noVNC on 127.0.0.1. One stream is shared by every window.
  let desktop: { url: string; proc: { kill: () => void; exitCode: number | null } } | null = null;
  let starting: Promise<{ url: string }> | null = null;
  let cookieTimer: ReturnType<typeof setInterval> | null = null;
  ipcMain.handle('system:startVMDesktop', async (_e, opts?: { openUrl?: string }) => {
    if (process.platform !== 'win32') return { success: false, error: 'The VM desktop is available on Windows for now.' };
    if (desktop && desktop.proc.exitCode === null) {
      if (opts?.openUrl) await openAlpineBrowser(opts.openUrl);
      return { success: true, url: desktop.url };
    }
    try {
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
      const d = await starting;
      if (opts?.openUrl) await openAlpineBrowser(opts.openUrl);
      return { success: true, url: d.url };
    } catch (e: any) {
      return { success: false, error: e?.message || 'The VM desktop did not start.' };
    }
  });
  ipcMain.handle('system:openVMBrowser', async (_e, url: string) => {
    if (process.platform !== 'win32' || !desktop) return { success: false };
    await openAlpineBrowser(String(url || ''));
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

  ipcMain.handle('system:toHostPath', async (_event, pathStr: string) => {
    const { toHostPath } = require('../../agent/tools/linux-vm-executor');
    return toHostPath(pathStr);
  });

  ipcMain.handle('system:to-host-path', (_event, pathStr: string) => {
    try {
      const { translateLinuxPathToHost } = require('../../agent/tools/linux-vm-executor');
      return translateLinuxPathToHost(pathStr);
    } catch {
      return pathStr;
    }
  });
}
