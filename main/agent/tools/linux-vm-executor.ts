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
 * @param command - The shell command to execute in the Linux VM
 * @param cwd - Optional working directory (will be translated to appropriate path if needed)
 * @returns Promise resolving to stdout, stderr, and exitCode
 */
export async function runInLinuxVM(
  command: string,
  cwd?: string
): Promise<LinuxVMExecutionResult> {
  const platform = process.platform;

  try {
    switch (platform) {
      case 'win32':
        return await runInWSL(command, cwd);
      case 'darwin':
        return await runInDocker(command, cwd);
      case 'linux':
        // Already on Linux, run natively
        return await runNatively(command, cwd);
      default:
        console.warn(`Unsupported platform ${platform}, falling back to native execution`);
        return await runNatively(command, cwd);
    }
  } catch (error) {
    console.warn(`VM execution failed, falling back to native execution: ${error}`);
    return await runNatively(command, cwd);
  }
}

/**
 * Runs command in WSL (Windows Subsystem for Linux)
 */
async function runInWSL(command: string, cwd?: string): Promise<LinuxVMExecutionResult> {
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

  return executeCommand('wsl.exe', ['--exec', 'bash', '-c', fullCommand]);
}

/**
 * Runs command in Docker Ubuntu container (macOS)
 */
async function runInDocker(command: string, cwd?: string): Promise<LinuxVMExecutionResult> {
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

  return executeCommand('docker', ['exec', 'everfern-ubuntu', 'bash', '-c', fullCommand]);
}

/**
 * Runs command natively (Linux or fallback)
 */
async function runNatively(command: string, cwd?: string): Promise<LinuxVMExecutionResult> {
  // If a working directory is specified, prepend cd command
  let fullCommand = command;
  if (cwd) {
    fullCommand = `cd "${cwd}" && ${command}`;
  }

  return executeCommand('bash', ['-c', fullCommand]);
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
  try {
    if (platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync('wsl.exe -e echo ok', { stdio: 'ignore', timeout: 3000 });
        return { available: true };
      } catch (err: any) {
        return { 
          available: false, 
          reason: 'WSL is not running or no Linux distribution (such as Ubuntu) is installed. Please set up WSL.' 
        };
      }
    } else if (platform === 'darwin') {
      try {
        const { execSync } = require('child_process');
        execSync('docker info', { stdio: 'ignore', timeout: 3000 });
        return { available: true };
      } catch (err: any) {
        return { 
          available: false, 
          reason: 'Docker Desktop is not installed or not running. Please start Docker.' 
        };
      }
    } else if (platform === 'linux') {
      return { available: true };
    }
    return { available: false, reason: `Unsupported platform: ${platform}` };
  } catch (err: any) {
    return { available: false, reason: err.message };
  }
}

/**
 * Generic command execution helper
 */
function executeCommand(cmd: string, args: string[]): Promise<LinuxVMExecutionResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      shell: process.platform === 'win32', // Use shell on Windows to ensure WSL runs properly in Electron
      env: { ...process.env, WSL_UTF8: '1', WSLENV: '' } // Force WSL to output UTF-8
    });

    const environmentType = process.platform === 'win32'
      ? 'WSL (Ubuntu)'
      : process.platform === 'darwin'
      ? 'Docker (Ubuntu)'
      : 'Native Linux';

    const debugHeader = `[EverFern VM Debug - Environment: ${environmentType}]\n` +
      `Command: ${cmd} ${args.join(' ')}\n` +
      `--------------------------------------------------\n`;

    let stdout = debugHeader;
    let stderr = '';

    const MAX_OUTPUT_LENGTH = 50000;

    proc.stdout?.on('data', (data) => {
      stdout += decodeBuffer(data);
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = '...[Output truncated]...\n' + stdout.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += decodeBuffer(data);
      if (stderr.length > MAX_OUTPUT_LENGTH) {
        stderr = '...[Output truncated]...\n' + stderr.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr: stderr ? debugHeader + stderr : '',
        exitCode: code ?? -1
      });
    });

    proc.on('error', (err) => {
      resolve({
        stdout,
        stderr: debugHeader + stderr + `\nError: ${err.message}`,
        exitCode: -1
      });
    });
  });
}

/**
 * Ensures Docker container exists and is running for macOS
 */
export async function ensureDockerContainer(): Promise<void> {
  try {
    // Check if Docker is running
    await execAsync('docker info');

    // Check if container exists
    const { stdout: containerList } = await execAsync('docker ps -a --filter name=everfern-ubuntu --format "{{.Names}}"');

    if (!containerList.includes('everfern-ubuntu')) {
      // Create container with volume mount for /Users
      console.log('Creating everfern-ubuntu Docker container...');
      await execAsync('docker run -d --name everfern-ubuntu -v /Users:/host/Users ubuntu:latest tail -f /dev/null');

      // Install basic tools in the container
      await execAsync('docker exec everfern-ubuntu apt-get update');
      await execAsync('docker exec everfern-ubuntu apt-get install -y curl wget git python3 python3-pip nodejs npm');
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
