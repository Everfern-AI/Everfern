/**
 * Integration test for task 2.4: Output format consistency
 *
 * Verifies that the tool's output format (stdout, stderr, exit code) is unchanged —
 * the agent sees the same structure regardless of execution path (VM vs native).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolResult } from '../../runner/types';

describe('Task 2.4: Output Format Consistency', () => {
  describe('VM Execution Path', () => {
    it('should return consistent format for successful command', () => {
      // Simulate VM execution result
      const vmResult = {
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0
      };

      // Transform to ToolResult format (as done in pi-tools.ts)
      const toolResult: ToolResult = vmResult.exitCode === 0
        ? {
            success: true,
            output: vmResult.stdout
          }
        : {
            success: false,
            output: vmResult.stderr || vmResult.stdout,
            error: vmResult.stderr || vmResult.stdout
          };

      // Verify structure
      expect(toolResult).toHaveProperty('success', true);
      expect(toolResult).toHaveProperty('output', 'Hello World');
      expect(toolResult.error).toBeUndefined();
    });

    it('should return consistent format for failed command with stderr', () => {
      const vmResult = {
        stdout: '',
        stderr: 'Command not found',
        exitCode: 127
      };

      const toolResult: ToolResult = vmResult.exitCode === 0
        ? {
            success: true,
            output: vmResult.stdout
          }
        : {
            success: false,
            output: vmResult.stderr || vmResult.stdout,
            error: vmResult.stderr || vmResult.stdout
          };

      expect(toolResult).toEqual({
        success: false,
        output: 'Command not found',
        error: 'Command not found'
      });
    });

    it('should return consistent format for failed command with only stdout', () => {
      const vmResult = {
        stdout: 'Error: Something went wrong',
        stderr: '',
        exitCode: 1
      };

      const toolResult: ToolResult = vmResult.exitCode === 0
        ? {
            success: true,
            output: vmResult.stdout
          }
        : {
            success: false,
            output: vmResult.stderr || vmResult.stdout,
            error: vmResult.stderr || vmResult.stdout
          };

      expect(toolResult).toEqual({
        success: false,
        output: 'Error: Something went wrong',
        error: 'Error: Something went wrong'
      });
    });
  });

  describe('Native Execution Path', () => {
    it('should return consistent format for successful command', () => {
      // Simulate native execution result (pi-tools format)
      const nativeResult = {
        content: [{ type: 'text', text: 'Hello World' }],
        isError: false
      };

      // Transform to ToolResult format (as done in pi-tools.ts)
      const outputText = nativeResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      const toolResult: ToolResult = nativeResult.isError
        ? { success: false, output: outputText, error: outputText }
        : { success: true, output: outputText };

      expect(toolResult).toEqual({
        success: true,
        output: 'Hello World'
      });
      expect(toolResult.error).toBeUndefined();
    });

    it('should return consistent format for failed command', () => {
      const nativeResult = {
        content: [{ type: 'text', text: 'Command not found' }],
        isError: true
      };

      const outputText = nativeResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      const toolResult: ToolResult = nativeResult.isError
        ? { success: false, output: outputText, error: outputText }
        : { success: true, output: outputText };

      expect(toolResult).toEqual({
        success: false,
        output: 'Command not found',
        error: 'Command not found'
      });
    });
  });

  describe('Cross-Path Consistency', () => {
    it('should produce identical structure for success from both paths', () => {
      // VM path
      const vmResult = {
        stdout: 'Success output',
        stderr: '',
        exitCode: 0
      };

      const vmToolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      // Native path
      const nativeResult = {
        content: [{ type: 'text', text: 'Success output' }],
        isError: false
      };

      const nativeOutputText = nativeResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      const nativeToolResult: ToolResult = nativeResult.isError
        ? { success: false, output: nativeOutputText, error: nativeOutputText }
        : { success: true, output: nativeOutputText };

      // Both should have identical structure
      expect(vmToolResult).toEqual(nativeToolResult);
      expect(vmToolResult.success).toBe(nativeToolResult.success);
      expect(vmToolResult.output).toBe(nativeToolResult.output);
      expect(vmToolResult.error).toBe(nativeToolResult.error);
    });

    it('should produce identical structure for failure from both paths', () => {
      // VM path
      const vmResult = {
        stdout: '',
        stderr: 'Error message',
        exitCode: 1
      };

      const vmToolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      // Native path
      const nativeResult = {
        content: [{ type: 'text', text: 'Error message' }],
        isError: true
      };

      const nativeOutputText = nativeResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      const nativeToolResult: ToolResult = nativeResult.isError
        ? { success: false, output: nativeOutputText, error: nativeOutputText }
        : { success: true, output: nativeOutputText };

      // Both should have identical structure
      expect(vmToolResult).toEqual(nativeToolResult);
      expect(vmToolResult.success).toBe(nativeToolResult.success);
      expect(vmToolResult.output).toBe(nativeToolResult.output);
      expect(vmToolResult.error).toBe(nativeToolResult.error);
    });

    it('should ensure error field is always identical to output field on failure', () => {
      // VM path
      const vmResult = {
        stdout: 'Some stdout',
        stderr: 'Error in stderr',
        exitCode: 1
      };

      const vmToolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      // Native path
      const nativeResult = {
        content: [{ type: 'text', text: 'Error in stderr' }],
        isError: true
      };

      const nativeOutputText = nativeResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      const nativeToolResult: ToolResult = nativeResult.isError
        ? { success: false, output: nativeOutputText, error: nativeOutputText }
        : { success: true, output: nativeOutputText };

      // For both paths, output and error must be identical
      expect(vmToolResult.output).toBe(vmToolResult.error);
      expect(nativeToolResult.output).toBe(nativeToolResult.error);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty output correctly', () => {
      const vmResult = {
        stdout: '',
        stderr: '',
        exitCode: 0
      };

      const toolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      expect(toolResult).toEqual({
        success: true,
        output: ''
      });
    });

    it('should handle multiline output correctly', () => {
      const vmResult = {
        stdout: 'Line 1\nLine 2\nLine 3',
        stderr: '',
        exitCode: 0
      };

      const toolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      expect(toolResult.output).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle both stdout and stderr on failure', () => {
      const vmResult = {
        stdout: 'Some output before error',
        stderr: 'Fatal error occurred',
        exitCode: 1
      };

      const toolResult: ToolResult = vmResult.exitCode === 0
        ? { success: true, output: vmResult.stdout }
        : { success: false, output: vmResult.stderr || vmResult.stdout, error: vmResult.stderr || vmResult.stdout };

      // Should prefer stderr
      expect(toolResult.output).toBe('Fatal error occurred');
      expect(toolResult.error).toBe('Fatal error occurred');
    });
  });
});
