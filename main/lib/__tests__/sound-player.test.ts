/**
 * MP-XPLAT-01 · sound-player platform matrix.
 *
 * win32/darwin/linux behavior via deps injection: fake execFileFn captures
 * calls and drives callbacks synchronously. Verifies the apostrophe escaping,
 * the ERROR CALLBACK (missing afplay/powershell must resolve false — no
 * uncaught 'error' event crash), and the linux probe order/cache
 * (paplay → aplay → ffplay → canberra-gtk-play).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import {
  playSoundFile,
  probeLinuxSoundPlayer,
  resetSoundPlayerCacheForTests,
} from '../sound-player';

type ExecCall = { cmd: string | any[]; args: any[]; opts?: any; cb?: (err: any, stdout?: any, stderr?: any) => void };

function makeFakeExec(behavior: (call: ExecCall) => void) {
  const calls: ExecCall[] = [];
  const fn = ((cmd: any, args: any, opts?: any, cb?: any) => {
    // Normalize: (cmd, args, cb) and (cmd, args, opts, cb) both occur.
    if (typeof opts === 'function') {
      cb = opts;
      opts = undefined;
    }
    const call: ExecCall = { cmd, args, opts, cb };
    calls.push(call);
    behavior(call);
  }) as any;
  fn.calls = calls;
  return fn;
}

const ok = (call: ExecCall) => call.cb?.(null, '', '');
const fail = (call: ExecCall) => call.cb?.(new Error('spawn ENOENT'));

describe('sound-player · win32 (MP-XPLAT-01)', () => {
  it('launches powershell.exe with escaped path (apostrophes doubled) and an error callback attached', async () => {
    const exec = makeFakeExec(ok);
    // Path with an apostrophe — must double to '' inside the single-quoted
    // PowerShell string literal.
    const result = await playSoundFile("C:\\Users\\O'Brien\\sounds\\ding.wav", {
      platform: 'win32',
      execFileFn: exec,
    });

    expect(result).toBe(true);
    expect(exec.calls).toHaveLength(1);
    const call = exec.calls[0];
    expect(call.cmd).toBe('powershell.exe');
    expect(call.args[0]).toBe('-Command');
    expect(call.args[1]).toContain("C:\\Users\\O'Brien\\sounds\\ding.wav".replace(/'/g, "''"));
    expect(call.args[1]).toContain('SoundPlayer');
    expect(call.cb).toBeTypeOf('function'); // error callback attached
  });

  it('resolves false (no uncaught exception) when powershell spawn errors', async () => {
    const exec = makeFakeExec(fail);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playSoundFile('C:\\snd\\a.wav', { platform: 'win32', execFileFn: exec });
    expect(result).toBe(false);
    warn.mockRestore();
  });
});

describe('sound-player · darwin (MP-XPLAT-01)', () => {
  it('launches afplay with the sound path', async () => {
    const exec = makeFakeExec(ok);
    const result = await playSoundFile('/tmp/sounds/ding.wav', { platform: 'darwin', execFileFn: exec });

    expect(result).toBe(true);
    expect(exec.calls[0].cmd).toBe('afplay');
    expect(exec.calls[0].args).toEqual(['/tmp/sounds/ding.wav']);
  });

  it('missing afplay → resolves false, error callback logs (no uncaught crash)', async () => {
    const exec = makeFakeExec(fail);
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playSoundFile('/tmp/sounds/ding.wav', { platform: 'darwin', execFileFn: exec });

    expect(result).toBe(false);
    expect(errLog).toHaveBeenCalledWith('[Audio] playback failed:', expect.any(String));
    errLog.mockRestore();
  });
});

describe('sound-player · linux (MP-XPLAT-01 probe + cache)', () => {
  beforeEach(() => resetSoundPlayerCacheForTests());

  it('probes candidates IN ORDER (paplay→aplay→ffplay→canberra-gtk-play) when cache empty; plays via first hit', async () => {
    // paplay + aplay missing; ffplay present.
    const exec = makeFakeExec((call) => {
      const c = call.cmd as string;
      if (c === 'sh') {
        const probed = call.args[1] as string; // "command -v <bin>"
        const bin = probed.replace('command -v ', '');
        if (bin === 'ffplay') ok(call);
        else fail(call);
      } else if (c === 'ffplay') {
        ok(call);
      } else {
        fail(call);
      }
    });

    const result = await playSoundFile('/tmp/snd.wav', { platform: 'linux', execFileFn: exec });

    expect(result).toBe(true);
    const probed = exec.calls
      .filter((c) => c.cmd === 'sh')
      .map((c) => (c.args[1] as string).replace('command -v ', ''));
    expect(probed).toEqual(['paplay', 'aplay', 'ffplay']); // stops at first hit, in order
    const players = exec.calls.filter((c) => c.cmd !== 'sh').map((c) => c.cmd);
    expect(players).toEqual(['ffplay']);
  });

  it('cached player → second call does NOT re-probe', async () => {
    let probes = 0;
    const exec = makeFakeExec((call) => {
      if (call.cmd === 'sh') {
        probes++;
        ok(call); // first candidate (paplay) always "exists"
      } else {
        ok(call);
      }
    });

    await playSoundFile('/tmp/a.wav', { platform: 'linux', execFileFn: exec });
    const probesAfterFirst = probes;
    await playSoundFile('/tmp/b.wav', { platform: 'linux', execFileFn: exec });

    expect(probesAfterFirst).toBe(1);
    expect(probes).toBe(1); // no re-probe
    expect(exec.calls.filter((c) => c.cmd === 'paplay')).toHaveLength(2);
  });

  it('all players missing → false + warn, no throw', async () => {
    const exec = makeFakeExec(fail);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await playSoundFile('/tmp/a.wav', { platform: 'linux', execFileFn: exec });

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[Audio] No audio player found (paplay/aplay/ffplay/canberra-gtk-play) — skipping sound'
    );
    // 'none' result is also cached — a second call skips probing entirely.
    const callsBefore = exec.calls.length;
    await playSoundFile('/tmp/a.wav', { platform: 'linux', execFileFn: exec });
    expect(exec.calls.length).toBe(callsBefore);
    warn.mockRestore();
  });

  it('probeLinuxSoundPlayer returns first available candidate and caches it', async () => {
    const exec = makeFakeExec((call) => {
      const bin = (call.args[1] as string).replace('command -v ', '');
      if (bin === 'aplay') ok(call);
      else fail(call);
    });

    const first = await probeLinuxSoundPlayer(exec as any);
    expect(first).toBe('aplay');
    // Cached: subsequent probe short-circuits without exec calls.
    const callsBefore = exec.calls.length;
    const second = await probeLinuxSoundPlayer(exec as any);
    expect(second).toBe('aplay');
    expect(exec.calls.length).toBe(callsBefore);
  });
});

describe('sound-player · default deps (sanity)', () => {
  beforeEach(() => resetSoundPlayerCacheForTests());
  afterEach(() => resetSoundPlayerCacheForTests());

  it('defaults to the real child_process execFile and process.platform on a harmless call path', async () => {
    // darwin test host: afplay exists on macOS, so this launches a real
    // (fire-and-forget, error-callback-attached) player on a fake path —
    // safe: afplay merely fails with a logged error, resolving false.
    if (process.platform !== 'darwin') return; // platform-matrix default case
    const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playSoundFile('/nonexistent/everfern-test-sound.wav');
    expect(typeof result).toBe('boolean');
    errLog.mockRestore();
  });
});
