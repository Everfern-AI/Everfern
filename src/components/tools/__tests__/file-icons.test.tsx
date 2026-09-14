/**
 * Node-env purity test for the local file-icon map (NR-PERF-10).
 * Verifies getFileIconVisual is a pure extension/filename → local Lucide icon
 * mapping with a generic fallback, and involves no network URLs.
 */
import { describe, it, expect } from 'vitest';
import { getFileIconVisual } from '../file-icons';
import * as lucide from 'lucide-react';

describe('file-icons mapping (NR-PERF-10)', () => {
  it('resolves exact config filenames to specific icons', () => {
    const pkg = getFileIconVisual('package.json');
    expect(pkg.Icon).toBe(lucide.Package);
    const gitignore = getFileIconVisual('.gitignore');
    expect(gitignore.Icon).toBe(lucide.GitBranch);
  });

  it('resolves extensions to distinct local icons', () => {
    const ts = getFileIconVisual('index.ts');
    const js = getFileIconVisual('app.js');
    const png = getFileIconVisual('photo.png');
    const yaml = getFileIconVisual('ci.yml');
    expect(ts.Icon).toBe(lucide.FileCode2);
    expect(js.Icon).toBe(lucide.FileCode);
    expect(png.Icon).toBe(lucide.Image);
    expect(yaml.Icon).toBe(lucide.Braces);
    expect(ts.Icon).not.toBe(js.Icon);
  });

  it('is case-insensitive', () => {
    expect(getFileIconVisual('README.MD').Icon).toBe(getFileIconVisual('readme.md').Icon);
  });

  it('falls back to a generic file icon for unknown names', () => {
    const weird = getFileIconVisual('manifest.unknownext');
    expect(weird.Icon).toBe(lucide.File);
    expect(getFileIconVisual('no-extension').Icon).toBe(lucide.File);
  });

  it('always returns a display color string', () => {
    for (const name of ['a.ts', 'b.jsx', 'c.png', '.env', 'zzz', 'x']) {
      expect(typeof getFileIconVisual(name).color).toBe('string');
      expect(getFileIconVisual(name).color.length).toBeGreaterThan(0);
    }
  });

  it('handles .env dotfile variants', () => {
    const env = getFileIconVisual('.env');
    expect(env.Icon).toBe(lucide.FileLock);
    expect(getFileIconVisual('.env.local').Icon).toBe(lucide.FileLock);
  });
});
