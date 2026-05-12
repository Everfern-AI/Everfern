/**
 * Navis — Orchestrator
 * 
 * Main AI-driven loop: capture state → call LLM → parse decision → execute actions → repeat.
 * Handles JSON schema enforcement, retry logic, and graceful failure.
 */

import type { AIClient } from '../../../lib/ai-client';
import { BrowserSession } from './session';
import { captureInteractiveElements, formatElementsForPrompt, AriaSnapshotResult } from './element-capture';
import { executeAction, ActionName } from './actions';
import { loadPrompt } from '../../../lib/prompt-sync';
import { NavisLogger } from './logger';

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema for Navis decision output (strict validation)
// ─────────────────────────────────────────────────────────────────────────────

export const NAVIS_DECISION_SCHEMA = {
  $name: 'navis_decision',
  type: 'object',
  properties: {
    current_state: {
      type: 'object',
      properties: {
        evaluation_previous_goal: { type: 'string', enum: ['Success', 'Failed', 'Unknown'] },
        memory: { type: 'string' },
        next_goal: { type: 'string' },
      },
      required: ['evaluation_previous_goal', 'memory', 'next_goal'],
      additionalProperties: false,
    },
    action: {
      type: 'array',
      items: {
        type: 'object',
        oneOf: [
          { properties: { go_to_url: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } }, required: ['go_to_url'], additionalProperties: false },
          { properties: { go_back: { type: 'object', additionalProperties: false } }, required: ['go_back'], additionalProperties: false },
          { properties: { click_element: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false } }, required: ['click_element'], additionalProperties: false },
          { properties: { input_text: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'], additionalProperties: false } }, required: ['input_text'], additionalProperties: false },
          { properties: { press_key: { type: 'object', properties: { ref: { type: 'string' }, key: { type: 'string' } }, required: ['key'], additionalProperties: false } }, required: ['press_key'], additionalProperties: false },
          { properties: { scroll_down: { type: 'object', additionalProperties: false } }, required: ['scroll_down'], additionalProperties: false },
          { properties: { scroll_up: { type: 'object', additionalProperties: false } }, required: ['scroll_up'], additionalProperties: false },
          { properties: { wait: { type: 'object', properties: { ms: { type: 'number' } }, additionalProperties: false } }, required: ['wait'], additionalProperties: false },
          { properties: { extract_content: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false } }, required: ['extract_content'], additionalProperties: false },
          { properties: { open_tab: { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false } }, required: ['open_tab'], additionalProperties: false },
          { properties: { switch_tab: { type: 'object', properties: { index: { type: 'number' }, target: { type: 'string' } }, additionalProperties: false } }, required: ['switch_tab'], additionalProperties: false },
          { properties: { close_tab: { type: 'object', additionalProperties: false } }, required: ['close_tab'], additionalProperties: false },
          { properties: { done: { type: 'object', properties: { success: { type: 'boolean' }, text: { type: 'string' } }, required: ['success', 'text'], additionalProperties: false } }, required: ['done'], additionalProperties: false },
          { properties: { solve_captcha: { type: 'object', additionalProperties: false } }, required: ['solve_captcha'], additionalProperties: false },
        ],
      },
      minItems: 1,
      maxItems: 8,
    },
  },
  required: ['current_state', 'action'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Loading
// ─────────────────────────────────────────────────────────────────────────────

function loadNavisPrompts(): { systemPrompt: string; nextStepPrompt: string } {
  const rawPrompt = loadPrompt('NAVIS.md');

  if (!rawPrompt) {
    return {
      systemPrompt: FALLBACK_SYSTEM_PROMPT,
      nextStepPrompt: FALLBACK_NEXT_STEP_PROMPT,
    };
  }

  const systemMatch = rawPrompt.match(/SYSTEM_PROMPT = """\\?\s*([\s\S]*?)"""/);
  const nextMatch = rawPrompt.match(/NEXT_STEP_PROMPT = """\s*([\s\S]*?)"""/);

  let systemPrompt = systemMatch ? systemMatch[1].trim() : FALLBACK_SYSTEM_PROMPT;
  let nextStepPrompt = nextMatch ? nextMatch[1].trim() : FALLBACK_NEXT_STEP_PROMPT;

  nextStepPrompt = nextStepPrompt.replace(/browser_use/g, 'navis');

  return { systemPrompt, nextStepPrompt };
}

const { systemPrompt: NAVIS_SYSTEM_PROMPT, nextStepPrompt: NEXT_STEP_PROMPT } = loadNavisPrompts();

const FALLBACK_SYSTEM_PROMPT = `You are Navis, an AI agent designed to automate browser tasks.
Respond with valid JSON: {"current_state":{"evaluation_previous_goal":"Success|Failed|Unknown","memory":"track progress","next_goal":"immediate action"},"action":[{"action_name":{params}}]}
Actions: go_to_url, go_back, click_element, input_text, scroll_down, scroll_up, wait, extract_content, open_tab, switch_tab, close_tab, done.`;

const FALLBACK_NEXT_STEP_PROMPT = `What should I do next?
Current URL: {url_placeholder}
Tabs: {tabs_placeholder}
Interactive elements with [index].
Results: {results_placeholder}`;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NavisOptions {
  task: string;
  maxSteps?: number;
  maxActionsPerStep?: number;
  headless?: boolean;
  startUrl?: string;
  onProgress?: (msg: string) => void;
  useVision?: boolean;
  autoLaunchChrome?: boolean;
}

export interface NavisResult {
  success: boolean;
  output: string;
  steps: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export class NavisOrchestrator {
  private aiClient: AIClient;
  private visionClient: AIClient | null;
  private model: string;
  private session: BrowserSession;
  private logger: NavisLogger;

  constructor(aiClient: AIClient, logger?: NavisLogger, visionClient?: AIClient) {
    this.aiClient = aiClient;
    this.visionClient = visionClient || null;
    this.model = aiClient.model;
    this.logger = logger || new NavisLogger();
    this.session = new BrowserSession();
  }

  getEventLogger(): NavisLogger { return this.logger; }

  async run(options: NavisOptions): Promise<NavisResult> {
    const { task, maxSteps = 25, maxActionsPerStep = 8, headless = false, startUrl, useVision = false, autoLaunchChrome = true } = options;
    
    const runStart = Date.now();
    await this.session.launch({ headless, startUrl, logger: this.logger, autoLaunchChrome });
    console.log(`[Navis] ⏱ launch: ${Date.now() - runStart}ms`);
    console.log(`[Navis] Vision mode: ${useVision ? 'ENABLED' : 'disabled'}`);

    await this.session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    console.log(`[Navis] ⏱ initial page load: ${Date.now() - runStart}ms`);
    console.log(`[Navis] Browser launched, starting loop (task: "${task.slice(0, 60)}...")`);

    let steps = 0;
    let history: string[] = [];
    let lastResult = '';
    let snapshot: AriaSnapshotResult | null = null;
    let lastUrl = '';

    // Background snapshot: started after actions change the page, awaited at next step start
    let pendingSnapshot: Promise<AriaSnapshotResult | null> | null = null;

    try {
      let aiRetries = 0;
      const maxAiRetries = 3;
      let lastGoal = '';
      let goalRepeatCount = 0;

      while (steps < maxSteps) {
        const page = this.session.page;
        const t1 = Date.now();
        const url = page.url();
        const title = await page.title().catch(() => 'Unknown');
        const pages = this.session.allPages;
        const tabCount = pages.length;
        const tabsStr = tabCount > 1
          ? pages.map((p, i) => `  Tab ${i}: ${p.url()}`).join('\n')
          : `1 tab open: ${url}`;

        // ── Vision mode: screenshot + multimodal AI ──
        let screenshotB64: string | null = null;
        let elementsFormatted = '';

        const t2 = Date.now();
        if (useVision) {
          // Capture screenshot + element snapshot in parallel for speed
          try {
            // Annotate page with visual refs before taking the screenshot
            await this.session.annotateElements();
            
            const [screenshotBuffer, elemSnapshot] = await Promise.all([
              page.screenshot({ type: 'jpeg', quality: 75, fullPage: false }),
              captureInteractiveElements(page),
            ]);

            // Clean up annotations immediately after screenshot
            await this.session.removeAnnotations();

            screenshotB64 = screenshotBuffer.toString('base64');
            snapshot = elemSnapshot;
            elementsFormatted = formatElementsForPrompt(snapshot.raw);
            lastUrl = url;
          } catch (err) {
            console.warn('[Navis] Screenshot capture failed, falling back to DOM-only:', err);
            await this.session.removeAnnotations().catch(() => {});
            snapshot = await captureInteractiveElements(page);
            elementsFormatted = formatElementsForPrompt(snapshot.raw);
            lastUrl = url;
          }
        } else {
          // ── DOM-only mode: aria snapshot ──
          if (pendingSnapshot) {
            const bgSnapshot = await pendingSnapshot;
            if (bgSnapshot) {
              snapshot = bgSnapshot;
              lastUrl = url;
            }
            pendingSnapshot = null;
          } else if (!snapshot || url !== lastUrl) {
            snapshot = await captureInteractiveElements(page);
            lastUrl = url;
          }

          if (!snapshot) {
            snapshot = await captureInteractiveElements(page);
            lastUrl = url;
          }
          elementsFormatted = formatElementsForPrompt(snapshot.raw);
        }
        const t3 = Date.now();

        // Stuck loop detection
        let stuckWarning = '';
        if (goalRepeatCount >= 2) {
          stuckWarning = `\n[SELF-CORRECTION]: You have tried "${lastGoal}" ${goalRepeatCount} times without success. TRY A DIFFERENT STRATEGY (different search term, scroll elsewhere, or try a different website).`;
        }

        // Compress history after 8 steps to keep context small
        const historyStr = history.length > 8
          ? `[${history.length - 8} earlier steps]...` + history.slice(-8).join('\n')
          : (history.length > 0 ? history.join('\n') : 'None');

        const inputContext = [
          `Task: ${task}`,
          `History: ${historyStr}`,
          `Current Tab: ${url} (${title})`,
          `Open Tabs (${tabCount}):\n${tabsStr}`,
          `Elements:`,
          elementsFormatted,
          lastResult ? `Last: ${lastResult}${stuckWarning}` : '',
        ].filter(Boolean).join('\n');

        const systemPrompt = NAVIS_SYSTEM_PROMPT
          .replace(/\{\{max_actions\}\}/g, String(maxActionsPerStep));
        const nextPrompt = NEXT_STEP_PROMPT
          .replace(/\{url_placeholder\}/g, ` (${url})`)
          .replace(/\{tabs_placeholder\}/g, ` (${tabCount} tabs open)`)
          .replace(/\{results_placeholder\}/g, lastResult ? ` (${lastResult})` : ' (None)')
          .replace(/\{content_above_placeholder\}/g, '')
          .replace(/\{content_below_placeholder\}/g, '');

        const t4 = Date.now();
        // Use vision AI if we have a screenshot, otherwise use text-only
        const decision = screenshotB64
          ? await this.callAIVision(systemPrompt, inputContext, nextPrompt, screenshotB64)
          : await this.callAI(systemPrompt, inputContext, nextPrompt);
        const t5 = Date.now();
        
        if (!decision) {
          aiRetries++;
          if (aiRetries > maxAiRetries) {
            this.logger.error(`AI failed after ${maxAiRetries} retries`);
            break;
          }
          this.logger.error(`AI returned no valid decision (retry ${aiRetries}/${maxAiRetries})`);
          lastResult = `AI call failed on step ${steps}, retrying... (attempt ${aiRetries}/${maxAiRetries})`;
          continue;
        }
        aiRetries = 0;
        steps++;

        // Update loop detection state
        const currentGoal = decision.current_state?.next_goal || '';
        if (currentGoal === lastGoal) {
          goalRepeatCount++;
        } else {
          lastGoal = currentGoal;
          goalRepeatCount = 0;
        }

        this.logger.aiDecision(steps, maxSteps, currentGoal);
        await this.session.setOverlayStatus(currentGoal || 'Working...');

        const t6 = Date.now();
        const actions = (decision.action || []).slice(0, maxActionsPerStep);
        let stateChanged = false;

        for (const actionObj of actions) {
          const actionName = Object.keys(actionObj)[0] as ActionName;
          const actionArgs = actionObj[actionName] as Record<string, unknown>;

          const result = await executeAction(
            actionName,
            actionArgs,
            this.session.page,
            this.session,
            this.logger,
            steps,
            maxSteps,
          );

          lastResult = result.message;

          if (actionName === 'done') {
            this.logger.taskComplete(result.success, steps, lastResult);
            return {
              success: (decision.action?.find((a: any) => a.done)?.done?.success) ?? result.success,
              output: result.message,
              steps,
            };
          }

          if (result.stateChanged) {
            stateChanged = true;
            break;
          }
        }

        const t7 = Date.now();
        let captureLabel = 'sync';

        if (stateChanged) {
          const currentUrl = page.url();
          if (currentUrl !== lastUrl) {
            // Start capturing next page's elements in background — hidden behind next AI call
            const captureUrl = currentUrl;
            pendingSnapshot = page.waitForLoadState('domcontentloaded', { timeout: 1000 })
              .then(() => captureInteractiveElements(page))
              .then(r => { console.log(`[Navis] BG capture ready (${captureUrl})`); return r; })
              .catch(() => { console.log(`[Navis] BG capture failed`); return null; });
            captureLabel = 'bg';
          } else {
            await new Promise((r) => setTimeout(r, 20));
          }
        }

        const t8 = Date.now();
        const stepMs = t8 - t1;
        const wallClock = Date.now() - runStart;
        const visionTag = screenshotB64 ? ' [VISION]' : '';
        console.log(`[Navis Step ${steps}${visionTag}] pageInfo=${t2-t1}ms capture=${t3-t2}ms build=${t4-t3}ms AI=${t5-t4}ms actions=${t6-t5}ms wait=${t8-t7}ms(${captureLabel}) STEP=${stepMs}ms WALL=${wallClock}ms`);

        this.logger.stepComplete(steps, maxSteps, lastResult);
        history.push(`${decision.current_state?.next_goal} → ${lastResult}`);
      }

      console.log(`[Navis] ⏱ Total wall clock: ${Date.now() - runStart}ms over ${steps} steps`);

      return {
        success: false,
        output: `Reached maximum ${maxSteps} steps. Last result: ${lastResult}`,
        steps,
      };
    } catch (err: any) {
      this.logger.error(err.message);
      return { success: false, output: `Error: ${err.message}`, steps };
    } finally {
      // Intentionally not closing session to allow multiple tool calls to share the same browser
    }
  }

  private async callAI(
    systemPrompt: string,
    inputContext: string,
    nextStepPrompt: string,
  ): Promise<any | null> {
    try {
      const aiStart = Date.now();
      const response = await this.aiClient.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: inputContext + '\n\n' + nextStepPrompt },
        ],
        model: this.model,
        responseFormat: 'json',
        jsonSchema: NAVIS_DECISION_SCHEMA,
        temperature: 0.1,
      });
      console.log(`[Navis] AI call: ${Date.now() - aiStart}ms (model: ${this.model})`);

      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return this.extractJson(raw);
    } catch (err: any) {
      this.logger.error(`AI call failed: ${err.message?.slice(0, 120) || 'unknown error'}`);
      return null;
    }
  }

  /**
   * Vision-enhanced AI call: sends a screenshot as multimodal content alongside text.
   * Uses the main AI client if it supports vision, else falls back to the configured
   * vision grounding model (visionClient). Includes a specialized vision prompt that
   * teaches the AI spatial reasoning and visual page understanding.
   */
  private async callAIVision(
    systemPrompt: string,
    inputContext: string,
    nextStepPrompt: string,
    screenshotB64: string,
  ): Promise<any | null> {
    // Pick the right client: vision fallback if available, else main
    const client = this.visionClient || this.aiClient;
    const modelToUse = client.model;

    // Calculate image size for detail level — smaller images use 'low' to save tokens
    const imgSizeKB = Math.round((screenshotB64.length * 3) / 4 / 1024);
    const detail = imgSizeKB > 200 ? 'high' : 'low';

    const visionInstructions = `
VISION MODE ACTIVE — You are seeing a screenshot of the browser page.

VISUAL ANALYSIS INSTRUCTIONS:
1. LAYOUT: Identify the page structure — header/nav, main content, sidebar, footer.
   Look for the primary content area and focus your actions there.
2. INTERACTIVE ELEMENTS: The element list ([ref=eN]) maps to clickable/typeable items.
   Match visual elements you see in the screenshot to their ref IDs for precise actions.
3. POPUPS & OVERLAYS: If you see cookie banners, modals, login popups, or consent dialogs
   overlaying the content — dismiss them FIRST (click accept/close/X) before proceeding.
4. LOADING STATES: If the page appears to be loading (spinners, skeleton screens),
   use the wait action before trying to interact.
5. CAPTCHAS: If you see a CAPTCHA challenge (checkboxes, puzzles, "verify you're human"),
   use solve_captcha immediately.
6. SCROLL INDICATORS: If you can see that content continues below (e.g. partial text,
   scrollbar visible), use scroll_down to reveal more content.
7. SEARCH BOXES: When you see a search input, type SHORT keywords (1-2 words maximum).
   Long queries rarely work well on website search.

Use the [ref=eN] identifiers from the Elements list to perform actions.
The screenshot confirms WHAT you see; the refs tell you HOW to interact.`;

    try {
      const aiStart = Date.now();
      const visionLabel = client === this.visionClient ? 'vision-fallback' : 'main';
      console.log(`[Navis] 🖼️ Vision AI call (${visionLabel}, model: ${modelToUse}, img: ${imgSizeKB}KB, detail: ${detail})`);

      const response = await client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${screenshotB64}`,
                  detail: detail as 'low' | 'high',
                },
              },
              {
                type: 'text',
                text: inputContext + '\n\n' + nextStepPrompt + '\n\n' + visionInstructions,
              },
            ],
          },
        ],
        model: modelToUse,
        responseFormat: 'json',
        jsonSchema: NAVIS_DECISION_SCHEMA,
        temperature: 0.1,
      });

      const elapsed = Date.now() - aiStart;
      console.log(`[Navis] 🖼️ Vision AI complete: ${elapsed}ms (${visionLabel})`);

      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return this.extractJson(raw);
    } catch (err: any) {
      const errMsg = err.message?.slice(0, 150) || 'unknown error';
      this.logger.error(`Vision AI call failed: ${errMsg}`);

      // If it's an image-related error, fall back gracefully to text-only
      const isVisionError = errMsg.toLowerCase().includes('image') ||
                            errMsg.toLowerCase().includes('vision') ||
                            errMsg.toLowerCase().includes('multimodal') ||
                            errMsg.toLowerCase().includes('content type');
      
      if (isVisionError) {
        console.warn('[Navis] Vision not supported by model, falling back to text-only permanently for this session');
      } else {
        console.warn('[Navis] Vision AI failed, falling back to text-only call');
      }
      return this.callAI(systemPrompt, inputContext, nextStepPrompt);
    }
  }

  private extractJson(raw: string): any {
    let cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    try {
      return JSON.parse(cleaned);
    } catch {
      const first = cleaned.indexOf('{');
      if (first === -1) throw new Error('No JSON found');
      
      // Find the first complete JSON object by tracking brace depth
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      for (let i = first; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            return JSON.parse(cleaned.substring(first, i + 1));
          }
        }
      }
      throw new Error('No complete JSON object found');
    }
  }
}