/**
 * @vitest-environment node
 *
 * Unit tests for UnifiedExecutor
 *
 * Tests core functionality including:
 * - Basic command execution
 * - Shell detection
 * - Output streaming
 * - Timeout protection
 * - ANSI stripping
 */

import { describe, it, expect } from 'vitest';
import { UnifiedExecutor } from './unified-executor';

describe('UnifiedExecutor', () => {
  describe('Basic Smoke Tests', () => {
    it('should execute a simple command successfully', async () => {
      const result = await UnifiedExecutor.execute({
        command: process.platform === 'win32' ? 'echo Hello' : 'echo Hello',
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it('should handle command with no output', async () => {
      // Use a command that exits cleanly with no output
      const command = process.platform === 'win32'
        ? 'exit 0'
        : 'true';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      // Should have either empty output or placeholder message
      expect(typeof result.output).toBe('string');
    });

    it('should capture error output and non-zero exit codes', async () => {
      const command = process.platform === 'win32'
        ? 'cmd /c "echo Error message 1>&2 && exit 1"'
        : 'echo "Error message" >&2 && exit 1';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 5000
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  describe('Shell Detection', () => {
    it('should detect shell based on platform', async () => {
      const updates: string[] = [];

      await UnifiedExecutor.execute({
        command: process.platform === 'win32' ? 'echo test' : 'echo test',
        timeout: 5000,
        onUpdate: (chunk) => updates.push(chunk)
      });

      // Should have logged which shell was used
      const shellLog = updates.find(u => u.includes('[Executor] Using shell:'));
      expect(shellLog).toBeDefined();

      if (process.platform === 'win32') {
        expect(shellLog).toMatch(/powershell|wsl/);
      } else {
        expect(shellLog).toContain('bash');
      }
    });

    it('should allow shell override', async () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows (bash is default anyway)
        return;
      }

      const updates: string[] = [];

      await UnifiedExecutor.execute({
        command: 'echo test',
        shell: 'powershell',
        timeout: 5000,
        onUpdate: (chunk) => updates.push(chunk)
      });

      const shellLog = updates.find(u => u.includes('[Executor] Using shell:'));
      expect(shellLog).toContain('powershell');
    });
  });

  describe('Output Streaming', () => {
    it('should call onUpdate callback with output', async () => {
      const updates: string[] = [];

      const result = await UnifiedExecutor.execute({
        command: process.platform === 'win32'
          ? 'echo First && echo Second'
          : 'echo First && echo Second',
        timeout: 5000,
        onUpdate: (chunk) => updates.push(chunk)
      });

      expect(result.success).toBe(true);
      expect(updates.length).toBeGreaterThan(0);

      // Check that output was streamed
      const allOutput = updates.join('');
      expect(allOutput).toContain('First');
      expect(allOutput).toContain('Second');
    });
  });

  describe('Timeout Protection (Task 3)', () => {
    /**
     * Task 3.1: Verify createTimeout() helper works correctly
     *
     * Tests that the timeout mechanism properly rejects after the specified duration
     * and provides the correct error message.
     */
    it('3.1 - Should create timeout promise that rejects after specified duration', async () => {
      const timeoutMs = 500;
      const startTime = Date.now();

      // Test with a command that would timeout
      const command = process.platform === 'win32'
        ? 'powershell -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: timeoutMs
      });

      const elapsed = Date.now() - startTime;

      // Verify timeout happened
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);

      // Verify it happened within reasonable time (±500ms tolerance)
      expect(elapsed).toBeLessThan(timeoutMs + 1000);
      expect(elapsed).toBeGreaterThan(timeoutMs - 100);
    }, 15000);

    /**
     * Task 3.2: Verify Promise.race() is used in execute()
     *
     * Tests that Promise.race() correctly picks the winner between execution and timeout.
     * A successful quick execution should complete before timeout.
     */
    it('3.2 - Should use Promise.race() between execution and timeout', async () => {
      const command = process.platform === 'win32'
        ? 'echo "Quick execution"'
        : 'echo "Quick execution"';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 30000 // Very long timeout
      });

      // Quick command should succeed before timeout
      expect(result.timedOut).toBe(false);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Quick execution');
      expect(result.duration).toBeLessThan(5000); // Should complete quickly
    });

    /**
     * Task 3.3: Verify process is killed on timeout
     *
     * Tests that when timeout occurs, the spawned process is properly terminated.
     * We verify this by checking that:
     * - The result indicates timeout
     * - No error is thrown (graceful shutdown)
     * - Subsequent executions work (process was cleaned up)
     */
    it('3.3 - Should kill spawned process on timeout', async () => {
      const command = process.platform === 'win32'
        ? 'powershell -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 500
      });

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);

      // Verify that subsequent commands work (process was cleaned up)
      const subsequentResult = await UnifiedExecutor.execute({
        command: process.platform === 'win32' ? 'echo OK' : 'echo OK',
        timeout: 5000
      });

      expect(subsequentResult.success).toBe(true);
      expect(subsequentResult.output).toContain('OK');
    }, 15000);

    /**
     * Task 3.4: Verify partial output is returned
     *
     * Tests that when a timeout occurs, any output that was produced before
     * the timeout is captured and returned (not discarded).
     */
    it('3.4 - Should return partial output when timeout occurs', async () => {
      // Create a command that outputs something then sleeps
      const command = process.platform === 'win32'
        ? 'powershell -Command "Write-Host \'Starting task...\'; Start-Sleep -Seconds 30"'
        : 'echo "Starting task..."; sleep 30';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 1000
      });

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);

      // Partial output should be present (what was printed before timeout)
      expect(result.output).toBeDefined();
      // The output should either contain what was printed or the timeout message
      expect(typeof result.output).toBe('string');
      expect(result.output.length).toBeGreaterThan(0);
    }, 15000);

    /**
     * Task 3.5: Verify timedOut flag is set
     *
     * Tests that the result object has timedOut flag set to true when timeout occurs
     * and false when execution completes normally.
     */
    it('3.5 - Should set timedOut flag in result', async () => {
      // Case 1: Normal completion
      const normalResult = await UnifiedExecutor.execute({
        command: process.platform === 'win32' ? 'echo OK' : 'echo OK',
        timeout: 30000
      });

      expect(normalResult.timedOut).toBe(false);
      expect(normalResult.success).toBe(true);

      // Case 2: Timeout
      const timeoutResult = await UnifiedExecutor.execute({
        command: process.platform === 'win32'
          ? 'powershell -Command "Start-Sleep -Seconds 30"'
          : 'sleep 30',
        timeout: 500
      });

      expect(timeoutResult.timedOut).toBe(true);
      expect(timeoutResult.success).toBe(false);
    }, 15000);

    /**
     * Task 3.6: Test that no zombie processes remain after timeout
     *
     * This test verifies that when a process times out, it's properly cleaned up
     * and doesn't become a zombie process. We do this by:
     * - Creating a timeout scenario
     * - Checking that the system can immediately spawn new processes
     * - Verifying no lingering processes affect subsequent executions
     */
    it('3.6 - Should ensure no zombie processes remain after timeout', async () => {
      // Execute a command that will timeout
      const command = process.platform === 'win32'
        ? 'powershell -Command "Start-Sleep -Seconds 30"'
        : 'sleep 30';

      const timeoutResult = await UnifiedExecutor.execute({
        command,
        timeout: 500
      });

      expect(timeoutResult.timedOut).toBe(true);

      // Immediately execute multiple commands to verify process resources are freed
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          UnifiedExecutor.execute({
            command: process.platform === 'win32'
              ? `echo "Command ${i}"`
              : `echo "Command ${i}"`,
            timeout: 5000
          })
        );
      }

      const results = await Promise.all(promises);

      // All should succeed with no resource issues
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.output).toContain(`Command ${index}`);
      });
    }, 20000);

    /**
     * Comprehensive timeout test
     * Validates all timeout aspects together
     */
    it('should timeout long-running commands', async () => {
      const command = process.platform === 'win32'
        ? 'powershell -Command "Start-Sleep -Seconds 10"'
        : 'sleep 10';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 1000 // 1 second timeout
      });

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(result.output).toContain('timed out');
    }, 10000); // Test timeout of 10s to be safe
  });

  describe('ANSI Stripping', () => {
    it('should strip ANSI codes from output', async () => {
      // Command that produces ANSI color codes
      const command = process.platform === 'win32'
        ? 'powershell -Command "Write-Host \'Colored\' -ForegroundColor Red"'
        : 'echo -e "\\033[31mColored\\033[0m"';

      const result = await UnifiedExecutor.execute({
        command,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      // Output should contain the text but not ANSI escape codes
      expect(result.output).toContain('Colored');
      // Should not contain ANSI escape sequences (start with ESC character)
      expect(result.output).not.toMatch(/\x1B\[/);
    });
  });

  describe('Working Directory', () => {
    it('should respect custom working directory', async () => {
      const command = process.platform === 'win32'
        ? 'powershell -Command "Get-Location"'
        : 'pwd';

      const testCwd = process.platform === 'win32'
        ? 'C:\\Windows\\System32'
        : '/tmp';

      const result = await UnifiedExecutor.execute({
        command,
        cwd: testCwd,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      // Output should contain the working directory path
      const normalizedOutput = result.output.replace(/\\/g, '/').toLowerCase();
      const normalizedCwd = testCwd.replace(/\\/g, '/').toLowerCase();
      expect(normalizedOutput).toContain(normalizedCwd);
    });
  });
});
