import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from 'playwright';
import type { AIClient } from '../../../lib/ai-client';
import { captureInteractiveElements } from './element-capture';

export interface NavisDomExtractionSnapshot {
  url: string;
  title: string;
  capturedAt: string;
  goal: string;
  metaDescription?: string;
  mainText: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  buttons: string[];
  formFields: Array<{ label: string; type: string; name: string; placeholder: string; value: string }>;
  tables: Array<{ caption?: string; headers: string[]; rows: string[][] }>;
}

export interface NavisExtractionReport {
  reportPath: string;
  markdown: string;
  summary: string;
  usedAI: boolean;
  sourceUrl: string;
  title: string;
}

function compactWhitespace(value: unknown, max = 500): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stripMarkdownFence(value: string): string {
  const text = value.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  return (fence ? fence[1] : text).trim();
}

function stripModelReasoning(value: string): string {
  let text = value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();

  if (/^<think>/i.test(text) || /^<thinking>/i.test(text)) {
    const reportStart = text.search(/\n\s{0,3}(#|\*\*|-\s|\d+\.\s)/);
    text = reportStart >= 0 ? text.slice(reportStart).trim() : '';
  }

  return text;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'navis-report';
}

function truncateForPrompt(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

export function getNavisReportDirectory(): string {
  return path.join(os.tmpdir(), 'everfern-navis-reports');
}

export async function captureDomForExtraction(page: Page, goal = ''): Promise<NavisDomExtractionSnapshot> {
  const captured = await page.evaluate((extractGoal) => {
    const clean = (value: unknown, max = 500) => {
      const text = String(value ?? '').replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const visible = (el: Element) => {
      const style = window.getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const labelFor = (el: Element) => {
      const id = (el as HTMLElement).id;
      const aria = el.getAttribute('aria-label');
      const labelledBy = el.getAttribute('aria-labelledby');
      const placeholder = el.getAttribute('placeholder');
      const name = el.getAttribute('name');
      const directLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map(part => document.getElementById(part)?.textContent || '').join(' ')
        : '';
      return clean(directLabel || labelledText || aria || placeholder || name || el.textContent || '', 180);
    };

    const root = document.querySelector('main, [role="main"], article, #content, .content, .main') || document.body;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, iframe, svg, canvas, nav, footer, header').forEach(node => node.remove());

    let mainText = clean(clone.innerText || clone.textContent || '', 45000);
    mainText = mainText.replace(/\n\s*\n\s*\n/g, '\n\n');

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
      .filter(visible)
      .map(el => clean(el.textContent, 220))
      .filter(Boolean)
      .slice(0, 80);

    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible)
      .map(el => ({
        text: clean(el.textContent || el.getAttribute('aria-label') || '', 180),
        href: clean((el as HTMLAnchorElement).href || el.getAttribute('href') || '', 500),
      }))
      .filter(link => link.text || link.href)
      .slice(0, 120);

    const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]'))
      .filter(visible)
      .map(el => clean((el as HTMLInputElement).value || el.getAttribute('aria-label') || el.textContent || '', 180))
      .filter(Boolean)
      .slice(0, 80);

    const formFields = Array.from(document.querySelectorAll('input,textarea,select'))
      .filter(visible)
      .map(el => ({
        label: labelFor(el),
        type: clean((el as HTMLInputElement).type || el.tagName.toLowerCase(), 80),
        name: clean(el.getAttribute('name') || '', 120),
        placeholder: clean(el.getAttribute('placeholder') || '', 160),
        value: clean((el as HTMLInputElement).value || '', 180),
      }))
      .slice(0, 100);

    const tables = Array.from(document.querySelectorAll('table'))
      .filter(visible)
      .slice(0, 12)
      .map(table => {
        const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th, tr:first-child td'))
          .map(cell => clean(cell.textContent, 140))
          .filter(Boolean)
          .slice(0, 12);
        const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
          .slice(0, 50)
          .map(row => Array.from(row.querySelectorAll('th,td'))
            .map(cell => clean(cell.textContent, 180))
            .filter(Boolean)
            .slice(0, 12))
          .filter(row => row.length > 0);
        const caption = clean(table.querySelector('caption')?.textContent || '', 180);
        return { caption, headers, rows };
      });

    return {
      url: location.href,
      title: document.title || '',
      capturedAt: new Date().toISOString(),
      goal: String(extractGoal || ''),
      metaDescription: clean(document.querySelector('meta[name="description"]')?.getAttribute('content') || '', 500),
      mainText,
      headings,
      links,
      buttons,
      formFields,
      tables,
    };
  }, goal).catch(async () => ({
    url: page.url(),
    title: await page.title().catch(() => ''),
    capturedAt: new Date().toISOString(),
    goal,
    mainText: '',
    headings: [],
    links: [],
    buttons: [],
    formFields: [],
    tables: [],
  }));

  return captured as NavisDomExtractionSnapshot;
}

export function buildDomParserPrompt(snapshot: NavisDomExtractionSnapshot, taskGoal: string): string {
  const payload = {
    page: {
      title: snapshot.title,
      url: snapshot.url,
      capturedAt: snapshot.capturedAt,
      metaDescription: snapshot.metaDescription,
    },
    extractionGoal: taskGoal || snapshot.goal || 'Extract the important page content for the user.',
    headings: snapshot.headings,
    buttons: snapshot.buttons,
    formFields: snapshot.formFields,
    tables: snapshot.tables,
    links: snapshot.links,
    mainText: truncateForPrompt(snapshot.mainText, 36000),
  };

  return [
    'You are Navis Content Parser, a separate extraction agent.',
    'Your job is to parse this DOM/text snapshot into a useful Markdown report so the browser navigation agent does not have to spend extra turns analyzing the page.',
    '',
    'Rules:',
    '- Return Markdown only. No JSON. No code fences. No <think> blocks or hidden reasoning.',
    '- Focus tightly on the extraction goal.',
    '- Preserve exact prices, dates, names, times, addresses, links, labels, and availability when present.',
    '- If requested information is missing, include a "Not Found" section with what was missing.',
    '- Keep the report skimmable: key findings first, then evidence/details.',
    '- Do not invent facts that are not in the DOM snapshot.',
    '',
    `DOM SNAPSHOT:\n${JSON.stringify(payload, null, 2)}`,
  ].join('\n');
}

export function createFallbackMarkdown(snapshot: NavisDomExtractionSnapshot, goal: string): string {
  const links = snapshot.links.slice(0, 20).map(link => `- [${link.text || link.href}](${link.href})`).join('\n');
  const headings = snapshot.headings.slice(0, 30).map(item => `- ${item}`).join('\n');
  const tables = snapshot.tables.slice(0, 4).map((table, index) => {
    const rows = table.rows.slice(0, 12).map(row => `- ${row.join(' | ')}`).join('\n');
    return `### Table ${index + 1}${table.caption ? `: ${table.caption}` : ''}\n${rows}`;
  }).join('\n\n');

  return [
    `# Navis Extraction Report`,
    '',
    `Source: [${snapshot.title || snapshot.url}](${snapshot.url})`,
    `Goal: ${goal || snapshot.goal || 'Extract page content'}`,
    `Captured: ${snapshot.capturedAt}`,
    '',
    '## Key Page Text',
    snapshot.mainText ? truncateForPrompt(snapshot.mainText, 12000) : 'No readable main text was captured.',
    '',
    headings ? `## Headings\n${headings}` : '',
    tables ? `## Tables\n${tables}` : '',
    links ? `## Links\n${links}` : '',
  ].filter(Boolean).join('\n');
}

export async function parseDomSnapshotToMarkdown(
  snapshot: NavisDomExtractionSnapshot,
  goal: string,
  aiClient?: AIClient,
): Promise<{ markdown: string; usedAI: boolean }> {
  if (!aiClient) {
    return { markdown: createFallbackMarkdown(snapshot, goal), usedAI: false };
  }

  try {
    const response = await aiClient.chat({
      messages: [
        { role: 'system', content: 'You parse browser DOM snapshots into concise, accurate Markdown reports.' },
        { role: 'user', content: buildDomParserPrompt(snapshot, goal) },
      ],
      temperature: 0.1,
      maxTokens: 3500,
    });

    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '');
    const markdown = stripModelReasoning(stripMarkdownFence(raw));
    if (markdown.length > 12) {
      return { markdown, usedAI: true };
    }
  } catch (err) {
    console.warn('[Navis Extract] DOM parser AI failed, using fallback markdown:', err);
  }

  return { markdown: createFallbackMarkdown(snapshot, goal), usedAI: false };
}

export async function writeNavisExtractionReport(
  markdown: string,
  snapshot: NavisDomExtractionSnapshot,
): Promise<string> {
  const dir = getNavisReportDirectory();
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}-${slugify(snapshot.title || snapshot.url)}.md`;
  const reportPath = path.join(dir, fileName);
  await fs.promises.writeFile(reportPath, markdown, 'utf8');
  return reportPath;
}

export function summarizeMarkdown(markdown: string, max = 900): string {
  const clean = stripModelReasoning(markdown)
    .replace(/^# .+$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return compactWhitespace(clean, max);
}

async function identifyClickElements(
  page: Page,
  goal: string,
  aiClient: AIClient,
  clickTarget?: string,
): Promise<{ shouldClick: boolean; refs: string[]; collapseAfterClick: boolean; waitMsAfterClick: number }> {
  try {
    const interactiveSnapshot = await captureInteractiveElements(page);
    if (!interactiveSnapshot || !interactiveSnapshot.raw) {
      return { shouldClick: false, refs: [], collapseAfterClick: false, waitMsAfterClick: 500 };
    }

    const items = JSON.parse(interactiveSnapshot.raw);
    const visibleInteractive = items
      .filter((item: any) => item.ref && item.visible !== false && item.inViewport !== false)
      .slice(0, 100)
      .map((item: any) => ({
        ref: item.ref,
        role: item.role,
        name: item.name,
        label: item.label,
        type: item.type,
      }));

    if (visibleInteractive.length === 0) {
      return { shouldClick: false, refs: [], collapseAfterClick: false, waitMsAfterClick: 500 };
    }

    const prompt = `You are Navis Element Identifier. 
We need to extract details from the current page to satisfy this goal: "${goal}".
${clickTarget ? `The user specified these targets to click/expand: "${clickTarget}".` : 'Some pages (e.g. flight lists, accordions, search results) hide complete details until you click/expand each item.'}
Your job is to look at the list of visible interactive elements and determine if we need to systematically click/expand multiple items to reveal the necessary information.

Here is the list of interactive elements:
${JSON.stringify(visibleInteractive, null, 2)}

If we need to click multiple items (e.g. each flight row, accordion header, detail link) to get the required information, return a JSON object containing:
- "shouldClick": true
- "refs": an array of the element refs to click in order (e.g. ["e1", "e2", "e3"])
- "collapseAfterClick": true/false (usually false for flight details/accordions)
- "waitMsAfterClick": number (time to wait in ms after each click, e.g. 500)

If no clicking is needed (the information is already visible or this is not a list that needs expanding), return:
- "shouldClick": false
- "refs": []

Return ONLY valid JSON. No markdown fences. No extra text.`;

    const response = await aiClient.chat({
      messages: [
        { role: 'system', content: 'You are a precise JSON assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      responseFormat: 'json',
    });

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '');
    const cleanJson = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(cleanJson);
    return {
      shouldClick: Boolean(result.shouldClick),
      refs: Array.isArray(result.refs) ? result.refs.map(String) : [],
      collapseAfterClick: Boolean(result.collapseAfterClick),
      waitMsAfterClick: typeof result.waitMsAfterClick === 'number' ? result.waitMsAfterClick : 500,
    };
  } catch (err) {
    console.warn('[Navis Extract] Element identification failed:', err);
    return { shouldClick: false, refs: [], collapseAfterClick: false, waitMsAfterClick: 500 };
  }
}

export async function createNavisExtractionReport(
  page: Page,
  goal: string,
  aiClient?: AIClient,
  clickTarget?: string,
): Promise<NavisExtractionReport> {
  const snapshot = await captureDomForExtraction(page, goal);
  
  let combinedText = snapshot.mainText;

  if (aiClient) {
    console.log('[Navis Extract] Running click-and-extract detection...');
    const clickInfo = await identifyClickElements(page, goal, aiClient, clickTarget);
    if (clickInfo.shouldClick && clickInfo.refs.length > 0) {
      console.log(`[Navis Extract] Subagent identified ${clickInfo.refs.length} elements to click systematically:`, clickInfo.refs);
      const clickedContents: string[] = [];
      clickedContents.push(`### Initial Page Content\n${snapshot.mainText}`);

      const maxClicks = Math.min(clickInfo.refs.length, 15);
      for (let i = 0; i < maxClicks; i++) {
        const ref = clickInfo.refs[i];
        const selector = `[data-ref="${ref}"]`;
        const locator = page.locator(selector);
        
        const isVisible = await locator.isVisible({ timeout: 500 }).catch(() => false);
        if (!isVisible) continue;

        try {
          console.log(`[Navis Extract] Subagent clicking element ${ref} (${i + 1}/${maxClicks})...`);
          await locator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await locator.click({ timeout: 1500 });
          
          await page.waitForTimeout(clickInfo.waitMsAfterClick);

          const pageText = await page.evaluate(() => {
            const clone = document.body.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('script, style, noscript, iframe, svg, canvas, nav, footer, header').forEach(node => node.remove());
            return clone.innerText || clone.textContent || '';
          }).catch(() => '');

          clickedContents.push(`### Content after clicking element ${ref}\n${pageText}`);

          if (clickInfo.collapseAfterClick) {
            await locator.click({ timeout: 1000 }).catch(() => {});
            await page.waitForTimeout(200);
          }
        } catch (clickErr) {
          console.warn(`[Navis Extract] Failed to click ref ${ref}:`, clickErr);
        }
      }

      combinedText = clickedContents.join('\n\n---\n\n');
      if (combinedText.length > 120000) {
        combinedText = combinedText.slice(0, 120000) + '\n...[truncated due to excessive length]';
      }
    }
  }

  const enrichedSnapshot = {
    ...snapshot,
    mainText: combinedText
  };

  const parsed = await parseDomSnapshotToMarkdown(enrichedSnapshot, goal, aiClient);
  const reportPath = await writeNavisExtractionReport(parsed.markdown, enrichedSnapshot);

  return {
    reportPath,
    markdown: parsed.markdown,
    summary: summarizeMarkdown(parsed.markdown),
    usedAI: parsed.usedAI,
    sourceUrl: snapshot.url,
    title: snapshot.title,
  };
}
