const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const extDir = path.join(__dirname, '..', 'public', 'chrome-extension');
const outputZip = path.join(__dirname, '..', 'public', 'chrome-extension.zip');

if (fs.existsSync(extDir)) {
  console.log('[Zip Extension] Packaging chrome-extension...');
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(extDir);
    zip.writeZip(outputZip);
    console.log(`[Zip Extension] Created ${outputZip}`);
  } catch (err) {
    console.error('[Zip Extension] Failed to create zip file:', err.message);
  }
} else {
  console.warn(`[Zip Extension] Directory not found: ${extDir}`);
}
