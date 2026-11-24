// Build the last Electron release for Windows: the bridge that moves users to Tauri.
// It ships the Rust helper as resources/native/everfern.exe, which switches main/updater.ts
// to the tauri-transition feed and lets the preload export DPAPI-protected data.
// Usage: node scripts/build-electron-bridge.cjs [VERSION]   (default 1.4.0)
// Needs out/, dist-electron/ and a release Tauri build (src-tauri/target/release/everfern.exe).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = process.argv[2] || '1.4.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected VERSION like 1.4.0');
if (process.platform !== 'win32') throw new Error('The bridge release is Windows-only');
const helper = path.join(root, 'src-tauri/target/release/everfern.exe');
if (!fs.existsSync(helper)) throw new Error('Build the Tauri release first (npm run tauri:package)');
for (const need of ['out/index.html', 'dist-electron/main/main.js']) {
  if (!fs.existsSync(path.join(root, need))) throw new Error(`Missing ${need}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = {
  ...pkg.build,
  extraMetadata: { version },
  // build.win.files holds only "!" patterns, which electron-builder treats as "**/*" minus
  // those, packing the whole project (src-tauri/target, .next, release folders) into app.asar.
  files: [...pkg.build.files, ...(pkg.build.win?.files || [])],
  win: { ...pkg.build.win, files: undefined },
  directories: { output: 'release-bridge' },
  extraResources: [...pkg.build.extraResources, { from: helper, to: 'native/everfern.exe' }],
};
// Keep the config in the project root: electron-builder resolves `files` against it.
const file = path.join(root, 'electron-bridge.json');
fs.writeFileSync(file, JSON.stringify(config, null, 2));
const cli = path.join(root, 'node_modules/electron-builder/cli.js');
const result = spawnSync(process.execPath, [cli, '--win', ...(process.env.BRIDGE_DIR_ONLY ? ['dir'] : []), '--x64', '--publish', 'never', '--config', file], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
