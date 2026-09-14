/**
 * Static contract test for CU-LEAK-01: all `acp` stream-event on* APIs in
 * preload/preload.ts must be single-slot — i.e. their implementation must
 * call ipcRenderer.removeAllListeners('<channel>') BEFORE
 * ipcRenderer.on('<channel>', ...) so repeated registration (page.tsx
 * registers per send and again in its mount effect) never stacks handlers.
 *
 * Source-reading convention (DOM-free node env), same as
 * main/__tests__/hitl-preload-contract.test.ts: read preload/preload.ts via
 * fs.readFileSync and assert on the source text.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PRELOAD_PATH = path.join(__dirname, '..', '..', 'preload', 'preload.ts');
const source: string = fs.readFileSync(PRELOAD_PATH, 'utf-8');

/** Every acp on* stream-event API that must be single-slot. */
const SINGLE_SLOT_APIS: Array<{ api: string; channel: string }> = [
  { api: 'onStreamChunk', channel: 'acp:stream-chunk' },
  { api: 'onThought', channel: 'acp:thought' },
  { api: 'onModelCallInfo', channel: 'acp:model-call-info' },
  { api: 'onToolStart', channel: 'acp:tool-start' },
  { api: 'onToolCall', channel: 'acp:tool-call' },
  { api: 'onToolUpdate', channel: 'acp:tool-update' },
  { api: 'onOptima', channel: 'acp:optima' },
  { api: 'onShowArtifact', channel: 'acp:show-artifact' },
  { api: 'onShowPlan', channel: 'acp:show-plan' },
  { api: 'onViewSkill', channel: 'acp:view-skill' },
  { api: 'onSkillDetected', channel: 'acp:skill-detected' },
  { api: 'onSurfaceAction', channel: 'acp:surface-action' },
  { api: 'onUsage', channel: 'acp:usage' },
  { api: 'onAgentPermissionRequest', channel: 'agent:permission-request' },
  { api: 'onPlanCreated', channel: 'acp:plan-created' },
  { api: 'onToolCallStart', channel: 'acp:tool-call-start' },
  { api: 'onToolCallChunk', channel: 'acp:tool-call-chunk' },
  { api: 'onToolCallComplete', channel: 'acp:tool-call-complete' },
];

/** Extracts the implementation block of an acp on* API from the source. */
function extractApiBlock(src: string, api: string): string {
  const startMarker = `${api}: (`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`API ${api} not found in ${PRELOAD_PATH}`);
  const end = src.indexOf('\n    },', start);
  if (end === -1) throw new Error(`Block for ${api} is not closed as expected`);
  return src.slice(start, end);
}

describe('CU-LEAK-01: acp stream-event on* APIs are single-slot', () => {
  for (const { api, channel } of SINGLE_SLOT_APIS) {
    it(`${api} removes all '${channel}' listeners before registering`, () => {
      const block = extractApiBlock(source, api);

      const removeCall = `ipcRenderer.removeAllListeners('${channel}')`;
      const onCall = `ipcRenderer.on('${channel}'`;

      const removeIdx = block.indexOf(removeCall);
      const onIdx = block.indexOf(onCall);

      expect(
        removeIdx,
        `${api} must call ${removeCall} (block was:\n${block})`
      ).toBeGreaterThanOrEqual(0);
      expect(
        onIdx,
        `${api} must call ${onCall} (block was:\n${block})`
      ).toBeGreaterThanOrEqual(0);
      expect(
        removeIdx,
        `${api} must removeAllListeners('${channel}') BEFORE .on('${channel}') (block was:\n${block})`
      ).toBeLessThan(onIdx);
    });
  }
});

describe('CU-LEAK-04 remnant: removeHitlResponseProcessedListener exists', () => {
  it('is implemented right after onHitlResponseProcessed', () => {
    const block = extractApiBlock(source, 'removeHitlResponseProcessedListener');
    expect(block).toContain(
      "ipcRenderer.removeAllListeners('acp:hitl-response-processed')"
    );
  });

  it('is declared in the ElectronAPI type', () => {
    expect(source).toContain('removeHitlResponseProcessedListener: () => void;');
  });
});
