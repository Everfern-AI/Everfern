import type { AIClient } from '../../../lib/ai-client';
import { loadPrompt } from '../../../lib/prompt-sync';
import { globalAbortManager } from '../../runner/abort-manager';
import { NAVIS_DECISION_SCHEMA, type NavisOptions, type NavisResult } from './orchestrator';
import { ExtensionBrowserAdapter, type BrowserPageState } from './browser-control-adapter';
import { compressHistory } from './ai-optimization';
import { NavisLogger } from './logger';
import type { ActionName } from './actions';

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

    while (steps <= maxSteps) {
      if (globalAbortManager.streamAborted) {
        this.logger.error('Execution aborted by user');
        return { success: false, output: 'Execution aborted by user', steps };
      }

      const state = await this.adapter.capture();
      const elements = formatRefs(state);
      const dom = semanticDom(state);
      const finalTurn = steps === maxSteps
        ? '\nLAST STEP: return a done action now. Do not navigate or click.'
        : '';

      this.logger.thinking(
        steps + 1,
        maxSteps,
        `Reading ${state.refs.length} DOM refs on ${state.title || state.url || 'the active tab'}.`,
        { url: state.url, title: state.title, refs: state.refs.length, mode: 'extension-first' },
      );
      this.logger.thinking(
        steps + 1,
        maxSteps,
        'Choosing the next browser action from the DOM snapshot.',
        { url: state.url, title: state.title, refs: state.refs.length, mode: 'extension-first', phase: 'decision' },
      );

      const userPrompt = [
        `Task: ${task}`,
        `Current Step: ${steps + 1}/${maxSteps}`,
        `History:\n${compressHistory(history) || 'None yet'}`,
        `Current Tab: ${state.url} (${state.title})`,
        `Open Tabs:\n${tabsText(state.tabs)}`,
        'Interactive elements:',
        elements,
        'DOM Grounding Context:',
        dom,
        `Vision Grounding: ${forceVision ? 'allowed if absolutely required' : 'disabled by default; only set request_vision=true if DOM refs are unusable'}`,
        lastResult ? `Last result: ${lastResult}` : '',
        finalTurn,
      ].filter(Boolean).join('\n');

      let decision: any;
      try {
        const response = await this.aiClient.chat({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          responseFormat: 'json',
          jsonSchema: NAVIS_DECISION_SCHEMA,
        });
        const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        decision = extractJson(raw);
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

    const output = lastResult || 'Navis reached the step limit before producing a final answer.';
    this.logger.taskComplete(false, steps, output);
    return { success: false, output, steps };
  }
}
