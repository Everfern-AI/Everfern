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
exports.createExecuteToolsNode = void 0;
const parallel_executor_1 = require("../parallel-executor");
const mission_integrator_1 = require("../mission-integrator");
/**
 * Determine if an error should trigger automatic retry with correction
 */
function shouldRetryWithCorrection(error, toolName) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Critical errors that benefit from automatic retry
    const criticalErrors = [
        'Cannot read properties of undefined',
        'TypeError',
        'ReferenceError',
        'Invalid arguments',
        'Tool not found',
        'Validation failed'
    ];
    // Check if error message contains any critical error patterns
    const isCriticalError = criticalErrors.some(pattern => errorMsg.toLowerCase().includes(pattern.toLowerCase()));
    // Always retry for ask_user_question tool (our fixed tool)
    const isFixedTool = toolName === 'ask_user_question';
    return isCriticalError || isFixedTool;
}
/**
 * AI-based approval detection
 * Replaces keyword-based approval checking with semantic analysis
 */
async function isApprovalResponse(feedback, client) {
    if (!client) {
        // Fallback: keyword-based check
        return feedback.toLowerCase().includes('approve');
    }
    try {
        const prompt = `Determine if this user feedback represents approval or rejection.

Feedback: "${feedback}"

Approval indicators:
- "approve", "yes", "ok", "proceed", "go ahead"
- Affirmative responses
- Permission granted

Rejection indicators:
- "reject", "no", "deny", "cancel", "stop"
- Negative responses
- Permission denied

Respond with JSON:
{
  "isApproval": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            responseFormat: 'json',
            temperature: 0.3,
            maxTokens: 150
        });
        let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        // Remove markdown code blocks if present
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const analysis = JSON.parse(content);
        return analysis.isApproval && analysis.confidence > 0.7;
    }
    catch (err) {
        console.warn('[ExecuteTools] AI approval detection failed:', err);
        return feedback.toLowerCase().includes('approve');
    }
}
/**
 * AI-based command completion detection
 * Replaces keyword-based prompt detection with semantic analysis
 */
async function isCommandComplete(output, client) {
    if (!client) {
        // Fallback: keyword-based check
        const lastLines = output.split('\n').slice(-3).join('\n');
        return lastLines.includes('> ') || lastLines.includes('$ ') ||
            output.includes('Status: DONE') || output.includes('Exit code:');
    }
    try {
        const lastLines = output.split('\n').slice(-5).join('\n');
        const prompt = `Determine if this command output indicates completion (has shell prompt or exit status).

Last lines of output:
${lastLines}

Complete indicators:
- Shell prompts (>, $, #)
- Exit codes or status messages
- "DONE", "completed", "finished"

Incomplete indicators:
- Still running
- Waiting for input
- No prompt or status

Respond with JSON:
{
  "isComplete": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            responseFormat: 'json',
            temperature: 0.3,
            maxTokens: 150
        });
        let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        // Remove markdown code blocks if present
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const analysis = JSON.parse(content);
        return analysis.isComplete && analysis.confidence > 0.7;
    }
    catch (err) {
        console.warn('[ExecuteTools] AI completion detection failed:', err);
        const lastLines = output.split('\n').slice(-3).join('\n');
        return lastLines.includes('> ') || lastLines.includes('$ ') ||
            output.includes('Status: DONE') || output.includes('Exit code:');
    }
}
const createExecuteToolsNode = (runner, tools, config, eventQueue, conversationId, missionTracker, shouldAbort, aiClient) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        // Check for abort signal
        if (shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const nodeIntegrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
        nodeIntegrator.startNode('execute_tools', `Executing ${state.pendingToolCalls?.length || 0} tool calls`);
        try {
            runner.telemetry.transition('execute_tools');
            const calls = state.pendingToolCalls;
            if (!calls || calls.length === 0) {
                runner.telemetry.warn('Execute tools node reached but no pending calls found.');
                return { pendingToolCalls: [], iterations: (state.iterations || 0) + 1 };
            }
            runner.telemetry.info(`Orchestrating ${calls.length} system operations...`);
            const newMessages = [];
            const newRecords = [];
            let pauseGenFlag = false;
            // AGI: Parallel Execution Strategy
            const analysis = (0, parallel_executor_1.analyzeToolDependencies)(state.pendingToolCalls.map(tc => ({
                name: tc.name,
                args: tc.arguments,
                id: tc.id
            })));
            const parallelGroups = (0, parallel_executor_1.groupParallelTools)(analysis);
            const { executeSynchronizedParallelGroup } = await Promise.resolve().then(() => __importStar(require('../parallel-executor')));
            for (let g = 0; g < parallelGroups.length; g++) {
                const group = parallelGroups[g];
                runner.telemetry.info(`🚀 Deploying Parallel Agents: Group ${g + 1}/${parallelGroups.length} (${group.length} agents sync)`);
                const groupTools = group.map((a) => ({
                    name: a.name,
                    args: a.args,
                    id: a.id
                }));
                // Enhanced Parallel Execution with Synchronization
                const groupResult = await executeSynchronizedParallelGroup(groupTools, tools, g + 1, eventQueue, (update) => runner.telemetry.info(update));
                newRecords.push(...groupResult.results);
                for (const rec of groupResult.results) {
                    // Log Navis tool completion
                    if (rec.toolName === 'navis') {
                        console.log(`[ExecuteTools] 🎯 NAVIS TOOL RESULT RECEIVED - Success: ${rec.result?.success}`);
                        runner.telemetry.info(`[ExecuteTools] 🎯 NAVIS TOOL RESULT RECEIVED - Success: ${rec.result?.success}`);
                    }
                    newMessages.push({
                        role: 'tool',
                        tool_call_id: groupTools.find((t) => t.name === rec.toolName)?.id,
                        tool_name: rec.toolName,
                        name: rec.toolName,
                        content: rec.result.base64Image
                            ? [{ type: 'text', text: rec.result.output }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${rec.result.base64Image}` } }]
                            : rec.result.output,
                    });
                }
            }
            const nextPendingTools = [];
            for (const rec of newRecords) {
                if ((rec.toolName === 'run_command' || rec.toolName === 'command_status') && rec.result?.success) {
                    const out = typeof rec.result.output === 'string' ? rec.result.output : JSON.stringify(rec.result.output);
                    // Use AI to determine if command is complete
                    const isComplete = await isCommandComplete(out, aiClient);
                    if (!isComplete) {
                        nextPendingTools.push({
                            id: 'poll_' + Math.random().toString(36).slice(2, 6),
                            name: 'command_status',
                            arguments: {
                                CommandId: rec.toolName === 'command_status' ? rec.args.CommandId : 'agent-terminal',
                                WaitDurationSeconds: 2,
                                OutputCharacterCount: 2000
                            }
                        });
                    }
                }
            }
            if (calls.length > 1) {
                eventQueue?.push({
                    type: 'surface_action',
                    action: 'delete',
                    surfaceId: 'mission-progress'
                });
            }
            const result = {
                messages: newMessages,
                toolCallRecords: [...(state.toolCallRecords ?? []), ...newRecords],
                pendingToolCalls: nextPendingTools,
                pauseGeneration: pauseGenFlag,
                userConfirmation: undefined,
                toolCallHistory: [...(state.toolCallHistory ?? [])],
            };
            // Log return to brain
            const navisToolsInResults = newRecords.filter(r => r.toolName === 'navis');
            if (navisToolsInResults.length > 0) {
                console.log(`[ExecuteTools] ✅ NAVIS TOOL PROCESSING COMPLETE - Returning ${navisToolsInResults.length} result(s) to brain node`);
                runner.telemetry.info(`[ExecuteTools] ✅ NAVIS TOOL PROCESSING COMPLETE - Returning to brain node`);
            }
            nodeIntegrator.completeNode('execute_tools', `Completed ${calls.length} tool calls`);
            return result;
        }
        catch (error) {
            nodeIntegrator.failNode('execute_tools', error instanceof Error ? error.message : String(error));
            throw error;
        }
    };
};
exports.createExecuteToolsNode = createExecuteToolsNode;
