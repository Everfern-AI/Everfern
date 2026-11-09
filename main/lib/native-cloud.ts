import { spawnNative } from './native-process';

/** Pipe credentials to the native Rust transport, never command-line arguments. */
export function nativeCloudRequest(path: string, token: string, body: unknown): Promise<{ status: number; ok: boolean; data: any }> {
  const persistent = (globalThis as any).__efNativeCloudRequest;
  if (typeof persistent === 'function') return persistent(path, token, body);
  const executable = process.env.EF_NATIVE_EXE;
  if (!executable) return Promise.reject(new Error('Native cloud transport unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawnNative(executable, ['--ef-cloud-request']);
    const parts: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cloud request timed out')); }, 155_000);
    child.stdout.on('data', (part: Buffer) => {
      size += part.length;
      if (size > 40 * 1024 * 1024) { child.kill(); reject(new Error('Cloud response too large')); }
      else parts.push(part);
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', () => { /* Process exit reports failed requests. */ });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Native cloud request failed'));
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ path, method: 'POST', token, body }));
  });
}
