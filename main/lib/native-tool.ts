/**
 * Runs one agent-tool operation in the Rust shell (`everfern --ef-<mode>`).
 *
 * The request goes in as JSON on stdin and the result comes back as JSON on stdout.
 * Resolves to null when not running under Tauri, or when the call fails in any way,
 * so callers keep their TypeScript path for Electron and as a fallback.
 */
import { execFile } from 'child_process';

export function hasNativeTools(): boolean {
  return process.env.EVERFERN_SHELL === 'tauri' && !!process.env.EF_NATIVE_EXE;
}

export function runNativeTool<T = any>(
  mode: string,
  request: unknown,
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<T | null> {
  const executable = hasNativeTools() ? process.env.EF_NATIVE_EXE! : '';
  if (!executable) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = execFile(executable, [mode], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    }, (error, output) => {
      if (error) return resolve(null);
      try {
        const result = JSON.parse(output);
        resolve(result === null || result === undefined ? null : result);
      } catch {
        resolve(null);
      }
    });
    child.stdin?.once('error', () => resolve(null));
    child.stdin?.end(JSON.stringify(request));
  });
}
