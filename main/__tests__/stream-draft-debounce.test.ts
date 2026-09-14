import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

// Shared mock state, hoisted so vi.mock factories can reference it.
const h = vi.hoisted(() => ({
  runStreamMock: vi.fn(),
  scopedAbort: { streamAborted: false },
  dbRun: vi.fn(),
  executeCleanupSequence: vi.fn(),
  reflect: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../lib/db', () => ({
  dbOps: { run: h.dbRun, get: vi.fn(), all: vi.fn() },
}));
vi.mock('../agent/runner/abort-manager', () => ({
  globalAbortManager: {
    streamAborted: false,
    setAborted: vi.fn(),
    executeCleanupSequence: h.executeCleanupSequence,
  },
  getConversationAbortManager: vi.fn(() => h.scopedAbort),
}));
vi.mock('../agent/runner/runner', () => ({
  AgentRunner: class {
    runStream = h.runStreamMock;
    constructor(_client: unknown, _config: unknown) {}
  },
}));
vi.mock('../acp/manager', () => ({
  acpManager: {
    getClient: () => __sharedClient,
    getActiveConfig: () => ({ provider: 'everfern', model: 'fern-base' }),
  },
}));
vi.mock('../lib/ai-client', () => {
  const sharedClient = { setModel: vi.fn(), chat: vi.fn(), model: 'fern-base' };
  const pooledClient = { setModel: vi.fn(), chat: vi.fn(), model: 'fern-other' };
  return {
    AIClient: class {},
    AIClientConfig: undefined as any,
    getPooledAIClient: vi.fn(() => pooledClient),
    releasePooledAIClient: vi.fn(),
    __sharedClient: sharedClient,
    __pooledClient: pooledClient,
  };
});
vi.mock('../lib/vlm-config', () => ({
  hydrateConfigWithIsolatedKeys: (c: unknown) => c,
}));
vi.mock('../store/memory-manager', () => ({ reflectAndRemember: h.reflect }));
vi.mock('../lib/permission-notification', () => ({
  showPermissionNotification: vi.fn(),
}));

import { ipcMain } from 'electron';
import { registerStreamHandlers } from '../ipc/agent/stream-handlers';
import { createDraftSaveDebouncer } from '../lib/draft-debounce';
import { getPooledAIClient, __sharedClient, __pooledClient } from '../lib/ai-client';

// stream-handlers lazy-requires '../../computer-overlay' on its abort/done
// paths via a raw CJS require. Under Vitest that cannot resolve the .ts
// module, so the handler logs one benign caught error ("Failed to hide
// overlay") that is unrelated to the debounce logic under test. Filter it
// from the console.error spy so assertions stay focused.
const OVERLAY_BENIGN = /Failed to hide overlay|Cannot find module '\.\.\/\.\.\/computer-overlay'/;
const isOverlayNoise = (args: unknown[]) =>
  String(args[0]).includes('Failed to hide overlay') ||
  (args[1] instanceof Error && OVERLAY_BENIGN.test(String(args[1].message)));

const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'] } as const;

// Number of message-draft upserts observed through the mocked dbOps.run.
const messageDraftSaves = () =>
  h.dbRun.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO messages')).length;

// Flush pending microtasks without advancing scheduled timers.
const settle = async (ticks = 6) => {
  for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(0);
};

describe('AI-ARCH-01 createDraftSaveDebouncer (unit)', () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not fire before the trailing window elapses (599ms -> 0, +1ms -> 1)', () => {
    const save = vi.fn();
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    vi.advanceTimersByTime(599);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces schedule x3 into exactly one trailing call', async () => {
    const save = vi.fn();
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    await vi.advanceTimersByTimeAsync(100);
    d.schedule();
    await vi.advanceTimersByTimeAsync(100);
    d.schedule();
    expect(save).not.toHaveBeenCalled();

    // 599ms past the LAST schedule: still nothing.
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents the pending trailing save and is idempotent', () => {
    const save = vi.fn();
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    d.cancel();
    d.cancel(); // second cancel must be a no-op, not a throw
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it('can be re-scheduled after cancel()', async () => {
    const save = vi.fn();
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    d.cancel();
    d.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('trailing call observes the latest draft state at fire time', async () => {
    let state = 'initial';
    const seen: string[] = [];
    const d = createDraftSaveDebouncer(() => {
      seen.push(state);
    }, 600);

    d.schedule();
    state = 'latest';
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual(['latest']);
  });

  it('fires once per idle window across repeated bursts', async () => {
    const save = vi.fn();
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    await vi.advanceTimersByTimeAsync(600);
    d.schedule();
    await vi.advanceTimersByTimeAsync(600);
    d.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('swallows async save errors and rate-limits the warning to one per 10s', async () => {
    const warnSpy = console.warn as unknown as MockInstance;
    const save = vi.fn(async () => {
      throw new Error('db locked');
    });
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    await vi.advanceTimersByTimeAsync(600); // failure #1 -> warn
    expect(warnSpy).toHaveBeenCalledTimes(1);

    d.schedule();
    await vi.advanceTimersByTimeAsync(600); // failure #2 within 10s -> suppressed
    expect(warnSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    d.schedule();
    await vi.advanceTimersByTimeAsync(600); // failure #3 after window -> warn again
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('swallows synchronous save errors without an unhandled rejection', async () => {
    const warnSpy = console.warn as unknown as MockInstance;
    const save = vi.fn(() => {
      throw new Error('sync boom');
    });
    const d = createDraftSaveDebouncer(save, 600);

    d.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AI-ARCH-01 acp:stream draft autosave debounce (handler)', () => {
  let streamHandler: (event: any, request: any) => Promise<void>;
  let senderSend: ReturnType<typeof vi.fn>;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  const event = () => ({ sender: { send: senderSend } });
  const request = {
    messages: [{ role: 'user', content: 'hello' }],
    conversationId: 'conv-test-1',
    assistantMessageId: 'draft-test-1',
  };

  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        if (!isOverlayNoise(args)) console.info('[suppressed non-overlay error]', ...args);
      }) as unknown as MockInstance;

    h.dbRun.mockReset();
    h.dbRun.mockResolvedValue(undefined);
    h.executeCleanupSequence.mockReset();
    h.executeCleanupSequence.mockResolvedValue({
      success: true, completedPhases: [], totalPhases: 0, elapsedMs: 0, errors: [],
    });
    h.reflect.mockReset();
    h.runStreamMock.mockReset();
    h.scopedAbort.streamAborted = false;

    vi.mocked(ipcMain.handle).mockClear();
    registerStreamHandlers();

    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'acp:stream');
    if (!call) throw new Error('acp:stream handler was not registered');
    streamHandler = call[1];
    senderSend = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('two rapid chunks coalesce into one trailing save, plus one final flush', async () => {
    let releaseDone!: () => void;
    const doneGate = new Promise<void>((resolve) => { releaseDone = resolve; });
    h.runStreamMock.mockImplementation(async function* () {
      yield { type: 'chunk', content: 'a' };
      yield { type: 'chunk', content: 'b' };
      await doneGate;
      yield { type: 'done' };
    });

    const handled = streamHandler(event(), request);
    await settle();

    // Both rapid chunk events processed; debounce pending, nothing written.
    expect(messageDraftSaves()).toBe(0);

    await vi.advanceTimersByTimeAsync(599);
    expect(messageDraftSaves()).toBe(0);

    await vi.advanceTimersByTimeAsync(1); // idle window elapsed -> one trailing save
    expect(messageDraftSaves()).toBe(1);

    releaseDone();
    await settle();
    await handled;

    // Trailing debounced save (1) + awaited final flush (1) = 2, never more.
    expect(messageDraftSaves()).toBe(2);
    expect(h.reflect).toHaveBeenCalledTimes(1);
  });

  it('final flush at done cancels a still-pending debounced save (no double write)', async () => {
    let releaseDone!: () => void;
    const doneGate = new Promise<void>((resolve) => { releaseDone = resolve; });
    h.runStreamMock.mockImplementation(async function* () {
      yield { type: 'chunk', content: 'a' };
      yield { type: 'chunk', content: 'b' };
      await doneGate;
      yield { type: 'done' };
    });

    const handled = streamHandler(event(), request);
    await settle(); // chunks processed, 600ms timer pending

    releaseDone(); // done arrives before the debounce window elapses
    await settle();
    await handled;

    // Prove the cancelled pending timer never fires later.
    await vi.advanceTimersByTimeAsync(5000);
    expect(messageDraftSaves()).toBe(1); // final flush only
  });

  it('user abort cancels the pending debounce and flushes the draft once', async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    h.runStreamMock.mockImplementation(async function* () {
      yield { type: 'chunk', content: 'a' };
      await secondGate;
      yield { type: 'chunk', content: 'b' }; // lands after the abort flag is set
    });

    const handled = streamHandler(event(), request);
    await settle(); // first chunk processed, debounce pending

    h.scopedAbort.streamAborted = true;
    releaseSecond();
    await settle(10);
    await handled;

    // Abort path: cancel + single fire-and-forget flush; no trailing timer write.
    await vi.advanceTimersByTimeAsync(5000);
    expect(messageDraftSaves()).toBe(1);
    expect(h.reflect).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    // The lazy computer-overlay require is caught + logged by the handler on
    // any path (also on pre-fix code) — ignore that one benign entry.
    const realErrors = errorSpy.mock.calls.filter((c) => !isOverlayNoise(c as unknown[]));
    expect(realErrors).toHaveLength(0);
  });
});

describe('XI.C setModel pooled re-acquire (handler)', () => {
  let streamHandler: (event: any, request: any) => Promise<void>;
  const event = () => ({ sender: { send: vi.fn() } });

  const capture = () => {
    vi.mocked(ipcMain.handle).mockClear();
    registerStreamHandlers();
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'acp:stream');
    if (!call) throw new Error('acp:stream handler was not registered');
    streamHandler = call[1];
  };

  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.runStreamMock.mockReset();
    h.runStreamMock.mockImplementation(async function* () { yield { type: 'done' }; });
    vi.mocked(getPooledAIClient).mockClear();
    __sharedClient.setModel.mockClear();
    __pooledClient.setModel.mockClear();
    capture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('different model: shared client NOT mutated — pool re-acquired instead', async () => {
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      providerType: 'everfern',
      model: 'fern-other',
      conversationId: 'c1',
    };
    await streamHandler(event(), req);
    expect(__sharedClient.setModel).not.toHaveBeenCalled();
    expect(getPooledAIClient).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'everfern',
      model: 'fern-other',
    }));
  });

  it('same model: no mutation and no pool acquisition (no-op-safe path)', async () => {
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      providerType: 'everfern',
      model: 'fern-base', // matches __sharedClient.model
      conversationId: 'c1',
    };
    await streamHandler(event(), req);
    expect(__sharedClient.setModel).not.toHaveBeenCalled();
    expect(getPooledAIClient).not.toHaveBeenCalled();
  });
});
