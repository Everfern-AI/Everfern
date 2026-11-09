const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const keys = path.join(os.homedir(), '.everfern/keys');
const config = path.join(root, 'tauri/staging/tauri.release.json');
if (!fs.existsSync(config)) throw new Error('Run npm run tauri:prepare first');
const publicKey = process.env.EVERFERN_UPDATER_PUBLIC_KEY || fs.readFileSync(path.join(keys, 'tauri-updater.key.pub'), 'utf8').trim();
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || path.join(keys, 'tauri-updater.key');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !fs.existsSync(privateKey)) throw new Error('Updater signing key is missing');
const prepared = JSON.parse(fs.readFileSync(config, 'utf8'));
if (prepared.plugins?.updater?.pubkey !== publicKey) throw new Error('Refresh staging with the same updater public key before building');
if (!process.env.npm_execpath) throw new Error('Run through npm run tauri:package');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package', '@tauri-apps/cli@2.12.4', '--', 'tauri', 'build', '--features', 'custom-protocol', '--config', config, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_BUILD_JOBS: '2', EVERFERN_UPDATER_PUBLIC_KEY: publicKey, TAURI_SIGNING_PRIVATE_KEY: privateKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
