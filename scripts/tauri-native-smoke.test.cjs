// Run after npm run build:electron-ts and cargo build.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const executable = path.resolve(__dirname, '../src-tauri/target/debug/everfern.exe');

test('native encryption helper round-trips secrets over pipes', { skip: process.platform !== 'win32' }, () => {
  const encrypted = execFileSync(executable, ['--ef-encrypt'], { input: 'private-cookie', windowsHide: true });
  assert.ok(!encrypted.includes(Buffer.from('private-cookie')));
  assert.equal(execFileSync(executable, ['--ef-decrypt'], { input: encrypted, windowsHide: true }).toString(), 'private-cookie');
});

test('Rust provider transport streams, cancels and reports interrupted bodies', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/upload') {
      const parts = [];
      req.on('data', part => parts.push(part));
      req.on('end', () => { res.end(Buffer.concat(parts).toString('hex')); });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    if (req.url === '/broken') {
      res.setHeader('Content-Length', '10000');
      res.write('data: first\n\n');
      setTimeout(() => res.destroy(), 40);
      return;
    }
    if (req.url === '/wait') {
      res.write('data: first\n\n');
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer test-only');
    res.write('data: one\n\n');
    setTimeout(() => res.end('data: [DONE]\n\n'), 40);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const previous = { shell: process.env.EVERFERN_SHELL, exe: process.env.EF_NATIVE_EXE };
  process.env.EVERFERN_SHELL = 'tauri';
  process.env.EF_NATIVE_EXE = executable;
  const { nativeFetch } = require('../dist-electron/main/lib/native-fetch.js');
  try {
    const response = await nativeFetch(url, { headers: { Authorization: 'Bearer test-only' } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'data: one\n\ndata: [DONE]\n\n');
    const upload = await nativeFetch(url + '/upload', { method: 'POST', body: new Uint8Array([0, 255, 66, 128]) });
    assert.equal(await upload.text(), '00ff4280');
    await assert.rejects(async () => (await nativeFetch(url + '/broken')).text());
    const controller = new AbortController();
    const waiting = await nativeFetch(url + '/wait', { signal: controller.signal });
    const reading = waiting.text();
    controller.abort();
    await assert.rejects(reading);
  } finally {
    if (previous.shell === undefined) delete process.env.EVERFERN_SHELL; else process.env.EVERFERN_SHELL = previous.shell;
    if (previous.exe === undefined) delete process.env.EF_NATIVE_EXE; else process.env.EF_NATIVE_EXE = previous.exe;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
