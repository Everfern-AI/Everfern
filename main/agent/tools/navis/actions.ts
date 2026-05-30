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
import { captureForVision } from './element-capture';
import { loadConfig } from './config';
import { AIClient } from '../../../lib/ai-client';

export type ActionName =
  | 'go_to_url'
  | 'go_back'
  | 'click_element'
  | 'input_text'
  | 'hold_element'
  | 'drag_element'
  | 'press_key'
  | 'scroll_down'
  | 'scroll_up'
  | 'wait'
  | 'extract_content'
  | 'open_tab'
  | 'switch_tab'
  | 'close_tab'
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

// ── Multi-Strategy Element Finder ───────────────────────────────
async function findElement(page: Page, ref: string, logger?: NavisLogger): Promise<{ locator: any; name: string }> {
  const strategies: Array<() => Promise<{ locator: any; method: string } | null>> = [
    // Strategy 1: data-ref (set by our capture script)
    async () => {
      const loc = page.locator(`[data-ref="${ref}"], [data-scroll-ref="${ref}"]`);
      if (await loc.count() > 0) return { locator: loc, method: 'data-ref' };
      return null;
    },
    // Strategy 2: aria-ref
    async () => {
      const loc = page.locator(`[aria-ref="${ref}"], aria-ref=${ref}`);
      if (await loc.count() > 0) return { locator: loc, method: 'aria-ref' };
      return null;
    },
    // Strategy 3: Parse ref number, try nth-of-type (fallback for complex SPAs)
    async () => {
      const match = ref.match(/e(\d+)/);
      if (match) {
        const index = parseInt(match[1]) - 1;
        // Search in all interactive types
        const loc = page.locator('button, a, input, select, textarea, [role="button"], [role="link"], [data-scroll-ref]').nth(index);
        if (await loc.count() > 0 && await loc.isVisible()) return { locator: loc, method: 'nth-index' };
      }
      return null;
    },
    // Strategy 4: Try text content matching
    async () => {
      try {
        const text = await page.getAttribute(`[data-ref="${ref}"]`, 'aria-label').catch(() => '') ||
                       await page.textContent(`[data-ref="${ref}"]`).catch(() => '');
        if (text && text.trim().length > 2) {
          const loc = page.getByText(text.trim().slice(0, 50), { exact: false }).first();
          if (await loc.count() > 0) return { locator: loc, method: 'text-match' };
        }
      } catch {}
      return null;
    },
  ];

  for (const strategy of strategies) {
    const result = await strategy();
    if (result) {
      const name = await result.locator.getAttribute('aria-label').catch(() => '') ||
                     await result.locator.textContent().catch(() => '') ||
                     ref;
      console.log(`[Navis] Element found using ${result.method}: ${name.slice(0, 30)}`);
      return { locator: result.locator, name: name || ref };
    }
  }

  throw new Error(`Element with ref=${ref} not found after trying ${strategies.length} strategies`);
}

// ── Element Validation ─────────────────────────────────────────
// Returns null if element is valid (visible + enabled), or a string explaining why it's not.
async function validateElement(locator: any, action: string, logger?: NavisLogger): Promise<string | null> {
  try {
    const isVisible = await locator.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isVisible) {
      console.warn(`[Navis] Element not visible for ${action}`);
      return 'not visible (hidden, offscreen, or covered by another element)';
    }

    const isEnabled = await locator.isEnabled({ timeout: 1000 }).catch(() => true);
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
): Promise<ActionResult> {
  try {
    switch (actionName) {
      case 'go_to_url':
        return await executeGoToUrl(args as { url: string }, page, logger, step, maxSteps);

      case 'go_back':
        return await executeGoBack(page, logger, step, maxSteps);

      case 'click_element':
        return await executeClickElement(args as { ref: string }, page, session, logger, step, maxSteps);

      case 'input_text':
        return await executeInputText(args as { ref: string; text: string }, page, session, logger, step, maxSteps);

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

      case 'extract_content':
        return await executeExtractContent(args as { goal?: string }, page, logger, step, maxSteps);

      case 'open_tab':
        return await executeOpenTab(args as { url?: string }, session, logger, step, maxSteps);

      case 'switch_tab':
        return await executeSwitchTab(args as { index?: number; target?: string }, session, logger, step, maxSteps);

      case 'close_tab':
        return await executeCloseTab(page, session, logger, step, maxSteps);

      case 'solve_captcha':
        return await executeSolveCaptcha(page, session, logger, step, maxSteps);

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

  logger?.pageNavigate(step, maxSteps, args.url);

  // Use a more robust goto that doesn't hang on domcontentloaded
  try {
    await page.goto(args.url, { waitUntil: 'load', timeout: 20000 });
  } catch (err: any) {
    console.warn(`[Navis] goto(load) failed, retrying with commit: ${err.message}`);
    await page.goto(args.url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
  }

  await page.bringToFront();
  return { success: true, message: `Navigated to ${args.url}`, stateChanged: true };
}

async function executeGoBack(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  try {
    logger?.pageNavigate(step, maxSteps, 'go_back');
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
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
    const { locator, name } = await findElement(page, args.ref, logger);

    const validation = await validateElement(locator, 'click', logger);
    if (validation !== null) {
      return {
        success: false,
        message: `Element ${args.ref} ("${truncate(String(name), 40)}") ${validation}. Try scrolling to it, waiting for the page to load, or choosing a different element.`,
        stateChanged: false,
      };
    }

    const box = await locator.boundingBox().catch(() => null);
    let position: { x: number; y: number } | undefined = undefined;
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      position = { x: centerX, y: centerY };

      // Move magical cursor first
      await session.moveCursor(centerX, centerY);
      await new Promise(r => setTimeout(r, 600)); // Wait for transition

      await session.highlightElement(box);

      // Listen for new pages (popups) being opened by this click
      const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);

      const clicked = await locator.click({
        timeout: 3000,
        force: false,
      }).then(() => true).catch(() => false);

      // Fallback: use mouse.click
      if (!clicked && box) {
        await page.mouse.click(centerX, centerY);
      }

      // Check if a new tab was opened
      const newPage = await popupPromise;
      if (newPage) {
        await newPage.bringToFront();
        session.setActivePage(newPage);
        logger?.tabChange(step, maxSteps, `switched to new tab: ${newPage.url()}`);
        return { success: true, message: `Clicked and switched to new tab: ${newPage.url()}`, stateChanged: true };
      }
    } else {
      await locator.click({ timeout: 2000 });
    }

    logger?.elementClick(step, maxSteps, truncate(String(name), 40), `aria-ref=${args.ref}`, position);
    await session.setOverlayStatus(`Clicked "${truncate(String(name), 20)}"`);
    return { success: true, message: `Clicked: ${name}`, stateChanged: true };
  } catch (err: any) {
    return { success: false, message: `Click failed: ${err.message}`, stateChanged: false };
  }
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

    const validation = await validateElement(locator, 'input', logger);
    if (validation !== null) {
      return {
        success: false,
        message: `Element ${args.ref} ("${truncate(String(name), 40)}") ${validation}. Try scrolling to it, waiting for the page to load, or choosing a different input.`,
        stateChanged: false,
      };
    }

    const box = await locator.boundingBox().catch(() => null);
    let position: { x: number; y: number } | undefined = undefined;
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      position = { x: centerX, y: centerY };
      await session.moveCursor(centerX, centerY);
      await new Promise(r => setTimeout(r, 600));
      await session.highlightElement(box);
    }

    // Use fill() for speed (instant vs 2ms/char with pressSequentially)
    await locator.fill('');  // Clear first
    await locator.fill(args.text, { timeout: 3000 });

    logger?.elementInput(step, maxSteps, truncate(String(name), 30), args.text, position);
    await session.setOverlayStatus(`Typed "${truncate(args.text, 20)}"`);
    return { success: true, message: `Entered text: ${name}`, stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Input failed: ${err.message}`, stateChanged: false };
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

      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        await session.moveCursor(centerX, centerY);
        await new Promise(r => setTimeout(r, 600));
        await session.highlightElement(box);
      }

      await locator.press(args.key, { timeout: 3000 });
      logger?.elementInput(step, maxSteps, `key:${args.key}`, args.ref);
    } else {
      await page.keyboard.press(args.key);
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
      await locator.evaluate((el: HTMLElement) => el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' }));
      logger?.scroll(step, maxSteps, `down on ${name}`);
      return { success: true, message: `Scrolled down on ${name}`, stateChanged: false };
    } catch (err: any) {
      return { success: false, message: `Scroll failed: ${err.message}`, stateChanged: false };
    }
  }
  await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' }));
  logger?.scroll(step, maxSteps, 'down');
  return { success: true, message: 'Scrolled down one page', stateChanged: false };
}

async function executeScrollUp(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number, args?: { ref?: string }): Promise<ActionResult> {
  if (args?.ref) {
    try {
      const { locator, name } = await findElement(page, args.ref, logger);
      await locator.evaluate((el: HTMLElement) => el.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'smooth' }));
      logger?.scroll(step, maxSteps, `up on ${name}`);
      return { success: true, message: `Scrolled up on ${name}`, stateChanged: false };
    } catch (err: any) {
      return { success: false, message: `Scroll failed: ${err.message}`, stateChanged: false };
    }
  }
  await page.evaluate(() => window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' }));
  logger?.scroll(step, maxSteps, 'up');
  return { success: true, message: 'Scrolled up one page', stateChanged: false };
}

async function executeWait(args: { ms?: number }, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  const ms = Math.min(args.ms ?? 500, 10000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  logger?.wait(step, maxSteps, `${ms}ms`);
  return { success: true, message: `Waited ${ms}ms`, stateChanged: false };
}

async function executeExtractContent(args: { goal?: string }, page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
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
  const newPage = await session.openTab(args.url);
  await newPage.bringToFront();
  logger?.tabChange(step, maxSteps, args.url ? `opened: ${args.url}` : 'new tab');
  return { success: true, message: `Opened new tab${args.url ? ': ' + args.url : ''}`, stateChanged: true };
}

async function executeSwitchTab(args: { index?: number; target?: string }, session: BrowserSession, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  if (args.target) {
    await session.switchToTab(args.target);
    logger?.tabChange(step, maxSteps, `switched to tab matching "${args.target}"`);
    return { success: true, message: `Switched to tab matching "${args.target}"`, stateChanged: true };
  }
  if (args.index !== undefined) {
    await session.switchToTab(args.index);
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
  logger?.tabChange(step, maxSteps, 'tab closed');
  return { success: true, message: 'Tab closed', stateChanged: true };
}

async function executeSolveCaptcha(page: Page, session: BrowserSession, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  logger?.tabChange(step, maxSteps, 'solving captcha...');
  await session.setOverlayStatus('Solving captcha...');

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

    // Apply tars-test.py scaling logic for browser coordinates
    const viewport = page.viewportSize();
    if (viewport) {
      const SCREEN_WIDTH = viewport.width;
      const SCREEN_HEIGHT = viewport.height;

      // Scale coordinates if they're > viewport dimensions (normalized 0-1000)
      const rx = Math.abs(x) > SCREEN_WIDTH ? Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH) : x;
      const ry = Math.abs(y) > SCREEN_HEIGHT ? Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT) : y;

      console.log(`[Navis] Browser Click: input=(${x},${y}) viewport=(${SCREEN_WIDTH}x${SCREEN_HEIGHT}) final=(${rx},${ry})`);

      x = rx;
      y = ry;
    }

    // Move cursor and highlight the click area
    await session.moveCursor(x, y);
    await new Promise(r => setTimeout(r, 600)); // Wait for transition

    // Highlight the click area
    await session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 });

    // Perform the click using Playwright's mouse
    await page.mouse.click(x, y);

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_click', { x, y });
    await session.setOverlayStatus(`Clicked at (${x}, ${y})`);

    return {
      success: true,
      message: `Clicked at coordinates (${x}, ${y})`,
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
    // Type the text using Playwright's keyboard
    await page.keyboard.type(args.text);

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
      x = Math.abs(x) > SCREEN_WIDTH ? Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH) : x;
      y = Math.abs(y) > SCREEN_HEIGHT ? Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT) : y;
    }

    await session.moveCursor(x, y);
    await new Promise(r => setTimeout(r, 600));
    await session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 });

    await page.mouse.click(x, y, { clickCount: 2 });

    logger?.elementClick(step, maxSteps, `(${x},${y})`, 'browser_double_click', { x, y });
    await session.setOverlayStatus(`Double-clicked at (${x}, ${y})`);

    return { success: true, message: `Double-clicked at (${x}, ${y})`, stateChanged: true };
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
      x = Math.abs(x) > SCREEN_WIDTH ? Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH) : x;
      y = Math.abs(y) > SCREEN_HEIGHT ? Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT) : y;
    }

    await session.moveCursor(x, y);
    await new Promise(r => setTimeout(r, 600));
    await session.highlightElement({ x: x - 10, y: y - 10, width: 20, height: 20 });

    await page.mouse.click(x, y, { button: 'right' });

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
      x = Math.abs(x) > SCREEN_WIDTH ? Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH) : x;
      y = Math.abs(y) > SCREEN_HEIGHT ? Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT) : y;
    }

    await session.moveCursor(x, y);
    await new Promise(r => setTimeout(r, 600));

    await page.mouse.move(x, y);

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
      const { locator, name: foundName } = await findElement(page, args.ref, logger);
      name = foundName;
      const box = await locator.boundingBox();
      if (box) {
        targetX = box.x + box.width / 2;
        targetY = box.y + box.height / 2;
      }
    }

    if (targetX !== undefined && targetY !== undefined) {
      await session.moveCursor(targetX, targetY);
      await new Promise(r => setTimeout(r, 600));
      await page.mouse.move(targetX, targetY);
      await page.mouse.down();
      
      const holdTime = args.holdTimeMs || 0;
      if (holdTime > 0) {
        await new Promise(r => setTimeout(r, holdTime));
        await page.mouse.up();
        logger?.elementClick(step, maxSteps, name, `hold_element (${holdTime}ms)`, { x: targetX, y: targetY });
        return { success: true, message: `Held ${name} for ${holdTime}ms`, stateChanged: true };
      }
      
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
    const { locator: sourceLocator, name: sourceName } = await findElement(page, args.sourceRef, logger);
    const sourceBox = await sourceLocator.boundingBox();
    if (!sourceBox) throw new Error('Could not find source element bounding box');

    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;

    let tx: number | undefined = args.targetX;
    let ty: number | undefined = args.targetY;
    let targetName = `(${args.targetX}, ${args.targetY})`;

    if (args.targetRef) {
      const { locator: targetLocator, name: foundTargetName } = await findElement(page, args.targetRef, logger);
      targetName = foundTargetName;
      const targetBox = await targetLocator.boundingBox();
      if (targetBox) {
        tx = targetBox.x + targetBox.width / 2;
        ty = targetBox.y + targetBox.height / 2;
      }
    }

    if (tx !== undefined && ty !== undefined) {
      await session.moveCursor(sx, sy);
      await new Promise(r => setTimeout(r, 600));
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 200));
      
      await session.moveCursor(tx, ty);
      await page.mouse.move(tx, ty, { steps: 10 });
      await page.mouse.up();

      logger?.elementClick(step, maxSteps, sourceName, `drag to ${targetName}`, { x: tx, y: ty });
      return { success: true, message: `Dragged ${sourceName} to ${targetName}`, stateChanged: true };
    }

    return { success: false, message: 'Could not determine drag target', stateChanged: false };
  } catch (err: any) {
    return { success: false, message: `Drag failed: ${err.message}`, stateChanged: false };
  }
}
