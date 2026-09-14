/**
 * Navis - Action Executor
 *
 * Executes browser actions from AI decisions.
 * Implements all actions defined in NAVIS.md.
 *
 * Phase 1: Basic Actions (go_to_url, click, input, etc.)
 * Phase 2: Advanced Form Interactions (upload_file, select_option, set_date, drag_and_drop, hover, right_click)
 *
 * Architecture ports from BrowserOS browser-core:
 * - Key alias normalization (keyboard.ts)
 * - Triple-click clear fallback for React controlled inputs (input.ts)
 * - Screenshot serialization queue (screenshot-queue.ts)
 */

import { Page } from 'playwright';
import { BrowserSession } from './session';
import { NavisLogger } from './logger';
import {
  executeUploadFile,
  executeSelectOption,
  executeSetDate,
  executeDragAndDrop,
  executeHover,
  executeRightClick,
} from './form-interactions';
import { VisionGroundingHybrid } from './hybrid-click';
import { captureForVision, getRefMetadata, invalidateElementSnapshotCache, type RefMetadata } from './element-capture';
import { loadConfig } from './config';
import { AIClient } from '../../../lib/ai-client';
import { createNavisExtractionReport } from './content-extraction-report';
import { runExclusiveScreenshotCapture } from './screenshot-queue';

// ── Key Alias Normalization (ported from BrowserOS keyboard.ts) ──────────────
// Normalises AI-provided key names so combos like "Esc", "Cmd", "Return",
// "Del", "Ctrl+A" all resolve to Playwright's canonical names.
const KEY_ALIASES: Record<string, string> = {
  Return: 'Enter',
  Esc: 'Escape',
  Del: 'Delete',
  Ctrl: 'Control',
  Cmd: 'Meta',
  Command: 'Meta',
  Option: 'Alt',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Backspace: 'Backspace',
  Space: ' ',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
};

// ── AG-CORR-06: held-mouse registry ─────────────────────────────────────────
// Sessions whose Playwright mouse button is currently DOWN without a
// guaranteed matching up() (hold_element with holdTimeMs=0). The orchestrator
// finally block calls releaseAllHeldMice() at turn end so a persistent HITL
// session never keeps a stuck mouse button down.
const sessionsWithHeldMouse = new Set<BrowserSession>();

/**
 * AG-CORR-06: release every held mouse button recorded by hold_element
 * (holdTimeMs=0) across all sessions. Guarded per session; sessions whose
 * release succeeds (or whose page is already gone) are unregistered.
 */
export async function releaseAllHeldMice(): Promise<void> {
  for (const session of Array.from(sessionsWithHeldMouse)) {
    try {
      await session.releaseHeldMouse();
    } catch { /* best-effort — never block turn teardown */ }
    sessionsWithHeldMouse.delete(session);
  }
}

/** Normalises a raw key string, handling aliases and combo modifiers like "Ctrl+A". */
function normalizeKey(key: string): string {
  // Handle combos: "Ctrl+A", "Meta+Shift+Z", etc.
  return key
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      // Case-insensitive alias lookup
      const alias = Object.entries(KEY_ALIASES).find(
        ([k]) => k.toLowerCase() === trimmed.toLowerCase()
      );
      return alias ? alias[1] : trimmed;
    })
    .join('+');
}

/**
 * Known captcha widget container selectors (AG-SAF-08). Generic programmatic
 * captcha interaction is only permitted inside one of these containers.
 */
export const KNOWN_CAPTCHA_WIDGET_SELECTORS: string[] = [
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[src*="challenges.cloudflare.com" i]',
  '.g-recaptcha',
  '.h-recaptcha',
  '[data-sitekey]',
  '.cf-turnstile',
  '.captcha',
];

/**
 * Decide whether a page exposes a known captcha widget (AG-SAF-08).
 * `matchedSelectors` are the allowlist selectors that matched on the page.
 * Returns false for empty/null/undefined input.
 */
export function isKnownCaptchaPage(matchedSelectors: string[] | null | undefined): boolean {
  if (!matchedSelectors || !Array.isArray(matchedSelectors) || matchedSelectors.length === 0) {
    return false;
  }
  return matchedSelectors.some(sel =>
    typeof sel === 'string' && KNOWN_CAPTCHA_WIDGET_SELECTORS.includes(sel)
  );
}

/**
 * Union of every browser action Navis can execute (grouped by phase in NAVIS.md);
 * each member is dispatched in executeAction's switch.
 */
export type ActionName =
  | 'go_to_url'
  | 'go_back'
  | 'click_element'
  | 'click_text'
  | 'smart_click'
  | 'input_text'
  | 'smart_type'
  | 'hold_element'
  | 'drag_element'
  | 'press_key'
  | 'scroll_down'
  | 'scroll_up'
  | 'wait'
  | 'extract_content'
  | 'extract'
  | 'open_tab'
  | 'switch_tab'
  | 'close_tab'
  | 'wait_for_navigation'
  | 'wait_for_dom_change'
  | 'solve_captcha'
  | 'done'
  // Phase 2: Advanced Form Interactions
  | 'upload_file'
  | 'select_option'
  | 'set_date'
  | 'drag_and_drop'
  | 'hover'
  | 'right_click'
  // Phase 3: Vision-Grounding Hybrid
  | 'hybrid_click'
  // EverFern Cloud / TARS specific actions
  | 'browser_click'
  | 'browser_type'
  | 'browser_double_click'
  | 'browser_right_click'
  | 'browser_hover'
  | 'focus_form'
  | 'unfocus_form'
  | 'take_screenshot';

/**
 * Standard outcome for every action: `stateChanged` tells the agent loop
 * whether the page snapshot must be re-captured before the next decision.
 */
export interface ActionResult {
  success: boolean;
  message: string;
  stateChanged: boolean;
  data?: unknown;
}

// Valid ARIA role names accepted by Playwright's getByRole — metadata roles are
// checked against this set so junk scraped values can't throw at locator-build time.
const PLAYWRIGHT_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

// Escapes backslashes and quotes so metadata-derived values (id/name/testId)
// can be interpolated into CSS attribute selectors without breaking them.
function cssAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function existingLocator(locator: any, method: string): Promise<{ locator: any; method: string } | null> {
  // .first() avoids Playwright strict-mode errors when a strategy's selector matches several nodes.
  const first = locator.first();
  if (await first.count().catch(() => 0) > 0) {
    return { locator: first, method };
  }
  return null;
}

function metadataLabel(meta: RefMetadata | null, ref: string): string {
  return meta?.name || meta?.label || meta?.placeholder || meta?.nearbyText || meta?.href || ref;
}

// ── Multi-Strategy Element Finder ───────────────────────────────
/**
 * Resolves a capture-time ref back to a live locator via 8 ordered strategies
 * (data-ref first, nth-index last) so elements survive SPA rerenders. Throws if all fail.
 * @param opts.resolveClickableAncestor re-target clicks at a clickable ancestor of the matched node.
 */
export async function findElement(
  page: Page,
  ref: string,
  logger?: NavisLogger,
  opts: { resolveClickableAncestor?: boolean } = {}
): Promise<{ locator: any; name: string }> {
  const meta = getRefMetadata(page, ref);

  const strategies: Array<() => Promise<{ locator: any; method: string } | null>> = [
    // Strategy 1: data-ref (set by our capture script)
    async () => {
      const loc = page.locator(`[data-ref="${ref}"], [data-scroll-ref="${ref}"]`);
      return existingLocator(loc, 'data-ref');
    },
    // Strategy 2: aria-ref
    async () => {
      const loc = page.locator(`[aria-ref="${ref}"], aria-ref=${ref}`);
      return existingLocator(loc, 'aria-ref');
    },
    // Strategy 3: Stable selector captured from the DOM JSON
    async () => {
      if (!meta?.selector) return null;
      try {
        return await existingLocator(page.locator(meta.selector), 'metadata-selector');
      } catch {
        return null;
      }
    },
    // Strategy 4: Attribute selectors that usually survive React/Vue rerenders
    async () => {
      if (!meta) return null;
      const locators: any[] = [];
      if (meta.id) locators.push(page.locator(`[id="${cssAttr(meta.id)}"]`));
      if (meta.testId) {
        const value = cssAttr(meta.testId);
        locators.push(page.locator(`[data-testid="${value}"], [data-test="${value}"], [data-cy="${value}"]`));
      }
      if (meta.nameAttr) {
        const tag = meta.tag && /^[a-z][a-z0-9-]*$/i.test(meta.tag) ? meta.tag : '';
        locators.push(page.locator(`${tag}[name="${cssAttr(meta.nameAttr)}"]`));
      }
      for (const loc of locators) {
        const found = await existingLocator(loc, 'metadata-attribute');
        if (found) return found;
      }
      return null;
    },
    // Strategy 5: Accessibility role/name. Good after SPA rerenders.
    async () => {
      const role = meta?.role;
      const name = meta?.name || meta?.label || meta?.placeholder;
      if (!role || !name || !PLAYWRIGHT_ROLES.has(role)) return null;
      try {
        return await existingLocator((page as any).getByRole(role, { name, exact: false }), 'role-name');
      } catch {
        return null;
      }
    },
    // Strategy 6: Input-specific selectors
    async () => {
      const label = meta?.label || meta?.name;
      if (label) {
        const found = await existingLocator(page.getByLabel(label, { exact: false }), 'label');
        if (found) return found;
      }
      if (meta?.placeholder) {
        const found = await existingLocator(page.getByPlaceholder(meta.placeholder, { exact: false }), 'placeholder');
        if (found) return found;
      }
      return null;
    },
    // Strategy 7: Try text content from metadata or live data-ref
    async () => {
      let text = meta?.name || meta?.label || meta?.nearbyText || '';
      try {
        text ||= await page.getAttribute(`[data-ref="${ref}"]`, 'aria-label').catch(() => '') ||
          await page.textContent(`[data-ref="${ref}"]`).catch(() => '') ||
          '';
      } catch {}
      if (text && text.trim().length > 2) {
        return existingLocator(page.getByText(text.trim().slice(0, 50), { exact: false }), 'text-match');
      }
      return null;
    },
    // Strategy 8: Parse ref number, try nth-of-type as the last resort.
    async () => {
      const match = ref.match(/e(\d+)/);
      if (!match) return null;
      const index = parseInt(match[1], 10) - 1;
      const loc = page.locator('button, a, input, select, textarea, [role="button"], [role="link"], [data-scroll-ref]').nth(index);
      if (await loc.count() > 0 && await loc.isVisible()) return { locator: loc, method: 'nth-index' };
      return null;
    },
  ];

  for (const strategy of strategies) {
    const result = await strategy();
    if (result) {
      const name = await result.locator.getAttribute('aria-label').catch(() => '') ||
                     await result.locator.textContent().catch(() => '') ||
                     metadataLabel(meta, ref);
      console.log(`[Navis] Element found using ${result.method}: ${name.slice(0, 30)}`);
      let finalLocator = result.locator;

      if (opts.resolveClickableAncestor) {
        try {
          const resolvedSelector = await result.locator.evaluate((el: Element) => {
            const isInteractive = (node: Element) => {
              const tag = node.tagName.toLowerCase();
              const role = node.getAttribute('role');
              return ['input', 'textarea', 'select', 'button', 'a', 'summary'].includes(tag) ||
                     ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option'].includes(role || '') ||
                     node.hasAttribute('onclick');
            };

            if (isInteractive(el)) {
              return null; // Keep self
            }

            let current = el.parentElement;
            for (let i = 0; i < 5 && current; i++) {
              if (isInteractive(current)) {
                const id = current.id;
                if (id) return `#${CSS.escape(id)}`;
                
                // Random per-call value so concurrent ancestor marks can't collide,
                // and the unique attr gives Node a plain CSS selector back.
                const attr = 'data-navis-click-ancestor';
                const val = 'c-' + Math.random().toString(36).slice(2, 9);
                current.setAttribute(attr, val);
                return `[${attr}="${val}"]`;
              }
              current = current.parentElement;
            }
            return null;
          });

          if (resolvedSelector) {
            console.log(`[Navis] Resolving to interactive ancestor selector: ${resolvedSelector}`);
            finalLocator = page.locator(resolvedSelector);
          }
        } catch (evalErr) {
          console.warn('[Navis] Failed to resolve interactive ancestor:', evalErr);
        }
      }

      return { locator: finalLocator, name: name || ref };
    }
  }

  throw new Error(`Element with ref=${ref} not found after trying ${strategies.length} strategies`);
}

async function scrollIntoViewForAction(locator: any): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 700 }).catch(() => {});
}

async function waitForFastPageSettle(page: Page): Promise<void> {
  // domcontentloaded can hang indefinitely on live pages, so the race caps the settle wait at 180ms.
  await Promise.race([
    page.waitForLoadState('domcontentloaded', { timeout: 900 }).catch(() => null),
    new Promise(resolve => setTimeout(resolve, 180)),
  ]);
}

function sleep(ms: number): Promise<void> {
  // Single shared sleep helper — used to bound race windows in change-watching
  // rather than sprinkling ad-hoc setTimeout promises across every action.
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Prefixes scheme-less URLs: local hosts get http, everything else https.
function normalizeNavUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^(https?:|file:|data:|about:)/i.test(trimmed)) return trimmed;
  const host = trimmed.split('/')[0].replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:') ||
    host === '0.0.0.0' ||
    host.startsWith('0.0.0.0:') ||
    host === '::1' ||
    host.startsWith('::1:');
  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}

// Returns the role only if it's a real Playwright role: invalid scraped role
// strings must degrade to undefined rather than reaching getByRole and throwing.
function toRole(value?: string): string | undefined {
  const role = String(value || '').toLowerCase().trim();
  return PLAYWRIGHT_ROLES.has(role) ? role : undefined;
}

function normalizeTypedText(value: unknown): string {
  // CRLF → LF before comparison: Playwright's typed input reports \n even when
  // the caller passed \r\n, so verification would otherwise always mismatch.
  return String(value ?? '').replace(/\r\n/g, '\n');
}

// Scores up to 30 matched nodes in-page (visibility, enabled state, viewport,
// text match, size) and returns the best one, so ambiguous text targets resolve
// to the most plausible element instead of Playwright's first match.
async function existingVisibleLocator(
  locator: any,
  method: string,
  target = '',
  opts: { inputOnly?: boolean; href?: string } = {},
): Promise<{ locator: any; method: string } | null> {
  const count = Math.min(await locator.count().catch(() => 0), 30);
  if (count <= 0) return null;

  const scores = await locator.evaluateAll((nodes: Element[], scoring: { target: string; href: string; inputOnly: boolean }) => {
    const normalize = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = normalize(scoring.target);
    const wantedHref = normalize(scoring.href);
    const inputOnly = Boolean(scoring.inputOnly);
    const inputTags = new Set(['input', 'textarea', 'select']);
    const clickTags = new Set(['button', 'a', 'summary']);
    const inputRoles = new Set(['textbox', 'searchbox', 'combobox']);
    const clickRoles = new Set(['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch']);

    const labelFor = (el: Element) => {
      const id = (el as HTMLElement).id;
      const direct = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
      const wrapping = el.closest('label')?.textContent || '';
      const labelledBy = (el.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map(idPart => document.getElementById(idPart)?.textContent || '')
        .join(' ');
      return normalize(direct || wrapping || labelledBy);
    };

    return nodes.slice(0, 30).map((node, index) => {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const role = normalize(el.getAttribute('role'));
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0;
      const disabled = (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true';
      const inViewport = rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
      const aria = normalize(el.getAttribute('aria-label'));
      const placeholder = normalize(el.getAttribute('placeholder'));
      const title = normalize(el.getAttribute('title'));
      const name = normalize(el.getAttribute('name'));
      const id = normalize(el.getAttribute('id'));
      const value = normalize((el as HTMLInputElement).value);
      const href = normalize((el as HTMLAnchorElement).href || el.getAttribute('href'));
      const text = normalize(el.textContent);
      const label = labelFor(el);
      const haystacks = [aria, placeholder, title, label, value, text, name, id].filter(Boolean);

      let score = 0;
      if (visible) score += 100;
      else score -= 220;
      if (!disabled) score += 20;
      else score -= 120;
      if (inViewport) score += 25;

      const isInput = inputTags.has(tag) || inputRoles.has(role) || el.isContentEditable;
      const isClick = clickTags.has(tag) || clickRoles.has(role) || el.hasAttribute('onclick') || (el as HTMLElement).tabIndex >= 0;
      if (inputOnly) {
        score += isInput ? 70 : -90;
      } else {
        score += isClick ? 45 : 0;
        if (tag === 'button' || role === 'button') score += 24;
        if (tag === 'a' || role === 'link') score += 18;
      }

      if (wanted) {
        let bestTextScore = -20;
        for (const item of haystacks) {
          if (item === wanted) bestTextScore = Math.max(bestTextScore, 100);
          else if (item.startsWith(wanted)) bestTextScore = Math.max(bestTextScore, 72);
          else if (item.includes(wanted)) bestTextScore = Math.max(bestTextScore, 45);
          else if (wanted.includes(item) && item.length > 2) bestTextScore = Math.max(bestTextScore, 24);
        }
        score += bestTextScore;
        if (text.length > wanted.length * 8 && text.length > 120) score -= 35;
      }

      if (wantedHref && href.includes(wantedHref)) score += 90;
      const area = rect.width * rect.height;
      if (area > window.innerWidth * window.innerHeight * 0.6) score -= 45;
      if (area < 8) score -= 20;

      return { index, score };
    });
  }, { target, href: opts.href || '', inputOnly: Boolean(opts.inputOnly) }).catch(() => []);

  const best = scores
    .filter((item: { index: number; score: number }) => Number.isFinite(item.score))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)[0];

  if (best) return { locator: locator.nth(best.index), method };
  return { locator: locator.first(), method };
}

type BrowserChangeWatcher = {
  beforeUrl: string;
  popup: Promise<Page | null>;
  urlChanged: Promise<boolean>;
  domChanged: Promise<boolean>;
};

// Starts three concurrent change watchers (popup, URL, DOM) BEFORE acting, so
// whichever page change fires first during the action can be observed.
function startBrowserChangeWatch(page: Page, timeout = 2200): BrowserChangeWatcher {
  const beforeUrl = page.url();
  return {
    beforeUrl,
    popup: page.context().waitForEvent('page', { timeout }).catch(() => null),
    urlChanged: page.waitForURL(url => url.toString() !== beforeUrl, { timeout }).then(() => true).catch(() => false),
    domChanged: page.evaluate((watchMs) => new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (changed: boolean) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(changed);
      };

      // Navis's own annotations/overlay mutate the DOM too — ignore those so
      // marking elements never counts as a "page changed" signal.
      const isNavisMutation = (mutation: MutationRecord) => {
        const target = mutation.target as Element | null;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
        const el = target as Element;
        if (el.closest?.('[data-navis-overlay], .navis-overlay, #navis-overlay')) return true;
        if (mutation.type === 'attributes') {
          const name = mutation.attributeName || '';
          return name.startsWith('data-navis') || name === 'aria-ref';
        }
        return false;
      };

      const observer = new MutationObserver((mutations) => {
        if (mutations.some(mutation => !isNavisMutation(mutation))) finish(true);
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      setTimeout(() => finish(false), Math.max(150, Number(watchMs) || 1200));
    }), Math.min(timeout, 1600)).catch(() => false),
  };
}

async function finishBrowserChangeWatch(
  watcher: BrowserChangeWatcher,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<{ changed: boolean; newPage?: Page; message?: string }> {
  // First change signal wins; the 550ms sleep bounds the grace window so a
  // no-op action doesn't stall the step waiting for a change that never comes.
  const outcome = await Promise.race([
    watcher.popup.then(popup => popup ? ({ type: 'popup' as const, popup }) : null),
    watcher.urlChanged.then(changed => changed ? ({ type: 'url' as const }) : null),
    watcher.domChanged.then(changed => changed ? ({ type: 'dom' as const }) : null),
    sleep(550).then(() => null),
  ]);

  if (outcome?.type === 'popup') {
    const popup = outcome.popup;
    await popup.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await popup.bringToFront().catch(() => {});
    session.setActivePage(popup);
    invalidateElementSnapshotCache(popup);
    logger?.tabChange(step, maxSteps, `switched to new tab: ${popup.url()}`);
    return { changed: true, newPage: popup, message: `Opened new tab: ${popup.url()}` };
  }

  if (outcome?.type === 'url' || page.url() !== watcher.beforeUrl) {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 800 }).catch(() => {});
    invalidateElementSnapshotCache(page);
    return { changed: true, message: `Page changed to ${page.url()}` };
  }

  if (outcome?.type === 'dom') {
    await waitForFastPageSettle(page);
    invalidateElementSnapshotCache(page);
    return { changed: true, message: 'Page DOM changed' };
  }

  await waitForFastPageSettle(page);
  invalidateElementSnapshotCache(page);
  return { changed: false };
}

// Finds an element a human would recognise by visible text/label: role-based,
// label/placeholder/title, and text-filtered lookups in order, then a fuzzy
// in-page DOM scan that marks the best match with a unique attribute.
async function findHumanTarget(
  page: Page,
  target: string,
  opts: { role?: string; href?: string; inputOnly?: boolean } = {},
): Promise<{ locator: any; name: string; method: string }> {
  const text = String(target || '').replace(/\s+/g, ' ').trim();
  if (!text && !opts.href) throw new Error('Missing target text');

  const candidates: Array<() => Promise<{ locator: any; method: string } | null>> = [];
  const preferredRoles = opts.inputOnly
    ? ['textbox', 'searchbox', 'combobox']
    : [toRole(opts.role), 'button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch']
        .filter(Boolean) as string[];

  for (const role of preferredRoles) {
    candidates.push(async () => {
      if (!text) return null;
      try {
        return await existingVisibleLocator((page as any).getByRole(role, { name: text, exact: false }), `role:${role}`, text, opts);
      } catch {
        return null;
      }
    });
  }

  if (opts.href) {
    candidates.push(async () => {
      try {
        return await existingVisibleLocator(page.locator(`a[href*="${cssAttr(opts.href || '')}"]`), 'href', text, opts);
      } catch {
        return null;
      }
    });
  }

  if (text) {
    candidates.push(
      async () => existingVisibleLocator(page.getByLabel(text, { exact: false }), 'label', text, opts),
      async () => existingVisibleLocator(page.getByPlaceholder(text, { exact: false }), 'placeholder', text, opts),
      async () => existingVisibleLocator(page.getByTitle(text, { exact: false }), 'title', text, opts),
      async () => {
        const selector = opts.inputOnly
          ? 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]'
          : 'button, a, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
        return existingVisibleLocator(page.locator(selector).filter({ hasText: text }), 'filtered-text', text, opts);
      },
      async () => existingVisibleLocator(page.getByText(text, { exact: false }), 'page-text', text, opts),
    );
  }

  for (const candidate of candidates) {
    const found = await candidate().catch(() => null);
    if (found) {
      const name = await found.locator.getAttribute('aria-label').catch(() => '') ||
        await found.locator.getAttribute('placeholder').catch(() => '') ||
        await found.locator.textContent().catch(() => '') ||
        text ||
        opts.href ||
        'element';
      return { locator: found.locator, name: String(name).replace(/\s+/g, ' ').trim(), method: found.method };
    }
  }

  const marker = `navis-smart-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marked = await page.evaluate(({ text: needle, inputOnly, marker }) => {
    const normalize = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = normalize(needle);
    if (!wanted) return false;
    const selector = inputOnly
      ? 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]'
      : 'button, a, input, select, textarea, summary, [role], [onclick], [tabindex]:not([tabindex="-1"])';
    const associatedLabel = (el: Element) => {
      const id = (el as HTMLElement).id;
      const direct = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
      const wrapping = el.closest('label')?.textContent || '';
      const labelledBy = (el.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map(idPart => document.getElementById(idPart)?.textContent || '')
        .join(' ');
      return [direct, wrapping, labelledBy].filter(Boolean).join(' ');
    };
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
      const labels = [
        el.getAttribute('aria-label'),
        associatedLabel(el),
        el.getAttribute('placeholder'),
        el.getAttribute('title'),
        el.textContent,
        el.getAttribute('value'),
        el.getAttribute('name'),
        el.getAttribute('id'),
      ].map(value => normalize(value)).filter(Boolean);
      const label = labels.join(' | ');
      if (label.includes(wanted)) {
        el.setAttribute('data-navis-smart-target', marker);
        return true;
      }
    }
    return false;
  }, { text, inputOnly: Boolean(opts.inputOnly), marker }).catch(() => false);

  if (marked) {
    return { locator: page.locator(`[data-navis-smart-target="${marker}"]`).first(), name: text || opts.href || 'element', method: 'dom-fuzzy' };
  }

  throw new Error(`Could not find browser target "${text || opts.href}"`);
}

// Last-resort click: replays the full pointer/mouse event sequence in-page for
// SPAs that swallow Playwright's trusted mouse events but do react to
// dispatched DOM events.
async function dispatchDomClick(locator: any): Promise<boolean> {
  return Boolean(await locator.evaluate((el: HTMLElement) => {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      el.focus?.({ preventScroll: true });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const eventBase = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
        button: 0,
        buttons: 1,
      };
      const PointerEventCtor = (window as any).PointerEvent;
      if (PointerEventCtor) {
        el.dispatchEvent(new PointerEventCtor('pointerover', { ...eventBase, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEventCtor('pointerenter', { ...eventBase, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEventCtor('pointerdown', { ...eventBase, pointerId: 1, pointerType: 'mouse' }));
      }
      el.dispatchEvent(new MouseEvent('mouseover', eventBase));
      el.dispatchEvent(new MouseEvent('mouseenter', eventBase));
      el.dispatchEvent(new MouseEvent('mousedown', eventBase));
      el.dispatchEvent(new MouseEvent('mouseup', { ...eventBase, buttons: 0 }));
      if (PointerEventCtor) {
        el.dispatchEvent(new PointerEventCtor('pointerup', { ...eventBase, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
      }
      if (typeof (el as HTMLButtonElement | HTMLAnchorElement).click === 'function') {
        (el as HTMLButtonElement | HTMLAnchorElement).click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { ...eventBase, buttons: 0 }));
      }
      return true;
    } catch {
      return false;
    }
  }).catch(() => false));
}

// Fallback click via raw mouse events at the element's center — works when
// locator.click() is blocked by overlays but the coordinates are still valid.
async function clickAtLocatorCenter(page: Page, locator: any): Promise<boolean> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return false;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY).catch(() => {});
  await page.mouse.down().catch(() => {});
  await sleep(20);
  await page.mouse.up().catch(() => {});
  return true;
}

/**
 * Installs a one-shot click listener on the element and returns the probe token,
 * or null if the page context is gone. `performReliableClick` uses the probe to
 * distinguish "click dispatched" from "click actually received by the page".
 */
export async function installLocatorClickProbe(locator: any): Promise<string | null> {
  const token = `navis-click-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const installed = await locator.evaluate((el: HTMLElement, probeToken: string) => {
    try {
      const w = window as any;
      w.__navisElementClickProbe ||= {};
      w.__navisElementClickProbe[probeToken] = false;
      el.addEventListener('click', () => {
        w.__navisElementClickProbe[probeToken] = true;
      }, { capture: true, once: true });
      return true;
    } catch {
      return false;
    }
  }, token).catch(() => false);
  return installed ? token : null;
}

/**
 * Reads whether the probe's click listener fired. Returns true when the token
 * is null/lookup fails so a missing probe never blocks the click path.
 */
export async function locatorClickProbeFired(locator: any, token: string | null): Promise<boolean> {
  if (!token) return true;
  return Boolean(await locator.evaluate((_el: HTMLElement, probeToken: string) => {
    // AG-MEM-08: read AND delete in one round-trip so probe tokens never
    // accumulate on window for the lifetime of the page.
    const fired = Boolean((window as any).__navisElementClickProbe?.[probeToken]);
    try { delete (window as any).__navisElementClickProbe?.[probeToken]; } catch {}
    return fired;
  }, token).catch(() => true));
}

/** AG-MEM-08: best-effort removal of every probe token installed during one click. */
async function cleanupProbeTokens(locator: any, tokens: (string | null)[]): Promise<void> {
  const live = tokens.filter((t): t is string => Boolean(t));
  if (live.length === 0) return;
  await locator.evaluate((_el: HTMLElement, probeTokens: string[]) => {
    const w = window as any;
    for (const t of probeTokens) {
      try { delete w.__navisElementClickProbe?.[t]; } catch {}
    }
  }, live).catch(() => {});
}

/**
 * Clicks a locator via escalating methods (Playwright → force → mouse → DOM events),
 * verifying each attempt with a click probe so a silently-swallowed click triggers
 * the next fallback. Always cleans up its probe tokens (AG-MEM-08).
 */
export async function performReliableClick(page: Page, locator: any): Promise<{ ok: boolean; method: string }> {
  const attempts: Array<{ method: string; run: () => Promise<boolean> }> = [
    {
      method: 'playwright',
      run: async () => locator.click({ timeout: 1100, force: false }).then(() => true),
    },
    {
      method: 'playwright-force',
      run: async () => locator.click({ timeout: 900, force: true }).then(() => true),
    },
    {
      method: 'mouse-center',
      run: async () => clickAtLocatorCenter(page, locator),
    },
    {
      method: 'dom-events',
      run: async () => dispatchDomClick(locator),
    },
  ];

  const tokens: (string | null)[] = [];
  for (const attempt of attempts) {
    // A fresh probe per attempt: each method must prove its own click landed,
    // so a previous attempt's listener can't satisfy the next one's check.
    const probe = await installLocatorClickProbe(locator);
    tokens.push(probe);
    const ok = await attempt.run().catch(() => false);
    if (ok && await locatorClickProbeFired(locator, probe)) {
      // Early exit path must also clean up — earlier attempts left live tokens behind.
      await cleanupProbeTokens(locator, tokens);
      return { ok: true, method: attempt.method };
    }
  }

  // Failure path cleanup: every installed token is removed even when no attempt succeeded.
  await cleanupProbeTokens(locator, tokens);
  return { ok: false, method: 'none' };
}

async function readLocatorEditableValue(locator: any): Promise<string | null> {
  // Handles the three editable shapes uniformly — real input/textarea/select
  // (`.value`), contenteditable hosts (`.textContent`), and non-standard
  // elements that only expose a `value` attribute.
  const value = await locator.evaluate((el: HTMLElement) => {
    const node = el as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
    if ('value' in node) return String(node.value ?? '');
    if (el.isContentEditable) return el.textContent || '';
    return el.getAttribute('value') || el.textContent || '';
  }).catch(() => null);
  return value == null ? null : normalizeTypedText(value);
}

async function isEditableLocator(locator: any): Promise<boolean> {
  return Boolean(await locator.evaluate((el: HTMLElement) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    return el.isContentEditable ||
      ['input', 'textarea', 'select'].includes(tag) ||
      ['textbox', 'searchbox', 'combobox'].includes(role) ||
      el.getAttribute('contenteditable') === 'true';
  }).catch(() => false));
}

async function domSetEditableValue(locator: any, text: string): Promise<boolean> {
  return Boolean(await locator.evaluate((el: HTMLElement, nextValue: string) => {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      el.focus?.({ preventScroll: true });

      const protoInput = window.HTMLInputElement?.prototype;
      const protoTextArea = window.HTMLTextAreaElement?.prototype;
      const protoSelect = window.HTMLSelectElement?.prototype;
      const node = el as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;

      // Call the prototype's native value setter directly: React/Vue override
      // the property with their own setter that ignores programmatic writes, so
      // plain `node.value = x` silently fails on controlled inputs.
      const setNativeValue = (target: any, value: string) => {
        const proto =
          target instanceof HTMLInputElement ? protoInput :
          target instanceof HTMLTextAreaElement ? protoTextArea :
          target instanceof HTMLSelectElement ? protoSelect :
          null;
        const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (descriptor?.set) descriptor.set.call(target, value);
        else target.value = value;
      };

      if (el.isContentEditable) {
        el.textContent = nextValue;
      } else if ('value' in node) {
        setNativeValue(node, nextValue);
      } else {
        el.setAttribute('value', nextValue);
        el.textContent = nextValue;
      }

      const inputType = el.isContentEditable ? 'insertText' : 'insertReplacementText';
      const InputEventCtor = (window as any).InputEvent;
      if (InputEventCtor) {
        el.dispatchEvent(new InputEventCtor('beforeinput', { bubbles: true, cancelable: true, inputType, data: nextValue }));
        el.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType, data: nextValue }));
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
      return true;
    } catch {
      return false;
    }
  }, text).catch(() => false));
}

// Types text via 3 escalating strategies (sequential press → keyboard clear
// with triple-click fallback → direct DOM value), verifying the field's value
// after each attempt so controlled React inputs are caught before falling through.
async function performReliableType(page: Page, locator: any, text: string): Promise<{ ok: boolean; method: string; value?: string | null }> {
  const expected = normalizeTypedText(text);
  const verify = async (method: string) => {
    const value = await readLocatorEditableValue(locator);
    return {
      ok: value === expected,
      method,
      value,
    };
  };

  const attempts: Array<{ method: string; run: () => Promise<void> }> = [
    {
      method: 'press-sequentially',
      run: async () => {
        await locator.clear({ timeout: 500 }).catch(() => {});
        await locator.pressSequentially(text, { delay: 10, timeout: 1200 });
      },
    },
    {
      // BrowserOS pattern: click → Ctrl+A → Backspace, then check if still populated.
      // If value is STILL there after Ctrl+A+Backspace (React controlled inputs), use
      // a triple-click to select-all before overwriting. This is the most reliable
      // strategy for controlled React/Vue inputs that ignore programmatic clear().
      method: 'click-keyboard',
      run: async () => {
        const box = await locator.boundingBox().catch(() => null);
        const cx = box ? box.x + box.width / 2 : undefined;
        const cy = box ? box.y + box.height / 2 : undefined;

        await locator.click({ timeout: 800, force: true }).catch(() => clickAtLocatorCenter(page, locator));
        const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await page.keyboard.press(selectAll).catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});

        // BrowserOS triple-click fallback: if value is still populated, the field
        // uses controlled state and ignores keyboard clear — select-all via triple click.
        const stillPopulated = await readLocatorEditableValue(locator).then((v) => Boolean(v));
        if (stillPopulated && cx !== undefined && cy !== undefined) {
          await page.mouse.click(cx, cy, { clickCount: 3 }).catch(() => {});
        }

        await page.keyboard.type(text, { delay: 0 });
      },
    },
    {
      method: 'dom-value',
      run: async () => {
        const ok = await domSetEditableValue(locator, text);
        if (!ok) throw new Error('DOM value assignment failed');
      },
    },
  ];

  for (const attempt of attempts) {
    await attempt.run().catch(() => {});
    const result = await verify(attempt.method);
    if (result.ok) return result;
  }

  const final = await verify('failed');
  return { ok: false, method: final.method, value: final.value };
}

async function dispatchDomClickAtPoint(page: Page, x: number, y: number): Promise<boolean> {
  return Boolean(await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return false;
    try {
      el.focus?.({ preventScroll: true });
      const eventBase = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
        button: 0,
        buttons: 1,
      };
      const PointerEventCtor = (window as any).PointerEvent;
      if (PointerEventCtor) {
        el.dispatchEvent(new PointerEventCtor('pointerdown', { ...eventBase, pointerId: 1, pointerType: 'mouse' }));
      }
      el.dispatchEvent(new MouseEvent('mousedown', eventBase));
      el.dispatchEvent(new MouseEvent('mouseup', { ...eventBase, buttons: 0 }));
      if (PointerEventCtor) {
        el.dispatchEvent(new PointerEventCtor('pointerup', { ...eventBase, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
      }
      if (typeof (el as HTMLButtonElement | HTMLAnchorElement).click === 'function') {
        (el as HTMLButtonElement | HTMLAnchorElement).click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { ...eventBase, buttons: 0 }));
      }
      return true;
    } catch {
      return false;
    }
  }, { x, y }).catch(() => false));
}

async function clickLocator(
  locator: any,
  name: string,
  selectorLabel: string,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  await scrollIntoViewForAction(locator);

  const validation = await validateElement(locator, 'click', logger);
  if (validation !== null) {
    return {
      success: false,
      message: `Target "${truncate(String(name), 40)}" ${validation}. Try waiting, scrolling, or a different target.`,
      stateChanged: false,
    };
  }

  const box = await locator.boundingBox().catch(() => null);
  let position: { x: number; y: number } | undefined;
  const watcher = startBrowserChangeWatch(page);

  if (box) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    position = { x: centerX, y: centerY };
    session.moveCursor(centerX, centerY).catch(() => {});
    session.highlightElement(box).catch(() => {});
  }

  const clickResult = await performReliableClick(page, locator);
  if (!clickResult.ok) {
    return {
      success: false,
      message: `Click failed: target "${truncate(String(name), 40)}" did not accept Playwright, mouse, or DOM click attempts.`,
      stateChanged: false,
    };
  }

  const change = await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
  logger?.elementClick(step, maxSteps, truncate(String(name), 40), `${selectorLabel}:${clickResult.method}`, position);
  await session.setOverlayStatus(`Clicked "${truncate(String(name), 20)}"`);

  return {
    success: true,
    message: change.message ? `Clicked "${name}" via ${clickResult.method}. ${change.message}` : `Clicked "${name}" via ${clickResult.method}`,
    stateChanged: true,
  };
}

async function typeIntoLocator(
  locator: any,
  name: string,
  text: string,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
  submit = false,
): Promise<ActionResult> {
  await scrollIntoViewForAction(locator);

  const validation = await validateElement(locator, 'input', logger);
  if (validation !== null) {
    return {
      success: false,
      message: `Target "${truncate(String(name), 40)}" ${validation}. Try waiting, scrolling, or a different input.`,
      stateChanged: false,
    };
  }

  const box = await locator.boundingBox().catch(() => null);
  let position: { x: number; y: number } | undefined;
  if (box) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    position = { x: centerX, y: centerY };
    session.moveCursor(centerX, centerY).catch(() => {});
    session.highlightElement(box).catch(() => {});
  }

  const typed = await performReliableType(page, locator, text);
  if (!typed.ok) {
    return {
      success: false,
      message: `Typing failed: target "${truncate(String(name), 40)}" value is ${JSON.stringify(typed.value ?? '')} after ${typed.method}; expected ${JSON.stringify(text)}.`,
      stateChanged: false,
    };
  }
  invalidateElementSnapshotCache(page);

  if (submit) {
    const watcher = startBrowserChangeWatch(page);
    await locator.press('Enter', { timeout: 1000 }).catch(() => page.keyboard.press('Enter'));
    await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
  }

  logger?.elementInput(step, maxSteps, truncate(String(name), 30), text, position);
  await session.setOverlayStatus(`Typed "${truncate(text, 20)}"`);
  return { success: true, message: `Entered text into ${name} via ${typed.method}`, stateChanged: Boolean(submit) };
}

// ── Element Validation ─────────────────────────────────────────
// Returns null if element is valid (visible + enabled), or a string explaining why it's not.
async function validateElement(locator: any, action: string, logger?: NavisLogger): Promise<string | null> {
  try {
    const isVisible = await locator.isVisible({ timeout: 300 }).catch(() => false);
    if (!isVisible) {
      console.warn(`[Navis] Element not visible for ${action}`);
      return 'not visible (hidden, offscreen, or covered by another element)';
    }

    const isEnabled = await locator.isEnabled({ timeout: 300 }).catch(() => true);
    if (!isEnabled) {
      console.warn(`[Navis] Element disabled for ${action}`);
      return 'disabled (readonly or grayed out)';
    }

    return null; // valid — element is visible and enabled
  } catch {
    return null; // If validation fails, still try the action
  }
}

/**
 * Main dispatcher: routes an ActionName to its executor, converting any throw
 * into a failed ActionResult so the agent loop always gets a structured outcome.
 */
export async function executeAction(
  actionName: ActionName,
  args: Record<string, unknown>,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
  aiClient?: AIClient,
): Promise<ActionResult> {
  try {
    switch (actionName) {
      case 'go_to_url':
        return await executeGoToUrl(args as { url: string }, page, logger, step, maxSteps);

      case 'go_back':
        return await executeGoBack(page, logger, step, maxSteps);

      case 'click_element':
        return await executeClickElement(args as { ref: string }, page, session, logger, step, maxSteps);

      case 'click_text':
        return await executeClickText(args as { text?: string; target?: string; role?: string; href?: string }, page, session, logger, step, maxSteps);

      case 'smart_click':
        return await executeSmartClick(args as { ref?: string; target?: string; text?: string; role?: string; href?: string; url?: string; x?: number; y?: number }, page, session, logger, step, maxSteps);

      case 'input_text':
        return await executeInputText(args as { ref: string; text: string }, page, session, logger, step, maxSteps);

      case 'smart_type':
        return await executeSmartType(args as { ref?: string; target?: string; text: string; submit?: boolean }, page, session, logger, step, maxSteps);

      case 'hold_element':
        return await executeHoldElement(args as { ref?: string; x?: number; y?: number; holdTimeMs?: number }, page, session, logger, step, maxSteps);

      case 'drag_element':
        return await executeDragElement(args as { sourceRef: string; targetRef?: string; targetX?: number; targetY?: number }, page, session, logger, step, maxSteps);

      case 'press_key':
        return await executePressKey(args as { ref?: string; key: string }, page, session, logger, step, maxSteps);

      case 'scroll_down':
        return await executeScrollDown(page, logger, step, maxSteps, args as { ref?: string });

      case 'scroll_up':
        return await executeScrollUp(page, logger, step, maxSteps, args as { ref?: string });

      case 'wait':
        return await executeWait(args as { ms?: number }, logger, step, maxSteps);

      case 'extract':
      case 'extract_content':
        return await executeExtractContent(args as { goal?: string; click_target?: string }, page, logger, step, maxSteps, aiClient);

      case 'open_tab':
        return await executeOpenTab(args as { url?: string }, session, logger, step, maxSteps);

      case 'switch_tab':
        return await executeSwitchTab(args as { index?: number; target?: string }, session, logger, step, maxSteps);

      case 'close_tab':
        return await executeCloseTab(page, session, logger, step, maxSteps);

      case 'wait_for_navigation':
        return await executeWaitForNavigation(args as { timeoutMs?: number; urlContains?: string }, page, logger, step, maxSteps);

      case 'wait_for_dom_change':
        return await executeWaitForDomChange(args as { text?: string; selector?: string; timeoutMs?: number }, page, logger, step, maxSteps);

      case 'solve_captcha':
        return await executeSolveCaptcha(page, session, logger, step, maxSteps, aiClient);

      case 'done':
        return executeDone(args as { success: boolean; text: string });

      // Phase 2: Advanced Form Interactions
      case 'upload_file':
        return await executeUploadFile(args as any, page, session, logger, step, maxSteps);

      case 'select_option':
        return await executeSelectOption(args as any, page, session, logger, step, maxSteps);

      case 'take_screenshot':
        return await executeTakeScreenshot(args as any, page, session, logger, step, maxSteps);

      case 'set_date':
        return await executeSetDate(args as any, page, session, logger, step, maxSteps);

      case 'drag_and_drop':
        return await executeDragAndDrop(args as any, page, session, logger, step, maxSteps);

      case 'hover':
        return await executeHover(args as any, page, session, logger, step, maxSteps);

      case 'right_click':
        return await executeRightClick(args as any, page, session, logger, step, maxSteps);

      case 'hybrid_click':
        return await executeHybridClick(args as { targetDescription: string; aiClient: AIClient }, page, session, logger, step, maxSteps);

      case 'browser_click':
        return await executeBrowserClick(args as { x: number; y: number }, page, session, logger, step, maxSteps);

      case 'browser_type':
        return await executeBrowserType(args as { text: string }, page, session, logger, step, maxSteps);

      case 'browser_double_click':
        return await executeBrowserDoubleClick(args as { x: number; y: number }, page, session, logger, step, maxSteps);

      case 'browser_right_click':
        return await executeBrowserRightClick(args as { x: number; y: number }, page, session, logger, step, maxSteps);

      case 'browser_hover':
        return await executeBrowserHover(args as { x: number; y: number }, page, session, logger, step, maxSteps);

      case 'focus_form':
      case 'unfocus_form':
        return { success: true, message: `Form scope action executed: ${actionName}`, stateChanged: true };

      default:
        return { success: false, message: `Unknown action: ${actionName}`, stateChanged: false };
    }
  } catch (err: any) {
    return { success: false, message: `Action ${actionName} failed: ${err.message}`, stateChanged: false };
  }
}

async function executeGoToUrl(args: { url: string }, page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  if (!args.url) return { success: false, message: 'Missing url parameter', stateChanged: false };

  const url = normalizeNavUrl(args.url);
  logger?.pageNavigate(step, maxSteps, url);
  invalidateElementSnapshotCache(page);

  // Use a more robust goto that doesn't hang on domcontentloaded
  // Retry with `commit`: fires at the earliest navigation moment, so even a
  // hung domcontentloaded can't strand the agent — worst case we land on a
  // half-loaded page and let per-action settle logic handle it.
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
  } catch (err: any) {
    console.warn(`[Navis] goto(load) failed, retrying with commit: ${err.message}`);
    await page.goto(url, { waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  }

  await page.bringToFront();
  await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});
  invalidateElementSnapshotCache(page);
  return { success: true, message: `Navigated to ${url}`, stateChanged: true };
}

async function executeGoBack(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  try {
    logger?.pageNavigate(step, maxSteps, 'go_back');
    invalidateElementSnapshotCache(page);
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
    invalidateElementSnapshotCache(page);
    return { success: true, message: 'Navigated back to previous page', stateChanged: true };
  } catch (err: any) {
    return { success: false, message: `Go back failed: ${err.message}`, stateChanged: false };
  }
}

async function executeClickElement(
  args: { ref: string },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.ref) return { success: false, message: 'Missing ref parameter', stateChanged: false };

  try {
    const { locator, name } = await findElement(page, args.ref, logger, { resolveClickableAncestor: true });
    return await clickLocator(locator, name, `ref=${args.ref}`, page, session, logger, step, maxSteps);
  } catch (err: any) {
    return { success: false, message: `Click failed: ${err.message}`, stateChanged: false };
  }
}

async function executeClickText(
  args: { text?: string; target?: string; role?: string; href?: string },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const target = String(args.text || args.target || args.href || '').trim();
  if (!target) return { success: false, message: 'Missing text/target parameter', stateChanged: false };
  try {
    const found = await findHumanTarget(page, target, { role: args.role, href: args.href });
    return await clickLocator(found.locator, found.name || target, `click_text:${found.method}`, page, session, logger, step, maxSteps);
  } catch (err: any) {
    return { success: false, message: `Click by text failed: ${err.message}`, stateChanged: false };
  }
}

async function executeSmartClick(
  args: { ref?: string; target?: string; text?: string; role?: string; href?: string; url?: string; x?: number; y?: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  // Priority chain by explicitness: url short-circuits (navigation makes every
  // other targeting mode moot), then explicit ref, then coordinates, then fuzzy text.
  if (args.url) return executeGoToUrl({ url: args.url }, page, logger, step, maxSteps);
  if (args.ref) return executeClickElement({ ref: args.ref }, page, session, logger, step, maxSteps);
  if (args.x !== undefined && args.y !== undefined) return executeBrowserClick({ x: args.x, y: args.y }, page, session, logger, step, maxSteps);

  const target = String(args.target || args.text || args.href || '').trim();
  if (!target) return { success: false, message: 'smart_click requires ref, target/text, href, url, or coordinates', stateChanged: false };
  return executeClickText({ text: target, role: args.role, href: args.href }, page, session, logger, step, maxSteps);
}

async function executeInputText(
  args: { ref: string; text: string },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.ref) return { success: false, message: 'Missing ref parameter', stateChanged: false };
  if (!args.text) return { success: false, message: 'Missing text parameter', stateChanged: false };

  try {
    const { locator, name } = await findElement(page, args.ref, logger);
    return await typeIntoLocator(locator, name, args.text, page, session, logger, step, maxSteps);
  } catch (err: any) {
    return { success: false, message: `Input failed: ${err.message}`, stateChanged: false };
  }
}

async function executeSmartType(
  args: { ref?: string; target?: string; text: string; submit?: boolean },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.text) return { success: false, message: 'Missing text parameter', stateChanged: false };
  try {
    if (args.ref) {
      const { locator, name } = await findElement(page, args.ref, logger);
      return await typeIntoLocator(locator, name, args.text, page, session, logger, step, maxSteps, Boolean(args.submit));
    }
    const target = String(args.target || 'text input').trim();
    const found = await findHumanTarget(page, target, { inputOnly: true });
    return await typeIntoLocator(found.locator, found.name || target, args.text, page, session, logger, step, maxSteps, Boolean(args.submit));
  } catch (err: any) {
    return { success: false, message: `Smart type failed: ${err.message}`, stateChanged: false };
  }
}

async function executePressKey(
  args: { ref?: string; key: string },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.key) return { success: false, message: 'Missing key parameter', stateChanged: false };

  // BrowserOS pattern: normalise key aliases before dispatch so AI-provided
  // strings like "Esc", "Cmd", "Return", "Del", "Ctrl+A" all work correctly.
  const key = normalizeKey(args.key);

  try {
    if (args.ref) {
      const { locator } = await findElement(page, args.ref, logger);
      await scrollIntoViewForAction(locator);

      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        session.moveCursor(centerX, centerY).catch(() => {});
        session.highlightElement(box).catch(() => {});
      }

      const watcher = startBrowserChangeWatch(page);
      try {
        await locator.focus().catch(() => {});
        await page.keyboard.press(key);
      } catch (err) {
        console.warn('[Navis] page.keyboard.press failed, falling back to locator.press:', err);
        await locator.press(key, { timeout: 1500 });
      }
      if (/^(Enter|NumpadEnter)$/i.test(key)) {
        await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
      } else {
        invalidateElementSnapshotCache(page);
      }
      logger?.elementInput(step, maxSteps, `key:${key}`, args.ref);
    } else {
      const watcher = startBrowserChangeWatch(page);
      await page.keyboard.press(key);
      if (/^(Enter|NumpadEnter)$/i.test(key)) {
        await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
      } else {
        invalidateElementSnapshotCache(page);
      }
      logger?.elementInput(step, maxSteps, `key:${key}`, '(global)');
    }
    await session.setOverlayStatus(`Pressed "${key}"`);
    return { success: true, message: `Pressed key: ${key}`, stateChanged: true };
  } catch (err: any) {
    return { success: false, message: `Key press failed: ${err.message}`, stateChanged: false };
  }
}

async function executeScrollDown(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number, args?: { ref?: string }): Promise<ActionResult> {
  if (args?.ref) {
    try {
      const { locator, name } = await findElement(page, args.ref, logger);
      await locator.evaluate((el: HTMLElement) => el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'auto' }));
      invalidateElementSnapshotCache(page);
      logger?.scroll(step, maxSteps, `down on ${name}`);
      return { success: true, message: `Scrolled down on ${name}`, stateChanged: false };
    } catch (err: any) {
      return { success: false, message: `Scroll failed: ${err.message}`, stateChanged: false };
    }
  }
  await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'auto' }));
  invalidateElementSnapshotCache(page);
  logger?.scroll(step, maxSteps, 'down');
  return { success: true, message: 'Scrolled down one page', stateChanged: false };
}

async function executeScrollUp(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number, args?: { ref?: string }): Promise<ActionResult> {
  if (args?.ref) {
    try {
      const { locator, name } = await findElement(page, args.ref, logger);
      await locator.evaluate((el: HTMLElement) => el.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'auto' }));
      invalidateElementSnapshotCache(page);
      logger?.scroll(step, maxSteps, `up on ${name}`);
      return { success: true, message: `Scrolled up on ${name}`, stateChanged: false };
    } catch (err: any) {
      return { success: false, message: `Scroll failed: ${err.message}`, stateChanged: false };
    }
  }
  await page.evaluate(() => window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'auto' }));
  invalidateElementSnapshotCache(page);
  logger?.scroll(step, maxSteps, 'up');
  return { success: true, message: 'Scrolled up one page', stateChanged: false };
}

async function executeWait(args: { ms?: number }, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  // Hard-capped at 3s: the agent loop has a fixed step budget, so an AI that
  // asks for a 30s nap must not burn multiple decision steps on sleeping.
  const ms = Math.min(args.ms ?? 300, 3000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  logger?.wait(step, maxSteps, `${ms}ms`);
  return { success: true, message: `Waited ${ms}ms`, stateChanged: false };
}

async function executeWaitForNavigation(
  args: { timeoutMs?: number; urlContains?: string },
  page: Page,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs || 4000), 500), 15000);
  const beforeUrl = page.url();
  logger?.wait(step, maxSteps, args.urlContains ? `navigation containing "${args.urlContains}"` : 'navigation');

  if (args.urlContains) {
    await page.waitForURL(url => url.toString().includes(String(args.urlContains)), { timeout: timeoutMs }).catch(() => null);
  } else {
    await Promise.race([
      page.waitForURL(url => url.toString() !== beforeUrl, { timeout: timeoutMs }).catch(() => null),
      page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => null),
      sleep(timeoutMs),
    ]);
  }

  await page.waitForLoadState('networkidle', { timeout: 900 }).catch(() => {});
  invalidateElementSnapshotCache(page);
  const afterUrl = page.url();
  return {
    success: true,
    message: afterUrl !== beforeUrl ? `Navigation settled at ${afterUrl}` : `Navigation wait finished at ${afterUrl}`,
    stateChanged: afterUrl !== beforeUrl,
  };
}

async function executeWaitForDomChange(
  args: { text?: string; selector?: string; timeoutMs?: number },
  page: Page,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs || 4000), 500), 15000);
  logger?.wait(step, maxSteps, args?.text ? `DOM text "${args.text}"` : (args?.selector ? `DOM selector "${args.selector}"` : 'DOM change'));

  try {
    if (args?.text) {
      await page.waitForFunction((text) => document.body?.innerText?.includes(text), args.text, { timeout: timeoutMs }).catch(() => null);
    } else if (args?.selector) {
      await page.waitForSelector(args.selector, { timeout: timeoutMs }).catch(() => null);
    } else {
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => null);
    }
    invalidateElementSnapshotCache(page);
    return {
      success: true,
      message: `DOM change wait complete (${timeoutMs}ms limit)`,
      stateChanged: true,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Wait for DOM change failed: ${errorMsg}`,
      stateChanged: false,
    };
  }
}

async function executeExtractContent(
  args: { goal?: string; click_target?: string },
  page: Page,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
  aiClient?: AIClient,
): Promise<ActionResult> {
  const goal = args.goal || 'Extract the relevant page content.';

  try {
    const report = await createNavisExtractionReport(page, goal, aiClient, args.click_target);
    logger?.extract(step, maxSteps, `report saved: ${report.reportPath}`);

    return {
      success: true,
      message: [
        `Extracted page content with the DOM parser${report.usedAI ? ' AI' : ''}.`,
        `Temporary Markdown report: ${report.reportPath}`,
        report.summary ? `Report summary: ${report.summary}` : '',
      ].filter(Boolean).join('\n'),
      stateChanged: false,
      data: {
        reportPath: report.reportPath,
        markdown: report.markdown,
        summary: report.summary,
        usedAI: report.usedAI,
        sourceUrl: report.sourceUrl,
        title: report.title,
      },
    };
  } catch (reportErr) {
    console.warn('[Navis Extract] Report pipeline failed, falling back to cleaned text extraction:', reportErr);
  }

  const content = await page.evaluate(() => {
    // Try to find main content
    const main = document.querySelector('main, [role="main"], article, #content, .content, .main');
    const root = main || document.body;

    // Clone the root to avoid modifying the live page
    const clone = root.cloneNode(true) as HTMLElement;

    // Create an off-screen container so innerText works properly
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-99999px';
    wrapper.style.top = '0';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    // Remove noise from the clone
    const noise = clone.querySelectorAll('script, style, noscript, iframe, svg, nav, footer');
    noise.forEach(s => s.remove());

    // Get text and clean it
    let text = clone.innerText || '';
    text = text.replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

    // Clean up the DOM
    wrapper.remove();

    return text;
  }).catch(() => '');

  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...(truncated)' : content;
  logger?.extract(step, maxSteps, `${truncated.length} chars${args.goal ? ` for: ${args.goal}` : ''}`);

  return {
    success: true,
    message: `Extracted ${truncated.length} chars of cleaned content.`,
    stateChanged: false,
    data: truncated
  };
}

async function executeOpenTab(
  args: { url?: string },
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const url = args.url ? normalizeNavUrl(args.url) : undefined;
  const newPage = await session.openTab(url);
  await newPage.bringToFront();
  invalidateElementSnapshotCache(newPage);
  logger?.tabChange(step, maxSteps, url ? `opened: ${url}` : 'new tab');
  return { success: true, message: `Opened new tab${url ? ': ' + url : ''}`, stateChanged: true };
}

async function executeSwitchTab(args: { index?: number; target?: string }, session: BrowserSession, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  if (args.target) {
    await session.switchToTab(args.target);
    invalidateElementSnapshotCache(session.page);
    logger?.tabChange(step, maxSteps, `switched to tab matching "${args.target}"`);
    return { success: true, message: `Switched to tab matching "${args.target}"`, stateChanged: true };
  }
  if (args.index !== undefined) {
    await session.switchToTab(args.index);
    invalidateElementSnapshotCache(session.page);
    logger?.tabChange(step, maxSteps, `switched to tab ${args.index}`);
    return { success: true, message: `Switched to tab ${args.index}`, stateChanged: true };
  }
  return { success: false, message: 'switch_tab requires index or target parameter', stateChanged: false };
}

async function executeCloseTab(page: Page, session: BrowserSession, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  if (session.allPages.length <= 1) {
    return { success: false, message: 'Cannot close the last tab', stateChanged: false };
  }
  await session.closeTab(page);
  invalidateElementSnapshotCache(session.page);
  logger?.tabChange(step, maxSteps, 'tab closed');
  return { success: true, message: 'Tab closed', stateChanged: true };
}

/**
 * Attempts to clear a captcha: AI visual solver first (if an aiClient is given),
 * then slider heuristics and a container-restricted generic click pass (AG-SAF-08).
 * Never throws — always returns a structured outcome for the agent loop.
 */
async function executeSolveCaptcha(page: Page, session: BrowserSession, logger?: NavisLogger, step?: number, maxSteps?: number, aiClient?: AIClient): Promise<ActionResult> {
  logger?.tabChange(step, maxSteps, 'solving captcha...');
  await session.setOverlayStatus('Solving captcha...');

  // Try AI-powered solving if an AI client is provided
  if (aiClient) {
    console.log('[Navis] AI client provided. Attempting AI-powered visual captcha solver...');
    const aiRes = await tryAiSolveCaptcha(page, aiClient, logger, step, maxSteps);
    if (aiRes.success) {
      // Check if captcha is still present
      const stillCaptcha = await page.evaluate(() => {
        const title = document.title.toLowerCase();
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        return title.includes('captcha') || bodyText.includes('captcha') || bodyText.includes('verify') || bodyText.includes('human');
      });
      if (!stillCaptcha) {
        invalidateElementSnapshotCache(page);
        logger?.tabChange(step, maxSteps, 'AI successfully solved captcha!');
        return { success: true, message: 'Captcha solved by AI, proceeding', stateChanged: true };
      }
      console.log('[Navis] AI solved action executed, but captcha challenge page is still present. Falling back to programmatic solver...');
    } else if (aiRes.attempted) {
      console.log('[Navis] AI captcha solver attempted but failed. Falling back to programmatic solver...');
    }
  }

  // 1. Detect and solve slider captchas
  const handleBox = await page.evaluate(() => {
    const findSliderHandle = () => {
      const selectors = [
        '.slider-button', '.slider-handle', '.geetest_slider_button', 
        '.nc_scale_btn', '.drag-button', '[class*="slider"] button', 
        '[class*="slider"] div[role="button"]', '[class*="slider"] span',
        '[class*="handle"]', '[class*="arrow"]', 'div[aria-label*="slider"]',
        'button[aria-label*="slider"]', '.slider'
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 5 && rect.height > 5) {
            return el;
          }
        }
      }

      const allEls = document.querySelectorAll('button, div, span');
      for (const el of Array.from(allEls)) {
        const text = el.textContent || '';
        const rect = el.getBoundingClientRect();
        if (rect.width > 5 && rect.height > 5 && rect.width < 120) {
          if (text === '→' || text === '->' || el.querySelector('svg') || el.className.includes('arrow') || el.className.includes('btn')) {
            const parentText = el.parentElement?.textContent || '';
            if (parentText.toLowerCase().includes('slide') || parentText.toLowerCase().includes('secure')) {
              return el;
            }
          }
        }
      }
      return null;
    };
    const el = findSliderHandle();
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }).catch(() => null);

  if (handleBox) {
    console.log('[Navis] Slider captcha detected at:', handleBox);
    logger?.tabChange(step, maxSteps, 'slider captcha detected, dragging handle...');
    try {
      const centerX = handleBox.x + handleBox.width / 2;
      const centerY = handleBox.y + handleBox.height / 2;

      await page.mouse.move(centerX, centerY);
      await new Promise(resolve => setTimeout(resolve, 300));
      await page.mouse.down();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Sine-curve jitter + random offsets/delays imitate a human drag;
      // constant-speed drags are trivially detected as automation.
      const slideDistance = 280;
      const dragSteps = 25;
      for (let i = 1; i <= dragSteps; i++) {
        const pct = i / dragSteps;
        const currentX = centerX + (slideDistance * pct);
        const currentY = centerY + Math.sin(pct * Math.PI) * 4 + (Math.random() * 2 - 1);
        await page.mouse.move(currentX, currentY);
        await new Promise(resolve => setTimeout(resolve, 15 + Math.random() * 15));
      }

      await new Promise(resolve => setTimeout(resolve, 300));
      await page.mouse.up();
      console.log('[Navis] Slider drag complete, waiting for validation...');
      await new Promise(resolve => setTimeout(resolve, 3500));
    } catch (err) {
      console.warn('[Navis] Slider solve failed:', err);
    }
  }

  // AG-SAF-08: the generic programmatic captcha interaction is restricted to
  // KNOWN captcha widget containers. Anything confirm-shaped outside a known
  // widget is left alone; pages without a known widget skip generic
  // interaction entirely.
  const solveOutcome = await page.evaluate((widgetSelectors: string[]) => {
    const title = document.title.toLowerCase();
    const bodyText = document.body?.innerText?.toLowerCase() || '';

    const isInsideKnownContainer = (el: Element): boolean => {
      for (const sel of widgetSelectors) {
        try {
          if (el.closest(sel)) return true;
        } catch { /* invalid selector — skip */ }
      }
      return false;
    };

    if (title.includes('hcaptcha') || bodyText.includes('hcaptcha')) {
      const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox && isInsideKnownContainer(checkbox)) { checkbox.click(); return { clicked: true, matchedSelectors: [] }; }
      const label = document.querySelector('label[for]');
      if (label && isInsideKnownContainer(label)) { (label as HTMLElement).click(); return { clicked: true, matchedSelectors: [] }; }
    }

    if (title.includes('cloudflare') || bodyText.includes('cloudflare') || bodyText.includes('verifying')) {
      const checkbox = document.querySelector('#challenge-stage input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox && isInsideKnownContainer(checkbox)) { checkbox.click(); return { clicked: true, matchedSelectors: [] }; }
      const cfBtn = document.querySelector('.cf-solve input, .cf-button, .turnstile-input') as HTMLElement | null;
      if (cfBtn && isInsideKnownContainer(cfBtn)) { cfBtn.click(); return { clicked: true, matchedSelectors: [] }; }
    }

    if (bodyText.includes('confirm you') || bodyText.includes('verify you') || bodyText.includes('security check')) {
      const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
      for (const btn of Array.from(buttons)) {
        const el = btn as HTMLElement;
        if (!isInsideKnownContainer(el)) continue;
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('confirm') || text.includes('verify') || text.includes('continue') || text.includes('proceed')) {
          el.click(); return { clicked: true, matchedSelectors: [] };
        }
      }
      const links = document.querySelectorAll('a');
      for (const link of Array.from(links)) {
        const el = link as HTMLElement;
        if (!isInsideKnownContainer(el)) continue;
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('confirm') || text.includes('verify') || text.includes('continue')) {
          el.click(); return { clicked: true, matchedSelectors: [] };
        }
      }
    }

    const matchedSelectors: string[] = [];
    for (const sel of widgetSelectors) {
      try {
        if (document.querySelector(sel)) matchedSelectors.push(sel);
      } catch { /* invalid selector — skip */ }
    }

    // Checkbox fallback: only checkboxes INSIDE a known captcha container.
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of Array.from(checkboxes)) {
      const el = cb as HTMLInputElement;
      if (!el.checked && isInsideKnownContainer(el)) { el.click(); return { clicked: true, matchedSelectors }; }
    }

    return { clicked: false, matchedSelectors };
  }, KNOWN_CAPTCHA_WIDGET_SELECTORS);

  if (solveOutcome?.clicked) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    invalidateElementSnapshotCache(page);
    logger?.tabChange(step, maxSteps, 'captcha solved, waiting for redirect...');
    return { success: true, message: 'Captcha solved, waiting for page to proceed', stateChanged: true };
  }
  if (!isKnownCaptchaPage(solveOutcome?.matchedSelectors)) {
    console.log('[Navis] solve_captcha: no known captcha widget found - skipping generic interaction');
  }

  await new Promise(resolve => setTimeout(resolve, 1500));
  const stillCaptcha = await page.evaluate(() => {
    const title = document.title.toLowerCase();
    const body = document.body?.innerText?.toLowerCase() || '';
    return title.includes('captcha') || body.includes('captcha') || body.includes('verify') || body.includes('human');
  });

  if (stillCaptcha) {
    return { success: false, message: 'Captcha still present, attempting alternate approach', stateChanged: false };
  }

  return { success: true, message: 'Page no longer shows captcha challenge', stateChanged: true };
}

/**
 * Multimodal harness for the AI captcha solver: screenshots the page,
 * gathers deduped candidate elements, asks the vision model to pick the
 * interactive target, and executes the returned click/drag.
 * Returns { attempted } so the caller can distinguish "model tried" from "no candidates".
 */
async function tryAiSolveCaptcha(
  page: Page,
  aiClient: AIClient,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number
): Promise<{ success: boolean; attempted: boolean }> {
  try {
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 }).then(b => b.toString('base64')).catch(() => null);
    if (!screenshot) {
      console.log('[Navis AI Captcha] Could not capture page screenshot.');
      return { success: false, attempted: false };
    }

    const candidates = await page.evaluate(() => {
      const list: any[] = [];
      // Spatial bucket grid dedupe: many nested/overlapping elements produce
      // near-identical bounding boxes; a 5px grid with ±1 bucket neighbor
      // lookup removes them so the AI prompt isn't flooded with duplicates.
      const buckets = new Map<string, Array<{ x: number; y: number; width: number }>>();
      const bucketKey = (x: number, y: number) => `${Math.round(x / 5)},${Math.round(y / 5)}`;
      const isNear = (a: { x: number; y: number; width: number }, x: number, y: number, width: number) =>
        Math.abs(a.x - x) < 5 && Math.abs(a.y - y) < 5 && Math.abs(a.width - width) < 5;
      const elements = document.querySelectorAll('iframe, input, button, a, [role="button"], .slider-handle, .slider-button, [class*="slider"], [class*="handle"], [data-ref]');
      elements.forEach((el: any) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 3 && rect.height > 3 && rect.top >= 0 && rect.left >= 0) {
          const gx = Math.round(rect.left / 5);
          const gy = Math.round(rect.top / 5);
          let isDup = false;
          // Check the 3x3 bucket neighborhood only — a wider scan would be O(n²)
          // over every candidate; ±1 bucket (~±5px) already covers the isNear tolerance.
          for (let dx = -1; dx <= 1 && !isDup; dx++) {
            for (let dy = -1; dy <= 1 && !isDup; dy++) {
              const bucket = buckets.get(`${gx + dx},${gy + dy}`);
              if (bucket) {
                for (const entry of bucket) {
                  if (isNear(entry, rect.left, rect.top, rect.width)) { isDup = true; break; }
                }
              }
            }
          }
          if (!isDup) {
            // Only after surviving dedupe is the element registered in a bucket,
            // so later siblings overlapping it are correctly filtered out.
            list.push({
              ref: el.getAttribute('data-ref') || el.getAttribute('aria-ref') || '',
              tag: el.tagName,
              type: el.type || '',
              text: (el.textContent || el.value || '').trim().slice(0, 100),
              className: el.className || '',
              id: el.id || '',
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
            const key = bucketKey(rect.left, rect.top);
            const bucket = buckets.get(key);
            if (bucket) {
              bucket.push({ x: rect.left, y: rect.top, width: rect.width });
            } else {
              buckets.set(key, [{ x: rect.left, y: rect.top, width: rect.width }]);
            }
          }
        }
      });
      // Bucket registration uses raw rect coords while bucketKey rounds — a rect
      // straddling a grid line is still findable via its 3x3 neighbor scan.
      return list.slice(0, 50);
    }).catch(() => []);
    // Cap candidates at 50 to keep the AI prompt (and token cost) bounded on
    // element-dense pages; the dedupe pass above keeps the most useful 50.

    console.log(`[Navis AI Captcha] Found ${candidates.length} candidate elements for visual captcha solving.`);

    const userMessageContent: any[] = [];
    if (aiClient.supportsVision()) {
      userMessageContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshot}`,
          detail: 'high'
        }
      });
    }

    userMessageContent.push({
      type: 'text',
      text: `We are on a web page displaying a CAPTCHA, verification check, or security challenge (such as a slider puzzle, a Cloudflare Turnstile checkbox, an hCaptcha/reCAPTCHA check, or a confirm button).

Below is the list of candidate elements retrieved from the page DOM (which may include the slider handle, the checkbox, or the verify button):
${candidates.map((c, i) => `Candidate ${i}: ref="${c.ref}", tag="${c.tag}", text="${c.text}", class="${c.className}", id="${c.id}", boundingBox={x: ${c.x}, y: ${c.y}, w: ${c.width}, h: ${c.height}}`).join('\n')}

Based on the screenshot and the list of candidates, please identify the interactive element to click or drag.
Respond ONLY with a valid JSON object matching this schema:
{
  "type": "slider" | "checkbox" | "button" | "unknown",
  "matchedCandidateIndex": number | null (0-based index of the matched candidate, or null if none),
  "clickX": number | null (X coordinate to click in viewport pixels if no candidate matches),
  "clickY": number | null (Y coordinate to click in viewport pixels if no candidate matches),
  "dragStartX": number | null (starting X coordinate for slider in viewport pixels if no candidate matches),
  "dragStartY": number | null (starting Y coordinate for slider in viewport pixels if no candidate matches),
  "dragDistance": number | null (distance in pixels to drag the slider handle to the right)
}`
    });

    console.log('[Navis AI Captcha] Calling AI to solve captcha...');
    const response = await aiClient.chat({
      messages: [
        { role: 'system', content: 'You are a CAPTCHA solving assistant. Analyze candidate DOM elements and visual screenshots to return precise click/drag targets in the requested JSON format.' },
        { role: 'user', content: userMessageContent }
      ],
      responseFormat: 'json',
      temperature: 0.1
    });

    const rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    console.log('[Navis AI Captcha] AI Response:', rawContent);

    // Extract the outermost {...} block — models often wrap JSON in prose or fences.
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Navis AI Captcha] No valid JSON found in AI response');
      return { success: false, attempted: true };
    }

    const result = JSON.parse(jsonMatch[0]);
    if (!result || result.type === 'unknown') {
      console.log('[Navis AI Captcha] AI could not determine captcha type.');
      return { success: false, attempted: true };
    }

    let clickX = result.clickX;
    let clickY = result.clickY;
    let dragStartX = result.dragStartX;
    let dragStartY = result.dragStartY;

    if (result.matchedCandidateIndex !== null && result.matchedCandidateIndex !== undefined) {
      // Prefer candidate-derived center over the AI's raw clickX/clickY: DOM
      // coordinates are more trustworthy than model-estimated pixel positions.
      const idx = Number(result.matchedCandidateIndex);
      if (idx >= 0 && idx < candidates.length) {
        const c = candidates[idx];
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        if (result.type === 'slider') {
          dragStartX = cx;
          dragStartY = cy;
        } else {
          clickX = cx;
          clickY = cy;
        }
        console.log(`[Navis AI Captcha] AI resolved candidate ${idx} (${c.tag}, ${c.text}) at coordinates (${cx}, ${cy})`);
      }
    }

    if (result.type === 'slider') {
      if (dragStartX === null || dragStartY === null) {
        console.warn('[Navis AI Captcha] Slider coordinates missing.');
        return { success: false, attempted: true };
      }
      // Identical humanisation rationale as the programmatic solver above —
      // detector models score trajectories, not endpoints.
      logger?.tabChange(step, maxSteps, 'AI dragging slider handle...');
      await page.mouse.move(dragStartX, dragStartY);
      await new Promise(r => setTimeout(r, 300));
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 200));

      const slideDistance = result.dragDistance || 280;
      const dragSteps = 30;
      // Sine jitter + random offsets + variable per-step delay mimic human-like
      // drag trajectories; constant-speed drags are trivially flagged as bots.
      for (let i = 1; i <= dragSteps; i++) {
        const pct = i / dragSteps;
        const currentX = dragStartX + (slideDistance * pct);
        const currentY = dragStartY + Math.sin(pct * Math.PI) * 4 + (Math.random() * 2 - 1);
        await page.mouse.move(currentX, currentY);
        await new Promise(r => setTimeout(r, 15 + Math.random() * 15));
      }
      await new Promise(r => setTimeout(r, 300));
      await page.mouse.up();
      console.log('[Navis AI Captcha] AI slider drag complete, waiting for validation...');
      await new Promise(r => setTimeout(r, 4000));
      return { success: true, attempted: true };
    } else if (result.type === 'checkbox' || result.type === 'button') {
      if (clickX === null || clickY === null) {
        console.warn('[Navis AI Captcha] Click coordinates missing.');
        return { success: false, attempted: true };
      }
      logger?.tabChange(step, maxSteps, `AI clicking verification ${result.type}...`);
      await page.mouse.move(clickX, clickY);
      await new Promise(r => setTimeout(r, 200));
      await page.mouse.click(clickX, clickY);
      console.log('[Navis AI Captcha] AI click complete, waiting...');
      await new Promise(r => setTimeout(r, 3000));
      return { success: true, attempted: true };
    }

    return { success: false, attempted: false };
  } catch (err) {
    console.error('[Navis AI Captcha] AI captcha solver error:', err);
    return { success: false, attempted: true };
  }
}

function executeDone(args: { success: boolean; text: string }): ActionResult {
  return { success: args.success, message: args.text, stateChanged: false };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * Dispatches to VisionGroundingHybrid: screenshot + DOM grounding to click a
 * natural-language target description. Gated by the hybridClick config flag.
 */
async function executeHybridClick(
  args: { targetDescription: string; aiClient: AIClient },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.targetDescription) {
    return { success: false, message: 'Missing targetDescription parameter', stateChanged: false };
  }

  if (!args.aiClient) {
    return { success: false, message: 'Missing aiClient parameter', stateChanged: false };
  }

  try {
    // Load configuration
    const config = loadConfig();

    if (!config.hybridClick) {
      return { success: false, message: 'Hybrid click is disabled in configuration', stateChanged: false };
    }

    // Capture full-screen screenshot
    logger?.pageNavigate(step, maxSteps, `capturing screenshot for hybrid click: ${args.targetDescription}`);
    const screenshot = await captureForVision(page);

    // Use hybrid click module
    const hybrid = new VisionGroundingHybrid(args.aiClient, {
      confidenceThreshold: config.confidenceThreshold,
      nearbySearchRadius: config.nearbySearchRadius,
    });

    const result = await hybrid.hybridClick(page, screenshot, args.targetDescription);

    if (result.success) {
      logger?.elementClick(
        step,
        maxSteps,
        truncate(args.targetDescription, 40),
        `method=${result.method}`,
        result.coordinates
      );
      await session.setOverlayStatus(`Clicked "${truncate(args.targetDescription, 20)}" (${result.method})`);
      return {
        success: true,
        message: `Clicked "${args.targetDescription}" using ${result.method} method`,
        stateChanged: true,
      };
    } else {
      return {
        success: false,
        message: `Failed to click "${args.targetDescription}": ${result.error}`,
        stateChanged: false,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Hybrid click failed: ${err.message}`,
      stateChanged: false,
    };
  }
}

async function executeBrowserClick(
  args: { x: number; y: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (args.x === undefined || args.y === undefined) {
    return { success: false, message: 'Missing x or y coordinates', stateChanged: false };
  }

  try {
    let { x, y } = args;

    // Coordinates arrive on a 0-1000 normalized grid regardless of viewport
    // size (vision models can't know the real resolution) — rescale here.
    // Scale coordinates from normalized 0-1000 to actual viewport dimensions
    const viewport = page.viewportSize();
    if (viewport) {
      const SCREEN_WIDTH = viewport.width;
      const SCREEN_HEIGHT = viewport.height;

      const rx = Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH);
      const ry = Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT);

      console.log(`[Navis] Browser Click: input=(${x},${y}) viewport=(${SCREEN_WIDTH}x${SCREEN_HEIGHT}) final=(${rx},${ry})`);

      x = rx;
      y = ry;
    }

    // Move cursor and highlight the click area
    await session.moveCursor(x, y);
    await new Promise(r => setTimeout(r, 60)); // tiny delay so the visual marker can paint

    // Highlight the click area
    await session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 });

    const clickProbe = `navis-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await page.evaluate((token) => {
      const w = window as any;
      w.__navisClickProbe ||= {};
      w.__navisClickProbe[token] = false;
      document.addEventListener('click', () => {
        w.__navisClickProbe[token] = true;
      }, { capture: true, once: true });
    }, clickProbe).catch(() => {});

    // Perform the click using Playwright's mouse.
    const watcher = startBrowserChangeWatch(page);
    await page.mouse.click(x, y);
    let change = await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
    let method = 'mouse';

    // AG-MEM-08: read AND delete in one round-trip so probe tokens never
    // accumulate on window for the lifetime of the page.
    const clickFired = await page.evaluate((token: string) => {
      const w = window as any;
      const fired = Boolean(w.__navisClickProbe?.[token]);
      try { delete w.__navisClickProbe?.[token]; } catch {}
      return fired;
    }, clickProbe).catch(() => true);
    if (!clickFired) {
      const fallbackWatcher = startBrowserChangeWatch(page);
      const domClicked = await dispatchDomClickAtPoint(page, x, y);
      const fallbackChange = await finishBrowserChangeWatch(fallbackWatcher, page, session, logger, step, maxSteps);
      if (domClicked) {
        method = 'dom-at-point';
        // AG-CORR-18: parenthesize — `a || b ? x : y` parses as `(a || b) ? x : y`,
        // so a fallback change with `changed` falsy but `message` set silently
        // replaced a non-empty primary change with the empty fallback object.
        change = fallbackChange && (fallbackChange.changed || fallbackChange.message) ? fallbackChange : change;
      }
    }

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_click', { x, y });
    await session.setOverlayStatus(`Clicked at (${x}, ${y})`);

    return {
      success: true,
      message: change.message ? `Clicked at coordinates (${x}, ${y}) via ${method}. ${change.message}` : `Clicked at coordinates (${x}, ${y}) via ${method}`,
      stateChanged: true
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Browser click failed: ${err.message}`,
      stateChanged: false
    };
  }
}

async function executeBrowserType(
  args: { text: string },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (!args.text) {
    return { success: false, message: 'Missing text parameter', stateChanged: false };
  }

  try {
    const focused = page.locator(':focus').first();
    if (await focused.count().catch(() => 0) > 0 && await isEditableLocator(focused)) {
      const typed = await performReliableType(page, focused, args.text);
      if (typed.ok) {
        invalidateElementSnapshotCache(page);
        logger?.elementInput(step, maxSteps, 'focused-input', args.text);
        await session.setOverlayStatus(`Typed "${truncate(args.text, 20)}"`);
        return {
          success: true,
          message: `Typed into focused input via ${typed.method}`,
          stateChanged: false
        };
      }
    }

    // Type freely using Playwright's keyboard when no editable element is focused.
    await page.keyboard.type(args.text);
    invalidateElementSnapshotCache(page);

    logger?.elementInput(step, maxSteps, 'keyboard', args.text);
    await session.setOverlayStatus(`Typed "${truncate(args.text, 20)}"`);

    return {
      success: true,
      message: `Typed: ${args.text}`,
      stateChanged: false
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Browser type failed: ${err.message}`,
      stateChanged: false
    };
  }
}

async function executeBrowserDoubleClick(
  args: { x: number; y: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (args.x === undefined || args.y === undefined) {
    return { success: false, message: 'Missing x or y coordinates', stateChanged: false };
  }

  try {
    let { x, y } = args;
    const viewport = page.viewportSize();
    if (viewport) {
      const SCREEN_WIDTH = viewport.width;
      const SCREEN_HEIGHT = viewport.height;
      x = Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH);
      y = Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT);
    }

    session.moveCursor(x, y).catch(() => {});
    session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 }).catch(() => {});

    const watcher = startBrowserChangeWatch(page);
    await page.mouse.click(x, y, { clickCount: 2 });
    const change = await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_double_click', { x, y });
    await session.setOverlayStatus(`Double-clicked at (${x}, ${y})`);

    return { success: true, message: change.message ? `Double-clicked at (${x}, ${y}). ${change.message}` : `Double-clicked at (${x}, ${y})`, stateChanged: true };
  } catch (err: any) {
    return { success: false, message: `Double-click failed: ${err.message}`, stateChanged: false };
  }
}

async function executeBrowserRightClick(
  args: { x: number; y: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (args.x === undefined || args.y === undefined) {
    return { success: false, message: 'Missing x or y coordinates', stateChanged: false };
  }

  try {
    let { x, y } = args;
    const viewport = page.viewportSize();
    if (viewport) {
      const SCREEN_WIDTH = viewport.width;
      const SCREEN_HEIGHT = viewport.height;
      x = Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH);
      y = Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT);
    }

    session.moveCursor(x, y).catch(() => {});
    session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 }).catch(() => {});

    const watcher = startBrowserChangeWatch(page);
    await page.mouse.click(x, y, { button: 'right' });
    await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_right_click', { x, y });
    await session.setOverlayStatus(`Right-clicked at (${x}, ${y})`);

    return { success: true, message: `Right-clicked at (${x}, ${y})`, stateChanged: true };
  } catch (err: any) {
    return { success: false, message: `Right-click failed: ${err.message}`, stateChanged: false };
  }
}

async function executeBrowserHover(
  args: { x: number; y: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  if (args.x === undefined || args.y === undefined) {
    return { success: false, message: 'Missing x or y coordinates', stateChanged: false };
  }

  try {
    let { x, y } = args;
    const viewport = page.viewportSize();
    if (viewport) {
      const SCREEN_WIDTH = viewport.width;
      const SCREEN_HEIGHT = viewport.height;
      x = Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH);
      y = Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT);
    }

    session.moveCursor(x, y).catch(() => {});

    await page.mouse.move(x, y);
    invalidateElementSnapshotCache(page);

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_hover', { x, y });
    await session.setOverlayStatus(`Hovered at (${x}, ${y})`);

    return { success: true, message: `Hovered at (${x}, ${y})`, stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Hover failed: ${err.message}`, stateChanged: false };
  }
}

async function executeHoldElement(
  args: { ref?: string; x?: number; y?: number; holdTimeMs?: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  try {
    let targetX: number | undefined = args.x;
    let targetY: number | undefined = args.y;
    let name = args.ref || `(${args.x}, ${args.y})`;

    if (args.ref) {
      const { locator, name: foundName } = await findElement(page, args.ref, logger, { resolveClickableAncestor: true });
      await scrollIntoViewForAction(locator);
      name = foundName;
      const box = await locator.boundingBox();
      if (box) {
        targetX = box.x + box.width / 2;
        targetY = box.y + box.height / 2;
      }
    }

    if (targetX !== undefined && targetY !== undefined) {
      session.moveCursor(targetX, targetY).catch(() => {});
      await page.mouse.move(targetX, targetY);
      await page.mouse.down();
      // AG-CORR-06: record the held button so orchestrator turn-end/finally
      // can release it even if we never reach a mouse.up() below.
      session.heldMouseButtons.add('left');
      sessionsWithHeldMouse.add(session);

      const holdTime = args.holdTimeMs || 0;
      if (holdTime > 0) {
        await new Promise(r => setTimeout(r, holdTime));
        await page.mouse.up();
        // AG-CORR-06: released on schedule — drop the held tracking.
        session.heldMouseButtons.delete('left');
        if (session.heldMouseButtons.size === 0) sessionsWithHeldMouse.delete(session);
        invalidateElementSnapshotCache(page);
        logger?.elementClick(step, maxSteps, name, `hold_element (${holdTime}ms)`, { x: targetX, y: targetY });
        return { success: true, message: `Held ${name} for ${holdTime}ms`, stateChanged: true };
      }

      invalidateElementSnapshotCache(page);
      logger?.elementClick(step, maxSteps, name, 'hold_element (down)', { x: targetX, y: targetY });
      return { success: true, message: `Holding ${name} down`, stateChanged: true };
    }

    return { success: false, message: 'Could not determine hold target', stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Hold failed: ${err.message}`, stateChanged: false };
  }
}

async function executeDragElement(
  args: { sourceRef: string; targetRef?: string; targetX?: number; targetY?: number },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  try {
    const { locator: sourceLocator, name: sourceName } = await findElement(page, args.sourceRef, logger, { resolveClickableAncestor: true });
    await scrollIntoViewForAction(sourceLocator);
    const sourceBox = await sourceLocator.boundingBox();
    if (!sourceBox) throw new Error('Could not find source element bounding box');

    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;

    let tx: number | undefined = args.targetX;
    let ty: number | undefined = args.targetY;
    let targetName = `(${args.targetX}, ${args.targetY})`;

    if (args.targetRef) {
      const { locator: targetLocator, name: foundTargetName } = await findElement(page, args.targetRef, logger, { resolveClickableAncestor: true });
      await scrollIntoViewForAction(targetLocator);
      targetName = foundTargetName;
      const targetBox = await targetLocator.boundingBox();
      if (targetBox) {
        tx = targetBox.x + targetBox.width / 2;
        ty = targetBox.y + targetBox.height / 2;
      }
    }

    if (tx !== undefined && ty !== undefined) {
      session.moveCursor(sx, sy).catch(() => {});
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      // AG-CORR-06: if any intermediate move throws, the catch below leaves
      // the button DOWN forever — track it so releaseAllHeldMice() can fix.
      session.heldMouseButtons.add('left');
      sessionsWithHeldMouse.add(session);
      try {
        await new Promise(r => setTimeout(r, 40));

        session.moveCursor(tx, ty).catch(() => {});
        // Interpolated moves: drag-to-sort libraries listen for intermediate
        // mousemove events, which a single jump-to-target never fires.
        await page.mouse.move(tx, ty, { steps: 10 });
        await page.mouse.up();
        // AG-CORR-06: released on schedule — drop the held tracking.
        session.heldMouseButtons.delete('left');
      } catch (dragErr) {
        // AG-CORR-06: intermediate step failed — try to release immediately;
        // if the page is dead the finally-block releaseAllHeldMice() retries.
        try {
          await page.mouse.up();
          session.heldMouseButtons.delete('left');
        } catch {
          session.heldMouseButtons.add('left');
          sessionsWithHeldMouse.add(session);
        }
        throw dragErr;
      } finally {
        // AG-CORR-06: released (or release attempted) — drop held tracking
        // only when no button is still recorded for this session.
        if (session.heldMouseButtons.size === 0) sessionsWithHeldMouse.delete(session);
      }
      invalidateElementSnapshotCache(page);

      logger?.elementClick(step, maxSteps, sourceName, `drag to ${targetName}`, { x: tx, y: ty });
      return { success: true, message: `Dragged ${sourceName} to ${targetName}`, stateChanged: true };
    }

    return { success: false, message: 'Could not determine drag target', stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Drag failed: ${err.message}`, stateChanged: false };
  }
}

async function executeTakeScreenshot(
  args: { full_page?: boolean },
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  try {
    const fullPage = Boolean(args?.full_page);
    const screenshotBuffer = await page.screenshot({ fullPage, type: 'jpeg', quality: 80 });
    const base64 = screenshotBuffer.toString('base64');
    logger?.screenshot(step, maxSteps, base64);
    return {
      success: true,
      message: `Captured ${fullPage ? 'full page' : 'viewport'} screenshot`,
      stateChanged: false,
      data: {
        base64: `data:image/jpeg;base64,${base64}`,
        fullPage,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Screenshot failed: ${message}`, stateChanged: false };
  }
}

