/**
 * Navis — Browser Control Adapters
 *
 * Implements the BrowserControlAdapter interface for two backends:
 * - ExtensionBrowserAdapter: controls user's real browser via WebSocket bridge
 * - PlaywrightBrowserAdapter: controls isolated Playwright browser
 *
 * Equivalent to BrowserOS's CDP backend connection layer.
 */

import { bridgeServer } from '../../../../lib/extension-server';
import type { AIClient } from '../../../../lib/ai-client';
import { BrowserSession } from '../session';
import { executeAction } from '../actions';
import type { NavisLogger } from '../logger';
import type {
  BrowserControlAdapter,
  BrowserPageState,
  BrowserActionResult,
  ActionName,
} from './types';

export type { BrowserPageState, BrowserActionResult };

function normalizeResult(raw: any, fallbackMessage: string, stateChanged = false): BrowserActionResult {
  const success = raw?.success !== false;
  return {
    success,
    message: String(raw?.message || raw?.data?.message || fallbackMessage),
    stateChanged: Boolean(raw?.stateChanged ?? raw?.data?.stateChanged ?? stateChanged),
    data: raw,
  };
}

function firstActionValue<T = Record<string, unknown>>(value: unknown): T {
  return (value && typeof value === 'object' ? value : {}) as T;
}

// ── Extension Adapter ────────────────────────────────────────────────────────

export class ExtensionBrowserAdapter implements BrowserControlAdapter {
  readonly mode = 'extension' as const;
  private activeTabId?: number;
  private cachedTabs: any[] = [];
  private tabCacheExpiresAt = 0;
  private static readonly TAB_CACHE_TTL_MS = 5000;

  constructor(private logger: NavisLogger) {}

  isAvailable(): boolean {
    return bridgeServer.hasConnectedExtensions();
  }

  async launch(options: { startUrl?: string }): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Navis companion extension is not connected');
    }

    if (options.startUrl) {
      const opened = await bridgeServer.sendRequest('open_tab', { url: options.startUrl, active: true }, 15000);
      this.activeTabId = Number(opened?.tabId || opened?.tab?.id || opened?.data?.tabId || opened?.data?.tab?.id || 0) || undefined;
      this.logger.browserLaunch('Extension-first browser control connected');
      this.logger.pageNavigate(undefined, undefined, opened?.url || opened?.tab?.url || options.startUrl);
      return;
    }

    const captured = await bridgeServer.sendRequest('capture', {}, 10000);
    this.activeTabId = Number(captured?.tabId || captured?.tab?.id || captured?.data?.tabId || 0) || undefined;
    this.logger.browserLaunch('Extension-first browser control connected');
  }

  async capture(): Promise<BrowserPageState> {
    const now = Date.now();
    const needsTabs = now >= this.tabCacheExpiresAt;

    let capture: any;
    let lastCaptureError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        capture = await bridgeServer.sendRequest('capture', { tabId: this.activeTabId }, 15000);
        break;
      } catch (err: any) {
        lastCaptureError = err;
        const isTimeout = String(err?.message || '').toLowerCase().includes('timed out') ||
                          String(err?.message || '').toLowerCase().includes('unresponsive');
        console.warn(`[Navis] capture attempt ${attempt + 1}/3 failed: ${err.message}${isTimeout ? ' (retrying...)' : ''}`);
        if (!isTimeout || attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (!capture) throw lastCaptureError || new Error('capture failed');

    const tabsResult = needsTabs
      ? await bridgeServer.sendRequest('get_tabs', {}, 8000).catch(() => ({ tabs: [] }))
      : { tabs: this.cachedTabs };

    if (needsTabs && Array.isArray(tabsResult?.tabs)) {
      this.cachedTabs = tabsResult.tabs;
      this.tabCacheExpiresAt = now + ExtensionBrowserAdapter.TAB_CACHE_TTL_MS;
    }

    const snapshot = capture?.snapshot || capture?.data?.snapshot || capture;
    const tab = capture?.tab || capture?.data?.tab || {};
    const tabId = Number(capture?.tabId || capture?.data?.tabId || tab?.id || this.activeTabId || 0) || undefined;
    if (tabId) this.activeTabId = tabId;

    return {
      tabId,
      url: String(snapshot?.url || capture?.url || tab?.url || ''),
      title: String(snapshot?.title || capture?.title || tab?.title || 'Untitled'),
      text: String(snapshot?.text || capture?.text || ''),
      refs: Array.isArray(snapshot?.refs) ? snapshot.refs : Array.isArray(capture?.refs) ? capture.refs : [],
      tabs: this.cachedTabs,
      snapshot,
      mode: 'extension',
    };
  }

  async screenshot(options?: { quality?: number }): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await bridgeServer.sendRequest('screenshot', { tabId: this.activeTabId, quality: options?.quality || 70 }, 15000);
        if (!result || !result.success || !result.dataUrl) {
          throw new Error(result?.message || 'Failed to capture screenshot via extension');
        }
        return result.dataUrl;
      } catch (err: any) {
        const isTimeout = String(err?.message || '').toLowerCase().includes('timed out') ||
                          String(err?.message || '').toLowerCase().includes('unresponsive');
        console.warn(`[Navis] screenshot attempt ${attempt + 1}/3 failed: ${err.message}${isTimeout ? ' (retrying...)' : ''}`);
        if (!isTimeout || attempt === 2) throw err;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error('Screenshot failed after retries');
  }

  async executeAction(
    actionName: ActionName,
    actionArgs: Record<string, unknown>,
    step: number,
    maxSteps: number,
  ): Promise<BrowserActionResult> {
    const args = firstActionValue(actionArgs);

    switch (actionName) {
      case 'go_to_url': {
        const url = String(args.url || '');
        const result = await bridgeServer.sendRequest('navigate', { tabId: this.activeTabId, url, active: true }, 20000);
        this.activeTabId = Number(result?.tabId || result?.tab?.id || this.activeTabId || 0) || undefined;
        this.logger.pageNavigate(step, maxSteps, result?.url || url);
        return normalizeResult(result, `Opened ${url}`, true);
      }
      case 'go_back': {
        const result = await bridgeServer.sendRequest('go_back', { tabId: this.activeTabId }, 12000);
        this.logger.tabChange(step, maxSteps, 'Went back');
        return normalizeResult(result, 'Went back', true);
      }
      case 'click_element': {
        const ref = String(args.ref || '');
        const result = await bridgeServer.sendRequest('click', { tabId: this.activeTabId, ref }, 12000);
        this.logger.elementClick(step, maxSteps, result?.target || result?.name || ref);
        return normalizeResult(result, `Clicked ${ref}`, true);
      }
      case 'click_text': {
        const result = await bridgeServer.sendRequest('click_text', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementClick(step, maxSteps, result?.target || String(args.text || args.target || 'text'));
        return normalizeResult(result, `Clicked ${args.text || args.target || 'text'}`, true);
      }
      case 'smart_click': {
        const result = await bridgeServer.sendRequest('smart_click', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementClick(step, maxSteps, result?.target || String(args.text || args.target || args.ref || 'element'));
        return normalizeResult(result, 'Clicked element', true);
      }
      case 'browser_click': {
        const result = await bridgeServer.sendRequest('browser_click', { tabId: this.activeTabId, ...args }, 12000);
        const position = args.x !== undefined && args.y !== undefined ? { x: Number(args.x), y: Number(args.y) } : undefined;
        this.logger.elementClick(step, maxSteps, position ? `(${args.x},${args.y})` : (result?.target || 'coordinates'), 'browser_click', position);
        return normalizeResult(result, `Clicked at coordinates (${args.x}, ${args.y})`, true);
      }
      case 'browser_double_click': {
        const result = await bridgeServer.sendRequest('browser_double_click', { tabId: this.activeTabId, ...args }, 12000);
        const position = args.x !== undefined && args.y !== undefined ? { x: Number(args.x), y: Number(args.y) } : undefined;
        this.logger.elementClick(step, maxSteps, position ? `(${args.x},${args.y})` : (result?.target || 'coordinates'), 'browser_double_click', position);
        return normalizeResult(result, `Double-clicked at coordinates (${args.x}, ${args.y})`, true);
      }
      case 'browser_right_click': {
        const result = await bridgeServer.sendRequest('browser_right_click', { tabId: this.activeTabId, ...args }, 12000);
        const position = args.x !== undefined && args.y !== undefined ? { x: Number(args.x), y: Number(args.y) } : undefined;
        this.logger.elementClick(step, maxSteps, position ? `(${args.x},${args.y})` : (result?.target || 'coordinates'), 'browser_right_click', position);
        return normalizeResult(result, `Right-clicked at coordinates (${args.x}, ${args.y})`, true);
      }
      case 'hover':
      case 'browser_hover': {
        const result = await bridgeServer.sendRequest('browser_hover', { tabId: this.activeTabId, ...args }, 10000);
        const position = args.x !== undefined && args.y !== undefined ? { x: Number(args.x), y: Number(args.y) } : undefined;
        this.logger.thinking(step, maxSteps, position ? `Hovered coordinates (${args.x}, ${args.y})` : `Hovered ${args.ref || 'element'}`, { actionName, mode: 'extension-first' });
        return normalizeResult(result, position ? `Hovered coordinates (${args.x}, ${args.y})` : `Hovered ${args.ref || 'element'}`, false);
      }
      case 'right_click': {
        const result = await bridgeServer.sendRequest('browser_right_click', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementClick(step, maxSteps, String(args.ref || 'element'), 'right_click');
        return normalizeResult(result, `Right-clicked ${args.ref || 'element'}`, true);
      }
      case 'select_option': {
        const result = await bridgeServer.sendRequest('select_option', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementInput(step, maxSteps, String(args.ref || 'element'), String(args.value || args.option || ''));
        return normalizeResult(result, `Selected option ${args.value || args.option || ''}`, true);
      }
      case 'upload_file': {
        const result = await bridgeServer.sendRequest('upload_file', { tabId: this.activeTabId, ...args }, 20000);
        this.logger.elementInput(step, maxSteps, String(args.ref || 'input'), String(args.files || args.file || ''));
        return normalizeResult(result, `Uploaded files`, true);
      }
      case 'input_text': {
        const result = await bridgeServer.sendRequest('input', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementInput(step, maxSteps, String(args.ref || result?.target || 'input'), String(args.text || ''));
        return normalizeResult(result, `Typed into ${args.ref || 'input'}`, true);
      }
      case 'smart_type':
      case 'browser_type': {
        const result = await bridgeServer.sendRequest('smart_type', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementInput(step, maxSteps, String(args.target || result?.target || 'input'), String(args.text || ''));
        return normalizeResult(result, `Typed ${args.text || ''}`, true);
      }
      case 'press_key': {
        const result = await bridgeServer.sendRequest('press_key', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.elementInput(step, maxSteps, String(args.ref || 'page'), String(args.key || 'key'));
        const key = String(args.key || '').toLowerCase();
        const changesState = key === 'enter' || key === 'return' || key === 'tab';
        return normalizeResult(result, `Pressed ${args.key || 'key'}`, changesState);
      }
      case 'scroll_down':
      case 'scroll_up': {
        const direction = actionName === 'scroll_up' ? 'up' : 'down';
        const result = await bridgeServer.sendRequest('scroll', { tabId: this.activeTabId, direction, ...args }, 10000);
        this.logger.scroll(step, maxSteps, direction);
        return normalizeResult(result, `Scrolled ${direction}`, false);
      }
      case 'wait':
      case 'wait_for_navigation':
      case 'wait_for_dom_change': {
        const timeoutMs = Number(args.ms || args.timeoutMs || 3000);
        const extensionRunPageTimeout = Math.max(8000, timeoutMs + 4000);
        const result = await bridgeServer.sendRequest('wait_for_dom_change', { tabId: this.activeTabId, timeoutMs, urlContains: args.urlContains, text: args.text, selector: args.selector }, extensionRunPageTimeout + 5000);
        this.logger.wait(step, maxSteps, `${timeoutMs}ms${args.text || args.selector ? ` for ${args.text || args.selector}` : ''}`);
        return normalizeResult(result, 'Waited for page change', Boolean(result?.stateChanged));
      }
      case 'extract':
      case 'extract_content': {
        const result = await bridgeServer.sendRequest('extract_content', { tabId: this.activeTabId, ...args }, 12000);
        this.logger.extract(step, maxSteps, String(args.goal || 'page content'));
        return normalizeResult(result, result?.content || result?.text || 'Extracted page content', false);
      }
      case 'open_tab': {
        const result = await bridgeServer.sendRequest('open_tab', { url: args.url, active: true }, 15000);
        this.activeTabId = Number(result?.tabId || result?.tab?.id || 0) || this.activeTabId;
        this.tabCacheExpiresAt = 0;
        this.logger.tabChange(step, maxSteps, `Opened ${args.url || 'tab'}`);
        return normalizeResult(result, `Opened ${args.url || 'tab'}`, true);
      }
      case 'switch_tab': {
        const numericTarget = typeof args.target === 'number' ? args.target : Number(args.target);
        const result = await bridgeServer.sendRequest('activate_tab', {
          tabId: Number.isFinite(numericTarget) ? numericTarget : undefined,
          target: args.target,
          index: args.index,
        }, 10000);
        this.activeTabId = Number(result?.tabId || result?.tab?.id || this.activeTabId || 0) || undefined;
        this.tabCacheExpiresAt = 0;
        this.logger.tabChange(step, maxSteps, `Activated tab ${args.index ?? args.target ?? ''}`);
        return normalizeResult(result, 'Activated tab', true);
      }
      case 'close_tab': {
        const result = await bridgeServer.sendRequest('close_tab', { tabId: this.activeTabId }, 10000);
        this.activeTabId = undefined;
        this.tabCacheExpiresAt = 0;
        this.logger.tabChange(step, maxSteps, 'Closed tab');
        return normalizeResult(result, 'Closed tab', true);
      }
      case 'done':
        return {
          success: args.success !== false,
          message: String(args.text || 'Done'),
          stateChanged: false,
          data: args,
        };
      default:
        return {
          success: false,
          message: `Extension-first Navis does not support action ${actionName}; falling back is required.`,
          stateChanged: false,
          data: { unsupportedAction: actionName },
        };
    }
  }
}

// ── Playwright Adapter ───────────────────────────────────────────────────────

export class PlaywrightBrowserAdapter implements BrowserControlAdapter {
  readonly mode = 'playwright' as const;

  constructor(
    private session: BrowserSession,
    private logger: NavisLogger,
    private aiClient: AIClient,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async launch(options: { startUrl?: string; headless?: boolean; selectedBrowserId?: string }): Promise<void> {
    await this.session.launch({
      headless: options.headless,
      startUrl: options.startUrl,
      logger: this.logger,
      selectedBrowserId: options.selectedBrowserId,
    });
  }

  async capture(): Promise<BrowserPageState> {
    const page = this.session.page;
    return {
      url: page.url(),
      title: await page.title().catch(() => 'Untitled'),
      refs: [],
      tabs: this.session.allPages.map((p, index) => ({ id: index, url: p.url(), title: '' })),
      mode: 'playwright',
    };
  }

  async screenshot(options?: { quality?: number }): Promise<string> {
    const buffer = await this.session.page.screenshot({ type: 'jpeg', quality: options?.quality || 75 });
    return buffer.toString('base64');
  }

  async executeAction(
    actionName: ActionName,
    actionArgs: Record<string, unknown>,
    step: number,
    maxSteps: number,
  ): Promise<BrowserActionResult> {
    return executeAction(actionName, actionArgs, this.session.page, this.session, this.logger, step, maxSteps, this.aiClient);
  }
}
