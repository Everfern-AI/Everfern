import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

for (const target of targets) {
  if (!['chrome', 'firefox'].includes(target)) {
    throw new Error(`Unknown extension target: ${target}`);
  }
  const outDir = path.join(root, 'dist', target);
  fs.rmSync(outDir, { recursive: true, force: true });
  copyDir(path.join(root, 'src'), outDir);
  copyDir(path.join(root, 'logos'), path.join(outDir, 'logos'));
  fs.copyFileSync(path.join(root, `manifest.${target}.json`), path.join(outDir, 'manifest.json'));
  console.log(`[extension-navis] built ${target} -> ${outDir}`);

  if (target === 'firefox') {
    const xpiPath = path.join(root, 'dist', 'navis-firefox.xpi');
    fs.rmSync(xpiPath, { force: true });

    try {
      const zip = new AdmZip();
      zip.addLocalFolder(outDir);
      zip.writeZip(xpiPath);
      console.log(`[extension-navis] packaged firefox -> ${xpiPath}`);
    } catch (err) {
      console.error(`[extension-navis] failed to package firefox to xpi:`, err.message);
    }
  } else if (target === 'chrome') {
    const zipPath = path.join(root, 'dist', 'navis-chrome.zip');
    fs.rmSync(zipPath, { force: true });

    try {
      const zip = new AdmZip();
      zip.addLocalFolder(outDir);
      zip.writeZip(zipPath);
      console.log(`[extension-navis] packaged chrome -> ${zipPath}`);
    } catch (err) {
      console.error(`[extension-navis] failed to package chrome to zip:`, err.message);
    }
  }
}
