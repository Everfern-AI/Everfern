import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { GraphStateType, StreamEvent } from '../state';
import { ToolCallRecord, AgentTool, AgentRunnerConfig } from '../types';
import { analyzeTask } from '../task-decomposer';
import { analyzeToolDependencies, groupParallelTools } from '../parallel-executor';
import { validateAndCorrectToolArgs } from '../utils';
import { getAgentEvents } from '../../infra/agent-events';
import { getDefaultToolPolicyPipeline } from '../tool-policy';
import { detectToolCallLoop, recordToolCall, recordToolOutcome } from '../loop-detection';
import { captureScreen } from '../../tools/computer-use';
import { interrupt } from '@langchain/langgraph';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import type { AIClient } from '../../../lib/ai-client';
import { setAgentContext, clearAgentContext } from '../../tools/pi-tools';
import { redirectComputerUseCallsToNavis } from '../tool-routing';

/**
 * Determine if an error should trigger automatic retry with correction
 */
function shouldRetryWithCorrection(error: any, toolName: string): boolean {
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
  const isCriticalError = criticalErrors.some(pattern =>
    errorMsg.toLowerCase().includes(pattern.toLowerCase())
  );

  // Always retry for ask_user_question tool (our fixed tool)
  const isFixedTool = toolName === 'ask_user_question';

  return isCriticalError || isFixedTool;
}

/**
 * Approval detection using keyword matching
 * BUG-10 FIX: Removed AI-based approval detection that made an extra LLM call
 * per approval check. The keyword-based approach is reliable and avoids
 * doubling API costs.
 */
function isApprovalResponse(feedback: string): boolean {
  const lower = feedback.toLowerCase();
  return lower.includes('approve') || lower.includes('yes') ||
         lower.includes('proceed') || lower.includes('go ahead') || lower.includes('ok');
}

/**
 * Command completion detection using keyword matching
 * BUG-10 FIX: Removed AI-based completion detection that made an extra LLM call
 * per terminal command result. At scale (10+ terminal commands), this was doubling
 * API costs and adding 2-3s latency per tool call.
 */
function isCommandComplete(output: string): boolean {
  const lastLines = output.split('\n').slice(-3).join('\n');
  return lastLines.includes('> ') || lastLines.includes('$ ') ||
         output.includes('Status: DONE') || output.includes('Exit code:');
}

export const createExecuteToolsNode = (
  runner: any,
  tools: AgentTool[],
  config: AgentRunnerConfig,
  eventQueue?: StreamEvent[],
  conversationId?: string,
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean,
  aiClient?: AIClient
) => {
  const integrator = createMissionIntegrator(missionTracker);
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    // Check for abort signal
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    const nodeIntegrator = createMissionIntegrator(missionTracker);
    nodeIntegrator.startNode('execute_tools', `Executing ${state.pendingToolCalls?.length || 0} tool calls`);

    try {
      runner.telemetry.transition('execute_tools');

      const rawCalls = state.pendingToolCalls;
    if (!rawCalls || rawCalls.length === 0) {
      runner.telemetry.warn('Execute tools node reached but no pending calls found.');
      return { pendingToolCalls: [], iterations: (state.iterations || 0) + 1 };
    }

    const routing = redirectComputerUseCallsToNavis(rawCalls, state);
    const calls = routing.calls;
    if (routing.redirected > 0) {
      const msg = `[ExecuteTools] Redirected ${routing.redirected} web/booking computer_use call(s) to Navis`;
      console.warn(msg);
      runner.telemetry.info(msg);
      eventQueue?.push({
        type: 'thought',
        content: 'Routing this browser/booking workflow through Navis instead of OS-level computer use.'
      });
    }

    runner.telemetry.info(`Orchestrating ${calls.length} system operations...`);

    const newMessages: any[] = [];
    const newRecords: ToolCallRecord[] = [];
    let pauseGenFlag = false;

    // AGI: Parallel Execution Strategy
    const homedirNorm = os.homedir().replace(/\\/g, '/');
    const safeConvId = conversationId || 'current';

    const analysis = analyzeToolDependencies(calls.map(tc => ({
      name: tc.name,
      args: validateAndCorrectToolArgs(tc.name, tc.arguments || {}, homedirNorm, safeConvId),
      id: tc.id
    })));

    const parallelGroups = groupParallelTools(analysis);
    const { executeSynchronizedParallelGroup } = await import('../parallel-executor');

    // Set agent context for rollback tracking before executing tools.
    // Requirements 4.1, 4.2, 4.3, 5.1, 5.2: Tool execution context needed for RollbackManager.
    // Use missionId as the task identifier; fall back to a timestamped ID when unavailable.
    const rollbackTaskId = state.missionId || `exec-task-${Date.now()}`;
    const rollbackStepNumber = state.iterations || 0;
    try {
      setAgentContext(rollbackTaskId, rollbackStepNumber);
      console.log(`[ExecuteTools] Rollback context set: taskId=${rollbackTaskId}, step=${rollbackStepNumber}`);
    } catch (ctxError) {
      // Non-fatal: log and continue; rollback tracking will be skipped for this execution
      console.warn('[ExecuteTools] Failed to set rollback context:', ctxError);
    }

    for (let g = 0; g < parallelGroups.length; g++) {
      const group = parallelGroups[g];
      runner.telemetry.info(`🚀 Deploying Parallel Agents: Group ${g + 1}/${parallelGroups.length} (${group.length} agents sync)`);

      const groupTools = group.map((a: any) => ({
        name: a.name,
        args: a.args,
        id: a.id
      }));

      // Enhanced Parallel Execution with Synchronization
      const groupResult = await executeSynchronizedParallelGroup(
        groupTools,
        tools,
        g + 1,
        eventQueue,
        (update) => runner.telemetry.info(update)
      );

      newRecords.push(...groupResult.results);

      for (const rec of groupResult.results) {
        // Log Navis tool completion
        if (rec.toolName === 'navis') {
          console.log(`[ExecuteTools] 🎯 NAVIS TOOL RESULT RECEIVED - Success: ${rec.result?.success}`);
          runner.telemetry.info(`[ExecuteTools] 🎯 NAVIS TOOL RESULT RECEIVED - Success: ${rec.result?.success}`);
        }

        newMessages.push({
          role: 'tool',
          tool_call_id: (groupTools.find((t: any) => t.name === rec.toolName) as any)?.id,
          tool_name: rec.toolName,
          name: rec.toolName,
          content: rec.result.base64Image
            ? [{ type: 'text', text: rec.result.output }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${rec.result.base64Image}` } }]
            : rec.result.output,
        });
      }
    }

    const nextPendingTools: any[] = [];
    for (const rec of newRecords) {
        if ((rec.toolName === 'run_command' || rec.toolName === 'command_status') && rec.result?.success) {
            const out = typeof rec.result.output === 'string' ? rec.result.output : JSON.stringify(rec.result.output);

            // BUG-10 FIX: Now using keyword-based check (synchronous, no LLM call)
            const isComplete = isCommandComplete(out);

            if (!isComplete) {
                nextPendingTools.push({
                    id: 'poll_' + Math.random().toString(36).slice(2, 6),
                    name: 'command_status',
                    arguments: {
                        CommandId: rec.toolName === 'command_status' ? (rec.args as any).CommandId : 'agent-terminal',
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

    const hasAskUserQuestion = newRecords.some(r => r.toolName === 'ask_user_question');

    const result = {
      messages: newMessages,
      toolCallRecords: [...(state.toolCallRecords ?? []), ...newRecords],
      pendingToolCalls: nextPendingTools,
      pauseGeneration: pauseGenFlag,
      userConfirmation: undefined,
      toolCallHistory: [...(state.toolCallHistory ?? [])]
    };

    // Log return to brain
    const navisToolsInResults = newRecords.filter(r => r.toolName === 'navis');
    if (navisToolsInResults.length > 0) {
      console.log(`[ExecuteTools] ✅ NAVIS TOOL PROCESSING COMPLETE - Returning ${navisToolsInResults.length} result(s) to brain node`);
      runner.telemetry.info(`[ExecuteTools] ✅ NAVIS TOOL PROCESSING COMPLETE - Returning to brain node`);
    }

    nodeIntegrator.completeNode('execute_tools', `Completed ${calls.length} tool calls`);

    // Clear rollback context after tool execution completes.
    // Requirements 4.1, 4.2, 4.3, 5.1, 5.2: Clean up context to prevent stale tracking.
    try {
      clearAgentContext();
    } catch (ctxError) {
      console.warn('[ExecuteTools] Failed to clear rollback context:', ctxError);
    }

    return result;
    } catch (error) {
      // Clear rollback context even when execution fails to prevent stale state.
      try {
        clearAgentContext();
      } catch (ctxError) {
        console.warn('[ExecuteTools] Failed to clear rollback context on error:', ctxError);
      }
      nodeIntegrator.failNode('execute_tools', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
};
