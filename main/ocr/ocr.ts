import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OcrProgressEvent {
  percent: number;
  step: string;
  detail: string;
}

/** Emits 'progress' events (OcrProgressEvent) while OCR deps are being installed. */
export const ocrProgressEmitter = new EventEmitter();

function emitOcrProgress(percent: number, step: string, detail: string): void {
  ocrProgressEmitter.emit('progress', { percent, step, detail });
}

export type OcrEngine = 'ocrmypdf' | 'tesseract' | 'paddleocr' | 'paddleocr-vl' | 'vision-send';
export type OcrBackend = 'auto' | 'openvino';

export interface OcrRunResult {
  status: 'ok' | 'no_text' | 'error' | 'skipped';
  text: string;
  engine: OcrEngine;
  backend: OcrBackend;
  error?: string;
}

export interface PdfPageImage {
  name: string;
  base64: string; // data URI
  width: number;
  height: number;
}

export const OCR_SCRIPT_FILE = 'ocr_pdf.py';

// Python dependencies installed into ~/.everfern/ocr-venv
export const OCR_PY_DEPS = [
  'ocrmypdf',
  'pytesseract',
  'pillow',
  'pymupdf',
  'paddleocr',
  'paddlepaddle',
  'openvino',
  'numpy',
  'opencv-python-headless',
];

export function getOcrVenvDir(): string {
  return path.join(os.homedir(), '.everfern', 'ocr-venv');
}

export function getOcrPythonBin(): string {
  const venvDir = getOcrVenvDir();
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

export function getOcrScriptPath(): string {
  const candidates = [
    path.join(__dirname, OCR_SCRIPT_FILE),
    path.join(__dirname, '..', '..', 'main', 'ocr', OCR_SCRIPT_FILE),
    path.join(process.cwd(), 'main', 'ocr', OCR_SCRIPT_FILE),
    path.join(process.cwd(), 'dist-electron', 'main', 'ocr', OCR_SCRIPT_FILE),
    path.join(os.homedir(), '.everfern', OCR_SCRIPT_FILE),
    ...(process.resourcesPath ? [
      path.join(process.resourcesPath, 'ocr', OCR_SCRIPT_FILE),
      path.join(process.resourcesPath, 'main', 'ocr', OCR_SCRIPT_FILE),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'ocr', OCR_SCRIPT_FILE),
    ] : []),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (c.includes('app.asar') && !c.includes('app.asar.unpacked')) {
        try {
          const dest = path.join(os.homedir(), '.everfern', OCR_SCRIPT_FILE);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, fs.readFileSync(c));
          return dest;
        } catch {
          // continue
        }
      }
      return c;
    }
  }

  return path.join(os.homedir(), '.everfern', OCR_SCRIPT_FILE);
}

export function isOcrReady(): boolean {
  return fs.existsSync(getOcrPythonBin());
}

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        console.warn(`[OCR Python] Process timed out after ${timeoutMs}ms: ${cmd} ${args.slice(0, 2).join(' ')}`);
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      // Log progress lines from OCR Python
      const trimmed = text.trim();
      if (trimmed && !trimmed.startsWith('[EVERFERN_OCR')) {
        console.log(`[OCR Python stdout] ${trimmed.slice(0, 200)}`);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      const trimmed = text.trim();
      if (trimmed) {
        console.log(`[OCR Python stderr] ${trimmed.slice(0, 200)}`);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[OCR Python] Spawn error:`, err);
      resolve({ code: -1, stdout, stderr: stderr + `\nSpawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Creates the OCR virtualenv (if missing) and installs the Python OCR packages,
 * mirroring how the Linux VM installs its core Python deps.
 * Returns { ok, message }.
 */
export async function ensureOcrDeps(): Promise<{ ok: boolean; message: string }> {
  const venvDir = getOcrVenvDir();
  const pythonBin = getOcrPythonBin();

  try {
    if (!fs.existsSync(venvDir)) {
      emitOcrProgress(4, 'Bootstrap', 'Locating a Python interpreter to create the OCR environment...');
      // Locate a system Python to bootstrap the venv.
      const candidates: Array<[string, string[]]> = process.platform === 'win32'
        ? [['py', ['-3', '-c', 'import sys;print(sys.executable)']], ['python', ['-c', 'import sys;print(sys.executable)']]]
        : [['python3', ['-c', 'import sys;print(sys.executable)']], ['python', ['-c', 'import sys;print(sys.executable)']]];
      let basePython: string | null = null;
      for (const [cmd, args] of candidates) {
        const r = await runCapture(cmd, args, 15000);
        if (r.code === 0 && r.stdout.trim()) {
          basePython = r.stdout.trim().split(/\r?\n/)[0];
          break;
        }
      }
      if (!basePython) {
        return { ok: false, message: 'No Python found to bootstrap the OCR environment. Install Python 3.9+ first (getpython.org).' };
      }
      emitOcrProgress(12, 'Bootstrap', `Creating virtual environment at ~/.everfern/ocr-venv (using ${basePython})...`);
      const create = await runCapture(basePython, ['-m', 'venv', venvDir], 120000);
      if (create.code !== 0) {
        return { ok: false, message: `Failed to create OCR venv: ${create.stderr}`.trim() };
      }
    }

    if (!fs.existsSync(pythonBin)) {
      return { ok: false, message: 'OCR venv missing Python binary.' };
    }

    emitOcrProgress(30, 'Preparing', 'Upgrading pip in the OCR environment...');
    const upgrade = await runCapture(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], 120000);
    if (upgrade.code !== 0) {
      // Not fatal — continue to install deps.
      console.warn('[OCR] pip upgrade failed (non-fatal):', upgrade.stderr);
    }

    // Install packages one at a time so we can report real per-package progress.
    const total = OCR_PY_DEPS.length;
    let failed: string[] = [];
    for (let i = 0; i < total; i++) {
      const pkg = OCR_PY_DEPS[i];
      const progressBase = 30;
      const progressSpan = 68;
      const startPercent = Math.round(progressBase + (i / total) * progressSpan);
      const endPercent = Math.round(progressBase + ((i + 1) / total) * progressSpan);
      emitOcrProgress(startPercent, 'Installing', `Installing ${pkg} (${i + 1} of ${total})...`);
      const res = await runCapture(pythonBin, ['-m', 'pip', 'install', '--no-input', pkg], 1200000);
      if (res.code !== 0) {
        failed.push(pkg);
        console.warn(`[OCR] Failed to install ${pkg}:`, res.stderr.slice(-500));
      }
      emitOcrProgress(endPercent, 'Installing', `${pkg} ${res.code === 0 ? 'installed' : 'failed'}`);
    }

    if (failed.length === total) {
      return { ok: false, message: `OCR dependency install failed: ${failed.join(', ')}` };
    }

    // Check for native Tesseract binary
    emitOcrProgress(96, 'Checking Tesseract', 'Checking system Tesseract OCR engine...');
    if (process.platform === 'win32') {
      const tessExists = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tesseract-OCR', 'tesseract.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tesseract-OCR', 'tesseract.exe'),
        path.join(os.homedir(), '.everfern', 'tesseract', 'tesseract.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Tesseract-OCR', 'tesseract.exe'),
      ].some(p => fs.existsSync(p));

      if (!tessExists) {
        emitOcrProgress(97, 'Tesseract', 'Checking Tesseract OCR installer...');
        const setupPath = path.join(os.homedir(), '.everfern', 'tesseract-setup.exe');
        try {
          // If a previous corrupt or partial file exists (< 10MB), delete it
          if (fs.existsSync(setupPath)) {
            try {
              const stat = fs.statSync(setupPath);
              if (stat.size < 10 * 1024 * 1024) {
                fs.unlinkSync(setupPath);
              }
            } catch {}
          }

          if (!fs.existsSync(setupPath)) {
            emitOcrProgress(97, 'Tesseract', 'Downloading Tesseract OCR installer...');
            const https = require('https');
            await new Promise<void>((resolve, reject) => {
              const file = fs.createWriteStream(setupPath);
              let settled = false;

              const cleanup = (err: any) => {
                if (settled) return;
                settled = true;
                file.destroy();
                try { if (fs.existsSync(setupPath)) fs.unlinkSync(setupPath); } catch {}
                reject(err);
              };

              const req = (url: string) => {
                https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res: any) => {
                  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    req(res.headers.location);
                    return;
                  }
                  if (res.statusCode !== 200) {
                    cleanup(new Error(`Download failed with status ${res.statusCode}`));
                    return;
                  }
                  res.pipe(file);
                  file.on('finish', () => {
                    file.close((err: any) => {
                      if (err) cleanup(err);
                      else {
                        settled = true;
                        resolve();
                      }
                    });
                  });
                }).on('error', cleanup);
              };

              req('https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe');
            });
          }

          // Verify installer exists and has valid size (> 10MB) before launching
          if (fs.existsSync(setupPath) && fs.statSync(setupPath).size > 10 * 1024 * 1024) {
            emitOcrProgress(98, 'Tesseract', 'Launching Tesseract installer...');
            const { spawn } = require('child_process');
            try {
              const child = spawn(setupPath, ['/VERYSILENT', '/NORESTART'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
              });
              child.on('error', (spawnErr: any) => {
                console.warn('[OCR] Auto-downloaded Tesseract installer execution skipped (non-fatal):', spawnErr?.message || spawnErr);
              });
              child.unref();
            } catch (err: any) {
              console.warn('[OCR] Failed to spawn Tesseract installer (non-fatal):', err?.message || err);
            }
          } else {
            console.warn('[OCR] Tesseract installer file not ready or invalid size, skipping launch.');
          }
        } catch (tessErr) {
          console.warn('[OCR] Auto-downloading Tesseract failed (non-fatal):', tessErr);
        }
      }
    }

    emitOcrProgress(99, 'Finalizing', 'Verifying the OCR environment...');
    emitOcrProgress(100, 'Done', 'OCR dependencies ready.');
    return { ok: true, message: failed.length > 0
      ? `OCR dependencies installed (${total - failed.length}/${total}). Skipped: ${failed.join(', ')}`
      : 'OCR dependencies ready.' };
  } catch (e) {
    return { ok: false, message: `OCR setup error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Runs the bundled OCR script against a PDF.
 * Returns the recognized text (or a no-text/error status) to forward to the LLM.
 */
export async function runOcrPdf(
  pdfPath: string,
  engine: OcrEngine = 'ocrmypdf',
  backend: OcrBackend = 'auto',
): Promise<OcrRunResult> {
  if (!isOcrReady()) {
    return { status: 'skipped', text: '', engine, backend, error: 'OCR environment not installed.' };
  }
  if (!fs.existsSync(pdfPath)) {
    return { status: 'error', text: '', engine, backend, error: 'PDF not found.' };
  }

  const script = getOcrScriptPath();
  const res = await runCapture(getOcrPythonBin(), [script, pdfPath, engine, backend], 300000);

  // Find the self-terminating result marker (may be surrounded by model noise).
  const lines = res.stdout.split(/\r?\n/);
  let marker = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[EVERFERN_OCR')) {
      marker = lines[i];
      break;
    }
  }
  if (!marker) {
    return { status: 'error', text: '', engine, backend, error: (res.stderr || res.stdout || 'OCR produced no result.').trim().slice(-1000) };
  }

  if (marker.startsWith('[EVERFERN_OCR_ERROR')) {
    return { status: 'error', text: '', engine, backend, error: marker.replace('[EVERFERN_OCR_ERROR', '').replace(/\]\s*$/, '').trim() };
  }
  if (marker.startsWith('[EVERFERN_OCR_NO_TEXT')) {
    return { status: 'no_text', text: '', engine, backend };
  }

  const payload = marker.replace(/^\[EVERFERN_OCR\|[^|]+\|[^|]+\|\d+\]\s?/, '').trim();
  if (!payload) {
    return { status: 'no_text', text: '', engine, backend };
  }
  return { status: 'ok', text: payload, engine, backend };
}

/**
 * "Vision Send" mode: renders each PDF page to a PNG and returns the pages as
 * data-URI images so the renderer can send them straight to the AI (no OCR).
 * Returns { pages, totalPages, rendered } or throws on failure.
 */
export async function renderPdfPages(
  pdfPath: string,
  maxPages = 30,
): Promise<{ pages: PdfPageImage[]; totalPages: number; rendered: number }> {
  if (!isOcrReady()) {
    throw new Error('OCR environment not installed.');
  }
  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF not found.');
  }

  const outDir = path.join(os.tmpdir(), `everfern-pdf-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const script = getOcrScriptPath();
  const res = await runCapture(getOcrPythonBin(), [script, 'render', pdfPath, outDir, String(maxPages)], 180000);

  // Parse the self-terminating marker: [EVERFERN_RENDER|<total>|<written>]
  const lines = res.stdout.split(/\r?\n/);
  let marker = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[EVERFERN_RENDER')) {
      marker = lines[i];
      break;
    }
  }
  if (!marker || marker.includes('ERROR')) {
    const err = (res.stderr || res.stdout || 'Render produced no result.').trim().slice(-800);
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    throw new Error(marker.includes('ERROR') ? marker : err);
  }

  const parsed = marker.replace(/^\[EVERFERN_RENDER\|/, '').replace(/\]\s*$/, '').split('|');
  const totalPages = Number(parsed[0]) || 0;
  const written = Number(parsed[1]) || 0;

  const pages: PdfPageImage[] = [];
  try {
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png')).sort();
    for (const f of files) {
      const full = path.join(outDir, f);
      const data = fs.readFileSync(full);
      const mime = 'image/png';
      // Dims are stored implicitly; match by name from marker isn't needed—just attach.
      let width = 0;
      let height = 0;
      // PNG width/height at bytes 16-23 (IHDR), big-endian.
      if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47) {
        width = data.readUInt32BE(16);
        height = data.readUInt32BE(20);
      }
      pages.push({ name: f, base64: `data:${mime};base64,${data.toString('base64')}`, width, height });
    }
  } catch (e) {
    throw new Error(`Failed reading rendered pages: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  return { pages, totalPages, rendered: written };
}