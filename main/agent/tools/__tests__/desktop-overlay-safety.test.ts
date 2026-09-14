/**
 * AG-SAF-09 — desktop-overlay Electron window hardening.
 *
 * Source-reading regression test (same pattern as
 * main/__tests__/wsl-installer-hardening.test.ts): the overlay BrowserWindow
 * renders untrusted HTML (data: URL) and therefore must never enable
 * nodeIntegration; it must run sandboxed with context isolation and web
 * security. The overlay HTML must be plain DOM/timer code — no require(),
 * no ipcRenderer, no Node APIs in the renderer.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '../desktop-overlay.ts'),
  'utf-8'
);

const WITHOUT_COMMENTS = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const code = WITHOUT_COMMENTS(source);

describe('AG-SAF-09: desktop-overlay webPreferences hardening', () => {
  it('never enables nodeIntegration', () => {
    expect(source).not.toMatch(/nodeIntegration:\s*true/);
  });

  it('enables contextIsolation', () => {
    expect(source).toMatch(/contextIsolation:\s*true/);
  });

  it('enables sandbox', () => {
    expect(source).toMatch(/sandbox:\s*true/);
  });

  it('enables webSecurity', () => {
    expect(source).toMatch(/webSecurity:\s*true/);
  });

  it('has no preload contract (preload explicitly undefined)', () => {
    expect(source).toMatch(/preload:\s*undefined/);
  });

  it('overlay HTML never touches Node/IPC APIs from the renderer', () => {
    // The renderer is sandboxed; require/ipcRenderer inside the HTML would
    // either crash or indicate the old nodeIntegration contract crept back.
    expect(code).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
    expect(code).not.toContain('ipcRenderer');
    expect(code).not.toContain('nodeRequire');
  });

  it('drives the overlay via executeJavaScript (no IPC channel contract)', () => {
    expect(code).toMatch(/webContents\.executeJavaScript/);
    // The old 'overlay-update' IPC contract must be gone
    expect(code).not.toMatch(/send\(\s*['"]overlay-update['"]/);
  });

  it('serializes overlay method arguments as JSON (no string interpolation into JS)', () => {
    // JSON.stringify-based argument passing — the executed expression may
    // interpolate ONLY the method name (a compile-time constant), never a
    // runtime value; runtime values must pass through JSON.stringify.
    expect(source).toMatch(/invokeOverlayMethod/);
    expect(source).toMatch(/JSON\.stringify/);
    const executeBlock = source.match(/executeJavaScript\(\s*`([^`]*)`/);
    expect(executeBlock).not.toBeNull();
    if (executeBlock) {
      // only the method-name + JSON-args placeholders may appear — no other interpolations
      const interpolations = executeBlock[1].match(/\$\{([^}]*)\}/g) ?? [];
      expect(interpolations).toEqual(['${method}', '${jsonArgs}']);
      // method names are validated by the callers to a fixed allowlist
      expect(code).toMatch(/invokeOverlayMethod\('setStatus'/);
      expect(code).toMatch(/invokeOverlayMethod\('moveCursor'/);
      expect(code).toMatch(/invokeOverlayMethod\('highlight'/);
    }
  });
});
