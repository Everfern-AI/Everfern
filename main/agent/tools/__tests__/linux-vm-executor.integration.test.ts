import { describe, it, expect } from 'vitest';
import { runInLinuxVM } from '../linux-vm-executor';
import { execSync } from 'child_process';

/**
 * Integration tests for linux-vm-executor
 *
 * These tests verify actual WSL execution.
 * They will be skipped if WSL is not available on the system.
 */

// Check if WSL is available
function isWSLAvailable(): boolean {
  try {
    execSync('wsl.exe --status', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfWSL = isWSLAvailable() ? describe : describe.skip;

describeIfWSL('linux-vm-executor integration tests', () => {
  it('should execute a simple echo command', async () => {
    const result = await runInLinuxVM('echo Hello from WSL');

    expect(result.stdout).toContain('Hello from WSL');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  }, 10000);

  it('should capture stderr for invalid commands', async () => {
    const result = await runInLinuxVM('cat /nonexistent/file.txt');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No such file or directory');
  }, 10000);

  it('should execute commands with working directory', async () => {
    const result = await runInLinuxVM('pwd', 'C:\\Users');

    expect(result.stdout).toContain('/mnt/c/Users');
    expect(result.exitCode).toBe(0);
  });

  it('should handle commands that produce both stdout and stderr', async () => {
    // This command writes to both stdout and stderr
    const result = await runInLinuxVM('echo "stdout message" && echo "stderr message" >&2');

    expect(result.stdout).toContain('stdout message');
    expect(result.stderr).toContain('stderr message');
    expect(result.exitCode).toBe(0);
  });

  it('should return correct exit codes', async () => {
    const successResult = await runInLinuxVM('exit 0');
    expect(successResult.exitCode).toBe(0);

    const failureResult = await runInLinuxVM('exit 42');
    expect(failureResult.exitCode).toBe(42);
  });

  it('should handle commands with special characters', async () => {
    const result = await runInLinuxVM('echo "Test with $HOME and `date`"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Test with');
  });
});
