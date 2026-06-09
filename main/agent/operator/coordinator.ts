import { GraphStateType, StreamEvent } from '../runner/state';
import { AgentRunner } from '../runner/runner';
import { createMissionIntegrator } from '../runner/mission-integrator';
import type { MissionTracker } from '../runner/mission-tracker';
import { planOperatorObjective } from './planning-engine';
import { OperatorSession } from './types';
import { SystemMessage } from '@langchain/core/messages';

export const createOperatorCoordinatorNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  shouldAbort?: () => boolean
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    integrator.startNode('operator_coordinator', 'Orchestrating high-level objective execution');

    try {
      runner.telemetry.transition('operator_coordinator');

      const lastUserMsg = state.messages.filter(m => {
        const msg = m as any;
        return msg.role === 'user' || msg.type === 'human' || msg._getType?.() === 'human';
      }).pop();
      const content = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';

      let session: OperatorSession = state.operatorSession;
      const { TaskGraphManager } = await import('./task-graph');
      const taskGraph = new TaskGraphManager();

      // Initialize session if missing
      if (!session) {
        runner.telemetry.info('Initializing new Operator Mode session');
        
        const client = runner.client;
        if (!client) {
            throw new Error('AIClient not available for planning engine');
        }

        const plan = await planOperatorObjective(content, client);
        taskGraph.buildFromPlan(plan);

        session = {
            sessionId: `op_${Date.now()}`,
            goal: plan.goal,
            status: 'executing',
            currentPlan: plan,
            graphState: taskGraph.serialize(),
            startTime: Date.now()
        };

        // Add to mission tracker
        if (missionTracker) {
            plan.tasks.forEach(t => {
                missionTracker.addStep({
                    id: t.taskId,
                    name: t.description.substring(0, 40),
                    description: t.description,
                    toolCalls: [t.executorType],
                    metadata: { originalTool: t.executorType },
                    phase: 'execution'
                });
            });
        }
      } else if (session.graphState) {
        taskGraph.deserialize(session.graphState);
      }

      // Notify UI about the objective plan
      const generatePlanPayload = () => ({
        id: session.sessionId,
        title: `Objective: ${session.goal.description}`,
        steps: session.currentPlan!.tasks.map(t => {
          // adjacencyList maps dependency -> dependents
          const deps = (Array.from((taskGraph as any).adjacencyList.entries()) as Array<[string, string[]]>)
            .filter(([_, dependents]: [string, string[]]) => dependents.includes(t.taskId))
            .map(([depId]) => depId);

          return {
            id: t.taskId,
            title: t.description,
            description: `Metrics: ${t.successCriteria.join(', ')}`,
            tool: t.executorType,
            status: taskGraph.getTaskState(t.taskId)?.status || 'pending',
            dependencies: deps
          };
        })
      });

      // If this is a new session, push the initial plan
      if (!state.operatorSession) {
        eventQueue?.push({
          type: 'plan_created',
          plan: generatePlanPayload()
        });
      }

      // Check if any task just completed/failed by checking state signals (for phase 2 evaluation)
      // If we are returning from a sub-agent, mark the in-progress task as complete for now
      const statesEntries = Array.from((taskGraph as any).states.entries()) as [string, any][];
      const inProgressTasks = statesEntries.filter(([id, s]) => s.status === 'in_progress');
      
      let stateChanged = false;

      if (inProgressTasks.length > 0) {
          const { EvaluationEngine } = await import('./evaluation-engine');
          const { replanObjective } = await import('./planning-engine');
          const evalEngine = new EvaluationEngine(runner.client as any);

          // Retrieve evaluation history from session
          if (!session.evaluationHistory) session.evaluationHistory = [];

          for (const [id] of inProgressTasks) {
              const taskObj = session.currentPlan!.tasks.find(t => t.taskId === id);
              if (taskObj) {
                  runner.telemetry.info(`[Operator] Evaluating task: ${id}`);
                  // Simulate parsing the subagent's final output from state.messages
                  const resultStr = state.messages.length > 0 ? (state.messages[state.messages.length - 1] as any).content : '';
                  const taskResult = { success: true, output: resultStr, duration: 0 };
                  
                  const evaluation = await evalEngine.evaluateProgress(taskObj, taskResult, session.goal);
                  session.evaluationHistory.push(evaluation);

                  taskGraph.updateTaskState(id, { status: evaluation.progressScore >= 0.5 ? 'completed' : 'failed' });
                  stateChanged = true;
                  if (missionTracker) missionTracker.completeStep(id);

                  if (evalEngine.shouldReplan(session.evaluationHistory)) {
                      runner.telemetry.info(`[Operator] Replanning triggered due to poor progress.`);
                      const newPlan = await replanObjective(session, taskObj, runner.client as any);
                      session.currentPlan = newPlan;
                      taskGraph.buildFromPlan(newPlan);
                      session.evaluationHistory = []; // Reset history for new plan
                  }
              }
          }
      }

      // ── Dispatch execution ──
      if (taskGraph.isGraphComplete()) {
          session.status = 'completed';
          session.endTime = Date.now();
          session.graphState = taskGraph.serialize();
          integrator.completeNode('operator_coordinator', 'Objective complete');
          
          eventQueue?.push({ type: 'plan_created', plan: generatePlanPayload() });

          return {
              operatorSession: session,
              taskPhase: 'evaluating' as const,
              completionSignal: {
                  reason: 'task_complete',
                  explanation: 'All objective tasks have been executed successfully.'
              }
          };
      }

      const readyTasks = taskGraph.getReadyTasks();
      if (readyTasks.length === 0) {
          // Blocked or failed
          session.status = 'failed';
          session.graphState = taskGraph.serialize();
          integrator.failNode('operator_coordinator', 'No ready tasks available. Task graph is blocked.');
          
          eventQueue?.push({ type: 'plan_created', plan: generatePlanPayload() });

          return {
              operatorSession: session,
              completionSignal: {
                  reason: 'cannot_proceed',
                  explanation: 'Task graph is blocked.'
              }
          };
      }

      const currentTask = readyTasks[0];
      taskGraph.updateTaskState(currentTask.taskId, { status: 'in_progress', startTime: Date.now() });
      session.graphState = taskGraph.serialize();
      
      eventQueue?.push({ type: 'plan_created', plan: generatePlanPayload() });

      runner.telemetry.info(`[Operator] Dispatching task: ${currentTask.description} to ${currentTask.executorType}`);
      if (missionTracker) missionTracker.startStep(currentTask.taskId);

      // Route to specialized agents based on executor type
      let routingDecision: any = {
          decision: 'route_coding',
          explanation: `Delegating to ${currentTask.executorType} for operator task execution.`
      };

      if (currentTask.executorType === 'web_explorer') {
          routingDecision.decision = 'route_web_explorer';
      } else if (currentTask.executorType === 'data_analyst') {
          routingDecision.decision = 'route_data_analyst';
      } else if (currentTask.executorType === 'desktop') {
          // Fall back to coding/terminal for now if no desktop node exists
          routingDecision.decision = 'route_coding';
      }

      integrator.completeNode('operator_coordinator', `Routing to ${currentTask.executorType}`);
      
      const contextMsg = new SystemMessage({
          content: `OPERATOR CONTEXT: You are executing a sub-task as part of a larger objective.\n\nOBJECTIVE: ${session.goal.description}\n\nCURRENT TASK:\n${currentTask.description}\n\nSUCCESS CRITERIA:\n${currentTask.successCriteria.join('\n')}\n\nFocus entirely on completing this task. When finished, report back.`
      });

      return {
          messages: [...state.messages, contextMsg as any],
          operatorSession: session,
          taskPhase: 'specialized_agent' as const,
          routingDecision
      };
    } catch (error) {
      runner.telemetry.warn(`[Operator] Failed: ${error instanceof Error ? error.message : String(error)}`);
      integrator.failNode('operator_coordinator', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
};
