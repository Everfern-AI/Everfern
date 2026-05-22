"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContextualVerifyMessage = generateContextualVerifyMessage;
exports.generateContextualCompletionMessage = generateContextualCompletionMessage;
exports.getContextualSuggestions = getContextualSuggestions;
exports.validateAndCorrectToolArgs = validateAndCorrectToolArgs;
exports.getAGIHints = getAGIHints;
exports.isReadOnlyTask = isReadOnlyTask;
const fs = __importStar(require("fs"));
const task_decomposer_1 = require("./task-decomposer");
/**
 * Generate contextual redirect message based on intent type and task phase.
 * Allows narration but requires tool calls to actually execute.
 */
function generateContextualVerifyMessage(intent, phase) {
    const forceToolMap = {
        coding: 'write() → run_command() → verify output',
        build: 'write() files → run_command() to build → verify → present_files()',
        fix: 'view_file() to read error → write()/edit() to fix → run_command() to test',
        analyze: 'write(report.html) using React/papaparse/recharts to visualize the data → present_files()',
        task: 'run_command() or write() — pick the correct tool and EXECUTE NOW',
        research: 'web_search() with your query → navis() for full content → compile answer',
        automate: 'write(script.py) → run_command() to test → schedule or present',
        question: 'Answer directly. Use memory_search() or web_search() only if you need live data.',
        conversation: 'Respond naturally. No tools needed.',
        unknown: 'Call the appropriate tool NOW: write, run_command, web_search, or edit.',
    };
    const toolChain = forceToolMap[intent] || forceToolMap.unknown;
    return `⚡ EXECUTION REQUIRED [Intent: ${intent.toUpperCase()} | Phase: ${phase}]

You described what to do but DID NOT execute it. This is not acceptable.

REQUIRED TOOL CHAIN: ${toolChain}

RULES:
- Call the FIRST tool in the chain RIGHT NOW.
- Do NOT write explanations. Do NOT narrate. ACT.
- One tool call per response. Wait for result. Then call the next.
- If a tool fails, read the error and ADAPT — never repeat the same call unchanged.`;
}
/**
 * Generate contextual completion message when no work was done.
 */
function generateContextualCompletionMessage(intent) {
    const actionMap = {
        coding: `write() your code → run_command() to execute → verify output → present_files()`,
        build: `write() all required files → run_command() to build/install → verify → present_files()`,
        fix: `view_file() → edit()/write() the fix → run_command() to test → confirm fixed`,
        analyze: `write(report.html to {{SITE_PATH}}) using React/papaparse/recharts → present_files()`,
        task: `Execute the task with run_command() or write() — then verify completion`,
        research: `web_search() → navis() for top results → compile findings`,
        automate: `write(script) → test with run_command() → schedule or deliver`,
        default: `Call the appropriate tool: write, run_command, web_search, edit, or present_files`
    };
    const chain = actionMap[intent] || actionMap.default;
    return `🚨 COMPLETION GATE FAILED — Intent: ${intent.toUpperCase()}

Skills were detected and context was gathered, but NO DELIVERABLE was produced.

MANDATORY EXECUTION CHAIN:
${chain}

DIRECTIVE: Start executing NOW. Call the first tool in the chain. One tool call per response.
The user is waiting for RESULTS, not explanations. PROCEED IMMEDIATELY.`;
}
/**
 * Get contextual suggestions based on intent and failed tool.
 */
function getContextualSuggestions(intent, failedTool) {
    const suggestions = {
        coding: [
            `- Verify file path: does the directory exist? Use run_command("dir <path>") to check.`,
            `- Check syntax: read the file back with view_file() to confirm it's valid.`,
            `- Try simpler first: start with a minimal version, then add complexity.`,
            `- Check dependencies: are required packages installed? Run pip list or npm list.`
        ],
        build: [
            `- Check if the directory exists before writing files.`,
            `- Verify package manager is available: run_command("npm --version") or ("python --version").`,
            `- Start with the entry point file, then add supporting files.`,
            `- Run a simple test first to verify the runtime works.`
        ],
        fix: [
            `- Read the FULL error output — the root cause is usually at the bottom.`,
            `- View the failing file before editing it.`,
            `- Check imports: are all dependencies available?`,
            `- Try running with --verbose or adding print statements to isolate.`
        ],
        analyze: [
            `- Read the data file first using view_file or read_file to inspect headers and schema.`,
            `- Check file encoding or format issues if parsing fails.`,
            `- Use papaparse or d3.js in your React component for CSV data.`,
            `- Validate that the output HTML renders correctly in the browser.`
        ],
        task: [
            `- Check command syntax: run a simpler test command first.`,
            `- Verify the working directory: use Cwd parameter in run_command.`,
            `- Check permissions: does the user have write access to that path?`,
            `- Try alternative approach: file copy vs move, different flags, etc.`
        ],
        research: [
            `- Try a shorter, more specific search query (1-4 words).`,
            `- If navis fails, try the cached/mobile version of the URL.`,
            `- Search for the specific fact rather than the general topic.`,
            `- Try navis on a different URL from the search results.`
        ],
        default: [
            `- Read the full error message carefully.`,
            `- Verify all paths and arguments are correct.`,
            `- Try a simpler variation of the same operation.`,
            `- Check if required dependencies or tools are available.`
        ]
    };
    const list = suggestions[intent] || suggestions.default;
    return list.join('\n');
}
/**
 * Validates and corrects paths in tool arguments, particularly handling
 * username truncation issues where paths like C:/Users/sini should be C:/Users/srini
 */
function validateAndCorrectToolArgs(toolName, args, homeDir, conversationId) {
    const correctedArgs = { ...args };
    const ACTUAL_USER_PATH = homeDir.replace(/\\/g, '/');
    const safeConvId = conversationId || 'default';
    // Late Variable Expansion Targets
    const vars = {
        '{{SESSION_ID}}': safeConvId,
        '{{EXEC_PATH}}': `${ACTUAL_USER_PATH}/.everfern/exec/${safeConvId}`,
        '{{SITE_PATH}}': `${ACTUAL_USER_PATH}/.everfern/sites/${safeConvId}`,
        '{{ARTIFACT_PATH}}': `${ACTUAL_USER_PATH}/.everfern/artifacts/${safeConvId}`,
        '{{UPLOADS_PATH}}': `${ACTUAL_USER_PATH}/.everfern/attachments`,
        '{{PLAN_PATH}}': `${ACTUAL_USER_PATH}/.everfern/chat/plan/${safeConvId}`
    };
    const pathKeys = ['path', 'file_path', 'root', 'dir', 'directory', 'from', 'to', 'src', 'dest', 'destination', 'CommandLine', 'Cwd', 'cwd'];
    for (const key of pathKeys) {
        const value = correctedArgs[key];
        if (typeof value === 'string') {
            let pathValue = value;
            for (const [v, actual] of Object.entries(vars)) {
                if (pathValue.includes(v)) {
                    pathValue = pathValue.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), actual);
                }
            }
            const pathNorm = pathValue.replace(/\\/g, '/');
            const everfernPaths = ['.everfern/exec/', '.everfern/sites/', '.everfern/artifacts/', '.everfern/chat/plan/'];
            for (const efPath of everfernPaths) {
                if (pathNorm.includes(efPath)) {
                    const parts = pathNorm.split(efPath);
                    const afterEf = parts[1];
                    if (afterEf) {
                        const currentId = afterEf.split('/')[0];
                        if (currentId && currentId !== safeConvId && currentId.length > 5) {
                            pathValue = pathValue.replace(currentId, safeConvId);
                        }
                    }
                }
            }
            if (!fs.existsSync(pathValue.replace(/\\/g, '/'))) {
                const uuidRegex = /[0-9a-f]{8}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{4}[0-9a-f]{12}/i;
                const brokenUuidMatch = pathNorm.match(uuidRegex);
                if (brokenUuidMatch) {
                    const broken = brokenUuidMatch[0];
                    const fixed = `${broken.slice(0, 8)}-${broken.slice(8, 12)}-${broken.slice(12, 16)}-${broken.slice(16, 20)}-${broken.slice(20)}`;
                    const repairedPath = pathValue.replace(broken, fixed);
                    if (fs.existsSync(repairedPath.replace(/\\/g, '/'))) {
                        pathValue = repairedPath;
                    }
                }
            }
            correctedArgs[key] = pathValue;
        }
    }
    if (toolName === 'run_command' && typeof correctedArgs.CommandLine === 'string') {
        let cmd = correctedArgs.CommandLine;
        if (cmd.endsWith('\\"')) {
            cmd = cmd.slice(0, -2) + '"';
            correctedArgs.CommandLine = cmd;
        }
    }
    return correctedArgs;
}
/**
 * AGI: Get task decomposition hints for the system prompt
 */
function getAGIHints(userInput) {
    const analysis = (0, task_decomposer_1.analyzeTask)(userInput);
    const hints = [];
    if (analysis.canParallelize) {
        hints.push('PARALLEL: This task can be decomposed into parallel subtasks.');
        hints.push(`Approach: ${analysis.suggestedApproach} (${analysis.estimatedSteps} estimated steps)`);
    }
    if (analysis.complexity === 'complex') {
        hints.push('COMPLEX: Break into independent subtasks that can be delegated to specialized agents.');
    }
    return hints.join(' ');
}
/**
 * Check if task is read-only (no mutations)
 */
function isReadOnlyTask(intent) {
    return ['question', 'conversation'].includes(intent);
}
