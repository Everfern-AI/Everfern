/**
 * Navis — Element Capture Engine
 *
 * Uses Playwright's built-in ariaSnapshot() for AI-optimized accessibility tree.
 * Every interactive element gets a stable ref (e1, e2, ...) for precise interaction.
 * https://playwright.dev/docs/aria-snapshots
 *
 * Performance Optimizations:
 * - Viewport-aware filtering (viewport ± 500px buffer)
 * - Element snapshot caching with 500ms TTL
 * - Parallel iframe processing
 * - Performance targets: <50ms for <100 elements, <100ms for 100-500, <200ms for >500
 * - Full-screen capture mode for consistent resolution
 */

import { Page } from 'playwright';
import parseHtmlDom, { type DOMNode, type Element as HtmlDomElement } from 'html-dom-parser';
import { FullScreenCaptureModule } from './full-screen-capture';

export interface AriaSnapshotResult {
  raw: string;
  refs: Map<string, RefMetadata>;
  elementCount: number;
  captureTimeMs: number;
}

export interface RefMetadata {
  ref?: string;
  role?: string;
  tag?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  href?: string;
  selector?: string;
  id?: string;
  testId?: string;
  nameAttr?: string;
  type?: string;
  nearbyText?: string;
  section?: string;
  key?: string;
  form?: { name?: string; action?: string; method?: string };
  actions?: string[];
  disabled?: boolean;
}

export interface HtmlDomParserNodeSummary {
  tag: string;
  text?: string;
  selector?: string;
  role?: string;
  href?: string;
  action?: string;
  method?: string;
  id?: string;
  testId?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
}

export interface HtmlDomParserContext {
  parser: 'html-dom-parser';
  stats: {
    htmlBytes: number;
    truncated: boolean;
    totalElements: number;
    capturedElements: number;
  };
  title?: string;
  headings: HtmlDomParserNodeSummary[];
  navigation: HtmlDomParserNodeSummary[];
  forms: HtmlDomParserNodeSummary[];
  controls: HtmlDomParserNodeSummary[];
  links: HtmlDomParserNodeSummary[];
  media: HtmlDomParserNodeSummary[];
  content: HtmlDomParserNodeSummary[];
}

// ── Element Snapshot Cache with 500ms TTL ─────────────────────────
interface CacheEntry {
  snapshot: AriaSnapshotResult;
  timestamp: number;
  url: string;
}

const CACHE_TTL_MS = 500;
const elementSnapshotCache = new Map<string, CacheEntry>();
const refMetadataCache = new Map<string, { timestamp: number; url: string; refs: Map<string, RefMetadata> }>();

function getCacheKey(page: Page): string {
  return `${page.url()}:${page.context().browser()?.version() || 'unknown'}`;
}

function getCachedSnapshot(page: Page): AriaSnapshotResult | null {
  const key = getCacheKey(page);
  const cached = elementSnapshotCache.get(key);

  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    elementSnapshotCache.delete(key);
    refMetadataCache.delete(key);
    return null;
  }

  // Verify URL hasn't changed (navigation invalidates cache)
  if (cached.url !== page.url()) {
    elementSnapshotCache.delete(key);
    refMetadataCache.delete(key);
    return null;
  }

  return cached.snapshot;
}

function setCachedSnapshot(page: Page, snapshot: AriaSnapshotResult): void {
  const key = getCacheKey(page);
  elementSnapshotCache.set(key, {
    snapshot,
    timestamp: Date.now(),
    url: page.url(),
  });
  const refs = parseRefMetadata(snapshot.raw);
  if (refs.size > 0) {
    refMetadataCache.set(key, {
      refs,
      timestamp: Date.now(),
      url: page.url(),
    });
  }
}

export function invalidateElementSnapshotCache(page?: Page): void {
  if (!page) {
    elementSnapshotCache.clear();
    refMetadataCache.clear();
    return;
  }
  const key = getCacheKey(page);
  elementSnapshotCache.delete(key);
  refMetadataCache.delete(key);
}

export function getRefMetadata(page: Page, ref: string): RefMetadata | null {
  const key = getCacheKey(page);
  const cached = refMetadataCache.get(key);
  if (!cached) return null;
  if (cached.url !== page.url() || Date.now() - cached.timestamp > CACHE_TTL_MS * 10) {
    refMetadataCache.delete(key);
    return null;
  }
  return cached.refs.get(ref) || null;
}

const HTML_DOM_CONTEXT_LIMITS = {
  htmlBytes: 900_000,
  headings: 45,
  navigation: 25,
  forms: 25,
  controls: 90,
  links: 90,
  media: 30,
  content: 55,
};

const HTML_DOM_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'meta', 'link']);
const HTML_DOM_CONTROL_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'option',
  'slider',
  'spinbutton',
]);

function cleanHtmlDomText(value: unknown, max = 240): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isHtmlDomElement(node: DOMNode): node is HtmlDomElement {
  return Boolean((node as any)?.name && (node as any)?.attribs);
}

function htmlDomChildren(node: DOMNode): DOMNode[] {
  return Array.isArray((node as any)?.children) ? ((node as any).children as DOMNode[]) : [];
}

function htmlDomText(node: DOMNode, max = 260): string | undefined {
  if ((node as any)?.type === 'text') {
    return cleanHtmlDomText((node as any).data, max);
  }

  if (!isHtmlDomElement(node)) return undefined;
  const tag = node.name.toLowerCase();
  if (HTML_DOM_SKIP_TAGS.has(tag)) return undefined;

  const parts: string[] = [];
  const visit = (current: DOMNode) => {
    if (parts.join(' ').length >= max) return;
    if ((current as any)?.type === 'text') {
      const text = cleanHtmlDomText((current as any).data, max);
      if (text) parts.push(text);
      return;
    }
    if (isHtmlDomElement(current) && HTML_DOM_SKIP_TAGS.has(current.name.toLowerCase())) return;
    for (const child of htmlDomChildren(current)) visit(child);
  };

  for (const child of htmlDomChildren(node)) visit(child);
  return cleanHtmlDomText(parts.join(' '), max);
}

function htmlDomAttr(node: HtmlDomElement, name: string, max = 220): string | undefined {
  return cleanHtmlDomText(node.attribs?.[name], max);
}

function htmlDomSelector(node: HtmlDomElement, ancestors: HtmlDomElement[]): string {
  const tag = node.name.toLowerCase();
  const id = htmlDomAttr(node, 'id', 120);
  if (id && !/\s/.test(id)) return `${tag}#${id}`;

  const testId =
    htmlDomAttr(node, 'data-testid', 120) ||
    htmlDomAttr(node, 'data-test', 120) ||
    htmlDomAttr(node, 'data-cy', 120);
  if (testId) return `${tag}[data-testid="${testId.replace(/"/g, '\\"')}"]`;

  const name = htmlDomAttr(node, 'name', 120);
  if (name) return `${tag}[name="${name.replace(/"/g, '\\"')}"]`;

  const parent = ancestors[ancestors.length - 1];
  if (!parent) return tag;

  const sameTagIndex = htmlDomChildren(parent)
    .filter((child): child is HtmlDomElement => isHtmlDomElement(child) && child.name.toLowerCase() === tag)
    .indexOf(node);
  return sameTagIndex >= 0 ? `${tag}:nth-of-type(${sameTagIndex + 1})` : tag;
}

function htmlDomSummary(node: HtmlDomElement, ancestors: HtmlDomElement[], maxText = 240): HtmlDomParserNodeSummary {
  const tag = node.name.toLowerCase();
  const role = htmlDomAttr(node, 'role', 80);
  return {
    tag,
    selector: htmlDomSelector(node, ancestors),
    role,
    text: cleanHtmlDomText(
      htmlDomAttr(node, 'aria-label', maxText) ||
      htmlDomAttr(node, 'title', maxText) ||
      htmlDomAttr(node, 'alt', maxText) ||
      htmlDomText(node, maxText),
      maxText,
    ),
    href: htmlDomAttr(node, 'href', 260),
    action: htmlDomAttr(node, 'action', 260),
    method: htmlDomAttr(node, 'method', 40),
    id: htmlDomAttr(node, 'id', 120),
    testId: htmlDomAttr(node, 'data-testid', 120) || htmlDomAttr(node, 'data-test', 120) || htmlDomAttr(node, 'data-cy', 120),
    name: htmlDomAttr(node, 'name', 120),
    type: htmlDomAttr(node, 'type', 80),
    placeholder: htmlDomAttr(node, 'placeholder', 160),
    ariaLabel: htmlDomAttr(node, 'aria-label', 160),
    title: htmlDomAttr(node, 'title', 160),
  };
}

function compactHtmlDomSummary(summary: HtmlDomParserNodeSummary): HtmlDomParserNodeSummary {
  const compact: HtmlDomParserNodeSummary = { tag: summary.tag };
  for (const [key, value] of Object.entries(summary) as Array<[keyof HtmlDomParserNodeSummary, any]>) {
    if (key === 'tag' || value == null || value === '') continue;
    compact[key] = typeof value === 'string' ? cleanHtmlDomText(value, key === 'href' || key === 'action' ? 260 : 180) : value;
  }
  return compact;
}

function pushUniqueHtmlDomNode(
  bucket: HtmlDomParserNodeSummary[],
  seen: Set<string>,
  summary: HtmlDomParserNodeSummary,
  limit: number,
): void {
  if (bucket.length >= limit) return;
  const compact = compactHtmlDomSummary(summary);
  const key = [
    compact.tag,
    compact.selector,
    compact.text,
    compact.href,
    compact.name,
    compact.placeholder,
  ].filter(Boolean).join('|');
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(compact);
}

export function parseHtmlDomParserContext(
  html: string,
  options: { maxHtmlBytes?: number } = {},
): HtmlDomParserContext {
  const maxHtmlBytes = options.maxHtmlBytes ?? HTML_DOM_CONTEXT_LIMITS.htmlBytes;
  const source = html.length > maxHtmlBytes ? html.slice(0, maxHtmlBytes) : html;
  const roots = parseHtmlDom(source, {
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
  } as any);

  const context: HtmlDomParserContext = {
    parser: 'html-dom-parser',
    stats: {
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      truncated: source.length < html.length,
      totalElements: 0,
      capturedElements: 0,
    },
    headings: [],
    navigation: [],
    forms: [],
    controls: [],
    links: [],
    media: [],
    content: [],
  };

  const seen = {
    headings: new Set<string>(),
    navigation: new Set<string>(),
    forms: new Set<string>(),
    controls: new Set<string>(),
    links: new Set<string>(),
    media: new Set<string>(),
    content: new Set<string>(),
  };

  const visit = (node: DOMNode, ancestors: HtmlDomElement[] = []) => {
    if (!isHtmlDomElement(node)) return;

    const tag = node.name.toLowerCase();
    if (HTML_DOM_SKIP_TAGS.has(tag)) return;

    context.stats.totalElements++;

    const role = (htmlDomAttr(node, 'role', 80) || '').toLowerCase();
    const text = htmlDomText(node, 320);
    const summary = htmlDomSummary(node, ancestors);
    const currentAncestors = [...ancestors, node];

    if (tag === 'title' && text && !context.title) {
      context.title = text;
    }

    if (/^h[1-6]$/.test(tag) || role === 'heading') {
      pushUniqueHtmlDomNode(context.headings, seen.headings, { ...summary, text: text || summary.text }, HTML_DOM_CONTEXT_LIMITS.headings);
    }

    if (tag === 'nav' || role === 'navigation' || /nav|menu|breadcrumb/i.test(`${summary.ariaLabel || ''} ${summary.text || ''}`)) {
      pushUniqueHtmlDomNode(context.navigation, seen.navigation, { ...summary, text: text || summary.text }, HTML_DOM_CONTEXT_LIMITS.navigation);
    }

    if (tag === 'form') {
      pushUniqueHtmlDomNode(context.forms, seen.forms, { ...summary, text: text || summary.text }, HTML_DOM_CONTEXT_LIMITS.forms);
    }

    const isLink = tag === 'a' && Boolean(summary.href);
    const isControl =
      ['button', 'input', 'select', 'textarea', 'summary'].includes(tag) ||
      HTML_DOM_CONTROL_ROLES.has(role) ||
      node.attribs?.onclick != null ||
      node.attribs?.tabindex != null;

    if (isLink) {
      pushUniqueHtmlDomNode(context.links, seen.links, summary, HTML_DOM_CONTEXT_LIMITS.links);
    }

    if (isControl) {
      pushUniqueHtmlDomNode(context.controls, seen.controls, summary, HTML_DOM_CONTEXT_LIMITS.controls);
    }

    if (['img', 'svg', 'picture', 'video', 'audio', 'canvas'].includes(tag)) {
      pushUniqueHtmlDomNode(context.media, seen.media, summary, HTML_DOM_CONTEXT_LIMITS.media);
    }

    if (
      text &&
      text.length >= 35 &&
      ['main', 'article', 'section', 'p', 'li', 'td', 'th', 'blockquote'].includes(tag)
    ) {
      pushUniqueHtmlDomNode(context.content, seen.content, { ...summary, text }, HTML_DOM_CONTEXT_LIMITS.content);
    }

    for (const child of htmlDomChildren(node)) {
      visit(child, currentAncestors);
    }
  };

  for (const node of roots) visit(node);

  context.stats.capturedElements =
    context.headings.length +
    context.navigation.length +
    context.forms.length +
    context.controls.length +
    context.links.length +
    context.media.length +
    context.content.length;

  return context;
}

export async function captureHtmlDomParserContext(page: Page): Promise<HtmlDomParserContext | null> {
  try {
    const html = await page.content();
    return parseHtmlDomParserContext(html);
  } catch (err) {
    console.warn('[Navis] html-dom-parser context capture failed:', err);
    return null;
  }
}

export function parseRefMetadata(snapshot: string): Map<string, RefMetadata> {
  const refs = new Map<string, RefMetadata>();
  try {
    const parsed = JSON.parse(snapshot);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item?.ref) continue;
        refs.set(String(item.ref), {
          ref: String(item.ref),
          role: item.role,
          tag: item.tag,
          name: item.name,
          label: item.label,
          placeholder: item.placeholder,
          href: item.href,
          selector: item.selector,
          id: item.id,
          testId: item.testId,
          nameAttr: item.nameAttr,
          type: item.type,
          nearbyText: item.nearbyText,
          section: item.section,
          key: item.key,
          form: item.form,
          actions: Array.isArray(item.actions) ? item.actions : undefined,
          disabled: Boolean(item.disabled),
        });
      }
    }
  } catch {
    return parseRefsOptimized(snapshot);
  }
  return refs;
}

// ── Fast Snapshot (Viewport-Aware, Optimized) ─────────────────────────
/**
 * Captures interactive elements with viewport-aware filtering.
 * Performance targets:
 * - <50ms for <100 elements
 * - <100ms for 100-500 elements
 * - <200ms for >500 elements
 *
 * Optimizations:
 * - Avoid iterating all elements for scrollable detection
 * - Use efficient string building with array join
 * - Skip expensive ariaSnapshot for small element counts
 * - Cache computed values to avoid redundant calculations
 */
export async function captureFastSnapshot(page: Page): Promise<AriaSnapshotResult | null> {
  const startTime = Date.now();

  try {
    const snapshot = await page.evaluate(() => {
      const vWidth = window.innerWidth;
      const vHeight = window.innerHeight;
      const MAX_ELEMENTS = 1000; // Hard limit to prevent token explosion

      const textOf = (node: Element | null, max = 160) => {
        if (!node) return '';
        const text = (node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        return text.slice(0, max);
      };

      const attr = (node: Element, name: string, max = 160) => {
        const value = node.getAttribute(name);
        return value ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
      };

      const shortHash = (value: string) => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
          hash ^= value.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
      };

      const cssEscape = (value: string) => {
        const css = (window as any).CSS;
        return css?.escape ? css.escape(value) : value.replace(/["\\]/g, '\\$&');
      };

      const compactSelector = (node: Element) => {
        const testId = node.getAttribute('data-testid') || node.getAttribute('data-test') || node.getAttribute('data-cy');
        if (testId) return `[data-testid="${cssEscape(testId)}"]`;

        const id = node.getAttribute('id');
        if (id && !/\s/.test(id)) return `#${cssEscape(id)}`;

        const name = node.getAttribute('name');
        const tag = node.tagName.toLowerCase();
        if (name) return `${tag}[name="${cssEscape(name)}"]`;

        const parts: string[] = [];
        let cur: Element | null = node;
        for (let depth = 0; cur && depth < 4 && cur !== document.body && cur !== document.documentElement; depth++) {
          const current: Element = cur;
          let part = current.tagName.toLowerCase();
          const role = current.getAttribute('role');
          if (role) part += `[role="${cssEscape(role)}"]`;
          const parent: Element | null = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((child): child is Element => child instanceof Element && child.tagName === current.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part);
          cur = parent;
        }
        return parts.join(' > ');
      };

      const resolveTextRefs = (node: Element, attrName: string) => {
        const ids = (node.getAttribute(attrName) || '').split(/\s+/).filter(Boolean);
        return ids
          .map(id => textOf(document.getElementById(id), 120))
          .filter(Boolean)
          .join(' ')
          .slice(0, 180);
      };

      const nearestText = (node: Element) => {
        const labelledBy = resolveTextRefs(node, 'aria-labelledby');
        if (labelledBy) return labelledBy;

        const describedBy = resolveTextRefs(node, 'aria-describedby');
        const nearby: string[] = [];
        let prev = node.previousElementSibling;
        let next = node.nextElementSibling;
        for (let i = 0; i < 2; i++) {
          if (prev) {
            const text = textOf(prev, 120);
            if (text) nearby.push(text);
            prev = prev.previousElementSibling;
          }
          if (next) {
            const text = textOf(next, 120);
            if (text) nearby.push(text);
            next = next.nextElementSibling;
          }
        }

        const parent = node.parentElement;
        if (parent) {
          const text = textOf(parent, 180);
          if (text && text !== textOf(node, 180)) nearby.push(text);
        }
        if (describedBy) nearby.push(describedBy);
        return Array.from(new Set(nearby)).join(' | ').slice(0, 240);
      };

      const sectionHeading = (node: Element) => {
        const region = node.closest('form, section, article, main, [role="main"], [role="region"], [aria-label], [aria-labelledby]');
        if (!region) return '';
        const labelled = attr(region, 'aria-label', 120) || resolveTextRefs(region, 'aria-labelledby');
        if (labelled) return labelled;
        const heading = region.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
        return textOf(heading, 120);
      };

      const formContext = (node: Element) => {
        const form = node.closest('form');
        if (!form) return undefined;
        const name = attr(form, 'aria-label', 120) || resolveTextRefs(form, 'aria-labelledby') || attr(form, 'name', 80) || attr(form, 'id', 80) || textOf(form.querySelector('legend,h1,h2,h3,[role="heading"]'), 100);
        const action = (form as HTMLFormElement).action || attr(form, 'action', 160);
        return { name, action: action ? action.slice(0, 180) : undefined, method: attr(form, 'method', 20) || 'get' };
      };

      const elementActions = (tag: string, role: string, type: string, editable: boolean) => {
        const actions: string[] = [];
        const actionText = `${tag} ${role} ${type}`.toLowerCase();
        if (editable || /input|textarea|textbox|searchbox/.test(actionText)) actions.push('type');
        if (/select|combobox|listbox/.test(actionText)) actions.push('select');
        if (/checkbox|radio|switch/.test(actionText)) actions.push('toggle');
        if (/button|link|a|summary|tab|menuitem|option/.test(actionText)) actions.push('click');
        if (actions.length === 0 && role) actions.push('click');
        return Array.from(new Set(actions));
      };

      // Select interactive elements + semantic context. This intentionally uses a
      // broad semantic selector so SPAs with custom roles/onClick handlers are visible.
      const selector = [
        'button',
        'a[href]',
        'input',
        'select',
        'textarea',
        'summary',
        '[contenteditable="true"]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        '[role="heading"]',
        'main',
        'article',
        '[role="main"]'
      ].join(',');
      const elements = document.querySelectorAll(selector);

      let ref = 0;
      const lines: string[] = [];

      // Optimization: Use array for string building (faster than concatenation)
      // Optimization: Skip scrollable container detection for <100 elements (rare bottleneck)
      // Only detect scrollable containers if we have many elements
      if (elements.length > 100) {
        // For large pages, detect scrollable containers but limit search
        const scrollableContainers = document.querySelectorAll('[style*="overflow"]');
        let scrollRef = 0;

        for (let i = 0; i < Math.min(scrollableContainers.length, 20); i++) {
          const el = scrollableContainers[i];
          const style = window.getComputedStyle(el);
          const isScrollable = (
            (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            (el.scrollHeight > el.clientHeight + 5 || el.scrollWidth > el.clientWidth + 5)
          );

          if (isScrollable) {
            const rect = el.getBoundingClientRect();
            // Still only show scrollable containers that are somewhat visible or relevant
            if (rect.width > 10 && rect.height > 10) {
              scrollRef++;
              const sref = `s${scrollRef}`;
              (el as HTMLElement).setAttribute('data-scroll-ref', sref);
              const cx = Math.floor(((rect.x + rect.width / 2) / vWidth) * 1000);
              const cy = Math.floor(((rect.y + rect.height / 2) / vHeight) * 1000);
              lines.push(JSON.stringify({ ref: sref, role: 'scrollable', name: 'container', pos: { x: cx, y: cy } }));
            }
          }
        }
      }

      // Optimization: Pre-compute interactive tag set for faster lookup
      const interactiveTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
      const interactiveRoles = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option']);

      for (let i = 0; i < elements.length; i++) {
        if (ref >= MAX_ELEMENTS) break;

        const el = elements[i];
        const rect = el.getBoundingClientRect();

        // Check if element is visible (opacity, display, visibility)
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width < 1 || rect.height < 1) {
          continue;
        }

        // Keep the agent fast: include viewport + a nearby buffer, but prune
        // elements far outside the current scroll region.
        const VIEWPORT_BUFFER = 500;
        if (
          rect.bottom < -VIEWPORT_BUFFER ||
          rect.top > vHeight + VIEWPORT_BUFFER ||
          rect.right < -VIEWPORT_BUFFER ||
          rect.left > vWidth + VIEWPORT_BUFFER
        ) {
          continue;
        }

        const tagName = el.tagName;
        const role = el.getAttribute('role') || tagName.toLowerCase();
        const isContentEditable = (el as HTMLElement).isContentEditable;
        const hasClickHandler = Boolean((el as HTMLElement).onclick) || el.hasAttribute('onclick');
        const isInteractive = interactiveTags.has(tagName) || interactiveRoles.has(role) || hasClickHandler || isContentEditable || (el as HTMLElement).tabIndex >= 0;

        const tag = tagName.toLowerCase();
        const inputLike = el as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;

        let labelText = '';
        if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
          try {
            const labels = (el as HTMLInputElement).labels;
            if (labels && labels.length > 0) {
              labelText = Array.from(labels).map(label => label.textContent || '').join(' ').trim();
            }
            if (!labelText && (el as HTMLElement).id) {
              const id = (el as HTMLElement).id;
              const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
              labelText = (label?.textContent || '').trim();
            }
          } catch {}
        }

        // Optimization: Cache aria-label lookup
        let name = el.getAttribute('aria-label');
        if (!name) {
          const text = el.textContent;
          name = text ? text.trim().slice(0, 100) : '';
        }
        if (!name && labelText) {
          name = labelText;
        }
        if (!name) {
          name = el.getAttribute('placeholder') || '';
        }
        if (!name) {
          name = el.getAttribute('title') || '';
        }

        // Clean up name (remove extra whitespace/newlines)
        name = name.replace(/\s+/g, ' ').trim();
        if (name.length > 80) name = name.slice(0, 80);
        if (!name && !isInteractive) continue; // Skip empty non-interactive elements

        // Add visibility hint
        const isVisible = rect.top >= 0 && rect.left >= 0 && rect.bottom <= vHeight && rect.right <= vWidth;

        const cx = Math.floor(((rect.x + rect.width / 2) / vWidth) * 1000);
        const cy = Math.floor(((rect.y + rect.height / 2) / vHeight) * 1000);

        const href = tagName === 'A' ? (el as HTMLAnchorElement).href : '';
        const type = String((inputLike as any).type || el.getAttribute('type') || '');
        const placeholder = el.getAttribute('placeholder') || '';
        const value = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)
          ? String(inputLike.value || '').slice(0, 100)
          : '';
        const disabled = Boolean((inputLike as any).disabled) || el.getAttribute('aria-disabled') === 'true';
        const checked = typeof (inputLike as any).checked === 'boolean' ? Boolean((inputLike as any).checked) : undefined;
        const expanded = el.getAttribute('aria-expanded');
        const selected = el.getAttribute('aria-selected');
        const describedBy = el.getAttribute('aria-describedby');

        const inViewport = rect.bottom >= 0 && rect.right >= 0 && rect.top <= vHeight && rect.left <= vWidth;
        const fullyInViewport = rect.top >= 0 && rect.left >= 0 && rect.bottom <= vHeight && rect.right <= vWidth;
        const viewport =
          fullyInViewport ? 'full' :
          inViewport ? 'partial' :
          rect.bottom < 0 ? 'above' :
          rect.top > vHeight ? 'below' :
          rect.right < 0 ? 'left' :
          'right';

        const bbox = {
          x: Math.max(-1000, Math.floor((rect.x / vWidth) * 1000)),
          y: Math.max(-1000, Math.floor((rect.y / vHeight) * 1000)),
          w: Math.max(0, Math.floor((rect.width / vWidth) * 1000)),
          h: Math.max(0, Math.floor((rect.height / vHeight) * 1000)),
        };

        const actions = elementActions(tag, role, type, isContentEditable);
        const priority =
          (isInteractive ? 50 : 0) +
          (inViewport ? 30 : 0) +
          (name ? 10 : 0) +
          (['button', 'a', 'input', 'select', 'textarea'].includes(tag) ? 8 : 0) +
          (disabled ? -50 : 0);

        const enrich = (item: any) => {
          item.tag = tag;
          if (!inViewport) item.inViewport = false;
          if (viewport !== 'full') item.viewport = viewport;
          item.bbox = bbox;
          item.selector = compactSelector(el);
          item.actions = actions;
          item.priority = priority;
          const id = el.getAttribute('id');
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
          const nameAttr = el.getAttribute('name');
          const needsContext = !name || tag === 'input' || tag === 'textarea' || tag === 'select' || /textbox|combobox|searchbox/.test(role);
          const textAround = needsContext ? nearestText(el) : '';
          const section = needsContext ? sectionHeading(el) : '';
          const form = needsContext ? formContext(el) : undefined;
          const stableKey = `${tag}|${role}|${type}|${name}|${href}|${id || ''}|${nameAttr || ''}`;
          item.key = shortHash(stableKey);
          if (id) item.id = id.slice(0, 120);
          if (testId) item.testId = testId.slice(0, 120);
          if (nameAttr) item.nameAttr = nameAttr.slice(0, 120);
          if (
            textAround &&
            textAround !== name &&
            (!name || tag === 'input' || tag === 'textarea' || tag === 'select' || /textbox|combobox|searchbox/.test(role))
          ) item.nearbyText = textAround;
          if (section) item.section = section;
          if (form) item.form = form;
          if (labelText) item.label = labelText.replace(/\s+/g, ' ').slice(0, 120);
          if (href) item.href = href.slice(0, 240);
          if (type && !(tag === 'button' && type === 'submit')) item.type = type;
          if (placeholder) item.placeholder = placeholder.slice(0, 120);
          if (value && type !== 'password') item.value = value;
          if (disabled) item.disabled = true;
          if (checked !== undefined) item.checked = checked;
          if (expanded != null) item.expanded = expanded === 'true';
          if (selected != null) item.selected = selected === 'true';
          if (describedBy) item.describedBy = describedBy;
          return item;
        };

        if (isInteractive) {
          ref++;
          (el as HTMLElement).setAttribute('data-ref', `e${ref}`);
          lines.push(JSON.stringify(enrich({ ref: `e${ref}`, role, name, pos: { x: cx, y: cy } })));
        } else {
          // Contextual heading/text
          lines.push(JSON.stringify(enrich({ role, name, pos: { x: cx, y: cy } })));
        }
      }

      // Optimization: Join array instead of concatenating strings
      const result = `[\n${lines.join(',\n')}\n]`;
      return { snapshot: result, elementCount: ref };
    });

    if (!snapshot || snapshot.snapshot.length === 0) return null;

    const captureTimeMs = Date.now() - startTime;
    const refs = parseRefsOptimized(snapshot.snapshot);
    const result: AriaSnapshotResult = {
      raw: snapshot.snapshot,
      refs,
      elementCount: snapshot.elementCount,
      captureTimeMs,
    };

    return result;
  } catch (err) {
    console.warn('[Navis] Fast snapshot failed:', err);
    return null;
  }
}

export async function captureInteractiveElements(page: Page): Promise<AriaSnapshotResult> {
  // Check cache first (Req 1.4: 500ms TTL caching)
  const cached = getCachedSnapshot(page);
  if (cached) {
    console.log('[Navis] Element snapshot cache hit');
    return cached;
  }

  // Try fast method first (in-browser DOM query, very fast)
  const fastResult = await captureFastSnapshot(page);

  // The enriched DOM JSON is the primary agent state. It is faster and carries
  // selectors, action hints, form context, viewport status, and nearby labels.
  if (fastResult && fastResult.elementCount > 0) {
    setCachedSnapshot(page, fastResult);
    return fastResult;
  }

  // If fast DOM capture found nothing, fall back to Playwright's accessibility snapshot.
  try {
    const ariaStart = Date.now();
    const raw = await page.ariaSnapshot({
      mode: 'ai',
      timeout: 5000,
    } as any);

    // Merge or pick the best. Usually, ariaSnapshot is much better for semantic roles.
    if (raw && raw.length > (fastResult?.raw.length || 0)) {
      const refs = parseRefsOptimized(raw);
      const result: AriaSnapshotResult = {
        raw,
        refs,
        elementCount: refs.size,
        captureTimeMs: Date.now() - ariaStart,
      };
      setCachedSnapshot(page, result);
      return result;
    }
  } catch (err) {
    console.warn('[Navis] ariaSnapshot failed, using fast result or empty:', err);
  }

  if (fastResult) {
    setCachedSnapshot(page, fastResult);
    return fastResult;
  }

  const fallback: AriaSnapshotResult = {
    raw: `- ${await page.title().catch(() => 'page')} "no interactive elements found" [ref=e1]`,
    refs: new Map([['e1', { role: 'heading', name: 'no interactive elements found' }]]),
    elementCount: 0,
    captureTimeMs: Date.now() - Date.now(),
  };
  setCachedSnapshot(page, fallback);
  return fallback;
}

export function parseRefs(snapshot: string): Map<string, RefMetadata> {
  const refs = new Map<string, RefMetadata>();

  // Attempt JSON parse first
  const firstJsonChar = firstNonWhitespaceChar(snapshot);
  if (firstJsonChar === '[') {
    try {
      const parsed = JSON.parse(snapshot);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.ref) {
            refs.set(item.ref, { role: item.role || 'unknown', name: item.name || '' });
          }
        }
        return refs;
      }
    } catch (e) {
      // Fall back to regex
    }
  }

  const refRegex = /\[ref=([^\]]+)\]/g;
  const lines = snapshot.split('\n');

  for (const line of lines) {
    const match = line.match(refRegex);
    if (!match) continue;

    for (const refMatch of match) {
      const ref = refMatch.slice(5, -1);
      const roleMatch = line.match(/^\s*-\s*(\w+)/);
      const nameMatch = line.match(/"([^"]*)"/);

      refs.set(ref, {
        role: roleMatch ? roleMatch[1] : 'unknown',
        name: nameMatch ? nameMatch[1] : '',
      });
    }
  }

  return refs;
}

/**
 * Optimized ref parsing using single-pass algorithm
 * Avoids multiple regex matches per line
 */
export function parseRefsOptimized(snapshot: string): Map<string, RefMetadata> {
  const refs = new Map<string, RefMetadata>();

  // Attempt JSON parse first
  const firstJsonChar = firstNonWhitespaceChar(snapshot);
  if (firstJsonChar === '[') {
    try {
      const parsed = JSON.parse(snapshot);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.ref) {
            refs.set(String(item.ref), { role: item.role || 'unknown', name: item.name || '' });
          }
        }
        return refs;
      }
    } catch (e) {
      // Fall back to optimized string parsing
    }
  }

  const lines = snapshot.split('\n');

  for (const line of lines) {
    // Quick check: line must contain [ref=
    const refStart = line.indexOf('[ref=');
    if (refStart === -1) continue;

    // Extract ref value
    const refEnd = line.indexOf(']', refStart);
    if (refEnd === -1) continue;

    const ref = line.substring(refStart + 5, refEnd);

    // Extract role (first word after dash)
    let role = 'unknown';
    const dashIdx = line.indexOf('-');
    if (dashIdx !== -1) {
      const afterDash = line.substring(dashIdx + 1).trim();
      const spaceIdx = afterDash.indexOf(' ');
      role = spaceIdx !== -1 ? afterDash.substring(0, spaceIdx) : afterDash;
    }

    // Extract name (text between quotes)
    let name = '';
    const quoteStart = line.indexOf('"');
    if (quoteStart !== -1) {
      const quoteEnd = line.indexOf('"', quoteStart + 1);
      if (quoteEnd !== -1) {
        name = line.substring(quoteStart + 1, quoteEnd);
      }
    }

    refs.set(ref, { role, name });
  }

  return refs;
}

function firstNonWhitespaceChar(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return value[i];
  }
  return '';
}

export function formatElementsForPrompt(snapshot: string): string {
  try {
    const parsed = JSON.parse(snapshot);
    if (Array.isArray(parsed)) {
      const lines = parsed
        .filter(item => item?.ref)
        .slice(0, 160)
        .map(item => {
          const name = item.name || item.label || item.placeholder || item.href || '';
          const bits = [
            `[${item.ref}]`,
            item.role || item.tag || 'element',
            name ? `"${String(name).replace(/\s+/g, ' ').slice(0, 70)}"` : '',
            item.actions?.length ? `actions=${item.actions.join('|')}` : '',
            item.viewport && item.viewport !== 'full' ? `viewport=${item.viewport}` : '',
            item.disabled ? 'disabled' : '',
          ].filter(Boolean);
          return bits.join(' ');
        });

      const formatted = lines.join('\n');
      return formatted.length > 8000 ? `${formatted.slice(0, 8000)}\n...[refs truncated]` : formatted;
    }
  } catch {
    // Non-JSON aria snapshots are already compact and readable.
  }
  return snapshot;
}

/**
 * Clear the element snapshot cache (useful for testing or manual cache invalidation)
 */
export function clearElementCache(): void {
  elementSnapshotCache.clear();
  refMetadataCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
  const entries = Array.from(elementSnapshotCache.entries()).map(([key, entry]) => ({
    key,
    age: Date.now() - entry.timestamp,
  }));
  return { size: elementSnapshotCache.size, entries };
}

/**
 * Capture screenshot for vision model (full-screen mode)
 */
export async function captureForVision(page: Page): Promise<Buffer> {
  const fullScreenCapture = new FullScreenCaptureModule();

  // Hide overlay before screenshot so AI doesn't see it
  await page.evaluate(() => {
    const w = window as any;
    if (w.__navis_controls && w.__navis_controls.hideForScreenshot) {
      w.__navis_controls.hideForScreenshot();
    }
  }).catch(() => {});

  try {
    const result = await fullScreenCapture.captureFullScreen(page, {
      format: 'jpeg',
      quality: 85,
      fullScreen: true,
    });

    console.log(
      `[NAVIS] Captured at ${result.resolution.width}x${result.resolution.height} (window: ${result.windowSize.width}x${result.windowSize.height})`
    );

    return result.screenshot;
  } finally {
    // Show overlay again after screenshot
    await page.evaluate(() => {
      const w = window as any;
      if (w.__navis_controls && w.__navis_controls.showAfterScreenshot) {
        w.__navis_controls.showAfterScreenshot();
      }
    }).catch(() => {});
  }
}
