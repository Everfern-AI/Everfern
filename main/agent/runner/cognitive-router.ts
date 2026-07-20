import { GraphStateType, IntentType, StreamEvent } from './state';
import { AgentRunner } from './runner';
import { globalAbortManager } from './abort-manager';
import * as fs from 'fs';
import * as path from 'path';

export type RoutingDecision =
  | 'continue_brain'
  | 'route_coding'
  | 'route_data_analyst'
  | 'route_web_explorer'
  | 'route_deep_research'
  | 'complete_task';

export interface RouterResult {
  decision: RoutingDecision;
  confidence: number;
  explanation: string;
}

export class CognitiveRouter {
  private runner: AgentRunner;
  private eventQueue?: StreamEvent[];
  private maxIterations = 4;

  constructor(runner: AgentRunner, eventQueue?: StreamEvent[]) {
    this.runner = runner;
    this.eventQueue = eventQueue;
  }

  /**
   * Route the task to the most appropriate subsystem using a ReAct loop.
   */
  public async route(state: GraphStateType): Promise<RouterResult> {
    const isSubAgent = !!this.runner.currentAgentSessionKey;
    const lastUserMsg = state.messages?.filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();

    const userRequest = lastUserMsg
      ? (typeof (lastUserMsg as any).content === 'string'
          ? (lastUserMsg as any).content
          : JSON.stringify((lastUserMsg as any).content))
      : '';

    const intent = state.currentIntent || 'unknown';

    this.runner.telemetry.info(`[CognitiveRouter] Starting routing analysis for request: "${userRequest.slice(0, 80)}..."`);
    this.eventQueue?.push({
      type: 'thought',
      content: `[Cognitive Router] Initializing routing analysis using ReAct framework...`
    });

    // Sub-agent constraint: sub-agents cannot delegate further
    if (isSubAgent) {
      this.runner.telemetry.info('[CognitiveRouter] Sub-agent detected, skipping ReAct loop to avoid delegation loops.');
      return {
        decision: 'continue_brain',
        confidence: 1.0,
        explanation: 'Sub-agent must handle tasks directly using local tools.'
      };
    }

    const reactMessages: any[] = [
      {
        role: 'system',
        content: `You are the Cognitive Router for EverFern. Your goal is to analyze the user request and determine the best subsystem to route it to.
You MUST reason and act step-by-step using the ReAct (Reasoning + Acting) framework. Interleave Thought, Action, and Observation.

Available subsystems:
- coding_specialist: for coding tasks (writing code, fixing bugs, scaffold projects, edit files, package installation)
- web_explorer: for interactive web browsing, web forms, transactions, hotel/flight booking, form submission
- data_analyst: for analyzing CSV/Excel files, running computations, data processing, visualizing datasets
- deep_research: for multi-source search/academic research, parallel crawling/scraping, comprehensive synthesis
- brain: for general assistant duties, small talk, questions, simple automation, file organization, or if you decide to handle it yourself.

In each step, you must respond with a JSON object matching this schema:
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "Your step-by-step reasoning about the routing decision."
    },
    "action": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "enum": ["evaluate_confidence", "inspect_context", "route_to"],
          "description": "The action to execute."
        },
        "arguments": {
          "type": "object",
          "properties": {
            "subsystem": {
              "type": "string",
              "description": "For evaluate_confidence: coding_specialist, web_explorer, data_analyst, deep_research, brain. For route_to: route_coding, route_web_explorer, route_data_analyst, route_deep_research, continue_brain, complete_task."
            },
            "confidence": {
              "type": "number",
              "description": "Required only for route_to. The routing confidence score between 0.0 and 1.0."
            },
            "explanation": {
              "type": "string",
              "description": "Required only for route_to. The reason for this routing decision."
            }
          },
          "required": ["subsystem"]
        }
      },
      "required": ["name", "arguments"]
    }
  },
  "required": ["thought", "action"]
}

Examples of valid step outputs:
1. Intermediate step evaluating confidence:
{
  "thought": "This is a coding task. Let me evaluate confidence in coding_specialist.",
  "action": {
    "name": "evaluate_confidence",
    "arguments": {
      "subsystem": "coding_specialist"
    }
  }
}

2. Final step routing the task:
{
  "thought": "Confidence is high. Routing to coding_specialist.",
  "action": {
    "name": "route_to",
    "arguments": {
      "subsystem": "route_coding",
      "confidence": 0.95,
      "explanation": "Request asks to build a TypeScript React application."
    }
  }
}

Wait for the Observation after each intermediate Action. Do not write the Observation yourself.
Keep iterating until you call route_to.`
      },
      {
        role: 'user',
        content: `USER REQUEST: "${userRequest}"
TRIAGE INTENT: "${intent}"`
      }
    ];

    let currentIteration = 0;
    while (currentIteration < this.maxIterations) {
      currentIteration++;
      globalAbortManager.checkAbort();

      this.runner.telemetry.info(`[CognitiveRouter] ReAct Loop Iteration ${currentIteration}/${this.maxIterations}...`);

      const response = await this.runner.client.chat({
        messages: reactMessages,
        responseFormat: 'json',
        temperature: 0.1,
        maxTokens: 500,
        abortSignal: globalAbortManager.abortController.signal,
      }) as any;

      let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      // Log the LLM's thought/action
      console.log(`[CognitiveRouter] Iteration ${currentIteration} raw LLM output:\n${content}`);

      let step: any;
      try {
        step = JSON.parse(content);
      } catch (parseErr) {
        this.runner.telemetry.warn('[CognitiveRouter] Failed to parse ReAct step JSON, attempting default fallback...');
        break;
      }

      const thought = step.thought || 'Analyzing request...';
      this.eventQueue?.push({
        type: 'thought',
        content: `[Cognitive Router] Thought: ${thought}`
      });

      const action = step.action;
      if (!action || !action.name || !action.arguments) {
        this.runner.telemetry.warn('[CognitiveRouter] No valid action structure found, attempting default fallback...');
        break;
      }

      const actionName = action.name;
      const actionArgs = action.arguments;

      reactMessages.push({ role: 'assistant', content: JSON.stringify(step) });

      if (actionName === 'route_to') {
        const subsystem = actionArgs.subsystem || 'continue_brain';
        const confidence = typeof actionArgs.confidence === 'number' ? actionArgs.confidence : 1.0;
        const explanation = actionArgs.explanation || 'Routed by Cognitive Router';

        this.runner.telemetry.info(`[CognitiveRouter] Routing decision finalized: ${subsystem} (${Math.round(confidence * 100)}% confidence)`);
        
        this.eventQueue?.push({
          type: 'thought',
          content: `[Cognitive Router] Finalized Route: ${subsystem} - ${explanation}`
        });

        return {
          decision: subsystem as RoutingDecision,
          confidence,
          explanation
        };
      }

      // Handle intermediate Actions
      let observation = '';
      if (actionName === 'evaluate_confidence') {
        const subsystem = actionArgs.subsystem || '';
        this.eventQueue?.push({
          type: 'thought',
          content: `[Cognitive Router] Action: Evaluating confidence for ${subsystem}...`
        });
        const evalResult = await this.evaluateSubsystemConfidence(subsystem, userRequest, intent);
        observation = `Confidence evaluation for ${subsystem}: score = ${evalResult.confidence}, reasoning = ${evalResult.reasoning}`;
      } else if (actionName === 'inspect_context') {
        this.eventQueue?.push({
          type: 'thought',
          content: `[Cognitive Router] Action: Inspecting conversation context...`
        });
        observation = `Conversation history has ${state.messages?.length || 0} messages. Current workspace: ${this.runner.workspaceDir || 'None'}.`;
      } else {
        observation = `Unknown action: ${actionName}. Please use evaluate_confidence, inspect_context, or route_to.`;
      }

      this.runner.telemetry.info(`[CognitiveRouter] Observation: ${observation}`);
      reactMessages.push({
        role: 'user',
        content: `{"observation": "${observation.replace(/"/g, '\\"')}"}`
      });
    }

    // Default Fallback
    this.runner.telemetry.warn('[CognitiveRouter] ReAct loop completed without explicit route_to. Falling back to intent classification.');
    return this.fallbackRoute(intent, userRequest);
  }

  /**
   * Evaluate confidence of routing to a subsystem using a quick LLM classification.
   */
  private async evaluateSubsystemConfidence(subsystem: string, request: string, intent: string): Promise<{ confidence: number; reasoning: string }> {
    try {
      const prompt = `Analyze if the user request should be handled by the specialized subsystem: "${subsystem}".
User Request: "${request}"
Triage Intent: "${intent}"

Subsystem Descriptions:
- coding_specialist: for coding tasks (writing code, fixing bugs, scaffold projects, edit files, package installation)
- web_explorer: for interactive web browsing, web forms, transactions, hotel/flight booking, form submission
- data_analyst: for analyzing CSV/Excel files, running computations, data processing, visualizing datasets
- deep_research: for multi-source search/academic research, parallel crawling/scraping, comprehensive synthesis
- brain: for general assistant duties, small talk, questions, simple automation, file organization, or if you decide to handle it yourself.

Respond with JSON only:
{"confidence": <score between 0.0 and 1.0>, "reasoning": "<brief explanation of the score>"}`;

      const response = await this.runner.client.chat({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json',
        temperature: 0.1,
        maxTokens: 250,
        abortSignal: globalAbortManager.abortController.signal,
      }) as any;

      let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const data = JSON.parse(content);
      return {
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
        reasoning: data.reasoning || 'Evaluated matching criteria'
      };
    } catch (err) {
      console.warn(`[CognitiveRouter] Confidence evaluation failed for ${subsystem}:`, err);
      return { confidence: 0.5, reasoning: 'Heuristic evaluation fallback' };
    }
  }

  /**
   * Heuristic/intent fallback routing.
   */
  private fallbackRoute(intent: string, request: string): RouterResult {
    const fallbackRoutingMap: Record<string, RoutingDecision> = {
      'research': 'route_web_explorer',
      'coding': 'route_coding',
      'build': 'route_coding',
      'fix': 'route_coding',
      'analyze': 'route_data_analyst',
      'automate': 'continue_brain',
    };
    const decision = fallbackRoutingMap[intent] || 'continue_brain';
    return {
      decision,
      confidence: 0.7,
      explanation: `Fallback intent-based routing decision for intent: ${intent}`
    };
  }
}
