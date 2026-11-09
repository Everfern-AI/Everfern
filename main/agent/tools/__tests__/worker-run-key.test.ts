import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  webContents: { fromId: () => null },
  nativeImage: {},
}));

import { baseWorkerKey, workerKeyForPartition, pickWorkerWindow } from '../navis/core/webview-registry';

describe('worker run keys', () => {
  it('keeps a plain worker conversation id', () => {
    expect(baseWorkerKey('worker-abc123')).toBe('worker-abc123');
  });

  it('strips the per-run suffix so windows and workspaces still resolve', () => {
    expect(baseWorkerKey('worker-abc123-run-1762700000000')).toBe('worker-abc123');
    expect(baseWorkerKey('worker-48f3b82d1605-run-1794219789123')).toBe('worker-48f3b82d1605');
  });

  it('rejects non-worker conversations', () => {
    expect(baseWorkerKey('chat-xyz')).toBeNull();
    expect(baseWorkerKey(undefined)).toBeNull();
    expect(baseWorkerKey(42)).toBeNull();
  });

  it('never falls back to the host browser for a run-scoped worker', () => {
    expect(pickWorkerWindow('worker-abc123-run-1762700000000')).toBeNull();
  });

  it('maps a webview partition to the worker key', () => {
    expect(workerKeyForPartition('persist:worker-abc123')).toBe('worker-abc123');
    expect(workerKeyForPartition('persist:tmp')).toBeNull();
  });
});
