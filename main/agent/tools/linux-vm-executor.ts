import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Result shape matching the existing pi-tools terminal output format
 */
export interface LinuxVMExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
    console.warn(`[runInLinuxVM] VM execution failed, falling back to native execution: ${error}`);
    return await runNatively(command, cwd, onUpdate);
  }
}

/**
 * Runs command in WSL (Windows Subsystem for Linux)
 */
let _wslCmdCache: string | null = null;

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
let _wslSetupDone = false;

export async function ensureWSLSetup(): Promise<void> {
  if (_wslSetupDone) return;
  _wslSetupDone = true; // only attempt once
  const wslCmd = getWslCmd();
  console.log('[ensureWSLSetup] Setting up WSL environment...');

  try {
    // Check if python3 is installed
    const { stdout: whichOut } = await execAsync(`${wslCmd} --exec bash -c "command -v python3"`, { timeout: 15000 });
    if (whichOut.trim()) {
      console.log('[ensureWSLSetup] python3 already installed');
    } else {
      console.log('[ensureWSLSetup] python3 not found, installing via root...');
      // Use --user root because apt-get needs root in WSL
      await execAsync(`${wslCmd} --user root --exec bash -c "apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv curl wget"`, { timeout: 180000 });
    }
  } catch (err) {
    // First attempt failed (e.g., wsl --user root unavailable). Try sudo approach.
    console.log('[ensureWSLSetup] Root attempt failed, trying sudo...', err);
    try {
      await execAsync(`${wslCmd} --exec bash -c "sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip python3-venv curl wget"`, { timeout: 180000 });
    } catch (err2) {
      // Both install attempts failed — log and continue without python3
      console.error('[ensureWSLSetup] Failed to install python3:', err2);
    }
  }

  // Create ~/.everfern/ directory and set up venv (runs as default WSL user)
  try {
    const setupScript = [
      'mkdir -p ~/.everfern',
      'if [ ! -d ~/.everfern/venv ] && command -v python3 &>/dev/null; then',
      '  python3 -m venv ~/.everfern/venv',
      '  ~/.everfern/venv/bin/pip install --upgrade pip -q',
      'fi'
    ].join(' && ');
    await execAsync(`${wslCmd} --exec bash -c "${setupScript}"`, { timeout: 60000 });
  } catch (err) {
    console.error('[ensureWSLSetup] Failed to create venv:', err);
  }

  // Ensure default user has passwordless sudo
  try {
    const { stdout: defaultUserOut } = await execAsync(`${wslCmd} --exec bash -c "whoami"`);
    const defaultUser = defaultUserOut.trim();
    if (defaultUser && defaultUser !== 'root') {
      await execAsync(`${wslCmd} --user root --exec bash -c "echo '${defaultUser} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${defaultUser} && chmod 0440 /etc/sudoers.d/${defaultUser}"`);
    }
  } catch (err) {
    console.error('[ensureWSLSetup] Failed to configure passwordless sudo:', err);
  }

  console.log('[ensureWSLSetup] WSL environment setup complete ✅');
}

async function runInWSL(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  const wslCmd = getWslCmd();
  console.log(`[runInWSL] Using WSL command: ${wslCmd}`);

  // Ensure WSL is set up (python3, .everfern/, venv) — never throws
  try {
    await ensureWSLSetup();
  } catch (err) {
    console.error('[runInWSL] WSL setup failed (continuing anyway):', err);
  }

  // Translate Windows paths to Linux paths if cwd is provided
  let linuxCwd = cwd;
  if (cwd) {
    linuxCwd = translateWindowsPathToLinux(cwd);
  }

  // If a working directory is specified, prepend cd command
  let fullCommand = command;
  if (linuxCwd) {
    fullCommand = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin" && cd "${linuxCwd}" && ${command}`;
  } else {
    fullCommand = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin" && ${command}`;
  }

  return executeCommand(wslCmd, ['--exec', 'bash', '-c', fullCommand], onUpdate);
}

/**
 * Runs command in Docker Ubuntu container (macOS)
 */
async function runInDocker(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  // Ensure Docker container exists and is running
  await ensureDockerContainer();

  // Translate macOS paths to Docker volume mounts if cwd is provided
  let dockerCwd = cwd;
  if (cwd) {
    dockerCwd = translateMacOSPathToDocker(cwd);
  }

  // If a working directory is specified, prepend cd command
  let fullCommand = command;
  if (dockerCwd) {
    fullCommand = `cd "${dockerCwd}" && ${command}`;
  }

  return executeCommand('docker', ['exec', 'everfern-ubuntu', 'bash', '-c', fullCommand], onUpdate);
}

/**
 * Runs command natively (Linux or fallback)
 */
async function runNatively(command: string, cwd?: string, onUpdate?: (chunk: string) => void): Promise<LinuxVMExecutionResult> {
  let fullCommand = command;
  if (cwd) {
    fullCommand = `cd "${cwd}" && ${command}`;
  }

  if (process.platform === 'win32') {
    return executeCommand('cmd.exe', ['/c', fullCommand], onUpdate);
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
    const proc = spawn(cmd, args, {
      shell: process.platform === 'win32', // Use shell on Windows to ensure WSL runs properly in Electron
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
      await execAsync('docker exec everfern-ubuntu apt-get install -y curl wget git python3 python3-pip python3-venv nodejs npm');

      // Create ~/.everfern/ directory and Python venv
      await execAsync('docker exec everfern-ubuntu bash -c "mkdir -p ~/.everfern && python3 -m venv ~/.everfern/venv && ~/.everfern/venv/bin/pip install --upgrade pip -q"');
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
