const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const keys = path.join(os.homedir(), '.everfern/keys');
const config = path.join(root, 'tauri/staging/tauri.release.json');
if (!fs.existsSync(config)) throw new Error('Run npm run tauri:prepare first');
if (!process.env.npm_execpath) throw new Error('Run through npm run tauri:package');
const prepared = JSON.parse(fs.readFileSync(config, 'utf8'));
const env = { ...process.env };
if (!process.env.CI && !env.CARGO_BUILD_JOBS) env.CARGO_BUILD_JOBS = '2';
// Updater public key: env, then the local key pair, then the copy committed for CI.
const publicFile = [path.join(keys, 'tauri-updater.key.pub'), path.join(root, 'src-tauri/updater.pub')].find((f) => fs.existsSync(f));
const publicKey = process.env.EVERFERN_UPDATER_PUBLIC_KEY || (publicFile ? fs.readFileSync(publicFile, 'utf8').trim() : '');
if (!publicKey) throw new Error('Updater public key is missing');
if (prepared.plugins?.updater?.pubkey !== publicKey) throw new Error('Refresh staging with the same updater public key before building');
env.EVERFERN_UPDATER_PUBLIC_KEY = publicKey;
// EVERFERN_ALLOW_UNSIGNED=1 (CI without the release secret) skips this build's updater
// payloads; the app still embeds the public key and accepts later signed updates.
if (process.env.EVERFERN_ALLOW_UNSIGNED === '1') {
  if (prepared.bundle?.createUpdaterArtifacts) throw new Error('Stage with EVERFERN_ALLOW_UNSIGNED=1 too');
  delete env.TAURI_SIGNING_PRIVATE_KEY;
} else {
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || path.join(keys, 'tauri-updater.key');
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !fs.existsSync(privateKey)) throw new Error('Updater signing key is missing');
  Object.assign(env, { TAURI_SIGNING_PRIVATE_KEY: privateKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' });
}
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--package', '@tauri-apps/cli@2.12.4', '--', 'tauri', 'build', '--features', 'custom-protocol', '--config', config, ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
