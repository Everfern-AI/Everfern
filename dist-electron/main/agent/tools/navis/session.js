"use strict";
/**
 * Navis — Browser Session Manager
 *
 * Handles Playwright browser lifecycle: launch, context, page/tab management, cleanup.
 * No chrome extension — pure Playwright automation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserSession = void 0;
const playwright_1 = require("playwright");
const overlay_1 = require("./overlay");
const playwright_setup_1 = require("../../../lib/playwright-setup");
const chromium = playwright_1.chromium;
class BrowserSession {
    browser = null;
    context = null;
    activePage = null;
    logger = null;
    setActivePage(page) {
        this.activePage = page;
    }
    getContext() {
        if (!this.context)
            throw new Error('Browser not initialized. Call launch() first.');
        return this.context;
    }
    get page() {
        if (!this.activePage)
            throw new Error('No active page. Call openTab() first.');
        return this.activePage;
    }
    get allPages() {
        if (!this.context)
            throw new Error('Browser not initialized.');
        return this.context.pages();
    }
    async launch(config = {}) {
        const { headless = false, startUrl, logger } = config;
        this.logger = logger || null;
        const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        if (this.browser) {
            this.logger?.browserLaunch('already launched, opening new tab');
            await this.openTab(startUrl || 'about:blank');
            return;
        }
        // Always launch fresh browser
        try {
            const executablePath = (0, playwright_setup_1.findChromiumExecutable)() || undefined;
            if (executablePath) {
                console.log(`[Navis] Using Chromium executable: ${executablePath}`);
            }
            this.browser = await chromium.launch({
                headless,
                executablePath,
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
                    '--window-size=1280,1024',
                ],
            });
            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 1024 },
                userAgent: realUA,
                locale: 'en-US',
                timezoneId: 'America/New_York',
            });
            // Inject overlay into all future pages in this context
            await this.context.addInitScript(overlay_1.OVERLAY_SCRIPT);
            await this.context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
            console.log('[Navis] Overlay script registered at context level');
        }
        catch (err) {
            if (this.browser)
                await this.browser.close().catch(() => { });
            this.browser = null;
            throw err;
        }
        // Navigate to startUrl or open initial tab
        if (startUrl && startUrl !== 'about:blank') {
            await this.openTab(startUrl);
        }
        else if (!this.activePage) {
            await this.openTab('about:blank');
        }
        this.logger?.browserLaunch(`headless=${headless}, 1280x1024, real Chrome`);
    }
    async openTab(url) {
        if (!this.context)
            throw new Error('Browser not initialized.');
        const targetPage = await this.context.newPage();
        if (url && url !== 'about:blank') {
            // Use a more robust goto that doesn't hang on domcontentloaded
            await targetPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(async (err) => {
                console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
                return targetPage.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => { });
            });
        }
        // Inject overlay script directly into the page after load to ensure it's present
        // This handles cases where addInitScript didn't work or the page loaded too fast
        try {
            await targetPage.evaluate((overlayScript) => {
                // Check if overlay is already initialized
                if (!window.__navis_controls) {
                    // Inject the overlay script directly
                    const script = document.createElement('script');
                    script.textContent = overlayScript;
                    document.documentElement.appendChild(script);
                }
            }, overlay_1.OVERLAY_SCRIPT).catch(() => { });
        }
        catch (err) {
            console.warn('[Navis] Failed to inject overlay into new tab:', err);
        }
        // Set up navigation listener to re-inject overlay on every page navigation
        targetPage.on('framenavigated', async (frame) => {
            if (frame === targetPage.mainFrame()) {
                console.log('[Navis] Page navigated, re-injecting overlay...');
                try {
                    await targetPage.evaluate((overlayScript) => {
                        // Check if overlay is already initialized
                        if (!window.__navis_controls) {
                            // Inject the overlay script directly
                            const script = document.createElement('script');
                            script.textContent = overlayScript;
                            document.documentElement.appendChild(script);
                        }
                    }, overlay_1.OVERLAY_SCRIPT).catch(() => { });
                }
                catch (err) {
                    console.warn('[Navis] Failed to re-inject overlay after navigation:', err);
                }
            }
        });
        await targetPage.bringToFront();
        this.activePage = targetPage;
        return targetPage;
    }
    async closeTab(page) {
        if (!this.context)
            return;
        await page.close().catch(() => { });
        const remaining = this.context.pages();
        if (remaining.length > 0) {
            this.activePage = remaining[remaining.length - 1];
        }
    }
    async getTabs() {
        if (!this.context)
            return [];
        const pages = this.context.pages();
        const tabs = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            let title = '';
            try {
                title = await p.title();
            }
            catch {
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
    async switchToTab(indexOrTitle) {
        const pages = this.allPages;
        if (typeof indexOrTitle === 'number') {
            if (indexOrTitle < 0 || indexOrTitle >= pages.length) {
                throw new Error(`Tab index ${indexOrTitle} out of range. Available tabs: 0-${pages.length - 1}`);
            }
            this.activePage = pages[indexOrTitle];
        }
        else {
            const page = pages.find(p => {
                try {
                    return p.title().then(t => t.toLowerCase().includes(indexOrTitle.toLowerCase()));
                }
                catch {
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
    async close() {
        const closeStartTime = Date.now();
        console.log('[Navis] 🔴 CLOSURE INITIATED - Starting browser session cleanup');
        try {
            // Force close all pages first to prevent hanging
            if (this.context) {
                console.log('[Navis] 🔴 Force closing all pages...');
                const pages = this.context.pages();
                for (const page of pages) {
                    try {
                        await page.close().catch(() => { });
                    }
                    catch (pageErr) {
                        console.warn(`[Navis] ⚠️ Error closing page: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
                    }
                }
                console.log(`[Navis] ✅ All pages closed (${pages.length} pages)`);
            }
            // Close context with timeout
            if (this.context) {
                console.log('[Navis] 🔴 Closing browser context...');
                const contextCloseStart = Date.now();
                try {
                    // Use Promise.race to enforce timeout on context close
                    await Promise.race([
                        this.context.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Context close timeout')), 5000))
                    ]);
                    const contextCloseTime = Date.now() - contextCloseStart;
                    console.log(`[Navis] ✅ Browser context closed successfully (${contextCloseTime}ms)`);
                }
                catch (contextErr) {
                    const contextCloseTime = Date.now() - contextCloseStart;
                    console.warn(`[Navis] ⚠️ Context close timeout or error (${contextCloseTime}ms): ${contextErr instanceof Error ? contextErr.message : String(contextErr)}`);
                }
                this.context = null;
            }
            else {
                console.log('[Navis] ℹ️ No context to close');
            }
            // Close browser with timeout
            if (this.browser) {
                console.log('[Navis] 🔴 Closing browser instance...');
                const browserCloseStart = Date.now();
                try {
                    // Use Promise.race to enforce timeout on browser close
                    await Promise.race([
                        this.browser.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 5000))
                    ]);
                    const browserCloseTime = Date.now() - browserCloseStart;
                    console.log(`[Navis] ✅ Browser instance closed successfully (${browserCloseTime}ms)`);
                }
                catch (browserErr) {
                    const browserCloseTime = Date.now() - browserCloseStart;
                    console.warn(`[Navis] ⚠️ Browser close timeout or error (${browserCloseTime}ms): ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`);
                }
                this.browser = null;
            }
            else {
                console.log('[Navis] ℹ️ No browser instance to close');
            }
            // Clear active page reference
            this.activePage = null;
            const totalCloseTime = Date.now() - closeStartTime;
            console.log(`[Navis] ✅ CLOSURE COMPLETE - Total cleanup time: ${totalCloseTime}ms`);
        }
        catch (err) {
            const totalCloseTime = Date.now() - closeStartTime;
            console.error(`[Navis] ❌ CLOSURE FAILED - Unexpected error during cleanup (${totalCloseTime}ms):`, err);
            this.activePage = null;
        }
    }
    async setOverlayStatus(text) {
        if (!this.activePage)
            return;
        await this.activePage.evaluate((t) => {
            const controls = window.__navis_controls;
            if (controls)
                controls.setStatus(t);
        }, text).catch(() => { });
    }
    async highlightElement(rect) {
        if (!this.activePage)
            return;
        await this.activePage.evaluate((r) => {
            const controls = window.__navis_controls;
            if (controls)
                controls.highlight(r);
        }, rect).catch(() => { });
    }
    async moveCursor(x, y, click = false) {
        if (!this.activePage)
            return;
        await this.activePage.evaluate(({ x, y, click }) => {
            const controls = window.__navis_controls;
            if (controls)
                controls.moveCursor(x, y, click);
        }, { x, y, click }).catch(() => { });
    }
    /**
     * Annotates interactive elements with visual labels (e1, e2, etc.) directly on the page.
     * This is used for vision-mode grounding so the AI can "see" the refs on the screenshot.
     */
    async annotateElements() {
        if (!this.activePage)
            return;
        try {
            await this.activePage.evaluate(() => {
                // Remove existing first to avoid double-labeling
                document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
                const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [data-scroll-ref]');
                elements.forEach((el) => {
                    const ref = el.getAttribute('data-ref') || el.getAttribute('data-scroll-ref');
                    if (!ref)
                        return;
                    const rect = el.getBoundingClientRect();
                    // Only label visible elements
                    if (rect.width > 2 && rect.height > 2 && rect.top < window.innerHeight && rect.left < window.innerWidth) {
                        const label = document.createElement('div');
                        label.className = '__navis_ref_label';
                        label.textContent = ref;
                        const isScroll = ref.startsWith('s');
                        Object.assign(label.style, {
                            position: 'fixed',
                            top: `${Math.max(0, rect.top)}px`,
                            left: `${Math.max(0, rect.left)}px`,
                            backgroundColor: isScroll ? '#007AFF' : '#ff3366',
                            color: 'white',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            zIndex: '2147483640',
                            pointerEvents: 'none',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                            lineHeight: '1',
                            fontFamily: 'system-ui, sans-serif',
                            border: '1px solid white',
                            transform: 'translate(-50%, -50%)',
                        });
                        document.body.appendChild(label);
                    }
                });
            });
        }
        catch (err) {
            console.warn('[Navis] Failed to annotate elements:', err);
        }
    }
    /**
     * Removes all visual ref labels from the page.
     */
    async removeAnnotations() {
        if (!this.activePage)
            return;
        try {
            await this.activePage.evaluate(() => {
                document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
            });
        }
        catch (err) {
            console.warn('[Navis] Failed to remove annotations:', err);
        }
    }
}
exports.BrowserSession = BrowserSession;
