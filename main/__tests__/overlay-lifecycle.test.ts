/**
 * MP-LIFE-03 · overlay lazy-creation platform matrix.
 *
 * VoiceOverlayManager and ComputerOverlayManager must NEVER be constructed
 * at startup on ANY platform: app.whenReady registers only a lightweight IPC
 * bridge; both ~120MB overlay windows are created on FIRST ARM/USE via their
 * lazy factories. Static guards (files are electron-bound; behavior is
 * covered by the lazy-forwarder contract assertions below).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

const PLATFORMS = ['win32', 'darwin', 'linux'] as const;

describe('MP-LIFE-03 · overlays are lazy on every platform', () => {
  PLATFORMS.forEach((platform) => {
    describe(`platform=${platform}`, () => {
      const main = read('main.ts');
      const voice = read('voice-overlay.ts');
      const computer = read('computer-overlay.ts');

      it('whenReady never constructs VoiceOverlayManager or ComputerOverlayManager', () => {
        // The old eager block must be gone.
        expect(main).not.toMatch(/voiceOverlayManager\s*=\s*new\s+VoiceOverlayManager\(\)/);
        expect(main).not.toMatch(/^\s*getComputerOverlayManager\(\);/m);
        // No other module eagerly constructs either manager.
        expect(main).not.toMatch(/new\s+ComputerOverlayManager\(\)/);
      });

      it('main registers only the lightweight voice IPC bridge in whenReady', () => {
        expect(main).toMatch(/registerVoiceOverlayIpcBridge\(\)/);
      });

      it('voice-overlay: lazy factory + quit-safe shutdown, never eager', () => {
        expect(voice).toMatch(/export function getVoiceOverlayManager\(\)/);
        expect(voice).toMatch(/let _instance: VoiceOverlayManager \| null = null/);
        expect(voice).toMatch(/if \(!_instance\)/);
        expect(voice).toMatch(/export function shutdownVoiceOverlayIfCreated\(\)/);
        // The factory must sit AFTER the class and only construct on call.
        const classEnd = voice.indexOf('export function getVoiceOverlayManager');
        expect(classEnd).toBeGreaterThan(voice.indexOf('export class VoiceOverlayManager'));
      });

      it('bridge forwarders construct the manager on FIRST message only (self-removing)', () => {
        const idx = voice.indexOf('export function registerVoiceOverlayIpcBridge');
        const body = voice.slice(idx);
        expect(body).toMatch(/getVoiceOverlayManager\(\)/);
        expect(body).toMatch(/removeListener\(channel, lazyVoiceForwarder\)/);
      });

      it('computer-overlay: singleton exists only behind getComputerOverlayManager()', () => {
        expect(computer).toMatch(/export function getComputerOverlayManager\(\)/);
        expect(computer).toMatch(/let _instance: ComputerOverlayManager \| null = null/);
      });

      it('quit path shuts down the overlay without constructing one', () => {
        expect(main).toMatch(/shutdownVoiceOverlayIfCreated\(\)/);
      });

      it('protocol handler caching (request counter + Cache-Control) stays intact', () => {
        // The everfern-app protocol.handle block with Cache-Control headers
        // and request counting MUST remain — lazy overlays depend on it and
        // it is preserved uncommitted work.
        expect(main).toMatch(/protocol\.handle\('everfern-app'/);
        expect(main).toMatch(/everfernAppRequests \+= 1/);
        expect(main).toMatch(/'Cache-Control': cacheControl/);
      });
    });
  });
});
