/**
 * Navis — cloud VM page driver
 *
 * A cloud worker's web apps all run in one Chromium on its EverFern Cloud VM, shown in
 * the worker's windows as the VM's screen. This drives that Chromium through the API's
 * DevTools relay (POST /api/cloud-vms/<id>/browser-control), so the run happens on the
 * screen the user is watching. Each request runs a short batch of DevTools calls in the
 * VM, so related steps (move, press, release, wait for the load) go in one request.
 * When the VM's browsing runs in Browserbase, the API relays the same calls to that browser
 * instead, and the window shows only its page (a live view), not a whole VM screen.
 */
import { nativeImage } from 'electron';
import { nativeCloudRequest } from '../../../../lib/native-cloud';
import { VIEW, SELECT_FOCUSED, pageFrame, sleep, type PageDriver, type ClickOpts, type Modifier, type PagePoint } from './page-driver';

type Call = { method: string; params?: Record<string, unknown> };
/** app: the window this driver drives; with Browserbase each app window has its own tab. */
/** worker: whose browser on the VM (each worker has its own cookies, logins and tabs). */
export type CloudVmTarget = { vmId: string; apiUrl: string; token: () => string; app?: string; worker?: string };

const MOD_BITS: Record<Modifier, number> = { alt: 1, control: 2, meta: 4, shift: 8 };
/** Electron key names (what the adapter uses) -> DOM key, code and Windows key code. */
const NAMED: Record<string, [string, string, number, string?]> = {
  Enter: ['Enter', 'Enter', 13, '\r'], Tab: ['Tab', 'Tab', 9], Escape: ['Escape', 'Escape', 27],
  Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46], Space: [' ', 'Space', 32, ' '],
  Up: ['ArrowUp', 'ArrowUp', 38], Down: ['ArrowDown', 'ArrowDown', 40], Left: ['ArrowLeft', 'ArrowLeft', 37], Right: ['ArrowRight', 'ArrowRight', 39],
  PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34], Home: ['Home', 'Home', 36], End: ['End', 'End', 35],
};

function keyInfo(keyCode: string) {
  const named = NAMED[keyCode];
  if (named) return { key: named[0], code: named[1], vk: named[2], text: named[3] };
  const c = keyCode.length === 1 ? keyCode : keyCode.slice(0, 1);
  const up = c.toUpperCase();
  const code = /[a-z]/i.test(c) ? `Key${up}` : /\d/.test(c) ? `Digit${c}` : '';
  return { key: c, code, vk: /[a-z\d]/i.test(c) ? up.charCodeAt(0) : 0, text: c };
}

export class CloudVmDriver implements PageDriver {
  readonly label = "the browser on the worker's cloud VM";
  private page = { url: '', title: '' };
  /** Where the relay ran the calls: "browserbase", or "vm" for the VM's own Chromium. Empty until the first reply. */
  private engine = '';
  private screen: { left: number; top: number; sw: number; sh: number; at: number } | null = null;

  constructor(private target: CloudVmTarget) {}

  alive() { return true; }

  async workspace(params: Record<string, unknown>) {
    const [result] = await this.send([{ method: 'ef.workspace', params }]);
    return result;
  }

  async uploadFiles(paths: string[], selector?: string) {
    const [result] = await this.send([{ method: 'ef.uploadFiles', params: { paths, selector } }]);
    return result;
  }

  private async send(calls: Call[], retry = true): Promise<any[]> {
    const { apiUrl, vmId, token, app, worker } = this.target;
    const native = process.env.EVERFERN_SHELL === 'tauri' && apiUrl === 'https://api.everfern.app';
    const payload = { engine: app === 'chrome' ? 'vm' : 'browserbase', calls, app, worker };
    const nativeResponse = native ? await nativeCloudRequest(`/api/cloud-vms/${encodeURIComponent(vmId)}/browser-control`, token(), payload) : null;
    const res = nativeResponse ? { ...nativeResponse, json: async () => nativeResponse.data } : await fetch(`${apiUrl}/api/cloud-vms/${encodeURIComponent(vmId)}/browser-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(150_000),
    });
    let data: any = {};
    try { data = await res.json(); } catch { /* empty body */ }
    // 503: the VM's browser is up but not answering yet (a slow VM disk); give it a moment once.
    if (res.status === 503 && retry) {
      await sleep(5000);
      return this.send(calls, false);
    }
    if (!res.ok) throw new Error(data?.error || `The cloud VM browser didn't respond (${res.status})`);
    const engine = typeof data?.engine === 'string' ? data.engine : 'vm';
    if (engine !== this.engine) { this.engine = engine; this.screen = null; }
    if (data?.page && typeof data.page === 'object') {
      if (typeof data.page.url === 'string') this.page.url = data.page.url;
      if (typeof data.page.title === 'string') this.page.title = data.page.title;
    }
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const bad = results.find((r) => r && typeof r === 'object' && r.error);
    if (bad) throw new Error(String(bad.error));
    return results;
  }

  private static value(r: any) {
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'The page script failed');
    }
    return r?.result?.value;
  }

  async js<T = any>(code: string, timeoutMs = 10000): Promise<T> {
    const [r] = await this.send([{ method: 'Runtime.evaluate', params: { expression: code, returnByValue: true, awaitPromise: true, timeout: timeoutMs } }]);
    return CloudVmDriver.value(r) as T;
  }

  /** The accessibility tree of the visible tab, through the VM's DevTools relay. */
  async axTree(): Promise<any[] | null> {
    try {
      const [r] = await this.send([{ method: 'Accessibility.getFullAXTree' }]);
      return Array.isArray(r?.nodes) ? r.nodes : null;
    } catch {
      return null;
    }
  }

  async settle(maxMs = 8000) {
    await this.send([{ method: 'ef.settle', params: { ms: maxMs } }]);
  }

  async click(x: number, y: number, opts: ClickOpts = {}) {
    const button = opts.button ?? 'left';
    const calls: Call[] = [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x, y } }];
    for (let i = 1; i <= (opts.clickCount ?? 1); i++) {
      calls.push(
        { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x, y, button, clickCount: i } },
        { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x, y, button, clickCount: i } },
      );
    }
    calls.push({ method: 'ef.sleep', params: { ms: 300 } }, { method: 'ef.settle', params: { ms: 8000 } });
    await this.send(calls);
  }

  async hover(x: number, y: number) {
    await this.send([{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x, y } }]);
  }

  async typeText(text: string, clear: boolean) {
    if (!this.engine) await this.js('1');
    if (this.engine === 'vps') {
      if (clear) await this.send([{ method: 'ef.desktopKey', params: { key: 'a', modifiers: 2 } }]);
      await this.send([{ method: 'ef.desktopText', params: { text } }]);
      return;
    }
    const calls: Call[] = clear ? [{ method: 'Runtime.evaluate', params: { expression: SELECT_FOCUSED, returnByValue: true } }] : [];
    calls.push({ method: 'Input.insertText', params: { text } });
    await this.send(calls);
  }

  async key(keyCode: string, modifiers: Modifier[]) {
    if (!this.engine) await this.js('1');
    if (this.engine === 'vps') {
      const names: Record<string, string> = { Space: 'space', PageUp: 'Prior', PageDown: 'Next', Backspace: 'BackSpace', Enter: 'Return', '+': 'plus', '-': 'minus', '=': 'equal', '.': 'period', '/': 'slash', ',': 'comma', ';': 'semicolon', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash', '`': 'grave' };
      let key = names[keyCode] ?? keyCode;
      if (key.length === 1 && modifiers.some(modifier => ['control', 'alt', 'meta'].includes(modifier))) key = key.toLowerCase();
      await this.send([{ method: 'ef.desktopKey', params: { key, modifiers: modifiers.reduce((n, m) => n | MOD_BITS[m], 0) } }]);
      return;
    }
    const k = keyInfo(keyCode);
    const mods = modifiers.reduce((n, m) => n | (MOD_BITS[m] ?? 0), 0);
    // Text only without Ctrl/Alt/Meta, like a real keyboard (Ctrl+A selects, it doesn't type "a").
    const text = mods & ~MOD_BITS.shift ? undefined : k.text;
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: mods };
    await this.send([
      { method: 'Input.dispatchKeyEvent', params: { ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text, unmodifiedText: text } : {}) } },
      { method: 'Input.dispatchKeyEvent', params: { ...base, type: 'keyUp' } },
      { method: 'ef.sleep', params: { ms: 300 } },
      { method: 'ef.settle', params: { ms: 8000 } },
    ]);
  }

  async navigate(url: string) {
    const [nav] = await this.send([
      { method: 'Page.navigate', params: { url } },
      { method: 'ef.sleep', params: { ms: 300 } },
      { method: 'ef.settle', params: { ms: 12000 } },
    ]);
    const err = String(nav?.errorText || '');
    if (err && !err.includes('ERR_ABORTED')) throw new Error(`Couldn't open ${url} (${err})`);
  }

  async back() {
    const [r] = await this.send([{ method: 'ef.back' }, { method: 'ef.settle', params: { ms: 8000 } }]);
    return Boolean(r?.ok);
  }

  async url() {
    if (!this.page.url) await this.js('1').catch(() => {});
    return this.page.url;
  }

  async title() {
    if (!this.page.url) await this.js('1').catch(() => {});
    return this.page.title;
  }

  desktopState() {
    if (!['terminal', 'files'].includes(this.target.app ?? '')) return null;
    return { title: this.target.app === 'terminal' ? 'Terminal' : 'Files', text: 'Native application inside the worker VPS. Use take_screenshot, browser_click with screenshot coordinates, input_text without a target, press_key and scroll. DOM refs are unavailable for this desktop app.' };
  }

  async desktopScroll(delta: number) {
    if (!this.desktopState()) return false;
    await this.send([{ method: 'ef.desktopMouse', params: { type: 'mouseWheel', x: 640, y: 400, deltaY: delta } }]);
    return true;
  }

  async desktopClick(x: number, y: number, opts: ClickOpts) {
    if (!this.engine) await this.js('1');
    if (this.engine !== 'vps') return false;
    const button = opts.button ?? 'left';
    for (let i = 0; i < (opts.clickCount ?? 1); i++) await this.send([
      { method: 'ef.desktopMouse', params: { type: 'mousePressed', x, y, button } },
      { method: 'ef.desktopMouse', params: { type: 'mouseReleased', x, y, button } },
    ]);
    return true;
  }

  async screenshot(quality: number) {
    if (!this.engine) await this.js('1');
    if (this.engine === 'vps') {
      const [screen] = await this.send([{ method: 'ef.desktopScreenshot' }]);
      if (!screen?.data) throw new Error('The VPS desktop could not be captured');
      return `data:image/png;base64,${screen.data}`;
    }
    const params: Record<string, unknown> = { format: 'jpeg', quality };
    if (process.env.EVERFERN_SHELL === 'tauri') {
      // Scale in the VM browser: Tauri has no Electron NativeImage implementation.
      const viewport = await this.js<{ width: number; height: number; dpr: number }>('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1})');
      if (Number.isFinite(viewport?.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0) {
        const dpr = Number.isFinite(viewport.dpr) && viewport.dpr > 0 ? viewport.dpr : 1;
        params.clip = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: Math.min(1, VIEW.w / (viewport.width * dpr)) };
        params.captureBeyondViewport = false;
      }
    }
    const [r] = await this.send([{ method: 'Page.captureScreenshot', params }]);
    if (!r?.data) throw new Error('The cloud VM screen could not be captured');
    if (process.env.EVERFERN_SHELL === 'tauri') return `data:image/jpeg;base64,${r.data}`;
    const img = nativeImage.createFromBuffer(Buffer.from(String(r.data), 'base64'));
    if (img.isEmpty()) return `data:image/jpeg;base64,${r.data}`;
    const scaled = img.getSize().width > VIEW.w ? img.resize({ width: VIEW.w }) : img;
    return `data:image/jpeg;base64,${scaled.toJPEG(quality).toString('base64')}`;
  }

  /** The window shows the whole VM screen, so place the point by where the page sits on it.
   *  A Browserbase live view shows just the page, so there the page's own frame is the window. */
  async frame(p: PagePoint) {
    if (!this.engine) await this.js('1').catch(() => {});
    if (this.engine === 'browserbase' || (this.engine === 'vps' && this.target.app !== 'chrome')) return pageFrame(p);
    if (!this.screen || Date.now() - this.screen.at > 60_000) {
      const s = await this.js<{ left: number; top: number; sw: number; sh: number } | null>(
        `(() => { const bx = Math.max(0, (outerWidth - innerWidth) / 2);
          return { left: screenX + bx, top: screenY + Math.max(0, outerHeight - innerHeight - bx), sw: screen.width, sh: screen.height }; })()`,
      ).catch(() => null);
      this.screen = s && s.sw > 0 && s.sh > 0 ? { ...s, at: Date.now() } : null;
    }
    const s = this.screen;
    if (!s) return pageFrame(p);
    return {
      x: Math.round(Math.min(1, Math.max(0, (s.left + p.x) / s.sw)) * VIEW.w),
      y: Math.round(Math.min(1, Math.max(0, (s.top + p.y) / s.sh)) * VIEW.h),
    };
  }
}
