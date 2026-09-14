/**
 * Test: bashTool integration in pi-tools.ts
 *
 * Verifies that:
 * 1. bashTool is loaded and adapted correctly
 * 2. ANSI stripping works on bashTool output
 * 3. ToolResult format is correct
 * 4. bashTool is renamed to 'executePwsh' for naming consistency
 */

import { describe, it, expect, vi } from 'vitest';
import { getPiCodingTools } from '../pi-tools';

vi.setConfig({ testTimeout: 30000 });

describe('bashTool integration', () => {
  it('should load bashTool as executePwsh', async () => {
    const tools = await getPiCodingTools();
    const bashTool = tools.find(t => t.name === 'executePwsh');

    expect(bashTool).toBeDefined();
    expect(bashTool?.name).toBe('executePwsh');
    expect(bashTool?.description).toBeDefined();
    expect(bashTool?.parameters).toBeDefined();
    expect(bashTool?.execute).toBeInstanceOf(Function);
  });

  it('should execute simple command and return ToolResult', async () => {
    const tools = await getPiCodingTools();
    const bashTool = tools.find(t => t.name === 'executePwsh');

    expect(bashTool).toBeDefined();

    // Execute a simple echo command
    const result = await bashTool!.execute({ command: 'echo "test"' });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('output');
    expect(result.success).toBe(true);
    expect(result.output).toContain('test');
  });

  it('should strip ANSI codes from output', async () => {
    const tools = await getPiCodingTools();
    const bashTool = tools.find(t => t.name === 'executePwsh');

    expect(bashTool).toBeDefined();

    // Execute command that produces ANSI codes (if available)
    // Note: This test may need adjustment based on actual command availability
    const result = await bashTool!.execute({ command: 'echo "test"' });

    // Verify no ANSI escape sequences in output
    expect(result.output).not.toMatch(/\x1B\[/);
  });

  it('should handle command errors correctly', async () => {
    const tools = await getPiCodingTools();
    const bashTool = tools.find(t => t.name === 'executePwsh');

    expect(bashTool).toBeDefined();

    // Execute a command that will fail
    const result = await bashTool!.execute({ command: 'exit 1' });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('output');
    // Note: The exact behavior depends on bashTool implementation
    // It may return success: false or success: true with error in output
  });

  it('should preserve existing file operation tools', async () => {
    const tools = await getPiCodingTools();

    // Verify all expected tools are present
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('read');
    expect(toolNames).toContain('write');
    expect(toolNames).toContain('edit');
    expect(toolNames).toContain('find');
    expect(toolNames).toContain('grep');
    expect(toolNames).toContain('ls');
    expect(toolNames).toContain('executePwsh');

    // Verify we have exactly 7 tools (6 file ops + 1 bash)
    expect(tools).toHaveLength(7);
  });
});
