/**
 * Navis - Action Executor
 *
 * Executes browser actions from AI decisions.
 * Implements all actions defined in NAVIS.md.
 *
 * Phase 1: Basic Actions (go_to_url, click, input, etc.)
 * Phase 2: Advanced Form Interactions (upload_file, select_option, set_date, drag_and_drop, hover, right_click)
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
  | 'browser_hover';

export interface ActionResult {
  success: boolean;
  message: string;
  stateChanged: boolean;
  data?: unknown;
}

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

function cssAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function existingLocator(locator: any, method: string): Promise<{ locator: any; method: string } | null> {
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
async function findElement(
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
  await Promise.race([
    page.waitForLoadState('domcontentloaded', { timeout: 900 }).catch(() => null),
    new Promise(resolve => setTimeout(resolve, 180)),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function toRole(value?: string): string | undefined {
  const role = String(value || '').toLowerCase().trim();
  return PLAYWRIGHT_ROLES.has(role) ? role : undefined;
}

function normalizeTypedText(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

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

async function installLocatorClickProbe(locator: any): Promise<string | null> {
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

async function locatorClickProbeFired(locator: any, token: string | null): Promise<boolean> {
  if (!token) return true;
  return Boolean(await locator.evaluate((_el: HTMLElement, probeToken: string) => {
    return Boolean((window as any).__navisElementClickProbe?.[probeToken]);
  }, token).catch(() => true));
}

async function performReliableClick(page: Page, locator: any): Promise<{ ok: boolean; method: string }> {
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

  for (const attempt of attempts) {
    const probe = await installLocatorClickProbe(locator);
    const ok = await attempt.run().catch(() => false);
    if (ok && await locatorClickProbeFired(locator, probe)) return { ok: true, method: attempt.method };
  }

  return { ok: false, method: 'none' };
}

async function readLocatorEditableValue(locator: any): Promise<string | null> {
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
      method: 'fill',
      run: async () => { await locator.fill(text, { timeout: 1200 }); },
    },
    {
      method: 'click-keyboard',
      run: async () => {
        await locator.click({ timeout: 800, force: true }).catch(() => clickAtLocatorCenter(page, locator));
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
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

      case 'solve_captcha':
        return await executeSolveCaptcha(page, session, logger, step, maxSteps, aiClient);

      case 'done':
        return executeDone(args as { success: boolean; text: string });

      // Phase 2: Advanced Form Interactions
      case 'upload_file':
        return await executeUploadFile(args as any, page, session, logger, step, maxSteps);

      case 'select_option':
        return await executeSelectOption(args as any, page, session, logger, step, maxSteps);

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
      await locator.press(args.key, { timeout: 1200 });
      if (/^(Enter|NumpadEnter)$/i.test(args.key)) {
        await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
      } else {
        invalidateElementSnapshotCache(page);
      }
      logger?.elementInput(step, maxSteps, `key:${args.key}`, args.ref);
    } else {
      const watcher = startBrowserChangeWatch(page);
      await page.keyboard.press(args.key);
      if (/^(Enter|NumpadEnter)$/i.test(args.key)) {
        await finishBrowserChangeWatch(watcher, page, session, logger, step, maxSteps);
      } else {
        invalidateElementSnapshotCache(page);
      }
      logger?.elementInput(step, maxSteps, `key:${args.key}`, '(global)');
    }
    await session.setOverlayStatus(`Pressed "${args.key}"`);
    return { success: true, message: `Pressed key: ${args.key}`, stateChanged: true };
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

  const solved = await page.evaluate(() => {
    const title = document.title.toLowerCase();
    const bodyText = document.body?.innerText?.toLowerCase() || '';

    if (title.includes('hcaptcha') || bodyText.includes('hcaptcha')) {
      const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox) { checkbox.click(); return true; }
      const label = document.querySelector('label[for]');
      if (label) { (label as HTMLElement).click(); return true; }
    }

    if (title.includes('cloudflare') || bodyText.includes('cloudflare') || bodyText.includes('verifying')) {
      const checkbox = document.querySelector('#challenge-stage input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox) { checkbox.click(); return true; }
      const cfBtn = document.querySelector('.cf-solve input, .cf-button, .turnstile-input') as HTMLElement | null;
      if (cfBtn) { cfBtn.click(); return true; }
    }

    if (bodyText.includes('confirm you') || bodyText.includes('verify you') || bodyText.includes('security check')) {
      const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
      for (const btn of Array.from(buttons)) {
        const el = btn as HTMLElement;
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('confirm') || text.includes('verify') || text.includes('continue') || text.includes('proceed')) {
          el.click(); return true;
        }
      }
      const links = document.querySelectorAll('a');
      for (const link of Array.from(links)) {
        const el = link as HTMLElement;
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('confirm') || text.includes('verify') || text.includes('continue')) {
          el.click(); return true;
        }
      }
    }

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of Array.from(checkboxes)) {
      const el = cb as HTMLInputElement;
      if (!el.checked) { el.click(); return true; }
    }

    return false;
  });

  if (solved) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    invalidateElementSnapshotCache(page);
    logger?.tabChange(step, maxSteps, 'captcha solved, waiting for redirect...');
    return { success: true, message: 'Captcha solved, waiting for page to proceed', stateChanged: true };
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
      const elements = document.querySelectorAll('iframe, input, button, a, [role="button"], .slider-handle, .slider-button, [class*="slider"], [class*="handle"], [data-ref]');
      elements.forEach((el: any) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 3 && rect.height > 3 && rect.top >= 0 && rect.left >= 0) {
          const isDup = list.some(item => Math.abs(item.x - rect.left) < 5 && Math.abs(item.y - rect.top) < 5 && Math.abs(item.width - rect.width) < 5);
          if (!isDup) {
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
          }
        }
      });
      return list.slice(0, 50);
    }).catch(() => []);

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
      logger?.tabChange(step, maxSteps, 'AI dragging slider handle...');
      await page.mouse.move(dragStartX, dragStartY);
      await new Promise(r => setTimeout(r, 300));
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 200));

      const slideDistance = result.dragDistance || 280;
      const dragSteps = 30;
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

    const clickFired = await page.evaluate((token) => Boolean((window as any).__navisClickProbe?.[token]), clickProbe).catch(() => true);
    if (!clickFired) {
      const fallbackWatcher = startBrowserChangeWatch(page);
      const domClicked = await dispatchDomClickAtPoint(page, x, y);
      const fallbackChange = await finishBrowserChangeWatch(fallbackWatcher, page, session, logger, step, maxSteps);
      if (domClicked) {
        method = 'dom-at-point';
        change = fallbackChange.changed || fallbackChange.message ? fallbackChange : change;
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
      
      const holdTime = args.holdTimeMs || 0;
      if (holdTime > 0) {
        await new Promise(r => setTimeout(r, holdTime));
        await page.mouse.up();
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
      await new Promise(r => setTimeout(r, 40));
      
      session.moveCursor(tx, ty).catch(() => {});
      await page.mouse.move(tx, ty, { steps: 10 });
      await page.mouse.up();
      invalidateElementSnapshotCache(page);

      logger?.elementClick(step, maxSteps, sourceName, `drag to ${targetName}`, { x: tx, y: ty });
      return { success: true, message: `Dragged ${sourceName} to ${targetName}`, stateChanged: true };
    }

    return { success: false, message: 'Could not determine drag target', stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Drag failed: ${err.message}`, stateChanged: false };
  }
}
