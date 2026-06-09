/**
 * Navis — Tool Definition
 *
 * Exposes NavisOrchestrator as an AgentTool for the Everfern agent runner.
 * Emits progress events as subagent-progress format for frontend timeline visualization.
 */

import type { AgentTool, ToolResult } from '../../runner/types';
import { NavisOrchestrator } from './orchestrator';
import { NavisExtensionOrchestrator } from './extension-orchestrator';
import { NavisEvent } from './logger';
import { toolSettingsStore } from '../../../store/tool-settings';
import { broadcastNavisCompanionProgress, getNavisCompanionStatus, prepareNavisMainProfileExtension } from './companion-extension';

type SubAgentProgressEventType = 'step' | 'reasoning' | 'action' | 'screenshot' | 'complete' | 'abort';

function mapNavisToProgressType(navisType: string): SubAgentProgressEventType {
  switch (navisType) {
    case 'browser_launch': return 'step';
    case 'thinking': return 'reasoning';
    case 'page_navigate': return 'action';
    case 'element_click': return 'action';
    case 'element_input': return 'action';
    case 'scroll': return 'action';
    case 'tab_change': return 'action';
    case 'extract': return 'action';
    case 'wait': return 'step';
    case 'ai_decision': return 'reasoning';
    case 'step_complete': return 'step';
    case 'screenshot': return 'screenshot';
    case 'task_complete': return 'complete';
    case 'error': return 'abort';
    default: return 'step';
  }
}

function buildActionPayload(event: NavisEvent): { type: string; params: Record<string, unknown>; description: string } | undefined {
  switch (event.type) {
    case 'page_navigate':
      return { type: 'navigate', params: { url: event.url }, description: `Navigating to ${event.url || '...'}` };
    case 'element_click':
      return { type: 'left_click', params: { target: event.target, selector: event.selector, position: event.position, coordinate: event.position ? [event.position.x, event.position.y] : undefined }, description: `Clicked "${event.target || 'element'}"` };
    case 'element_input':
      return { type: 'type', params: { target: event.target, text: event.action, coordinate: event.position ? [event.position.x, event.position.y] : undefined }, description: `Typing into "${event.target || 'input'}"` };
    case 'scroll':
      return { type: 'scroll', params: { direction: event.action }, description: `Scrolled ${event.action || 'down'}` };
    case 'tab_change':
      return { type: 'tab', params: { detail: event.action }, description: `Tab changed — ${event.action || ''}` };
    case 'extract':
      return { type: 'extract', params: { detail: event.detail }, description: 'Extracted content from page' };
    default:
      return undefined;
  }
}

export function createNavisTool(orchestrator: NavisOrchestrator): AgentTool {
  return {
    name: 'navis',
    description:
      'Autonomous browser automation engine. Opens a real browser, navigates websites, ' +
      'clicks elements, fills forms, extracts content. Use Navis for browser workflows and ' +
      'deep page investigation: listings, booking flows, web forms, login/session-dependent pages, ' +
      'multi-page comparison, extracting structured details from pages, Gmail and other web apps, ' +
      'and research that requires actually opening and reading websites. Use web_search instead for quick lookup questions, ' +
      'finding links, or getting a fast answer from search snippets. Navis is DOM-first with optional ' +
      'vision grounding; do not use forceVision unless the DOM is unusable, the page is a visual canvas/image-only UI, or visual layout matters. ' +
      'IMPORTANT RULE: Do NOT spawn multiple Navis agents sequentially for the same overall research or task. ' +
      'First, determine ALL the information you need, then provide a single comprehensive "task" to Navis asking it to search across multiple sites at once. ' +
      'Navis is smart and will browse multiple pages, compile all the information, and return it in one go. ' +
      'Navis will actively avoid hallucinating information from useless websites and report failures clearly if the data cannot be found.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The browser task to accomplish. Be specific: include URLs, credentials, form values.',
        },
        maxSteps: {
          type: 'number',
          description: 'Maximum number of AI decision steps (default: 25)',
        },
        headless: {
          type: 'boolean',
          description: 'Run browser in headless mode (default: false — visible browser)',
        },
        forceVision: {
          type: 'boolean',
          description: 'Last-resort visual fallback. Leave false for normal Navis runs; DOM extraction is much faster.',
        },
        automationMode: {
          type: 'string',
          enum: ['extension-first', 'playwright'],
          description: 'Optional manual override. extension-first uses the companion browser extension when connected; playwright uses the isolated/CDP fallback.',
        },
        startUrl: {
          type: 'string',
          description: 'URL to start at (default: about:blank)',
        },
      },
      required: ['task'],
    },
    async execute(args: any, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
      const safeArgs = args && typeof args === 'object' ? args : {};
      const task = typeof safeArgs.task === 'string' ? safeArgs.task.trim() : '';
      const logger = orchestrator.getEventLogger();
      const toolStartTime = Date.now();
      const screenshots: any[] = [];

      console.log('[Navis Tool] 🚀 NAVIS TOOL EXECUTION STARTED');

      if (!task) {
        const output = 'Navis requires a non-empty task string. The model called navis without task details.';
        console.warn(`[Navis Tool] ${output}`);
        onUpdate?.(`❌ ${output}`);
        return {
          success: false,
          output,
          data: { steps: 0, screenshots },
        };
      }

      const unsubscribe = logger.on((event: NavisEvent) => {
        if (event.type === 'screenshot' && event.base64) {
          screenshots.push({
            base64: event.base64,
            timestamp: event.timestamp,
            sequenceNumber: event.step
          });
        }
        let label = '';
        switch (event.type) {
          case 'browser_launch': label = '🚀 Browser launched'; break;
          case 'thinking': label = `🧠 ${event.detail || event.action || 'Thinking...'}`; break;
          case 'page_navigate': label = `🌐 Navigating to ${event.url || '...'}`; break;
          case 'element_click': label = `👆 Clicked "${event.target || 'element'}"`; break;
          case 'element_input': label = `⌨️ Typing "${event.action || ''}"`; break;
          case 'scroll': label = `📜 Scrolled ${event.action || 'down'}`; break;
          case 'tab_change': label = `📑 ${event.action || 'Tab changed'}`; break;
          case 'extract': label = `📋 Extracted content`; break;
          case 'ai_decision': label = `🧠 Decided: ${event.action || '...'}`; break;
          case 'step_complete': label = `✅ Step ${event.step}/${event.maxSteps} done`; break;
          case 'task_complete': label = `🏁 Task complete — ${event.detail || ''}`; break;
          case 'error': label = `❌ ${event.detail || 'Error'}`; break;
          default: label = event.detail || event.action || event.type;
        }

        onUpdate?.(label);

        const progressType = mapNavisToProgressType(event.type);
        const actionPayload = buildActionPayload(event);
        const compactProgressData = {
          type: progressType,
          toolCallId: toolCallId || '',
          timestamp: new Date(event.timestamp).toISOString(),
          stepNumber: event.step,
          totalSteps: event.maxSteps,
          content: event.type === 'screenshot'
            ? 'Screenshot captured for visual grounding.'
            : (event.detail || (progressType === 'reasoning' ? event.action : undefined)),
          action: actionPayload,
          timelineBranch: {
            agentType: 'navis' as const,
            branchStatus: event.type === 'error' ? 'failed' : event.type === 'task_complete' ? 'completed' : 'running',
            taskDescription: task,
          },
          metadata: event.metadata,
        };

        broadcastNavisCompanionProgress(compactProgressData);

        if (emitEvent) {
          emitEvent({
            type: 'subagent-progress',
            toolCallId: toolCallId || '',
            timestamp: new Date(event.timestamp).toISOString(),
            data: {
              ...compactProgressData,
              content: event.type === 'screenshot' ? event.base64 : (event.detail || (progressType === 'reasoning' ? event.action : undefined)),
              screenshot: event.type === 'screenshot' ? { base64: event.base64, width: 1280, height: 720 } : undefined,
            }
          });
        }
      });

      // Read Navis settings from the persistent store
      const navisSettings = toolSettingsStore.get().navis;
      const requestedAutomationMode =
        safeArgs.automationMode === 'playwright' || safeArgs.automationMode === 'extension-first'
          ? safeArgs.automationMode
          : navisSettings.automationMode;
      const automationMode = requestedAutomationMode || (navisSettings.useChromeProfile && !navisSettings.useIsolatedBrowser ? 'extension-first' : 'playwright');

      try {
        const shouldUseExtensionFirst =
          automationMode === 'extension-first' &&
          navisSettings.useChromeProfile &&
          !navisSettings.useIsolatedBrowser;

        if (shouldUseExtensionFirst) {
          const status = getNavisCompanionStatus();
          if (!status.connected) {
            onUpdate?.('Preparing Navis companion extension for fast main-profile control...');
            const extensionResult = await prepareNavisMainProfileExtension(navisSettings.selectedBrowserId || 'chrome', safeArgs.startUrl);
            onUpdate?.(extensionResult.message);
          } else {
            onUpdate?.('Navis companion extension is connected. Using extension-first browser control.');
          }

          if (getNavisCompanionStatus().connected) {
            const extensionOrchestrator = new NavisExtensionOrchestrator(orchestrator.getAIClient(), logger);
            console.log('[Navis Tool] 🔌 Calling extension-first orchestrator.run()...');
            const extensionResult = await extensionOrchestrator.run({
              task,
              maxSteps: safeArgs.maxSteps ?? navisSettings.maxSteps,
              headless: safeArgs.headless ?? navisSettings.headless,
              startUrl: safeArgs.startUrl,
              useVision: Boolean(navisSettings.useVision),
              forceVision: Boolean(safeArgs.forceVision),
              useChromeProfile: true,
              selectedBrowserId: navisSettings.selectedBrowserId,
              useIsolatedBrowser: false,
              maxActionsPerStep: safeArgs.maxActionsPerStep,
            });

            if (extensionResult.success || !extensionResult.output.includes('[EXTENSION_FALLBACK_REQUIRED]')) {
              const executionTime = Date.now() - toolStartTime;
              console.log(`[Navis Tool] ✅ extension-first run completed in ${executionTime}ms`);
              return {
                success: extensionResult.success,
                output: extensionResult.output,
                data: { steps: extensionResult.steps, screenshots, automationMode: 'extension-first' },
              };
            }

            onUpdate?.('Extension-first path could not complete this action. Falling back to isolated Playwright automation.');
            logger.thinking(undefined, undefined, 'Extension-first fallback triggered; switching to isolated Playwright automation.', { mode: 'playwright-fallback' });
          } else {
            onUpdate?.('Navis companion extension is not connected. Falling back to isolated Playwright automation.');
            logger.thinking(undefined, undefined, 'Companion extension unavailable; using isolated Playwright fallback.', { mode: 'playwright-fallback' });
          }
        }

        console.log('[Navis Tool] 🔄 Calling orchestrator.run()...');

        const result = await orchestrator.run({
          task,
          maxSteps: safeArgs.maxSteps ?? navisSettings.maxSteps,
          headless: safeArgs.headless ?? navisSettings.headless,
          startUrl: safeArgs.startUrl,
          // Navis is DOM-first. The vision setting enables on-demand visual
          // grounding, but the orchestrator still uses DOM unless visual context
          // is requested or the DOM snapshot is weak.
          useVision: Boolean(navisSettings.useVision),
          forceVision: Boolean(safeArgs.forceVision),
          useChromeProfile: automationMode === 'playwright' ? navisSettings.useChromeProfile : false,
          selectedBrowserId: navisSettings.selectedBrowserId,
          useIsolatedBrowser: automationMode === 'playwright' ? navisSettings.useIsolatedBrowser : true,
        });

        const executionTime = Date.now() - toolStartTime;
        console.log(`[Navis Tool] ✅ orchestrator.run() COMPLETED - Total execution time: ${executionTime}ms`);
        console.log(`[Navis Tool] ✅ NAVIS TOOL RETURNING RESULT TO MAIN AGENT - Success: ${result.success}, Steps: ${result.steps}`);

        return {
          success: result.success,
          output: result.output,
          data: { steps: result.steps, screenshots, automationMode: automationMode === 'playwright' ? 'playwright' : 'playwright-fallback' },
        };
      } catch (toolErr) {
        const executionTime = Date.now() - toolStartTime;
        console.error(`[Navis Tool] ❌ NAVIS TOOL EXECUTION FAILED (${executionTime}ms):`, toolErr);
        logger.error(`[Navis Tool] ❌ NAVIS TOOL EXECUTION FAILED (${executionTime}ms): ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`);

        throw toolErr;
      } finally {
        unsubscribe();
      }
    },
  };
}
