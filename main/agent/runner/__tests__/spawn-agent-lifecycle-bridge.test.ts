import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readRepoFile(filePath: string): string {
  return fs.readFileSync(path.join(root, filePath), 'utf-8');
}

describe('spawn_agent lifecycle bridge', () => {
  it('emits high-level subagent_event lifecycle messages for the frontend chip', () => {
    const runner = readRepoFile('main/agent/runner/runner.ts');

    expect(runner).toContain("type: 'subagent_event'");
    expect(runner).toContain("subagentEventType: 'phase_start' | 'phase_complete' | 'phase_error'");
    expect(runner).toContain("emitSubagentPhase('phase_start', spawnedAgent.agentId");
    expect(runner).toContain("emitSubagentPhase('phase_complete', spawnedAgent.agentId");
    expect(runner).toContain("emitSubagentPhase('phase_error', spawnedAgent.agentId");
    expect(runner).toContain('agentId');
    expect(runner).toContain('description: task');
  });

  it('relies on the generic IPC event mapping to deliver acp:subagent-event', () => {
    const ipc = readRepoFile('main/ipc/agent.ts');
    const preload = readRepoFile('preload/preload.ts');

    expect(ipc).toContain("safeSend(`acp:${streamEvent.type.replace(/_/g, '-')}`, streamEvent)");
    expect(preload).toContain("ipcRenderer.on('acp:subagent-event'");
    expect(preload).toContain('onSubagentEvent');
  });
});
