import * as path from 'path';
import * as fs from 'fs';

// Containment guard for renderer-supplied path segments. Resolves symlinks so a
// link planted inside a sandbox dir cannot escape it.

function contained(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * Resolves `segments` under `root` and guarantees the result cannot escape it,
 * both lexically ('..' climbs, absolute overrides) and physically (symlinks).
 * Throws when containment would be violated.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);

  // String-level containment FIRST: rejects traversal and absolute targets.
  if (!contained(resolved, resolvedRoot)) {
    throw new Error(`Path escapes sandbox root: ${segments.join('/')}`);
  }

  // Symlink-aware re-check for anything that already exists on disk. A missing
  // target (new-file write) is safe: the lexical check above already held, and
  // comparing it against the *physical* root here would misfire whenever an
  // ancestor of root is itself a symlink (e.g. darwin /var -> /private/var).
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
    // A dangling symlink ENOENTs on realpath exactly like a missing file, but a
    // subsequent write would FOLLOW the link outside the root. lstat (which
    // does not follow links) distinguishes the two cases.
    let st: fs.Stats | undefined;
    try {
      st = fs.lstatSync(resolved);
    } catch (lstatErr: any) {
      if (lstatErr?.code !== 'ENOENT') throw lstatErr;
      // Genuinely absent — the lexical check above held, safe.
      return resolved;
    }
    if (st.isSymbolicLink()) {
      throw new Error('Path escapes sandbox root via dangling symlink');
    }
    return resolved;
  }
  // Target exists, so every ancestor of root exists too: this cannot ENOENT.
  const realRoot = fs.realpathSync(resolvedRoot);
  if (!contained(real, realRoot)) {
    throw new Error(`Path escapes sandbox root via symlink: ${segments.join('/')}`);
  }
  return real;
}

/**
 * Restricts a renderer-supplied identifier (chatId, site name, ...) to a
 * single safe path segment: 1-120 chars of [A-Za-z0-9._-] with no '..'.
 */
export function assertSafeSegment(segment: string, label = 'identifier'): string {
  if (
    typeof segment !== 'string' ||
    segment.length < 1 ||
    segment.length > 120 ||
    segment.includes('..') ||
    !/^[A-Za-z0-9._-]+$/.test(segment)
  ) {
    throw new Error(`Unsafe ${label}: ${String(segment).slice(0, 40)}`);
  }
  return segment;
}
