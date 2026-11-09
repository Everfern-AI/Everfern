// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isWorkerChatBusy } from '../worker-activity';

describe('worker conversation activity', () => {
  it('hides paused controls while planning or streaming a reply', () => {
    expect(isWorkerChatBusy([{ kind: 'thinking' }])).toBe(true);
    expect(isWorkerChatBusy([{ kind: 'reason', live: true }])).toBe(true);
    expect(isWorkerChatBusy([{ kind: 'ai', streaming: true }])).toBe(true);
  });
  it('allows paused controls after the response has finished', () => {
    expect(isWorkerChatBusy([{ kind: 'reason', live: false }, { kind: 'ai', streaming: false }])).toBe(false);
    expect(isWorkerChatBusy([])).toBe(false);
  });
});
