import { describe, it, expect, vi } from 'vitest';
import { guardWorkerTools, isPrivateUrl, isUnattendedRun } from '../../../main/agent/runner/worker-tool-policy';

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

  it('blocks computer use in worker sessions instead of rerouting it', async () => {
    const host = tool('computer_use'), vm = tool('navis');
    const tools = guardWorkerTools([host, vm], { currentConversationId: 'worker-test' });
    expect((await tools[0].execute({ task: 'Click the app button' })).success).toBe(false);
    expect(host.execute).not.toHaveBeenCalled();
    expect(vm.execute).not.toHaveBeenCalled();
  });

  it('gives workers read-only memory', async () => {
    const names = ['memory_save', 'remember_fact', 'update_profile', 'memory_search'];
    const tools = guardWorkerTools(names.map(tool), { currentConversationId: 'worker-abc-run-1700000000000' });
    const results = await Promise.all(tools.map((t) => t.execute({})));
    expect(results.map((r) => r.success)).toEqual([false, false, false, true]);
  });

  it('does not let scheduled runs wait for an answer', async () => {
    const ask = tool('ask_user');
    const [scheduled] = guardWorkerTools([ask], { currentConversationId: 'worker-abc-auto-1700000000000' });
    expect((await scheduled.execute({ question: 'Which sheet?' })).success).toBe(false);
    const [watched] = guardWorkerTools([ask], { currentConversationId: 'worker-abc-run-1700000000000' });
    expect((await watched.execute({ question: 'Which sheet?' })).success).toBe(true);
    expect(isUnattendedRun('worker-abc-auto-1700000000000')).toBe(true);
    expect(isUnattendedRun('chat-auto-1')).toBe(false);
  });

  it('keeps web_fetch off the local network for workers', async () => {
    const fetchTool = tool('web_fetch');
    const [guarded] = guardWorkerTools([fetchTool], { currentConversationId: 'worker-abc-run-1' });
    for (const url of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://2130706433/', 'file:///etc/passwd', 'http://printer.local/']) {
      expect((await guarded.execute({ url })).success, url).toBe(false);
    }
    expect((await guarded.execute({ url: 'https://example.com/' })).success).toBe(true);
    expect(isPrivateUrl('https://8.8.8.8/')).toBe(false);
    expect(isPrivateUrl('http://172.20.1.1/')).toBe(true);
  });

  it('allows worker desktop tools inside worker sessions', async () => {
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
