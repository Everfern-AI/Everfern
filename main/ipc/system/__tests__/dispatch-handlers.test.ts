/**
 * Dispatch handlers tests (MP-LIFE-04)
 *
 * Dispatch commands must show/focus ONLY the main window and send the command
 * ONLY to it — never to voice/computer overlay windows (previously every
 * window was shown → overlay flicker + focus steal).
 *
 * Matrix:
 *  1. mainWindow global set → overlays never shown; main shown+focused+sent
 *  2. global null, windows = [overlay(voice), overlay(computer), plain] → only plain targeted
 *  3. all destroyed → no crash, no send
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';

vi.mock('electron', () => {
  const handlers = new Map<string, Function>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers.set(channel, fn);
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [] as any[]),
      fromWebContents: vi.fn(),
    },
    app: {},
    nativeImage: {},
  };
});

// Mock the dispatch service module so registerDispatchHandlers' dynamic import resolves to our fake.
vi.mock('../../../lib/dispatch', () => {
  const instance = {
    onCommand: null as ((command: string, model?: string) => void) | null,
    initialize: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => ({ success: true })),
    disconnect: vi.fn(async () => {}),
    broadcastToWeb: vi.fn(),
  };
  return {
    DispatchService: {
      getInstance: vi.fn(() => instance),
    },
  };
});

import { registerDispatchHandlers } from '../dispatch-handlers';
import { DispatchService } from '../../../lib/dispatch';

const dispatchInstance: any = DispatchService.getInstance();

function makeFakeWindow(opts: { url?: string; destroyed?: boolean; minimized?: boolean } = {}) {
  const win: any = {
    isDestroyed: vi.fn(() => !!opts.destroyed),
    isMinimized: vi.fn(() => !!opts.minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      getURL: vi.fn(() => opts.url ?? 'everfern-app://index.html'),
      send: vi.fn(),
    },
  };
  return win;
}

function captureHandler(channel: string): Function {
  const calls = (ipcMain.handle as any as ReturnType<typeof vi.fn>).mock.calls;
  const found = calls.find((c: any[]) => c[0] === channel);
  if (!found) throw new Error(`No handler registered for ${channel}`);
  return found[1] as Function;
}

async function invoke(channel: string, ...args: any[]) {
  const fn = captureHandler(channel);
  return await fn({ sender: { send: vi.fn() } }, ...args);
}

describe('dispatch-handlers (MP-LIFE-04) — main-window-only targeting', () => {
  let allWindows: any[] = [];
  let originalMainWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalMainWindow = (globalThis as any).mainWindow;
    delete (globalThis as any).mainWindow;
    dispatchInstance.onCommand = null;
    allWindows = [];
    (BrowserWindow.getAllWindows as any as ReturnType<typeof vi.fn>).mockImplementation(() => allWindows);
  });

  afterEach(async () => {
    if (originalMainWindow === undefined) {
      delete (globalThis as any).mainWindow;
    } else {
      (globalThis as any).mainWindow = originalMainWindow;
    }
    delete (globalThis as any).mainWindow;
    if (originalMainWindow !== undefined) {
      (globalThis as any).mainWindow = originalMainWindow;
    }
  });

  it('registers all dispatch IPC handlers', () => {
    registerDispatchHandlers();
    const channels = (ipcMain.handle as any as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
    expect(channels).toContain('system:start-dispatch');
    expect(channels).toContain('system:restore-dispatch');
    expect(channels).toContain('system:stop-dispatch');
    expect(channels).toContain('system:broadcast-dispatch');
  });

  describe('matrix 1: mainWindow global set → overlays never shown', () => {
    const channels = ['system:start-dispatch', 'system:restore-dispatch'];

    channels.forEach((channel) => {
      it(`${channel}: main window shown+focused+sent; overlays untouched`, async () => {
        const mainWin = makeFakeWindow({ url: 'everfern-app://index.html' });
        const voiceOverlay = makeFakeWindow({ url: 'everfern-app://voice-overlay.html' });
        const computerOverlay = makeFakeWindow({ url: 'everfern-app://computer-overlay.html' });

        (globalThis as any).mainWindow = mainWin;
        allWindows = [voiceOverlay, mainWin, computerOverlay];

        registerDispatchHandlers();
        const result = await invoke(channel, {
          sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
          key: 'k', token: 't', userId: 'id'
        });

        expect(result).toEqual({ success: true });

        // onCommand handler captured — fire it
        expect(dispatchInstance.onCommand).toBeTypeOf('function');
        dispatchInstance.onCommand!('hello', 'gpt-4');

        // MAIN window: shown, focused, and received the command exactly once
        expect(mainWin.show).toHaveBeenCalledTimes(1);
        expect(mainWin.focus).toHaveBeenCalledTimes(1);
        expect(mainWin.webContents.send).toHaveBeenCalledTimes(1);
        expect(mainWin.webContents.send).toHaveBeenCalledWith('system:dispatch-command', {
          command: 'hello',
          model: 'gpt-4'
        });

        // OVERLAYS: never shown/focused, never sent anything
        expect(voiceOverlay.show).not.toHaveBeenCalled();
        expect(voiceOverlay.focus).not.toHaveBeenCalled();
        expect(voiceOverlay.webContents.send).not.toHaveBeenCalled();
        expect(computerOverlay.show).not.toHaveBeenCalled();
        expect(computerOverlay.focus).not.toHaveBeenCalled();
        expect(computerOverlay.webContents.send).not.toHaveBeenCalled();
      });

      it(`${channel}: minimized main window is restored first`, async () => {
        const mainWin = makeFakeWindow({ url: 'everfern-app://index.html', minimized: true });
        (globalThis as any).mainWindow = mainWin;
        allWindows = [mainWin];

        registerDispatchHandlers();
        await invoke(channel, { url: 'u', apiUrl: 'a', key: 'k', token: 't', userId: 'id' });
        dispatchInstance.onCommand!('cmd');

        expect(mainWin.restore).toHaveBeenCalledTimes(1);
        expect(mainWin.show).toHaveBeenCalledTimes(1);
        expect(mainWin.focus).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('matrix 2: global null → fallback skips overlays, targets first plain window', () => {
    const channels = ['system:start-dispatch', 'system:restore-dispatch'];

    channels.forEach((channel) => {
      it(`${channel}: windows=[voice overlay, computer overlay, plain] → only plain targeted`, async () => {
        delete (globalThis as any).mainWindow;

        const voiceOverlay = makeFakeWindow({ url: 'https://x/voice.html' });
        const computerOverlay = makeFakeWindow({ url: 'https://x/computer.html' });
        const plainWin = makeFakeWindow({ url: 'https://x/index.html' });
        allWindows = [voiceOverlay, computerOverlay, plainWin];

        registerDispatchHandlers();
        await invoke(channel, {
          sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
          key: 'k', token: 't', userId: 'id'
        });
        dispatchInstance.onCommand!('go');

        expect(plainWin.show).toHaveBeenCalledTimes(1);
        expect(plainWin.focus).toHaveBeenCalledTimes(1);
        expect(plainWin.webContents.send).toHaveBeenCalledWith('system:dispatch-command', {
          command: 'go',
          model: undefined
        });

        expect(voiceOverlay.show).not.toHaveBeenCalled();
        expect(voiceOverlay.webContents.send).not.toHaveBeenCalled();
        expect(computerOverlay.show).not.toHaveBeenCalled();
        expect(computerOverlay.webContents.send).not.toHaveBeenCalled();
      });
    });

    it('destroyed windows in the list are skipped in fallback', async () => {
      delete (globalThis as any).mainWindow;

      const destroyedPlain = makeFakeWindow({ url: 'https://x/index.html', destroyed: true });
      const voiceOverlay = makeFakeWindow({ url: 'https://x/voice.html' });
      const plainWin = makeFakeWindow({ url: 'https://x/index.html' });
      allWindows = [destroyedPlain, voiceOverlay, plainWin];

      registerDispatchHandlers();
      await invoke('system:start-dispatch', {
        sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
        key: 'k', token: 't', userId: 'id'
      });
      dispatchInstance.onCommand!('go');

      expect(plainWin.show).toHaveBeenCalledTimes(1);
      expect(voiceOverlay.show).not.toHaveBeenCalled();
      expect(destroyedPlain.show).not.toHaveBeenCalled();
    });

    it('window whose getURL() throws is treated as non-target and skipped safely', async () => {
      delete (globalThis as any).mainWindow;

      const throwingWin = makeFakeWindow({});
      throwingWin.webContents.getURL = vi.fn(() => { throw new Error('dead webContents'); });
      const plainWin = makeFakeWindow({ url: 'https://x/index.html' });
      allWindows = [throwingWin, plainWin];

      registerDispatchHandlers();
      await invoke('system:start-dispatch', {
        sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
        key: 'k', token: 't', userId: 'id'
      });

      expect(() => dispatchInstance.onCommand!('go')).not.toThrow();
      expect(plainWin.show).toHaveBeenCalledTimes(1);
    });
  });

  describe('matrix 3: all destroyed → no crash, no send', () => {
    const channels = ['system:start-dispatch', 'system:restore-dispatch'];

    channels.forEach((channel) => {
      it(`${channel}: destroyed global mainWindow + destroyed fallback windows → no-op`, async () => {
        const destroyedMain = makeFakeWindow({ url: 'everfern-app://index.html', destroyed: true });
        (globalThis as any).mainWindow = destroyedMain;
        allWindows = [makeFakeWindow({ url: 'https://x/voice.html', destroyed: true }), makeFakeWindow({ destroyed: true })];

        registerDispatchHandlers();
        const result = await invoke(channel, {
          sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
          key: 'k', token: 't', userId: 'id'
        });

        expect(result).toEqual({ success: true });

        // Firing onCommand must not throw and must not send anywhere
        expect(() => dispatchInstance.onCommand!('cmd')).not.toThrow();
        for (const w of allWindows) {
          expect(w.show).not.toHaveBeenCalled();
          expect(w.webContents.send).not.toHaveBeenCalled();
        }
      });
    });

    it('no windows at all + null global → no crash, no send', async () => {
      delete (globalThis as any).mainWindow;
      allWindows = [];

      registerDispatchHandlers();
      await invoke('system:start-dispatch', {
        sessionId: 's', pinCode: 'p', url: 'u', apiUrl: 'a',
        key: 'k', token: 't', userId: 'id'
      });

      expect(() => dispatchInstance.onCommand!('cmd')).not.toThrow();
    });
  });
});
