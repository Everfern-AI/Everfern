import { ipcMain, dialog, shell, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { memorySaveTool } from '../../agent/tools/memory-save';

export function registerWindowFsHandlers(): void {
  ipcMain.handle('system:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('system:get-username', () => {
    try {
      return os.userInfo().username || process.env.USERNAME || process.env.USER || 'User';
    } catch {
      return process.env.USERNAME || process.env.USER || 'User';
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
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          let wslCmd = 'wsl.exe';
          try {
            await execAsync('where wsl.exe', { timeout: 3000 });
          } catch {
            try {
              await execAsync('wsl -e echo ok', { timeout: 5000 });
              wslCmd = 'wsl';
            } catch {
              throw new Error('WSL not available, skipping clone');
            }
          }
          const toWslPath = (winPath: string) => {
            const match = winPath.match(/^([A-Za-z]):[/\\](.*)$/);
            if (match) {
              const drive = match[1].toLowerCase();
              const rest = match[2].replace(/\\/g, '/');
              return `/mnt/${drive}/${rest}`;
            }
            return winPath.replace(/\\/g, '/');
          };
          const wslAttachmentsDir = `/everfern`;
          const wslSourcePath = toWslPath(newFilePath);
          console.log(`[IPC] Cloning to WSL: ${wslSourcePath} -> ${wslAttachmentsDir}/`);
          await execAsync(`${wslCmd} --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
          console.log('[IPC] File cloned to WSL:', `${wslAttachmentsDir}/${safeFileName}`);
        } catch (cloneErr: any) {
          console.warn(`[IPC] Failed to clone file to WSL (non-fatal): ${cloneErr.message}`);
        }
      } else {
        console.log('[IPC] File >1GB, skipping WSL clone. Accessible via /mnt/c/ path.');
      }

      const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
      const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

      let mimeType = 'application/octet-stream';
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
        if (stats.size <= MAX_INLINE_IMAGE_BYTES) {
          const base64 = fs.readFileSync(newFilePath).toString('base64');
          const uri = `data:${mimeType};base64,${base64}`;
          console.log('[IPC] Returning inline image file, size:', stats.size);
          return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, base64: uri, success: true };
        }
        console.log('[IPC] Image too large for base64 inline, returning path reference, size:', stats.size);
        return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, success: true };
      } else {
        let content = '';
        if (stats.size <= MAX_TEXT_PREVIEW_BYTES) {
          content = fs.readFileSync(newFilePath, 'utf-8');
        } else {
          const buffer = Buffer.alloc(MAX_TEXT_PREVIEW_BYTES);
          const fd = fs.openSync(newFilePath, 'r');
          fs.readSync(fd, buffer, 0, MAX_TEXT_PREVIEW_BYTES, 0);
          fs.closeSync(fd);
          content = buffer.toString('utf-8') + '\n\n... [File preview truncated for memory safety. Full file accessible at path]';
        }
        console.log('[IPC] Returning bounded text preview, original size:', stats.size);
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

  ipcMain.handle('system:open-folder', async (_event, folderPath: string) => {
    if (folderPath) {
      try {
        const { translateLinuxPathToHost } = require('../../agent/tools/linux-vm-executor');
        const hostPath = translateLinuxPathToHost(folderPath);
        shell.openPath(hostPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Folder not found' };
  });

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    if (url) {
      try {
        if (url.startsWith('file://')) {
          let decodedUrl = decodeURIComponent(url);
          let filePath = decodedUrl.replace(/^file:\/\/\/?/, '');

          const { translateLinuxPathToHost } = require('../../agent/tools/linux-vm-executor');
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
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
      } catch {
        return null;
      }

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(parsedUrl.href, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' 
        },
        signal: controller.signal
      });
      clearTimeout(id);

      if (!response.ok) return null;
      const html = await response.text();

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
          favicon = new URL(favicon, parsedUrl.origin).href;
        } catch { /* ignore */ }
      }

      return { title, description, favicon };
    } catch {
      return null;
    }
  });

  ipcMain.handle('memory:save-direct', async (_event, content: string, metadata?: string) => {
    return memorySaveTool.execute({ content, metadata });
  });

  ipcMain.handle('memory:get-graph', async () => {
    try {
      const { loadMemoryGraph } = require('../../agent/learning/memory/persistent-memory');
      return loadMemoryGraph();
    } catch (err: any) {
      console.error('[IPC] memory:get-graph error:', err);
      return { nodes: [], edges: [] };
    }
  });

  ipcMain.handle('memory:delete-node', async (_event, id: string) => {
    try {
      const { deleteMemoryNode } = require('../../agent/learning/memory/persistent-memory');
      deleteMemoryNode(id);
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] memory:delete-node error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:export-zip', async () => {
    try {
      const { loadMemoryGraph, getMemoryDir } = require('../../agent/learning/memory/persistent-memory');
      const graph = loadMemoryGraph();
      const memDir = getMemoryDir();

      const JSZip = (() => {
        try { return require('jszip'); } catch { return null; }
      })();

      let exportBuffer: Buffer;
      let defaultName = `everfern-memory-${new Date().toISOString().slice(0, 10)}.json`;
      let filters = [{ name: 'JSON', extensions: ['json'] }];

      if (JSZip) {
        const zip = new JSZip();
        zip.file('memory_graph.json', JSON.stringify(graph, null, 2));
        for (const node of graph.nodes) {
          if (node.linkedFile) {
            const mdPath = node.linkedFile.startsWith('/') || /^[A-Z]:/i.test(node.linkedFile)
              ? node.linkedFile
              : path.join(memDir, node.linkedFile);
            if (fs.existsSync(mdPath)) {
              zip.file(path.basename(mdPath), fs.readFileSync(mdPath));
            }
          }
        }
        exportBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        defaultName = `everfern-memory-${new Date().toISOString().slice(0, 10)}.zip`;
        filters = [{ name: 'ZIP Archive', extensions: ['zip'] }];
      } else {
        exportBuffer = Buffer.from(JSON.stringify(graph, null, 2), 'utf-8');
      }

      const mainWindow = (global as any).mainWindow;
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Memory Graph',
        defaultPath: path.join(os.homedir(), 'Desktop', defaultName),
        filters,
      });
      if (canceled || !filePath) return { success: false, reason: 'canceled' };
      fs.writeFileSync(filePath, exportBuffer);
      return { success: true, filePath };
    } catch (err: any) {
      console.error('[IPC] memory:export-zip error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:import-merge-graph', async () => {
    try {
      const { loadMemoryGraph, saveMemoryGraph } = require('../../agent/learning/memory/persistent-memory');
      const mainWindow = (global as any).mainWindow;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Import & Merge Memory Graph',
        filters: [
          { name: 'Memory Files', extensions: ['json', 'zip'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'ZIP Archive', extensions: ['zip'] },
        ],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { success: false, reason: 'canceled' };

      const filePath = filePaths[0];
      let importedGraph: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };

      if (filePath.endsWith('.zip')) {
        const JSZip = require('jszip');
        const data = fs.readFileSync(filePath);
        const zip = await JSZip.loadAsync(data);
        const jsonFile = zip.file('memory_graph.json');
        if (!jsonFile) return { success: false, error: 'No memory_graph.json found in ZIP' };
        const jsonStr = await jsonFile.async('string');
        importedGraph = JSON.parse(jsonStr);
      } else {
        importedGraph = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      const current = loadMemoryGraph();
      const existingIds = new Set(current.nodes.map((n: any) => n.id));
      const newNodes = (importedGraph.nodes || []).filter((n: any) => !existingIds.has(n.id));
      const existingEdges = new Set(current.edges.map((e: any) => `${e.source}:${e.target}`));
      const newEdges = (importedGraph.edges || []).filter((e: any) => !existingEdges.has(`${e.source}:${e.target}`));

      const merged = {
        nodes: [...current.nodes, ...newNodes],
        edges: [...current.edges, ...newEdges],
      };
      saveMemoryGraph(merged);
      return { success: true, addedNodes: newNodes.length, addedEdges: newEdges.length };
    } catch (err: any) {
      console.error('[IPC] memory:import-merge-graph error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:wipe-account', async () => {
    const everfernDir = path.join(os.homedir(), '.everfern');
    try {
      try {
        const { closeDb } = await import('../../lib/db');
        await closeDb();
        console.log('[IPC] system:wipe-account: main DB closed');
      } catch (dbErr: any) {
        console.warn('[IPC] system:wipe-account: main DB close warning:', dbErr.message);
      }

      try {
        const { closeChatVectorDb } = await import('../../store/chat-vectors');
        await closeChatVectorDb();
        console.log('[IPC] system:wipe-account: chat vector DB closed');
      } catch (vecErr: any) {
        console.warn('[IPC] system:wipe-account: chat vector DB close warning:', vecErr.message);
      }

      try {
        const { toolSettingsStore } = await import('../../store/tool-settings');
        toolSettingsStore.reset();
        console.log('[IPC] system:wipe-account: toolSettingsStore reset to defaults');
      } catch (tsErr: any) {
        console.warn('[IPC] system:wipe-account: toolSettingsStore reset warning:', tsErr.message);
      }

      if (fs.existsSync(everfernDir)) {
        fs.rmSync(everfernDir, { recursive: true, force: true });
      }
      fs.mkdirSync(everfernDir, { recursive: true });

      console.log('[IPC] system:wipe-account: .everfern (including sql databases and tool settings) wiped');
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:wipe-account error:', err);
      return { success: false, error: err.message };
    }
  });
}
