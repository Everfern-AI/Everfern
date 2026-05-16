"use strict";
/**
 * Navis — Orchestrator
 *
 * Main AI-driven loop: capture state → call LLM → parse decision → execute actions → repeat.
 * Handles JSON schema enforcement, retry logic, and graceful failure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NavisOrchestrator = exports.NAVIS_DECISION_SCHEMA = void 0;
const session_1 = require("./session");
const element_capture_1 = require("./element-capture");
const actions_1 = require("./actions");
const prompt_sync_1 = require("../../../lib/prompt-sync");
const logger_1 = require("./logger");
const ai_optimization_1 = require("./ai-optimization");
const parallel_processing_1 = require("./parallel-processing");
// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema for Navis decision output (strict validation)
// ─────────────────────────────────────────────────────────────────────────────
exports.NAVIS_DECISION_SCHEMA = {
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
function loadNavisPrompts() {
    const rawPrompt = (0, prompt_sync_1.loadPrompt)('NAVIS.md');
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
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
class NavisOrchestrator {
    aiClient;
    visionClient;
    model;
    session;
    logger;
    parallelCoordinator;
    constructor(aiClient, logger, visionClient) {
        this.aiClient = aiClient;
        this.visionClient = visionClient || null;
        this.model = aiClient.model;
        this.logger = logger || new logger_1.NavisLogger();
        this.session = new session_1.BrowserSession();
        this.parallelCoordinator = new parallel_processing_1.ParallelProcessingCoordinator();
    }
    getEventLogger() { return this.logger; }
    async run(options) {
        const { task, maxSteps = 25, maxActionsPerStep = 8, headless = false, startUrl, useVision = false } = options;
        const runStart = Date.now();
        await this.session.launch({ headless, startUrl, logger: this.logger });
        console.log(`[Navis] ⏱ launch: ${Date.now() - runStart}ms`);
        console.log(`[Navis] Vision mode: ${useVision ? 'ENABLED' : 'disabled'}`);
        await this.session.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        console.log(`[Navis] ⏱ initial page load: ${Date.now() - runStart}ms`);
        console.log(`[Navis] Browser launched, starting loop (task: "${task.slice(0, 60)}...")`);
        let steps = 0;
        let history = [];
        let lastResult = '';
        let snapshot = null;
        let lastUrl = '';
        // Background snapshot: started after actions change the page, awaited at next step start
        let pendingSnapshot = null;
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
                let screenshotB64 = null;
                let elementsFormatted = '';
                const t2 = Date.now();
                if (useVision) {
                    // Vision mode is PRIMARY - capture screenshot + element snapshot in parallel
                    try {
                        // Annotate page with visual refs before taking the screenshot
                        await this.session.annotateElements();
                        // Hide overlay before screenshot
                        await page.evaluate(() => {
                            const controls = window.__navis_controls;
                            if (controls?.hideOverlay) {
                                controls.hideOverlay();
                            }
                        }).catch(() => { });
                        const [screenshotBuffer, elemSnapshot] = await Promise.all([
                            page.screenshot({ type: 'jpeg', quality: 75, fullPage: false }).catch((err) => {
                                // Handle screenshot timeout specifically
                                if (err.message?.includes('Timeout') || err.message?.includes('timed out')) {
                                    throw new Error(`Screenshot capture timed out after 30 seconds. The page may be unresponsive or the screenshot operation is taking too long. Try simplifying the task or increasing the timeout.`);
                                }
                                throw err;
                            }),
                            (0, element_capture_1.captureInteractiveElements)(page),
                        ]);
                        // Restore overlay after screenshot
                        await page.evaluate(() => {
                            const controls = window.__navis_controls;
                            if (controls?.showOverlay) {
                                controls.showOverlay();
                            }
                        }).catch(() => { });
                        // Clean up annotations immediately after screenshot
                        await this.session.removeAnnotations();
                        screenshotB64 = screenshotBuffer.toString('base64');
                        snapshot = elemSnapshot;
                        elementsFormatted = (0, element_capture_1.formatElementsForPrompt)(snapshot.raw);
                        lastUrl = url;
                        console.log('[Navis] Vision mode: screenshot captured successfully');
                    }
                    catch (err) {
                        // Vision mode screenshot timeout - ask AI what happened and return gracefully
                        const errMsg = err instanceof Error ? err.message : String(err);
                        const isTimeout = errMsg.includes('timed out') || errMsg.includes('Timeout');
                        console.error('[Navis] Vision mode FAILED - screenshot capture error:', err);
                        // Ensure overlay is restored even on error
                        await page.evaluate(() => {
                            const controls = window.__navis_controls;
                            if (controls?.showOverlay) {
                                controls.showOverlay();
                            }
                        }).catch(() => { });
                        await this.session.removeAnnotations().catch(() => { });
                        // If it's a timeout, ask the AI what happened and return gracefully
                        if (isTimeout) {
                            console.log('[Navis] Screenshot timeout detected - asking AI to assess current state and return to main agent');
                            try {
                                // Get current page state without screenshot
                                snapshot = await (0, element_capture_1.captureInteractiveElements)(page);
                                elementsFormatted = (0, element_capture_1.formatElementsForPrompt)(snapshot.raw);
                                // Ask AI to assess what happened
                                const assessmentPrompt = `The screenshot capture timed out after 30 seconds. The page at ${url} appears to be unresponsive or taking too long to render.

Current page elements:
${elementsFormatted}

Please assess:
1. What is the current state of the page?
2. What was the last action attempted?
3. What should the user know about what happened?

Respond with a brief assessment (2-3 sentences) of the current situation.`;
                                const assessment = await this.aiClient.chat({
                                    messages: [
                                        { role: 'system', content: 'You are a browser automation assistant. Assess the current page state and explain what happened.' },
                                        { role: 'user', content: assessmentPrompt }
                                    ],
                                    model: this.model,
                                    temperature: 0.3,
                                }).catch(() => null);
                                const assessmentText = assessment
                                    ? (typeof assessment.content === 'string' ? assessment.content : JSON.stringify(assessment.content))
                                    : 'Screenshot capture timed out - page may be unresponsive.';
                                // Return gracefully with assessment
                                this.logger.taskComplete(false, steps, assessmentText);
                                return {
                                    success: false,
                                    output: `Screenshot Timeout: ${assessmentText}\n\nThe page at ${url} did not respond to screenshot capture within 30 seconds. This may indicate:\n- The page is loading complex content\n- JavaScript is running indefinitely\n- The server is slow or unresponsive\n\nPlease try again or simplify the task.`,
                                    steps,
                                };
                            }
                            catch (assessmentErr) {
                                console.error('[Navis] Assessment failed:', assessmentErr);
                                // Return with basic timeout message
                                this.logger.taskComplete(false, steps, 'Screenshot timeout - page unresponsive');
                                return {
                                    success: false,
                                    output: `Screenshot Timeout: The page at ${url} did not respond to screenshot capture within 30 seconds. The page may be unresponsive or loading complex content. Please try again or simplify the task.`,
                                    steps,
                                };
                            }
                        }
                        // For non-timeout errors, throw to stop execution
                        throw new Error(`Vision mode failed: ${errMsg}`);
                    }
                }
                else {
                    // ── DOM-only mode: aria snapshot ──
                    if (pendingSnapshot) {
                        const bgSnapshot = await pendingSnapshot;
                        if (bgSnapshot) {
                            snapshot = bgSnapshot;
                            lastUrl = url;
                        }
                        pendingSnapshot = null;
                    }
                    else if (!snapshot || url !== lastUrl) {
                        snapshot = await (0, element_capture_1.captureInteractiveElements)(page);
                        lastUrl = url;
                    }
                    if (!snapshot) {
                        snapshot = await (0, element_capture_1.captureInteractiveElements)(page);
                        lastUrl = url;
                    }
                    elementsFormatted = (0, element_capture_1.formatElementsForPrompt)(snapshot.raw);
                }
                const t3 = Date.now();
                // Stuck loop detection
                let stuckWarning = '';
                if (goalRepeatCount >= 2) {
                    stuckWarning = `\n[SELF-CORRECTION]: You have tried "${lastGoal}" ${goalRepeatCount} times without success. TRY A DIFFERENT STRATEGY (different search term, scroll elsewhere, or try a different website).`;
                }
                // Compress history after 8 steps to keep context small (Req 2.3)
                const historyStr = (0, ai_optimization_1.compressHistory)(history);
                const inputContext = [
                    `Task: ${task}`,
                    `Current Step: ${steps + 1}/${maxSteps}`,
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
                // When vision mode is enabled, ALWAYS use vision AI (no fallback to text-only)
                // When vision mode is disabled, use text-only AI
                const decision = useVision
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
                }
                else {
                    lastGoal = currentGoal;
                    goalRepeatCount = 0;
                }
                this.logger.aiDecision(steps, maxSteps, currentGoal);
                await this.session.setOverlayStatus(currentGoal || 'Working...');
                const t6 = Date.now();
                const actions = (decision.action || []).slice(0, maxActionsPerStep);
                let stateChanged = false;
                for (const actionObj of actions) {
                    const actionName = Object.keys(actionObj)[0];
                    const actionArgs = actionObj[actionName];
                    const result = await (0, actions_1.executeAction)(actionName, actionArgs, this.session.page, this.session, this.logger, steps, maxSteps);
                    lastResult = result.message;
                    if (actionName === 'done') {
                        this.logger.taskComplete(result.success, steps, lastResult);
                        return {
                            success: (decision.action?.find((a) => a.done)?.done?.success) ?? result.success,
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
                            .then(() => (0, element_capture_1.captureInteractiveElements)(page))
                            .then(r => { console.log(`[Navis] BG capture ready (${captureUrl})`); return r; })
                            .catch(() => { console.log(`[Navis] BG capture failed`); return null; });
                        captureLabel = 'bg';
                    }
                    else {
                        await new Promise((r) => setTimeout(r, 20));
                    }
                }
                const t8 = Date.now();
                const stepMs = t8 - t1;
                const wallClock = Date.now() - runStart;
                const visionTag = screenshotB64 ? ' [VISION]' : '';
                console.log(`[Navis Step ${steps}${visionTag}] pageInfo=${t2 - t1}ms capture=${t3 - t2}ms build=${t4 - t3}ms AI=${t5 - t4}ms actions=${t6 - t5}ms wait=${t8 - t7}ms(${captureLabel}) STEP=${stepMs}ms WALL=${wallClock}ms`);
                this.logger.stepComplete(steps, maxSteps, lastResult);
                history.push(`${decision.current_state?.next_goal} → ${lastResult}`);
            }
            console.log(`[Navis] ⏱ Total wall clock: ${Date.now() - runStart}ms over ${steps} steps`);
            // ── Step Limit Reached: Synthesize Partial Results ──
            this.logger.error(`Reached maximum ${maxSteps} steps. Synthesizing partial results to prevent data loss...`);
            // Capture final state for synthesis
            const finalUrl = this.session.page.url();
            let finalScreenshot = null;
            if (useVision) {
                finalScreenshot = await this.session.page.screenshot({ type: 'jpeg', quality: 60 }).then(b => b.toString('base64')).catch(() => null);
            }
            const partialSummary = await this.synthesizePartialResults(task, history, finalUrl, lastResult, finalScreenshot || undefined);
            return {
                success: false,
                output: `Reached maximum ${maxSteps} steps. MISSION INTERRUPTED - Partial Findings Summary:\n\n${partialSummary}`,
                steps,
            };
        }
        catch (err) {
            this.logger.error(err.message);
            return { success: false, output: `Error: ${err.message}`, steps };
        }
        finally {
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
            }
            catch (finallyErr) {
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
    async synthesizePartialResults(task, history, lastUrl, lastResult, screenshotB64) {
        // Keep last 15 steps of history for context, as that's where most recent discoveries are
        const historyContext = history.slice(-15).join('\n');
        const prompt = `You are Navis, a high-performance browser automation agent.
You have reached your maximum step limit (25 steps) while working on a complex research task.

ORIGINAL RESEARCH GOAL: "${task}"

Your mission is to provide an EXHAUSTIVE summary of every piece of relevant information you have discovered so far.
Do not apologize for stopping; instead, provide value by reporting all data points, prices, airline schedules, links, or facts found in your history.

CONVERSATION HISTORY (Last 15 steps):
${historyContext}

CURRENT PAGE URL: ${lastUrl}
LAST ACTION ATTEMPTED: ${lastResult}

REPORT FORMAT:
- Summary of Findings: [High-level overview]
- Extracted Data: [Specific list of items, prices, names, etc.]
- Current Status: [Where you stopped and what was left to do]

If you found nothing useful, state "No relevant data points were extracted before the limit was reached."
Respond with the plain text report only.`;
        try {
            const messages = [{ role: 'system', content: 'You are a research synthesis expert.' }];
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
            }
            else {
                messages.push({ role: 'user', content: prompt });
            }
            const response = await this.aiClient.chat({
                messages,
                model: this.model,
                temperature: 0.3,
            });
            return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        }
        catch (err) {
            console.error('[Navis] Synthesis failed:', err);
            return `[Synthesis failed] Last result: ${lastResult}. History: ${history.slice(-5).join('; ')}`;
        }
    }
    async callAI(systemPrompt, inputContext, nextStepPrompt) {
        try {
            const aiStart = Date.now();
            const response = await this.aiClient.chat({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: inputContext + '\n\n' + nextStepPrompt },
                ],
                model: this.model,
                responseFormat: 'json',
                jsonSchema: exports.NAVIS_DECISION_SCHEMA,
                temperature: 0.1, // Req 2.4: Temperature 0.1 for consistent responses
            });
            const elapsedMs = Date.now() - aiStart;
            // Check performance target (Req 2.1: text-only <2000ms)
            const perfCheck = (0, ai_optimization_1.checkPerformanceTarget)(elapsedMs, 'text-only');
            console.log(`[Navis] ${perfCheck.message} (model: ${this.model})`);
            const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            return this.extractJson(raw);
        }
        catch (err) {
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
     */
    async callAIVision(systemPrompt, inputContext, nextStepPrompt, screenshotB64) {
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
                                    detail: detail,
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
                jsonSchema: exports.NAVIS_DECISION_SCHEMA,
                temperature: 0.1,
            });
            const elapsed = Date.now() - aiStart;
            // Check performance target (Req 2.2: vision <4000ms)
            const perfCheck = (0, ai_optimization_1.checkPerformanceTarget)(elapsed, 'vision');
            console.log(`[Navis] 🖼️ ${perfCheck.message} (${visionLabel})`);
            const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            return this.extractJson(raw);
        }
        catch (err) {
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
            }
            else if (isTimeout) {
                const timeoutMsg = `[Navis] Vision grounding operation timed out. This may be due to a slow network connection, large screenshot size, or an unresponsive page. Try simplifying the task or checking your connection.`;
                console.warn(`[Navis] ${timeoutMsg}`);
            }
            // If it's an image-related error, fall back gracefully to text-only
            const isVisionError = errMsg.toLowerCase().includes('image') ||
                errMsg.toLowerCase().includes('vision') ||
                errMsg.toLowerCase().includes('multimodal') ||
                errMsg.toLowerCase().includes('content type');
            if (isVisionError) {
                console.warn('[Navis] Vision not supported by model, falling back to text-only permanently for this session');
            }
            else {
                console.warn('[Navis] Vision AI failed, falling back to text-only call');
            }
            return this.callAI(systemPrompt, inputContext, nextStepPrompt);
        }
    }
    extractJson(raw) {
        let cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        try {
            return JSON.parse(cleaned);
        }
        catch {
            const first = cleaned.indexOf('{');
            if (first === -1)
                throw new Error('No JSON found');
            // Find the first complete JSON object by tracking brace depth
            let depth = 0;
            let inString = false;
            let escapeNext = false;
            for (let i = first; i < cleaned.length; i++) {
                const ch = cleaned[i];
                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }
                if (ch === '\\' && inString) {
                    escapeNext = true;
                    continue;
                }
                if (ch === '"') {
                    inString = !inString;
                    continue;
                }
                if (inString)
                    continue;
                if (ch === '{')
                    depth++;
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
exports.NavisOrchestrator = NavisOrchestrator;
