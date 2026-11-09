/**
 * Navis — Worker Window Adapter
 *
 * Drives the browser a worker shows on its desktop, so the user sees the worker
 * work: its own <webview> on this computer, or the Chromium on its cloud VM (see
 * page-driver.ts). Reads the page with a DOM snapshot (refs are stamped on
 * elements as data-navis-ref) and acts with real input events, like a person would.
 *
 * Positions reported to the logger are in Navis's 1280x720 frame of the window,
 * which the Workers screen maps back onto it for its AI cursor.
 */
import type { NavisLogger } from '../logger';
import type { BrowserControlAdapter, BrowserPageState, BrowserActionResult, ActionName } from './types';
import { VIEW, sleep, type PageDriver, type Modifier } from './page-driver';

/* In-page helpers, defined fresh in each call (the page may navigate between calls). */
const HELPERS = String.raw`
  const N = window;
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n || 120);
  const nameOf = (el) => clean(
    el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') ||
    (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) ? el.value : '') ||
    el.innerText || el.textContent || el.getAttribute('name') || ''
  );
  const labelOf = (el) => {
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText, 80);
    const by = el.getAttribute('aria-labelledby');
    if (by) { const l = document.getElementById(by.split(' ')[0]); if (l) return clean(l.innerText, 80); }
    return '';
  };
  const SEL = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=combobox],[role=textbox],[role=switch],[role=treeitem],[role=gridcell],[role=row],[role=dialog],[aria-modal="true"],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const byRef = (ref) => document.querySelector('[data-navis-ref="' + String(ref).replace(/[^\w-]/g, '') + '"]');
  const center = (el) => {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: innerWidth, h: innerHeight, name: nameOf(el) || el.tagName.toLowerCase() };
  };
  const findText = (q, inputs) => {
    q = clean(q, 200).toLowerCase();
    if (!q) return null;
    const pool = Array.from(document.querySelectorAll(inputs ? 'input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable=true],[role=textbox],[role=combobox]' : SEL)).filter(vis);
    const score = (el) => {
      const hay = [nameOf(el), labelOf(el), el.getAttribute('placeholder'), el.getAttribute('name'), el.id].map((s) => clean(s, 200).toLowerCase());
      if (hay.some((h) => h === q)) return 3;
      if (hay.some((h) => h && h.startsWith(q))) return 2;
      if (hay.some((h) => h && h.includes(q))) return 1;
      return 0;
    };
    let best = null, bs = 0;
    for (const el of pool) { const s = score(el); if (s > bs) { best = el; bs = s; if (s === 3) break; } }
    if (best || inputs) return best;
    // Plain text anywhere on the page (a card, a row) — the smallest visible element holding it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.toLowerCase().includes(q) && vis(node.parentElement)) return node.parentElement;
    }
    return null;
  };
`;

export const SNAPSHOT = `(() => { ${HELPERS}
  // Radical DOM downsampling: only actionable nodes and concise visible text.
  // Omit markup, scripts, styles, hidden subtrees and repeated nested wrappers.
  const els = Array.from(document.querySelectorAll(SEL)).filter(el => vis(el) && !el.closest('[aria-hidden="true"], [inert]'));
  // On-screen elements first, then the rest of the page in reading order.
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  els.sort((a, b) => Number(onScreen(b)) - Number(onScreen(a)));
  const refs = [];
  let n = 0;
  document.querySelectorAll('[data-navis-ref]').forEach((el) => el.removeAttribute('data-navis-ref'));
  const wrappers = new Set();
  for (const child of els) {
    const parent = child.parentElement?.closest(SEL);
    if (parent && nameOf(parent) === nameOf(child)) wrappers.add(parent);
  }
  const candidates = els.filter(el => !wrappers.has(el));
  for (const el of candidates.slice(0, 80)) {
    const ref = 'e' + (++n);
    el.setAttribute('data-navis-ref', ref);
    const tag = el.tagName.toLowerCase();
    refs.push({
      ref, tag, role: el.getAttribute('role') || undefined,
      name: nameOf(el) || undefined, label: labelOf(el) || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      href: tag === 'a' ? clean(el.getAttribute('href'), 160) : undefined,
      type: tag === 'input' ? el.type : undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
      checked: typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked') || undefined,
      expanded: el.getAttribute('aria-expanded') || undefined,
      value: tag === 'input' && el.type === 'password' ? undefined : clean(el.value, 80) || undefined,
    });
  }
  const lines = [], seen = new Set();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node, budget = 0, visited = 0;
  while ((node = walker.nextNode()) && budget < 3500 && visited++ < 12000) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,svg,[aria-hidden="true"],[inert]') || !vis(parent) || !onScreen(parent) || parent.closest(SEL)) continue;
    const line = clean(node.nodeValue, 240);
    if (line && !seen.has(line)) { seen.add(line); lines.push(line); budget += line.length; }
  }
  const omitted = Math.max(0, candidates.length - refs.length);
  const text = lines.join('\\n') + (omitted ? '\\n[' + omitted + ' more controls; scroll or search to inspect them.]' : '');
  return { url: location.href, title: document.title, text, refs };
})()`;

type Point = { x: number; y: number; w: number; h: number; name: string };

/**
 * Compact text of a CDP accessibility tree, like the companion extension renders.
 * Gives rich editors (Google Docs, Notion, Figma) structure the visible DOM lacks.
 */
function axText(nodes: any[]): string {
  if (!Array.isArray(nodes) || !nodes.length) return '';
  const byId = new Map<string, any>();
  for (const n of nodes) if (n?.nodeId) byId.set(n.nodeId, n);
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const lines: string[] = [];
  let chars = 0;
  const skip = new Set(['generic', 'none', 'presentation', 'InlineTextBox']);
  const walk = (node: any, depth: number) => {
    if (!node || chars >= 1800 || depth > 10) return;
    const role = String(node.role?.value || '');
    const name = String(node.name?.value ?? '').replace(/\s+/g, ' ').trim();
    if (!node.ignored && role && !skip.has(role)) {
      const props: string[] = [];
      for (const p of node.properties ?? []) {
        const v = p?.value?.value;
        if (v === undefined || v === null || v === false) continue;
        if (['checked', 'expanded', 'selected', 'pressed', 'disabled', 'required', 'invalid'].includes(String(p.name))) {
          props.push(`${p.name}=${v}`);
        }
      }
      const value = typeof node.value?.value === 'string' ? node.value.value.replace(/\s+/g, ' ').trim() : '';
      const line = `${'  '.repeat(Math.min(depth, 7))}${role}` +
        `${name ? ` "${name.slice(0, 90)}"` : ''}` +
        `${value && role === 'textbox' ? ` value="${value.slice(0, 60)}"` : ''}` +
        `${props.length ? ` ${props.join(' ')}` : ''}`;
      if (line.trim()) { lines.push(line); chars += line.length + 1; }
    }
    for (const id of node.childIds ?? []) walk(byId.get(id), depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

export class WorkerWindowAdapter implements BrowserControlAdapter {
  readonly mode = 'extension' as const;

  constructor(private page: PageDriver, private logger: NavisLogger) {}

  isAvailable(): boolean {
    return this.page.alive();
  }

  private js<T = any>(code: string, timeoutMs = 10000): Promise<T> {
    return this.page.js<T>(code, timeoutMs);
  }

  private async locate(args: Record<string, unknown>, inputs = false): Promise<Point | null> {
    const ref = String(args.ref || args.index || '').trim();
    const text = String(args.text_target || args.target || args.label || (inputs ? '' : args.text) || '').trim();
    return this.js<Point | null>(`(() => { ${HELPERS}
      let el = ${JSON.stringify(ref)} ? byRef(${JSON.stringify(ref)}) : null;
      if (!el) el = findText(${JSON.stringify(text)}, ${inputs});
      return el ? center(el) : null;
    })()`);
  }

  private async click(args: Record<string, unknown>, step: number, maxSteps: number, opts?: { button?: 'left' | 'right'; clickCount?: number }): Promise<BrowserActionResult> {
    let p = await this.locate(args);
    const what = String(args.ref || args.text || args.target || 'element');
    if (!p) {
      // A ref can go stale when an SPA re-renders: re-read the page, then retry once.
      await this.js(SNAPSHOT).catch(() => {});
      p = await this.locate(args);
    }
    if (!p) return { success: false, message: `Couldn't find ${what} on the page. Capture again and use a ref from the list.`, stateChanged: false };
    const before = await this.page.url();
    // Show the cursor heading there while the click happens.
    this.logger.elementClick(step, maxSteps, p.name, what, await this.page.frame(p));
    await this.page.click(p.x, p.y, opts);
    const now = await this.page.url();
    return { success: true, message: `Clicked "${p.name}"${now !== before ? ` (now on ${now})` : ''}`, stateChanged: true };
  }

  private async typeInto(args: Record<string, unknown>, step: number, maxSteps: number): Promise<BrowserActionResult> {
    const value = String(args.text ?? args.value ?? '');
    const hasTarget = Boolean(args.ref || args.target || args.label || args.text_target);
    let p = hasTarget ? await this.locate(args, true) : null;
    if (hasTarget && !p) {
      // The field may have re-rendered since the capture; read the page again.
      await this.js(SNAPSHOT).catch(() => {});
      p = await this.locate(args, true);
    }
    if (hasTarget && !p) return { success: false, message: `Couldn't find the field ${args.ref || args.target || args.label}.`, stateChanged: false };
    this.logger.elementInput(step, maxSteps, p?.name || 'focused field', value, p ? await this.page.frame(p) : undefined);
    if (p) await this.page.click(p.x, p.y);
    await this.page.typeText(value, args.clear !== false);
    if (args.submit || args.press_enter || args.enter) await this.key('Enter');
    return { success: true, message: `Typed "${value.slice(0, 60)}" into ${p?.name || 'the focused field'}`, stateChanged: true };
  }

  private async key(combo: string) {
    const KEYS: Record<string, string> = {
      enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete',
      arrowdown: 'Down', arrowup: 'Up', arrowleft: 'Left', arrowright: 'Right', down: 'Down', up: 'Up', left: 'Left', right: 'Right',
      pagedown: 'PageDown', pageup: 'PageUp', home: 'Home', end: 'End', space: 'Space', ' ': 'Space',
    };
    const MODS: Record<string, Modifier> = { control: 'control', ctrl: 'control', shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta', command: 'meta' };
    const parts = combo.split('+').map((s) => s.trim()).filter(Boolean);
    const modifiers = parts.slice(0, -1).map((m) => MODS[m.toLowerCase()]).filter(Boolean);
    const last = parts[parts.length - 1] || 'Enter';
    await this.page.key(KEYS[last.toLowerCase()] ?? last, modifiers);
  }

  async launch(options: { startUrl?: string }): Promise<void> {
    if (!this.isAvailable()) throw new Error('The worker browser window is not open');
    this.logger.browserLaunch(`Using ${this.page.label}`);
    if (options.startUrl && !(await this.page.url()).startsWith(options.startUrl)) {
      await this.goTo(options.startUrl);
      this.logger.pageNavigate(undefined, undefined, await this.page.url());
    }
  }

  private async goTo(raw: string) {
    const url = /^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    if (!/^https?:/i.test(url)) throw new Error(`Only web pages can be opened (${url})`);
    await this.page.navigate(url);
  }

  async capture(): Promise<BrowserPageState> {
    const native = this.page.desktopState?.();
    if (native) return { url: 'about:blank', title: native.title, text: native.text, refs: [], tabs: [], mode: 'extension' };
    // Same perception as the companion extension: refs from the DOM and the
    // accessibility tree (which is what makes canvas editors readable).
    const [snap, ax] = await Promise.all([
      (async () => {
        let value: any = null;
        for (let i = 0; i < 3 && !value; i++) {
          value = await this.js(SNAPSHOT).catch(async (e) => { if (i === 2) throw e; await sleep(600); return null; });
        }
        return value;
      })(),
      this.page.axTree ? this.page.axTree().catch(() => null) : Promise.resolve(null),
    ]);
    const url = String(snap?.url || (await this.page.url()));
    const title = String(snap?.title || (await this.page.title()) || 'Untitled');
    const domText = String(snap?.text || '');
    const axRendered = axText(Array.isArray(ax) ? ax : []);
    // Rich editors draw into a canvas, so their DOM text is thin: add the
    // accessibility tree exactly as the companion extension does.
    const useAx = Boolean(axRendered) && domText.trim().length < 900;
    const text = [useAx ? `[ACCESSIBILITY TREE]\n${axRendered}` : '', domText].filter(Boolean).join('\n\n');
    return {
      url,
      title,
      text,
      refs: Array.isArray(snap?.refs) ? snap.refs : [],
      tabs: [{ index: 0, title, url, active: true }],
      mode: 'extension',
    };
  }

  async screenshot(options?: { quality?: number }): Promise<string> {
    return this.page.screenshot(options?.quality ?? 70);
  }

  async executeAction(actionName: ActionName, actionArgs: Record<string, unknown>, step: number, maxSteps: number): Promise<BrowserActionResult> {
    const args = (actionArgs && typeof actionArgs === 'object' ? actionArgs : {}) as Record<string, any>;
    try {
      switch (actionName) {
        case 'go_to_url':
        case 'open_tab': {
          const url = String(args.url || '');
          if (!url) return { success: false, message: 'No URL given', stateChanged: false };
          await this.goTo(url);
          const now = await this.page.url();
          this.logger.pageNavigate(step, maxSteps, now);
          const note = actionName === 'open_tab' ? ' (this window has one tab, so it opened here)' : '';
          return { success: true, message: `Opened ${now}${note}`, stateChanged: true };
        }
        case 'go_back': {
          if (!(await this.page.back())) return { success: false, message: 'Nothing to go back to', stateChanged: false };
          this.logger.tabChange(step, maxSteps, 'Went back');
          return { success: true, message: `Went back to ${await this.page.url()}`, stateChanged: true };
        }
        case 'click_element':
        case 'click_text':
        case 'smart_click':
          return this.click(args, step, maxSteps);
        case 'browser_double_click':
        case 'browser_right_click':
        case 'right_click':
        case 'browser_click': {
          const opts = actionName === 'browser_double_click' ? { clickCount: 2 } : actionName.includes('right') ? { button: 'right' as const } : {};
          if (args.x !== undefined && args.y !== undefined) {
            if (await this.page.desktopClick?.(Number(args.x), Number(args.y), opts)) {
              return { success: true, message: `Clicked VM desktop at (${args.x}, ${args.y})`, stateChanged: true };
            }
            // Coordinates are in screenshot pixels (device pixels, capped at 1280 wide); input events use CSS pixels.
            const page = await this.js<{ w: number; h: number; dpr: number }>('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 })');
            const k = page.w / Math.max(1, Math.min(page.w * page.dpr, VIEW.w));
            const p = { x: Math.round(Number(args.x) * k), y: Math.round(Number(args.y) * k) };
            this.logger.elementClick(step, maxSteps, `(${args.x}, ${args.y})`, actionName, await this.page.frame({ ...p, w: page.w, h: page.h }));
            await this.page.click(p.x, p.y, opts);
            return { success: true, message: `Clicked at (${args.x}, ${args.y})`, stateChanged: true };
          }
          return this.click(args, step, maxSteps, opts);
        }
        case 'hover':
        case 'browser_hover': {
          let p = await this.locate(args);
          if (!p) {
            await this.js(SNAPSHOT).catch(() => {});
            p = await this.locate(args);
          }
          if (!p) return { success: false, message: 'Element not found', stateChanged: false };
          await this.page.hover(p.x, p.y);
          return { success: true, message: `Hovered "${p.name}"`, stateChanged: true };
        }
        case 'input_text':
        case 'smart_type':
        case 'browser_type':
          return this.typeInto(args, step, maxSteps);
        case 'select_option': {
          const want = String(args.value ?? args.option ?? args.text ?? '');
          const r = await this.js<{ ok: boolean; picked?: string }>(`(() => { ${HELPERS}
            const el = byRef(${JSON.stringify(String(args.ref || ''))}) || findText(${JSON.stringify(String(args.target || args.label || ''))}, true);
            if (!el || el.tagName !== 'SELECT') return { ok: false };
            const q = ${JSON.stringify(want.toLowerCase())};
            const opt = Array.from(el.options).find((o) => o.value.toLowerCase() === q || clean(o.text).toLowerCase() === q)
              || Array.from(el.options).find((o) => clean(o.text).toLowerCase().includes(q));
            if (!opt) return { ok: false };
            el.value = opt.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, picked: clean(opt.text) };
          })()`);
          this.logger.elementInput(step, maxSteps, String(args.ref || 'select'), want);
          return r.ok ? { success: true, message: `Selected "${r.picked}"`, stateChanged: true } : { success: false, message: `Couldn't select "${want}"`, stateChanged: false };
        }
        case 'press_key': {
          await this.key(String(args.key || args.keys || 'Enter'));
          this.logger.elementInput(step, maxSteps, 'page', String(args.key || 'key'));
          return { success: true, message: `Pressed ${args.key || 'Enter'}`, stateChanged: true };
        }
        case 'scroll_down':
        case 'scroll_up': {
          const dir = actionName === 'scroll_up' ? -1 : 1;
          if (await this.page.desktopScroll?.(dir * (Number(args.amount) || 600))) return { success: true, message: 'Scrolled VM app', stateChanged: true };
          const moved = await this.js<boolean>(`(() => {
            const pick = (el) => { for (; el && el !== document.body; el = el.parentElement) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4) return el; } return document.scrollingElement || document.documentElement; };
            const box = pick(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
            const before = box.scrollTop;
            const by = ${Number(args.amount) > 0 ? Number(args.amount) : 0} || Math.round((box === document.scrollingElement ? innerHeight : box.clientHeight) * 0.8);
            box.scrollBy({ top: ${dir} * by, behavior: 'instant' });
            return box.scrollTop !== before;
          })()`);
          this.logger.scroll(step, maxSteps, dir > 0 ? 'down' : 'up');
          return { success: true, message: moved ? `Scrolled ${dir > 0 ? 'down' : 'up'}` : `Already at the ${dir > 0 ? 'bottom' : 'top'}`, stateChanged: moved };
        }
        case 'wait':
        case 'wait_for_navigation':
        case 'wait_for_dom_change': {
          const ms = Math.min(10000, Math.max(300, Number(args.ms || args.timeoutMs || (Number(args.seconds) * 1000) || 2000)));
          const text = String(args.text || '');
          if (text) {
            // Polled inside the page, so a remote browser needs one round trip.
            await this.js(`new Promise((done) => { const end = Date.now() + ${ms};
              const tick = () => (document.body && document.body.innerText.includes(${JSON.stringify(text)})) || Date.now() > end ? done(true) : setTimeout(tick, 250);
              tick(); })`, ms + 2000).catch(() => {});
          } else {
            await sleep(ms);
          }
          await this.page.settle();
          this.logger.wait(step, maxSteps, `${ms}ms`);
          return { success: true, message: 'Waited', stateChanged: true };
        }
        case 'extract':
        case 'extract_content': {
          const text = await this.js<string>(`(document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000)`);
          this.logger.extract(step, maxSteps, String(args.goal || 'page content'));
          return { success: true, message: text || 'The page has no text', stateChanged: false };
        }
        case 'switch_tab':
        case 'close_tab':
          return { success: false, message: 'This browser window has a single tab. Use go_to_url or go_back instead.', stateChanged: false };
        case 'upload_file': {
          const raw = args.paths ?? args.files ?? args.path ?? args.file;
          const paths = (Array.isArray(raw) ? raw : [raw]).map((p) => String(p || '')).filter(Boolean);
          if (!paths.length) return { success: false, message: 'No files to upload', stateChanged: false };
          if (!this.page.uploadFiles) return { success: false, message: 'This window cannot attach files', stateChanged: false };
          const selector = String(args.ref || args.selector || args.target || '');
          await this.page.uploadFiles(paths, selector || undefined);
          this.logger.elementInput(step, maxSteps, selector || 'file input', paths.join(', '));
          return {
            success: true,
            message: `Attached ${paths.length} file(s)${selector ? ` to ${selector}` : ' to the page\'s file input'}`,
            stateChanged: true,
          };
        }
        case 'take_screenshot':
          return { success: true, message: 'Screenshot taken', stateChanged: false };
        case 'focus_form':
        case 'unfocus_form':
          return { success: true, message: 'The full page is always shown here', stateChanged: false };
        case 'done':
          return { success: args.success !== false, message: String(args.text || 'Done'), stateChanged: false, data: args };
        default:
          return { success: false, message: `The worker window can't do ${actionName}. Use click_element, input_text, press_key, scroll or go_to_url.`, stateChanged: false };
      }
    } catch (err: any) {
      return { success: false, message: `${actionName} failed: ${err?.message || err}`, stateChanged: false };
    }
  }
}
