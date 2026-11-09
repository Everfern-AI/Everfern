import { spawnNative } from './native-process';

/** Fetch-compatible provider streaming through the Rust transport. */
export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (process.env.EVERFERN_SHELL !== 'tauri' || !process.env.EF_NATIVE_EXE) return fetch(input, init);
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const bodyBase64 = request.method === 'GET' || request.method === 'HEAD' ? null : Buffer.from(await request.arrayBuffer()).toString('base64');
  return new Promise<Response>((resolve, reject) => {
    const child = spawnNative(process.env.EF_NATIVE_EXE!, ['--ef-http']);
    let header = Buffer.alloc(0);
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let started = false;
    let failed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      pull() { child.stdout.resume(); },
      cancel() { failed = true; child.kill(); },
    });
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      child.kill();
      if (started) controller.error(error); else reject(error);
    };
    const abort = () => fail(request.signal.reason || new Error('Request aborted'));
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    child.on('error', fail);
    child.stdin.on('error', () => { /* Exit handler reports pipe failure. */ });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed) return;
      if (!started) {
        header = Buffer.concat([header, chunk]);
        const end = header.indexOf(10);
        if (end < 0) {
          if (header.length > 64 * 1024) fail(new Error('Invalid native response header'));
          return;
        }
        try {
          const info = JSON.parse(header.subarray(0, end).toString('utf8'));
          started = true;
          resolve(new Response([204, 205, 304].includes(info.status) || request.method === 'HEAD' ? null : stream, { status: info.status, headers: info.headers }));
          chunk = header.subarray(end + 1);
          header = Buffer.alloc(0);
        } catch (error) { fail(error); return; }
      }
      if (chunk.length) controller.enqueue(chunk);
      if ((controller.desiredSize || 0) <= 0) child.stdout.pause();
    });
    child.on('close', (code) => {
      request.signal.removeEventListener('abort', abort);
      if (failed) return;
      if (code !== 0 || !started) { fail(new Error('Native provider stream interrupted')); return; }
      controller.close();
    });
    child.stdin.end(JSON.stringify({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), bodyBase64 }));
  });
}
