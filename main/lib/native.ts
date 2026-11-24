/**
 * Loader for the Rust native module (apps/desktop/native, built with napi-rs).
 *
 * Every export here has a TypeScript twin; callers use the twin's API and this
 * module only swaps the implementation. If the binary is missing (unsupported
 * platform, not built yet) or EVERFERN_DISABLE_NATIVE=1, getNative() returns
 * null and callers keep using the JS path.
 */
import * as path from 'path';

export interface NativeSnapshotDiff {
  text: string;
  added: number;
  removed: number;
  changed: boolean;
}

export interface EverfernNative {
  diffSnapshots(before: string, after: string, contextRadius?: number): NativeSnapshotDiff;
  listProjectFiles(root: string): Promise<string[]>;
}

let cached: EverfernNative | null | undefined;

export function getNative(): EverfernNative | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.env.EVERFERN_DISABLE_NATIVE === '1') return cached;

  const file = `everfern-native.${process.platform}-${process.arch}.node`;
  const candidates = [
    // dist-electron/main/lib -> app root (dev, and inside app.asar when packaged)
    path.join(__dirname, '..', '..', '..', 'native', 'bin', file),
    (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, 'app.asar.unpacked', 'native', 'bin', file)
      : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      cached = require(candidate) as EverfernNative;
      return cached;
    } catch {
      /* try next */
    }
  }
  console.warn(`[Native] ${file} not found; using JS fallbacks.`);
  return cached;
}
