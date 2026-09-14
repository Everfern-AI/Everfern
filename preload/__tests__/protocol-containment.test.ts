/**
 * MP-SEC-12 — custom-protocol handler containment.
 *
 * Source-level verification (protocol.handle requires a live Electron app):
 *  - everfern-app: resolveWithin containment on the joined path
 *  - everfern-site: resolveWithin for both roots + trailing-sep prefix checks
 *  - decodeURIComponent before checks; encodeURIComponent for net.fetch URL
 * Plus a runtime check of the containment math via path-guard's resolveWithin
 * against traversal payloads.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWithin } from '../../main/lib/path-guard';

const mainContent = fs.readFileSync(path.join(__dirname, '../../main/main.ts'), 'utf-8');

describe('MP-SEC-12 protocol handler source checks', () => {
  it('everfern-app handler routes the join through resolveWithin', () => {
    expect(mainContent).toContain("const relPath = filePath.replace(/^\\/+/, '');");
    expect(mainContent).toMatch(/let absPath = resolveWithin\(baseDir, relPath\)/);
  });

  it('everfern-site handler uses resolveWithin for sites and artifacts roots', () => {
    expect(mainContent).toContain('resolveWithin(sitesRoot, chatId, relPath)');
    expect(mainContent).toContain('resolveWithin(artifactsRoot, chatId, relPath)');
  });

  it('decodes the pathname before path checks (space/percent paths)', () => {
    expect(mainContent).toContain('decodeURIComponent(url.pathname)');
  });

  it('percent-encodes each segment for the file:// fetch', () => {
    expect(mainContent).toContain('.map((seg) => encodeURIComponent(seg))');
    expect(mainContent).toMatch(/net\.fetch\(`file:\/\/\/\$\{encoded\}`\)/);
  });

  it('keeps trailing-separator prefix compare for sites/artifacts (sibling-dir block)', () => {
    expect(mainContent).toContain("sitesRoot.endsWith(path.sep) ? sitesRoot : sitesRoot + path.sep");
    expect(mainContent).toContain("artifactsRoot.endsWith(path.sep) ? artifactsRoot : artifactsRoot + path.sep");
  });
});

describe('resolveWithin containment math (used by both handlers)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-proto-'));

  it('rejects .. traversal under the protocol root', () => {
    expect(() => resolveWithin(root, '../evil.html')).toThrow(/escapes sandbox root/);
  });

  it('rejects absolute-path override', () => {
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow(/escapes sandbox root/);
  });

  it('accepts nested relative paths', () => {
    expect(resolveWithin(root, '_next/static/app.js')).toBe(path.join(root, '_next/static/app.js'));
  });

  it('rejects a symlink inside the root pointing outside', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.html'), 'pwned');
    fs.symlinkSync(path.join(outside, 'secret.html'), path.join(root, 'link.html'));
    expect(() => resolveWithin(root, 'link.html')).toThrow(/escapes sandbox root/);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
});
