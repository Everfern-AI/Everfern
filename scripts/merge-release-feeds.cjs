// Merge the per-platform feed-*.json files from CI into the release's update feeds.
// Usage: node scripts/merge-release-feeds.cjs TAG DIR
// Reads DIR/feed-*.json and, if present, DIR/latest.json (the Windows Tauri feed from
// tauri-release-manifests.cjs). Writes DIR/latest.json, latest-mac.yml, latest-linux.yml.
// latest.yml (Windows) is never written here: it must keep pointing to the Electron
// bridge, which exports DPAPI data before switching to tauri-transition.yml.
const fs = require('node:fs');
const path = require('node:path');
const [tag, dir] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !dir) throw new Error('Expected TAG DIR');
const base = `https://github.com/Everfern-AI/Everfern/releases/download/${tag}/`;
const feeds = fs.readdirSync(dir).filter((n) => /^feed-.+\.json$/.test(n))
  .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
if (!feeds.length) throw new Error(`No feed-*.json files in ${dir}`);
const version = tag.slice(1);
for (const feed of feeds) if (feed.version !== version) throw new Error(`${feed.platform} was built as ${feed.version}`);
const releaseDate = new Date().toISOString();

const latestPath = path.join(dir, 'latest.json');
const latest = fs.existsSync(latestPath)
  ? JSON.parse(fs.readFileSync(latestPath, 'utf8'))
  : { version, pub_date: releaseDate, platforms: {} };
if (latest.version !== version) throw new Error(`latest.json is for ${latest.version}`);
for (const feed of feeds) {
  if (!feed.tauri?.signature) {
    console.warn(`Skipping ${feed.platform} in latest.json: no updater signature`);
    continue;
  }
  latest.platforms[feed.platform] = { url: base + feed.tauri.name, signature: feed.tauri.signature };
}
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');

// Same shape electron-builder writes. Full downloads only: no blockmaps exist for
// Tauri payloads, so differential download has nothing to diff against.
const electronYml = (entries) => {
  const lines = [`version: ${version}`, 'files:'];
  for (const e of entries) lines.push(`  - url: ${e.name}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`);
  lines.push(`path: ${entries[0].name}`, `sha512: ${entries[0].sha512}`, `releaseDate: '${releaseDate}'`);
  return lines.join('\n') + '\n';
};
const pick = (prefix) => feeds.filter((f) => f.platform.startsWith(prefix) && f.electron)
  // x64 first: electron-updater picks the arm64 entry by name on Apple Silicon.
  .sort((a, b) => (a.platform.endsWith('x86_64') ? -1 : 1) - (b.platform.endsWith('x86_64') ? -1 : 1))
  .map((f) => f.electron);
const mac = pick('darwin');
const linux = pick('linux');
if (mac.length) fs.writeFileSync(path.join(dir, 'latest-mac.yml'), electronYml(mac));
if (linux.length) fs.writeFileSync(path.join(dir, 'latest-linux.yml'), electronYml(linux));
console.log(`latest.json platforms: ${Object.keys(latest.platforms).join(', ')}`);
console.log(`latest-mac.yml: ${mac.map((e) => e.name).join(', ') || 'none'}`);
console.log(`latest-linux.yml: ${linux.map((e) => e.name).join(', ') || 'none'}`);
