/**
 * EverFern — ShowUI Server Manager
 *
 * Singleton that auto-starts the ShowUI Gradio server inside WSL whenever
 * the grounding engine needs it, so the agent never sees ECONNREFUSED.
 *
 * Usage:
 *   import { ensureShowUIServer } from './showui-server';
 *   await ensureShowUIServer((line) => console.log(line));
 */

import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';

const SHOWUI_URL = 'http://127.0.0.1:7860';
const HEALTH_ENDPOINT = `${SHOWUI_URL}/api/predict`;
const HEALTH_TIMEOUT_MS = 2000;
const BOOT_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (allow for venv creation)

let showuiProc: ChildProcess | null = null;
let bootingPromise: Promise<boolean> | null = null;

// ── Health check ─────────────────────────────────────────────────────
export async function isShowUIAlive(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [] }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── Build the patched WSL launch command ─────────────────────────────
function buildWslLaunchCmd(): string {
  const username = os.userInfo().username;
  return [
    `if [ -d /root/ShowUI ]; then cd /root/ShowUI; elif [ -d ~/ShowUI ]; then cd ~/ShowUI; elif [ -d /mnt/c/Users/${username}/ShowUI ]; then cd /mnt/c/Users/${username}/ShowUI; else echo "ShowUI directory not found"; exit 1; fi`,
    // 0. Force CPU by hiding the GPU from PyTorch/CUDA entirely
    'export CUDA_VISIBLE_DEVICES="-1"',
    // 1. Strip HuggingFace Spaces decorators and fix device placement with elevated permissions (sudo)
    'sudo sed -i "/import spaces/s/^/# /" app.py',
    'sudo sed -i "/@spaces\\.GPU/s/^/# /" app.py',
    'sudo sed -i "s/device_map=.auto./device_map=\\"cpu\\"/" app.py',
    'sudo sed -i "s/device_map=.cuda./device_map=\\"cpu\\"/" app.py',
    'sudo sed -i "s/\\.to(.cuda.)/\\.to(\\"cpu\\")/g" app.py',
    'sudo sed -i "s/\\.to(device)/\\.to(\\"cpu\\")/g" app.py',
    'sudo sed -i "/inputs = inputs\\.to/s/^/# /" app.py',
    'sudo sed -i "s/api_open=False/api_open=True/" app.py',
    // 2. Auto-install uv if missing
    '[ -f ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh',
    // 3. Create venv only if missing
    '[ -f venv_wsl/bin/python3 ] || ~/.local/bin/uv venv venv_wsl --python 3.12',
    // 4. Install dependencies only if gradio is missing
    'venv_wsl/bin/python3 -c "import gradio" 2>/dev/null || (~/.local/bin/uv pip install --python venv_wsl/bin/python3 gradio torch torchvision torchaudio && [ -f requirements.txt ] && ~/.local/bin/uv pip install --python venv_wsl/bin/python3 -r requirements.txt)',
    // 5. Launch directly with forced CPU environment
    'CUDA_VISIBLE_DEVICES="-1" venv_wsl/bin/python3 app.py',
  ].join(' && ');
}

// ── Wait for port to become reachable ────────────────────────────────
function waitForReady(onLog: (line: string) => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let elapsed = 0;
    const interval = 2000;
    const timer = setInterval(async () => {
      elapsed += interval;
      const alive = await isShowUIAlive();
      if (alive) {
        clearInterval(timer);
        onLog('✅ ShowUI REST API confirmed live on port 7860');
        resolve(true);
        return;
      }
      if (elapsed >= BOOT_TIMEOUT_MS) {
        clearInterval(timer);
        onLog('❌ ShowUI did not start within 3 minutes');
        resolve(false);
      }
    }, interval);
  });
}

// ── Main exported function ────────────────────────────────────────────
/**
 * Ensures the ShowUI Gradio server is running inside WSL.
 * Safe to call multiple times — only ever spawns one process.
 * Returns true if the server is (or becomes) reachable.
 */
export async function ensureShowUIServer(
  onLog: (line: string) => void = () => {},
): Promise<boolean> {
  // Already running?
  if (await isShowUIAlive()) return true;

  // Already booting?
  if (bootingPromise) return bootingPromise;

  onLog('[ShowUI] Server not running — auto-starting inside WSL...');

  bootingPromise = (async () => {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const platform = process.platform;

      if (platform === 'win32') {
        // Windows: use WSL
        try {
          execSync('wsl -e echo ok', { timeout: 5000 });
        } catch {
          onLog('[ShowUI] ❌ WSL not available — cannot auto-start ShowUI');
          return false;
        }

        const cmd = buildWslLaunchCmd();
        showuiProc = spawn('wsl', ['bash', '-c', cmd], { shell: false, detached: false });
      } else if (platform === 'darwin') {
        // macOS: use Docker
        try {
          execSync('docker info', { timeout: 5000 });
        } catch {
          onLog('[ShowUI] ❌ Docker not available — cannot auto-start ShowUI');
          return false;
        }

        const cmd = [
          'if [ -d /root/ShowUI ]; then cd /root/ShowUI; elif [ -d ~/ShowUI ]; then cd ~/ShowUI; else echo "ShowUI directory not found"; exit 1; fi',
          'export CUDA_VISIBLE_DEVICES="-1"',
          '[ -f ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh',
          '[ -f venv_docker/bin/python3 ] || ~/.local/bin/uv venv venv_docker --python 3.12',
          'venv_docker/bin/python3 -c "import gradio" 2>/dev/null || (~/.local/bin/uv pip install --python venv_docker/bin/python3 gradio torch torchvision torchaudio && [ -f requirements.txt ] && ~/.local/bin/uv pip install --python venv_docker/bin/python3 -r requirements.txt)',
          'CUDA_VISIBLE_DEVICES="-1" venv_docker/bin/python3 app.py',
        ].join(' && ');
        showuiProc = spawn('docker', ['exec', 'everfern-ubuntu', 'bash', '-c', cmd], { shell: false, detached: false });
      } else {
        // Linux: native execution
        const cmd = [
          'if [ -d /root/ShowUI ]; then cd /root/ShowUI; elif [ -d ~/ShowUI ]; then cd ~/ShowUI; else echo "ShowUI directory not found"; exit 1; fi',
          'export CUDA_VISIBLE_DEVICES="-1"',
          '[ -f ~/.local/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh',
          '[ -f venv_native/bin/python3 ] || ~/.local/bin/uv venv venv_native --python 3.12',
          'venv_native/bin/python3 -c "import gradio" 2>/dev/null || (~/.local/bin/uv pip install --python venv_native/bin/python3 gradio torch torchvision torchaudio && [ -f requirements.txt ] && ~/.local/bin/uv pip install --python venv_native/bin/python3 -r requirements.txt)',
          'CUDA_VISIBLE_DEVICES="-1" venv_native/bin/python3 app.py',
        ].join(' && ');
        showuiProc = spawn('bash', ['-c', cmd], { shell: false, detached: false });
      }

      showuiProc.stdout?.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(l => onLog(`[ShowUI] ${l}`))
      );
      showuiProc.stderr?.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(l => onLog(`[ShowUI:err] ${l}`))
      );
      showuiProc.on('exit', (code) => {
        if (code !== 0) onLog(`[ShowUI] Process exited with code ${code}`);
        showuiProc = null;
        bootingPromise = null;
      });

      onLog('[ShowUI] Waiting for Gradio server to be reachable on port 7860...');
      const ready = await waitForReady(onLog);
      if (!ready) bootingPromise = null;
      return ready;
    } catch (err) {
      onLog(`[ShowUI] Auto-start error: ${err}`);
      bootingPromise = null;
      return false;
    }
  })();

  return bootingPromise;
}

// ── Teardown ──────────────────────────────────────────────────────────
/**
 * Kills the ShowUI server process if it is running.
 * Called when the Electron app is about to quit.
 */
export function killShowUIServer(): void {
  if (showuiProc) {
    try {
      showuiProc.kill('SIGTERM');
    } catch { /* ignore */ }
    showuiProc = null;
    bootingPromise = null;
  }
}
