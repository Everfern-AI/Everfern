/**
 * Desktop Overlay — Apple-style desktop UI indicator for computer-use
 * Uses native desktop rendering with gradient effects and status indicator.
 * Displays status and visual feedback for actions.
 */

import { screen, BrowserWindow } from 'electron';

export class DesktopOverlay {
  private overlayWindow: BrowserWindow | null = null;
  private statusText: string = 'Computer Use Active';
  private isVisible: boolean = false;

  constructor() {
    this.createOverlayWindow();
  }

  private createOverlayWindow(): void {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height, x, y } = primaryDisplay.bounds;

      this.overlayWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        show: false, // Ensure it doesn't flash when instantiated initially
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          preload: undefined,
        },
      });

      // Ensure it's on top of everything, even full-screen apps
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.overlayWindow.setContentProtection(true);

      // Load the overlay HTML
      const overlayHTML = this.getOverlayHTML(width, height);
      this.overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHTML)}`);

      // Make window click-through (pointer-events: none equivalent)
      this.overlayWindow.setIgnoreMouseEvents(true);

      // Hide initially
      this.overlayWindow.hide();

      console.log('[DesktopOverlay] Overlay window created successfully');
    } catch (err) {
      console.error('[DesktopOverlay] Failed to create overlay window:', err);
    }
  }

  private getOverlayHTML(width: number, height: number): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            width: 100vw;
            height: 100vh;
            overflow: hidden;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }

          /* ── Intense Purple Border with Animated Beam ── */
          .border-glow {
            position: fixed;
            inset: 0;
            /* Thicker, more visible base border */
            border: 3.5px solid rgba(160, 40, 255, 0.5);
            /* Stronger neon inner glow */
            box-shadow: 
              inset 0 0 40px rgba(160, 40, 255, 0.4),
              inset 0 0 15px rgba(220, 80, 255, 0.3);
            pointer-events: none;
            z-index: 20;
            overflow: hidden;
          }

          /* The "Animated Beam" — a high-intensity light traveling the border */
          .border-glow::after {
            content: "";
            position: absolute;
            inset: -100%;
            /* High-intensity conic gradient beam */
            background: conic-gradient(
              from 0deg,
              transparent 0%,
              transparent 10%,
              rgba(255, 255, 255, 0.9) 12%,   /* Beam core */
              rgba(190, 60, 255, 1) 15%,     /* Beam trail */
              transparent 20%,
              transparent 100%
            );
            animation: beam-rotate 4s infinite linear;
            /* Mask to only show on the 3.5px border */
            -webkit-mask: 
               linear-gradient(#fff 0 0) padding-box, 
               linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
          }

          @keyframes beam-rotate {
            0%   { transform: rotate(0deg);   }
            100% { transform: rotate(360deg); }
          }

          .click-anim {
            animation: click 0.5s ease;
          }

          @keyframes click {
            0%   { transform: scale(1);   }
            40%  { transform: scale(0.6); }
            100% { transform: scale(1);   }
          }

          /* ── Element highlight ── */
          #highlight {
            position: fixed;
            border: 2px solid #007AFF;
            border-radius: 8px;
            background: rgba(0, 122, 255, 0.1);
            transition: all 0.4s ease;
            opacity: 0;
            box-shadow: 0 0 20px rgba(0, 122, 255, 0.3);
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div class="border-glow"></div>
        <div id="highlight"></div>

        <script>
          // IPC communication with main process
          const { ipcRenderer } = require('electron');

          window.desktopOverlayAPI = {
            setStatus: (text) => {
              const el = document.getElementById('text');
              if (el) el.textContent = text;
            },
            moveCursor: (x, y, click) => {
              // The real OS cursor is moved by robotjs. Do not draw a fake/magic cursor here.
            },
            highlight: (r) => {
              const h = document.getElementById('highlight');
              if (!h) return;
              h.style.left = r.x + 'px';
              h.style.top = r.y + 'px';
              h.style.width = r.width + 'px';
              h.style.height = r.height + 'px';
              h.style.opacity = '1';
              setTimeout(() => { h.style.opacity = '0'; }, 1500);
            }
          };

          // Listen for updates from main process
          ipcRenderer.on('overlay-update', (event, data) => {
            if (data.status) window.desktopOverlayAPI.setStatus(data.status);
            if (data.cursor) window.desktopOverlayAPI.moveCursor(data.cursor.x, data.cursor.y, data.cursor.click);
            if (data.highlight) window.desktopOverlayAPI.highlight(data.highlight);
          });
        </script>
      </body>
      </html>
    `;
  }

  show(): void {
    if (this.overlayWindow) {
      this.overlayWindow.show();
      this.isVisible = true;
      console.log('[DesktopOverlay] Overlay window.show() called');
    }
  }

  hide(): void {
    if (this.overlayWindow) {
      this.overlayWindow.hide();
      this.isVisible = false;
      console.log('[DesktopOverlay] Overlay window.hide() called');
    }
  }

  setStatus(text: string): void {
    this.statusText = text;
    if (this.overlayWindow) {
      this.overlayWindow.webContents.send('overlay-update', { status: text });
      console.log(`[DesktopOverlay] Status updated: ${text}`);
    }
  }

  moveCursor(x: number, y: number, click: boolean = false): void {
    if (this.overlayWindow) {
      this.overlayWindow.webContents.send('overlay-update', { cursor: { x, y, click } });
    }
  }

  highlight(box: { x: number; y: number; width: number; height: number }): void {
    if (this.overlayWindow) {
      this.overlayWindow.webContents.send('overlay-update', { highlight: box });
    }
  }

  destroy(): void {
    if (this.overlayWindow) {
      this.overlayWindow.destroy();
      this.overlayWindow = null;
      console.log('[DesktopOverlay] Overlay destroyed');
    }
  }

  isActive(): boolean {
    return this.isVisible && this.overlayWindow !== null;
  }
}

export default DesktopOverlay;
