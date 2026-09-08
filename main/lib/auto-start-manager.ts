/**
 * AutoStartManager - Cross-platform system auto-start functionality
 *
 * Handles registration and management of EverFern auto-start on system boot
 * across Windows, macOS, and Linux platforms.
 *
 * Requirements: 2.5, 2.7, 2.8
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';

export class AutoStartManager {
  private readonly appName = 'EverFern';
  private readonly platform: string;

  constructor(platform?: string) {
    this.platform = platform || process.platform;
  }

  /**
   * Check if auto-start is currently enabled
   */
  async isEnabled(): Promise<boolean> {
    try {
      switch (this.platform) {
        case 'win32':
        case 'darwin':
          return app.getLoginItemSettings().openAtLogin;
        case 'linux':
          return this.isEnabledLinux();
        default:
          console.warn(`[AutoStart] Unsupported platform: ${this.platform}`);
          return false;
      }
    } catch (error) {
      console.error('[AutoStart] Error checking auto-start status:', error);
      return false;
    }
  }

  /**
   * Enable auto-start functionality
   */
  async enable(): Promise<void> {
    try {
      console.log(`[AutoStart] Enabling auto-start on ${this.platform}`);

      switch (this.platform) {
        case 'win32':
        case 'darwin':
          app.setLoginItemSettings({
            openAtLogin: true,
            path: app.getPath('exe'),
            args: ['--auto-start']
          });
          break;
        case 'linux':
          await this.enableLinux();
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }

      console.log('[AutoStart] Auto-start enabled successfully');
    } catch (error) {
      console.error('[AutoStart] Failed to enable auto-start:', error);
      throw error;
    }
  }

  /**
   * Disable auto-start functionality
   */
  async disable(): Promise<void> {
    try {
      console.log(`[AutoStart] Disabling auto-start on ${this.platform}`);

      switch (this.platform) {
        case 'win32':
        case 'darwin':
          app.setLoginItemSettings({
            openAtLogin: false,
            path: app.getPath('exe'),
            args: ['--auto-start']
          });
          break;
        case 'linux':
          await this.disableLinux();
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }

      console.log('[AutoStart] Auto-start disabled successfully');
    } catch (error) {
      console.error('[AutoStart] Failed to disable auto-start:', error);
      throw error;
    }
  }

  /**
   * Get the startup path for the current platform
   */
  getStartupPath(): string {
    return app.getPath('exe');
  }

  // ── Linux Implementation ────────────────────────────────────────────

  private async isEnabledLinux(): Promise<boolean> {
    const desktopFilePath = this.getLinuxDesktopFilePath();
    return fs.existsSync(desktopFilePath);
  }

  private async enableLinux(): Promise<void> {
    const desktopFilePath = this.getLinuxDesktopFilePath();
    const desktopDir = path.dirname(desktopFilePath);

    // Ensure autostart directory exists
    if (!fs.existsSync(desktopDir)) {
      fs.mkdirSync(desktopDir, { recursive: true });
    }

    const exePath = this.getStartupPath();
    const desktopContent = this.generateLinuxDesktopFile(exePath);

    fs.writeFileSync(desktopFilePath, desktopContent, 'utf8');

    // MP-XPLAT-05: desktop files are data files, not executables — 0644 per XDG spec
    try {
      fs.chmodSync(desktopFilePath, 0o644);
    } catch (error) {
      console.warn('[AutoStart] Failed to set desktop file permissions:', error);
    }
  }

  private async disableLinux(): Promise<void> {
    const desktopFilePath = this.getLinuxDesktopFilePath();

    if (fs.existsSync(desktopFilePath)) {
      fs.unlinkSync(desktopFilePath);
    }
  }

  private getLinuxDesktopFilePath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.config', 'autostart', 'everfern-desktop.desktop');
  }

  private generateLinuxDesktopFile(exePath: string): string {
    // MP-XPLAT-05: TryExec lets desktop environments hide/skip the entry when
    // the executable is missing (plain absolute path, no quotes per spec).
    return `[Desktop Entry]
Type=Application
Name=EverFern
Comment=EverFern AI Assistant
Exec="${exePath}" --auto-start
TryExec=${exePath}
Icon=everfern
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
StartupNotify=false
Categories=Utility;
`;
  }

  // ── Utility Methods ─────────────────────────────────────────────────

  /**
   * Get platform-specific auto-start information
   */
  getPlatformInfo(): { platform: string; method: string; location: string } {
    switch (this.platform) {
      case 'win32':
        return {
          platform: 'Windows',
          method: 'Electron app.setLoginItemSettings (Registry)',
          location: 'Windows Registry (HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run)'
        };
      case 'darwin':
        // MP-XPLAT-05: darwin uses app.setLoginItemSettings (backed by
        // SMAppService on modern macOS) — not a hand-rolled LaunchAgent plist.
        return {
          platform: 'macOS',
          method: 'Electron app.setLoginItemSettings (SMAppService / Login Items)',
          location: 'System Settings › General › Login Items (via app.setLoginItemSettings)'
        };
      case 'linux':
        return {
          platform: 'Linux',
          method: 'XDG autostart desktop file',
          location: this.getLinuxDesktopFilePath()
        };
      default:
        return {
          platform: this.platform,
          method: 'Unsupported',
          location: 'N/A'
        };
    }
  }

  /**
   * Validate that auto-start can be enabled on this platform
   */
  async validatePlatformSupport(): Promise<{ supported: boolean; reason?: string }> {
    switch (this.platform) {
      case 'win32':
      case 'darwin':
      case 'linux':
        return { supported: true };
      default:
        return {
          supported: false,
          reason: `Platform ${this.platform} is not supported`
        };
    }
  }
}

// Export singleton instance
export const autoStartManager = new AutoStartManager();
