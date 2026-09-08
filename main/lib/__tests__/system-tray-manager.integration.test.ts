/**
 * SystemTrayManager Integration Tests
 *
 * Simple integration tests to verify the SystemTrayManager functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemTrayManager } from '../system-tray-manager';
import { Tray, app, nativeImage } from 'electron';

// Mock Electron modules (same shape as the minimize-event tests)
vi.mock('electron', () => {
  class MockTray {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    displayBalloon = vi.fn();
  }
  return {
    Tray: MockTray,
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
    },
    BrowserWindow: vi.fn(),
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => ''),
      focus: vi.fn(),
      quit: vi.fn(),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        resize: vi.fn().mockReturnThis(),
        setTemplateImage: vi.fn(),
      })),
      createEmpty: vi.fn(() => ({
        isEmpty: () => true,
        resize: vi.fn().mockReturnThis(),
        setTemplateImage: vi.fn(),
      })),
    },
  };
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
  },
  existsSync: vi.fn(() => false),
}));

/**
 * Platform matrix (MP-LIFE-02): hideToTray balloon behavior.
 * - win32: displayBalloon called exactly ONCE per manager instance (first hide only)
 * - darwin/linux: displayBalloon NEVER called (not a real API there)
 */
function withMockedPlatform<T>(platform: string, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', {
      value: original,
      configurable: true,
    });
  }
}

function createMockWindow(): any {
  return {
    on: vi.fn(),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

describe('SystemTrayManager Integration', () => {
  let trayManager: SystemTrayManager;

  beforeEach(() => {
    trayManager = new SystemTrayManager();
  });

  afterEach(() => {
    trayManager.destroy();
  });

  describe('Basic functionality', () => {
    it('should create SystemTrayManager instance', () => {
      expect(trayManager).toBeDefined();
      expect(trayManager).toBeInstanceOf(SystemTrayManager);
    });

    it('should have correct initial state', () => {
      expect(trayManager.getTray()).toBeNull();
    });

    it('should handle destroy gracefully when no tray exists', () => {
      expect(() => {
        trayManager.destroy();
      }).not.toThrow();
    });

    it('should handle showWindow gracefully when no window exists', () => {
      expect(() => {
        trayManager.showWindow();
      }).not.toThrow();
    });

    it('should handle hideToTray gracefully when no window exists', () => {
      expect(() => {
        trayManager.hideToTray();
      }).not.toThrow();
    });

    it('should handle updateTrayMenu gracefully when no tray exists', () => {
      expect(() => {
        trayManager.updateTrayMenu();
      }).not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should accept configuration options', () => {
      const configuredManager = new SystemTrayManager({
        showOnStart: false,
        minimizeToTray: false
      });

      expect(configuredManager).toBeDefined();
      configuredManager.destroy();
    });

    it('should use default configuration when none provided', () => {
      const defaultManager = new SystemTrayManager();
      expect(defaultManager).toBeDefined();
      defaultManager.destroy();
    });
  });

  describe('Platform support', () => {
    it('should return boolean for isSupported', () => {
      const isSupported = trayManager.isSupported();
      expect(typeof isSupported).toBe('boolean');
    });
  });

  describe('MP-LIFE-02 platform matrix: hideToTray balloon behavior', () => {
    const platforms = ['win32', 'darwin', 'linux'];

    beforeEach(() => {
      vi.clearAllMocks();
    });

    platforms.forEach((platform) => {
      it(`win32-style first hideToTray: displayBalloon ${platform === 'win32' ? 'ONCE' : 'never'} (${platform})`, () => {
        withMockedPlatform(platform, () => {
          const manager = new SystemTrayManager({ showOnStart: true, minimizeToTray: true });
          const window = createMockWindow();
          manager.createTray(window);

          const tray = manager.getTray() as any;
          expect(tray).not.toBeNull();
          expect(tray.displayBalloon).toBeDefined();

          // First hide
          manager.hideToTray();
          expect(window.hide).toHaveBeenCalledTimes(1);

          if (platform === 'win32') {
            expect(tray.displayBalloon).toHaveBeenCalledTimes(1);
            expect(tray.displayBalloon).toHaveBeenCalledWith(
              expect.objectContaining({ title: 'EverFern' })
            );
          } else {
            expect(tray.displayBalloon).not.toHaveBeenCalled();
          }

          manager.destroy();
        });
      });

      it(`second hideToTray does NOT re-show balloon (${platform})`, () => {
        withMockedPlatform(platform, () => {
          const manager = new SystemTrayManager({ showOnStart: true, minimizeToTray: true });
          const window = createMockWindow();
          manager.createTray(window);

          const tray = manager.getTray() as any;

          manager.hideToTray();
          manager.hideToTray();
          manager.hideToTray();

          if (platform === 'win32') {
            // Exactly once per session, never per-hide spam
            expect(tray.displayBalloon).toHaveBeenCalledTimes(1);
          } else {
            expect(tray.displayBalloon).not.toHaveBeenCalled();
          }
          expect(window.hide).toHaveBeenCalledTimes(3);

          manager.destroy();
        });
      });
    });

    it('win32: balloon suppressed when showOnStart is false', () => {
      withMockedPlatform('win32', () => {
        const manager = new SystemTrayManager({ showOnStart: false, minimizeToTray: true });
        const window = createMockWindow();
        manager.createTray(window);

        const tray = manager.getTray() as any;

        manager.hideToTray();
        expect(tray.displayBalloon).not.toHaveBeenCalled();

        manager.destroy();
      });
    });

    it('win32: no balloon when tray missing displayBalloon (defensive)', () => {
      withMockedPlatform('win32', () => {
        const manager = new SystemTrayManager({ showOnStart: true, minimizeToTray: true });
        const window = createMockWindow();
        manager.createTray(window);

        const tray = manager.getTray() as any;
        delete tray.displayBalloon;

        expect(() => manager.hideToTray()).not.toThrow();
        expect(window.hide).toHaveBeenCalledTimes(1);

        manager.destroy();
      });
    });

    it('tray click handler toggles based on live isVisible state (staleness check)', () => {
      const manager = new SystemTrayManager({ showOnStart: true, minimizeToTray: true });
      const window = createMockWindow();
      manager.createTray(window);

      const tray = manager.getTray() as any;
      const clickHandler = tray.on.mock.calls.find((c: any[]) => c[0] === 'click')?.[1];
      expect(clickHandler).toBeDefined();

      // Visible → hide
      window.isVisible.mockReturnValue(true);
      clickHandler();
      expect(window.hide).toHaveBeenCalledTimes(1);

      // Hidden → show (live re-evaluation, not stale menu label)
      window.isVisible.mockReturnValue(false);
      clickHandler();
      expect(window.show).toHaveBeenCalledTimes(1);
      expect(window.focus).toHaveBeenCalledTimes(1);

      manager.destroy();
    });
  });
});
