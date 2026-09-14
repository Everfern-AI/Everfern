import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';

// ── uiohook-napi is a native module that must be rebuilt per Electron ABI. ──
// Lazy-require with try/catch so a rebuild failure doesn't crash the main process
// on Linux/macOS (same pattern used for @jitsi/robotjs in computer-use.ts).
let uIOhook: any = null;
let UiohookKey: any = null;
try {
  const mod = require('uiohook-napi');
  uIOhook = mod.uIOhook;
  UiohookKey = mod.UiohookKey;
  console.log('[VoiceOverlay] uiohook-napi loaded successfully.');
} catch (e) {
  const hint = process.platform === 'linux'
    ? 'On Linux run: npm run rebuild:electron'
    : process.platform === 'darwin'
    ? 'On macOS ensure Xcode CLT is installed, then run: npm run rebuild:electron'
    : 'Run: npm run rebuild:electron';
  console.warn(`[VoiceOverlay] uiohook-napi unavailable — global hotkey support disabled. ${hint}`);
}

export class VoiceOverlayManager {
  private overlayWindow: BrowserWindow | null = null;
  private isCtrlDown = false;
  private isAltDown = false;
  private isListening = false;
  private otherKeyPressed = false;
  private startListeningTimeout: NodeJS.Timeout | null = null;
  // MP-SEC-07: idle-scoped keyboard hook. uIOhook captures every keystroke
  // system-wide while running, so it is now armed lazily when voice features
  // are actually used (voice-overlay:set-state activity) and stopped when the
  // overlay goes idle — instead of running for the whole app lifetime.
  private hookRunning = false;
  private hookArmed = false;
  // MP-SEC-07: once shutdown() has run, never re-arm — otherwise a late
  // 'voice-overlay:set-state' activity during quit would call uIOhook.start()
  // AFTER the quit path believes the system-wide keyboard hook is stopped.
  private isShutDown = false;
  private stopHookOnIdleTimer: NodeJS.Timeout | null = null;
  private static readonly IDLE_STOP_DELAY_MS = 60_000;

  constructor() {
    console.log('[VoiceOverlay] Initializing manager...');
    this.initOverlayWindow();
    // MP-SEC-07: hook setup is deferred — see armHook().
    this.setupIpc();
  }

  /**
   * Register the global keydown/keyup listeners and start the OS hook.
   * Idempotent: only installs listeners once; only calls start() when needed.
   */
  private armHook(): void {
    if (this.hookArmed || !uIOhook) {
      if (!uIOhook) {
        console.warn('[VoiceOverlay] Cannot arm hook — uiohook-napi not available on this platform/build.');
      }
      return;
    }
    this.hookArmed = true;

    console.log('[VoiceOverlay] Arming uIOhook (voice activity detected)...');
    try {
      uIOhook.on('keydown', (e: any) => {
        if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) {
          this.isCtrlDown = true;
        } else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) {
          this.isAltDown = true;
        } else {
          this.otherKeyPressed = true;
        }
        this.checkState();
      });

      uIOhook.on('keyup', (e: any) => {
        if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) {
          this.isCtrlDown = false;
          this.otherKeyPressed = false;
        } else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) {
          this.isAltDown = false;
          this.otherKeyPressed = false;
        } else {
          // MP-CORR-11: pure-function-of-current-flags — releasing ANY
          // non-modifier key also clears the latch, so tapping X while
          // holding Ctrl+Alt then releasing X re-arms listening instead
          // of staying stuck until the modifiers are released.
          this.otherKeyPressed = false;
        }
        this.checkState();
      });

      this.startHook();
    } catch (err) {
      console.error('[VoiceOverlay] Failed to arm uIOhook:', err);
      this.hookArmed = false;
    }
  }

  private startHook(): void {
    if (this.hookRunning || !uIOhook || !this.hookArmed) return;
    try {
      uIOhook.start();
      this.hookRunning = true;
      console.log('[VoiceOverlay] uIOhook started successfully.');
    } catch (err) {
      console.error('[VoiceOverlay] Failed to start uIOhook:', err);
    }
  }

  /**
   * Stop the OS-global keyboard hook and schedule an automatic stop after a
   * period of overlay idleness (privacy + battery: no system-wide keystroke
   * capture while voice features are unused).
   */
  private stopHook(): void {
    if (!this.hookRunning || !uIOhook) return;
    try {
      uIOhook.stop();
      this.hookRunning = false;
      this.isCtrlDown = false;
      this.isAltDown = false;
      this.otherKeyPressed = false;
      this.wasCtrlAltDown = false;
      console.log('[VoiceOverlay] uIOhook stopped — overlay idle.');
    } catch (err) {
      console.error('[VoiceOverlay] Failed to stop uIOhook:', err);
    }
  }

  /**
   * Called on any voice-overlay activity. Arms the hook (first use) and
   * pushes back the idle auto-stop.
   */
  private noteVoiceActivity(): void {
    if (this.isShutDown) return; // quit path already tore the hook down
    if (!this.hookArmed) this.armHook();
    this.startHook();
    if (this.stopHookOnIdleTimer) clearTimeout(this.stopHookOnIdleTimer);
    this.stopHookOnIdleTimer = setTimeout(() => {
      this.stopHookOnIdleTimer = null;
      this.stopHook();
    }, VoiceOverlayManager.IDLE_STOP_DELAY_MS);
    this.stopHookOnIdleTimer.unref?.();
  }

  /**
   * Public teardown for the quit path: stops the hook and cancels timers.
   */
  shutdown(): void {
    this.isShutDown = true;
    if (this.stopHookOnIdleTimer) {
      clearTimeout(this.stopHookOnIdleTimer);
      this.stopHookOnIdleTimer = null;
    }
    if (this.startListeningTimeout) {
      clearTimeout(this.startListeningTimeout);
      this.startListeningTimeout = null;
    }
    this.stopHook();
  }

  private setupIpc() {
    ipcMain.on('voice-overlay:audio-levels', (event, levels) => {
      // MP-CORR-11: send audio levels ONLY to the overlay window, and only
      // if it exists, is not destroyed, and is visible. (The main window
      // generates these events, so forwarding them anywhere else is noise.)
      if (this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible()) {
        this.overlayWindow.webContents.send('voice-overlay:audio-levels', levels);
      }
    });

    ipcMain.on('voice-overlay:set-state', (event, payload) => {
      console.log(`[VoiceOverlay] Set state IPC:`, payload);
      const stateStr = typeof payload === 'string' ? payload : (payload?.state || 'idle');

      // MP-SEC-07: any voice-overlay activity arms the lazy global hook and
      // pushes back its idle auto-stop; 'idle' keeps the timer running so an
      // unused overlay never keeps the OS-wide keystroke hook alive.
      if (stateStr !== 'idle') {
        this.noteVoiceActivity();
      }

      const broadcastState = (p: any) => {
        const payloadObj = typeof p === 'string' ? { state: p } : p;
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
             win.webContents.send('voice-overlay:state', payloadObj);
          }
        });
      };

      if (stateStr === 'idle') {
        this.isListening = false;
        broadcastState('idle');
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayWindow.setIgnoreMouseEvents(true);
          setTimeout(() => {
            if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
              this.overlayWindow.hide();
            }
          }, 500);
        }
      } else {
        if (stateStr === 'listening') {
          this.isListening = true;
        } else {
          this.isListening = false;
        }
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.workAreaSize;

          if (stateStr === 'clarification' || (typeof payload === 'object' && payload?.type === 'clarification')) {
            const overlayHeight = 440; // Increased from 340 to prevent clipping
            const overlayWidth = 680;  // Increased from 600 to prevent shadow clipping
            this.overlayWindow.setBounds({
              width: overlayWidth,
              height: overlayHeight,
              x: Math.floor(width / 2 - Math.floor(overlayWidth / 2)),
              y: height - overlayHeight - 20
            });
            this.overlayWindow.setIgnoreMouseEvents(false);
          } else if (stateStr === 'completed' || (typeof payload === 'object' && payload?.state === 'completed')) {
            const hasFollowUps = typeof payload === 'object' && payload?.followUps && payload.followUps.length > 0;
            const overlayHeight = hasFollowUps ? 520 : 440; // Increased from 420 / 340 to prevent clipping
            const overlayWidth = 840;  // Increased from 800 to prevent shadow clipping
            this.overlayWindow.setBounds({
              width: overlayWidth,
              height: overlayHeight,
              x: Math.floor(width / 2 - Math.floor(overlayWidth / 2)),
              y: height - overlayHeight - 20
            });
            this.overlayWindow.setIgnoreMouseEvents(false);
          } else if (stateStr === 'history' || (typeof payload === 'object' && payload?.state === 'history')) {
            const overlayHeight = 460; // Increased from 360 to prevent clipping
            const overlayWidth = 680;  // Increased from 600 to prevent shadow clipping
            this.overlayWindow.setBounds({
              width: overlayWidth,
              height: overlayHeight,
              x: Math.floor(width / 2 - Math.floor(overlayWidth / 2)),
              y: height - overlayHeight - 20
            });
            this.overlayWindow.setIgnoreMouseEvents(false);
          } else if (stateStr === 'error' || (typeof payload === 'object' && payload?.state === 'error')) {
            const overlayHeight = 160; // Increased from 80 to prevent clipping
            const overlayWidth = 560;  // Increased from 500 to prevent shadow clipping
            this.overlayWindow.setBounds({
              width: overlayWidth,
              height: overlayHeight,
              x: Math.floor(width / 2 - Math.floor(overlayWidth / 2)),
              y: height - overlayHeight - 20
            });
            this.overlayWindow.setIgnoreMouseEvents(true);
          } else {
            const overlayHeight = 160; // Increased from 120 to prevent clipping
            const overlayWidth = 660;  // Increased from 600 to prevent shadow clipping
            this.overlayWindow.setBounds({
              width: overlayWidth,
              height: overlayHeight,
              x: Math.floor(width / 2 - Math.floor(overlayWidth / 2)),
              y: height - overlayHeight - 20
            });
            this.overlayWindow.setIgnoreMouseEvents(true);
          }

          if (!this.overlayWindow.isVisible()) {
            this.overlayWindow.showInactive();
          }
        }
        broadcastState(payload);
      }
    });

    ipcMain.on('voice-overlay:submit-answer', (event, answers) => {
      console.log(`[VoiceOverlay] Answer submitted IPC:`, answers);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
           win.webContents.send('voice-overlay:answer-submitted', answers);
        }
      });
    });
  }

  private initOverlayWindow() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      
      console.log(`[VoiceOverlay] Screen size: ${width}x${height}`);

      const initialWidth = 660;
      const initialHeight = 160;
      this.overlayWindow = new BrowserWindow({
        width: initialWidth,
        height: initialHeight,
        x: Math.floor(width / 2 - Math.floor(initialWidth / 2)),
        y: height - initialHeight - 20, // Above taskbar
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
        }
      });

      // MP-CORR-11: user-closed window must null the ref, else later
      // showInactive()/setBounds() calls hit a destroyed BrowserWindow.
      this.overlayWindow.on('closed', () => {
        this.overlayWindow = null;
      });

      const isDev = !app.isPackaged;
      const overlayUrl = isDev ? 'http://localhost:3001/overlay' : 'everfern-app://./overlay/index.html';

      console.log(`[VoiceOverlay] Loading URL: ${overlayUrl}`);

      this.overlayWindow.loadURL(overlayUrl).catch(e => console.error('[VoiceOverlay] Failed to load URL:', e));

      this.overlayWindow.setIgnoreMouseEvents(true);
      console.log('[VoiceOverlay] Window initialized.');
    } catch (err) {
      console.error('[VoiceOverlay] Critical error initializing window:', err);
    }
  }

  private wasCtrlAltDown = false;
  private checkState() {
    const shouldListen = this.isCtrlDown && this.isAltDown;
    
    const broadcastState = (st: string) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
           win.webContents.send('voice-overlay:state', { state: st });
        }
      });
    };

    if (shouldListen && !this.wasCtrlAltDown) {
      this.wasCtrlAltDown = true;
      if (this.startListeningTimeout) clearTimeout(this.startListeningTimeout);
      this.startListeningTimeout = setTimeout(() => {
        if (this.isCtrlDown && this.isAltDown && !this.otherKeyPressed) {
          if (!this.isListening) {
            console.log('[VoiceOverlay] Starting listening state...');
            this.isListening = true;

            if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
              this.overlayWindow.showInactive();
              broadcastState('listening');
              console.log('[VoiceOverlay] IPC state sent: listening');
            } else {
              console.warn('[VoiceOverlay] Cannot start: overlayWindow is null');
            }
          }
        }
      }, 150);
    } else if (!shouldListen && this.wasCtrlAltDown) {
      this.wasCtrlAltDown = false;
      if (this.startListeningTimeout) {
        clearTimeout(this.startListeningTimeout);
        this.startListeningTimeout = null;
      }
      if (this.isListening) {
        console.log('[VoiceOverlay] Stopping listening state, executing...');
        this.isListening = false;
        
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          broadcastState('executing');
        }
      }
    }
  }
}

// Lazy singleton factory (MP-LIFE-03): the overlay BrowserWindow and its
// everfern-app:// page load cost ~120MB RSS at cold start, so the manager is
// constructed on first use (first 'voice-overlay:set-state' / 'audio-levels'
// IPC from the renderer), never eagerly at startup. Mirrors the
// getComputerOverlayManager() pattern in computer-overlay.ts. Both factories
// only run after the protocol handlers are registered in app.whenReady (lazy
// first use can only originate from a loaded renderer, which is itself later
// than protocol registration), so everfern-app:// URLs always resolve.
let _instance: VoiceOverlayManager | null = null;

export function getVoiceOverlayManager(): VoiceOverlayManager {
  if (!_instance) {
    _instance = new VoiceOverlayManager();
  }
  return _instance;
}

/**
 * MP-LIFE-03/MP-SEC-07 gate helper: shut down the overlay ONLY if the lazy
 * factory ever constructed one. Never constructs on shutdown (calling
 * getVoiceOverlayManager() here would defeat the lazy-creation savings).
 */
export function shutdownVoiceOverlayIfCreated(): void {
  if (_instance) {
    _instance.shutdown();
    _instance = null;
  }
}

/**
 * MP-LIFE-03: lazy IPC bridge. Registers lightweight forwarders for the
 * renderer voice channels; the FIRST message on either channel constructs
 * the VoiceOverlayManager (whose own setupIpc registers the real
 * handlers). Before any voice IPC, no overlay window and no global keyboard
 * hook exist at all.
 */
export function registerVoiceOverlayIpcBridge(): void {
  const lazyChannels = ['voice-overlay:set-state', 'voice-overlay:audio-levels'] as const;
  for (const channel of lazyChannels) {
    ipcMain.on(channel, function lazyVoiceForwarder(...args: any[]) {
      // Construct-on-first-use; the manager's setupIpc registers the real
      // listener, so remove this throwaway forwarder and re-dispatch.
      ipcMain.removeListener(channel, lazyVoiceForwarder);
      try {
        getVoiceOverlayManager();
      } catch (err) {
        console.error('[VoiceOverlay] Lazy construction failed:', err);
        return;
      }
      // Re-emit so the newly registered real handler receives this message.
      ipcMain.emit(channel, ...args);
    });
  }
}
