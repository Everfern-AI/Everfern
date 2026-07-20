import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { GraphStateType, StreamEvent } from '../state';
import { ToolCallRecord, AgentTool, AgentRunnerConfig } from '../types';
import { analyzeTask } from '../task-decomposer';
import { analyzeToolDependencies, groupParallelTools, executeSynchronizedParallelGroup } from '../parallel-executor';
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
import { syncTaskPlan } from '../task-plan-helper';
import {
  createHarnessConfig,
  preExecutionCheck,
  postExecutionCheck,
  recordExecution,
  getPhasePrompt,
  workflowEngine,
  handleFailedStep,
  rollbackOrchestrator,
} from '../harness';

/**
 * Read-only tools that don't need harness pre/post execution checks.
 * These tools cannot cause state corruption or file system changes.
 */
const READ_ONLY_TOOLS = new Set([
  'read_file', 'read', 'list_dir', 'list_directory', 'ls',
  'grep_search', 'grep', 'find', 'glob',
  'web_search', 'memory_search', 'recall_fact',
  'view_file', 'analyze_image'
]);

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

async function recordFinding(toolName: string, args: any, result: any, workspaceDir: string) {
  try {
    const findingsDir = path.join(os.homedir(), '.everfern');
    try {
      await fsPromises.mkdir(findingsDir, { recursive: true });
    } catch {}
    const findingsPath = path.join(findingsDir, 'findings.md');
    let findingsContent = '';
    
    try {
      findingsContent = await fsPromises.readFile(findingsPath, 'utf-8');
    } catch {
      findingsContent = `# Project Research Findings\n\n`;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    let sectionHeader = ``;
    let sectionBody = ``;

    if (toolName === 'web_search') {
      const query = args.query || args.pattern || args.search || '';
      sectionHeader = `## [${dateStr}] Web Search: "${query}"`;
      sectionBody = `* **Search Query**: \`${query}\`\n* **Results Snippet**:\n\`\`\`\n${(result.output || '').slice(0, 500)}...\n\`\`\``;
    } else if (toolName === 'navis') {
      const task = args.task || args.url || '';
      const urlMatch = task.match(/https?:\/\/[^\s"'`]+/);
      const url = urlMatch ? urlMatch[0] : 'Browser Action';
      sectionHeader = `## [${dateStr}] Browser Web View`;
      sectionBody = `* **Target URL**: \`${url}\`\n* **Task**: ${task}\n* **Scraped Data Summary**:\n${(result.output || '').slice(0, 500)}...`;
    } else if (toolName === 'web_fetch') {
      const url = args.url || '';
      sectionHeader = `## [${dateStr}] Web Fetch`;
      sectionBody = `* **Target URL**: \`${url}\`\n* **Scraped Data Summary**:\n${(result.output || '').slice(0, 500)}...`;
    } else if (['read', 'write', 'edit'].includes(toolName)) {
      const filePath = args.path || args.filePath || '';
      sectionHeader = `## [${dateStr}] File Operation: ${toolName.toUpperCase()} \`${path.basename(filePath)}\``;
      sectionBody = `* **File Path**: \`${filePath}\`\n* **Details**: Completed ${toolName} operation.`;
    }

    if (sectionHeader) {
      findingsContent += `\n${sectionHeader}\n${sectionBody}\n`;
      await fsPromises.writeFile(findingsPath, findingsContent, 'utf-8');
      console.log(`[Findings] Updated findings.md with entry for ${toolName}`);
    }
  } catch (err) {
    console.warn(`[Findings] Failed to write findings.md:`, err);
  }
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
    // PERF: executeSynchronizedParallelGroup is now a static import (was dynamic await import)

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

    // ── Harness Integration ──────────────────────────────────────────
    const harnessConfig = createHarnessConfig(rollbackTaskId, 'coding_harness');
    const phasePrompt = getPhasePrompt(harnessConfig);
    let harnessRecoveryActions: any[] = [];

    // Pre-execution validation: check recovery enforcer before each tool
    // PERF: Skip harness checks for read-only tools that cannot cause state corruption
    const validatedGroups: any[][] = [];
    for (const group of parallelGroups) {
      const validatedGroup: any[] = [];
      for (const tool of group) {
        // Read-only tools bypass harness pre-checks entirely
        if (READ_ONLY_TOOLS.has(tool.name)) {
          validatedGroup.push(tool);
          continue;
        }
        const stepId = `${rollbackTaskId}:${tool.name}:${tool.id}`;
        const preCheck = preExecutionCheck(stepId, tool.name, tool.args);
        if (!preCheck.shouldProceed && preCheck.recoveryAction) {
          harnessRecoveryActions.push({
            toolName: tool.name,
            stepId,
            recoveryAction: preCheck.recoveryAction,
            blocked: true
          });
          console.log(`[Harness] ⛔ Blocked ${tool.name}: ${preCheck.recoveryAction.reason}`);
          continue;
        }
        validatedGroup.push(tool);
      }
      if (validatedGroup.length > 0) {
        validatedGroups.push(validatedGroup);
      }
    }

    for (let g = 0; g < validatedGroups.length; g++) {
      const group = validatedGroups[g];
      runner.telemetry.info(`🚀 Deploying Parallel Agents: Group ${g + 1}/${validatedGroups.length} (${group.length} agents sync)`);

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

        // Record findings for research/browser/file tools (awaited to ensure availability to the agent and prevent data loss)
        const workspaceDir = runner.workspaceDir || path.join(os.homedir(), '.everfern');
        if (rec.result?.success && ['web_search', 'web_fetch', 'read', 'write', 'edit'].includes(rec.toolName)) {
          await recordFinding(rec.toolName, rec.args, rec.result, workspaceDir);
        }

        // ── Harness Post-Execution ────────────────────────────────────
        // PERF: Skip harness recording and post-checks for read-only tools
        if (!READ_ONLY_TOOLS.has(rec.toolName)) {
          const stepId = `${rollbackTaskId}:${rec.toolName}:${rec.id || Date.now()}`;
          const errorStr = rec.result?.error || (rec.result?.success === false ? rec.result?.output : undefined);
          recordExecution(stepId, rec.toolName, rec.args || {}, rec.result, errorStr);

          if (errorStr && ['terminal_execute', 'executePwsh', 'write', 'edit'].includes(rec.toolName)) {
            // Dynamic Self-Healing: Check if harness detects a failure and has a recovery action
            try {
              const recoveryAction = await handleFailedStep(harnessConfig, stepId, rec.toolName, errorStr);
              if (recoveryAction) {
                console.warn(`[Harness Self-Healing] ⚠️ Detected failure in ${rec.toolName}. Recovery action: ${recoveryAction.message}`);
                harnessRecoveryActions.push({
                  toolName: rec.toolName,
                  stepId,
                  recoveryAction,
                  blocked: false
                });
              }
            } catch (healingErr) {
              console.error('[Harness Self-Healing] Error handling failed step:', healingErr);
            }
          }

          const postCheck = postExecutionCheck(stepId, rec.toolName, rec.result);
          if (!postCheck.valid) {
            const recoveryAction = postCheck.recoveryAction;
            const harnessMsg = recoveryAction
              ? `[Harness] ⚠️ ${rec.toolName}: ${recoveryAction.message}`
              : `[Harness] ⚠️ ${rec.toolName}: validation warnings: ${postCheck.validationErrors.join(', ')}`;
            console.warn(harnessMsg);

            if (recoveryAction) {
              harnessRecoveryActions.push({
                toolName: rec.toolName,
                stepId,
                recoveryAction,
                blocked: false
              });
            }
          }
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

      // ── Execute rollback for rollback-type recovery actions ──
      const rollbackActions = harnessRecoveryActions.filter(
        (a: any) => a.recoveryAction?.type === 'rollback_step' || a.recoveryAction?.type === 'rollback_phase'
      );
      for (const ra of rollbackActions) {
        try {
          // PERF: rollbackOrchestrator is now a static import (was dynamic await import)
          const sessionId = ra.stepId?.split(':')[0] || rollbackTaskId;
          const targetPhase = ra.recoveryAction.rollbackTarget as string | undefined;
          if (targetPhase) {
            const currentPhase = workflowEngine.getContext(sessionId).currentPhase;
            const rollbackResult = await rollbackOrchestrator.rollbackToPhase(
              sessionId, targetPhase as any, currentPhase as any
            );
            if (rollbackResult) {
              const content = `[Harness Rollback] Rolled back to phase "${targetPhase}": ${rollbackResult.stepsRolledBack} steps undone, ${rollbackResult.filesRestored} files restored.`;
              console.log(content);
              newMessages.push({
                role: 'tool',
                tool_call_id: 'harness_rollback',
                tool_name: 'harness_rollback',
                name: 'harness_rollback',
                content
              });
            }
          } else {
            const plan = await rollbackOrchestrator.planRollback(sessionId, 0);
            if (plan) {
              const rollbackResult = await rollbackOrchestrator.executeRollback(plan);
              const content = `[Harness Rollback] Rolled back ${rollbackResult.stepsRolledBack} steps: ${rollbackResult.filesRestored} files restored.`;
              console.log(content);
              newMessages.push({
                role: 'tool',
                tool_call_id: 'harness_rollback',
                tool_name: 'harness_rollback',
                name: 'harness_rollback',
                content
              });
            }
          }
        } catch (rollbackErr) {
          console.warn('[ExecuteTools] Rollback execution failed:', rollbackErr);
        }
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

    // Inject harness recovery actions into messages so brain can see them
    if (harnessRecoveryActions.length > 0) {
      const recoverySummary = harnessRecoveryActions.map(a => {
        const prefix = a.blocked ? '⛔ BLOCKED' : '⚠️ RECOVERY';
        return `[Harness] ${prefix}: ${a.toolName} — ${a.recoveryAction.message}`;
      }).join('\n');
      newMessages.push({
        role: 'tool',
        tool_call_id: 'harness_recovery',
        tool_name: 'harness_recovery',
        name: 'harness_recovery',
        content: recoverySummary
      });
    }

    const result = {
      messages: newMessages,
      toolCallRecords: [...(state.toolCallRecords ?? []), ...newRecords],
      pendingToolCalls: nextPendingTools,
      pauseGeneration: pauseGenFlag,
      userConfirmation: undefined,
      toolCallHistory: [...(state.toolCallHistory ?? [])],
      harnessPhasePrompt: phasePrompt || undefined,
      harnessRecoveryActions: harnessRecoveryActions.length > 0 ? harnessRecoveryActions : [],
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

    // Sync .everfern/task_plan.md checkboxes & progress
    // PERF: Fire-and-forget — task plan sync is cosmetic bookkeeping, don't block return to brain
    syncTaskPlan(runner, missionTracker).catch(tpErr => {
      console.warn('[ExecuteTools] Failed to sync task plan:', tpErr);
    });

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
