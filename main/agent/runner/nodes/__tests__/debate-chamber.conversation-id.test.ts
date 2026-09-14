/**
 * CU-ST-03 — Cross-chat debate bleed: emitted debate events must carry the
 * conversation id so useDebateStream's filter can reject events from other
 * chats once the page.tsx mount-site passes its conversationId.
 *
 * The debate skip path (debate_skipped) is the cheapest emission site to
 * exercise: it fires before the debate engine / AI client are constructed,
 * so no AI mocking is needed. Uses the `missionId` → conversationId mapping
 * (runner.ts seeds GraphState.missionId with the conversation id).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../services/node-utils', () => ({
  nodeLifecycle: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createDebateChamberNode } from '../debate-chamber';
import { DebateEventEmitter } from '../../debate-event-emitter';

describe('debate-chamber CU-ST-03: events carry conversationId', () => {
  const broadcastSpy = vi.spyOn(DebateEventEmitter, 'broadcastDebateEvent');

  beforeEach(() => {
    broadcastSpy.mockClear();
  });

  it('stamps missionId as conversationId on debate events', async () => {
    const runner = {
      client: { model: 'test' },
      tools: [],
      telemetry: {
        transition: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    } as any;

    const node = createDebateChamberNode(runner);
    const state = {
      currentIntent: 'conversation',
      missionId: 'conv-abc-123',
      messages: [{ role: 'user', content: 'hello' }],
    } as any;

    await node(state);

    expect(broadcastSpy).toHaveBeenCalled();
    const event = broadcastSpy.mock.calls[0][0] as any;
    expect(event.type).toBe('debate_skipped');
    expect(event.conversationId).toBe('conv-abc-123');
  });

  it('prefers explicit conversationId over missionId when present in state', async () => {
    const runner = {
      client: { model: 'test' },
      tools: [],
      telemetry: { transition: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as any;

    const node = createDebateChamberNode(runner);
    const state = {
      currentIntent: 'conversation',
      missionId: 'conv-from-mission-id',
      conversationId: 'conv-explicit-456',
      messages: [{ role: 'user', content: 'hello' }],
    } as any;

    await node(state);

    const event = broadcastSpy.mock.calls[0][0] as any;
    expect(event.conversationId).toBe('conv-explicit-456');
  });

  it('leaves conversationId undefined when state carries none (legacy)', async () => {
    const runner = {
      client: { model: 'test' },
      tools: [],
      telemetry: { transition: vi.fn(), info: vi.fn(), warn: vi.fn() },
    } as any;

    const node = createDebateChamberNode(runner);
    const state = {
      currentIntent: 'conversation',
      messages: [{ role: 'user', content: 'hello' }],
    } as any;

    await node(state);

    const event = broadcastSpy.mock.calls[0][0] as any;
    expect(event.type).toBe('debate_skipped');
    expect(event.conversationId).toBeUndefined();
  });
});
