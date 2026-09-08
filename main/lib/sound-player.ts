/**
 * Sound playback — extracted from the main.ts `audio:play-sound` IPC handler
 * (MP-XPLAT-01). Cross-platform, error-safe sound playback:
 *
 *   - win32:  PowerShell SoundPlayer (single-quote '' escaping)
 *   - darwin: afplay
 *   - linux:  probed players (paplay → aplay → ffplay → canberra-gtk-play)
 *
 * Every execFile call carries an error callback so a missing player logs
 * instead of crashing the main process with an unhandled 'error' event.
 * Dependencies (execFile, platform) are injectable for unit tests.
 */

import { execFile } from 'child_process';

/**
 * Injectable dependencies so tests can fake the platform and the process
 * launcher without touching the real child_process module.
 */
interface SoundPlayerDeps {
  execFileFn?: typeof execFile;
  platform?: NodeJS.Platform;
}

// Linux player probe cache: undefined = not probed yet, null = probed and
// none of the candidates exist on this system, string = first working player.
let cachedLinuxPlayer: string | null | undefined;

/** Test-only hook: clears the Linux player probe cache between test cases. */
export function resetSoundPlayerCacheForTests(): void {
  cachedLinuxPlayer = undefined;
}

/** Liveness check for a binary — resolves false instead of rejecting. */
function commandExists(bin: string, execFileFn: typeof execFile): Promise<boolean> {
  return new Promise((resolve) => {
    execFileFn('sh', ['-c', `command -v ${bin}`], (err: any) => {
      // `command -v` exits non-zero when the binary is absent — treat that
      // as "not found" rather than an error, so probing never rejects.
      resolve(!err);
    });
  });
}

/**
 * Linux coverage gap fix (MP-XPLAT-01): pure-ALSA / bare-WM systems lack
 * paplay. Probe in order paplay → aplay → ffplay → canberra-gtk-play and
 * cache the first hit (or the 'none' result) for the process lifetime.
 */
export async function probeLinuxSoundPlayer(execFileFn: typeof execFile = execFile): Promise<string | null> {
  if (cachedLinuxPlayer !== undefined) return cachedLinuxPlayer;

  const candidates = ['paplay', 'aplay', 'ffplay', 'canberra-gtk-play'];
  for (const bin of candidates) {
    // Probe strictly in order so the same player is chosen deterministically
    // across calls; the loop short-circuits at the first usable binary.
    if (await commandExists(bin, execFileFn)) {
      cachedLinuxPlayer = bin;
      return bin;
    }
  }

  cachedLinuxPlayer = null;
  return null;
}

/**
 * Fire-and-forget playback WITH an attached error callback (missing afplay /
 * powershell / linux player logs '[Audio] playback failed' instead of
 * crashing). Resolves true when a player was launched, false when there is no
 * player to run or the spawn itself fails.
 *
 * Implemented with plain execFile (no native audio deps, no shell strings) —
 * each platform picks a stock system player: powershell.exe SoundPlayer on
 * Windows, afplay on macOS, and the cached probed player on Linux.
 *
 * @param soundFilePath Absolute path to the sound file to play.
 * @param deps Injectable execFile + platform overrides (used by unit tests).
 * @returns Promise resolving true if a player process launched successfully,
 *          false on any failure (logged, never thrown). Sound is always
 *          best-effort: failure is a silent-for-the-user no-op beyond the log.
 */
export function playSoundFile(soundFilePath: string, deps: SoundPlayerDeps = {}): Promise<boolean> {
  // Real process/platform defaults keep production behavior unchanged.
  const platform = deps.platform ?? process.platform;
  const execFileFn = deps.execFileFn ?? execFile;

  return new Promise<boolean>((resolve) => {
    const launched = (err: any) => {
      if (err) {
        console.error('[Audio] playback failed:', err?.message || err);
        resolve(false);
      } else {
        resolve(true);
      }
    };

    if (platform === 'win32') {
      // Windows: PowerShell SoundPlayer. Install/user dirs may contain
      // apostrophes — PowerShell single-quote escaping doubles them ('').
      const escaped = soundFilePath.replace(/'/g, "''");
      execFileFn(
        'powershell.exe',
        ['-Command', `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`],
        { maxBuffer: 10 * 1024 * 1024 },
        launched
      );
    } else if (platform === 'darwin') {
      // macOS: afplay
      execFileFn('afplay', [soundFilePath], launched);
    } else {
      // Linux: probe once, then play via the cached player.
      probeLinuxSoundPlayer(execFileFn)
        .then((player) => {
          if (!player) {
            // Negative result is cached too, so every later call skips
            // straight to this warn without re-probing.
            console.warn('[Audio] No audio player found (paplay/aplay/ffplay/canberra-gtk-play) — skipping sound');
            resolve(false);
            return;
          }
          execFileFn(player, [soundFilePath], launched);
        })
        .catch(() => resolve(false));
    }
  });
}
