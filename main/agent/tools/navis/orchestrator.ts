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
import {
  compressHistory,
  callAIWithStreaming,
  checkPerformanceTarget,
  checkScreenshotPerformance,
  DEFAULT_SCREENSHOT_CONFIG,
} from './ai-optimization';
import {
  captureScreenshotAndElements,
  BackgroundElementCapture,
  ElementPrefetcher,
  ParallelProcessingCoordinator,
} from './parallel-processing';
import { globalAbortManager } from '../../runner/abort-manager';

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
        request_vision: { type: 'boolean', description: 'Set to true if you need a visual screenshot to proceed' },
        is_form_interaction: { type: 'boolean', description: 'Set to true if interacting with complex forms, datepickers, or sliders' }
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
          { properties: { hold_element: { type: 'object', properties: { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, holdTimeMs: { type: 'number' } }, additionalProperties: false } }, required: ['hold_element'], additionalProperties: false },
          { properties: { drag_element: { type: 'object', properties: { sourceRef: { type: 'string' }, targetRef: { type: 'string' }, targetX: { type: 'number' }, targetY: { type: 'number' } }, required: ['sourceRef'], additionalProperties: false } }, required: ['drag_element'], additionalProperties: false },
          { properties: { press_key: { type: 'object', properties: { ref: { type: 'string' }, key: { type: 'string' } }, required: ['key'], additionalProperties: false } }, required: ['press_key'], additionalProperties: false },
          { properties: { scroll_down: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false } }, required: ['scroll_down'], additionalProperties: false },
          { properties: { scroll_up: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false } }, required: ['scroll_up'], additionalProperties: false },
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

const FALLBACK_SYSTEM_PROMPT = `You are Navis, a high-speed AI browser agent. Your goal is to complete the task as FAST as possible.
Prioritize moving through pages and taking actions over long analysis. If a page seems irrelevant, navigate to a new URL immediately.
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
}

// ─────────────────────────────────────────────────────────────────────────────
// NavisResult
// ─────────────────────────────────────────────────────────────────────────────

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
  private parallelCoordinator: ParallelProcessingCoordinator;

  constructor(aiClient: AIClient, logger?: NavisLogger, visionClient?: AIClient) {
    this.aiClient = aiClient;
    this.visionClient = visionClient || null;
    this.model = aiClient.model;
    this.logger = logger || new NavisLogger();
    this.session = new BrowserSession();
    this.parallelCoordinator = new ParallelProcessingCoordinator();
  }

  getEventLogger(): NavisLogger { return this.logger; }

  async run(options: NavisOptions): Promise<NavisResult> {
    const { task, maxSteps = 40, maxActionsPerStep = 8, headless = false, startUrl, useVision = false } = options;

    const runStart = Date.now();
    await this.session.launch({ headless, startUrl, logger: this.logger });
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
      let forceNextVision = false;

      // Allow one extra step for a "force finish" synthesis if limit reached
      while (steps <= maxSteps) {
        if (globalAbortManager.streamAborted) {
            console.log('[Navis] 🛑 Abort signal detected in Navis orchestrator loop');
            this.logger.error('Execution aborted by user');
            return {
                success: false,
                output: 'Execution aborted by user',
                steps
            };
        }

        const page = this.session.page;
        const t1 = Date.now();
        const url = page.url();
        const title = await page.title().catch(() => 'Unknown');
        const pages = this.session.allPages;
        const tabCount = pages.length;
        const tabsStr = tabCount > 1
          ? pages.map((p, i) => ` Tab ${i}: ${p.url()}`).join('\n')
          : `1 tab open: ${url}`;

        // ── HYBRID CAPTURE: Always capture DOM, capture vision on-demand ──
        let screenshotB64: string | null = null;
        let elementsFormatted = '';
        let semanticDomJson = '';

        const t2 = Date.now();
        
        // Capture elements (DOM) always
        snapshot = await captureInteractiveElements(page);
        elementsFormatted = formatElementsForPrompt(snapshot.raw);
        
        // Semantic DOM is a lighter JSON representation of the page structure
        semanticDomJson = JSON.stringify(snapshot.raw); // Or a specialized formatter

        // Vision is triggered by: 
        // 1. Orchestrator-level 'useVision' flag (global)
        // 2. AI request 'request_vision' (step-by-step)
        // 3. Form interaction detection
        const shouldCaptureVision = useVision || forceNextVision;

        if (shouldCaptureVision) {
          try {
            await this.session.annotateElements();
            await page.evaluate(() => {
              const controls = (window as any).__navis_controls;
              if (controls?.hideOverlay) controls.hideOverlay();
            }).catch(() => {});

            const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });

            await page.evaluate(() => {
              const controls = (window as any).__navis_controls;
              if (controls?.showOverlay) controls.showOverlay();
            }).catch(() => {});
            await this.session.removeAnnotations();

            screenshotB64 = screenshotBuffer.toString('base64');
            console.log('[Navis] On-demand vision: screenshot captured');
            this.logger.screenshot(steps, maxSteps, screenshotB64);
          } catch (err) {
            console.warn('[Navis] On-demand vision capture failed:', err);
            await this.session.removeAnnotations().catch(() => {});
          }
        } else {
          // Lightweight UI screenshot for the frontend (fast)
          const uiScreenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 40, timeout: 2000 }).catch(() => null);
          if (uiScreenshotBuffer) {
            this.logger.screenshot(steps, maxSteps, uiScreenshotBuffer.toString('base64'));
          }
        }
        const t3 = Date.now();

        // Stuck loop detection
        let stuckWarning = '';
        if (goalRepeatCount >= 2) {
          stuckWarning = `\n[CRITICAL]: You have attempted the same goal "${lastGoal}" ${goalRepeatCount} times. DO NOT REPEAT. If the current approach is failing, try a different search query, use a different navigation link, or navigate to a new site entirely. MOVE FASTER.`;
        }

        // ── FORCE FINISH PROMPT (One extra turn if limit reached) ──
        const isFinalTurn = steps === maxSteps;
        let finalTurnPrompt = '';
        if (isFinalTurn) {
          console.log(`[Navis] 🚨 Max steps (${maxSteps}) reached. FORCING FINAL ANSWER STEP.`);
          finalTurnPrompt = `\n\n[URGENT: MISSION CRITICAL]: You have reached the maximum allowed steps. This is your ABSOLUTE LAST turn.
DO NOT navigate, click, or type anything.
YOU MUST PROVIDE THE FINAL ANSWER TO THE USER NOW.
Review all information found in your "History" and the current page content.
Call the 'done' action and provide your complete, exhaustive final report in the 'text' parameter.
If you failed to find the info, report that clearly.`;
        }

        // Compress history after 8 steps to keep context small (Req 2.3)
        const historyStr = compressHistory(history);

        const inputContext = [
          `Task: ${task}`,
          `Current Step: ${steps + 1}/${maxSteps}`,
          `History: ${historyStr}`,
          `Current Tab: ${url} (${title})`,
          `Open Tabs (${tabCount}):\n${tabsStr}`,
          `Elements:`,
          elementsFormatted,
          lastResult ? `Last: ${lastResult}${stuckWarning}` : '',
          finalTurnPrompt,
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
        // When vision mode is enabled, ALWAYS use vision AI (no fallback to text-only)
        // When vision mode is disabled, use text-only AI
        const decision: any = useVision || forceNextVision
          ? await this.callAIVision(systemPrompt, inputContext, nextPrompt, screenshotB64, history, elementsFormatted, semanticDomJson)
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

        // Handle on-demand vision requests for the NEXT step
        forceNextVision = decision.current_state?.request_vision || decision.current_state?.is_form_interaction || false;
        if (forceNextVision) {
          console.log(`[Navis] AI requested vision/form mode for next step: ${decision.current_state?.request_vision ? 'vision_requested' : 'form_mode'}`);
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

      // ── Step Limit Reached: Synthesize Partial Results ──
      this.logger.error(`Reached maximum ${maxSteps} steps. Synthesizing partial results to prevent data loss...`);

      // Capture final state for synthesis
      const finalUrl = this.session.page.url();
      let finalScreenshot: string | null = null;
      if (useVision) {
        finalScreenshot = await this.session.page.screenshot({ type: 'jpeg', quality: 60 }).then(b => b.toString('base64')).catch(() => null);
      }

      const partialSummary = await this.synthesizePartialResults(
        task,
        history,
        finalUrl,
        lastResult,
        finalScreenshot || undefined
      );

      return {
        success: false,
        output: `Reached maximum ${maxSteps} steps. MISSION INTERRUPTED - Partial Findings Summary:\n\n${partialSummary}`,
        steps,
      };
    } catch (err: any) {
      this.logger.error(err.message);
      return { success: false, output: `Error: ${err.message}`, steps };
    } finally {
      // Close the browser when Navis is done
      const finallyStartTime = Date.now();
      console.log('[Navis] 🔴 FINALLY BLOCK ENTERED - Initiating session closure and return to main agent');

      try {
        console.log('[Navis] 🔴 Calling session.close()...');

        await this.session.close().catch((err) => {
          console.error('[Navis] ⚠️ session.close() threw error:', err);
        });

        const closureTime = Date.now() - finallyStartTime;
        console.log(`[Navis] ✅ Session closure completed (${closureTime}ms)`);

      } catch (finallyErr) {
        const closureTime = Date.now() - finallyStartTime;
        console.error(`[Navis] ❌ FINALLY BLOCK ERROR (${closureTime}ms):`, finallyErr);
      }

      const totalFinallyTime = Date.now() - finallyStartTime;
      console.log(`[Navis] ✅ FINALLY BLOCK COMPLETE - Total time: ${totalFinallyTime}ms - RETURNING TO MAIN AGENT`);
    }
  }

  /**
   * When Navis hits its step limit, this method uses the AI to look back at the
   * entire history and the current page to provide the best possible summary
   * of findings so far. This prevents "lost progress" for the user.
   */
  private async synthesizePartialResults(
    task: string,
    history: string[],
    lastUrl: string,
    lastResult: string,
    screenshotB64?: string
  ): Promise<string> {
    // Keep last 20 steps of history for context
    const historyContext = history.slice(-20).join('\n');

    const prompt = `You are Navis, a high-performance browser automation agent.
You have reached your absolute turn limit while working on this task: "${task}"

YOUR MISSION: Synthesize everything you have learned into a FINAL RESPONSE for the user.
DO NOT suggest more steps. DO NOT apologize. 
Simply report every relevant fact, price, date, or piece of data you found in your history.

CONVERSATION HISTORY:
${historyContext}

CURRENT URL: ${lastUrl}
LAST OBSERVATION: ${lastResult}

REPORT FORMAT:
- FINAL SUMMARY: [The definitive answer to the user's request]
- DATA POINTS: [Bullet list of specific information discovered]
- STATUS: [What was accomplished and why you stopped]

If no data was found, state "I was unable to find the requested information after exhaustive searching."
Provide the report now.`;

    try {
      const messages: any[] = [{ role: 'system', content: 'You are a research synthesis expert.' }];

      if (screenshotB64) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${screenshotB64}`, detail: 'low' }
            },
            { type: 'text', text: prompt }
          ]
        });
      } else {
        messages.push({ role: 'user', content: prompt });
      }

      const response = await this.aiClient.chat({
        messages,
        model: this.model,
        temperature: 0.3,
      });

      return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    } catch (err) {
      console.error('[Navis] Synthesis failed:', err);
      return `[Synthesis failed] Last result: ${lastResult}. History: ${history.slice(-5).join('; ')}`;
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
        temperature: 0.1, // Req 2.4: Temperature 0.1 for consistent responses
      });
      const elapsedMs = Date.now() - aiStart;

      // Check performance target (Req 2.1: text-only <2000ms)
      const perfCheck = checkPerformanceTarget(elapsedMs, 'text-only');
      console.log(`[Navis] ${perfCheck.message} (model: ${this.model})`);

      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return this.extractJson(raw);
    } catch (err: any) {
      const errMsg = err.message?.slice(0, 120) || 'unknown error';
      this.logger.error(`AI call failed: ${errMsg}`);

      // Check for rate limit or monthly limit errors
      const isRateLimit = err.message?.toLowerCase().includes('429') ||
                          err.message?.toLowerCase().includes('rate limit') ||
                          err.message?.toLowerCase().includes('monthly limit') ||
                          err.message?.toLowerCase().includes('quota exceeded') ||
                          err.message?.toLowerCase().includes('insufficient quota');

      if (isRateLimit) {
        const rateLimitMsg = `[Navis] Vision grounding provider rate limit or monthly limit cap reached. Please check your provider's dashboard to upgrade or wait for quota reset.`;
        console.warn(`[Navis] ${rateLimitMsg}`);
        // Note: The user will see this in the chat context through the error message
        // The error is propagated to stop execution
      }

      return null;
    }
  }

  /**
   * Vision-enhanced AI call: sends a screenshot as multimodal content alongside text.
   * Uses the main AI client if it supports vision, else falls back to the configured
   * vision grounding model (visionClient). Includes a specialized vision prompt that
   * teaches the AI spatial reasoning and visual page understanding.
   *
   * For EverFern Cloud provider, routes to BRAIN + HAND models for vision grounding.
   */
  private async callAIVision(
    systemPrompt: string,
    inputContext: string,
    nextStepPrompt: string,
    screenshotB64: string | null,
    history: string[] = [],
    domContext: string = '',
    semanticDomJson: string = '',
  ): Promise<any | null> {
    // Pick the right client: vision fallback if available, else main
    const client = this.visionClient || this.aiClient;
    const modelToUse = client.model;

    try {
      // Check if using EverFern Cloud provider
      if (client.provider === 'everfern') {
        console.log('[Navis] Using EverFern Cloud vision grounding (BRAIN + HAND)');
        return await this.callEverFernCloudVision(inputContext, nextStepPrompt, screenshotB64, client, history, semanticDomJson || domContext);
      }

      // If no screenshot, use a transparent 1x1 pixel to satisfy multimodal APIs that require an image
      const finalScreenshot = screenshotB64 || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

      // Calculate image size for detail level — smaller images use 'low' to save tokens
      const imgSizeKB = Math.round((finalScreenshot.length * 3) / 4 / 1024);
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
                  url: finalScreenshot.startsWith('data:') ? finalScreenshot : `data:image/jpeg;base64,${finalScreenshot}`,
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

      // Check performance target (Req 2.2: vision <4000ms)
      const perfCheck = checkPerformanceTarget(elapsed, 'vision');
      console.log(`[Navis] 🖼️ ${perfCheck.message} (${visionLabel})`);

      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return this.extractJson(raw);
    } catch (err: any) {
      const errMsg = err.message?.slice(0, 150) || 'unknown error';
      this.logger.error(`Vision AI call failed: ${errMsg}`);

      // Check for rate limit or monthly limit errors
      const isRateLimit = err.message?.toLowerCase().includes('429') ||
                          err.message?.toLowerCase().includes('rate limit') ||
                          err.message?.toLowerCase().includes('monthly limit') ||
                          err.message?.toLowerCase().includes('quota exceeded') ||
                          err.message?.toLowerCase().includes('insufficient quota');

      // Check for timeout errors
      const isTimeout = err.message?.toLowerCase().includes('timeout') ||
                        err.message?.toLowerCase().includes('timed out') ||
                        err.message?.toLowerCase().includes('exceeded');

      if (isRateLimit) {
        const rateLimitMsg = `[Navis] Vision grounding provider rate limit or monthly limit cap reached. Please check your provider's dashboard to upgrade or wait for quota reset.`;
        console.warn(`[Navis] ${rateLimitMsg}`);
        // Note: The user will see this in the chat context through the error message
        // The error is propagated to stop execution
      } else if (isTimeout) {
        const timeoutMsg = `[Navis] Vision grounding operation timed out. This may be due to a slow network connection, large screenshot size, or an unresponsive page. Try simplifying the task or checking your connection.`;
        console.warn(`[Navis] ${timeoutMsg}`);
      }

      if (err.message === 'FALLBACK_TO_TEXT_ONLY') {
        console.log('[Navis] Intentional fallback to text-only AI (e.g. initial navigation)');
        return this.callAI(systemPrompt, inputContext, nextStepPrompt);
      }

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

  /**
   * EverFern Cloud vision grounding: sends screenshot to BRAIN + HAND models
   * Returns browser actions that can be executed by NAVIS
   */
  private async callEverFernCloudVision(
    inputContext: string,
    nextStepPrompt: string,
    screenshotB64: string | null,
    client: AIClient,
    history: string[] = [],
    domContext: string = '',
  ): Promise<any | null> {
    try {
      const aiStart = Date.now();

      // If no screenshot, use a transparent 1x1 pixel to satisfy multimodal APIs that require an image
      const finalScreenshot = screenshotB64 || 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

      // Extract task objective from input context
      const taskMatch = inputContext.match(/Task: (.+?)(?:\n|$)/);
      const objective = taskMatch ? taskMatch[1] : inputContext.substring(0, 200);

      const currentUrlMatch = inputContext.match(/Current Tab: (.+?) \(/);
      const currentUrl = currentUrlMatch ? currentUrlMatch[1] : '';

      // If we're on about:blank or no URL, fall back to text-only AI for initial navigation.
      // Vision grounding (BRAIN+HAND) needs a rendered page to analyze.
      if (currentUrl.includes('about:blank') || currentUrl === '') {
        console.log('[Navis] At about:blank, falling back to text-only AI for initial navigation.');
        // We throw a special error here that will be caught by callAIVision
        // and trigger the fallback to this.callAI
        throw new Error('FALLBACK_TO_TEXT_ONLY');
      }

      console.log('[Navis] Sending to EverFern Cloud vision grounding (BRAIN + HAND)...');
      console.log('[Navis] Current URL:', currentUrl);
      console.log('[Navis] Objective:', objective.substring(0, 100));

      // Call EverFern Cloud API directly using the specialized NAVIS vision endpoint
      // This routes to Reasoner (BRAIN) and then Action (HAND) models with DOM context
      const baseUrl = client.getFullConfig().baseUrl || 'https://api.everfern.app/api';
      
      // Call /api/navis/vision instead of /api/tars/vision to include DOM context
      const response = await fetch(`${baseUrl}/navis/vision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(client.apiKey && { 'Authorization': `Bearer ${client.apiKey}` })
        },
        body: JSON.stringify({
          screenshot: `data:image/jpeg;base64,${finalScreenshot}`,
          dom: domContext,
          objective: objective,
          history: history.slice(-8) // Keep last 8 steps for context
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      if (!data.instruction) {
        throw new Error('No instruction in response from EverFern Cloud');
      }

      const content = data.instruction;
      const actions = data.actions || [];
      const elapsed = Date.now() - aiStart;

      console.log('[Navis] EverFern Cloud response received:', elapsed, 'ms');
      console.log('[Navis] Instruction:', content.substring(0, 150));
      console.log('[Navis] Actions:', actions);

      if (actions.length === 0) {
        console.warn('[Navis] No actions found in EverFern Cloud response, falling back to text-only AI');
        return null; // Fall back to text-only AI
      }

      // Convert TARS actions to NAVIS decision format
      return this._convertTarsActionsToNavisDecision(actions, objective, content);
    } catch (err: any) {
      if (err.message === 'FALLBACK_TO_TEXT_ONLY') throw err;
      console.error('[Navis] EverFern Cloud vision grounding failed:', err);
      this.logger.error(`EverFern Cloud vision failed: ${err.message}`);
      return null; // Fall back to text-only AI
    }
  }

  /**
   * Parse action strings from TARS response content using regex
   * Format: "click(500,500) | type(hello)" or "I will click(500,500) then type(hello)"
   */
  private _parseActionsFromContent(content: string): string[] {
    if (!content) return [];

    // Find all occurrences of action(args) or action() using regex
    // This is the "computer use" way of extracting actions from text
    const actionRegex = /([a-z0-9_]+)\s*\(([^)]*)\)/gi;
    const actions: string[] = [];
    let match;
    
    while ((match = actionRegex.exec(content)) !== null) {
      actions.push(match[0]);
    }

    // If regex found actions, return them
    if (actions.length > 0) {
      console.log(`[Navis] Regex extracted ${actions.length} actions from content`);
      return actions;
    }

    // Fallback to legacy pipe-delimited splitting
    return content
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.toLowerCase().includes('done'));
  }

  /**
   * Convert TARS format actions to NAVIS decision schema
   * TARS actions: click(x,y), type(text), press(key)
   * NAVIS actions: click_element, input_text, press_key, etc.
   */
  private _convertTarsActionsToNavisDecision(
    tarsActions: string[],
    objective: string,
    instruction: string
  ): any {
    const navisActions: any[] = [];

    for (const actionStr of tarsActions) {
      const action = this._parseTarsAction(actionStr);
      if (action) {
        navisActions.push(action);
      }
    }

    // If no valid actions, return null
    if (navisActions.length === 0) {
      return null;
    }

    // Return NAVIS decision format
    return {
      current_state: {
        evaluation_previous_goal: 'Unknown',
        memory: instruction.substring(0, 200),
        next_goal: objective.substring(0, 200)
      },
      action: navisActions
    };
  }

  /**
   * Parse a single TARS action string into NAVIS action format
   * Supported: click(x,y), type(text), press(key), scroll(direction), double_click(x,y), right_click(x,y), move(x,y)
   */
  private _parseTarsAction(actionStr: string): any | null {
    actionStr = actionStr.trim();

    // 1. Coordinate-based actions: click(x,y), double_click(x,y), right_click(x,y), move(x,y)
    // Supports both click(x,y) and click(x=123, y=456)
    const coordMatch = actionStr.match(/(click|double_click|right_click|move|smooth|hover)\s*\((?:[^0-9-]*?(-?\d+)[^0-9-]*?,[^0-9-]*?(-?\d+)[^0-9-]*?)\)/i);
    if (coordMatch) {
      const type = coordMatch[1].toLowerCase();
      const x = parseInt(coordMatch[2]);
      const y = parseInt(coordMatch[3]);

      switch (type) {
        case 'double_click':
          return { browser_double_click: { x, y } };
        case 'right_click':
          return { browser_right_click: { x, y } };
        case 'move':
        case 'smooth':
        case 'hover':
          return { browser_hover: { x, y } };
        default:
          return { browser_click: { x, y } };
      }
    }

    // 2. Simple coordinate-less clicks: right_click(), left_click()
    if (actionStr.match(/right_click\s*\(\s*\)/i)) {
      return { browser_right_click: { x: 0, y: 0 } }; // Will use current pos if implemented
    }
    if (actionStr.match(/left_click\s*\(\s*\)/i) || actionStr.match(/click\s*\(\s*\)/i)) {
      return { browser_click: { x: 0, y: 0 } };
    }

    // 3. Text input: type(text)
    const typeMatch = actionStr.match(/type\s*\(\s*(?:content\s*=\s*)?['\"]?(.+?)['\"]?\s*\)/i);
    if (typeMatch) {
      return { browser_type: { text: typeMatch[1] } };
    }

    // 4. Keyboard shortcuts: ctrl_c(), ctrl_v(), ctrl_a(), win(), alt_tab(), alt_f4()
    if (actionStr.match(/ctrl_c/i)) return { press_key: { key: 'Control+C' } };
    if (actionStr.match(/ctrl_v/i)) return { press_key: { key: 'Control+V' } };
    if (actionStr.match(/ctrl_a/i)) return { press_key: { key: 'Control+A' } };
    if (actionStr.match(/ctrl_x/i)) return { press_key: { key: 'Control+X' } };
    if (actionStr.match(/win/i)) return { press_key: { key: 'Meta' } };
    if (actionStr.match(/alt_tab/i)) return { press_key: { key: 'Alt+Tab' } };
    if (actionStr.match(/alt_f4/i)) return { press_key: { key: 'Alt+F4' } };

    // 5. Single key press: press(key)
    const pressMatch = actionStr.match(/press\s*\(\s*['\"]?([^'\"]+)['\"]?\s*\)/i);
    if (pressMatch) {
      const key = pressMatch[1].trim();
      return { press_key: { key } };
    }

    // 6. Scrolling: scroll(up/down)
    const scrollMatch = actionStr.match(/scroll\s*\(\s*['\"]?(up|down)['\"]?\s*\)/i);
    if (scrollMatch) {
      return scrollMatch[1].toLowerCase() === 'up' ? { scroll_up: {} } : { scroll_down: {} };
    }
    if (actionStr.match(/scroll.*down/i)) return { scroll_down: {} };
    if (actionStr.match(/scroll.*up/i)) return { scroll_up: {} };

    // 7. Cleanup/Meta actions
    if (actionStr.match(/wait/i)) {
      const msMatch = actionStr.match(/\d+/);
      return { wait: { ms: msMatch ? parseInt(msMatch[0]) : 1000 } };
    }

    console.warn('[Navis] Unhandled TARS action:', actionStr);
    return null;
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
