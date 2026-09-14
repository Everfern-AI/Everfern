// @vitest-environment node
/**
 * CU-UI-03 / CU-UI-08 design-token contract tests.
 *
 * DOM-free: reads globals.css from disk, parses the `:root` and `.dark`
 * variable blocks, and enforces:
 *   - presence of syntax-contrast tokens in both theme blocks
 *   - presence and strict ordering of the z-tier tokens
 *   - WCAG 2.1 AA (≥ 4.5:1) contrast for light syntax tokens against both
 *     light backgrounds and dark syntax tokens against the dark background
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const cssPath = path.join(__dirname, '..', '..', 'app', 'globals.css');
const css = fs.readFileSync(cssPath, 'utf-8');

/** Extract the body of a top-level CSS rule block (e.g. `:root { ... }`). */
function block(selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`, 'g');
  const m = re.exec(css);
  if (!m) throw new Error(`block "${selector}" not found`);
  const open = css.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block "${selector}"`);
}

/** Map of CSS custom property → value from a rule block body. */
function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[`--${m[1]}`] = m[2].trim();
  return out;
}

const rootVars = vars(block(':root'));
const darkVars = vars(block('.dark'));

/* ── WCAG 2.1 relative luminance + contrast ───────────────────────────── */

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/* ── CU-UI-03: syntax-contrast tokens exist in both themes ────────────── */

describe('CU-UI-03 · syntax token presence', () => {
  it('light :root defines comment and keyword tokens', () => {
    expect(rootVars['--color-syntax-comment']).toBeDefined();
    expect(rootVars['--color-syntax-keyword']).toBeDefined();
  });

  it('dark .dark block overrides comment and keyword tokens', () => {
    expect(darkVars['--color-syntax-comment']).toBeDefined();
    expect(darkVars['--color-syntax-keyword']).toBeDefined();
  });
});

/* ── CU-UI-08: z-tier tokens ──────────────────────────────────────────── */

describe('CU-UI-08 · z-tier tokens', () => {
  const tiers = ['--z-dropdown', '--z-panel', '--z-modal', '--z-chrome', '--z-toast'] as const;

  it('all z-tier tokens are defined in :root', () => {
    for (const t of tiers) expect(rootVars[t]).toBeDefined();
  });

  it('z-tier tokens are strictly increasing: dropdown < panel < modal < chrome < toast', () => {
    const vals = tiers.map((t) => Number(rootVars[t]));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });
});

/* ── Z-TAIL: no raw z-index literals ≥9999 in app source ──────────────── */
/**
 * Regression contract for the z-token migration: every ad-hoc high z-index
 * literal (9999/10000/10001/99999) has been replaced by a --z-* token.
 * Local stacking contexts (< 1000, e.g. sticky headers, in-dropdown layers)
 * are unaffected; only the app-global overlay tiers are contractualized.
 */

describe('Z-TAIL · raw z-literal census', () => {
  const srcRoot = path.join(__dirname, '..', '..');

  const appSources = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '__tests__' || ent.name === 'node_modules' || ent.name.startsWith('.next')) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(ent.name)) out.push(p);
      }
    };
    walk(srcRoot);
    return out;
  })();

  it('no raw zIndex literal >= 9999 outside of globals.css', () => {
    const offenders: string[] = [];
    const re = /zIndex:\s*["']?\s*(\d{4,})/g;
    for (const file of appSources) {
      if (file.endsWith('globals.css')) continue;
      const text = fs.readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (Number(m[1]) >= 9999) offenders.push(`${path.relative(srcRoot, file)}: …zIndex: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('z-tier tokens are used at overlay sites (census of var(--z-*) usages)', () => {
    let uses = 0;
    for (const file of appSources) {
      const text = fs.readFileSync(file, 'utf-8');
      uses += (text.match(/var\(--z-(?:dropdown|panel|modal|chrome|toast)\)/g) || []).length;
    }
    // 12+ files adopted tokens in the CU-UI-08 sweep; guard against a
    // mass-revert that would silently reintroduce ad-hoc z churn.
    expect(uses).toBeGreaterThanOrEqual(12);
  });
});

/* ── CU-UI-09 · raw-color census (XV.D "Token census" / hex-literal audit) ─
 * Regression contract for the F3 token migration: counts hex literals
 * (#rgb/#rgba/#rrggbb/#rrggbbaa) and rgb()/rgba() calls across src/ and
 * holds them under a computed ceiling so the migration can only go down.
 * Dual-track with the Albers hex/rgba→token sweeps: the ceiling is set to
 * the census at contract-authoring time, not to zero (work is in flight).
 */

describe('CU-UI-09 · raw-color census', () => {
  const srcRoot = path.join(__dirname, '..', '..');

  /**
   * Intentional gaps — see .wave-progress/f3-color-gaps.md gaps doc.
   * - file-icons.tsx: brand palettes (filetype colors mirroring vendor logos)
   * - tool-labels.ts: tool brand colors (indigo/violet identity accents)
   * - GradientBorderSystem.tsx: brand spotlight gradient palette
   * - openui-library.tsx: vendored third-party OpenUI preview theme
   */
  const INTENTIONAL_GAP_FILES = new Set([
    'file-icons.tsx',
    'tool-labels.ts',
    'GradientBorderSystem.tsx',
    'openui-library.tsx',
  ]);

  /** Ceiling computed from the real census at contract-authoring time
   * (audit XV.D baseline ~3,387 in-flight; post-Albers census = 2,884). */
  const ALLOWED_RAW_COLOR_SITES = 2884;

  /** Floor for token adoption; current usage 1,095 minus ~5% churn margin. */
  const MIN_TOKEN_UTILITY_USES = 1040;

  const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F](?:[0-9a-fA-F]{2}(?:[0-9a-fA-F]{2})?)?)?\b/g;
  const RGBFN_RE = /\brgba?\(/g;
  const TOKEN_CLASS_RE = /(?:text|bg|border)-(?:fg|bg|syntax)-[\w-]+/g;
  const TOKEN_VAR_RE = /var\(--color-(?:fg|bg|syntax)[\w-]*\)/g;

  const colorSources = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '__tests__' || ent.name === 'node_modules' || ent.name.startsWith('.next')) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(tsx?|ts)$/.test(ent.name) && !/\.test\./.test(ent.name) && ent.name !== 'globals.css') out.push(p);
      }
    };
    walk(srcRoot);
    return out;
  })();

  it('hex/rgba literal census stays under the migration ceiling', () => {
    let offenders = 0;
    const perFile: string[] = [];
    for (const file of colorSources) {
      if (INTENTIONAL_GAP_FILES.has(path.basename(file))) continue;
      const text = fs.readFileSync(file, 'utf-8');
      const n = (text.match(HEX_RE) || []).length + (text.match(RGBFN_RE) || []).length;
      if (n) perFile.push(`${path.relative(srcRoot, file)}: ${n}`);
      offenders += n;
    }
    perFile.sort((a, b) => Number(b.split(': ')[1]) - Number(a.split(': ')[1]));
    expect(offenders, `census ${offenders} > ceiling ${ALLOWED_RAW_COLOR_SITES}\n${perFile.join('\n')}`).toBeLessThanOrEqual(ALLOWED_RAW_COLOR_SITES);
  });

  it('token-utility adoption does not regress (census of token uses)', () => {
    let uses = 0;
    for (const file of colorSources) {
      const text = fs.readFileSync(file, 'utf-8');
      uses += (text.match(TOKEN_CLASS_RE) || []).length;
      uses += (text.match(TOKEN_VAR_RE) || []).length;
    }
    // Guards against a mass-revert to raw colors; floor = current − ~5%.
    expect(uses, `token utility uses: ${uses} (floor ${MIN_TOKEN_UTILITY_USES})`).toBeGreaterThanOrEqual(MIN_TOKEN_UTILITY_USES);
  });

  it('.dark overrides every --color-syntax-* var and --color-bg-surface-hover from :root', () => {
    const scoped = Object.keys(rootVars).filter(
      (k) => k.startsWith('--color-syntax-') || k === '--color-bg-surface-hover',
    );
    expect(scoped.length).toBeGreaterThanOrEqual(3); // comment, keyword, surface-hover
    const missing = scoped.filter((k) => !(k in darkVars));
    expect(missing, `tokens missing a .dark override: ${missing.join(', ')}`).toEqual([]);
  });
});

/* ── CU-UI-03: WCAG AA contrast (≥ 4.5:1) ──────────────────────────────── */

describe('CU-UI-03 · WCAG AA contrast', () => {
  const AA = 4.5;

  it('light syntax tokens ≥ 4.5:1 against #ffffff and #f5f4f0 (bg-surface / bg-base)', () => {
    for (const bg of ['#ffffff', '#f5f4f0']) {
      for (const token of ['--color-syntax-comment', '--color-syntax-keyword']) {
        const ratio = contrast(rootVars[token], bg);
        expect(ratio, `${token} on ${bg}: ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('dark syntax tokens ≥ 4.5:1 against #0f0e0c (dark bg-base)', () => {
    for (const token of ['--color-syntax-comment', '--color-syntax-keyword']) {
      const ratio = contrast(darkVars[token], '#0f0e0c');
      expect(ratio, `${token} on #0f0e0c: ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(AA);
    }
  });
});
