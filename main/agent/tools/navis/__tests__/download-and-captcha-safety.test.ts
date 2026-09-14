/**
 * Navis — Download filename safety (AG-SAF-04) + captcha widget gating (AG-SAF-08)
 *
 * Pure-function tests: no live Playwright session required.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  sanitizeDownloadFilename,
  resolveContainedDownloadPath,
  DEFAULT_DOWNLOAD_FILENAME,
} from '../session';
import {
  KNOWN_CAPTCHA_WIDGET_SELECTORS,
  isKnownCaptchaPage,
} from '../actions';

// ── AG-SAF-04: sanitizeDownloadFilename ──────────────────────────────────────

describe('AG-SAF-04: sanitizeDownloadFilename', () => {
  it('collapses POSIX traversal to the final segment', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDownloadFilename('../../../.ssh/authorized_keys')).toBe('authorized_keys');
  });

  it('strips hidden-file leading dots from the final segment', () => {
    // Exact rule: leading/trailing dots and whitespace are stripped from the
    // final path segment; '.ssh/authorized_keys' keeps only the last segment.
    expect(sanitizeDownloadFilename('.ssh/authorized_keys')).toBe('authorized_keys');
    expect(sanitizeDownloadFilename('.bashrc')).toBe('bashrc');
    expect(sanitizeDownloadFilename('...report.pdf')).toBe('report.pdf');
    expect(sanitizeDownloadFilename('file.txt.')).toBe('file.txt');
    expect(sanitizeDownloadFilename('  spaced.txt  ')).toBe('spaced.txt');
  });

  it('treats backslashes as path separators too (cross-platform traversal)', () => {
    expect(sanitizeDownloadFilename('..\\..\\windows\\evil.exe')).toBe('evil.exe');
    expect(sanitizeDownloadFilename('C:\\Users\\me\\file.zip')).toBe('file.zip');
  });

  it('strips control characters including NUL and newlines', () => {
    expect(sanitizeDownloadFilename('nul\0name')).toBe('nulname');
    expect(sanitizeDownloadFilename('bad\nfile.txt')).toBe('badfile.txt');
    expect(sanitizeDownloadFilename('tab\tfile.txt')).toBe('tabfile.txt');
  });

  it('strips colons (Windows drive/stream separators)', () => {
    expect(sanitizeDownloadFilename('my:file.txt')).toBe('myfile.txt');
    expect(sanitizeDownloadFilename('file:stream.txt')).toBe('filestream.txt');
  });

  it('falls back to the default name for empty/dot-only/traversal-only inputs', () => {
    expect(sanitizeDownloadFilename('')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('..')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('.')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('...')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('/')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('../../')).toBe(DEFAULT_DOWNLOAD_FILENAME);
    expect(sanitizeDownloadFilename('\0\0')).toBe(DEFAULT_DOWNLOAD_FILENAME);
  });

  it('preserves unicode content and ordinary punctuation', () => {
    expect(sanitizeDownloadFilename('café-报告-v2.pdf')).toBe('café-报告-v2.pdf');
    expect(sanitizeDownloadFilename('my report (final).docx')).toBe('my report (final).docx');
    expect(sanitizeDownloadFilename('archive.tar.gz')).toBe('archive.tar.gz');
  });

  it('never returns a name containing path separators or traversal segments', () => {
    const hostile = [
      '../../.ssh/authorized_keys',
      '..\\..\\..\\etc\\shadow',
      'downloads/../../evil.sh',
      './nested/../../escape',
    ];
    for (const raw of hostile) {
      const out = sanitizeDownloadFilename(raw);
      expect(out).not.toContain('/');
      expect(out).not.toContain('\\');
      expect(out).not.toContain('..');
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

// ── AG-SAF-04: resolveContainedDownloadPath ──────────────────────────────────

describe('AG-SAF-04: resolveContainedDownloadPath', () => {
  const DIR = path.join(os.tmpdir(), 'navis-dl-test');

  it('keeps a normal name inside the dir', () => {
    const out = resolveContainedDownloadPath(DIR, 'file.txt', () => false);
    expect(out).toBe(path.join(DIR, 'file.txt'));
  });

  it('forces hostile traversal names into the dir', () => {
    const out = resolveContainedDownloadPath(DIR, '../../.ssh/authorized_keys', () => false);
    expect(out).toBe(path.join(DIR, 'authorized_keys'));
    expect(path.resolve(out).startsWith(path.resolve(DIR) + path.sep)).toBe(true);
  });

  it('forces empty/dot-only names to the safe default inside the dir', () => {
    const out = resolveContainedDownloadPath(DIR, '..', () => false);
    expect(out).toBe(path.join(DIR, DEFAULT_DOWNLOAD_FILENAME));
  });

  it('suffixes -1, -2, ... before the extension on collision', () => {
    // 'file.txt' taken, 'file-1.txt' taken, 'file-2.txt' free.
    const taken = new Set([path.join(DIR, 'file.txt'), path.join(DIR, 'file-1.txt')]);
    const exists = (p: string) => taken.has(p);
    expect(resolveContainedDownloadPath(DIR, 'file.txt', exists))
      .toBe(path.join(DIR, 'file-2.txt'));
  });

  it('suffixes collisions for extensionless names', () => {
    const taken = new Set([path.join(DIR, 'data')]);
    expect(resolveContainedDownloadPath(DIR, 'data', (p) => taken.has(p)))
      .toBe(path.join(DIR, 'data-1'));
  });

  it('falls back to a timestamped name when 100 suffix attempts are exhausted', () => {
    const out = resolveContainedDownloadPath(DIR, 'file.txt', () => true);
    expect(out).toMatch(/file-\d+\.txt$/);
    expect(path.resolve(out).startsWith(path.resolve(DIR) + path.sep)).toBe(true);
  });

  it('works against a real temp dir with the default fs exists check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navis-dl-real-'));
    try {
      const first = resolveContainedDownloadPath(dir, 'real.txt');
      expect(first).toBe(path.join(dir, 'real.txt'));
      fs.writeFileSync(first, 'x');
      const second = resolveContainedDownloadPath(dir, 'real.txt');
      expect(second).toBe(path.join(dir, 'real-1.txt'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── AG-SAF-08: captcha widget gating ─────────────────────────────────────────

describe('AG-SAF-08: isKnownCaptchaPage decision core', () => {
  it('exports the known widget selector allowlist', () => {
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('iframe[src*="recaptcha" i]');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('iframe[src*="hcaptcha" i]');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('iframe[src*="challenges.cloudflare.com" i]');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('.g-recaptcha');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('.h-recaptcha');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('[data-sitekey]');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('.cf-turnstile');
    expect(KNOWN_CAPTCHA_WIDGET_SELECTORS).toContain('.captcha');
  });

  it('a page with no known containers yields skip (false)', () => {
    expect(isKnownCaptchaPage([])).toBe(false);
    expect(isKnownCaptchaPage(null)).toBe(false);
    expect(isKnownCaptchaPage(undefined)).toBe(false);
  });

  it('unrelated selectors never pass the gate', () => {
    // A page whose matched selectors are not on the allowlist must skip.
    expect(isKnownCaptchaPage(['.login-form', '#newsletter-signup', 'button.primary'])).toBe(false);
    // Even sneaky near-misses must not match.
    expect(isKnownCaptchaPage(['.captcha-container-typo', 'iframe[src*="notcaptcha"]'])).toBe(false);
  });

  it('a known container present on the page passes the gate', () => {
    expect(isKnownCaptchaPage(['.cf-turnstile'])).toBe(true);
    expect(isKnownCaptchaPage(['.g-recaptcha', '.g-recaptcha-bubble-arrow'])).toBe(true);
    expect(isKnownCaptchaPage(['.g-recaptcha-bubble-arrow', '[data-sitekey]'])).toBe(true);
  });
});

describe('AG-SAF-08: generic captcha interaction is gated in source', () => {
  const read = (file: string) =>
    fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');

  const solveBlockPattern = /const solveOutcome = await page\.evaluate\([\s\S]*?\n  \}, KNOWN_CAPTCHA_WIDGET_SELECTORS\);/;

  it('the evaluate block receives the shared selector allowlist', () => {
    const src = read('actions.ts');
    const solveFn = src.match(solveBlockPattern);
    expect(solveFn).toBeDefined();
    expect(solveFn![0]).toContain('KNOWN_CAPTCHA_WIDGET_SELECTORS');
  });

  it('confirm-shaped clicks and checkbox clicks require containment in a known container', () => {
    const src = read('actions.ts');
    const solveFn = src.match(solveBlockPattern);
    expect(solveFn).toBeDefined();
    // Both the confirm-button path and the checkbox fallback must be gated by
    // isInsideKnownContainer.
    expect(solveFn![0].match(/isInsideKnownContainer/g)?.length).toBeGreaterThanOrEqual(4);
    // The page-wide "click every unchecked checkbox" fallback is gone: the
    // checkbox loop must check containment, not just !el.checked alone.
    const checkboxLoop = solveFn![0].match(/const checkboxes[\s\S]*?return \{ clicked: true, matchedSelectors \};/);
    expect(checkboxLoop).toBeDefined();
    expect(checkboxLoop![0]).toContain('isInsideKnownContainer(el)');
  });

  it('generic interaction is skipped when no known widget matched', () => {
    const src = read('actions.ts');
    expect(src).toContain('no known captcha widget found - skipping generic interaction');
    expect(src).toContain('isKnownCaptchaPage(solveOutcome?.matchedSelectors)');
  });
});
