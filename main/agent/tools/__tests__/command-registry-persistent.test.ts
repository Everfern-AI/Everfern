import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../terminal/registry';
import * as path from 'path';

describe('CommandRegistry Persistent Sessions', () => {
  it('should run commands in the same persistent shell and preserve directory changes', async () => {
    const registry = CommandRegistry.getInstance();
    const sessionId = `test_session_${Date.now()}`;
    const initialCwd = process.cwd();

    // Command 1: Change directory to src
    const res1 = await registry.execute(
      `${sessionId}_1`,
      'cd src',
      initialCwd,
      5000,
      'main'
    );
    expect(res1.status).toBe('completed');

    // Command 2: Get current directory
    const getDirCmd = process.platform === 'win32' ? 'cd' : 'pwd';
    const res2 = await registry.execute(
      `${sessionId}_2`,
      getDirCmd,
      initialCwd,
      5000,
      'main'
    );
    expect(res2.status).toBe('completed');

    // Verify that the directory of command 2 contains 'src' at the end
    const finalPath = res2.output.trim();
    expect(finalPath.replace(/\\/g, '/')).toContain('/src');
  });
});
