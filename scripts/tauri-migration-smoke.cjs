// Run with Electron: verifies export using Electron's real OS encryption.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-migration-'));
app.setPath('userData', temporary);
app.getAppPath = () => root;
const handlers = new Map();
ipcMain.handle = (channel, handler) => handlers.set(channel, handler);

app.whenReady().then(async () => {
  assert.ok(safeStorage.isEncryptionAvailable());
  const clone = JSON.stringify({ id: 'a'.repeat(64), data: 'test-cookie-clone', kind: 'cookies' });
  fs.mkdirSync(path.join(temporary, 'cloud-browser'));
  fs.mkdirSync(path.join(temporary, 'vm'));
  const original = safeStorage.encryptString(clone);
  fs.writeFileSync(path.join(temporary, 'cloud-browser/account.bb.worker.app.chrome.bin'), original);
  fs.writeFileSync(path.join(temporary, 'vm/browser-cookies.bin'), safeStorage.encryptString('local-cookie-clone'));
  require('../dist-electron/main/ipc/system/migration-handlers.js').registerMigrationHandlers();
  const exportData = handlers.get('system:export-tauri-migration');
  const storage = { everfern_cloud_session: '{"accessToken":"test-only"}', everfern_theme: 'dark' };
  assert.equal(exportData({ senderFrame: { url: 'https://untrusted.example/' } }, storage).success, false);
  assert.equal(exportData({ senderFrame: { url: 'everfern-app://index.html' } }, storage).success, true);
  const decrypt = file => {
    const bytes = fs.readFileSync(path.join(temporary, file));
    assert.equal(bytes.subarray(0, 8).toString(), 'EFDPAPI1');
    return execFileSync(path.join(root, 'src-tauri/target/debug/everfern.exe'), ['--ef-decrypt'], { input: bytes.subarray(8), windowsHide: true }).toString();
  };
  assert.deepEqual(JSON.parse(decrypt('renderer-migration.native')), storage);
  assert.equal(decrypt('cloud-browser/account.bb.worker.app.chrome.native'), clone);
  assert.equal(decrypt('vm/browser-cookies.native'), 'local-cookie-clone');
  assert.deepEqual(fs.readFileSync(path.join(temporary, 'cloud-browser/account.bb.worker.app.chrome.bin')), original);
  console.log('PASS: Electron encrypted storage exports to Rust DPAPI; originals preserved; foreign origins rejected.');
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
