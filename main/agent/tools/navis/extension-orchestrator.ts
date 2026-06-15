import type { AIClient } from '../../../lib/ai-client';
import sharp from 'sharp';
import { loadPrompt } from '../../../lib/prompt-sync';
import { globalAbortManager } from '../../runner/abort-manager';
import { NAVIS_DECISION_SCHEMA, type NavisOptions, type NavisResult } from './orchestrator';
import { ExtensionBrowserAdapter, type BrowserPageState } from './browser-control-adapter';
import { compressHistory } from './ai-optimization';
import { NavisLogger } from './logger';
import type { ActionName } from './actions';
import { bridgeServer } from '../../../lib/extension-server';

const FALLBACK_EXTENSION_SYSTEM_PROMPT = `You are Navis, a fast AI browser agent running through the EverFern browser extension.
Use DOM refs first. Do not request vision unless the DOM is unusable. Complete the task with actions and return strict JSON.
Actions: go_to_url, go_back, click_element, click_text, smart_click, input_text, smart_type, press_key, scroll_down, scroll_up, wait, wait_for_navigation, extract_content, open_tab, switch_tab, close_tab, done.`;

function loadExtensionPrompt(): string {
  const rawPrompt = loadPrompt('NAVIS.md');
  if (!rawPrompt) return FALLBACK_EXTENSION_SYSTEM_PROMPT;
  const systemMatch = rawPrompt.match(/SYSTEM_PROMPT = """\\?\s*([\s\S]*?)"""/);
  return systemMatch?.[1]?.trim() || FALLBACK_EXTENSION_SYSTEM_PROMPT;
}

function clamp(value: unknown, max = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatRefs(state: BrowserPageState): string {
  const refs = Array.isArray(state.refs) ? state.refs : [];
  if (refs.length === 0) return 'No interactive refs captured.';
  return refs.slice(0, 140).map((ref) => {
    const parts = [
      `[${ref.ref}]`,
      ref.tag || ref.role || 'element',
      ref.name ? `"${clamp(ref.name, 90)}"` : '',
      ref.label ? `label="${clamp(ref.label, 70)}"` : '',
      ref.placeholder ? `placeholder="${clamp(ref.placeholder, 70)}"` : '',
      ref.href ? `href="${clamp(ref.href, 120)}"` : '',
      ref.type ? `type=${ref.type}` : '',
      ref.disabled ? 'disabled' : '',
    ].filter(Boolean);
    return parts.join(' ');
  }).join('\n');
}

function semanticDom(state: BrowserPageState): string {
  const refs = Array.isArray(state.refs) ? state.refs : [];
  return JSON.stringify({
    mode: 'extension-first',
    page: {
      url: state.url,
      title: state.title,
      refsAvailable: refs.length,
    },
    visibleInteractive: refs.slice(0, 100),
    pageText: clamp(state.text || '', 5000),
  }, null, 2);
}

function stripThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

function extractJson(raw: string): any {
  const cleaned = stripThinking(raw)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    if (first === -1) throw new Error('No JSON found in Navis extension decision');

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = first; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(cleaned.slice(first, i + 1));
      }
    }
    throw new Error('No complete JSON object found in Navis extension decision');
  }
}

function tabsText(tabs: any[]): string {
  if (!Array.isArray(tabs) || tabs.length === 0) return 'No tab list available.';
  return tabs.slice(0, 24).map((tab, index) => {
    const active = tab.active ? ' active' : '';
    return `Tab ${index}${active}: ${tab.title || 'Untitled'} — ${tab.url || ''}`;
  }).join('\n');
}

export class NavisExtensionOrchestrator {
  private model: string;
  private logger: NavisLogger;
  private adapter: ExtensionBrowserAdapter;

  constructor(private aiClient: AIClient, logger?: NavisLogger) {
    this.model = aiClient.model;
    this.logger = logger || new NavisLogger();
    this.adapter = new ExtensionBrowserAdapter(this.logger);
  }

  getEventLogger(): NavisLogger {
    return this.logger;
  }

  async run(options: NavisOptions): Promise<NavisResult> {
    const {
      task: rawTask,
      maxSteps = 40,
      maxActionsPerStep = 8,
      startUrl,
      useVision = false,
      onlyVision = false,
      forceVision = false,
    } = options || ({} as NavisOptions);

    const task = typeof rawTask === 'string' ? rawTask.trim() : '';
    if (!task) {
      return { success: false, output: 'Navis extension-first requires a non-empty task string.', steps: 0 };
    }

    if (!this.adapter.isAvailable()) {
      return { success: false, output: '[EXTENSION_FALLBACK_REQUIRED] Navis companion extension is not connected.', steps: 0 };
    }

    const systemPrompt = loadExtensionPrompt().replace(/\{\{max_actions\}\}/g, String(maxActionsPerStep));
    const history: string[] = [];
    let lastResult = '';
    let steps = 0;

    await this.adapter.launch({ startUrl });
    this.logger.thinking(0, maxSteps, 'Extension-first mode is connected. Reading the active page DOM before using vision.', { mode: 'extension-first' });

    try {
      bridgeServer.setSession('extension-first-session', startUrl || '', task);

      while (steps <= maxSteps) {
        if (globalAbortManager.streamAborted) {
          this.logger.error('Execution aborted by user');
          return { success: false, output: 'Execution aborted by user', steps };
        }

        const state = await this.adapter.capture();
        bridgeServer.setSession('extension-first-session', state.url, state.title || task);
      const elements = onlyVision ? '[Only Vision Mode Active: DOM elements list is disabled]' : formatRefs(state);
      const dom = onlyVision ? JSON.stringify({ message: "Only Vision Mode Active: DOM context is disabled" }, null, 2) : semanticDom(state);
      const finalTurn = steps === maxSteps
        ? '\nLAST STEP: return a done action now. Do not navigate or click.'
        : '';

      this.logger.thinking(
        steps + 1,
        maxSteps,
        onlyVision
          ? `Running in Only Vision Mode (relying solely on screenshot coordinates) on ${state.title || state.url || 'the active tab'}.`
          : `Reading ${state.refs.length} DOM refs on ${state.title || state.url || 'the active tab'}.`,
        { url: state.url, title: state.title, refs: onlyVision ? 0 : state.refs.length, mode: 'extension-first' },
      );
      this.logger.thinking(
        steps + 1,
        maxSteps,
        onlyVision
          ? 'Choosing the next coordinate-based browser action from the screenshot.'
          : 'Choosing the next browser action from the DOM snapshot.',
        { url: state.url, title: state.title, refs: onlyVision ? 0 : state.refs.length, mode: 'extension-first', phase: 'decision' },
      );

      const visionAvailable = Boolean(useVision || forceVision || onlyVision);
      const pageHasRenderedContent = state.url !== '' && !state.url.includes('about:blank');
      const shouldCaptureVision = visionAvailable && pageHasRenderedContent;

      let screenshotB64: string | null = null;
      if (shouldCaptureVision) {
        try {
          screenshotB64 = await this.adapter.screenshot({ quality: 75 });
          console.log('[Navis Extension] Screenshot captured');
          this.logger.screenshot(steps, maxSteps, screenshotB64);
        } catch (err) {
          console.warn('[Navis Extension] Screenshot capture failed:', err);
        }
      } else {
        try {
          const uiScreenshotB64 = await this.adapter.screenshot({ quality: 40 });
          this.logger.screenshot(steps, maxSteps, uiScreenshotB64);
        } catch (err) {
          console.warn('[Navis Extension] UI screenshot capture failed:', err);
        }
      }

      const historyStr = compressHistory(history);

      const userPrompt = [
        `Task: ${task}`,
        `Current Step: ${steps + 1}/${maxSteps}`,
        `History:\n${historyStr || 'None yet'}`,
        `Current Tab: ${state.url} (${state.title})`,
        `Open Tabs:\n${tabsText(state.tabs)}`,
        'Interactive elements:',
        elements,
        'DOM Grounding Context:',
        dom,
        `Vision Grounding: ${visionAvailable ? 'available on request; use current_state.request_vision=true only when DOM/refs are insufficient or visual layout matters' : 'disabled; rely on DOM refs and extraction'}`,
        lastResult ? `Last result: ${lastResult}` : '',
        finalTurn,
      ].filter(Boolean).join('\n');

      let visionInstructions = '';
      if (shouldCaptureVision) {
        visionInstructions = `
VISION GROUNDING ACTIVE — You are seeing a screenshot plus DOM context for the browser page.

VISUAL ANALYSIS INSTRUCTIONS:
1. DOM FIRST: Use refs, labels, hrefs, input types, and form metadata from the DOM context as the action source.
   Use the screenshot to disambiguate visual layout, overlays, missing refs, and canvas/custom UI.
2. LAYOUT: Identify the page structure — header/nav, main content, sidebar, footer.
   Look for the primary content area and focus your actions there.
3. INTERACTIVE ELEMENTS: The element list ([ref=eN]) maps to clickable/typeable items.
   Match visual elements you see in the screenshot to their ref IDs for precise actions.
4. POPUPS & OVERLAYS: If you see cookie banners, modals, login popups, or consent dialogs
   overlaying the content — dismiss them FIRST (click accept/close/X) before proceeding.
5. LOADING STATES: If the page appears to be loading (spinners, skeleton screens),
   use the wait action before trying to interact.
6. CAPTCHAS: If you see a CAPTCHA challenge (checkboxes, puzzles, "verify you're human"),
   use solve_captcha immediately.
7. SCROLL INDICATORS: If you can see that content continues below (e.g. partial text,
   scrollbar visible), use scroll_down to reveal more content.
8. SEARCH BOXES: When you see a search input, type SHORT keywords (1-2 words maximum).
   Long queries rarely work well on website search.

Use the [ref=eN] identifiers from the Elements list to perform actions.
The screenshot confirms WHAT you see; the refs tell you HOW to interact.`;

        if (onlyVision) {
          visionInstructions = `
ONLY VISION MODE ACTIVE — There is NO DOM context, NO interactive elements, and NO ref IDs available. You must rely SOLELY on visual analysis of the screenshot.

VISUAL ANALYSIS INSTRUCTIONS:
1. NO DOM/REFS: Do NOT attempt to use click_element, click_text, smart_click, input_text, smart_type, hold_element, drag_element, press_key, or any other ref-based or DOM-based actions, as there are no DOM element refs available.
2. COORDINATE-BASED ACTIONS: You MUST interact with the page using ONLY the following coordinate-based actions:
   - "browser_click": Click at normalized coordinate (x, y). Both x and y MUST be integers from 0 to 1000.
   - "browser_double_click": Double-click at normalized coordinate (x, y). Both x and y MUST be integers from 0 to 1000.
   - "browser_right_click": Right-click at normalized coordinate (x, y). Both x and y MUST be integers from 0 to 1000.
   - "browser_hover": Hover at normalized coordinate (x, y). Both x and y MUST be integers from 0 to 1000.
   - "browser_type": Type text into the currently focused input. Normally, you should use browser_click to focus an input first, then browser_type to input text.
3. COORDINATE CALCULATION: x and y represent coordinates on a [0, 1000] normalized grid where:
   - (0, 0) is the top-left corner of the screenshot.
   - (1000, 1000) is the bottom-right corner of the screenshot.
   - (500, 500) is the center of the viewport.
   Carefully estimate coordinates visually from the screenshot before clicking/hovering.
4. POPUPS & OVERLAYS: If you see overlays, cookie banners, or modals, click them away first using browser_click with coordinates.
5. GENERAL ACTIONS: You can still use browser-level actions like "go_to_url", "go_back", "wait", "open_tab", "switch_tab", "close_tab", "wait_for_navigation", and "done".
6. CAPTCHAS: If you see a CAPTCHA, use "solve_captcha" (which operates at a session level).

Estimate the coordinates accurately relative to the image size.`;
        }
      }

      const fullUserPrompt = userPrompt + (visionInstructions ? '\n\n' + visionInstructions : '');

      let decision: any;
      try {
        if (this.aiClient.provider === 'everfern') {
          console.log('[Navis Extension] Using EverFern Cloud visual fallback');
          decision = await this.callEverFernCloudVision(
            fullUserPrompt,
            screenshotB64 || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            history,
            onlyVision ? '' : dom,
            onlyVision
          );
        } else if (shouldCaptureVision && screenshotB64) {
          const finalScreenshot = screenshotB64;
          const imgSizeKB = Math.round((finalScreenshot.length * 3) / 4 / 1024);
          const detail = imgSizeKB > 200 ? 'high' : 'low';

          const response = await this.aiClient.chat({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${finalScreenshot}`,
                      detail: detail as 'low' | 'high',
                    },
                  },
                  {
                    type: 'text',
                    text: fullUserPrompt,
                  },
                ],
              },
            ],
            temperature: 0.1,
            responseFormat: 'json',
            jsonSchema: NAVIS_DECISION_SCHEMA,
            abortSignal: globalAbortManager.abortController.signal,
          });
          const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
          decision = extractJson(raw);
        } else {
          const response = await this.aiClient.chat({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: fullUserPrompt },
            ],
            temperature: 0.1,
            responseFormat: 'json',
            jsonSchema: NAVIS_DECISION_SCHEMA,
            abortSignal: globalAbortManager.abortController.signal,
          });
          const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
          decision = extractJson(raw);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Extension-first AI decision failed: ${message}`);
        return { success: false, output: `[EXTENSION_FALLBACK_REQUIRED] Extension-first AI decision failed: ${message}`, steps };
      }

      steps += 1;
      const nextGoal = clamp(decision?.current_state?.next_goal || 'Choose the next browser action', 240);
      this.logger.aiDecision(steps, maxSteps, nextGoal);

      const actions = Array.isArray(decision?.action) ? decision.action.slice(0, maxActionsPerStep) : [];
      if (actions.length === 0) {
        lastResult = 'AI returned no actions; retrying with the current DOM.';
        history.push(`Step ${steps}: ${lastResult}`);
        continue;
      }

      for (const actionObj of actions) {
        const actionName = Object.keys(actionObj || {})[0] as ActionName | undefined;
        if (!actionName) continue;
        const actionArgs = (actionObj as any)[actionName] || {};
        this.logger.thinking(
          steps,
          maxSteps,
          `Running ${actionName.replace(/_/g, ' ')}.`,
          { actionName, mode: 'extension-first', phase: 'action' },
        );
        const result = await this.adapter.executeAction(actionName, actionArgs, steps, maxSteps);
        lastResult = result.message;
        history.push(`Step ${steps}: ${actionName} -> ${lastResult}`);
        this.logger.stepComplete(
          steps,
          maxSteps,
          `${actionName.replace(/_/g, ' ')} ${result.success ? 'succeeded' : 'failed'}: ${clamp(result.message, 220)}`,
        );

        if (!result.success && result.data?.unsupportedAction) {
          return {
            success: false,
            output: `[EXTENSION_FALLBACK_REQUIRED] Extension-first Navis does not support action ${result.data.unsupportedAction}.`,
            steps,
          };
        }

        if (actionName === 'done') {
          this.logger.taskComplete(result.success, steps, result.message);
          return { success: result.success, output: result.message, steps };
        }

        if (result.stateChanged) break;
      }
      }
    } finally {
      bridgeServer.setSession(null);
    }

    const output = lastResult || 'Navis reached the step limit before producing a final answer.';
    this.logger.taskComplete(false, steps, output);
    return { success: false, output, steps };
  }

  private async callEverFernCloudVision(
    inputContext: string,
    screenshotB64: string,
    history: string[] = [],
    domContext: string = '',
    onlyVision: boolean = false,
  ): Promise<any | null> {
    try {
      const dimensions = await getImageDimensions(screenshotB64);
      const taskMatch = inputContext.match(/Task: (.+?)(?:\n|$)/);
      const objective = taskMatch ? taskMatch[1] : inputContext.substring(0, 200);

      const baseUrl = this.aiClient.getFullConfig().baseUrl || 'https://api.everfern.app/api';
      
      const response = await fetch(`${baseUrl}/navis/vision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.aiClient.apiKey && { 'Authorization': `Bearer ${this.aiClient.apiKey}` })
        },
        body: JSON.stringify({
          screenshot: screenshotB64.startsWith('data:') ? screenshotB64 : `data:image/jpeg;base64,${screenshotB64}`,
          dom: onlyVision ? '' : domContext,
          objective: objective,
          history: history.slice(-8),
          only_vision: onlyVision
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

      console.log('[Navis Extension] EverFern Cloud response received');
      console.log('[Navis Extension] Instruction:', content.substring(0, 150));
      console.log('[Navis Extension] Actions:', actions);

      if (content.toLowerCase().includes('done')) {
        return {
          current_state: {
            evaluation_previous_goal: 'Task completed by EverFern Cloud.',
            memory: 'done',
            next_goal: 'done'
          },
          action: [{ done: { success: true, text: content } }]
        };
      }

      return this._convertTarsActionsToNavisDecision(actions, objective, content, dimensions);
    } catch (err: any) {
      console.error('[Navis Extension] EverFern Cloud vision grounding failed:', err);
      throw err;
    }
  }

  private _convertTarsActionsToNavisDecision(
    tarsActions: string[],
    objective: string,
    instruction: string,
    dimensions: { width: number; height: number } | null
  ): any {
    const navisActions: any[] = [];

    for (const actionStr of tarsActions) {
      const action = this._parseTarsAction(actionStr, dimensions);
      if (action) {
        navisActions.push(action);
      }
    }

    if (navisActions.length === 0) {
      return null;
    }

    return {
      current_state: {
        evaluation_previous_goal: 'Unknown',
        memory: instruction.substring(0, 200),
        next_goal: objective.substring(0, 200)
      },
      action: navisActions
    };
  }

  private _parseTarsAction(actionStr: string, dimensions: { width: number; height: number } | null): any | null {
    actionStr = actionStr.trim();

    const coordMatch = actionStr.match(/(click|double_click|right_click|move|smooth|hover)\s*\((?:[^0-9-]*?(-?\d+)[^0-9-]*?,[^0-9-]*?(-?\d+)[^0-9-]*?)\)/i);
    if (coordMatch) {
      const type = coordMatch[1].toLowerCase();
      let x = parseInt(coordMatch[2]);
      let y = parseInt(coordMatch[3]);

      if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
        // Tars coordinates are physical pixels in the screenshot image.
        // We must normalize them to 0-1000 before sending to browser_click.
        x = Math.max(0, Math.min(1000, Math.round((x / dimensions.width) * 1000)));
        y = Math.max(0, Math.min(1000, Math.round((y / dimensions.height) * 1000)));
      }

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

    if (actionStr.match(/right_click\s*\(\s*\)/i)) {
      return { browser_right_click: { x: 0, y: 0 } };
    }
    if (actionStr.match(/left_click\s*\(\s*\)/i) || actionStr.match(/click\s*\(\s*\)/i)) {
      return { browser_click: { x: 0, y: 0 } };
    }

    const typeMatch = actionStr.match(/type\s*\(\s*(?:content\s*=\s*)?['\"]?(.+?)['\"]?\s*\)/i);
    if (typeMatch) {
      return { browser_type: { text: typeMatch[1] } };
    }

    if (actionStr.match(/ctrl_c/i)) return { press_key: { key: 'Control+C' } };
    if (actionStr.match(/ctrl_v/i)) return { press_key: { key: 'Control+V' } };
    if (actionStr.match(/ctrl_a/i)) return { press_key: { key: 'Control+A' } };
    if (actionStr.match(/ctrl_x/i)) return { press_key: { key: 'Control+X' } };
    if (actionStr.match(/win/i)) return { press_key: { key: 'Meta' } };
    if (actionStr.match(/scroll\s*\(\s*up\s*\)/i)) return { scroll_up: {} };
    if (actionStr.match(/scroll\s*\(\s*down\s*\)/i)) return { scroll_down: {} };

    return null;
  }
}

async function getImageDimensions(screenshotB64: string | null): Promise<{ width: number; height: number } | null> {
  if (!screenshotB64) return null;
  try {
    let cleanB64 = screenshotB64;
    if (cleanB64.startsWith('data:')) {
      const parts = cleanB64.split(',');
      cleanB64 = parts[parts.length - 1];
    }
    const buffer = Buffer.from(cleanB64, 'base64');
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
  } catch (err) {
    console.error('[Navis] Failed to get image dimensions with sharp:', err);
  }
  return null;
}
