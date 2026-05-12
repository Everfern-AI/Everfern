"use strict";
/**
 * Navis — Tool Definition
 *
 * Exposes NavisOrchestrator as an AgentTool for the Everfern agent runner.
 * Emits progress events as subagent-progress format for frontend timeline visualization.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNavisTool = createNavisTool;
const tool_settings_1 = require("../../../store/tool-settings");
function mapNavisToProgressType(navisType) {
    switch (navisType) {
        case 'browser_launch': return 'step';
        case 'page_navigate': return 'action';
        case 'element_click': return 'action';
        case 'element_input': return 'action';
        case 'scroll': return 'action';
        case 'tab_change': return 'action';
        case 'extract': return 'action';
        case 'wait': return 'step';
        case 'ai_decision': return 'reasoning';
        case 'step_complete': return 'step';
        case 'task_complete': return 'complete';
        case 'error': return 'abort';
        default: return 'step';
    }
}
function buildActionPayload(event) {
    switch (event.type) {
        case 'page_navigate':
            return { type: 'navigate', params: { url: event.url }, description: `Navigating to ${event.url || '...'}` };
        case 'element_click':
            return { type: 'left_click', params: { target: event.target, selector: event.selector, position: event.position }, description: `Clicked "${event.target || 'element'}"` };
        case 'element_input':
            return { type: 'type', params: { target: event.target, text: event.action }, description: `Typing into "${event.target || 'input'}"` };
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
function createNavisTool(orchestrator) {
    return {
        name: 'navis',
        description: 'Autonomous browser automation engine. Opens a real browser, navigates websites, ' +
            'clicks elements, fills forms, extracts content. Use for tasks that require interacting ' +
            'with web pages. ' +
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
                startUrl: {
                    type: 'string',
                    description: 'URL to start at (default: about:blank)',
                },
            },
            required: ['task'],
        },
        async execute(args, onUpdate, emitEvent, toolCallId) {
            const logger = orchestrator.getEventLogger();
            logger.on((event) => {
                let label = '';
                switch (event.type) {
                    case 'browser_launch':
                        label = '🚀 Browser launched';
                        break;
                    case 'page_navigate':
                        label = `🌐 Navigating to ${event.url || '...'}`;
                        break;
                    case 'element_click':
                        label = `👆 Clicked "${event.target || 'element'}"`;
                        break;
                    case 'element_input':
                        label = `⌨️ Typing "${event.action || ''}"`;
                        break;
                    case 'scroll':
                        label = `📜 Scrolled ${event.action || 'down'}`;
                        break;
                    case 'tab_change':
                        label = `📑 ${event.action || 'Tab changed'}`;
                        break;
                    case 'extract':
                        label = `📋 Extracted content`;
                        break;
                    case 'ai_decision':
                        label = `🧠 Decided: ${event.action || '...'}`;
                        break;
                    case 'step_complete':
                        label = `✅ Step ${event.step}/${event.maxSteps} done`;
                        break;
                    case 'task_complete':
                        label = `🏁 Task complete — ${event.detail || ''}`;
                        break;
                    case 'error':
                        label = `❌ ${event.detail || 'Error'}`;
                        break;
                    default: label = event.detail || event.action || event.type;
                }
                onUpdate?.(label);
                if (emitEvent) {
                    const progressType = mapNavisToProgressType(event.type);
                    const actionPayload = buildActionPayload(event);
                    emitEvent({
                        type: 'subagent-progress',
                        toolCallId: toolCallId || '',
                        timestamp: new Date(event.timestamp).toISOString(),
                        stepNumber: event.step,
                        totalSteps: event.maxSteps,
                        content: event.detail || (progressType === 'reasoning' ? event.action : undefined),
                        action: actionPayload,
                        timelineBranch: {
                            agentType: 'navis',
                            branchStatus: event.type === 'error' ? 'failed' : event.type === 'task_complete' ? 'completed' : 'running',
                            taskDescription: args.task,
                        }
                    });
                }
            });
            // Read Navis settings from the persistent store
            const navisSettings = tool_settings_1.toolSettingsStore.get().navis;
            const result = await orchestrator.run({
                task: args.task,
                maxSteps: args.maxSteps ?? navisSettings.maxSteps,
                headless: args.headless ?? navisSettings.headless,
                startUrl: args.startUrl,
                useVision: navisSettings.useVision,
                autoLaunchChrome: navisSettings.autoLaunchChrome,
            });
            return {
                success: result.success,
                output: result.output,
                data: { steps: result.steps },
            };
        },
    };
}
