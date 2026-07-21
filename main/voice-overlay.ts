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
  private holdTimeout: NodeJS.Timeout | null = null;
  private otherKeyPressed = false;
  private startListeningTimeout: NodeJS.Timeout | null = null;

  constructor() {
    console.log('[VoiceOverlay] Initializing manager...');
    this.initOverlayWindow();
    this.setupHook();
    this.setupIpc();
  }

  private setupIpc() {
    ipcMain.on('voice-overlay:audio-levels', (event, levels) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win !== this.overlayWindow) {
          // You might not want to send audio levels to ALL windows, but for now it's fine, 
          // actually the main window generates it, so let's only send to overlay.
          if (win === this.overlayWindow && win.isVisible()) {
             win.webContents.send('voice-overlay:audio-levels', levels);
          }
        } else if (win === this.overlayWindow && !win.isDestroyed() && win.isVisible()) {
           win.webContents.send('voice-overlay:audio-levels', levels);
        }
      });
    });

    ipcMain.on('voice-overlay:set-state', (event, payload) => {
      console.log(`[VoiceOverlay] Set state IPC:`, payload);
      const stateStr = typeof payload === 'string' ? payload : (payload?.state || 'idle');
      
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
        if (this.holdTimeout) clearTimeout(this.holdTimeout);
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
          if (this.holdTimeout) clearTimeout(this.holdTimeout);
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

      const isDev = !app.isPackaged;
      const overlayUrl = isDev ? 'http://localhost:3001/overlay' : 'everfern-app://./overlay/index.html';
      
      console.log(`[VoiceOverlay] Loading URL: ${overlayUrl}`);
      
      if (isDev) {
        this.overlayWindow.loadURL(overlayUrl).catch(e => console.error('[VoiceOverlay] Failed to load URL:', e));
      } else {
        this.overlayWindow.loadURL(overlayUrl).catch(e => console.error('[VoiceOverlay] Failed to load URL:', e));
      }

      this.overlayWindow.setIgnoreMouseEvents(true);
      console.log('[VoiceOverlay] Window initialized.');
    } catch (err) {
      console.error('[VoiceOverlay] Critical error initializing window:', err);
    }
  }

  private setupHook() {
    if (!uIOhook) {
      console.warn('[VoiceOverlay] Skipping hook setup — uiohook-napi not available on this platform/build.');
      return;
    }
    console.log('[VoiceOverlay] Setting up uIOhook...');
    
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
        }
        this.checkState();
      });

      uIOhook.start();
      console.log('[VoiceOverlay] uIOhook started successfully.');
    } catch (err) {
      console.error('[VoiceOverlay] Failed to start uIOhook:', err);
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
            if (this.holdTimeout) clearTimeout(this.holdTimeout);
            
            if (this.overlayWindow) {
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
        
        if (this.overlayWindow) {
          broadcastState('executing');
        }
      }
    }
  }
}
