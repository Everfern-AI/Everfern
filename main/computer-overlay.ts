import { app, BrowserWindow, screen, ipcMain } from 'electron';
import * as path from 'path';

/**
 * ComputerOverlayManager
 *
 * Creates a transparent, always-on-top, click-through BrowserWindow that
 * renders a custom animated cursor overlay during computer_use tool execution.
 *
 * KEY DESIGN: robotjs gives coordinates in PHYSICAL pixels. The overlay HTML
 * uses PERCENTAGE-based positioning (same as Navis), so the cursor is always
 * pixel-perfect regardless of display scale factor (125%, 150%, 200%, etc.).
 *
 * We send screenWidth/screenHeight (physical pixel dimensions) with every
 * cursor event so the frontend can compute xPct = (x / screenWidth) * 100.
 */
export class ComputerOverlayManager {
  private overlayWindow: BrowserWindow | null = null;
  private isActive = false;
  // Physical pixel dimensions of the primary display (robotjs coordinate space)
  private physicalWidth = 1920;
  private physicalHeight = 1080;
  private hideTimeout: NodeJS.Timeout | null = null;
  // MP-CORR-12: display-metrics-changed listener is registered exactly once
  // (re-creating the window via ensureWindow() must not double-subscribe).
  private displayListenerAttached = false;

  constructor() {
    console.log('[ComputerOverlay] Manager created, preloading window at startup...');
    this.ensureWindow();
  }

  /**
   * Preload and initialize the overlay window.
   */
  private ensureWindow(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    // `size` = logical pixels (what the OS uses for window positioning)
    const { width, height } = primaryDisplay.size;
    const { x, y } = primaryDisplay.bounds;
    // `workAreaSize` is also logical — we need physical for robotjs mapping
    // physicalSize = size × scaleFactor
    this.refreshPhysicalDimensions();
    // MP-CORR-12: subscribe to display config changes so cached physical
    // dims + window bounds never go stale (once per manager lifetime).
    if (!this.displayListenerAttached) {
      this.displayListenerAttached = true;
      screen.on('display-metrics-changed', (_event, changedDisplay) => {
        this.onDisplayMetricsChanged(changedDisplay);
      });
    }

    console.log(
      `[ComputerOverlay] Display: logical=${width}x${height} ` +
      `physical=${this.physicalWidth}x${this.physicalHeight} ` +
      `scaleFactor=${primaryDisplay.scaleFactor} at (${x}, ${y})`
    );

    this.overlayWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      resizable: false,
      type: 'toolbar',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    // Prevent the AI from "seeing" the overlay cursor in its screenshots
    this.overlayWindow.setContentProtection(true);

    const isDev = !app.isPackaged;
    const overlayUrl = isDev
      ? 'http://localhost:3001/computer-overlay'
      : 'everfern-app://./computer-overlay/index.html';

    console.log(`[ComputerOverlay] Loading URL: ${overlayUrl}`);
    this.overlayWindow.loadURL(overlayUrl).catch(e =>
      console.error('[ComputerOverlay] Failed to load URL:', e)
    );

    this.overlayWindow.on('closed', () => {
      this.overlayWindow = null;
      this.isActive = false;
    });
  }

  /**
   * MP-CORR-12: recompute physical dimensions from the CURRENT primary
   * display (covers resolution + scale-factor changes). Called from
   * ensureWindow(), onDisplayMetricsChanged(), and every show().
   */
  private refreshPhysicalDimensions(): void {
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    this.physicalWidth = Math.round(primary.size.width * sf);
    this.physicalHeight = Math.round(primary.size.height * sf);
  }

  /**
   * MP-CORR-12: display config changed — refresh cached physical dims from
   * the current primary display and snap the overlay window onto its bounds.
   * (Per-event delta mapping is overkill for a full-screen overlay.)
   */
  private onDisplayMetricsChanged(changedDisplay: Electron.Display): void {
    void changedDisplay; // geometry recomputed from the current primary below
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    this.physicalWidth = Math.round(primary.size.width * sf);
    this.physicalHeight = Math.round(primary.size.height * sf);
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.setBounds({
        x: primary.bounds.x,
        y: primary.bounds.y,
        width: primary.size.width,
        height: primary.size.height,
      });
    }
  }

  /**
   * Show the overlay and begin a computer_use session.
   */
  show(taskDescription?: string): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.ensureWindow();
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    // MP-CORR-12: compute geometry per-display — refresh dims on every show
    // so displays changed/scaled while hidden are reflected in the payload.
    this.refreshPhysicalDimensions();

    this.isActive = true;
    this.overlayWindow.showInactive();

    this.overlayWindow.webContents.send('computer-use:overlay-state', {
      active: true,
      task: taskDescription || 'Computer automation in progress...',
      // Send physical dimensions so frontend can do percentage math
      screenWidth: this.physicalWidth,
      screenHeight: this.physicalHeight,
    });

    console.log(`[ComputerOverlay] Overlay shown — task: ${taskDescription}, physical: ${this.physicalWidth}x${this.physicalHeight}`);
  }

  /**
   * Hide the overlay and end the computer_use session.
   */
  hide(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    this.isActive = false;

    this.overlayWindow.webContents.send('computer-use:overlay-state', {
      active: false,
    });

    // MP-CORR-12 issue 1: hide timer cancelled by show()/destroy() — the
    // uncancelled-400ms-delayed-hide race is fixed (see show()/destroy()).
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      if (!this.isActive && this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.hide();
      }
    }, 400);

    console.log('[ComputerOverlay] Overlay hidden');
  }

  /**
   * Move the cursor to the given PHYSICAL screen coordinates.
   * Frontend divides by screenWidth/Height to get percentages.
   */
  moveCursor(x: number, y: number, actionType?: string, description?: string): void {
    if (!this.isActive || !this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    this.overlayWindow.webContents.send('computer-use:cursor-move', {
      x,
      y,
      screenWidth: this.physicalWidth,
      screenHeight: this.physicalHeight,
      actionType: actionType || 'move',
      description: description || '',
      timestamp: Date.now(),
    });
  }

  /**
   * Send a click ripple effect at the given PHYSICAL screen coordinates.
   */
  click(x: number, y: number, clickType?: string): void {
    if (!this.isActive || !this.overlayWindow || this.overlayWindow.isDestroyed()) return;

    this.overlayWindow.webContents.send('computer-use:cursor-click', {
      x,
      y,
      screenWidth: this.physicalWidth,
      screenHeight: this.physicalHeight,
      clickType: clickType || 'left_click',
      timestamp: Date.now(),
    });
  }

  /**
   * Check if overlay is currently active.
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close();
    }
    this.overlayWindow = null;
    this.isActive = false;
  }
}

// Singleton instance
let _instance: ComputerOverlayManager | null = null;

export function getComputerOverlayManager(): ComputerOverlayManager {
  if (!_instance) {
    _instance = new ComputerOverlayManager();
  }
  return _instance;
}
