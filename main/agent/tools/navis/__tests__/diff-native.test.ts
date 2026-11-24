import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { diffSnapshotsJs } from '../diff';
import { getNative } from '../../../../lib/native';

const native = getNative();

// Small alphabet of snapshot-like lines so random inputs share many lines.
const line = fc.constantFrom(
  '- button "Submit" [ref=e1]',
  '  - link "Home" [ref=e2]',
  '    - textbox "Email" [ref=e3]',
  ' - odd space bullet',
  'plain text',
  '- ',
  '',
  'naïve – unicode … 😀',
);
const snapshot = fc.array(line, { maxLength: 40 }).map((lines) => lines.join('\n'));

describe.skipIf(!native)('native diffSnapshots parity', () => {
  test('matches the TypeScript implementation exactly', () => {
    fc.assert(
      fc.property(snapshot, snapshot, fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }), (a, b, radius) => {
        const js = diffSnapshotsJs(a, b, { contextRadius: radius });
        const rs = native!.diffSnapshots(a, b, radius);
        expect(rs).toEqual(js);
      }),
      { numRuns: 2000 },
    );
  });

  test('handles pages too large for the exact table', () => {
    const before = Array.from({ length: 6000 }, (_, i) => `- item ${i}`).join('\n');
    const after = Array.from({ length: 6000 }, (_, i) => `- item ${i % 7 === 0 ? 'x' + i : i}`).join('\n');
    const rs = native!.diffSnapshots(before, after);
    expect(rs.changed).toBe(true);
    expect(rs.added).toBe(858);
    expect(rs.removed).toBe(858);
  });
});

describe.skipIf(!native)('native listProjectFiles', () => {
  test('matches the JS walk on this repo folder', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.resolve(__dirname, '..');
    const results: string[] = [];
    const walk = (dir: string, rel = '') => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const relPath = rel ? path.join(rel, entry) : entry;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (!entry.startsWith('.') && entry !== 'node_modules') walk(full, relPath);
        } else results.push(relPath);
      }
    };
    walk(root);
    expect(await native!.listProjectFiles(root)).toEqual(results.sort());
  });
});
