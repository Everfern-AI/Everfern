/**
 * SystemTrayManager - Cross-platform system tray functionality
 *
 * Handles system tray icon creation, context menu management, and window
 * show/hide functionality for EverFern desktop application.
 *
 * Requirements: 2.2, 2.3, 2.4
 */

import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface SystemTrayConfig {
  showOnStart?: boolean;
  minimizeToTray?: boolean;
}

export class SystemTrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private config: SystemTrayConfig;
  private isQuitting = false;

  constructor(config: SystemTrayConfig = {}) {
    this.config = {
      showOnStart: true,
      minimizeToTray: true,
      ...config
    };
  }

  /**
   * Create and initialize the system tray
   */
  createTray(mainWindow: BrowserWindow): void {
    if (this.tray) {
      console.log('[SystemTray] Tray already exists, skipping creation');
      return;
    }

    this.mainWindow = mainWindow;

    try {
      const iconPath = this.getTrayIconPath();
      console.log(`[SystemTray] Creating tray with icon: ${iconPath}`);

      // Create tray icon with proper sizing for different platforms
      const trayIcon = this.createTrayIcon(iconPath);
      this.tray = new Tray(trayIcon);

      // Set up tray properties
      this.tray.setToolTip('EverFern AI Assistant');

      // Create context menu
      this.updateTrayMenu();

      // Handle tray click events
      this.setupTrayEvents();

      console.log('[SystemTray] System tray created successfully');
    } catch (error) {
      console.error('[SystemTray] Failed to create system tray:', error);
      throw error;
    }
  }

  /**
   * Show the main window and bring it to front
   */
  showWindow(): void {
    if (!this.mainWindow) {
      console.warn('[SystemTray] No main window reference available');
      return;
    }

    try {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }

      this.mainWindow.show();
      this.mainWindow.focus();

      // On macOS, also bring the app to front
      if (process.platform === 'darwin') {
        app.focus();
      }

      console.log('[SystemTray] Main window shown and focused');
    } catch (error) {
      console.error('[SystemTray] Failed to show window:', error);
    }
  }

  /**
   * Hide the main window to system tray
   */
  hideToTray(): void {
    if (!this.mainWindow) {
      console.warn('[SystemTray] No main window reference available');
      return;
    }

    try {
      this.mainWindow.hide();
      console.log('[SystemTray] Main window hidden to tray');

      // Show notification on first hide (optional)
      if (this.tray && this.config.showOnStart) {
        this.tray.displayBalloon({
          title: 'EverFern',
          content: 'EverFern is running in the background. Click the tray icon to restore.',
          icon: this.createTrayIcon(this.getTrayIconPath())
        });
      }
    } catch (error) {
      console.error('[SystemTray] Failed to hide window to tray:', error);
    }
  }

  /**
   * Update the tray context menu
   */
  updateTrayMenu(): void {
    if (!this.tray) {
      console.warn('[SystemTray] No tray instance available for menu update');
      return;
    }

    const isWindowVisible = this.mainWindow?.isVisible() || false;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: isWindowVisible ? 'Hide EverFern' : 'Show EverFern',
        click: () => {
          if (isWindowVisible) {
            this.hideToTray();
          } else {
            this.showWindow();
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Settings',
        click: () => {
          this.showWindow();
          // Send event to renderer to open settings
          this.mainWindow?.webContents.send('tray:open-settings');
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit EverFern',
        click: () => {
          console.log('[SystemTray] Quit requested from tray menu');
          this.isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Destroy the system tray
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      console.log('[SystemTray] System tray destroyed');
    }
  }

  /**
   * Check if tray is available on current platform
   */
  isSupported(): boolean {
    try {
      const supported = (Tray as any).isSupported?.() ?? true; // Electron Tray usually supported on main platforms
      console.log(`[SystemTray] Support check: ${supported} (Platform: ${process.platform})`);
      return supported;
    } catch (error) {
      console.warn('[SystemTray] Support check failed, assuming supported:', error);
      return true;
    }
  }

  /**
   * Get the current tray instance
   */
  getTray(): Tray | null {
    return this.tray;
  }

  // ── Private Methods ─────────────────────────────────────────────────

  /**
   * Get the appropriate tray icon path for the current platform
   */
  private getTrayIconPath(): string {
    const isDev = !app.isPackaged;

    // In production, extraResources (like 'public') are in process.resourcesPath
    // In dev, they're in the project root
    const baseDir = isDev
      ? path.join(__dirname, '../../')
      : process.resourcesPath;

    // Platform-specific icon selection
    let iconName: string;
    switch (process.platform) {
      case 'win32':
        iconName = 'everfern.ico';
        break;
      case 'darwin':
        // macOS prefers template images for tray icons
        iconName = 'tray-icon.png';
        break;
      case 'linux':
        iconName = 'everfern-rounded.png';
        break;
      default:
        iconName = 'everfern-rounded.png';
    }

    // Try tray-specific icon first, fall back to general logo
    const trayIconPath = path.join(baseDir, 'public/images/logos/tray-icon.png');
    const fallbackIconPath = path.join(baseDir, `public/images/logos/${iconName}`);

    // Use tray-specific icon if it exists, otherwise use fallback
    if (fs.existsSync(trayIconPath)) {
      console.log(`[SystemTray] Using tray icon: ${trayIconPath}`);
      return trayIconPath;
    } else if (fs.existsSync(fallbackIconPath)) {
      console.log(`[SystemTray] Using fallback icon: ${fallbackIconPath}`);
      return fallbackIconPath;
    } else {
      console.warn('[SystemTray] No suitable tray icon found, using default');
      return fallbackIconPath; // Return path anyway, let Electron handle the error
    }
  }

  /**
   * Create a properly sized tray icon for the current platform
   */
  private createTrayIcon(iconPath: string): Electron.NativeImage {
    try {
      let icon = nativeImage.createFromPath(iconPath);

      if (icon.isEmpty()) {
        console.warn(`[SystemTray] Icon at ${iconPath} is empty or invalid`);
        // Create a simple fallback icon
        icon = nativeImage.createEmpty();
      }

      // Platform-specific icon sizing and processing
      switch (process.platform) {
        case 'darwin':
          // macOS tray icons should be ~22x22 points (44x44 pixels for Retina)
          icon = icon.resize({ width: 22, height: 22 });
          // Set as template image for proper dark/light mode handling
          icon.setTemplateImage(true);
          break;
        case 'win32':
          // Windows tray icons are typically 16x16 or 32x32
          icon = icon.resize({ width: 16, height: 16 });
          break;
        case 'linux':
          // Linux tray icons vary by desktop environment, 22x22 is common
          icon = icon.resize({ width: 22, height: 22 });
          break;
      }

      return icon;
    } catch (error) {
      console.error(`[SystemTray] Failed to create tray icon from ${iconPath}:`, error);
      return nativeImage.createEmpty();
    }
  }

  /**
   * Set up tray event handlers
   */
  private setupTrayEvents(): void {
    if (!this.tray) return;

    // Handle tray icon clicks
    this.tray.on('click', () => {
      console.log('[SystemTray] Tray icon clicked');

      if (this.mainWindow?.isVisible()) {
        this.hideToTray();
      } else {
        this.showWindow();
      }
    });

    // Handle double-click (mainly for Windows/Linux)
    this.tray.on('double-click', () => {
      console.log('[SystemTray] Tray icon double-clicked');
      this.showWindow();
    });

    // Handle right-click (context menu is shown automatically)
    this.tray.on('right-click', () => {
      console.log('[SystemTray] Tray icon right-clicked');
      // Update menu to reflect current window state
      this.updateTrayMenu();
    });

    // Handle balloon click (Windows)
    this.tray.on('balloon-click', () => {
      console.log('[SystemTray] Tray balloon clicked');
      this.showWindow();
    });
  }

  /**
   * Handle window state changes to update tray menu
   *
   * FIX: System Tray Minimize Event Interception
   *
   * The previous implementation intercepted ALL minimize events, including system-generated
   * events from file picker dialogs and window blur/focus loss. This broke file picker
   * functionality and caused unexpected window hiding.
   *
   * SOLUTION: Remove minimize event interception entirely. Only intercept the close event.
   * This approach:
   * - Prevents system-generated minimize events from being incorrectly intercepted
   * - Preserves the minimize-to-tray behavior for explicit close button clicks
   * - Allows normal minimize behavior (minimize to taskbar) when user clicks minimize button
   * - Eliminates the need for complex dialog state tracking
   *
   * BEHAVIOR CHANGE:
   * - Before: Clicking minimize button → hides to tray
   * - After: Clicking minimize button → minimizes to taskbar (normal behavior)
   * - Before: Clicking close button (X) → hides to tray
   * - After: Clicking close button (X) → hides to tray (PRESERVED)
   * - Before: File picker dialog → window hides to tray (BUG)
   * - After: File picker dialog → window stays visible (FIXED)
   *
   * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.2, 3.4, 3.5
   */
  setupWindowEvents(): void {
    if (!this.mainWindow) return;

    if (app && typeof app.on === 'function') {
      app.on('before-quit', () => {
        this.isQuitting = true;
      });
    }

    // Update tray menu when window visibility changes
    this.mainWindow.on('show', () => {
      this.updateTrayMenu();
    });

    this.mainWindow.on('hide', () => {
      this.updateTrayMenu();
    });

    // Handle window close event - minimize to tray instead of quitting
    // Skip interception if a real quit was requested (e.g. from tray menu)
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && this.config.minimizeToTray && this.tray) {
        event.preventDefault();
        this.hideToTray();
        console.log('[SystemTray] Window close intercepted, minimized to tray');
      }
    });

    // NOTE: Minimize event interception has been REMOVED
    // Previous implementation (lines 349-355) intercepted ALL minimize events,
    // including system-generated events from file picker dialogs and focus loss.
    // This caused the bug where file pickers would become unusable.
    //
    // The fix allows normal minimize behavior (minimize to taskbar) while preserving
    // the minimize-to-tray behavior for explicit close button clicks.
  }
}

// Export singleton instance
export const systemTrayManager = new SystemTrayManager();
