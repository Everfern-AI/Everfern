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
    fullCommand = `cd "${linuxCwd}" && ${command}`;
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
 * Generic command execution helper
 */
function executeCommand(cmd: string, args: string[]): Promise<LinuxVMExecutionResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      shell: false
    });

    let stdout = '';
    let stderr = '';

    const MAX_OUTPUT_LENGTH = 50000;

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = '...[Output truncated]...\n' + stdout.slice(-MAX_OUTPUT_LENGTH);
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
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
 * Ensures Docker container exists and is running for macOS
 */
async function ensureDockerContainer(): Promise<void> {
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
