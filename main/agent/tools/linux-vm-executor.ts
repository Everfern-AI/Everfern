import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import { ensureOcrDeps } from '../../ocr/ocr';

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

/**
 * Thin wrapper that runs any shell command in a Linux VM environment.
 *
 * Platform-specific implementations:
 * - Windows: Uses WSL (Windows Subsystem for Linux) via `wsl.exe --exec bash -c "<cmd>"`
 * - macOS: Uses Docker with Ubuntu container via `docker exec everfern-ubuntu bash -c "<cmd>"`
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
        console.log('[runInLinuxVM] Platform=win32 → running in WSL');
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
let _cachedDistroName: string | null = null;

export const CORE_PYTHON_DEPS = 'pypdf pdfplumber openpyxl python-pptx pandas python-docx matplotlib numpy requests beautifulsoup4 reportlab weasyprint';
export const CORE_NODE_DEPS = 'pptxgenjs pdf-lib exceljs typescript ts-node';

async function getTargetWSLArgs(extraArgs: string[]): Promise<string[]> {
  if (!_cachedDistroName) {
    try {
      const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 5000 }).catch(() => ({ stdout: '' }));
      const distros = stdout.split(/\r?\n/).map((d: string) => d.replace(/\0/g, '').trim()).filter(Boolean);
      if (distros.includes('Ubuntu')) _cachedDistroName = 'Ubuntu';
      else if (distros.some((d: string) => d.startsWith('Ubuntu-'))) _cachedDistroName = distros.find((d: string) => d.startsWith('Ubuntu-')) || null;
      else if (distros.includes('Debian')) _cachedDistroName = 'Debian';
      else if (distros.length > 0) _cachedDistroName = distros[0];
    } catch {}
  }
  if (_cachedDistroName) {
    return ['-d', _cachedDistroName, ...extraArgs];
  }
  return extraArgs;
}

interface WslToolchain {
  reachable: boolean;
  python3: boolean;
  node: boolean;
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
  ].join('\n');
  const args = await getTargetWSLArgs(['--exec', 'bash', '-c', script]);

  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { stdout } = await execFileAsync(getWslCmd(), args, { timeout: 30000 });
      const read = (key: string) => {
        const m = stdout.match(new RegExp(`^${key}=(.*)$`, 'm'));
        return m ? m[1].trim() : '';
      };
      const tc: WslToolchain = {
        reachable: true,
        python3: read('PY') === 'yes',
        node: read('NODE') === 'yes',
        pythonVersion: read('PYVER') || undefined,
        nodeVersion: read('NODEVER') || undefined,
      };
      console.log(`[WSL toolchain probe] attempt ${attempt + 1} → python3=${tc.python3 ? tc.pythonVersion || 'found' : 'missing'}, node=${tc.node ? tc.nodeVersion || 'found' : 'missing'}`);
      return tc;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) {
        console.warn(`[WSL toolchain probe] attempt ${attempt + 1} failed (${(e as any)?.message || e}), retrying...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  console.warn(`[WSL toolchain probe] WSL unreachable after 2 attempts:`, lastErr?.message || lastErr);
  return { reachable: false, python3: false, node: false, error: lastErr?.message || String(lastErr) };
}

export async function ensureWSLSetup(): Promise<void> {
  if (process.platform !== 'win32') return;

  const wslCmd = getWslCmd();
  const baseArgs = await getTargetWSLArgs([]);
  console.log(`[ensureWSLSetup] Setting up WSL environment via ${wslCmd} ${baseArgs.join(' ')}...`);
  broadcastVMSetupLog('[ensureWSLSetup] Setting up WSL environment...', 'info', 1);

  // Configure WSL resources (.wslconfig)
  try {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const wslConfigPath = path.join(os.homedir(), '.wslconfig');
    const configContent = `[wsl2]\nmemory=3GB\nprocessors=2\n`;
    if (!fs.existsSync(wslConfigPath) || !fs.readFileSync(wslConfigPath, 'utf8').includes('memory=')) {
      fs.writeFileSync(wslConfigPath, configContent);
      console.log('[ensureWSLSetup] Created/Updated .wslconfig with resource caps.');
      broadcastVMSetupLog('[ensureWSLSetup] Created/Updated .wslconfig with resource caps.', 'info', 1);
    }
  } catch (err) {
    console.error('[ensureWSLSetup] Failed to configure .wslconfig:', err);
  }

  // Step 2: Check & install system interpreters if missing
  try {
    const toolchain = await checkWslToolchain();
    const missing = [
      toolchain.python3 ? null : 'python3',
      toolchain.node ? null : 'node',
    ].filter(Boolean) as string[];

    if (!toolchain.reachable) {
      console.warn(`[ensureWSLSetup] Could not reach WSL to verify toolchain (${toolchain.error}). Attempting install anyway...`);
      broadcastVMSetupLog(`[ensureWSLSetup] WSL unreachable (${toolchain.error}). Attempting toolchain install...`, 'warn', 2);
    }

    if (missing.length > 0) {
      console.log(`[ensureWSLSetup] Core tools missing (${missing.join(', ')}), installing system toolchain via root...`);
      broadcastVMSetupLog(`[ensureWSLSetup] Installing missing system toolchain (${missing.join(', ')})...`, 'info', 2);
      const sysPackages = 'python3 python3-pip python3-venv nodejs npm curl wget git build-essential jq pandoc poppler-utils libreoffice';
      try {
        const rootArgs = await getTargetWSLArgs(['--user', 'root', '--exec', 'bash', '-c', `apt-get update -qq && apt-get install -y -qq ${sysPackages}`]);
        await execFileAsync(wslCmd, rootArgs, { timeout: 240000 });
      } catch (rootErr) {
        console.log('[ensureWSLSetup] Root apt-get failed, trying sudo...', rootErr);
        const sudoArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', `sudo apt-get update -qq && sudo apt-get install -y -qq ${sysPackages}`]);
        await execFileAsync(wslCmd, sudoArgs, { timeout: 240000 }).catch(() => {});
      }
      // Re-verify after install so the setup log reflects reality.
      const after = await checkWslToolchain();
      const stillMissing = [
        after.python3 ? null : 'python3',
        after.node ? null : 'node',
      ].filter(Boolean) as string[];
      if (stillMissing.length > 0) {
        console.warn(`[ensureWSLSetup] Still missing after install: ${stillMissing.join(', ')}`);
        broadcastVMSetupLog(`[ensureWSLSetup] Warning: still missing ${stillMissing.join(', ')} after install.`, 'warn', 2);
      } else {
        console.log(`[ensureWSLSetup] System toolchains verified (python3 ${after.pythonVersion || ''}, node ${after.nodeVersion || ''}).`);
        broadcastVMSetupLog('[ensureWSLSetup] System toolchains verified.', 'info', 2);
      }
    } else {
      console.log(`[ensureWSLSetup] python3 (${toolchain.pythonVersion || ''}) and node (${toolchain.nodeVersion || ''}) already installed`);
      broadcastVMSetupLog('[ensureWSLSetup] python3 and nodejs already installed', 'info', 2);
    }
  } catch (err: any) {
    console.warn('[ensureWSLSetup] WSL package check notice:', err?.message || err);
    broadcastVMSetupLog(`[ensureWSLSetup] Toolchain check notice: ${err?.message || err}`, 'warn', 2);
  }

  // Step 3: Set up pure-JS Node packages in ~/.everfern
  try {
    broadcastVMSetupLog('[ensureWSLSetup] Setting up Node packages in ~/.everfern...', 'info', 3);
    const nodeSetupScript = [
      'mkdir -p ~/.everfern',
      'cd ~/.everfern',
      'if [ ! -f package.json ]; then npm init -y &>/dev/null; fi',
      `npm install ${CORE_NODE_DEPS} --no-audit --no-fund --prefer-offline -q &>/dev/null || true`
    ].join(' && ');
    const nodeArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', nodeSetupScript]);
    await execFileAsync(wslCmd, nodeArgs, { timeout: 60000 }).catch((e) => console.warn('[ensureWSLSetup] Node setup notice:', e));
  } catch (nodeErr) {
    console.warn('[ensureWSLSetup] Node package setup warning (continuing):', nodeErr);
  }

  // Step 4: Set up Python virtualenv & packages in ~/.everfern/venv with multi-tier fallbacks
  try {
    broadcastVMSetupLog('[ensureWSLSetup] Provisioning Python virtualenv (~/.everfern/venv) & core skill libraries...', 'info', 4);
    const pySetupScript = `
if command -v python3 &>/dev/null; then
  mkdir -p "$HOME/.everfern"
  if [ ! -d "$HOME/.everfern/venv" ]; then
    python3 -m venv "$HOME/.everfern/venv" 2>/dev/null || true
  fi

  PY_BIN="$HOME/.everfern/venv/bin/python"
  PIP_BIN="$HOME/.everfern/venv/bin/pip"
  if [ ! -x "$PY_BIN" ]; then
    PY_BIN="python3"
    PIP_BIN="python3 -m pip"
  fi

  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  UV_SUCCESS=0
  if ! command -v uv &>/dev/null; then
    (curl -LsSf https://astral.sh/uv/install.sh | sh) &>/dev/null || $PIP_BIN install uv -q &>/dev/null || true
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  fi
  if command -v uv &>/dev/null; then
    if uv pip install --python "$PY_BIN" ${CORE_PYTHON_DEPS} -q 2>/dev/null; then
      UV_SUCCESS=1
    fi
  fi
  if [ "$UV_SUCCESS" -ne 1 ]; then
    $PIP_BIN install ${CORE_PYTHON_DEPS} -q 2>/dev/null || true
  fi

  for pkg in pypdf pdfplumber openpyxl pptx pandas docx matplotlib numpy requests reportlab; do
    $PY_BIN -c "import $pkg" 2>/dev/null || $PIP_BIN install "$pkg" -q 2>/dev/null || true
  done
fi
`.trim();

    const pyArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', pySetupScript]);
    await execFileAsync(wslCmd, pyArgs, { timeout: 180000 });
    broadcastVMSetupLog('[ensureWSLSetup] Node & Python packages installed in ~/.everfern/venv', 'info', 4);
  } catch (err) {
    console.error('[ensureWSLSetup] Failed to set up Node/Python dependencies:', err);
    broadcastVMSetupLog(`[ensureWSLSetup] Package setup warning: ${err}`, 'warn', 4);
  }

  // Step 5: Ensure default user has passwordless sudo
  try {
    const whoamiArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', 'whoami']);
    const { stdout: defaultUserOut } = await execFileAsync(wslCmd, whoamiArgs, { timeout: 10000 });
    const defaultUser = defaultUserOut.trim();
    if (defaultUser && defaultUser !== 'root') {
      const sudoArgs = await getTargetWSLArgs(['--user', 'root', '--exec', 'bash', '-c', `echo '${defaultUser} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${defaultUser} && chmod 0440 /etc/sudoers.d/${defaultUser}`]);
      await execFileAsync(wslCmd, sudoArgs, { timeout: 10000 }).catch(() => {});
    }
  } catch (err) {
    console.error('[ensureWSLSetup] Failed to configure passwordless sudo:', err);
  }

  console.log('[ensureWSLSetup] WSL environment setup complete with full Node/Python toolchain ✅');
  broadcastVMSetupLog('[ensureWSLSetup] WSL environment setup complete with full Node/Python toolchain ✅', 'success', 5);
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
if command -v python3 &>/dev/null; then
  echo "PY: $(python3 --version 2>&1)"
elif command -v python &>/dev/null; then
  echo "PY: $(python --version 2>&1)"
else
  echo "NO_PYTHON"
fi

if command -v node &>/dev/null; then
  echo "NODE: $(node --version 2>&1)"
elif command -v nodejs &>/dev/null; then
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
elif command -v python3 &>/dev/null; then
  PY_BIN="python3"
elif command -v python &>/dev/null; then
  PY_BIN="python"
fi

if [ -n "$PY_BIN" ]; then
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

if [ -d "$HOME/.everfern/node_modules" ]; then
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
          const probeArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', probeScript]);
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
      const { stdout } = await execFileAsync('docker', ['exec', 'everfern-ubuntu', 'bash', '-c', probeScript], { timeout: 30000 });
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

    if ((output.includes('NODE: v') || output.includes('v')) && !output.includes('NO_NODE')) {
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

    result.pipPackagesInstalled = result.details.pdf && result.details.excel && result.details.pptx && result.details.docx && result.details.data;
    result.nodePackagesInstalled = output.includes('NODE_PKGS_OK');

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
  let linuxCwd = cwd ? translateWindowsPathToLinux(cwd) : '$HOME/.everfern/workspace';

  const envExports = 'mkdir -p "$HOME/.everfern/workspace" "$HOME/.everfern/exec" "$HOME/.everfern/artifacts" && export VIRTUAL_ENV="$HOME/.everfern/venv" && export PATH="$HOME/.everfern/venv/bin:$HOME/.everfern/node_modules/.bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" && export NODE_PATH="$HOME/.everfern/node_modules"';

  // Prepend environment exports and cd to workspace
  const fullCommand = `${envExports} && cd "${linuxCwd}" && ${command}`;

  const execArgs = await getTargetWSLArgs(['--exec', 'bash', '-c', fullCommand]);
  return executeCommand(wslCmd, execArgs, onUpdate);
}

/**
 * Runs command in Docker Ubuntu container (macOS)
 */
async function runInDocker(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  // Ensure Docker container exists and is running
  await ensureDockerContainer();

  // Translate macOS paths to Docker volume mounts if cwd is provided, otherwise default to native Linux workspace
  let dockerCwd = cwd ? translateMacOSPathToDocker(cwd) : '$HOME/.everfern/workspace';

  const envExports = 'mkdir -p "$HOME/.everfern/workspace" "$HOME/.everfern/exec" "$HOME/.everfern/artifacts" && export VIRTUAL_ENV="$HOME/.everfern/venv" && export PATH="$HOME/.everfern/venv/bin:$HOME/.everfern/node_modules/.bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" && export NODE_PATH="$HOME/.everfern/node_modules"';

  // Prepend environment exports and cd to workspace
  const fullCommand = `${envExports} && cd "${dockerCwd}" && ${command}`;

  return executeCommand('docker', ['exec', 'everfern-ubuntu', 'bash', '-c', fullCommand], onUpdate);
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
    fullCommand = `cd "${hostCwd}" && ${command}`;
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
        console.log('[isLinuxVMAvailable] Testing wsl.exe -e echo ok...');
        await execAsync('wsl.exe -e echo ok', { timeout: 15000 });
        console.log('[isLinuxVMAvailable] wsl.exe OK → VM available');
        return { available: true };
      } catch (err: any) {
        console.warn(`[isLinuxVMAvailable] wsl.exe failed: ${err.message || err}`);
        return {
          available: false,
          reason: `WSL is not running, no Linux distribution is installed, or the WSL startup timed out. Error: ${err.message || err}`
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
    // Check if Docker is running
    await execAsync('docker info');

    // Choose volume mount based on platform
    const isMac = process.platform === 'darwin';
    const volumeMount = isMac ? '-v /Users:/host/Users' : '-v /home:/host/Home';

    // Check if container exists
    const { stdout: containerList } = await execAsync('docker ps -a --filter name=everfern-ubuntu --format "{{.Names}}"');

    if (!containerList.includes('everfern-ubuntu')) {
      // Create container with platform-appropriate volume mount
      console.log('Creating everfern-ubuntu Docker container...');
      await execAsync(`docker run -d --name everfern-ubuntu ${volumeMount} ubuntu:latest tail -f /dev/null`);

      // Install basic tools in the container
      await execAsync('docker exec everfern-ubuntu apt-get update');
      await execAsync('docker exec everfern-ubuntu apt-get install -y curl wget git python3 python3-pip python3-venv nodejs npm build-essential jq pandoc poppler-utils libreoffice tesseract-ocr imagemagick ffmpeg');

      // Create ~/.everfern/ directory, Node dependencies, and Python venv with uv / pip
      const dockerSetup = [
        'mkdir -p ~/.everfern',
        'cd ~/.everfern',
        'if [ ! -f package.json ]; then npm init -y &>/dev/null; fi',
        `npm install ${CORE_NODE_DEPS} --no-audit --no-fund --prefer-offline -q &>/dev/null || true`,
        'if [ ! -d ~/.everfern/venv ]; then python3 -m venv ~/.everfern/venv; fi',
        'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"',
        'UV_SUCCESS=0',
        '(if ! command -v uv &>/dev/null; then (curl -LsSf https://astral.sh/uv/install.sh | sh) &>/dev/null || ~/.everfern/venv/bin/pip install uv -q &>/dev/null || true; export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; fi)',
        `(if command -v uv &>/dev/null; then if uv pip install --python ~/.everfern/venv/bin/python ${CORE_PYTHON_DEPS} -q; then UV_SUCCESS=1; fi; fi)`,
        `(if [ "$UV_SUCCESS" -ne 1 ]; then ~/.everfern/venv/bin/pip install ${CORE_PYTHON_DEPS} -q || true; fi)`
      ].join(' && ');
      await execAsync(`docker exec everfern-ubuntu bash -c "${dockerSetup.replace(/"/g, '\\"')}"`);
    } else {
      // Check if container is running
      const { stdout: runningContainers } = await execAsync('docker ps --filter name=everfern-ubuntu --format "{{.Names}}"');

      if (!runningContainers.includes('everfern-ubuntu')) {
        // Start the container
        console.log('Starting everfern-ubuntu Docker container...');
        await execAsync('docker start everfern-ubuntu');
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
 * - /home/ubuntu/... → \\wsl.localhost\Ubuntu\home\ubuntu\...
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
    return `\\\\wsl.localhost\\Ubuntu\\${relativePath.replace(/\//g, '\\')}`;
  } else if (process.platform === 'darwin') {
    if (linuxPath.startsWith('/host/Users/')) {
      return linuxPath.replace('/host/Users/', '/Users/');
    }
  }
  return linuxPath;
}
