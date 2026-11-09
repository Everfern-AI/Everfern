const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

test('both updater feeds identify the same installer bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-feed-'));
  try {
    const installer = path.join(dir, 'setup.exe');
    const signature = path.join(dir, 'setup.exe.sig');
    fs.writeFileSync(installer, 'test installer');
    fs.writeFileSync(signature, 'test-signature');
    execFileSync(process.execPath, [path.join(__dirname, 'tauri-release-manifests.cjs'), '2.0.0', installer, 'https://example.com/setup.exe', signature, dir]);
    const legacy = fs.readFileSync(path.join(dir, 'tauri-transition.yml'), 'utf8');
    assert.ok(!fs.existsSync(path.join(dir, 'latest.yml')));
    const native = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
    assert.equal(native.version, '2.0.0');
    assert.equal(native.platforms['windows-x86_64'].signature, 'test-signature');
    assert.ok(legacy.includes(crypto.createHash('sha512').update('test installer').digest('base64')));
    assert.ok(legacy.includes(native.platforms['windows-x86_64'].url));
    assert.ok(!legacy.includes('blockMapSize'));
    assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'tauri-release-manifests.cjs'), '2.0.0', installer, 'http://example.com/setup.exe', signature, dir], { stdio: 'pipe' }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
