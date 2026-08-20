import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isOcrReady, ensureOcrDeps, runOcrPdf, renderPdfPages, ocrProgressEmitter, OCR_PY_DEPS, OcrEngine, OcrBackend } from '../../ocr/ocr';

export function imageMimeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    pdf: 'application/pdf',
  };
  return map[ext] || null;
}

/**
 * Runs ensureOcrDeps while forwarding 'progress' events to every renderer window
 * via the 'system:ocr-progress' channel, so the UI can show a live progress bar.
 */
export async function installOcrWithProgress(): Promise<{ ok: boolean; message: string }> {
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
    return await ensureOcrDeps();
  } finally {
    ocrProgressEmitter.off('progress', onProgress);
  }
}

/**
 * Opens a real OS terminal window that runs the OCR install script live, so
 * the user can see exactly what pip is doing. Writes a temp script to avoid
 * fragile nested-quote escaping in `start cmd /k "...&& && &&"`.
 */
export function launchOcrInstallTerminal(): boolean {
  try {
    const isWin = process.platform === 'win32';
    const scriptDir = path.join(os.homedir(), '.everfern');
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });

    const barrier = '==============================';
    const headers = [
      barrier,
      ' [EverFern] Installing PDF OCR engine  (PaddleOCR + OpenVINO + OpenVINO)',
      ` Install dir: ~/.everfern/ocr-venv       (count: ${OCR_PY_DEPS.length} packages)`,
      barrier,
      '',
      ' This opens automatically. You can watch live progress below and close',
      ' the window when it finishes. Do NOT close while it is still installing.',
      '',
    ].join('\n');

    if (isWin) {
      const scriptPath = path.join(scriptDir, 'ocr_install.cmd');
      const venv = `%USERPROFILE%\\.everfern\\ocr-venv`;
      const py = `%VENVDIR%\\Scripts\\python.exe`;
      const steps = OCR_PY_DEPS.map((pkg, i) =>
        `echo [${i + 1}/${OCR_PY_DEPS.length}] Installing ${pkg}...\n"%PY%" -m pip install --no-input ${pkg}`).join('\n');
      const body = [
        '@echo off',
        'setlocal',
        'echo ' + barrier.replace(/=/g, '-'),
        `echo  ${barrier}`,
        'echo  [EverFern] Installing PDF OCR packages',
        `echo  Target: %USERPROFILE%\\.everfern\\ocr-venv`,
        'echo ' + barrier.replace(/=/g, '-'),
        '',
        `set "VENVDIR=${venv}"`,
        'if not exist "%VENVDIR%" (',
        '  where py >nul 2>nul && (py -3 -m venv "%VENVDIR%") || (python -m venv "%VENVDIR%")',
        ')',
        'if not exist "%VENVDIR%\\Scripts\\python.exe" (',
        '  echo [ERROR] Could not create Python environment. Install Python 3.9+ from python.org',
        '  pause',
        '  exit /b 1',
        ')',
        'set "PY=%VENVDIR%\\Scripts\\python.exe"',
        'echo.',
        'echo [0] Upgrading pip...',
        '"%PY%" -m pip install --upgrade pip',
        'echo.',
        steps,
        'echo.',
        'echo ' + barrier.replace(/=/g, '-'),
        'echo  DONE. PDF OCR is installed. You can close this window.',
        'echo ' + barrier.replace(/=/g, '-'),
        'pause',
      ].join('\n');
      fs.writeFileSync(scriptPath, body, 'utf-8');
      const { exec } = require('child_process');
      exec(`start "" cmd /k "${scriptPath.replace(/"/g, '""')}"`);
      return true;
    }

    // Unix (macOS / Linux)
    const scriptPath = path.join(scriptDir, 'ocr_install.sh');
    const steps = OCR_PY_DEPS.map((pkg, i) =>
      `echo "[${i + 1}/${OCR_PY_DEPS.length}] Installing ${pkg}..."\n"$PY" -m pip install --no-input ${pkg}`).join('\n');
    const body = [
      '#!/usr/bin/env bash',
      'set -u',
      `VENVDIR="\$HOME/.everfern/ocr-venv"`,
      `PY="\$VENVDIR/bin/python"`,
      headers,
      '[ -e "$VENVDIR" ] || { python3 -m venv "$VENVDIR"; }',
      '[ -x "$PY" ] || { echo "[ERROR] Could not create Python environment."; read -p "Press Enter to close"; exit 1; }',
      'echo',
      'echo "[0/..] Upgrading pip..."',
      '"$PY" -m pip install --upgrade pip',
      'echo',
      steps,
      'echo',
      'echo ==============================',
      'echo  DONE. PDF OCR is installed. You can close this window.',
      'echo ==============================',
      'read -p "Press Enter to close..."',
    ].join('\n') + '\n';
    fs.writeFileSync(scriptPath, body, 'utf-8');
    fs.chmodSync(scriptPath, 0o755);
    const { exec } = require('child_process');
    const escaped = scriptPath.replace(/"/g, '\\"');
    if (process.platform === 'darwin') {
      exec(`osascript -e 'tell app "Terminal" to do script "bash \\"${escaped}\\"" activate'`);
    } else {
      exec(`which gnome-terminal 2>/dev/null`, (err: any, stdout: string) => {
        const openCmd = stdout.trim() ? `gnome-terminal -- bash "${escaped}"` : `xterm -e bash "${escaped}"`;
        exec(openCmd);
      });
    }
    return true;
  } catch (err) {
    console.error('[System] Failed to launch OCR install terminal:', err);
    return false;
  }
}

export function registerOcrDocHandlers(): void {
  ipcMain.handle('system:ocr-status', async () => {
    return { ready: isOcrReady() };
  });

  ipcMain.handle('system:ocr-install', async () => {
    launchOcrInstallTerminal();
    return await installOcrWithProgress();
  });

  ipcMain.handle('system:ocr-pdf', async (_event, params?: { pdfPath: string; engine?: OcrEngine; backend?: OcrBackend; installIfMissing?: boolean }) => {
    try {
      if (!params?.pdfPath) {
        console.warn('[IPC] system:ocr-pdf called with no pdfPath');
        return { status: 'error', text: '', engine: 'paddleocr', backend: 'auto', error: 'No PDF path provided.' };
      }
      let engine: OcrEngine = 'ocrmypdf';
      if (params.engine === 'tesseract' || params.engine === 'paddleocr' || params.engine === 'paddleocr-vl' || params.engine === 'vision-send' || params.engine === 'ocrmypdf') {
        engine = params.engine;
      }
      const backend: OcrBackend = params.backend === 'openvino' ? 'openvino' : 'auto';
      console.log(`[IPC] system:ocr-pdf started for: ${params.pdfPath} (engine: ${engine}, backend: ${backend})`);

      if (!isOcrReady()) {
        console.log('[IPC] OCR environment not ready, checking installIfMissing:', params.installIfMissing);
        if (params.installIfMissing) {
          const install = await installOcrWithProgress();
          if (!install.ok) {
            console.warn('[IPC] OCR installation failed:', install.message);
            return { status: 'skipped', text: '', engine, backend, error: install.message };
          }
        } else {
          console.warn('[IPC] OCR environment not installed and installIfMissing is false');
          return { status: 'skipped', text: '', engine, backend, error: 'OCR environment not installed.' };
        }
      }

      const startTime = Date.now();
      const result = await runOcrPdf(params.pdfPath, engine, backend);
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[IPC] system:ocr-pdf finished in ${durationSec}s → ${result.status} (chars: ${result.text?.length || 0})`);
      return result;
    } catch (err: any) {
      console.error('[IPC] Error in system:ocr-pdf:', err);
      return { status: 'error', text: '', engine: 'paddleocr', backend: 'auto', error: err.message };
    }
  });

  ipcMain.handle('system:pdf-pages', async (_event, params?: { pdfPath: string; maxPages?: number; installIfMissing?: boolean }) => {
    try {
      if (!params?.pdfPath) {
        console.warn('[IPC] system:pdf-pages called with no pdfPath');
        return { ok: false, pages: [], totalPages: 0, rendered: 0, error: 'No PDF path provided.' };
      }
      console.log(`[IPC] system:pdf-pages started for: ${params.pdfPath} (maxPages: ${params.maxPages || 30})`);
      if (!isOcrReady()) {
        console.log('[IPC] OCR environment not ready for pdf-pages, checking installIfMissing:', params.installIfMissing);
        if (params.installIfMissing) {
          const install = await installOcrWithProgress();
          if (!install.ok) {
            console.warn('[IPC] OCR installation failed for pdf-pages:', install.message);
            return { ok: false, pages: [], totalPages: 0, rendered: 0, error: install.message };
          }
        } else {
          return { ok: false, pages: [], totalPages: 0, rendered: 0, error: 'OCR environment not installed.' };
        }
      }
      const startTime = Date.now();
      const result = await renderPdfPages(params.pdfPath, params.maxPages || 30);
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[IPC] system:pdf-pages finished in ${durationSec}s → ${result.rendered}/${result.totalPages} pages`);
      return { ok: true, ...result };
    } catch (err: any) {
      console.error('[IPC] Error in system:pdf-pages:', err);
      return { ok: false, pages: [], totalPages: 0, rendered: 0, error: err.message };
    }
  });

  ipcMain.handle('system:read-image-data-url', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'No image path provided' };
      }

      const resolved = path.resolve(filePath);
      const mimeType = imageMimeFromPath(resolved);
      if (!mimeType) {
        return { success: false, error: 'Unsupported image file type' };
      }

      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }

      const stat = fs.statSync(resolved);
      const maxPreviewBytes = 32 * 1024 * 1024;
      if (!stat.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }
      if (stat.size > maxPreviewBytes) {
        return { success: false, error: 'Image is too large to preview inline', size: stat.size };
      }

      const base64 = fs.readFileSync(resolved).toString('base64');
      return {
        success: true,
        path: resolved,
        mimeType,
        size: stat.size,
        dataUrl: `data:${mimeType};base64,${base64}`,
      };
    } catch (err: any) {
      console.error('[IPC] system:read-image-data-url error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('system:ensure-attachment-in-vm', async (_event, filePath: string) => {
    if (process.platform !== 'win32') return { success: true };
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const wslAttachmentsDir = `/everfern`;
      const safeFileName = path.basename(filePath);
      const existingTarget = `\\\\wsl.localhost\\Ubuntu\\everfern\\${safeFileName}`;

      // Skip if already cloned
      if (fs.existsSync(existingTarget)) return { success: true };

      const toWslPath = (winPath: string) => {
        const match = winPath.match(/^([A-Za-z]):[/\\](.*)$/);
        if (match) {
          const drive = match[1].toLowerCase();
          const rest = match[2].replace(/\\/g, '/');
          return `/mnt/${drive}/${rest}`;
        }
        return winPath.replace(/\\/g, '/');
      };
      const wslSourcePath = toWslPath(filePath);

      await execAsync(`wsl.exe --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
      console.log('[IPC] Attachment cloned to Linux VM:', existingTarget);
      return { success: true };
    } catch (err: any) {
      console.warn('[IPC] Failed to clone attachment to Linux VM (non-fatal):', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:parse-pptx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-pptx-'));
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const isWin = process.platform === 'win32';
      if (isWin) {
        const zipPath = path.join(tempDir, 'temp.zip');
        fs.copyFileSync(filePath, zipPath);
        const escapedZipPath = zipPath.replace(/'/g, "''");
        const escapedTempDir = tempDir.replace(/'/g, "''");
        const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
        await execAsync(cmd);
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
      } else {
        const { execFile } = require('child_process');
        const execFileAsync = promisify(execFile);
        await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
      }

      const slidesDir = path.join(tempDir, 'ppt', 'slides');
      if (!fs.existsSync(slidesDir)) {
        return { success: false, error: 'Invalid presentation file: missing ppt/slides directory' };
      }

      const slideFiles = fs.readdirSync(slidesDir)
        .filter(file => file.startsWith('slide') && file.endsWith('.xml'))
        .sort((a, b) => {
          const numA = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
          const numB = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
          return numA - numB;
        });

      if (slideFiles.length === 0) {
        return { success: true, slides: [] };
      }

      const decodeXmlEntities = (str: string): string => {
        return str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#x9;/g, '\t')
          .replace(/&#xA;/g, '\n')
          .replace(/&#xD;/g, '\r')
          .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      };

      const slides = [];
      for (const slideFile of slideFiles) {
        const slidePath = path.join(slidesDir, slideFile);
        const xmlContent = fs.readFileSync(slidePath, 'utf8');

        const shapeRegex = /<p:sp>([\s\S]*?)<\/p:sp>/g;
        let shapeMatch;
        const shapes = [];

        while ((shapeMatch = shapeRegex.exec(xmlContent)) !== null) {
          const shapeXml = shapeMatch[1];
          const phRegex = /<p:ph[^>]*?type="([^"]+)"/;
          const nameRegex = /<p:cNvPr[^>]*?name="([^"]+)"/;

          const phMatch = shapeXml.match(phRegex);
          const nameMatch = shapeXml.match(nameRegex);

          const phType = phMatch ? phMatch[1].toLowerCase() : '';
          const name = nameMatch ? nameMatch[1].toLowerCase() : '';

          let role: 'title' | 'subtitle' | 'body' | 'unknown' = 'unknown';
          if (phType === 'title' || phType === 'ctrtitle' || name.includes('title')) {
            role = 'title';
          } else if (phType === 'subtitle' || name.includes('subtitle')) {
            role = 'subtitle';
          } else if (phType === 'body' || phType === 'obj' || name.includes('placeholder') || name.includes('content')) {
            role = 'body';
          }

          const pRegex = /<a:p>([\s\S]*?)<\/a:p>/g;
          let pMatch;
          const paragraphs = [];

          while ((pMatch = pRegex.exec(shapeXml)) !== null) {
            const pXml = pMatch[1];
            const tRegex = /<a:t>([^<]*?)<\/a:t>/g;
            let tMatch;
            let pText = '';
            while ((tMatch = tRegex.exec(pXml)) !== null) {
              pText += tMatch[1];
            }
            pText = decodeXmlEntities(pText).trim();
            if (pText) {
              paragraphs.push(pText);
            }
          }

          if (paragraphs.length > 0) {
            shapes.push({ role, paragraphs });
          }
        }

        let title = '';
        let subtitle = '';
        const points: string[] = [];

        const titleShape = shapes.find(s => s.role === 'title');
        const subtitleShape = shapes.find(s => s.role === 'subtitle');

        if (titleShape) {
          title = titleShape.paragraphs.join(' ');
        }
        if (subtitleShape) {
          subtitle = subtitleShape.paragraphs.join(' ');
        }

        shapes.forEach(s => {
          if (s !== titleShape && s !== subtitleShape) {
            if (s.role === 'body') {
              points.push(...s.paragraphs);
            }
          }
        });

        if (!title && shapes.length > 0) {
          const firstShape = shapes[0];
          title = firstShape.paragraphs.join(' ');
          if (shapes.length > 1) {
            shapes.slice(1).forEach(s => {
              points.push(...s.paragraphs);
            });
          }
        } else {
          shapes.forEach(s => {
            if (s !== titleShape && s !== subtitleShape && s.role !== 'body') {
              points.push(...s.paragraphs);
            }
          });
        }

        slides.push({
          title,
          subtitle,
          points
        });
      }

      return { success: true, slides };
    } catch (err: any) {
      console.error('[PPTXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn('[PPTXParser] cleanup failed:', cleanErr);
      }
    }
  });

  ipcMain.handle('system:parse-docx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    try {
      let xmlContent = '';

      // 1. Try in-memory extraction via AdmZip
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(filePath);
        const entry = zip.getEntry('word/document.xml');
        if (entry) {
          xmlContent = entry.getData().toString('utf8');
        }
      } catch (zipErr) {
        console.warn('[DOCXParser] AdmZip extraction failed, attempting fallback:', zipErr);
      }

      // 2. Fallback to Expand-Archive / unzip if needed
      if (!xmlContent) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-docx-'));
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);

          const isWin = process.platform === 'win32';
          if (isWin) {
            const zipPath = path.join(tempDir, 'temp.zip');
            fs.copyFileSync(filePath, zipPath);
            const escapedZipPath = zipPath.replace(/'/g, "''");
            const escapedTempDir = tempDir.replace(/'/g, "''");
            const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
            await execAsync(cmd);
          } else {
            const { execFile } = require('child_process');
            const execFileAsync = promisify(execFile);
            await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
          }

          const docXmlPath = path.join(tempDir, 'word', 'document.xml');
          if (fs.existsSync(docXmlPath)) {
            xmlContent = fs.readFileSync(docXmlPath, 'utf8');
          }
        } finally {
          try {
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          } catch {}
        }
      }

      if (!xmlContent) {
        return { success: false, error: 'Invalid document file: missing word/document.xml' };
      }

      const decodeXmlEntities = (str: string): string => {
        return str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      };

      const pRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      let pMatch;
      const paragraphs: string[] = [];

      while ((pMatch = pRegex.exec(xmlContent)) !== null) {
        const pXml = pMatch[1];
        const tRegex = /<w:t[^>]*>([^<]*?)<\/w:t>/g;
        let tMatch;
        let pText = '';
        while ((tMatch = tRegex.exec(pXml)) !== null) {
          pText += tMatch[1];
        }
        
        pText = decodeXmlEntities(pText).trim();
        if (pText) {
          paragraphs.push(pText);
        }
      }

      return { success: true, text: paragraphs.join('\n\n') };
    } catch (err: any) {
      console.error('[DOCXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('system:parse-xlsx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-xlsx-'));
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const isWin = process.platform === 'win32';
      if (isWin) {
        const zipPath = path.join(tempDir, 'temp.zip');
        fs.copyFileSync(filePath, zipPath);
        const escapedZipPath = zipPath.replace(/'/g, "''");
        const escapedTempDir = tempDir.replace(/'/g, "''");
        const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
        await execAsync(cmd);
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
      } else {
        const { execFile } = require('child_process');
        const execFileAsync = promisify(execFile);
        await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
      }

      const sharedStrings: string[] = [];
      const sharedStringsPath = path.join(tempDir, 'xl', 'sharedStrings.xml');
      if (fs.existsSync(sharedStringsPath)) {
        const xml = fs.readFileSync(sharedStringsPath, 'utf8');
        const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let match;
        const decodeXmlEntities = (str: string): string => {
          return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
            .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        };
        while ((match = tRegex.exec(xml)) !== null) {
          sharedStrings.push(decodeXmlEntities(match[1]));
        }
      }

      const sheet1Path = path.join(tempDir, 'xl', 'worksheets', 'sheet1.xml');
      if (!fs.existsSync(sheet1Path)) {
        return { success: false, error: 'Invalid spreadsheet: missing xl/worksheets/sheet1.xml' };
      }

      const xml = fs.readFileSync(sheet1Path, 'utf8');
      const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch;
      const grid: string[][] = [];

      const colRefToIndex = (ref: string): number => {
        const letters = ref.replace(/[0-9]/g, '');
        let index = 0;
        for (let i = 0; i < letters.length; i++) {
          index = index * 26 + (letters.charCodeAt(i) - 64);
        }
        return index - 1;
      };

      while ((rowMatch = rowRegex.exec(xml)) !== null) {
        const rowXml = rowMatch[1];
        const cellRegex = /<c r="([^"]+)"[^>]*?(?:t="([^"]+)")?>([\s\S]*?)<\/c>/g;
        let cellMatch;
        const rowCells: string[] = [];

        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const ref = cellMatch[1];
          const t = cellMatch[2] || '';
          const innerXml = cellMatch[3];

          const vRegex = /<v>([\s\S]*?)<\/v>/;
          const vMatch = innerXml.match(vRegex);
          let val = '';

          if (vMatch) {
            const rawVal = vMatch[1];
            if (t === 's') {
              const idx = parseInt(rawVal, 10);
              val = sharedStrings[idx] || '';
            } else {
              val = rawVal;
            }
          }

          const colIdx = colRefToIndex(ref);
          rowCells[colIdx] = val;
        }

        for (let i = 0; i < rowCells.length; i++) {
          if (rowCells[i] === undefined) {
            rowCells[i] = '';
          }
        }
        grid.push(rowCells);
      }

      const csvLines = grid.map(row => 
        row.map(cell => {
          const escaped = cell.replace(/"/g, '""');
          if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
            return `"${escaped}"`;
          }
          return escaped;
        }).join(',')
      );

      return { success: true, csv: csvLines.join('\n') };
    } catch (err: any) {
      console.error('[XLSXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn('[XLSXParser] cleanup failed:', cleanErr);
      }
    }
  });
}
