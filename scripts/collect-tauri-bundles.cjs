// Copy one platform's Tauri bundles into a flat release folder with unique names and
// write feed-<platform>.json, which merge-release-feeds.cjs turns into the update feeds.
// Usage: node scripts/collect-tauri-bundles.cjs PLATFORM BUNDLE_DIR OUTPUT_DIR
// PLATFORM is a Tauri updater key: linux-x86_64, darwin-aarch64 or darwin-x86_64.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [platform, bundleDir, output] = process.argv.slice(2);
if (!platform || !bundleDir || !output) throw new Error('Expected PLATFORM BUNDLE_DIR OUTPUT_DIR');
const version = require('../src-tauri/tauri.conf.json').version;
fs.mkdirSync(output, { recursive: true });

const find = (dir, test) => {
  const full = path.join(bundleDir, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(test).map((name) => path.join(full, name));
};
const sha512 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const copy = (file, name) => {
  const target = path.join(output, name);
  fs.copyFileSync(file, target);
  return { name, sha512: sha512(target), size: fs.statSync(target).size };
};
const signature = (file) => (fs.existsSync(`${file}.sig`) ? fs.readFileSync(`${file}.sig`, 'utf8').trim() : null);
const feed = { version, platform };

if (platform.startsWith('linux')) {
  const [appImage] = find('appimage', (n) => n.endsWith('.AppImage'));
  if (!appImage) throw new Error('No AppImage was built');
  // The AppImage is both the Tauri updater payload and the electron-updater file.
  feed.tauri = { ...copy(appImage, `EverFern-${version}-x86_64.AppImage`), signature: signature(appImage) };
  feed.electron = feed.tauri;
  for (const deb of find('deb', (n) => n.endsWith('.deb'))) copy(deb, `EverFern-${version}-amd64.deb`);
} else if (platform.startsWith('darwin')) {
  const arch = platform === 'darwin-aarch64' ? 'arm64' : 'x64';
  const [app] = find('macos', (n) => n.endsWith('.app'));
  const [archive] = find('macos', (n) => n.endsWith('.app.tar.gz'));
  if (!app) throw new Error('No .app was built');
  if (archive) feed.tauri = { ...copy(archive, `EverFern-${version}-${arch}.app.tar.gz`), signature: signature(archive) };
  for (const dmg of find('dmg', (n) => n.endsWith('.dmg'))) copy(dmg, `EverFern-${version}-${arch}.dmg`);
  // electron-updater on macOS installs from a zip of the .app (Squirrel.Mac).
  const zip = path.join(output, `EverFern-${version}-${arch}-mac.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  feed.electron = { name: path.basename(zip), sha512: sha512(zip), size: fs.statSync(zip).size };
} else throw new Error(`Unknown platform ${platform}`);

fs.writeFileSync(path.join(output, `feed-${platform}.json`), JSON.stringify(feed, null, 2) + '\n');
console.log(`Collected ${platform}:`, fs.readdirSync(output).join(', '));
