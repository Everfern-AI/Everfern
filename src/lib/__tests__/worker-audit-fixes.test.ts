import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULE_LABELS, advanceWorkerSchedule, cleanSchedule, makeWorkerSchedule } from '../worker-schedule';
import { activeRunOf, firstJsonObject, runWorker, stopWorker, TIER_REASONING } from '../worker-engine';
import { withRun, type Worker } from '../workers';

const worker = (id: string, tier: Worker['tier'] = 'balanced'): Worker =>
  ({ id, name: id, hue: 0, tier, status: 'idle', apps: [], prompt: 'Do it', createdAt: '' });

describe('schedules (audit 6, 18)', () => {
  it('every schedule button makes a valid schedule that can advance', () => {
    const now = new Date(2026, 10, 10, 10, 0);
    for (const label of SCHEDULE_LABELS) {
      const s = makeWorkerSchedule(label, now);
      expect(Date.parse(s.nextRun)).toBeGreaterThan(now.getTime());
      expect(cleanSchedule(JSON.parse(JSON.stringify(s)))).toEqual(s);
      expect(() => advanceWorkerSchedule(s, new Date(Date.parse(s.nextRun) + 1000))).not.toThrow();
    }
  });

  it('keeps working when the label is renamed', () => {
    const s = { ...makeWorkerSchedule('Every day at 9:00', new Date(2026, 10, 10, 10)), label: 'Daily, 9am' };
    const next = advanceWorkerSchedule(s, new Date(2026, 10, 11, 9, 0, 5))!;
    expect(new Date(next.nextRun).getHours()).toBe(9);
    expect(new Date(next.nextRun).getDate()).toBe(12);
  });

  it('keeps hourly runs on the hour they were scheduled for and counts missed runs', () => {
    const s = makeWorkerSchedule('Every hour', new Date(2026, 10, 10, 10, 0));
    const late = advanceWorkerSchedule(s, new Date(2026, 10, 10, 13, 20))!;
    expect(new Date(late.nextRun).getHours()).toBe(14);
    expect(new Date(late.nextRun).getMinutes()).toBe(0);
    expect(late.missed).toBe(2);
  });

  it('counts daily runs missed while the app was closed', () => {
    const s = makeWorkerSchedule('Every day at 9:00', new Date(2026, 10, 10, 10));
    const next = advanceWorkerSchedule(s, new Date(2026, 10, 14, 12))!;
    expect(next.missed).toBe(3);
    expect(new Date(next.nextRun).getDate()).toBe(15);
  });

  it('rejects junk from the store', () => {
    expect(cleanSchedule({ kind: 'sometimes', nextRun: new Date().toISOString() })).toBeUndefined();
    expect(cleanSchedule({ kind: 'daily', nextRun: 'never' })).toBeUndefined();
    expect(cleanSchedule(null)).toBeUndefined();
  });
});

describe('plan parsing (audit 19)', () => {
  it('finds the JSON after prose that contains braces', () => {
    expect(firstJsonObject('Sure {here} it is: {"steps":["a"],"reply":"ok {x}"}')).toEqual({ steps: ['a'], reply: 'ok {x}' });
  });
  it('takes the first of two objects and skips code fences', () => {
    expect(firstJsonObject('```json\n{"a":1}\n```\n{"b":2}')).toEqual({ a: 1 });
  });
  it('returns null when nothing parses', () => {
    expect(firstJsonObject('no json { here')).toBeNull();
  });
});

describe('runs (audit 3, 8, 12, 22)', () => {
  afterEach(() => { delete (window as any).electronAPI; });

  it('stops only the worker that was asked to stop, and ignores other runs\' events', async () => {
    const listeners: Record<string, (d: any) => void> = {};
    const resolvers: Record<string, () => void> = {};
    const requests: any[] = [];
    const stop = vi.fn(async () => undefined);
    (window as any).electronAPI = {
      acp: {
        chat: vi.fn(), stop,
        stream: vi.fn((req: any) => { requests.push(req); return new Promise<void>((r) => { resolvers[req.conversationId] = r; }); }),
        onStreamChunk: (cb: any) => { listeners.chunk = cb; return () => undefined; },
        onToolStart: (cb: any) => { listeners.tool = cb; return () => undefined; },
        onSubAgentProgress: (cb: any) => { listeners.sub = cb; return () => undefined; },
      },
    };
    const onText = vi.fn(), onTool = vi.fn(), onAction = vi.fn();
    const a = runWorker(worker('a', 'pro'), ['one'], { onText, onTool, onAction }, { auto: true });
    const convA = activeRunOf('a')!;
    expect(convA).toMatch(/^worker-a-auto-\d+$/);
    expect(requests[0].reasoningEffort).toBe(TIER_REASONING.pro);

    listeners.chunk({ delta: 'not mine' });
    listeners.chunk({ delta: 'other', conversationId: 'chat-1' });
    listeners.sub({ action: { description: 'other run' } });
    listeners.chunk({ delta: 'mine', conversationId: convA });
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    await stopWorker('b'); // not running: nothing is stopped
    expect(stop).not.toHaveBeenCalled();
    await stopWorker('a');
    expect(stop).toHaveBeenCalledWith(convA);

    resolvers[convA]();
    await a;
    expect(activeRunOf('a')).toBeUndefined();
  });

  it('keeps the last 20 runs', () => {
    let w = worker('a');
    for (let i = 0; i < 25; i++) w = withRun(w, { at: new Date(2026, 0, 1, 0, i).toISOString(), task: `t${i}`, summary: 'x'.repeat(3000), ok: true });
    expect(w.runs).toHaveLength(20);
    expect(w.runs![0].task).toBe('t5');
    expect(w.runs![19].summary.length).toBeLessThanOrEqual(2000);
  });
});
