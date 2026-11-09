import { describe, it, expect, vi } from 'vitest';
import { guardWorkerTools } from '../../../main/agent/runner/worker-tool-policy';

const tool = (name: string) => ({
  name,
  description: '',
  parameters: { type: 'object' as const, properties: {}, required: [] },
  execute: vi.fn(async () => ({ success: true, output: name })),
});

describe('worker VM boundary', () => {
  it('blocks host tools even when the worker ID is assigned after tool creation', async () => {
    const runner = { currentConversationId: '' };
    const host = tool('bash');
    const [guarded] = guardWorkerTools([host], runner);
    runner.currentConversationId = 'worker-test';
    expect((await guarded.execute({ command: 'open host browser' })).success).toBe(false);
    expect(host.execute).not.toHaveBeenCalled();
  });

  it('routes computer use through the VM browser controller', async () => {
    const host = tool('computer_use'), vm = tool('navis');
    const tools = guardWorkerTools([host, vm], { currentConversationId: 'worker-test' });
    expect((await tools[0].execute({ task: 'Click the app button' })).output).toBe('navis');
    expect(host.execute).not.toHaveBeenCalled();
    expect(vm.execute).toHaveBeenCalledOnce();
  });

  it('allows warmwind worker OS tools inside worker sessions', async () => {
    const openApp = tool('open_app');
    const switchApp = tool('switch_app');
    const workerBash = tool('worker_bash');
    const workerReadFile = tool('worker_read_file');
    const tools = guardWorkerTools([openApp, switchApp, workerBash, workerReadFile], {
      currentConversationId: 'worker-test',
    });

    expect((await tools[0].execute({ app: 'sheets' })).output).toBe('open_app');
    expect((await tools[1].execute({ app: 'gmail' })).output).toBe('switch_app');
    expect((await tools[2].execute({ command: 'ls' })).output).toBe('worker_bash');
    expect((await tools[3].execute({ path: 'test.csv' })).output).toBe('worker_read_file');
    expect(openApp.execute).toHaveBeenCalledOnce();
    expect(switchApp.execute).toHaveBeenCalledOnce();
    expect(workerBash.execute).toHaveBeenCalledOnce();
    expect(workerReadFile.execute).toHaveBeenCalledOnce();
  });

  it('keeps normal chat tools available', async () => {
    const host = tool('computer_use');
    const [guarded] = guardWorkerTools([host], { currentConversationId: 'chat-test' });
    expect((await guarded.execute({})).success).toBe(true);
    expect(host.execute).toHaveBeenCalledOnce();
  });
});
