/**
 * Navis — Tool Definition
 *
 * Exposes NavisOrchestrator as an AgentTool for the Everfern agent runner.
 * Emits progress events as subagent-progress format for frontend timeline visualization.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTool, ToolResult } from '../../runner/types';
import { NavisOrchestrator } from './agent/orchestrator';
import { NavisExtensionOrchestrator } from './agent/extension-orchestrator';
import { NavisEvent } from './logger';
import { toolSettingsStore } from '../../../store/tool-settings';
import { broadcastNavisCompanionProgress, getNavisCompanionStatus, prepareNavisMainProfileExtension } from './companion-extension';
import { bridgeServer } from '../../../lib/extension-server';

import { checkToolPermission } from '../permission-checker';

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

function writeFindingsFile(task: string, output: string, workspaceDir?: string, toolCallId?: string) {
  try {
    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    const cleanTask = task.replace(/\r?\n/g, ' ').trim();
    const taskTitle = cleanTask.length > 80 ? cleanTask.slice(0, 80) + '...' : cleanTask;
    
    const findingsDir = path.join(os.homedir(), '.everfern');
    if (!fs.existsSync(findingsDir)) {
      fs.mkdirSync(findingsDir, { recursive: true });
    }

    // 1. Update/write the general findings.md (kept for general agent context injection)
    const findingsPath = path.join(findingsDir, 'findings.md');
    try {
      let existingContent = '';
      if (fs.existsSync(findingsPath)) {
        existingContent = fs.readFileSync(findingsPath, 'utf8');
      }

      const title = `# Everfern Web Research Findings\n`;
      let bodyWithoutTitle = existingContent.trim();
      const titleMatchStr = '# Everfern Web Research Findings';
      if (bodyWithoutTitle.startsWith(titleMatchStr)) {
        bodyWithoutTitle = bodyWithoutTitle.slice(titleMatchStr.length).trim();
      }

      const entryHeader = `## [${formattedDate}] Research: ${taskTitle}`;
      const entryBody = `* **Full Task**: ${cleanTask}\n* **Agent Status**: Completed\n\n### Findings\n${output}\n\n---\n`;

      const updatedContent = `${title}\n${entryHeader}\n${entryBody}\n\n${bodyWithoutTitle}`.trim() + '\n';
      fs.writeFileSync(findingsPath, updatedContent, 'utf8');
      console.log(`[Navis Tool] Successfully updated findings to ${findingsPath}`);
    } catch (err) {
      console.error('[Navis Tool] Failed to write global findings.md:', err);
    }

    // 2. Create/write tool-call-specific findings file (findings_${toolCallId}.md)
    if (toolCallId) {
      const specificFindingsPath = path.join(findingsDir, `findings_${toolCallId}.md`);
      const title = `# Everfern Web Research Findings\n`;
      const entryHeader = `## [${formattedDate}] Research: ${taskTitle}`;
      const entryBody = `* **Full Task**: ${cleanTask}\n* **Agent Status**: Completed\n\n### Findings\n${output}\n\n---\n`;
      const specificContent = `${title}\n${entryHeader}\n${entryBody}\n`.trim() + '\n';
      fs.writeFileSync(specificFindingsPath, specificContent, 'utf8');
      console.log(`[Navis Tool] Successfully wrote specific findings to ${specificFindingsPath}`);
    }
  } catch (e) {
    console.error('[Navis Tool] Failed to write findings.md:', e);
  }
}

class NavisMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

const navisMutex = new NavisMutex();

export function createNavisTool(orchestrator: NavisOrchestrator, runner?: any): AgentTool {
  const workspaceDir = runner?.workspaceDir;
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
        startUrl: {
          type: 'string',
          description: 'URL to start at (default: about:blank)',
        },
      },
      required: ['task'],
    },
    async execute(args: any, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
      const release = await navisMutex.acquire();
      try {
        const safeArgs = args && typeof args === 'object' ? args : {};
        const task = typeof safeArgs.task === 'string' ? safeArgs.task.trim() : '';
        const logger = orchestrator.getEventLogger();
        const toolStartTime = Date.now();
        const screenshots: any[] = [];

        console.log('[Navis Tool] 🚀 NAVIS TOOL EXECUTION STARTED');

        const perm = await checkToolPermission('navis', args, onUpdate, emitEvent);
        if (!perm.approved) {
          return {
            success: false,
            output: perm.error || 'Permission denied by user for navis.',
            data: { steps: 0, screenshots }
          };
        }

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

        let navisReportMd = `# Navis Execution Report\n\n**Task:** ${task}\n**Status:** ⏳ Running\n**Started:** ${new Date().toLocaleString()}\n\n## Activity Log\n`;
        const navisDir = path.join(os.homedir(), '.everfern', 'navis');
        try {
          fs.mkdirSync(navisDir, { recursive: true });
        } catch (e) {
          console.error('[Navis Tool] Failed to create navis directory:', e);
        }
        const reportFileName = `${toolCallId || `run_${Date.now()}`}.md`;
        const reportFilePath = path.join(navisDir, reportFileName);

        fs.writeFile(reportFilePath, navisReportMd, 'utf8', (err) => {
          if (err) console.error('[Navis Tool] Error writing initial report:', err);
        });

        let currentStepNumber = -1;

        const unsubscribe = logger.on((event: NavisEvent) => {
          if (event.type === 'screenshot' && event.screenshotKey !== undefined) {
            const b64 = logger.getScreenshot(event.screenshotKey);
            if (b64) {
              screenshots.push({
                base64: b64,
                timestamp: event.timestamp,
                sequenceNumber: event.step
              });
            }
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

          // Update markdown report
          if (event.step !== undefined && event.step !== currentStepNumber) {
            currentStepNumber = event.step;
            navisReportMd += `\n### Step ${currentStepNumber}\n`;
          }

          switch (event.type) {
            case 'browser_launch':
              navisReportMd += `- 🚀 **Browser Launch:** ${event.detail || 'Success'}\n`;
              break;
            case 'thinking':
              navisReportMd += `- 🧠 **Thinking:** ${event.detail || event.action || 'Analyzing page...'}\n`;
              break;
            case 'page_navigate':
              navisReportMd += `- 🌐 **Navigate:** [${event.url}](${event.url})\n`;
              break;
            case 'element_click':
              navisReportMd += `- 👆 **Click:** Clicked "${event.target || 'element'}" \`${event.selector || ''}\`\n`;
              break;
            case 'element_input':
              navisReportMd += `- ⌨️ **Input:** Typed into "${event.target || 'input'}": \`${event.action || ''}\`\n`;
              break;
            case 'scroll':
              navisReportMd += `- 📜 **Scroll:** Scrolled ${event.action || 'down'}\n`;
              break;
            case 'tab_change':
              navisReportMd += `- 📑 **Tab Change:** ${event.action || ''}\n`;
              break;
            case 'extract':
              navisReportMd += `- 📋 **Extracted Content:**\n\n\`\`\`\n${event.detail || ''}\n\`\`\`\n`;
              break;
            case 'wait':
              navisReportMd += `- ⏳ **Wait:** ${event.detail || ''}\n`;
              break;
            case 'ai_decision':
              navisReportMd += `- 🧠 **AI Decision:** ${event.action || ''}\n`;
              break;
            case 'step_complete':
              navisReportMd += `- ✅ **Step Complete:** ${event.detail || ''}\n`;
              break;
            case 'screenshot':
              navisReportMd += `- 🖼️ **Screenshot Captured**\n`;
              break;
            case 'task_complete':
              navisReportMd += `\n## 🏁 Task Complete\n${event.detail || ''}\n`;
              navisReportMd = navisReportMd.replace('**Status:** ⏳ Running', '**Status:** ✅ Completed');
              break;
            case 'error':
              navisReportMd += `\n## ❌ Error\n${event.detail || ''}\n`;
              navisReportMd = navisReportMd.replace('**Status:** ⏳ Running', '**Status:** ❌ Failed');
              break;
          }

          fs.writeFile(reportFilePath, navisReportMd, 'utf8', (err) => {
            if (err) console.error('[Navis Tool] Error writing report update:', err);
          });

          let progressType = mapNavisToProgressType(event.type);
          if (progressType === 'reasoning') {
            const detailText = event.detail || event.action || '';
            if (
              detailText.includes('Choose the next browser action') ||
              detailText.includes('Choosing the next browser action') ||
              detailText.includes('Choosing the next coordinate-based browser action') ||
              (detailText.includes('Reading ') && detailText.includes('DOM refs')) ||
              detailText.includes('Running ') ||
              detailText.includes('Thinking...') ||
              detailText.includes('Analyzing page...')
            ) {
              progressType = 'step';
            }
          }
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
            navisReport: navisReportMd,
          };

          broadcastNavisCompanionProgress(compactProgressData);

          if (emitEvent) {
            emitEvent({
              type: 'subagent-progress',
              toolCallId: toolCallId || '',
              timestamp: new Date(event.timestamp).toISOString(),
              data: {
                ...compactProgressData,
                content: event.type === 'screenshot' && event.screenshotKey !== undefined ? logger.getScreenshot(event.screenshotKey) : (event.detail || (progressType === 'reasoning' ? event.action : undefined)),
                screenshot: event.type === 'screenshot' && event.screenshotKey !== undefined ? { base64: logger.getScreenshot(event.screenshotKey), width: 1280, height: 720 } : undefined,
                navisReport: navisReportMd,
              }
            });
          }
        });

        // Read Navis settings from the persistent store
        const navisSettings = toolSettingsStore.get().navis;
        
        // Lock down launcher mode to respect user settings:
        // If extension-first is selected in settings, always force extension-first.
        // Do not allow model/safeArgs override to switch to playwright.
        const automationMode: 'extension-first' | 'playwright' =
          navisSettings.automationMode === 'extension-first'
            ? 'extension-first'
            : (safeArgs.automationMode === 'extension-first' || safeArgs.automationMode === 'playwright'
                ? safeArgs.automationMode
                : navisSettings.automationMode);

        try {
          // Set the active session in the bridge server so the companion extension knows a task is running
          bridgeServer.setSession(toolCallId || 'navis', safeArgs.startUrl || '', 'Navis Active');

          const shouldUseExtensionFirst =
            automationMode === 'extension-first';

          if (shouldUseExtensionFirst) {
            const status = getNavisCompanionStatus();
            if (!status.connected) {
              onUpdate?.('Preparing Navis extension install folder for fast main-profile control...');
              const extensionResult = await prepareNavisMainProfileExtension(navisSettings.selectedBrowserId || 'chrome', safeArgs.startUrl);
              onUpdate?.(extensionResult.message);
              if (!extensionResult.connected) {
                const executionTime = Date.now() - toolStartTime;
                console.log(`[Navis Tool] Extension not connected after ${executionTime}ms; stopping instead of profile-browser fallback.`);
                return {
                  success: false,
                  output: extensionResult.message,
                  data: {
                    steps: 0,
                    screenshots,
                    automationMode: 'extension-first',
                    extensionPath: extensionResult.extensionPath,
                    browserEngine: extensionResult.browserEngine,
                    installInstructions: extensionResult.installInstructions,
                  },
                };
              }
            } else {
              onUpdate?.('Navis extension is connected. Using extension-first browser control.');
            }

            if (getNavisCompanionStatus().connected) {
              const extensionOrchestrator = new NavisExtensionOrchestrator(
                orchestrator.getAIClient(),
                logger,
                orchestrator.getVisionClient() || undefined
              );
              console.log('[Navis Tool] 🔌 Calling extension-first orchestrator.run()...');
              const extensionResult = await extensionOrchestrator.run({
                task,
                maxSteps: safeArgs.maxSteps ?? navisSettings.maxSteps,
                headless: safeArgs.headless ?? navisSettings.headless,
                startUrl: safeArgs.startUrl,
                useVision: Boolean(navisSettings.useVision),
                onlyVision: Boolean(navisSettings.onlyVision),
                forceVision: Boolean(safeArgs.forceVision),
                useChromeProfile: true,
                selectedBrowserId: navisSettings.selectedBrowserId,
                useIsolatedBrowser: false,
                maxActionsPerStep: safeArgs.maxActionsPerStep,
              });

              if (extensionResult.success || !extensionResult.output.includes('[EXTENSION_FALLBACK_REQUIRED]')) {
                const executionTime = Date.now() - toolStartTime;
                console.log(`[Navis Tool] ✅ extension-first run completed in ${executionTime}ms`);
                writeFindingsFile(task, extensionResult.output, workspaceDir, toolCallId);
                return {
                  success: extensionResult.success,
                  output: extensionResult.output,
                  data: { steps: extensionResult.steps, screenshots, automationMode: 'extension-first' },
                };
              }

              onUpdate?.('Extension-first path could not complete this action. Install/update the Navis extension or switch Navis to isolated browser mode.');
              writeFindingsFile(task, extensionResult.output.replace('[EXTENSION_FALLBACK_REQUIRED]', 'Navis extension-first stopped:'), workspaceDir, toolCallId);
              return {
                success: false,
                output: extensionResult.output.replace('[EXTENSION_FALLBACK_REQUIRED]', 'Navis extension-first stopped:'),
                data: { steps: extensionResult.steps, screenshots, automationMode: 'extension-first' },
              };
            } else {
              const extensionResult = await prepareNavisMainProfileExtension(navisSettings.selectedBrowserId || 'chrome', safeArgs.startUrl);
              return {
                success: false,
                output: extensionResult.message,
                data: {
                  steps: 0,
                  screenshots,
                  automationMode: 'extension-first',
                  extensionPath: extensionResult.extensionPath,
                  browserEngine: extensionResult.browserEngine,
                  installInstructions: extensionResult.installInstructions,
                },
              };
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
            onlyVision: Boolean(navisSettings.onlyVision),
            forceVision: Boolean(safeArgs.forceVision),
            useChromeProfile: false,
            selectedBrowserId: navisSettings.selectedBrowserId,
            useIsolatedBrowser: true,
          });

          const executionTime = Date.now() - toolStartTime;
          console.log(`[Navis Tool] ✅ orchestrator.run() COMPLETED - Total execution time: ${executionTime}ms`);
          console.log(`[Navis Tool] ✅ NAVIS TOOL RETURNING RESULT TO MAIN AGENT - Success: ${result.success}, Steps: ${result.steps}`);

          writeFindingsFile(task, result.output, workspaceDir, toolCallId);

          return {
            success: result.success,
            output: result.output,
            data: { steps: result.steps, screenshots, automationMode: 'playwright-isolated' },
          };
        } catch (toolErr) {
          const executionTime = Date.now() - toolStartTime;
          console.error(`[Navis Tool] ❌ NAVIS TOOL EXECUTION FAILED (${executionTime}ms):`, toolErr);
          logger.error(`[Navis Tool] ❌ NAVIS TOOL EXECUTION FAILED (${executionTime}ms): ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`);

          throw toolErr;
        } finally {
          bridgeServer.setSession(null);
          unsubscribe();
        }
      } finally {
        release();
      }
    },
  };
}
