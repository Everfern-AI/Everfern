/**
 * AG-MEM teardown wiring — source-scan regression test (battery-leaks style).
 *
 * AG-MEM-07: per-conversation / per-subagent event emitters must be removed at
 * stream end so long-running processes don't accumulate one emitter per
 * conversation / per spawn.
 * AG-MEM-02: per-conversation computer-use overlay windows must be destroyed
 * at conversation end so long app sessions don't accumulate live overlays.
 *
 * Static scans over runner.ts and subagent-spawn.ts, robust to reformatting:
 * the outer finally block is sliced out of the source text rather than
 * matched by line number.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf-8');

/** Slice the outer finally of runStream out of runner.ts source. */
function outerFinallyBody(): string {
  const src = read('../runner.ts');
  const startMatch = src.match(/\/\/ Ensure the final state of the assistant message and timeline is persisted on errors\/aborts/);
  expect(startMatch, 'runner.ts runStream outer finally marker must exist').not.toBeNull();
  // Slice from the marker to the end of the class (runStream outer finally is
  // the last block in the method; the class closes right after releaseLock()).
  const start = startMatch!.index!;
  const end = src.indexOf('function reconstructFullHistory', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Slice the runSubagent finally block out of subagent-spawn.ts source. */
function subagentFinallyBody(): string {
  const src = read('../subagent-spawn.ts');
  const startMatch = src.match(/finally \{\s*\r?\n\s*this\.releaseSlot\(\);/);
  expect(startMatch, 'subagent-spawn.ts runSubagent finally block must exist').not.toBeNull();
  const start = startMatch!.index!;
  const end = src.indexOf('async spawnMultiple', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('AG-MEM-07/02 · runner.ts outer finally teardown wiring', () => {
  const body = outerFinallyBody();

  it('AG-MEM-07: removes the session emitter, gated on !hasPendingHitl', () => {
    expect(body).toMatch(/removeAgentEvents/);
    expect(body).toMatch(/if \(!hasPendingHitl\)/);
    // Gated removal: removeAgentEvents must appear after the hasPendingHitl gate.
    const gateIdx = body.indexOf('if (!hasPendingHitl)');
    const removeIdx = body.indexOf('removeAgentEvents');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(gateIdx);
    // Removes the session-keyed emitter (session:${convId}), not the bare convId one.
    expect(body).toMatch(/removeAgentEvents\(`session:\$\{convId\}`\)/);
  });

  it('AG-MEM-07: hasPendingHitl is hoisted so the gate can read it', () => {
    const src = read('../runner.ts');
    expect(src).toMatch(/let hasPendingHitl = false;/);
    expect(src).toMatch(/hasPendingHitl = records\.some\(r => r\.status === 'pending'\)/);
  });

  it('AG-MEM-02: destroys computer-use overlays (and capture singleton) at conversation end', () => {
    expect(body).toMatch(/destroyAllComputerUseOverlays|shutdownComputerUseCapture/);
    // Safe combination: both must be wired (destroyAll reaps per-conversation
    // overlays; shutdown nulls the singleton so its getter recreates lazily).
    expect(body).toMatch(/destroyAllComputerUseOverlays/);
    expect(body).toMatch(/shutdownComputerUseCapture/);
  });

  it('teardown runs after HITL check, before session lock release', () => {
    const hitlIdx = body.indexOf('listHitlRecords');
    const removeIdx = body.indexOf('removeAgentEvents');
    const lockIdx = body.indexOf('AgentRunner.sessionLocks.delete(convId)');
    expect(hitlIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(hitlIdx);
    expect(removeIdx).toBeLessThan(lockIdx);
  });
});

describe('AG-MEM-07 · subagent-spawn.ts runSubagent finally emitter release', () => {
  const body = subagentFinallyBody();

  it('removes the per-subagent emitter after unsubscribe()', () => {
    expect(body).toMatch(/removeAgentEvents\(agent\.sessionKey\)/);
    const unsubIdx = body.indexOf('unsubscribe()');
    const removeIdx = body.indexOf('removeAgentEvents');
    expect(unsubIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(unsubIdx);
  });

  it('keeps the parent conversation emitter (parentSessionKey never removed)', () => {
    expect(body).not.toMatch(/removeAgentEvents\(agent\.parentSessionId\)/);
    expect(body).not.toMatch(/removeAgentEvents\(agent\.parentSessionKey\)/);
  });

  it('runner.ts does not remove the bare-convId emitter in the outer finally', () => {
    // The runner's swarm-progress listener uses the bare convId emitter key
    // (subagent parents register with parentSessionId = convId). Removing
    // only the session:-prefixed emitter is the conservative choice; the
    // bare one is reaped by clearAllAgentEvents on quit.
    const body = outerFinallyBody();
    expect(body).not.toMatch(/removeAgentEvents\(convId\)/);
    expect(body).not.toMatch(/removeAgentEvents\(`\$\{convId\}`\)/);
  });
});
