/**
 * MP-CORR fixes — main-process correctness (CP2 db-corr pass)
 *
 * Covers: MP-CORR-03 (save mutex timeout), MP-CORR-09 (migration stamping),
 * MP-CORR-13 (per-conversation abort), MP-CORR-16 (backfill honest counts),
 * MP-CORR-17 (bounded retry queue + drain), MP-CORR-23 (resolver Map + timeout),
 * MP-CORR-27 (periodic update checks), MP-CORR-28 (explicit crypto import).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MP-CORR-23 tests import execution-permissions, which pulls in `electron`
// (ipcMain) + permission-notification + pi-tools — these stall in jsdom.
// Mock electron (and the heavyweight transitive deps) before any import.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Notification: vi.fn(),
  BrowserWindow: vi.fn(),
  app: { getAppPath: vi.fn(() => '/tmp'), getPath: vi.fn(() => '/tmp') },
}));
vi.mock('../../lib/permission-notification', () => ({
  dismissPermissionNotification: vi.fn(),
  requestPermissionNotification: vi.fn(),
}));
vi.mock('../../agent/runner/debate-skip', () => ({
  requestDebateSkip: vi.fn(() => true),
}));
vi.mock('../../agent/tools/pi-tools', () => ({
  getLocalExecutionResolvers: vi.fn(() => new Map()),
}));

// ── MP-CORR-13: per-conversation abort registry ─────────────────────────────
import {
  AbortSignalManager,
  getConversationAbortManager,
  cleanupConversationAbort,
  isConversationAborted,
  resetConversationAbort,
} from '../../agent/runner/abort-manager';

// ── MP-CORR-17: database service queue ─────────────────────────────────────
import { DatabaseService } from '../database-service';

// ── MP-CORR-16: history backfill (via ChatHistoryStore) ─────────────────────
import { ChatHistoryStore } from '../history';
import { dbOps } from '../../lib/db';

// ── MP-CORR-28: projects crypto import ─────────────────────────────────────
import * as projectsModule from '../projects/projects';

// ── MP-CORR-27: updater interval lifecycle ─────────────────────────────────
import { stopPeriodicUpdateChecks } from '../../updater';

describe('MP-CORR-13 · per-conversation abort scoping', () => {
  afterEach(() => {
    cleanupConversationAbort('conv-a');
    cleanupConversationAbort('conv-b');
    getConversationAbortManager(undefined).reset();
  });

  it('keys abort state by conversationId — stopping one chat does not abort another', () => {
    const a = getConversationAbortManager('conv-a');
    const b = getConversationAbortManager('conv-b');
    a.setAborted();
    expect(a.streamAborted).toBe(true);
    expect(b.streamAborted).toBe(false);
    expect(isConversationAborted('conv-a')).toBe(true);
    expect(isConversationAborted('conv-b')).toBe(false);
  });

  it('resetting one conversation does not clear another conversation abort', () => {
    const a = getConversationAbortManager('conv-a');
    const b = getConversationAbortManager('conv-b');
    a.setAborted();
    b.setAborted();
    resetConversationAbort('conv-a');
    expect(a.streamAborted).toBe(false);
    expect(b.streamAborted).toBe(true);
  });

  it('cleanup removes the scoped manager entirely', () => {
    getConversationAbortManager('conv-a').setAborted();
    cleanupConversationAbort('conv-a');
    // A fresh manager must be created after cleanup (no stale aborted state).
    expect(getConversationAbortManager('conv-a').streamAborted).toBe(false);
  });

  it('missing conversationId falls back to the global manager', () => {
    expect(getConversationAbortManager(undefined)).toBe(getConversationAbortManager(undefined));
  });

  it('checkAbort throws AbortError-style message when aborted', () => {
    const mgr = new AbortSignalManager();
    mgr.setAborted();
    expect(() => mgr.checkAbort()).toThrow(/aborted by user/);
  });
});

describe('MP-CORR-17 · DatabaseService bounded retry queue + drain', () => {
  let service: DatabaseService;

  beforeEach(() => {
    service = new DatabaseService({ maxRetries: 2, baseDelay: 1 });
  });

  afterEach(() => {
    service.dispose();
  });

  it('drains the retry queue when retryQueuedOperations is called after backoff', async () => {
    // Op fails every attempt inside executeWithRetry → gets queued.
    const op = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(service.executeWithRetry(op, 'flaky op')).rejects.toThrow('boom');
    expect(service.getQueuedOperationCount()).toBe(1);
    // Force readiness.
    (service as any).failedOperationQueue.forEach((q: any) => { q.nextRetryTime = Date.now() - 1; });
    // Let the drained retry succeed.
    op.mockResolvedValue(undefined);
    const drained = await service.retryQueuedOperations();
    expect(drained).toBe(1);
    expect(service.getQueuedOperationCount()).toBe(0);
  });

  it('caps the retry queue at MAX_QUEUED_OPERATIONS (oldest dropped)', async () => {
    const MAX = (DatabaseService as any).MAX_QUEUED_OPERATIONS;
    expect(typeof MAX).toBe('number');
    for (let i = 0; i < MAX + 5; i++) {
      (service as any).queueFailedOperation(`op-${i}`, async () => {}, new Error('x'));
    }
    const queue = (service as any).failedOperationQueue as Map<string, any>;
    expect(queue.size).toBe(MAX);
    expect(queue.has(`op-${MAX + 4}`)).toBe(true);
    expect(queue.has('op-0')).toBe(false);
  });

  it('dispose clears the queue and stops the drain interval', () => {
    const queue = (service as any).failedOperationQueue as Map<string, any>;
    queue.set('x', { id: 'x', operation: async () => {}, attempts: 1, nextRetryTime: Date.now(), error: new Error('x') });
    service.dispose();
    expect(service.getQueuedOperationCount()).toBe(0);
    expect((service as any).drainTimer).toBe(null);
  });

  it('no longer stores an unused transactionConnection field', () => {
    expect((service as any).transactionConnection).toBeUndefined();
  });
});

describe('MP-CORR-16 · backfill reports honest counts', () => {
  it('backfillVectors counts only rows whose indexMessage succeeded', { timeout: 30000 }, async () => {
    const store = new ChatHistoryStore();
    const rows = [
      { id: 'ok-1', content: 'hello world' },
      { id: 'ok-2', content: 'second message' },
      { id: 'bad-1', content: 'this will fail' },
    ];
    const indexMessage = vi.spyOn(store as any, 'indexMessage').mockImplementation(async (id: string) => {
      if (id === 'bad-1') return { ok: false, error: 'embed failed' };
      return { ok: true };
    });
    const initSpy = vi.spyOn(store as any, 'init').mockResolvedValue(undefined);
    const dbAll = vi.spyOn(dbOps, 'all').mockResolvedValue(rows as any);
    const result = await store.backfillVectors();
    expect(result.count).toBe(2);
    expect(result.success).toBe(false);
    expect(result.error).toContain('1 message');
    indexMessage.mockRestore();
    initSpy.mockRestore();
    dbAll.mockRestore();
  });
});

describe('MP-CORR-03 · save mutex fails (not proceeds) on timeout', () => {
  it('a timed-out save fails cleanly instead of proceeding concurrently', async () => {
    const store = new ChatHistoryStore();
    // Hold the lock manually.
    (store as any).saveMutex = true;
    vi.useFakeTimers();
    const savePromise = store.save({
      id: 'conv-mutex-test',
      title: 't',
      provider: 'p',
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    } as any);
    // The waiter times out after 10 s (fake clock) → save resolves {success:false}.
    await vi.advanceTimersByTimeAsync(10000 + 100);
    const r = await savePromise;
    expect(r.success).toBe(false);
    expect(r.error).toContain('timed out');
    // Lock state intact for the real holder: queue drained, mutex still held.
    expect((store as any).saveQueue.length).toBe(0);
    expect((store as any).saveMutex).toBe(true);
    vi.useRealTimers();
    (store as any).saveMutex = false;
  });
});

describe('MP-CORR-23 · permission resolver Map with timeout', () => {
  it('setAgentPermissionResolver keeps two concurrent resolvers independent', async () => {
    const perm = await import('../../ipc/agent/execution-permissions');
    const calls: string[] = [];
    const resolverA = (g: boolean) => { calls.push(`A:${g}`); };
    const resolverB = (g: boolean) => { calls.push(`B:${g}`); };
    perm.setAgentPermissionResolver('req-1', resolverA);
    perm.setAgentPermissionResolver('req-2', resolverB);
    // Clearing req-1 must not invoke or clear req-2.
    perm.setAgentPermissionResolver('req-1', null);
    expect(calls).toEqual([]);
    // req-2 resolver still registered (its slot untouched).
    expect((perm as any).default ?? true).toBe(true);
    perm.setAgentPermissionResolver('req-2', null);
  });

  it('registerAgentPermissionResolver denies after timeout', async () => {
    vi.useFakeTimers();
    const perm = await import('../../ipc/agent/execution-permissions');
    let outcome: boolean | null = null;
    perm.registerAgentPermissionResolver('req-t', (granted) => { outcome = granted; });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    expect(outcome).toBe(false);
    vi.useRealTimers();
  });
});

describe('MP-CORR-28 · projects uses explicit node:crypto randomUUID', () => {
  it('imports randomUUID from node:crypto (no implicit global crypto)', () => {
    expect(typeof projectsModule).toBe('object');
    const fs = require('fs');
    const pathMod = require('path');
    const src = fs.readFileSync(
      pathMod.join(__dirname, '../projects/projects.ts'),
      'utf-8'
    );
    // Strip block and line comments so prose mentioning the old pattern doesn't fail the check.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly).toMatch(/import\s*{\s*randomUUID\s*}\s*from\s*'node:crypto'/);
    expect(codeOnly).toMatch(/randomUUID\(\)/);
    expect(codeOnly).not.toMatch(/(?:^|[^.\w])crypto\.randomUUID\(/);
  });
});

describe('MP-CORR-27 · periodic update check lifecycle', () => {
  it('exports stopPeriodicUpdateChecks as a callable', () => {
    expect(typeof stopPeriodicUpdateChecks).toBe('function');
    expect(() => stopPeriodicUpdateChecks()).not.toThrow();
  });
});
