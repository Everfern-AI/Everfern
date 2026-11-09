import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planJob } from '../worker-engine';
import type { Worker } from '../workers';

const worker: Worker = { id: 'one', name: 'Worker', hue: 0, tier: 'balanced', status: 'idle', apps: [], prompt: '', createdAt: '' };
const plan = JSON.stringify({ reply: 'I will research this.', kind: 'do', steps: ['Research the topic'] });
const chat = vi.fn();
let onChunk: (chunk: any) => void;
const off = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (window as any).electronAPI = { acp: { chat, stream: vi.fn(), onChatChunk: (cb: typeof onChunk) => { onChunk = cb; return off; } } };
});

describe('worker planning connection recovery', () => {
  it('retries an interrupted stream without streaming', async () => {
    chat.mockResolvedValueOnce({ error: 'Stream interrupted: Response ended prematurely' }).mockResolvedValueOnce({ response: { content: plan } });
    expect(await planJob(worker, 'Research this')).toMatchObject({ live: true, kind: 'do', steps: ['Research the topic'] });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0][0].streamId).toBeTruthy();
    expect(chat.mock.calls[1][0].streamId).toBeUndefined();
    expect(off).toHaveBeenCalledOnce();
  });

  it('does not turn a model outage into fabricated workflow steps', async () => {
    chat.mockResolvedValue({ error: 'Stream interrupted: Response ended prematurely' });
    const result = await planJob(worker, 'Find competitors\nWrite a report');
    expect(result).toMatchObject({ live: false, kind: 'chat', steps: [] });
    expect(result.error).toBeTruthy();
  });

  it('uses a complete streamed plan even if the transport reports a late failure', async () => {
    chat.mockImplementationOnce(async ({ streamId }) => {
      onChunk({ streamId, delta: plan });
      return { error: 'Response ended prematurely' };
    });
    expect(await planJob(worker, 'Research this')).toMatchObject({ live: true, steps: ['Research the topic'] });
    expect(chat).toHaveBeenCalledOnce();
  });

  it('does not retry a provider configuration error', async () => {
    chat.mockResolvedValue({ error: 'No AI provider configured' });
    expect((await planJob(worker, 'Research this')).steps).toEqual([]);
    expect(chat).toHaveBeenCalledOnce();
  });
});
