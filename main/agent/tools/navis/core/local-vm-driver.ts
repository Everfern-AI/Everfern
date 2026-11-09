import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Browser, Page } from 'playwright';
import { ALPINE_DISTRO } from '../../alpine-vm';
import { pageFrame, type PageDriver, type PagePoint, type ClickOpts, type Modifier } from './page-driver';

const exec = promisify(execFile);
let connecting: Promise<Browser> | null = null;

async function alpineBrowser(): Promise<Browser> {
  if (connecting) {
    const browser = await connecting;
    if (browser.isConnected()) return browser;
    connecting = null;
  }
  connecting = (async () => {
    // Obtain the exact browser UUID from INSIDE Alpine. Never discover a host browser.
    const script = "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:19222/json/version', timeout=5).read().decode())";
    const { stdout } = await exec('wsl.exe', ['-d', ALPINE_DISTRO, '-u', 'root', '--exec', 'python3', '-c', script],
      { windowsHide: true, timeout: 10_000, encoding: 'utf8' });
    const endpoint = JSON.parse(stdout).webSocketDebuggerUrl;
    const url = new URL(endpoint);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '19222') throw new Error('Invalid Alpine browser endpoint');
    const { chromium } = await import('playwright');
    return chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  })().catch((error) => { connecting = null; throw error; });
  return connecting;
}

export class LocalVmDriver implements PageDriver {
  readonly label = 'the browser inside the Alpine VM';
  private tab: Page | null = null;
  constructor(private startUrl: string) {}
  alive() { return true; }
  private async page() {
    if (this.tab && !this.tab.isClosed()) return this.tab;
    const browser = await alpineBrowser();
    const context = browser.contexts()[0];
    if (!context) throw new Error('The Alpine browser has no profile');
    const host = new URL(this.startUrl).hostname;
    this.tab = context.pages().find((p) => { try { return new URL(p.url()).hostname === host; } catch { return false; } }) ?? await context.newPage();
    if (this.tab.url() === 'about:blank') await this.tab.goto(this.startUrl, { waitUntil: 'domcontentloaded' });
    return this.tab;
  }
  async js<T = any>(code: string): Promise<T> { return (await this.page()).evaluate(code) as Promise<T>; }
  async axTree(): Promise<any[] | null> {
    try {
      const p = await this.page();
      const cdp = await p.context().newCDPSession(p);
      try {
        const res: any = await cdp.send('Accessibility.getFullAXTree');
        return Array.isArray(res?.nodes) ? res.nodes : null;
      } finally {
        await cdp.detach().catch(() => {});
      }
    } catch {
      return null;
    }
  }
  async click(x: number, y: number, opts: ClickOpts = {}) {
    const p = await this.page(); await p.bringToFront();
    await p.mouse.click(x, y, { button: opts.button, clickCount: opts.clickCount });
    await this.settle();
  }
  async hover(x: number, y: number) { const p = await this.page(); await p.bringToFront(); await p.mouse.move(x, y); }
  async typeText(text: string, clear: boolean) {
    const p = await this.page(); await p.bringToFront();
    if (clear) await p.keyboard.press('Control+A');
    await p.keyboard.insertText(text);
  }
  async key(code: string, modifiers: Modifier[]) {
    const p = await this.page(); await p.bringToFront();
    const keys: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
    const mods: Record<Modifier, string> = { control: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
    await p.keyboard.press([...modifiers.map((m) => mods[m]), keys[code] || code].join('+'));
    await this.settle();
  }
  async navigate(url: string) { const p = await this.page(); await p.bringToFront(); await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }); }
  async back() { return !!await (await this.page()).goBack({ waitUntil: 'domcontentloaded' }); }
  async settle(maxMs = 8000) { await (await this.page()).waitForLoadState('domcontentloaded', { timeout: maxMs }).catch(() => {}); }
  async url() { return (await this.page()).url(); }
  async title() { return (await this.page()).title(); }
  async screenshot(quality: number) { return 'data:image/jpeg;base64,' + (await (await this.page()).screenshot({ type: 'jpeg', quality: Math.max(1, Math.min(100, quality)) })).toString('base64'); }
  async frame(p: PagePoint) { return pageFrame(p); }
}
