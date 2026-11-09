// Emit an electron-builder config for the final Electron migration release.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const helper = path.join(root, 'src-tauri/target/release/everfern.exe');
if (!fs.existsSync(helper)) throw new Error('Build the release Rust migration helper first');
const config = { ...pkg.build, extraMetadata: { version: process.env.EVERFERN_BRIDGE_VERSION || '1.4.0' }, extraResources: [...pkg.build.extraResources, { from: helper, to: 'native/everfern.exe' }] };
const output = path.join(root, 'build/electron-bridge.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(config, null, 2));
console.log('Prepared build/electron-bridge.json. Build the bridge installer with electron-builder --config build/electron-bridge.json.');
