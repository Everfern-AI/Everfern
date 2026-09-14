/**
 * SystemTrayManager Integration Tests
 *
 * Simple integration tests to verify the SystemTrayManager functionality
 */

import { describe, it, expect } from 'vitest';
import { SystemTrayManager } from '../system-tray-manager';

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
});
