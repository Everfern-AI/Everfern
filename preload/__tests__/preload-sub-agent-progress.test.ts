import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const preloadSource = fs.readFileSync(path.join(process.cwd(), 'preload/preload.ts'), 'utf8');

describe('preload sub-agent progress bridge', () => {
  it('subscribes and returns a scoped cleanup function', () => {
    expect(preloadSource).toContain("ipcRenderer.on('acp:sub-agent-progress', handler)");
    expect(preloadSource).toContain("ipcRenderer.removeListener('acp:sub-agent-progress', handler)");
  });

  it('exposes the high-level subagent lifecycle bridge', () => {
    expect(preloadSource).toContain('onSubagentEvent:');
    expect(preloadSource).toContain("ipcRenderer.on('acp:subagent-event', handler)");
    expect(preloadSource).toContain("ipcRenderer.removeListener('acp:subagent-event', handler)");
  });
});
