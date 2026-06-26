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

OPERATING MODE: DOM-FIRST. You receive live DOM snapshots with interactive element refs ([ref=eN]) every step.
- ALWAYS use DOM refs (click_element, input_text, smart_click etc.) for interactions — they are precise and reliable.
- Only set current_state.request_vision=true when DOM refs are genuinely insufficient: e.g., canvas elements, visual CAPTCHAs, heavily overlapping UI, or image-based content with no accessible text.
- Requesting vision costs an extra AI call — use it sparingly and only when it will actually help.

Complete the task with actions and return strict JSON.
Actions: go_to_url, go_back, click_element, click_text, smart_click, input_text, smart_type, press_key, scroll_down, scroll_up, wait, wait_for_navigation, extract_content, open_tab, switch_tab, close_tab, done.`;

function loadExtensionPrompt(): string {
  const rawPrompt = loadPrompt('NAVIS.md');
  if (!rawPrompt) return FALLBACK_EXTENSION_SYSTEM_PROMPT;
  const systemMatch = rawPrompt.match(/SYSTEM_PROMPT = """\\?\s*([\s\S]*?)"""/);
  if (!systemMatch) {
    console.warn('[Navis] Warning: Failed to parse SYSTEM_PROMPT from NAVIS.md. Falling back to default system prompt.');
    return FALLBACK_EXTENSION_SYSTEM_PROMPT;
  }
  return systemMatch[1].trim();
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
  // Strip rect, selector, disabled to save massive amounts of JSON tokens
  const refs = (Array.isArray(state.refs) ? state.refs : []).map(r => ({
    ref: r.ref,
    tag: r.tag,
    role: r.role,
    name: clamp(r.name, 90),
    type: r.type,
    href: clamp(r.href, 120),
    placeholder: clamp(r.placeholder, 70),
  }));
  return JSON.stringify({
    mode: 'extension-first',
    page: {
      url: state.url,
      title: state.title,
      refsAvailable: refs.length,
    },
    // We omit visibleInteractive array here to avoid duplicating formatRefs
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
  // Cap at 6 tabs to avoid prompt bloat, prioritizing the active tab
  const displayTabs = tabs.slice(0, 6);
  return displayTabs.map((tab, index) => {
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
          : 'Choosing the next browser action from the DOM snapshot and vision context.',
        { url: state.url, title: state.title, refs: onlyVision ? 0 : state.refs.length, mode: 'extension-first', phase: 'decision' },
      );

      const visionAvailable = Boolean(useVision || forceVision || onlyVision);
      const historyStr = compressHistory(history);

      // ALWAYS capture screenshot for every step (User requested visual context to prevent misclicks)
      let screenshotB64: string | null = null;
      try {
        screenshotB64 = await this.adapter.screenshot({ quality: 75 });
        const isSvg = screenshotB64.includes('svg+xml') || screenshotB64.includes('%3Csvg') || screenshotB64.includes('<svg');
        if (isSvg) {
          screenshotB64 = null;
          console.warn('[Navis Extension] Vision screenshot was SVG (restricted page), skipping vision.');
        } else {
          console.log('[Navis Extension] 🖼️ Sending vision screenshot to AI to prevent misclicking.');
          this.logger.screenshot(steps, maxSteps, screenshotB64);
        }
      } catch (err) {
        console.warn('[Navis Extension] Vision screenshot capture failed:', err);
      }

      const visionInstructions = screenshotB64 ? `
VISION GROUNDING ACTIVE — You are seeing a screenshot plus DOM context for the browser page.

VISUAL ANALYSIS INSTRUCTIONS:
1. DOM FIRST: Use refs, labels, hrefs, input types, and form metadata from the DOM context as the action source.
   Use the screenshot to disambiguate visual layout, overlays, missing refs, and canvas/custom UI.
2. MATCH VISUALS TO REFS: Identify elements in the screenshot and match them to ref IDs for precise actions. DO NOT click blindly on elements without verifying their location.
3. POPUPS & OVERLAYS: If you see cookie banners, modals, login popups, or consent dialogs overlaying the content — dismiss them FIRST.
4. LOADING STATES: If the page appears to be loading (spinners), use the wait action.` : '';

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
        visionInstructions || 'Vision: disabled. Rely exclusively on DOM refs and extract_content.',
        lastResult ? `Last result: ${lastResult}` : '',
        finalTurn,
      ].filter(Boolean).join('\n');

      let decision: any = await this.askAI(systemPrompt, userPrompt, screenshotB64, dom, state.refs, state.snapshot?.viewport);

        steps += 1;
        const nextGoal = clamp(decision?.current_state?.next_goal || 'Choose the next browser action', 240);
        this.logger.aiDecision(steps, maxSteps, nextGoal);

        const actions = Array.isArray(decision?.action) ? decision.action.slice(0, maxActionsPerStep) : [];
        if (actions.length === 0) {
          lastResult = 'AI returned no actions; retrying with the current DOM.';
          history.push(`Step ${steps}: ${lastResult}`);
          continue;
        }

        let navigationOccurred = false;
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
          
          if (actionName === 'go_to_url' || actionName === 'go_back') {
            navigationOccurred = true;
          }

          if (result.stateChanged) break;
        }

        // Wait for page stabilization after navigation before next DOM capture
        if (navigationOccurred) {
          this.logger.wait(steps, maxSteps, 'Waiting for page load after navigation');
          await this.adapter.executeAction('wait_for_navigation', { timeoutMs: 3000 }, steps, maxSteps);
        }
      }
    } catch (err) {
      // Global error boundary
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Navis task failed due to an error: ${errMsg}`);
      return { success: false, output: `Task failed: ${errMsg}`, steps };
    } finally {
      bridgeServer.setSession(null);
    }

    const output = lastResult || 'Navis reached the step limit before producing a final answer.';
    this.logger.taskComplete(false, steps, output);
    return { success: false, output, steps };
  }

  private async askAI(
    systemPrompt: string,
    userPrompt: string,
    screenshotB64: string | null,
    domContext: string,
    refs: any[] = [],
    viewport?: { width: number; height: number } | null,
  ): Promise<any> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (this.aiClient.provider === 'everfern') {
          return await this.callEverFernCloudVision(userPrompt, screenshotB64, [], domContext, refs, viewport);
        }

        let response;
        if (screenshotB64) {
          const imgSizeKB = Math.round((screenshotB64.length * 3) / 4 / 1024);
          const detail = imgSizeKB > 200 ? 'high' : 'low';
          response = await this.aiClient.chat({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: screenshotB64.startsWith('data:') ? screenshotB64 : `data:image/jpeg;base64,${screenshotB64}`,
                      detail: detail as 'low' | 'high',
                    },
                  },
                  { type: 'text', text: userPrompt },
                ],
              },
            ],
            temperature: 0.1,
            responseFormat: 'json',
            jsonSchema: NAVIS_DECISION_SCHEMA,
            abortSignal: globalAbortManager.abortController.signal,
          });
        } else {
          response = await this.aiClient.chat({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            responseFormat: 'json',
            jsonSchema: NAVIS_DECISION_SCHEMA,
            abortSignal: globalAbortManager.abortController.signal,
          });
        }
        const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        return extractJson(raw);
      } catch (err: any) {
        if (globalAbortManager.streamAborted) throw err;
        
        const isTransient = err?.status === 429 || err?.status >= 500 || err?.message?.includes('network') || err?.message?.includes('timeout');
        if (isTransient && attempt < maxRetries) {
          const delay = (attempt + 1) * 1500;
          console.warn(`[Navis] Transient AI error, retrying in ${delay}ms... (${err.message})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  private async callEverFernCloudVision(
    inputContext: string,
    screenshotB64: string | null,
    history: string[] = [],
    domContext: string = '',
    refs: any[] = [],
    viewport?: { width: number; height: number } | null,
  ): Promise<any | null> {
    try {
      const taskMatch = inputContext.match(/Task: (.+?)(?:\n|$)/);
      const objective = taskMatch ? taskMatch[1] : inputContext.substring(0, 200);

      const baseUrl = this.aiClient.getFullConfig().baseUrl || 'https://api.everfern.app/api';
      
      const hasCoordinateActionsInitially = true; // assume yes to get dimensions early for payload
      const dimensions = await getImageDimensions(screenshotB64);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.aiClient.apiKey && { 'Authorization': `Bearer ${this.aiClient.apiKey}` })
        },
        body: JSON.stringify({
          screenshot: screenshotB64
            ? (screenshotB64.startsWith('data:') ? screenshotB64 : `data:image/jpeg;base64,${screenshotB64}`)
            : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          dom: domContext,
          objective: objective,
          history: history.slice(-8),
          only_vision: false,
          refs: refs.map(r => ({
            ref: r.ref,
            rect: r.rect,
            pos: r.pos,
            tag: r.tag,
            name: r.name,
            role: r.role
          })),
          viewport: viewport,
          dimensions: dimensions
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

      return this._convertTarsActionsToNavisDecision(actions, objective, content, dimensions, refs, viewport);
    } catch (err: any) {
      console.error('[Navis Extension] EverFern Cloud vision grounding failed:', err);
      throw err;
    }
  }

  private _convertTarsActionsToNavisDecision(
    tarsActions: string[],
    objective: string,
    instruction: string,
    dimensions: { width: number; height: number } | null,
    refs: any[] = [],
    viewport?: { width: number; height: number } | null
  ): any {
    const navisActions: any[] = [];

    for (const actionStr of tarsActions) {
      const action = this._parseTarsAction(actionStr, dimensions, refs, viewport);
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

  private _parseTarsAction(
    actionStr: string,
    dimensions: { width: number; height: number } | null,
    refs: any[] = [],
    viewport?: { width: number; height: number } | null
  ): any | null {
    actionStr = actionStr.trim();

    const refMatch = actionStr.match(/(click|click_element|hover|double_click|right_click)\s*\(\s*(?:ref\s*=\s*)?['\"]?(e\d+)['\"]?\s*\)/i);
    if (refMatch) {
      const type = refMatch[1].toLowerCase();
      const ref = refMatch[2];
      console.log(`[Navis TARS Mapping] Cloud API mapped ref action: ${actionStr}`);
      if (type === 'hover') {
        return { hover: { ref } };
      }
      if (type === 'right_click') {
        return { right_click: { ref } };
      }
      return { click_element: { ref } };
    }

    const coordMatch = actionStr.match(/(click|double_click|right_click|move|smooth|hover)\s*\((?:[^0-9-]*?(-?\d+)[^0-9-]*?,[^0-9-]*?(-?\d+)[^0-9-]*?)\)/i);
    if (coordMatch) {
      const type = coordMatch[1].toLowerCase();
      const rawX = parseInt(coordMatch[2]);
      const rawY = parseInt(coordMatch[3]);

      let normX = rawX;
      let normY = rawY;
      if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
        // Tars coordinates are physical pixels in the screenshot image.
        // We must normalize them to 0-1000 before sending to browser_click.
        normX = Math.max(0, Math.min(1000, Math.round((rawX / dimensions.width) * 1000)));
        normY = Math.max(0, Math.min(1000, Math.round((rawY / dimensions.height) * 1000)));
      }

      // Try to find a DOM element ref at or near the clicked coordinate
      if (['click', 'double_click', 'right_click', 'hover'].includes(type) && refs.length > 0) {
        // Calculate the physical viewport coordinate from the screenshot coordinate (rawX, rawY)
        let vx = rawX;
        let vy = rawY;
        if (viewport && dimensions && dimensions.width > 0 && dimensions.height > 0) {
          const scaleX = viewport.width / dimensions.width;
          const scaleY = viewport.height / dimensions.height;
          vx = rawX * scaleX;
          vy = rawY * scaleY;
        } else {
          const vWidth = viewport?.width || 1280;
          const vHeight = viewport?.height || 720;
          vx = (normX / 1000) * vWidth;
          vy = (normY / 1000) * vHeight;
        }

        let bestRef: any = null;
        let minDistance = Infinity;

        for (const r of refs) {
          if (r.rect) {
            const rect = r.rect;
            const left = rect.x;
            const right = rect.x + rect.width;
            const top = rect.y;
            const bottom = rect.y + rect.height;

            if (vx >= left && vx <= right && vy >= top && vy <= bottom) {
              bestRef = r;
              break;
            }

            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            const dist = Math.hypot(vx - centerX, vy - centerY);
            if (dist < minDistance && dist < 45) {
              minDistance = dist;
              bestRef = r;
            }
          } else if (r.pos) {
            const centerX = (r.pos.x / 1000) * (viewport?.width || 1280);
            const centerY = (r.pos.y / 1000) * (viewport?.height || 720);
            const dist = Math.hypot(vx - centerX, vy - centerY);
            if (dist < minDistance && dist < 45) {
              minDistance = dist;
              bestRef = r;
            }
          }
        }

        if (bestRef && bestRef.ref) {
          console.log(`[Navis TARS Mapping] Mapped coordinate click (${rawX}, ${rawY}) to DOM ref "${bestRef.ref}" (${bestRef.name || bestRef.tag})`);
          if (type === 'hover') {
            return { browser_hover: { x: normX, y: normY } };
          }
          return { click_element: { ref: bestRef.ref } };
        }
      }

      switch (type) {
        case 'double_click':
          return { browser_double_click: { x: normX, y: normY } };
        case 'right_click':
          return { browser_right_click: { x: normX, y: normY } };
        case 'move':
        case 'smooth':
        case 'hover':
          return { browser_hover: { x: normX, y: normY } };
        default:
          return { browser_click: { x: normX, y: normY } };
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
      // Reject SVG data-URLs immediately — sharp cannot decode them
      if (cleanB64.startsWith('data:image/svg')) return null;
      const parts = cleanB64.split(',');
      cleanB64 = parts[parts.length - 1];
    }
    const buffer = Buffer.from(cleanB64, 'base64');
    // Quick magic-byte check before handing to sharp
    // JPEG: FF D8 FF  |  PNG: 89 50 4E 47  |  WebP: 52 49 46 46
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
    const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
    if (!isJpeg && !isPng && !isWebp) {
      console.warn('[Navis] Skipping image dimensions — unrecognised format (likely SVG or error image)');
      return null;
    }
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
  } catch (err) {
    console.warn('[Navis] Failed to get image dimensions, skipping dimension check:', (err as Error)?.message || err);
  }
  return null;
}
