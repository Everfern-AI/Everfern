/**
 * MP-SEC-21 — preload generic on/off channel allowlist.
 *
 * Verifies (source-level, like the existing preload-api-structure tests):
 *  - the allowlist constant exists and contains exactly the channels the
 *    renderer currently subscribes to (audit them against src/ call sites)
 *  - on()/off() guard against non-allowlisted channels
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const preloadContent = fs.readFileSync(
  path.join(__dirname, '../../preload/preload.ts'),
  'utf-8'
);

describe('MP-SEC-21 preload generic subscription allowlist', () => {
  it('defines the allowlist constant', () => {
    expect(preloadContent).toContain('GENERIC_EVENT_CHANNEL_ALLOWLIST');
  });

  it('includes every channel subscribed to by renderer code', () => {
    const required = [
      'chat:title-updated',
      'shortcut:resume-chat',
      'shortcut:show-history',
      'acp:protocol-link',
      'computer-use:cursor-move',
      'computer-use:cursor-click',
      'computer-use:overlay-state',
    ];
    for (const ch of required) {
      expect(preloadContent).toContain(`'${ch}'`);
    }
  });

  it('on() rejects non-allowlisted channels at runtime', () => {
    // Extract the guard from the source to assert it exists both in on and off.
    const guards = preloadContent.match(/if \(!GENERIC_EVENT_CHANNEL_ALLOWLIST\.includes\(channel\)\)/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2); // one in on, one in off
  });

  it('off() still supports per-callback removal and removeAllListeners', () => {
    expect(preloadContent).toContain('listenersMap.get(cb)');
    expect(preloadContent).toContain('ipcRenderer.removeAllListeners(channel)');
  });
});
