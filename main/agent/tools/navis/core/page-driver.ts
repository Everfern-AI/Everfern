/**
 * Navis — page drivers for worker windows
 *
 * The worker-window adapter reads and acts on a page through one of these:
 *  - WebviewDriver: a worker's own <webview> on this computer;
 *  - CloudVmDriver (cloud-vm-driver.ts): the Chromium on the worker's cloud VM,
 *    through the API's DevTools relay, so the run shows on the VM's screen.
 */
import type { WebContents } from 'electron';

export type Modifier = 'control' | 'shift' | 'alt' | 'meta';
export type ClickOpts = { button?: 'left' | 'right'; clickCount?: number };
/** A point in the page (CSS pixels) with the viewport size it was measured in. */
export type PagePoint = { x: number; y: number; w: number; h: number };

export interface PageDriver {
  workspace?(params: Record<string, unknown>): Promise<any>;
  uploadFiles?(paths: string[], selector?: string): Promise<any>;
  desktopState?(): { title: string; text: string } | null;
  desktopScroll?(delta: number): Promise<boolean>;
  desktopClick?(x: number, y: number, opts: ClickOpts): Promise<boolean>;
  /** "the worker's own browser window" / "the browser on the worker's cloud VM" */
  readonly label: string;
  alive(): boolean;
  /** Runs an expression in the page and returns its (JSON) value. */
  js<T = any>(code: string, timeoutMs?: number): Promise<T>;
  /** The page's accessibility tree (CDP Accessibility.getFullAXTree nodes), when the driver can read it. */
  axTree?(): Promise<any[] | null>;
  /** Attach files to a file input (by ref selector when given). */
  uploadFiles?(paths: string[], selector?: string): Promise<any>;
  /** Clicks at a page point, then waits for a load it started. */
  click(x: number, y: number, opts?: ClickOpts): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  /** Types into the focused element, replacing its content first when `clear`. */
  typeText(text: string, clear: boolean): Promise<void>;
  /** Presses a key (Electron key names: Enter, Tab, Down, a…), then waits for a load it started. */
  key(keyCode: string, modifiers: Modifier[]): Promise<void>;
  navigate(url: string): Promise<void>;
  back(): Promise<boolean>;
  settle(maxMs?: number): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  /** JPEG data URL, at most 1280 px wide. */
  screenshot(quality: number): Promise<string>;
  /** Where a page point is in Navis's 1280x720 frame of what the user sees (for the AI cursor). */
  frame(p: PagePoint): Promise<{ x: number; y: number }>;
}

export const VIEW = { w: 1280, h: 720 };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keeps a page click inside the window: the frame of the page itself. */
export const pageFrame = (p: PagePoint) => ({
  x: Math.round((p.x / Math.max(1, p.w)) * VIEW.w),
  y: Math.round((p.y / Math.max(1, p.h)) * VIEW.h),
});

/** Selects the focused field's content, so typed text replaces it. */
export const SELECT_FOCUSED = `(() => { const el = document.activeElement; if (!el) return;
  if (typeof el.select === 'function' && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.select();
  else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } })()`;

export class WebviewDriver implements PageDriver {
  readonly label = "the worker's own browser window";

  constructor(private wc: WebContents) {}

  alive() { return !this.wc.isDestroyed(); }

  async js<T = any>(code: string, timeoutMs = 10000): Promise<T> {
    if (this.wc.isDestroyed()) throw new Error('The worker browser window was closed');
    return Promise.race([
      this.wc.executeJavaScript(code, true) as Promise<T>,
      sleep(timeoutMs).then(() => { throw new Error('The page did not respond'); }),
    ]);
  }

  async settle(maxMs = 8000) {
    const start = Date.now();
    await sleep(150);
    while (this.wc.isLoading() && Date.now() - start < maxMs) await sleep(150);
  }

  private async afterInput() {
    await sleep(250);
    if (this.wc.isLoading()) await this.settle();
  }

  async click(x: number, y: number, opts: ClickOpts = {}) {
    const button = opts.button ?? 'left';
    const clickCount = opts.clickCount ?? 1;
    this.wc.focus();
    this.wc.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(40);
    for (let i = 1; i <= clickCount; i++) {
      this.wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i });
      this.wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i });
    }
    await this.afterInput();
  }

  async hover(x: number, y: number) {
    this.wc.sendInputEvent({ type: 'mouseMove', x, y });
  }

  async typeText(text: string, clear: boolean) {
    if (clear) await this.js(SELECT_FOCUSED).catch(() => {});
    this.wc.insertText(text);
  }

  /** The accessibility tree, over the same DevTools protocol Chrome exposes. */
  async axTree(): Promise<any[] | null> {
    if (this.wc.isDestroyed()) return null;
    let attachedHere = false;
    try {
      if (!this.wc.debugger.isAttached()) { this.wc.debugger.attach('1.3'); attachedHere = true; }
      const res = await this.wc.debugger.sendCommand('Accessibility.getFullAXTree') as any;
      return Array.isArray(res?.nodes) ? res.nodes : null;
    } catch {
      return null;
    } finally {
      if (attachedHere) { try { this.wc.debugger.detach(); } catch { /* already gone */ } }
    }
  }

  /** Attach files to the page's file input with DOM.setFileInputFiles. */
  async uploadFiles(paths: string[], selector?: string): Promise<any> {
    if (!paths.length) throw new Error('No files to upload');
    let attachedHere = false;
    try {
      if (!this.wc.debugger.isAttached()) { this.wc.debugger.attach('1.3'); attachedHere = true; }
      await this.wc.debugger.sendCommand('DOM.enable');
      const doc = await this.wc.debugger.sendCommand('DOM.getDocument') as any;
      const rootId = doc?.root?.nodeId;
      if (!rootId) throw new Error('The page is not ready');
      const sel = selector ? `[data-navis-ref="${String(selector).replace(/[^\w-]/g, '')}"]` : 'input[type=file]';
      const q = await this.wc.debugger.sendCommand('DOM.querySelector', { nodeId: rootId, selector: sel }) as any;
      if (!q?.nodeId) throw new Error('No file input on this page');
      await this.wc.debugger.sendCommand('DOM.setFileInputFiles', { files: paths, nodeId: q.nodeId });
      return { uploaded: paths.length };
    } finally {
      if (attachedHere) { try { this.wc.debugger.detach(); } catch { /* already gone */ } }
    }
  }

  async key(keyCode: string, modifiers: Modifier[]) {
    this.wc.focus();
    this.wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (!modifiers.length || modifiers.every((m) => m === 'shift')) {
      const ch = keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : keyCode.length === 1 ? keyCode : '';
      if (ch) this.wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers });
    }
    this.wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await this.afterInput();
  }

  async navigate(url: string) {
    // ERR_ABORTED is a redirect or a page that replaced the load; the page is still fine.
    await this.wc.loadURL(url).catch((e: any) => { if (!String(e?.message || e).includes('ERR_ABORTED')) throw e; });
    await this.settle();
  }

  async back() {
    if (!this.wc.navigationHistory.canGoBack()) return false;
    this.wc.navigationHistory.goBack();
    await this.settle();
    return true;
  }

  async url() { return this.wc.getURL(); }
  async title() { return this.wc.getTitle(); }

  async screenshot(quality: number) {
    const img = await this.wc.capturePage();
    if (img.isEmpty()) throw new Error('The worker window is not visible');
    const scaled = img.getSize().width > VIEW.w ? img.resize({ width: VIEW.w }) : img;
    return `data:image/jpeg;base64,${scaled.toJPEG(quality).toString('base64')}`;
  }

  async frame(p: PagePoint) { return pageFrame(p); }
}
