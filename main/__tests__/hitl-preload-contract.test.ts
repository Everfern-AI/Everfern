/**
 * Static contract test for preload/preload.ts stream cleanup.
 *
 * Regression lock: removeStreamListeners() must NOT tear down the
 * 'acp:hitl-request' listener. The chat page registers that listener once at
 * mount and relies on it surviving mid-stream resets; a blanket
 * removeAllListeners('acp:hitl-request') inside removeStreamListeners kills
 * HITL permission cards after the first send/reset cycle.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Same source-reading convention as preload/__tests__/preload-api-structure.test.ts:
// resolve relative to this spec file rather than process.cwd().
const PRELOAD_PATH = path.join(__dirname, '..', '..', 'preload', 'preload.ts');
const source: string = fs.readFileSync(PRELOAD_PATH, 'utf-8');

/** Extracts the body of the first removeStreamListeners implementation. */
function extractRemoveStreamListenersBlock(src: string): string {
  const startMarker = 'removeStreamListeners: () => {';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`removeStreamListeners impl not found in ${PRELOAD_PATH}`);
  const end = src.indexOf('\n    },', start);
  if (end === -1) throw new Error('removeStreamListeners block is not closed as expected');
  return src.slice(start, end);
}

describe('preload removeStreamListeners contract', () => {
  const block = extractRemoveStreamListenersBlock(source);

  it("does NOT removeAllListeners('acp:hitl-request') inside removeStreamListeners", () => {
    expect(block).not.toContain("removeAllListeners('acp:hitl-request')");
  });

  it("still removes the actual stream channels (block extraction is sound)", () => {
    expect(block).toContain("removeAllListeners('acp:stream-chunk')");
    expect(block).toContain("removeAllListeners('acp:thought')");
    expect(block).toContain("removeAllListeners('acp:tool-call-complete')");
    expect(block).toContain('acp:hitl-request is intentionally NOT removed');
  });

  it("the file still registers 'acp:hitl-request' elsewhere (right file under test)", () => {
    expect(source).toContain("ipcRenderer.on('acp:hitl-request'");
  });
});
