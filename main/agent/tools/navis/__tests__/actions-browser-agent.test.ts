import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { executeAction } from '../actions';

describe('Navis browser-agent actions', { timeout: 30000 }, () => {
  let browser: Browser;
  let page: Page;

  const session = {
    moveCursor: async () => {},
    highlightElement: async () => {},
    setOverlayStatus: async () => {},
    setActivePage: () => {},
  } as any;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  });

  afterEach(async () => {
    await page?.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('click_text clicks a visible control by human text', async () => {
    await page.setContent(`
      <button onclick="document.body.dataset.clicked='yes'">Open Menu</button>
    `);

    const result = await executeAction('click_text', { text: 'Open Menu' }, page, session);

    expect(result.success).toBe(true);
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe('yes');
  });

  it('click_text falls back to DOM events when pointer clicks do not reach the element', async () => {
    await page.setContent(`
      <button style="pointer-events:none" onclick="document.body.dataset.clicked='yes'">Hidden Pointer Button</button>
    `);

    const result = await executeAction('click_text', { text: 'Hidden Pointer Button' }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('dom-events');
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe('yes');
  });

  it('click_text prefers the exact interactive target over a broad matching container', async () => {
    await page.setContent(`
      <div role="button" onclick="document.body.dataset.clicked='parent'" style="padding:40px">
        <span>Book your flight with flexible fare details and seat information</span>
        <button onclick="event.stopPropagation(); document.body.dataset.clicked='child'">Book</button>
      </div>
    `);

    const result = await executeAction('click_text', { text: 'Book' }, page, session);

    expect(result.success).toBe(true);
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe('child');
  });

  it('click_text reports DOM-only state changes after a click', async () => {
    await page.setContent(`
      <button onclick="document.body.insertAdjacentHTML('beforeend', '<section id=&quot;panel&quot;>Panel opened</section>')">Open Panel</button>
    `);

    const result = await executeAction('click_text', { text: 'Open Panel' }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Page DOM changed');
    expect(await page.locator('#panel').textContent()).toBe('Panel opened');
  });

  it('smart_type fills an input by label and can submit with Enter', async () => {
    await page.setContent(`
      <form onsubmit="event.preventDefault(); document.body.dataset.submitted=document.querySelector('#q').value">
        <label for="q">Search</label>
        <input id="q" name="q" />
      </form>
    `);

    const result = await executeAction('smart_type', { target: 'Search', text: 'Boston listings', submit: true }, page, session);

    expect(result.success).toBe(true);
    expect(await page.locator('#q').inputValue()).toBe('Boston listings');
    expect(await page.evaluate(() => document.body.dataset.submitted)).toBe('Boston listings');
  });

  it('smart_type falls back to DOM value events when normal typing cannot edit the field', async () => {
    await page.setContent(`
      <label for="q">Locked Search</label>
      <input id="q" name="q" readonly oninput="document.body.dataset.input=this.value" onchange="document.body.dataset.changed=this.value" />
    `);

    const result = await executeAction('smart_type', { target: 'Locked Search', text: 'RTM to JFK' }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('dom-value');
    expect(await page.locator('#q').inputValue()).toBe('RTM to JFK');
    expect(await page.evaluate(() => document.body.dataset.input)).toBe('RTM to JFK');
    expect(await page.evaluate(() => document.body.dataset.changed)).toBe('RTM to JFK');
  });

  it('browser_type writes into the focused editable target instead of blindly typing globally', async () => {
    await page.setContent(`
      <input id="message" readonly oninput="document.body.dataset.input=this.value" />
    `);
    await page.locator('#message').focus();

    const result = await executeAction('browser_type', { text: 'hello from navis' }, page, session);

    expect(result.success).toBe(true);
    expect(result.message).toContain('focused input');
    expect(await page.locator('#message').inputValue()).toBe('hello from navis');
    expect(await page.evaluate(() => document.body.dataset.input)).toBe('hello from navis');
  });
});
