/**
 * Battery / leaks battery program (A1–A5) — MP-LEAK-01..12 + MP-SEC-07.
 *
 * Static/behavioral guards for the periodic-timer eliminations, quit-path
 * wiring, hardware detection caching, learning.json debounce, analytics
 * non-blocking record path, and idle-scoped uIOhook.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

const WITHOUT_COMMENTS = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('MP-LEAK-01 · integration timers stored + cleared', () => {
  it('admin-notification: no bare 5s setInterval poll; drain is event-driven', () => {
    const src = read('integrations/admin-notification.ts');
    expect(src).not.toMatch(/setInterval\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*?5000/);
    expect(src).toMatch(/scheduleDrain\(\)/);
    expect(src).toMatch(/retryTimers/);
    expect(src).toMatch(/stop\(\): void/);
  });

  it('user-permissions: both cleanup timers tracked and cleared in shutdown', () => {
    const src = read('integrations/user-permissions.ts');
    expect(src).toMatch(/cleanupTimers\.push\(setInterval/);
    expect(src.match(/cleanupTimers\.push\(setInterval/g)?.length).toBe(2);
    expect(src).toMatch(/for \(const t of this\.cleanupTimers\) clearInterval\(t\)/);
  });

  it('security-monitor + error-logger: cleanup timer stored; module stop exported', () => {
    const sm = read('integrations/security-monitor.ts');
    expect(sm).toMatch(/this\.cleanupTimer = setInterval/);
    expect(sm).toMatch(/stopGlobalSecurityMonitor/);

    const el = read('integrations/error-logger.ts');
    expect(el).toMatch(/this\.cleanupTimer = setInterval/);
    expect(el).toMatch(/stopGlobalErrorLogger/);
  });

  it('user-auth + identity-linking: timer stored + cleared in shutdown', () => {
    const ua = read('integrations/user-auth.ts');
    expect(ua).toMatch(/this\.cleanupTimer = setInterval/);
    expect(ua).toMatch(/clearInterval\(this\.cleanupTimer\)/);

    const il = read('integrations/identity-linking.ts');
    expect(il).toMatch(/this\.cleanupTimer = setInterval/);
    expect(il).toMatch(/clearInterval\(this\.cleanupTimer\)/);
  });
});

describe('MP-LEAK-02 · scheduler is timeout-driven, stopped on quit', () => {
  const src = read('integrations/scheduler-service.ts');

  it('no 60s poll; one-shot setTimeout to nearest due time', () => {
    expect(src).not.toMatch(/setInterval\(\(\) => this\.checkTasks\(\), 60000\)/);
    expect(src).toMatch(/setTimeout\(/);
    // `unref?.()` (optional-call) satisfies the "never keeps the process
    // alive" intent and is the defensive form used across the codebase.
    expect(src).toMatch(/unref\?\.\(\)|unref\(\)/);
    expect(src).toMatch(/computeWaitMs/);
  });

  it('no tasks ⇒ Infinity wait ⇒ no timer scheduled (zero wakeups)', () => {
    expect(src).toMatch(/Number\.isFinite\(waitMs\)/);
    expect(src).toMatch(/return Infinity/);
  });

  it('main.ts: schedulerService.stop() wired into before-quit', () => {
    const main = read('main.ts');
    expect(main).toMatch(/schedulerService\.stop\(\)/);
  });
});

describe('MP-LEAK-03 · tray before-quit registered once', () => {
  it('guard flag prevents duplicate app listeners across tray recreations', () => {
    const src = read('lib/system-tray-manager.ts');
    expect(src).toMatch(/systemTrayBeforeQuitRegistered/);
    expect(src).toMatch(/if \(!systemTrayBeforeQuitRegistered\)/);
  });
});

describe('MP-LEAK-04 · extension server terminates clients on stop', () => {
  it('stop() terminates wss.clients before close', () => {
    const src = read('lib/extension-server.ts');
    const stopIdx = src.indexOf('stop() {');
    const stopBody = src.slice(stopIdx, stopIdx + 900);
    expect(stopBody).toMatch(/terminate\(\)/);
    expect(stopBody.indexOf('terminate')).toBeLessThan(stopBody.indexOf('wss?.close()'));
  });
});

describe('MP-LEAK-05 · no sync fs on the attachment IPC path', () => {
  const src = read('ipc/system/window-fs-handlers.ts');

  it('open-file-picker uses fsp stat/copy/read', () => {
    expect(src).toMatch(/await fsp\.stat\(originalFilePath\)/);
    expect(src).toMatch(/await fsp\.copyFile\(/);
    expect(src).toMatch(/await fsp\.readFile\(newFilePath\)/);
    expect(src).not.toMatch(/fs\.statSync\(originalFilePath\)/);
    expect(src).not.toMatch(/fs\.copyFileSync\(originalFilePath\)/);
  });

  it('no sync open/read/close chunk read remains', () => {
    expect(src).not.toMatch(/fs\.openSync\(newFilePath/);
    expect(src).not.toMatch(/fs\.readSync\(/);
  });

  it('folder picker stat is async', () => {
    expect(src).toMatch(/await fsp\.stat\(folderPath\)/);
  });
});

describe('MP-LEAK-06 · cached async hardware detection', () => {
  const src = read('ipc/system/hardware-handlers.ts');

  it('TTL cache + in-flight promise memoization exist', () => {
    expect(src).toMatch(/HW_CACHE_TTL_MS/);
    expect(src).toMatch(/hwInFlight/);
  });

  it('sync system_profiler/wmic duplicate path removed', () => {
    const noComments = WITHOUT_COMMENTS(src);
    expect(noComments).not.toMatch(/execSync\('system_profiler/);
    expect(noComments).not.toMatch(/execSync\('wmic/);
    expect(noComments).not.toMatch(/execSync\('nvidia-smi/);
  });

  it('get-local-models reuses the cached async detector', () => {
    const idx = src.indexOf('system:get-local-models');
    const body = src.slice(idx, idx + 2000);
    expect(body).toMatch(/await detectHardwareSpecsAsync\(\)/);
  });
});

describe('MP-LEAK-07 · module-level interval + dev watcher tracked', () => {
  it('permission-notification exposes stop; interval unrefd', () => {
    const src = read('lib/permission-notification.ts');
    expect(src).toMatch(/stopPermissionNotificationCleanup/);
    // Optional-call form — same "never keeps the process alive" guarantee.
    expect(src).toMatch(/unref\?\.\(\)|unref\(\)/);
  });

  it('prompt-sync watch handle tracked + stopWatchingPrompts exported', () => {
    const src = read('lib/prompt-sync.ts');
    expect(src).toMatch(/promptsWatcher/);
    expect(src).toMatch(/stopWatchingPrompts/);
  });

  it('main.ts wires both stops into before-quit', () => {
    const main = read('main.ts');
    expect(main).toMatch(/stopPermissionNotificationCleanup/);
    expect(main).toMatch(/stopWatchingPrompts/);
  });
});

describe('MP-LEAK-08 · analytics never blocks recordUsage on network', () => {
  const src = read('store/analytics.ts');

  it('no import-time ensurePricingFresh kick-off', () => {
    const noComments = WITHOUT_COMMENTS(src);
    const tail = noComments.slice(noComments.lastIndexOf('}'));
    expect(noComments).not.toMatch(/^ensurePricingFresh\(\)\.catch/m);
  });

  it('background refresh by default; blocking only opt-in', () => {
    expect(src).toMatch(/options\?: \{ blocking\?: boolean \}/);
    expect(src).toMatch(/fetchOpenRouterPricing\(\)\.catch\(\(\) => \{ \}\)/);
  });

  it('recordUsage calls non-blocking ensure', () => {
    const idx = src.indexOf('export async function recordUsage');
    const body = src.slice(idx, idx + 2500);
    expect(body).toMatch(/await ensurePricingFresh\(\)/);
    expect(body).not.toMatch(/ensurePricingFresh\(\{ blocking: true \}\)/);
  });

  it('main.ts warms pricing off the ready path', () => {
    const main = read('main.ts');
    expect(main).toMatch(/warmUpPricingCache/);
    expect(main).toMatch(/setImmediate\(\(\) => warmUpPricingCache\(\)\)/);
  });
});

describe('MP-LEAK-09 · fallback-show timer cancelled on closed', () => {
  it('clearTimeout(showFallback) present in closed handler', () => {
    const src = read('main.ts');
    const closedIdx = src.indexOf("mainWindow.on('closed'");
    const body = src.slice(closedIdx, closedIdx + 600);
    expect(body).toMatch(/clearTimeout\(showFallback\)/);
  });
});

describe('MP-LEAK-10 · GPU cache wipe crash-flag gated + async', () => {
  const src = read('main.ts');

  it('wipe only when previous session crashed', () => {
    expect(src).toMatch(/session-crash-flag/);
    expect(src).toMatch(/if \(previousSessionCrashed\)/);
  });

  it('wipe is async (no rmSync at module load)', () => {
    const idx = src.indexOf('if (previousSessionCrashed)');
    const body = src.slice(idx, idx + 1200);
    expect(body).toMatch(/async \(\)/);
    expect(body).not.toMatch(/rmSync/);
  });

  it('crash flag cleared on clean shutdown', () => {
    expect(src).toMatch(/rmSync\(path\.join\(app\.getPath\('userData'\), 'session-crash-flag'\)/);
  });
});

describe('MP-LEAK-11 · learning.json debounce + cap', () => {
  const src = read('store/memory-manager.ts');

  it('debounced, capped, with flush for quit path', () => {
    expect(src).toMatch(/PERSIST_DEBOUNCE_MS/);
    expect(src).toMatch(/MAX_ENTRIES/);
    expect(src).toMatch(/capLearningData/);
    expect(src).toMatch(/schedulePersist/);
    expect(src).toMatch(/async flush\(\)/);
  });

  it('storeLearning no longer awaits a full rewrite', () => {
    const idx = src.indexOf('async storeLearning');
    const body = src.slice(idx, idx + 600);
    expect(body).toMatch(/this\.schedulePersist\(\)/);
    expect(body).not.toMatch(/await this\.persistLearningData\(\)/);
  });

  it('main.ts flushes learning data on quit', () => {
    const main = read('main.ts');
    expect(main).toMatch(/learningMemoryManager\.flush/);
  });
});

describe('MP-LEAK-12 · usage_events 180d retention', () => {
  it('db init prunes old usage_events (fire-and-forget)', () => {
    const src = read('lib/db.ts');
    expect(src).toMatch(/DELETE FROM usage_events WHERE created_at < datetime\('now', '-180 days'\)/);
    expect(src).toMatch(/void dbOps\.run\(/);
  });
});

describe('MP-SEC-07 · idle-scoped uIOhook', () => {
  const src = read('voice-overlay.ts');

  it('constructor no longer starts the OS-global hook', () => {
    const ctor = src.slice(src.indexOf('constructor()'), src.indexOf('private setupIpc'));
    expect(ctor).not.toMatch(/this\.setupHook\(\)/);
    // Constructor body itself must not start the hook (startHook is called
    // lazily from noteVoiceActivity, which the constructor never invokes).
    const ctorEnd = src.indexOf('}', src.indexOf('this.setupIpc();'));
    expect(src.slice(src.indexOf('constructor()'), ctorEnd)).not.toMatch(/uIOhook\.start\(\)/);
  });

  it('hook arms lazily on voice activity and auto-stops after idle', () => {
    expect(src).toMatch(/noteVoiceActivity\(\)/);
    expect(src).toMatch(/IDLE_STOP_DELAY_MS/);
    expect(src).toMatch(/this\.stopHook\(\)/);
  });

  it("'set-state' non-idle arms the hook; idle does not", () => {
    const idx = src.indexOf("ipcMain.on('voice-overlay:set-state'");
    const body = src.slice(idx, idx + 1500);
    expect(body).toMatch(/if \(stateStr !== 'idle'\) \{\s*this\.noteVoiceActivity\(\)/);
  });

  it('manager exposes shutdown() for the quit path', () => {
    expect(src).toMatch(/shutdown\(\): void/);
    const main = read('main.ts');
    // MP-LIFE-03: quit path must shut down the lazily-created overlay WITHOUT
    // constructing one (shutdownVoiceOverlayIfCreated, not a bare
    // getVoiceOverlayManager().shutdown() call).
    expect(main).toMatch(/shutdownVoiceOverlayIfCreated\(\)/);
    expect(main).not.toMatch(/voiceOverlayManager\s*=\s*new\s+VoiceOverlayManager/);
  });
});
