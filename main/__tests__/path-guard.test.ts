/**
 * MP-SEC-02 — sandboxed path handling (main/lib/path-guard).
 *
 * Contract:
 * - resolveWithin(root, ...segments) resolves segments under root, rejecting
 *   lexical escapes ('..' climbs, absolute overrides) with "Path escapes
 *   sandbox root: ..." and symlink escapes with "... via symlink: ...".
 *   Existing targets are realpath'd before the containment re-check. Missing
 *   targets ENOENT on realpath; lstat disambiguates: a genuinely absent target
 *   (lazy first write) falls back to the lexically-checked resolution, while a
 *   dangling symlink (which a later write would FOLLOW out of the root) throws
 *   "... via dangling symlink". A child equal to its parent counts as contained.
 * - assertSafeSegment(segment, label) admits only 1..120 chars of
 *   [A-Za-z0-9._-] with no '..' substring; anything else throws
 *   "Unsafe <label>: <first 40 chars>".
 *
 * The final describe proves the store layer (artifacts/sites) is closed
 * end-to-end by mocking os.homedir() at a tmp fixture home BEFORE the stores
 * evaluate their module-level SITES_DIR / ARTIFACTS_DIR consts.
 *
 * Fixture hygiene: every fixture lives under os.tmpdir(); nothing is created
 * inside the repo. Roots are passed through fs.realpathSync because on macOS
 * TMPDIR (/var/...) resolves to /private/var/... and the guard compares
 * lexical resolutions against realpaths — mixing the two would false-positive.
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Hoisted state shared with the hoisted vi.mock factory below: the fixture
// home is created inside the factory (which runs before store imports) so the
// stores' module-level os.homedir() calls pick it up.
const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-fixture-home-'));
  // Use the realpath: on macOS /var is a symlink to /private/var, and the
  // guard's lexical-vs-realpath checks must not straddle that boundary.
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

import { assertSafeSegment, resolveWithin } from '../lib/path-guard';
import { writeArtifact } from '../store/artifacts';
import { deleteSite, writeSiteFile } from '../store/sites';

// ---------------------------------------------------------------------------
// Direct unit fixtures
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-path-guard-'));
  tmpRoots.push(dir);
  return fs.realpathSync(dir);
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (fixtureHome.home) {
    fs.rmSync(fixtureHome.home, { recursive: true, force: true });
    fixtureHome.home = null;
  }
});

describe('assertSafeSegment', () => {
  it('accepts typical single-segment identifiers', () => {
    expect(assertSafeSegment('abc123')).toBe('abc123');
    expect(assertSafeSegment('chat_9f-8.x')).toBe('chat_9f-8.x');
    expect(assertSafeSegment('a')).toBe('a');
    const long120 = 'a'.repeat(120);
    expect(assertSafeSegment(long120)).toBe(long120);
  });

  it('rejects traversal, absolute paths, separators and empty input', () => {
    expect(() => assertSafeSegment('../../x')).toThrow(/Unsafe identifier/);
    expect(() => assertSafeSegment('/etc/passwd')).toThrow(/Unsafe identifier/);
    expect(() => assertSafeSegment('a/b')).toThrow(/Unsafe identifier/);
    expect(() => assertSafeSegment('..')).toThrow(/Unsafe identifier/);
    expect(() => assertSafeSegment('')).toThrow(/Unsafe identifier/);
  });

  it('rejects strings containing ".." anywhere', () => {
    expect(() => assertSafeSegment('a..b')).toThrow(/Unsafe identifier/);
    expect(() => assertSafeSegment('..hidden')).toThrow(/Unsafe identifier/);
  });

  it('rejects over-length identifiers at the 121st char', () => {
    expect(() => assertSafeSegment('a'.repeat(121))).toThrow(/Unsafe identifier/);
  });

  it('rejects non-string input', () => {
    expect(() => (assertSafeSegment as any)(42)).toThrow(/Unsafe identifier/);
    expect(() => (assertSafeSegment as any)(null)).toThrow(/Unsafe identifier/);
    expect(() => (assertSafeSegment as any)(undefined)).toThrow(/Unsafe identifier/);
  });

  it('uses the supplied label in the error message', () => {
    expect(() => assertSafeSegment('../x', 'chat id')).toThrow(/Unsafe chat id/);
  });

  // ANOMALY vs spec: '.' satisfies [A-Za-z0-9._-]+ at length 1, so the current
  // guard ACCEPTS it. Pinning observed behavior here; '.' resolves to the root
  // itself in resolveWithin, so this is hygiene-level, not an escape vector.
  it('currently accepts "." (documented deviation from intended contract)', () => {
    expect(assertSafeSegment('.')).toBe('.');
  });
});

describe('resolveWithin — valid round-trips', () => {
  it('returns the realpath of an existing file inside root', () => {
    const root = makeTmpRoot();
    const file = path.join(root, 'report.html');
    fs.writeFileSync(file, '<html></html>');
    const result = resolveWithin(root, 'report.html');
    expect(result).toBe(fs.realpathSync(file));
    expect(result).toBe(file);
  });

  it('resolves nested segments when intermediate dirs exist', () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, 'sub'));
    const result = resolveWithin(root, 'sub', 'file.txt');
    expect(result).toBe(path.join(root, 'sub', 'file.txt'));
    expect(result.startsWith(root + path.sep)).toBe(true);
  });

  it('resolves a not-yet-existing file under root without throwing', () => {
    const root = makeTmpRoot();
    expect(resolveWithin(root, 'newfile.html')).toBe(path.join(root, 'newfile.html'));
  });

  it('returns root itself when no segments are given (child === parent)', () => {
    const root = makeTmpRoot();
    expect(resolveWithin(root)).toBe(root);
  });
});

describe('resolveWithin — traversal rejection', () => {
  it('throws on ".." climbs out of the root', () => {
    const root = makeTmpRoot();
    expect(() => resolveWithin(root, '../../x')).toThrow(/escapes sandbox root/);
  });

  it('throws when an absolute segment overrides the root', () => {
    const root = makeTmpRoot();
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow(/escapes sandbox root/);
  });

  it('throws when nested segments combine into an escape', () => {
    const root = makeTmpRoot();
    expect(() => resolveWithin(root, 'sub', '../../../etc/passwd')).toThrow(
      /escapes sandbox root/
    );
  });
});

describe('resolveWithin — symlink escape (MP-SEC-02 regression)', () => {
  it('rejects a link planted inside the sandbox pointing at a sibling outside it', () => {
    const area = makeTmpRoot();
    const sandbox = path.join(area, 'sandbox');
    fs.mkdirSync(sandbox);
    const outside = path.join(area, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    // Relative dir symlink: area/sandbox/link -> ../outside
    fs.symlinkSync(path.join('..', 'outside'), path.join(sandbox, 'link'), 'dir');

    expect(() => resolveWithin(sandbox, 'link', 'secret.txt')).toThrow(
      /escapes sandbox root/
    );
  });

  it('still admits real files reached without symlinks (no over-blocking)', () => {
    const area = makeTmpRoot();
    const sandbox = path.join(area, 'sandbox');
    fs.mkdirSync(sandbox);
    fs.writeFileSync(path.join(sandbox, 'real.html'), '<html>ok</html>');

    const result = resolveWithin(sandbox, 'real.html');
    expect(result).toBe(fs.realpathSync(path.join(sandbox, 'real.html')));
    expect(result.startsWith(fs.realpathSync(sandbox))).toBe(true);
  });

  // darwin permits /tmp-relative links, so the sibling-link case above fully
  // covers the physical escape; a fully-outside-tmp link adds nothing there.
});

// MP-SEC-02 regression: a DANGLING link planted inside the sandbox used to slip
// through resolveWithin's ENOENT fallback (realpathSync fails identically for
// a missing file and a broken link), so a subsequent write would FOLLOW the
// link and land outside the root. The fix lstats on realpath ENOENT; these
// tests pin both the refusal and the guarantee that nothing is written out.
describe('resolveWithin — dangling symlink escape (write-follow regression)', () => {
  it('throws on a dangling link while still resolving genuinely absent paths lexically', () => {
    const area = makeTmpRoot();
    const sandbox = path.join(area, 'sandbox');
    fs.mkdirSync(sandbox);
    // The target deliberately does not exist: fs.symlinkSync happily plants
    // the broken link, and realpathSync ENOENTs on it like a missing file.
    fs.symlinkSync(
      path.join('..', 'nonexistent-outside-target'),
      path.join(sandbox, 'out.html')
    );

    expect(() => resolveWithin(sandbox, 'out.html')).toThrow(/dangling symlink/);

    // The fix must not over-block lazy first writes, including in dirs that
    // do not exist yet.
    expect(resolveWithin(sandbox, 'sub', 'new.html')).toBe(
      path.join(sandbox, 'sub', 'new.html')
    );
  });

  it('a guarded write attempt through the dangling link creates nothing outside the root', async () => {
    const area = makeTmpRoot();
    const sandbox = path.join(area, 'sandbox');
    fs.mkdirSync(sandbox);
    const outsideTarget = path.join(area, 'nonexistent-outside-target');
    fs.symlinkSync(
      path.join('..', 'nonexistent-outside-target'),
      path.join(sandbox, 'out.html')
    );

    // Pre-fix, the lexical fallback handed back the link path itself and
    // writeFile materialized <area>/nonexistent-outside-target. The async
    // wrapper turns the guard's synchronous throw into an awaitable rejection.
    const guardedWrite = async () => {
      await fs.promises.writeFile(resolveWithin(sandbox, 'out.html'), 'pwned');
    };
    await expect(guardedWrite()).rejects.toThrow(/dangling symlink/);

    expect(fs.existsSync(outsideTarget)).toBe(false);
    // The write never went through: the plant is still the original link.
    expect(fs.lstatSync(path.join(sandbox, 'out.html')).isSymbolicLink()).toBe(true);
  });
});

describe('MP-SEC-02 end-to-end: store writes stay inside the mocked home', () => {
  it('writeArtifact rejects a traversal chatId and leaves nothing outside the root', async () => {
    const home = fixtureHome.home as string;
    const result = await writeArtifact('../evil', 'x.txt', 'pwned');

    expect(result.success).toBe(false);
    // Pre-fix vulnerable resolution would have been <home>/.everfern/evil/x.txt
    expect(fs.existsSync(path.join(home, '.everfern', 'evil'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.everfern', 'evil', 'x.txt'))).toBe(false);
  });

  it('writeArtifact rejects a traversal filename and writes no escaped file', async () => {
    const home = fixtureHome.home as string;
    const result = await writeArtifact('chat1', '../../escaped.txt', 'pwned');

    expect(result.success).toBe(false);
    // Pre-fix vulnerable resolution would have been <home>/.everfern/escaped.txt
    expect(fs.existsSync(path.join(home, '.everfern', 'escaped.txt'))).toBe(false);
  });

  it('writeArtifact rejects a planted dangling link and leaves the escaped target absent', async () => {
    const home = fixtureHome.home as string;
    // Materialize <home>/.everfern/artifacts/chat1 first so the dangling link
    // can be planted inside the real artifacts dir of the fixture home.
    await writeArtifact('chat1', 'seed.txt', 'x');

    const outsideTarget = path.join(home, 'escaped-dangling-target');
    // Relative link climbing three levels: chat1 -> artifacts -> .everfern ->
    // <home>, so a followed write would land at <home>/escaped-dangling-target.
    fs.symlinkSync(
      path.join('..', '..', '..', 'escaped-dangling-target'),
      path.join(home, '.everfern', 'artifacts', 'chat1', 'out.html')
    );

    const result = await writeArtifact('chat1', 'out.html', 'pwned');

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/dangling symlink/);
    // Nothing may exist at the link target — pre-fix this exact sequence
    // created the file there.
    expect(fs.existsSync(outsideTarget)).toBe(false);
  });

  it('writeSiteFile happy path still succeeds under the sandboxed home', async () => {
    const home = fixtureHome.home as string;
    const result = await writeSiteFile('goodsite', 'index.html', '<html></html>');

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(home, '.everfern', 'sites', 'goodsite', 'index.html'))).toBe(
      true
    );
  });

  it('deleteSite removes a site directory through the guarded path', async () => {
    const home = fixtureHome.home as string;
    await writeSiteFile('todelete', 'index.html', '<html></html>');
    expect(fs.existsSync(path.join(home, '.everfern', 'sites', 'todelete'))).toBe(true);

    const result = await deleteSite('todelete');
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(home, '.everfern', 'sites', 'todelete'))).toBe(false);
  });
});
