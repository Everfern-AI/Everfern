import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import { ensureOcrDeps } from '../../ocr/ocr';
import { ALPINE_DISTRO, ALPINE_CONTAINER, isAlpineInstalled, installAlpineVM, alpineProvisionScript, provisionAlpine } from './alpine-vm';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Result shape matching the existing pi-tools terminal output format
 */
export interface LinuxVMExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Commands considered read-only by their first token. When the Linux VM
 * (WSL/Docker) is unavailable, ONLY these may fall back to native host
 * execution; anything else must never silently run on the host.
 *
 * DRIFT GUARD: pi-tools.ts keeps a local mirror of this set (READ_ONLY_HEADS,
 * above its executePwsh adapter) because test suites may mock this module —
 * any change here MUST be mirrored there and vice versa. This file's copy is
 * the exported reference.
 */
export const READ_ONLY_HEADS: ReadonlySet<string> = new Set([
  'dir', 'type', 'cat', 'ls', 'pwd', 'whoami', 'hostname', 'which',
  'head', 'tail', 'wc', 'find', 'grep', 'echo', 'uname', 'df'
]);

function getCommandHead(command: string): string {
  return command.trim().toLowerCase().split(/\s+/)[0];
}

function quoteBashArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Thin wrapper that runs any shell command in a Linux VM environment.
 *
 * Platform-specific implementations:
 * - Windows: the EverFern-Alpine WSL 2 distro via `wsl.exe -d EverFern-Alpine --exec bash -c "<cmd>"`
 * - macOS: the everfern-alpine Docker container via `docker exec everfern-alpine bash -c "<cmd>"`
 * - Linux: Falls back to native execution (already Linux)
 *
 * This executor returns stdout/stderr in the same shape as the existing pi-tools terminal output.
 *
 * Features:
 * - Live streaming of command output via onUpdate callback
 * - Sudo support with automatic detection and handling
 * - Full curl/wget support for downloads
 * - UTF-8 output handling
 * - ANSI escape code stripping
 *
 * @param command - The shell command to execute in the Linux VM
 * @param cwd - Optional working directory (will be translated to appropriate path if needed)
 * @param onUpdate - Optional callback for real-time output streaming
 * @returns Promise resolving to stdout, stderr, and exitCode
 */
export async function runInLinuxVM(
  command: string,
  cwd?: string,
  onUpdate?: (chunk: string) => void
): Promise<LinuxVMExecutionResult> {
  const platform = process.platform;
  console.log(`[runInLinuxVM] Platform=${platform}, command="${command.slice(0, 100)}...", cwd="${cwd || '(none)'}"`);

  try {
    switch (platform) {
      case 'win32':
        console.log('[runInLinuxVM] Platform=win32 → running in Alpine (WSL)');
        return await runInWSL(command, cwd, onUpdate);
      case 'darwin':
        console.log('[runInLinuxVM] Platform=darwin → running in Docker');
        return await runInDocker(command, cwd, onUpdate);
      case 'linux':
        console.log('[runInLinuxVM] Platform=linux → running natively');
        return await runNatively(command, cwd, onUpdate);
      default:
        console.warn(`[runInLinuxVM] Unsupported platform ${platform}, falling back to native execution`);
        return await runNatively(command, cwd, onUpdate);
    }
  } catch (error) {
    if (!READ_ONLY_HEADS.has(getCommandHead(command))) {
      console.warn(`[VMExecutor] VM unavailable — blocking host fallback for non-read-only command "${getCommandHead(command)}": ${error}`);
      return {
        stdout: '',
        stderr: `Linux VM (WSL/Docker) is not available. Start WSL/Docker or re-run with target main. (Original error: ${error})`,
        exitCode: -1
      };
    }
    console.log('[VMExecutor] VM unavailable — read-only fallback on host');
    return await runNatively(command, cwd, onUpdate);
  }
}

/**
 * Runs command in WSL (Windows Subsystem for Linux)
 */
let _wslCmdCache: string | null = null;

let _wslIdleTimeout: NodeJS.Timeout | null = null;
const WSL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function resetWslIdleTimer() {
  if (process.platform !== 'win32') return;
  if (_wslIdleTimeout) clearTimeout(_wslIdleTimeout);
  _wslIdleTimeout = setTimeout(() => {
    console.log('[WSL] Idle for 10 minutes, shutting down WSL to save RAM...');
    const { exec } = require('child_process');
    exec('wsl.exe --shutdown', (err: any) => {
      if (err) console.error('[WSL] Shutdown failed:', err);
      else console.log('[WSL] Shutdown successful.');
    });
  }, WSL_IDLE_TIMEOUT_MS);
}

function getWslCmd(): string {
  if (_wslCmdCache) return _wslCmdCache;
  try {
    const { execSync } = require('child_process');
    execSync('where wsl.exe', { stdio: 'ignore', timeout: 3000 });
    _wslCmdCache = 'wsl.exe';
  } catch {
    _wslCmdCache = 'wsl';
  }
  return _wslCmdCache;
}

/**
 * Ensures WSL has python3, pip, and ~/.everfern/ with a Python venv set up.
 * Runs once per process. Errors are caught and logged — never thrown,
 * so a setup failure won't cascade into a native CMD fallback.
 */
export function broadcastVMSetupLog(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info', step?: number) {
  try {
    const { BrowserWindow } = require('electron');
    const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).toLowerCase();
    const logData = {
      timestamp: timeStr,
      message,
      level,
      step
    };
    BrowserWindow.getAllWindows().forEach((win: any) => {
      win.webContents?.send?.('system:vm-setup-log', logData);
    });
  } catch {}
}

let _wslSetupDone = false;
let _wslSetupPromise: Promise<boolean> | null = null;
let _cachedDistroName: string | null = null;

export const CORE_PYTHON_DEPS = 'pypdf pdfplumber openpyxl python-pptx pandas python-docx matplotlib numpy requests beautifulsoup4 reportlab weasyprint';
export const CORE_NODE_DEPS = 'pptxgenjs pdf-lib exceljs typescript ts-node';

export function parseWSLDistroList(output: string): string[] {
  return output
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .split(/[\r\n]+/)
    .map((name) => name.trim().replace(/^\*\s*/, ''))
    .filter((name) => Boolean(name) && !/^docker-desktop(?:-data)?$/i.test(name));
}

export function decodeWSLOutput(output: Buffer | string): string {
  if (typeof output === 'string') return output;
  const hasUtf16Bom = output.length >= 2 && output[0] === 0xff && output[1] === 0xfe;
  const sampleLength = Math.min(output.length, 200);
  let oddNulls = 0;
  for (let i = 1; i < sampleLength; i += 2) {
    if (output[i] === 0) oddNulls++;
  }
  const looksUtf16 = hasUtf16Bom || oddNulls > Math.max(2, sampleLength / 8);
  return output.toString(looksUtf16 ? 'utf16le' : 'utf8');
}

async function discoverWSLDistro(): Promise<string | null> {
  if (_cachedDistroName) return _cachedDistroName;
  if (await isAlpineInstalled()) {
    _cachedDistroName = ALPINE_DISTRO;
    return ALPINE_DISTRO;
  }
  return null;
}

/** Every WSL call targets EverFern's Alpine distro, never the user's default one. */
async function getTargetWSLArgs(extraArgs: string[]): Promise<string[]> {
  return ['--distribution', ALPINE_DISTRO, ...extraArgs];
}

interface WslToolchain {
  reachable: boolean;
  python3: boolean;
  node: boolean;
  venv: boolean;
  npm: boolean;
  curl: boolean;
  pythonVersion?: string;
  nodeVersion?: string;
  error?: string;
}

/**
 * Probes the WSL distro for python3 / node independently so a missing tool
 * never masks the other, and retries once in case the distro was still
 * booting on first launch. Results are parsed from explicit PY=/NODE= lines.
 */
async function checkWslToolchain(): Promise<WslToolchain> {
  const script = [
    `printf 'PY=%s\\n' "$(command -v python3 >/dev/null 2>&1 && echo yes || echo no)"`,
    `printf 'PY3BIN=%s\\n' "$(command -v python3 2>/dev/null | tr -d '\\r\\n')"`,
    `printf 'PYVER=%s\\n' "$(python3 -V 2>/dev/null | tr -d '\\r\\n')"`,
    `printf 'NODE=%s\\n' "$(command -v node >/dev/null 2>&1 && echo yes || echo no)"`,
    `printf 'NODEBIN=%s\\n' "$(command -v node 2>/dev/null | tr -d '\\r\\n')"`,
    `printf 'NODEVER=%s\\n' "$(node -v 2>/dev/null | tr -d '\\r\\n')"`,
    `printf 'NPM=%s\\n' "$(command -v npm >/dev/null 2>&1 && echo yes || echo no)"`,
    `printf 'CURL=%s\\n' "$(command -v curl >/dev/null 2>&1 && echo yes || echo no)"`,
    `tmp_dir="$(mktemp -d 2>/dev/null)"; if [ -n "$tmp_dir" ] && python3 -m venv "$tmp_dir" >/dev/null 2>&1 && [ -x "$tmp_dir/bin/pip" ]; then echo 'VENV=yes'; else echo 'VENV=no'; fi; [ -n "$tmp_dir" ] && rm -rf "$tmp_dir"`,
  ].join('\n');

  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // First attempt with regular user, second attempt with root fallback
      const probeFlag = ['--user', 'root', '--exec', '/bin/sh', '-c', script];
      const args = await getTargetWSLArgs(probeFlag);
      const { stdout } = await execFileAsync(getWslCmd(), args, { timeout: 30000 });
      const read = (key: string) => {
        const m = stdout.match(new RegExp(`^${key}=(.*)$`, 'm'));
        return m ? m[1].trim() : '';
      };
      const tc: WslToolchain = {
        reachable: true,
        python3: read('PY') === 'yes',
        node: read('NODE') === 'yes',
        venv: read('VENV') === 'yes',
        npm: read('NPM') === 'yes',
        curl: read('CURL') === 'yes',
        pythonVersion: read('PYVER') || undefined,
        nodeVersion: read('NODEVER') || undefined,
      };
      console.log(`[WSL toolchain probe] attempt ${attempt + 1} → python3=${tc.python3 ? tc.pythonVersion || 'found' : 'missing'}, node=${tc.node ? tc.nodeVersion || 'found' : 'missing'}`);
      return tc;
    } catch (e: any) {
      lastErr = e;
      const errMsg = e?.message || String(e);
      if (errMsg.includes('0x80370102') || errMsg.toLowerCase().includes('reboot') || errMsg.toLowerCase().includes('restart')) {
        console.warn(`[WSL toolchain probe] WSL requires system restart: ${errMsg}`);
        return { reachable: false, python3: false, node: false, venv: false, npm: false, curl: false, error: 'Windows restart required to activate WSL 2 hypervisor' };
      }
      if (attempt === 0) {
        console.warn(`[WSL toolchain probe] attempt 1 failed (${errMsg}), retrying with root...`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  console.warn(`[WSL toolchain probe] WSL unreachable after 2 attempts:`, lastErr?.message || lastErr);
  return { reachable: false, python3: false, node: false, venv: false, npm: false, curl: false, error: lastErr?.message || String(lastErr) };
}

async function performWSLSetup(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const log = (m: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    console.log(`[AlpineVM] ${m}`);
    broadcastVMSetupLog(m, level, 1);
  };

  if (!(await discoverWSLDistro())) {
    const res = await installAlpineVM(log);
    if (!res.success) {
      log(res.error || 'Could not create the Alpine VM', res.needsRestart ? 'warn' : 'error');
      return false;
    }
    _cachedDistroName = ALPINE_DISTRO;
  }

  // Already provisioned: nothing to install.
  _lastEnvCheckResult = null;
  const pre = await checkEnvironmentDependencies(true);
  if (pre.vmReady && pre.pipPackagesInstalled && pre.nodePackagesInstalled) return true;

  log('Installing tools inside Alpine (first run downloads about 1 GB)...');
  const code = await provisionAlpine(alpineProvisionScript(CORE_PYTHON_DEPS, CORE_NODE_DEPS), log, 'wsl');
  if (code !== 0) log(`Provisioning stopped early (exit ${code}).`, 'warn');

  _lastEnvCheckResult = null;
  const finalCheck = await checkWslToolchain();
  const dependencyCheck = await checkEnvironmentDependencies(true);
  const ok = finalCheck.reachable && finalCheck.python3 && finalCheck.node && dependencyCheck.pipPackagesInstalled && dependencyCheck.nodePackagesInstalled;
  if (ok) log('Alpine VM is ready.', 'success');
  else if (!finalCheck.reachable) log(`The Alpine VM is not reachable: ${finalCheck.error || 'unknown error'}`, 'warn');
  else log(`Setup incomplete: ${dependencyCheck.missingList.join(', ') || 'required packages'}`, 'warn');
  return ok;
}

/**
 * Provision WSL once per app process. Concurrent terminal calls share the same
 * setup promise instead of each launching apt/npm/pip installers.
 */
export async function ensureWSLSetup(): Promise<void> {
  if (process.platform !== 'win32' || _wslSetupDone) return;
  if (!_wslSetupPromise) {
    _wslSetupPromise = performWSLSetup().finally(() => {
      _wslSetupPromise = null;
    });
  }
  _wslSetupDone = await _wslSetupPromise;
}

export interface EnvironmentDependenciesResult {
  available: boolean;
  platform: string;
  vmReady: boolean;
  pythonInstalled: boolean;
  pythonVersion?: string;
  nodeInstalled: boolean;
  nodeVersion?: string;
  venvReady: boolean;
  pipPackagesInstalled: boolean;
  nodePackagesInstalled: boolean;
  details: {
    pdf: boolean;
    excel: boolean;
    pptx: boolean;
    docx: boolean;
    data: boolean;
  };
  missingList: string[];
}

let _lastEnvCheckResult: { data: EnvironmentDependenciesResult; timestamp: number } | null = null;

/**
 * Checks environment readiness and skill dependency status across WSL/Docker/Linux.
 */
export async function checkEnvironmentDependencies(forceRefresh = false): Promise<EnvironmentDependenciesResult> {
  const now = Date.now();
  if (!forceRefresh && _lastEnvCheckResult && (now - _lastEnvCheckResult.timestamp < 4000)) {
    return _lastEnvCheckResult.data;
  }

  const result: EnvironmentDependenciesResult = {
    available: false,
    platform: process.platform,
    vmReady: false,
    pythonInstalled: false,
    nodeInstalled: false,
    venvReady: false,
    pipPackagesInstalled: false,
    nodePackagesInstalled: false,
    details: {
      pdf: false,
      excel: false,
      pptx: false,
      docx: false,
      data: false,
    },
    missingList: [],
  };

  try {
    const probeScript = `
if command -v python3 >/dev/null 2>&1; then
  echo "PY: $(python3 --version 2>&1)"
elif command -v python >/dev/null 2>&1; then
  echo "PY: $(python --version 2>&1)"
else
  echo "NO_PYTHON"
fi

if command -v node >/dev/null 2>&1; then
  echo "NODE: $(node --version 2>&1)"
elif command -v nodejs >/dev/null 2>&1; then
  echo "NODE: $(nodejs --version 2>&1)"
else
  echo "NO_NODE"
fi

if [ -d "$HOME/.everfern/venv" ]; then
  echo "VENV_EXISTS"
else
  echo "NO_VENV"
fi

PY_BIN=""
if [ -x "$HOME/.everfern/venv/bin/python3" ]; then
  PY_BIN="$HOME/.everfern/venv/bin/python3"
elif [ -x "$HOME/.everfern/venv/bin/python" ]; then
  PY_BIN="$HOME/.everfern/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PY_BIN="python"
fi

if [ -n "$PY_BIN" ]; then
  $PY_BIN -c "import pypdf, pdfplumber, openpyxl, pptx, pandas, docx, matplotlib, numpy, requests, bs4, reportlab, weasyprint" 2>/dev/null && echo "PY_PKGS_OK" || echo "NO_PY_PKGS"
  $PY_BIN -c "import pypdf; print('PDF_OK')" 2>/dev/null || $PY_BIN -c "import pdfplumber; print('PDF_OK')" 2>/dev/null || echo "NO_PDF"
  $PY_BIN -c "import pandas; print('EXCEL_OK')" 2>/dev/null || $PY_BIN -c "import openpyxl; print('EXCEL_OK')" 2>/dev/null || echo "NO_EXCEL"
  $PY_BIN -c "import pptx; print('PPTX_OK')" 2>/dev/null || echo "NO_PPTX"
  $PY_BIN -c "import docx; print('DOCX_OK')" 2>/dev/null || echo "NO_DOCX"
  $PY_BIN -c "import numpy; print('DATA_OK')" 2>/dev/null || $PY_BIN -c "import matplotlib; print('DATA_OK')" 2>/dev/null || echo "NO_DATA"
else
  echo "NO_PDF"
  echo "NO_EXCEL"
  echo "NO_PPTX"
  echo "NO_DOCX"
  echo "NO_DATA"
fi

if NODE_PATH="$HOME/.everfern/node_modules" node -e "for (const p of ['pptxgenjs','pdf-lib','exceljs','typescript','ts-node']) require.resolve(p)" >/dev/null 2>&1; then
  echo "NODE_PKGS_OK"
else
  echo "NO_NODE_PKGS"
fi
`.trim();

    let output = '';

    if (process.platform === 'win32') {
      const wslCmd = getWslCmd();
      let stdout = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const probeArgs = await getTargetWSLArgs(['--exec', '/bin/sh', '-c', probeScript]);
          const res = await execFileAsync(wslCmd, probeArgs, { timeout: 30000 });
          stdout = res.stdout || '';
          result.vmReady = true;
          break;
        } catch (wslErr) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 1500));
          } else {
            console.warn('[WSL Env Check] WSL probe failed:', (wslErr as any)?.message || wslErr);
          }
        }
      }
      output = stdout;
    } else if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('docker', ['exec', ALPINE_CONTAINER, '/bin/sh', '-c', probeScript], { timeout: 30000 });
      output = stdout || '';
      result.vmReady = true;
    } else if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('bash', ['-c', probeScript], { timeout: 30000 });
      output = stdout || '';
      result.vmReady = true;
    }

    if (output.includes('PY: Python') || output.includes('Python 3') || output.includes('Python 2')) {
      result.pythonInstalled = true;
      const match = output.match(/Python [0-9.]+/);
      if (match) result.pythonVersion = match[0];
    } else {
      result.missingList.push('Python 3');
    }

    if (/^NODE:\s+v\d+/m.test(output) && !output.includes('NO_NODE')) {
      result.nodeInstalled = true;
      const match = output.match(/v[0-9.]+/);
      if (match) result.nodeVersion = match[0];
    } else {
      result.missingList.push('Node.js');
    }

    if (output.includes('VENV_EXISTS') || (result.pythonInstalled && output.includes('PDF_OK') && output.includes('EXCEL_OK'))) {
      result.venvReady = true;
    } else {
      result.missingList.push('Python Virtualenv (~/.everfern/venv)');
    }

    result.details.pdf = output.includes('PDF_OK');
    result.details.excel = output.includes('EXCEL_OK');
    result.details.pptx = output.includes('PPTX_OK');
    result.details.docx = output.includes('DOCX_OK');
    result.details.data = output.includes('DATA_OK');

    if (!result.details.pdf) result.missingList.push('PDF Libraries (pypdf)');
    if (!result.details.excel) result.missingList.push('Excel Libraries (pandas, openpyxl)');
    if (!result.details.pptx) result.missingList.push('PPTX Libraries (python-pptx)');
    if (!result.details.docx) result.missingList.push('DOCX Libraries (python-docx)');
    if (!result.details.data) result.missingList.push('Data Science Libraries (numpy, matplotlib)');

    result.pipPackagesInstalled = output.includes('PY_PKGS_OK');
    result.nodePackagesInstalled = output.includes('NODE_PKGS_OK');
    if (!result.pipPackagesInstalled) result.missingList.push('Python skill libraries');
    if (!result.nodePackagesInstalled) result.missingList.push('Node.js skill packages');

    result.available = result.vmReady && result.pythonInstalled && (result.venvReady || result.pipPackagesInstalled);
    _lastEnvCheckResult = { data: result, timestamp: Date.now() };
  } catch (err: any) {
    result.available = false;
    result.vmReady = false;
  }

  return result;
}

/**
 * Installs all required system tools, python venv, and skill libraries.
 */
export async function setupEnvironmentDependencies(): Promise<{ success: boolean; error?: string }> {
  try {
    _lastEnvCheckResult = null;
    if (process.platform === 'win32') {
      _wslSetupDone = false;
      await ensureWSLSetup();
    } else if (process.platform === 'darwin') {
      await ensureDockerContainer();
    } else {
      const setupScript = [
        'mkdir -p ~/.everfern',
        'cd ~/.everfern',
        'if [ ! -f package.json ]; then npm init -y &>/dev/null; fi',
        `npm install ${CORE_NODE_DEPS} --no-audit --no-fund --prefer-offline -q &>/dev/null || true`,
        'if command -v python3 &>/dev/null; then',
        '  if [ ! -d ~/.everfern/venv ]; then python3 -m venv ~/.everfern/venv; fi',
        '  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"',
        '  UV_SUCCESS=0',
        '  if ! command -v uv &>/dev/null; then',
        '    (curl -LsSf https://astral.sh/uv/install.sh | sh) &>/dev/null || ~/.everfern/venv/bin/pip install uv -q &>/dev/null || true',
        '    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"',
        '  fi',
        '  if command -v uv &>/dev/null; then',
        `    if uv pip install --python ~/.everfern/venv/bin/python ${CORE_PYTHON_DEPS} -q; then`,
        '      UV_SUCCESS=1',
        '    fi',
        '  fi',
        '  if [ "$UV_SUCCESS" -ne 1 ]; then',
        `    ~/.everfern/venv/bin/pip install ${CORE_PYTHON_DEPS} -q || true`,
        '  fi',
        'fi'
      ].join('\n');
      await execAsync(`bash -c "${setupScript}"`, { timeout: 180000 });
    }

    // Also provision the host PDF OCR environment (PaddleOCR + OpenVINO) so
    // scanned/image PDFs can be text-extracted on the host. Best-effort only —
    // a failure here must not fail the whole onboarding/deps step.
    const ocrResult = await ensureOcrDeps();
    if (!ocrResult.ok) {
      console.warn('[setupEnvironmentDependencies] PDF OCR provision skipped:', ocrResult.message);
    }

    const readiness = await checkEnvironmentDependencies(true);
    if (!readiness.available || !readiness.nodePackagesInstalled) {
      return {
        success: false,
        error: `Environment setup is incomplete: ${readiness.missingList.join(', ') || 'required Node packages are missing'}`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

async function runInWSL(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  const wslCmd = getWslCmd();
  const targetArgs = await getTargetWSLArgs([]);
  console.log(`[runInWSL] Using WSL command: ${wslCmd} ${targetArgs.join(' ')}`);

  // Ensure WSL is set up (python3, nodejs, pptxgenjs, python-pptx, .everfern/, venv) — never throws
  try {
    await ensureWSLSetup();
  } catch (err) {
    console.error('[runInWSL] WSL setup failed (continuing anyway):', err);
  }

  // Reset idle timer
  resetWslIdleTimer();

  // Translate Windows paths to Linux paths if cwd is provided, otherwise default to native Linux workspace
  const linuxCwd = cwd ? quoteBashArg(translateWindowsPathToLinux(cwd)) : '"$HOME/.everfern/workspace"';

  const envExports = 'mkdir -p "$HOME/.everfern/workspace" "$HOME/.everfern/exec" "$HOME/.everfern/artifacts" && export VIRTUAL_ENV="$HOME/.everfern/venv" && export PATH="$HOME/.everfern/venv/bin:$HOME/.everfern/node_modules/.bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" && export NODE_PATH="$HOME/.everfern/node_modules"';

  // Prepend environment exports and cd to workspace
  const fullCommand = `${envExports} && cd ${linuxCwd} && ${command}`;

  const execArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', fullCommand]);
  return executeCommand(wslCmd, execArgs, onUpdate);
}

/**
 * Runs command in the Alpine Docker container (macOS)
 */
async function runInDocker(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  // Ensure Docker container exists and is running
  await ensureDockerContainer();

  // Translate macOS paths to Docker volume mounts if cwd is provided, otherwise default to native Linux workspace
  const dockerCwd = cwd ? quoteBashArg(translateMacOSPathToDocker(cwd)) : '"$HOME/.everfern/workspace"';

  const envExports = 'mkdir -p "$HOME/.everfern/workspace" "$HOME/.everfern/exec" "$HOME/.everfern/artifacts" && export VIRTUAL_ENV="$HOME/.everfern/venv" && export PATH="$HOME/.everfern/venv/bin:$HOME/.everfern/node_modules/.bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" && export NODE_PATH="$HOME/.everfern/node_modules"';

  // Prepend environment exports and cd to workspace
  const fullCommand = `${envExports} && cd ${dockerCwd} && ${command}`;

  return executeCommand('docker', ['exec', ALPINE_CONTAINER, 'bash', '-c', fullCommand], onUpdate);
}

/**
 * Runs command natively (Linux or fallback)
 */
async function runNatively(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  let hostCwd = cwd;
  if (hostCwd && process.platform === 'win32') {
    hostCwd = translateLinuxPathToHost(hostCwd);
  }

  if (process.platform === 'win32') {
    const resolvePowerShell = (): string => {
      try {
        const { execSync } = require('child_process');
        execSync('where pwsh.exe', { stdio: 'ignore', timeout: 3000 });
        return 'pwsh.exe';
      } catch {
        return 'powershell.exe';
      }
    };
    const ps = resolvePowerShell();
    const psCommand = hostCwd
      ? `Set-Location -LiteralPath '${hostCwd.replace(/'/g, "''")}'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
      : `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
    return executeCommand(ps, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], onUpdate);
  }

  let fullCommand = command;
  if (hostCwd) {
    fullCommand = `cd ${quoteBashArg(hostCwd)} && ${command}`;
  }
  return executeCommand('bash', ['-c', fullCommand], onUpdate);
}

/**
 * Helper to decode buffer safely, supporting UTF-16LE and stripping null bytes
 */
function decodeBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le');
  }
  if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8').replace(/\0/g, '');
}

/**
 * Checks if the Linux VM is available and ready.
 */
export async function isLinuxVMAvailable(): Promise<{ available: boolean; reason?: string }> {
  const platform = process.platform;
  console.log(`[isLinuxVMAvailable] Checking VM availability for platform=${platform}`);
  try {
    if (platform === 'win32') {
      try {
        console.log(`[isLinuxVMAvailable] Testing ${ALPINE_DISTRO}...`);
        if (!(await isAlpineInstalled())) throw new Error(`${ALPINE_DISTRO} is not installed yet`);
        await execFileAsync('wsl.exe', ['-d', ALPINE_DISTRO, '-e', 'echo', 'ok'], { timeout: 15000 });
        console.log('[isLinuxVMAvailable] wsl.exe OK → VM available');
        return { available: true };
      } catch (err: any) {
        console.warn(`[isLinuxVMAvailable] wsl.exe failed: ${err.message || err}`);
        return {
          available: false,
          reason: `The EverFern Alpine VM is not installed or did not start. Error: ${err.message || err}`
        };
      }
    } else if (platform === 'darwin') {
      try {
        console.log('[isLinuxVMAvailable] Testing docker info...');
        await execAsync('docker info', { timeout: 10000 });
        console.log('[isLinuxVMAvailable] docker info OK → VM available');
        return { available: true };
      } catch (err: any) {
        console.warn(`[isLinuxVMAvailable] docker info failed: ${err.message || err}`);
        return {
          available: false,
          reason: `Docker Desktop is not installed, not running, or connection timed out. Error: ${err.message || err}`
        };
      }
    } else if (platform === 'linux') {
      console.log('[isLinuxVMAvailable] Platform=linux → always available');
      return { available: true };
    }
    console.warn(`[isLinuxVMAvailable] Unsupported platform: ${platform}`);
    return { available: false, reason: `Unsupported platform: ${platform}` };
  } catch (err: any) {
    console.warn(`[isLinuxVMAvailable] Unexpected error: ${err.message}`);
    return { available: false, reason: err.message };
  }
}

/**
 * Generic command execution helper
 */
function executeCommand(cmd: string, args: string[], onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, {
        shell: false,
        env: { ...process.env, WSL_UTF8: '1', WSLENV: '' } // Force WSL to output UTF-8
      });

      let stdout = '';
      let stderr = '';

      const MAX_OUTPUT_LENGTH = 50000;

      proc.stdout?.on('data', (data) => {
        const decoded = decodeBuffer(data);
        stdout += decoded;
        if (onUpdate) onUpdate(decoded);
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = '...[Output truncated]...\n' + stdout.slice(-MAX_OUTPUT_LENGTH);
        }
      });

      proc.stderr?.on('data', (data) => {
        const decoded = decodeBuffer(data);
        stderr += decoded;
        if (onUpdate) onUpdate(decoded);
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = '...[Output truncated]...\n' + stderr.slice(-MAX_OUTPUT_LENGTH);
        }
      });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1
        });
      });

      proc.on('error', (err) => {
        resolve({
          stdout,
          stderr: stderr + `\nError: ${err.message}`,
          exitCode: -1
        });
      });
    } catch (err: any) {
      resolve({
        stdout: '',
        stderr: `Spawn error: ${err.message}`,
        exitCode: -1
      });
    }
  });
}

/**
 * Ensures Docker container exists and is running.
 * Platform-specific volume mounts:
 * - macOS: mounts /Users → /host/Users
 * - Linux: mounts /home → /host/Home
 */
export async function ensureDockerContainer(): Promise<void> {
  try {
    await execAsync('docker info');
    const isMac = process.platform === 'darwin';
    const volumeMount = isMac ? '-v /Users:/host/Users' : '-v /home:/host/Home';

    const { stdout: containerList } = await execAsync(`docker ps -a --filter name=${ALPINE_CONTAINER} --format "{{.Names}}"`);
    if (!containerList.includes(ALPINE_CONTAINER)) {
      console.log(`Creating ${ALPINE_CONTAINER} Docker container...`);
      await execAsync(`docker run -d --name ${ALPINE_CONTAINER} ${volumeMount} alpine:latest tail -f /dev/null`);
      const code = await provisionAlpine(
        alpineProvisionScript(CORE_PYTHON_DEPS, CORE_NODE_DEPS),
        (m, level) => broadcastVMSetupLog(m, level || 'info', 1),
        'docker',
      );
      if (code !== 0) throw new Error(`Alpine provisioning exited with ${code}`);
    } else {
      const { stdout: runningContainers } = await execAsync(`docker ps --filter name=${ALPINE_CONTAINER} --format "{{.Names}}"`);
      if (!runningContainers.includes(ALPINE_CONTAINER)) {
        console.log(`Starting ${ALPINE_CONTAINER} Docker container...`);
        await execAsync(`docker start ${ALPINE_CONTAINER}`);
      }
    }
  } catch (error) {
    throw new Error(`Docker setup failed: ${error}`);
  }
}
/**
 * Translates Windows-style paths to Linux paths for WSL.
 *
 * Examples:
 * - C:\Users\... → /mnt/c/Users/...
 * - D:\Projects\... → /mnt/d/Projects/...
 * - c:\temp → /mnt/c/temp
 *
 * @param windowsPath - The Windows path to translate
 * @returns The equivalent Linux path for WSL
 */
export function translateWindowsPathToLinux(windowsPath: string): string {
  // Handle paths like \\wsl.localhost\Ubuntu\everfern\... or \\wsl$\Ubuntu\everfern\...
  const wslUncMatch = windowsPath.replace(/\\/g, '/').match(/^\/\/wsl(?:\.localhost|\$)?\/[^\/]+(\/.*)?$/);
  if (wslUncMatch) {
    return wslUncMatch[1] || '/';
  }

  // Handle paths like C:\Users\... or c:\temp
  const driveLetterMatch = windowsPath.match(/^([A-Za-z]):[\\\/]/);

  if (driveLetterMatch) {
    const driveLetter = driveLetterMatch[1].toLowerCase();
    // Replace C:\ with /mnt/c/ and convert backslashes to forward slashes
    const pathWithoutDrive = windowsPath.substring(3);
    const linuxPath = pathWithoutDrive.replace(/\\/g, '/');
    return `/mnt/${driveLetter}/${linuxPath}`;
  }

  // If no drive letter, assume it's already a Linux path or relative path
  return windowsPath.replace(/\\/g, '/');
}

/**
 * Translates macOS paths to Docker volume mount paths.
 *
 * Examples:
 * - /Users/... → /host/Users/...
 * - /tmp/... → /tmp/... (unchanged, not mounted)
 *
 * @param macOSPath - The macOS path to translate
 * @returns The equivalent Docker container path
 */
export function translateMacOSPathToDocker(macOSPath: string): string {
  // Only translate /Users paths as they are mounted in the container
  if (macOSPath.startsWith('/Users/')) {
    return macOSPath.replace('/Users/', '/host/Users/');
  }

  // For other paths, return as-is (they may not be accessible in container)
  return macOSPath;
}

/**
 * Translates VM-style Linux paths back to Windows or macOS host paths.
 *
 * Windows examples:
 * - /mnt/c/Users/... → C:\Users\...
 * - /root/... → \\wsl.localhost\EverFern-Alpine\root\...
 *
 * macOS examples:
 * - /host/Users/... → /Users/...
 */
export function translateLinuxPathToHost(linuxPath: string): string {
  if (process.platform === 'win32') {
    let cleanPath = linuxPath.replace(/\\/g, '/');

    // Check if it already starts with a drive letter (e.g. C:/ or c:/)
    const isWindowsPath = cleanPath.match(/^([a-zA-Z]):[\\\/]/);
    if (isWindowsPath) {
      return cleanPath.replace(/\//g, '\\');
    }

    // Handle /mnt/c/ style paths
    const mntMatch = cleanPath.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/);
    if (mntMatch) {
      const drive = mntMatch[1].toUpperCase();
      const rest = mntMatch[2] ? mntMatch[2].replace(/\//g, '\\') : '';
      return `${drive}:${rest}`;
    }

    // Check if it is already a UNC path (e.g. \\wsl.localhost\..., \\wsl$\..., \\server\share\...)
    if (cleanPath.startsWith('//')) {
      return cleanPath.replace(/\//g, '\\');
    }

    // Otherwise, translate to WSL localhost UNC path
    const relativePath = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;
    return `\\\\wsl.localhost\\${ALPINE_DISTRO}\\${relativePath.replace(/\//g, '\\')}`;
  } else if (process.platform === 'darwin') {
    if (linuxPath.startsWith('/host/Users/')) {
      return linuxPath.replace('/host/Users/', '/Users/');
    }
  }
  return linuxPath;
}
