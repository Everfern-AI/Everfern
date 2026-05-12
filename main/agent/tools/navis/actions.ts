/**
 * Navis - Action Executor
 * 
 * Executes browser actions from AI decisions.
 * Implements all actions defined in NAVIS.md.
 */

import { Page } from 'playwright';
import { BrowserSession } from './session';
import { NavisLogger } from './logger';

export type ActionName =
  | 'go_to_url'
  | 'go_back'
  | 'click_element'
  | 'input_text'
  | 'press_key'
  | 'scroll_down'
  | 'scroll_up'
  | 'wait'
  | 'extract_content'
  | 'open_tab'
  | 'switch_tab'
  | 'close_tab'
  | 'solve_captcha'
  | 'done';

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
      const loc = page.locator(`[data-ref="${ref}"]`);
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
        const loc = page.locator('button, a, input, select, textarea, [role="button"], [role="link"]').nth(index);
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

      case 'press_key':
        return await executePressKey(args as { ref?: string; key: string }, page, session, logger, step, maxSteps);

      case 'scroll_down':
        return await executeScrollDown(page, logger, step, maxSteps);

      case 'scroll_up':
        return await executeScrollUp(page, logger, step, maxSteps);

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
    if (box) {
      await session.highlightElement(box);
      
      // Listen for new pages (popups) being opened by this click
      const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
      
      const clicked = await locator.click({ 
        timeout: 3000,
        force: false,
      }).then(() => true).catch(() => false);

      // Fallback: use mouse.click
      if (!clicked && box) {
        await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
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
    
    logger?.elementClick(step, maxSteps, truncate(String(name), 40), `aria-ref=${args.ref}`);
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
    if (box) await session.highlightElement(box);
    
    // Use fill() for speed (instant vs 2ms/char with pressSequentially)
    await locator.fill('');  // Clear first
    await locator.fill(args.text, { timeout: 3000 });
    
    logger?.elementInput(step, maxSteps, truncate(String(name), 30), args.text);
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

async function executeScrollDown(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  logger?.scroll(step, maxSteps, 'down');
  return { success: true, message: 'Scrolled down one page', stateChanged: false };
}

async function executeScrollUp(page: Page, logger?: NavisLogger, step?: number, maxSteps?: number): Promise<ActionResult> {
  await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
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
    // Remove noise
    const scripts = document.querySelectorAll('script, style, noscript, iframe, svg, nav, footer');
    scripts.forEach(s => s.remove());

    // Try to find main content
    const main = document.querySelector('main, [role="main"], article, #content, .content, .main');
    const root = main || document.body;

    // Get text and clean it
    let text = (root as HTMLElement).innerText || '';
    text = text.replace(/\n\s*\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    
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
