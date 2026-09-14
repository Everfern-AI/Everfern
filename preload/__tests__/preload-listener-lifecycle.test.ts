/**
 * NR-LEAK-01/02/03 — preload listener lifecycle fixes.
 *
 * Source-level verification (contextBridge/ipcRenderer require a live
 * Electron runtime), matching the style of preload-api-structure.test.ts:
 *  - NR-LEAK-01: onUpdate* subscriptions are tracked in a registry,
 *    return unsubscribe functions, and _offUpdate* remove the exact
 *    wrapper stored for the callback (no more silent no-op cleanups).
 *  - NR-LEAK-02: onDispatchActive is tracked, returns an unsubscribe
 *    function, and offDispatchActive removes the exact wrapper.
 *  - NR-LEAK-03: onOllamaPullLine exists, subscribes to the real
 *    'system:ollama-pull-line' channel used by main's ollama pull
 *    handler, and removeOllamaListeners clears it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const preloadContent = fs.readFileSync(
  path.join(__dirname, '../preload.ts'),
  'utf-8'
);

describe('NR-LEAK-01 update channel listener registry', () => {
  it('tracks wrappers per channel in a registry map', () => {
    expect(preloadContent).toContain('updateListenerWrappers');
    expect(preloadContent).toMatch(
      /let wrappers = updateListenerWrappers\.get\(channel\)/
    );
    expect(preloadContent).toMatch(/wrappers\.set\(cb, wrapper\)/);
    expect(preloadContent).toMatch(/ipcRenderer\.on\(channel, wrapper\)/);
  });

  it('each onUpdate* returns an unsubscribe function', () => {
    for (const name of ['onUpdateAvailable', 'onUpdateDownloaded', 'onUpdateProgress', 'onUpdateError']) {
      const re = new RegExp(`${name}:\\s*\\(cb:.*\\)\\s*=>\\s*registerUpdateListener\\(`);
      expect(preloadContent).toMatch(re);
    }
    // registerUpdateListener returns the off closure
    expect(preloadContent).toMatch(
      /return \(\) => removeUpdateListener\(channel, cb\);/
    );
  });

  it('all four _offUpdate* methods remove the exact wrapper stored for the callback', () => {
    const pairs: Record<string, string> = {
      _offUpdateAvailable: 'update-available',
      _offUpdateDownloaded: 'update-downloaded',
      _offUpdateProgress: 'download-progress',
      _offUpdateError: 'update-error',
    };
    for (const [method, channel] of Object.entries(pairs)) {
      expect(preloadContent).toMatch(
        new RegExp(`${method}:\\s*\\(cb:.*\\)\\s*=>\\s*removeUpdateListener\\('${channel}',\\s*cb\\)`)
      );
    }
    // removeUpdateListener removes the exact wrapper, not all listeners
    // (either direct .get or optional-chained .get form is acceptable).
    expect(preloadContent).toMatch(
      /const wrapper = (\w+|\w+\?)\.get\(cb\);\s*\n?\s*if \(wrapper\) \{\s*\n\s*ipcRenderer\.removeListener\(channel, wrapper\);/
    );
  });

  it('declares the new methods in the ElectronAPI system interface', () => {
    expect(preloadContent).toMatch(
      /onUpdateAvailable: \(cb: \(info: any\) => void\) => \(\) => void;/
    );
    expect(preloadContent).toMatch(
      /onUpdateDownloaded: \(cb: \(info: any\) => void\) => \(\) => void;/
    );
    expect(preloadContent).toMatch(
      /onUpdateProgress: \(cb: \(progress: any\) => void\) => \(\) => void;/
    );
    expect(preloadContent).toMatch(
      /onUpdateError: \(cb: \(error: string\) => void\) => \(\) => void;/
    );
    for (const method of ['_offUpdateAvailable', '_offUpdateDownloaded', '_offUpdateProgress', '_offUpdateError']) {
      expect(preloadContent).toMatch(new RegExp(`${method}: \\(cb`));
    }
  });
});

describe('NR-LEAK-02 dispatch-active listener lifecycle', () => {
  it('onDispatchActive stores its wrapper and returns an unsubscribe function', () => {
    // CU-LEAK-05: also single-slot — removeAllListeners runs before .on so
    // repeated registrations replace instead of stacking. The (?:\s*//…)*
    // span tolerates the CU-LEAK-05 explanatory comment lines between the
    // registry set and the single-slot clear.
    expect(preloadContent).toMatch(
      /onDispatchActive: \(cb: \(\) => void\) => \{\s*\n\s*const handler = \(\) => cb\(\);\s*\n\s*dispatchActiveWrappers\.set\(cb, handler\);(?:\s*\/\/[^\n]*\n)*\s*ipcRenderer\.removeAllListeners\('system:dispatch-active'\);\s*\n\s*ipcRenderer\.on\('system:dispatch-active', handler\);\s*\n\s*return \(\) => removeDispatchActiveListener\(cb\);/
    );
  });

  it('offDispatchActive removes the exact wrapper for the callback', () => {
    expect(preloadContent).toContain('offDispatchActive:');
    expect(preloadContent).toMatch(
      /const handler = dispatchActiveWrappers\.get\(cb\);\s*\n\s*if \(handler\) \{\s*\n\s*ipcRenderer\.removeListener\('system:dispatch-active', handler\);/
    );
  });

  it('declares onDispatchActive unsubscribe + offDispatchActive in the interface', () => {
    expect(preloadContent).toMatch(
      /onDispatchActive: \(cb: \(\) => void\) => \(\) => void;/
    );
    expect(preloadContent).toMatch(/offDispatchActive: \(cb: \(\) => void\) => void;/);
  });
});

describe('NR-LEAK-03 ollama pull line channel', () => {
  it('onOllamaPullLine subscribes to the real pull channel and returns unsubscribe', () => {
    // main/ipc/system/ollama-audio-handlers.ts 'system:ollama-pull' streams
    // progress lines on 'system:ollama-pull-line'.
    expect(preloadContent).toMatch(
      /onOllamaPullLine: \(cb: \(data: \{ line: string, type: 'stdout'\|'stderr' \}\) => void\) => \{\s*\n\s*const handler = \(_e: any, data: any\) => cb\(data\);\s*\n\s*ollamaPullLineWrappers\.set\(cb, handler\);\s*\n\s*ipcRenderer\.on\('system:ollama-pull-line', handler\);/
    );
    expect(preloadContent).toMatch(
      /ipcRenderer\.removeListener\('system:ollama-pull-line', handler\)/
    );
  });

  it('removeOllamaListeners clears the pull-line registry too', () => {
    expect(preloadContent).toMatch(
      /removeOllamaListeners: \(\) => \{\s*\n\s*ipcRenderer\.removeAllListeners\('system:ollama-install-line'\);\s*\n\s*ipcRenderer\.removeAllListeners\('system:ollama-pull-line'\);\s*\n\s*ollamaPullLineWrappers\.clear\(\);\s*\n\s*\},/
    );
  });

  it('declares onOllamaPullLine in the interface with unsubscribe return', () => {
    expect(preloadContent).toMatch(
      /onOllamaPullLine: \(cb: \(data: \{ line: string, type: 'stdout'\|'stderr' \}\) => void\) => \(\) => void;/
    );
  });
});

describe('Consumer cleanups (source-level)', () => {
  const readSrc = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf-8');

  it('SettingsPage update effect cleanup uses the real off API', () => {
    const content = readSrc('app/chat/SettingsPage.tsx');
    expect(content).toContain('api._offUpdateAvailable?.(onAvailable)');
    expect(content).toContain('api._offUpdateDownloaded?.(onDownloaded)');
    expect(content).toContain('api._offUpdateProgress?.(onProgress)');
    expect(content).toContain('api._offUpdateError?.(onError)');
  });

  it('SettingsPage pull flow removes ollama listeners on start and finish', () => {
    const content = readSrc('app/chat/SettingsPage.tsx');
    expect(content).toContain('api.removeOllamaListeners?.()');
    expect(content).toMatch(/finally\s*\{\s*\n\s*api\.removeOllamaListeners\?\.\(\);/);
  });

  it('DispatchSection registers once per site and tears down on unmount', () => {
    const content = readSrc('app/chat/settings/DispatchSection.tsx');
    // Both registration sites route through the tracked helper
    const directRegistrations = content.match(
      /electronAPI\?\.system\?\.onDispatchActive\?\.\(/g
    );
    expect(directRegistrations).toBeNull();
    expect(content).toContain('restoreTeardown = registerDispatchActiveListener()');
    expect(content).toContain('registerDispatchActiveListener();');
    expect(content).toMatch(/unsubscribeRef\.current\.forEach\(\(unsub\) => unsub\?\.\(\)\);/);
  });
});
