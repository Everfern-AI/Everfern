import { ipcMain, dialog, shell, Notification, app, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { memorySaveTool } from '../agent/tools/memory-save';
import { ensureDockerContainer } from '../agent/tools/linux-vm-executor';

export function registerSystemHandlers() {
  ipcMain.handle('system:checkWSL', async () => {
    try {
      const { execSync } = require('child_process');
      execSync('wsl.exe -e echo ok', { stdio: 'ignore', timeout: 5000 });
      const list = execSync('wsl.exe --list --quiet', { encoding: 'utf8', timeout: 5000 });
      return list && list.trim().length > 0;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:checkDocker', async () => {
    try {
      const { execSync } = require('child_process');
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:installWSL', async () => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Start-Process wsl.exe -ArgumentList "--install -d Ubuntu --no-launch" -Verb RunAs -Wait'
      ], { shell: false });

      proc.on('close', (code: number | null) => {
        try {
          const { execSync } = require('child_process');
          execSync('wsl.exe -d Ubuntu -e echo ok', { stdio: 'ignore', timeout: 5000 });
          resolve({ success: true });
        } catch {
          resolve({ success: true, warning: 'Reboot may be required' });
        }
      });

      proc.on('error', (err: Error) => {
        resolve({ success: false, error: err.message });
      });
    });
  });

  ipcMain.handle('system:setupDockerUbuntu', async () => {
    try {
      await ensureDockerContainer();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('system:get-username', () => {
    return os.userInfo().username;
  });

  ipcMain.handle('system:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:check-for-updates', async () => {
    try {
      const currentVersion = app.getVersion();
      const response = await net.fetch('https://api.github.com/repos/CodenRust/Everfern/releases/latest');
      if (!response.ok) return { hasUpdate: false };

      const data = await response.json();
      const latestVersion = data.tag_name.replace(/^v/, '');

      // Simple version comparison (semver-lite)
      const currentParts = currentVersion.split('.').map(Number);
      const latestParts = latestVersion.split('.').map(Number);

      let hasUpdate = false;
      for (let i = 0; i < 3; i++) {
        if ((latestParts[i] || 0) > (currentParts[i] || 0)) {
          hasUpdate = true;
          break;
        } else if ((latestParts[i] || 0) < (currentParts[i] || 0)) {
          break;
        }
      }

      return {
        hasUpdate,
        latestVersion,
        url: data.html_url,
        notes: data.body
      };
    } catch (err) {
      console.error('[UpdateCheck] Failed to check for updates:', err);
      return { hasUpdate: false, error: String(err) };
    }
  });

  ipcMain.handle('system:open-file-picker', async (_event, options?: { filters?: { name: string, extensions: string[] }[] }) => {
    console.log('[IPC] system:open-file-picker called with options:', options);

    const mainWindow = (global as any).mainWindow;
    if (!mainWindow) {
      console.error('[IPC] system:open-file-picker: mainWindow not available');
      return { success: false, error: 'Main window not available' };
    }

    try {
      console.log('[IPC] Opening file dialog...');
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: options?.filters || [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'Text & Documents', extensions: ['txt', 'md', 'json', 'csv', 'js', 'ts', 'py', 'log', 'html', 'css'] }
        ]
      });

      console.log('[IPC] Dialog result - canceled:', canceled, 'filePaths:', filePaths);

      if (canceled || filePaths.length === 0) {
        console.log('[IPC] User canceled or no file selected');
        return { success: false, canceled: true };
      }

      const originalFilePath = filePaths[0];
      console.log('[IPC] Processing file:', originalFilePath);

      const stats = fs.statSync(originalFilePath);
      const ext = path.extname(originalFilePath).toLowerCase();
      const ONE_GB = 1073741824;

      // Copy to ~/.everfern/attachments (host)
      const attachmentsDir = path.join(os.homedir(), '.everfern', 'attachments');
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }
      const safeFileName = `${Date.now()}-${path.basename(originalFilePath)}`;
      const newFilePath = path.join(attachmentsDir, safeFileName);
      fs.copyFileSync(originalFilePath, newFilePath);
      console.log('[IPC] File copied to:', newFilePath);

      // Clone to Linux VM (WSL) for fast VM-side access — skip files >1GB
      if (stats.size <= ONE_GB) {
        try {
          const { execSync } = require('child_process');
          // First check if WSL is available
          let wslCmd = 'wsl.exe';
          try {
            execSync('where wsl.exe', { stdio: 'ignore', timeout: 3000 });
          } catch {
            try {
              execSync('wsl -e echo ok', { stdio: 'ignore', timeout: 5000 });
              wslCmd = 'wsl';
            } catch {
              throw new Error('WSL not available, skipping clone');
            }
          }
          const wslUsername = (os.userInfo().username || 'user').toLowerCase();
          const wslAttachmentsDir = `/home/${wslUsername}/.everfern/attachments`;
          // Build WSL path from Windows path — keep drive letter lowercase, rest preserves case (WSL mounts /mnt/c/ case-sensitively)
          const driveLetter = path.parse(newFilePath).root.replace(':', '').toLowerCase();
          const wslRelPath = newFilePath.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/');
          const wslSourcePath = `/mnt/${driveLetter}/${wslRelPath}`;
          console.log(`[IPC] Cloning to WSL: ${wslSourcePath} -> ${wslAttachmentsDir}/`);
          // Create dir and copy via WSL
          execSync(`${wslCmd} --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
          console.log('[IPC] File cloned to WSL:', `${wslAttachmentsDir}/${safeFileName}`);
        } catch (cloneErr: any) {
          console.warn(`[IPC] Failed to clone file to WSL (non-fatal): ${cloneErr.message}`);
        }
      } else {
        console.log('[IPC] File >1GB, skipping WSL clone. Accessible via /mnt/c/ path.');
      }

      let mimeType = 'application/octet-stream';
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
        const base64 = fs.readFileSync(newFilePath).toString('base64');
        const uri = `data:${mimeType};base64,${base64}`;
        console.log('[IPC] Returning image file, size:', stats.size);
        return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, base64: uri, success: true };
      } else {
        const content = fs.readFileSync(newFilePath, 'utf-8');
        console.log('[IPC] Returning text file, size:', stats.size);
        return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType: 'text/plain', content, success: true };
      }
    } catch (err: any) {
      console.error('[IPC] Error in open-file-picker:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:open-folder-picker', async () => {
    const mainWindow = (global as any).mainWindow;
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    const folderPath = filePaths[0];
    try {
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) return { success: false, error: 'Selected path is not a folder.' };
      return { path: folderPath, name: path.basename(folderPath), success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:to-host-path', (_event, pathStr: string) => {
    try {
      const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
      return translateLinuxPathToHost(pathStr);
    } catch {
      return pathStr;
    }
  });

  ipcMain.handle('system:open-folder', async (_event, folderPath: string) => {
    if (folderPath) {
      try {
        const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
        const hostPath = translateLinuxPathToHost(folderPath);
        shell.openPath(hostPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Folder not found' };
  });

  function getOllamaBinary(): string {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const home = os.homedir();
      const ollamaPath = path.join(home, 'AppData', 'Local', 'Programs', 'ollama', 'ollama.exe');
      if (fs.existsSync(ollamaPath)) return `"${ollamaPath}"`;
      return 'ollama';
    }
    const isMac = process.platform === 'darwin';
    if (isMac) {
      const siliconPath = '/opt/homebrew/bin/ollama';
      const intelPath = '/usr/local/bin/ollama';
      if (fs.existsSync(siliconPath)) return siliconPath;
      if (fs.existsSync(intelPath)) return intelPath;
      return 'ollama';
    }
    const linuxPaths = ['/usr/local/bin/ollama', '/usr/bin/ollama'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'ollama';
  }

  ipcMain.handle('system:ollama-status', () => {
    try {
      const { execSync } = require('child_process');
      const bin = getOllamaBinary();

      // Check if Ollama is installed
      try {
        execSync(`${bin} -v`, { stdio: 'ignore' });
      } catch {
        return { installed: false, modelInstalled: false };
      }

      // Check if the specific model is pulled
      try {
        const list = execSync(`"${bin}" list`, { encoding: 'utf8' });
        const modelInstalled = list.includes('qwen3-vl:2b');
        return { installed: true, modelInstalled };
      } catch {
        return { installed: true, modelInstalled: false };
      }
    } catch {
      return { installed: false, modelInstalled: false };
    }
  });

  ipcMain.handle('system:ollama-install', async (event) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      // Switch command based on platform
      const isWin = process.platform === 'win32';
      const shellCmd = isWin ? 'powershell.exe' : 'sh';
      const command = isWin
        ? 'irm https://ollama.com/install.ps1 | Invoke-Expression'
        : 'curl -fsSL https://ollama.com/install.sh | sh';

      const args = isWin
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-c', command];

      const proc = spawn(shellCmd, args, { shell: false });

      proc.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stdout' });
        });
      });

      proc.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stderr' });
        });
      });

      proc.on('close', (code: number) => {
        resolve({ success: code === 0, code });
      });
    });
  });

  ipcMain.handle('system:ollama-pull', async (event, modelName: string) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const bin = getOllamaBinary();
      const isWin = process.platform === 'win32';

      const proc = spawn(bin, ['pull', modelName], { shell: isWin && bin !== 'ollama' });

      proc.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stdout' });
        });
      });

      proc.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stderr' });
        });
      });

      proc.on('close', (code: number) => resolve({ success: code === 0 || code === null, code }));
    });
  });

  ipcMain.handle('memory:save-direct', async (_event, content: string, metadata?: string) => {
    return memorySaveTool.execute({ content, metadata });
  });

  ipcMain.handle('system:wipe-account', async () => {
    const everfernDir = path.join(os.homedir(), '.everfern');
    try {
      // Close all open database connections before wiping files
      try {
        const { closeDb } = await import('../lib/db');
        await closeDb();
        console.log('[IPC] system:wipe-account: main DB closed');
      } catch (dbErr: any) {
        console.warn('[IPC] system:wipe-account: main DB close warning:', dbErr.message);
      }

      try {
        const { closeChatVectorDb } = await import('../store/chat-vectors');
        await closeChatVectorDb();
        console.log('[IPC] system:wipe-account: chat vector DB closed');
      } catch (vecErr: any) {
        console.warn('[IPC] system:wipe-account: chat vector DB close warning:', vecErr.message);
      }

      // Wipe .everfern directory
      if (fs.existsSync(everfernDir)) {
        fs.rmSync(everfernDir, { recursive: true, force: true });
      }
      fs.mkdirSync(everfernDir, { recursive: true });

      console.log('[IPC] system:wipe-account: .everfern (including sql databases) wiped');
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:wipe-account error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    if (url) {
      try {
        if (url.startsWith('file://')) {
          let decodedUrl = decodeURIComponent(url);
          let filePath = decodedUrl.replace(/^file:\/\/\/?/, '');

          const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
          const hostPath = translateLinuxPathToHost(filePath);

          console.log(`[IPC] system:open-external: Original file:// url: ${url}, Translated host path: ${hostPath}`);

          const resultMsg = await shell.openPath(hostPath);
          if (resultMsg) {
            return { success: false, error: resultMsg };
          }
          return { success: true };
        }

        await shell.openExternal(url);
        return { success: true };
      } catch (err: any) {
        console.error('[IPC] Error in system:open-external:', err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'No URL provided' };
  });

  ipcMain.handle('system:fetch-metadata', async (_event, url: string) => {
    if (!url) return null;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' 
        },
        signal: controller.signal
      });
      clearTimeout(id);

      const html = await response.text();

      // Basic meta extraction
      const getMeta = (prop: string) => {
        const regex = new RegExp(`<meta[^>]*?(?:name|property)=["']${prop}["'][^>]*?content=["'](.*?)["']`, 'i');
        const match = html.match(regex);
        if (match) return match[1];
        const altRegex = new RegExp(`<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']${prop}["']`, 'i');
        const altMatch = html.match(altRegex);
        return altMatch ? altMatch[1] : null;
      };

      const cleanText = (text: string) => {
        if (!text) return '';
        return text
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      };

      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const rawTitle = getMeta('og:title') || (titleMatch ? titleMatch[1] : '') || '';
      const title = cleanText(rawTitle);

      const rawDescription = getMeta('og:description') || getMeta('description') || '';
      const description = cleanText(rawDescription);

      let favicon = html.match(/<link[^>]*?rel=["'](?:shortcut )?icon["'][^>]*?href=["'](.*?)["']/i)?.[1] || '';

      if (favicon && !favicon.startsWith('http')) {
        try {
          const base = new URL(url);
          favicon = new URL(favicon, base.origin).href;
        } catch { /* ignore */ }
      }

      return { title, description, favicon };
    } catch (err) {
      console.warn(`[IPC] system:fetch-metadata failed for ${url}:`, err);
      return null;
    }
  });

  ipcMain.handle('system:start-dispatch', async (event, config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      const service = DispatchService.getInstance();

      // Wire the command handler BEFORE initializing so no commands are missed
      service.onCommand = (command: string, model?: string) => {
        // Forward the command to all windows and bring the app to foreground
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show(); // Wake up from tray/background
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
      };

      await service.initialize(config, () => {
        // Send event to the window that initiated the dispatch
        event.sender.send('system:dispatch-active');
      });
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:start-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:restore-dispatch', async (event, config: { url: string, apiUrl: string, key: string, token: string, userId: string }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      const service = DispatchService.getInstance();

      // Wire the command handler so restored sessions also forward commands
      service.onCommand = (command: string, model?: string) => {
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show();
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
      };

      // Pass a dummy sessionId and pinCode for initialization since restoreSession will overwrite them
      await service.initialize({ ...config, sessionId: '', pinCode: '' }, () => {
        event.sender.send('system:dispatch-active');
      });
      return await service.restoreSession();
    } catch (err: any) {
      console.error('[IPC] system:restore-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:stop-dispatch', async () => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      await DispatchService.getInstance().disconnect();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:stop-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:broadcast-dispatch', async (_event, { event, data }: { event: string; data: any }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      DispatchService.getInstance().broadcastToWeb(event, data);
    } catch (err) {
      console.error('[IPC] system:broadcast-dispatch error:', err);
    }
  });

  /**
   * Ensure an attachment file is available in the Linux VM (WSL).
   * Retries the clone at send time if it failed during file picking.
   */
  ipcMain.handle('system:ensure-attachment-in-vm', async (_event, filePath: string) => {
    if (process.platform !== 'win32') return { success: true };
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    try {
      const { execSync } = require('child_process');
      const wslUsername = (os.userInfo().username || 'user').toLowerCase();
      const wslAttachmentsDir = `/home/${wslUsername}/.everfern/attachments`;
      const safeFileName = path.basename(filePath);
      const existingTarget = `\\\\wsl.localhost\\Ubuntu\\home\\${wslUsername}\\.everfern\\attachments\\${safeFileName}`;

      // Skip if already cloned
      if (fs.existsSync(existingTarget)) return { success: true };

      const driveLetter = path.parse(filePath).root.replace(':', '').toLowerCase();
      const wslRelPath = filePath.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/');
      const wslSourcePath = `/mnt/${driveLetter}/${wslRelPath}`;

      execSync(`wsl.exe --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
      console.log('[IPC] Attachment cloned to Linux VM:', existingTarget);
      return { success: true };
    } catch (err: any) {
      console.warn('[IPC] Failed to clone attachment to Linux VM (non-fatal):', err.message);
      return { success: false, error: err.message };
    }
  });
}
