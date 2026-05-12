/**
 * Navis — Browser Session Manager
 * 
 * Handles Playwright browser lifecycle: launch, context, page/tab management, cleanup.
 * No chrome extension — pure Playwright automation.
 */

import { chromium as pwChromium, Browser, BrowserContext, Page } from 'playwright';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { OVERLAY_SCRIPT } from './overlay';
import { NavisLogger } from './logger';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as os from 'os';

const chromium = addExtra(pwChromium);
chromium.use(StealthPlugin());

export interface SessionConfig {
  headless?: boolean;
  startUrl?: string;
  logger?: NavisLogger;
  autoLaunchChrome?: boolean;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

// ── Chrome auto-launch helpers ─────────────────────────────────────

/** Check if a TCP port is already in use */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => { srv.close(); resolve(false); });
    srv.listen(port, '127.0.0.1');
  });
}

/** Get the platform-specific Chrome executable path */
function getChromePath(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    // Try common install locations
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${os.homedir()}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    // Return the first that exists (we'll try all of them — spawn will fail if none exist)
    return paths[0];
  } else if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    return 'google-chrome';
  }
}

let chromeProcess: ChildProcess | null = null;

/**
 * Auto-launch Chrome with --remote-debugging-port=9222 if not already running.
 * Returns true if Chrome is ready for CDP connection.
 */
async function ensureChromeWithCDP(logger?: NavisLogger | null): Promise<boolean> {
  const PORT = 9222;
  
  // Check if port is already in use (Chrome might already be running with debug port)
  const portTaken = await isPortInUse(PORT);
  if (portTaken) {
    logger?.browserLaunch('Chrome already running with CDP on port 9222');
    return true;
  }

  // Launch Chrome with remote debugging
  const chromePath = getChromePath();
  const args = [
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-translate',
    '--disable-features=ChromeWhatsNewUI',
    '--start-maximized',
  ];

  logger?.browserLaunch(`Launching Chrome: ${chromePath}`);
  console.log(`[Navis] Auto-launching Chrome with CDP: ${chromePath} ${args.join(' ')}`);

  try {
    chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    chromeProcess.unref();

    // Wait for Chrome to start and open the debug port
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const ready = await isPortInUse(PORT);
      if (ready) {
        logger?.browserLaunch('Chrome CDP ready on port 9222');
        console.log('[Navis] Chrome CDP port 9222 is ready');
        return true;
      }
    }

    console.warn('[Navis] Chrome launched but CDP port not ready after 5s');
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Navis] Failed to auto-launch Chrome: ${msg}`);
    logger?.browserLaunch(`Chrome auto-launch failed: ${msg}`);
    return false;
  }
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private logger: NavisLogger | null = null;

  setActivePage(page: Page) {
    this.activePage = page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error('Browser not initialized. Call launch() first.');
    return this.context;
  }

  get page(): Page {
    if (!this.activePage) throw new Error('No active page. Call openTab() first.');
    return this.activePage;
  }

  get allPages(): Page[] {
    if (!this.context) throw new Error('Browser not initialized.');
    return this.context.pages();
  }

  async launch(config: SessionConfig = {}): Promise<void> {
    const { headless = false, startUrl, logger, autoLaunchChrome = true } = config;
    this.logger = logger || null;

    const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    if (this.browser) {
      this.logger?.browserLaunch('already launched, opening new tab');
      await this.openTab(startUrl || 'about:blank');
      return;
    }

    // Step 1: Auto-launch Chrome with CDP if enabled
    if (autoLaunchChrome) {
      await ensureChromeWithCDP(this.logger);
    }

    // Step 2: Try connecting to existing Chrome via CDP
    try {
      const browserCDP = await pwChromium.connectOverCDP('http://127.0.0.1:9222', {
        timeout: 5000,
      });
      this.browser = browserCDP;
      this.context = browserCDP.contexts()[0] || await browserCDP.newContext({
        viewport: null,
        userAgent: realUA,
      });

      // Find an existing page to reuse if possible
      const pages = this.context.pages();
      if (pages.length > 0) {
        // Prefer a blank page or the last active page
        const blankPage = pages.find(p => p.url() === 'about:blank' || p.url() === 'chrome://newtab/');
        this.activePage = blankPage || pages[pages.length - 1];
      }

      // Fix viewport on CDP-connected pages
      for (const p of pages) {
        try {
          await p.addInitScript(OVERLAY_SCRIPT, { runOnReload: true }).catch(() => {});
        } catch { }
      }

      this.logger?.browserLaunch('connected to existing Chrome via CDP (port 9222)');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger?.browserLaunch(`CDP connection failed: ${errMsg}, launching fresh browser`);
      console.warn(`[Navis] CDP connection failed: ${errMsg}`);
    }

    // Fallback: launch fresh browser
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({
          headless,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-infobars',
            '--disable-blink-features=AutomationControlled',
            '--disable-default-apps',
            '--no-first-run',
            '--disable-translate',
            '--disable-features=ChromeWhatsNewUI',
            '--disable-background-networking',
            '--disable-sync',
            '--metrics-recording-only',
            '--disable-component-update',
            '--safebrowsing-disable-auto-update',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-domain-reliability',
            '--disable-features=IsolateOrigins,site-per-process',
            '--lang=en-US',
          ],
        });

        this.context = await this.browser.newContext({
          viewport: null,
          userAgent: realUA,
          locale: 'en-US',
          timezoneId: 'America/New_York',
        });
      } catch (err) {
        if (this.browser) await this.browser.close().catch(() => {});
        this.browser = null;
        throw err;
      }
    }

    // Navigate to startUrl or open initial tab
    if (startUrl && startUrl !== 'about:blank') {
      await this.openTab(startUrl);
    } else if (!this.activePage) {
      await this.openTab('about:blank');
    }

    this.logger?.browserLaunch(`headless=${headless}, 1920x1080, real Chrome`);
  }

  async openTab(url?: string): Promise<Page> {
    if (!this.context) throw new Error('Browser not initialized.');

    // If we are in CDP mode and already have a blank page, reuse it
    const pages = this.context.pages();
    let targetPage = pages.find(p => p.url() === 'about:blank' || p.url() === 'chrome://newtab/');
    
    if (!targetPage) {
      targetPage = await this.context.newPage();
    }

    await targetPage.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    }).catch(() => {});

    await targetPage.addInitScript(OVERLAY_SCRIPT, { runOnReload: true }).catch(() => {});

    if (url && url !== 'about:blank') {
      // Use a more robust goto that doesn't hang on domcontentloaded
      await targetPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(async (err) => {
        console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
        return targetPage!.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
      });
    }

    await targetPage.bringToFront();
    this.activePage = targetPage;
    return targetPage;
  }

  async closeTab(page: Page): Promise<void> {
    if (!this.context) return;

    await page.close().catch(() => {});

    const remaining = this.context.pages();
    if (remaining.length > 0) {
      this.activePage = remaining[remaining.length - 1];
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    if (!this.context) return [];

    const pages = this.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = '';
      try {
        title = await p.title();
      } catch {
        title = 'Loading...';
      }
      tabs.push({
        id: `tab-${i + 1}`,
        url: p.url(),
        title,
        isActive: p === this.activePage,
      });
    }

    return tabs;
  }

  async switchToTab(indexOrTitle: number | string): Promise<void> {
    const pages = this.allPages;

    if (typeof indexOrTitle === 'number') {
      if (indexOrTitle < 0 || indexOrTitle >= pages.length) {
        throw new Error(`Tab index ${indexOrTitle} out of range. Available tabs: 0-${pages.length - 1}`);
      }
      this.activePage = pages[indexOrTitle];
    } else {
      const page = pages.find(p => {
        try {
          return p.title().then(t => t.toLowerCase().includes(indexOrTitle.toLowerCase()));
        } catch {
          return false;
        }
      });
      if (!page) {
        throw new Error(`No tab found matching "${indexOrTitle}". Available: ${pages.map((p, i) => `#${i}: ${p.url()}`).join(', ')}`);
      }
      this.activePage = page;
    }

    await this.activePage.bringToFront();
  }

  async close(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch {
    }

    this.activePage = null;
  }

  async setOverlayStatus(text: string): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((t) => {
      const el = (window as any).__navis_set_status;
      if (el) el(t);
    }, text).catch(() => {});
  }

  async highlightElement(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((r) => {
      const el = (window as any).__navis_highlight;
      if (el) el(r);
    }, rect).catch(() => {});
  }

  /**
   * Annotates interactive elements with visual labels (e1, e2, etc.) directly on the page.
   * This is used for vision-mode grounding so the AI can "see" the refs on the screenshot.
   */
  async annotateElements(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        // Remove existing first to avoid double-labeling
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
        
        const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"]');
        let ref = 0;
        elements.forEach((el: Element) => {
          ref++;
          const rect = el.getBoundingClientRect();
          // Only label visible elements
          if (rect.width > 2 && rect.height > 2 && rect.top < window.innerHeight && rect.left < window.innerWidth) {
            const label = document.createElement('div');
            label.className = '__navis_ref_label';
            label.textContent = `e${ref}`;
            Object.assign(label.style, {
              position: 'fixed',
              top: `${Math.max(0, rect.top)}px`,
              left: `${Math.max(0, rect.left)}px`,
              backgroundColor: '#ff3366',
              color: 'white',
              fontSize: '11px',
              fontWeight: 'bold',
              padding: '2px 4px',
              borderRadius: '4px',
              zIndex: '2147483647',
              pointerEvents: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
              lineHeight: '1',
              fontFamily: 'system-ui, sans-serif',
              border: '1px solid white',
              transform: 'translate(-50%, -50%)',
            });
            document.body.appendChild(label);
            
            // Optional: red border around the element
            // (el as HTMLElement).style.outline = '2px solid #ff3366';
            // el.classList.add('__navis_annotated');
          }
        });
      });
    } catch (err) {
      console.warn('[Navis] Failed to annotate elements:', err);
    }
  }

  /**
   * Removes all visual ref labels from the page.
   */
  async removeAnnotations(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
      });
    } catch (err) {
      console.warn('[Navis] Failed to remove annotations:', err);
    }
  }
}