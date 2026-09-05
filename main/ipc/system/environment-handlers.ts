import { ipcMain } from 'electron';
import { ensureDockerContainer, checkEnvironmentDependencies, setupEnvironmentDependencies } from '../../agent/tools/linux-vm-executor';
import { ocrProgressEmitter } from '../../ocr/ocr';

export function registerEnvironmentHandlers(): void {
  ipcMain.handle('system:checkWSL', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Fast check 1: list installed distros
      try {
        const { stdout: listOut } = await execAsync('wsl.exe -l -q', { timeout: 4000 });
        const cleaned = listOut ? listOut.replace(/\x00/g, '').trim() : '';
        if (cleaned.length > 0) return true;
      } catch {}

      // Fast check 2: status
      try {
        const { stdout: statusOut } = await execAsync('wsl.exe --status', { timeout: 4000 });
        const cleaned = statusOut ? statusOut.replace(/\x00/g, '').trim() : '';
        if (cleaned.length > 0 && !cleaned.toLowerCase().includes('not installed')) return true;
      } catch {}

      // Responsive check 3: echo test
      try {
        const { stdout } = await execAsync('wsl.exe -e echo ok', { timeout: 8000 });
        if (stdout && stdout.includes('ok')) return true;
      } catch {}

      return false;
    } catch {
      return false;
    }
  });

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
      
      let osName = 'Ubuntu';
      let uptime = 'Active';
      try {
        const { stdout: osRelease } = await execFileAsync('wsl.exe', ['--exec', 'cat', '/etc/os-release'], { encoding: 'utf8', timeout: 5000 });
        const nameMatch = osRelease.match(/PRETTY_NAME="([^"]+)"/);
        if (nameMatch) osName = nameMatch[1];
      } catch {}
      try {
        const { stdout: procUp } = await execFileAsync('wsl.exe', ['--exec', 'cat', '/proc/uptime'], { encoding: 'utf8', timeout: 5000 });
        const totalSecs = Math.floor(parseFloat(procUp.trim().split(' ')[0]) || 0);
        if (totalSecs < 60) {
          uptime = `Active (${totalSecs}s ago)`;
        } else {
          const days = Math.floor(totalSecs / 86400);
          const hours = Math.floor((totalSecs % 86400) / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const parts = [];
          if (days > 0) parts.push(`${days}d`);
          if (hours > 0) parts.push(`${hours}h`);
          if (mins > 0) parts.push(`${mins}m`);
          uptime = `Active (${parts.join(' ')})`;
        }
      } catch {
        uptime = 'Active';
      }

      return {
        healthy: true,
        osName,
        uptime
      };
    } catch (err: any) {
      return {
        healthy: false,
        error: err.message
      };
    }
  });

  ipcMain.handle('system:installWSL', async () => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    try {
      console.log('[WSL Installer] Attempting to install default Ubuntu on WSL...');
      await execAsync('wsl.exe --install -d Ubuntu --no-launch', { timeout: 180000 });
      // Boot root once to initialize distro filesystem and bypass first-run prompts
      try {
        await execAsync('wsl.exe -d Ubuntu -u root --exec /bin/true', { timeout: 45000 });
      } catch {}
      return { success: true };
    } catch (err: any) {
      console.warn('[WSL Installer] Primary install failed, attempting elevated PowerShell install:', err);
      try {
        await execAsync('powershell -Command "Start-Process wsl.exe -ArgumentList \'--install -d Ubuntu --no-launch\' -Verb RunAs -Wait"', { timeout: 180000 });
        // Boot root once to initialize distro filesystem and bypass first-run prompts
        try {
          await execAsync('wsl.exe -d Ubuntu -u root --exec /bin/true', { timeout: 45000 });
        } catch {}
        return { success: true };
      } catch (elevatedErr: any) {
        console.error('[WSL Installer] Elevated install also failed:', elevatedErr);
        return { success: false, error: elevatedErr.message || err.message };
      }
    }
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
