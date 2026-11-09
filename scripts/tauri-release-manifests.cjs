// Produce both update feeds from the exact installer being published.
// Usage: node scripts/tauri-release-manifests.cjs VERSION INSTALLER HTTPS_URL SIG_FILE OUTPUT_DIR
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [version, installer, downloadUrl, signatureFile, output] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !installer || !signatureFile || !output) {
  throw new Error('Expected VERSION INSTALLER HTTPS_URL SIG_FILE OUTPUT_DIR');
}
const url = new URL(downloadUrl);
if (url.protocol !== 'https:') throw new Error('Release downloads must use HTTPS');
const signature = fs.readFileSync(signatureFile, 'utf8').trim();
if (!signature) throw new Error('Missing Tauri updater signature');
const size = fs.statSync(installer).size;
const hash = crypto.createHash('sha512');
const descriptor = fs.openSync(installer, 'r');
try {
  const chunk = Buffer.alloc(1024 * 1024);
  let count;
  while ((count = fs.readSync(descriptor, chunk)) > 0) hash.update(chunk.subarray(0, count));
} finally { fs.closeSync(descriptor); }
const sha512 = hash.digest('base64');
const releaseDate = new Date().toISOString();
fs.mkdirSync(output, { recursive: true });
// Electron NSIS updater requires full download across the framework transition.
// Omit block-map metadata: Electron and Tauri installers cannot share blocks.
// latest.yml must continue pointing to the Electron bridge release so old
// clients cannot skip the export step. The bridge uses this separate feed.
fs.writeFileSync(path.join(output, 'tauri-transition.yml'),
  `version: ${version}\nfiles:\n  - url: ${JSON.stringify(url.href)}\n    sha512: ${sha512}\n    size: ${size}\npath: ${JSON.stringify(url.href)}\nsha512: ${sha512}\nreleaseDate: ${JSON.stringify(releaseDate)}\n`);
fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({
  version, pub_date: releaseDate,
  platforms: { 'windows-x86_64': { url: url.href, signature } },
}, null, 2) + '\n');
console.log('Generated Electron and Tauri Windows update manifests. Validate installer migration before publishing.');
