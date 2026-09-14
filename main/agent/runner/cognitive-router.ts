import { GraphStateType, IntentType, StreamEvent } from './state';
import { AgentRunner } from './runner';
import { globalAbortManager } from './abort-manager';
import { extractJsonFromLLM } from './json-repair';
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

    // Issue #6 Fix: Previous lists were too narrow (3 words each) meaning most
    // real intents fell through to continue_brain. Expanded to cover common
    // synonyms so sub-agents actually reach the right specialist.
    if (isSubAgent) {
      this.runner.telemetry.info('[CognitiveRouter] Sub-agent detected, applying direct domain routing.');
      const subIntent = (state.currentIntent || '').toLowerCase();
      let subDecision: RoutingDecision = 'continue_brain';
      const codingKeywords = ['coding', 'build', 'fix', 'refactor', 'debug', 'test', 'implement', 'scaffold', 'compile', 'lint', 'deploy', 'migrate', 'typescript', 'javascript', 'python'];
      const webKeywords = ['web', 'browser', 'booking', 'navigate', 'scrape', 'crawl', 'form', 'login', 'click', 'fetch', 'url', 'http'];
      const dataKeywords = ['data', 'csv', 'excel', 'spreadsheet', 'sql', 'database', 'analyze', 'statistics', 'plot', 'chart', 'dataset'];
      const researchKeywords = ['research', 'search', 'investigate', 'summarize', 'literature', 'academic', 'survey', 'synthesis'];

      if (codingKeywords.some(k => subIntent.includes(k))) subDecision = 'route_coding';
      else if (webKeywords.some(k => subIntent.includes(k))) subDecision = 'route_web_explorer';
      else if (dataKeywords.some(k => subIntent.includes(k))) subDecision = 'route_data_analyst';
      else if (researchKeywords.some(k => subIntent.includes(k))) subDecision = 'route_deep_research';

      return {
        decision: subDecision,
        confidence: 1.0,
        explanation: `Sub-agent mapped directly to domain ${subDecision}.`
      };
    }

    // Fast path: direct intent mapping to eliminate 2-5s ReAct LLM routing latency for obvious tasks
    const normReq = userRequest.toLowerCase();
    const normIntent = (intent || '').toLowerCase();

    if (normIntent === 'coding' || normReq.includes('code') || normReq.includes('fix bug') || normReq.includes('build app') || normReq.includes('create file')) {
      this.runner.telemetry.info('[CognitiveRouter] Fast path matched: coding domain.');
      return { decision: 'route_coding', confidence: 0.95, explanation: 'Fast path: coding task detected.' };
    }
    if (normIntent === 'web' || normReq.includes('browse') || normReq.includes('http://') || normReq.includes('https://') || normReq.includes('search web')) {
      this.runner.telemetry.info('[CognitiveRouter] Fast path matched: web domain.');
      return { decision: 'route_web_explorer', confidence: 0.95, explanation: 'Fast path: web browsing task detected.' };
    }
    // Issue #7 Fix: Removed '.json' from the data analyst fast-path matcher.
    // Coding tasks like "read package.json", "update tsconfig.json" all contain
    // '.json' and were being misrouted to the data analyst specialist.
    if (normIntent === 'data' || normReq.includes('.csv') || normReq.includes('.xlsx') || normReq.includes('dataset')) {
      this.runner.telemetry.info('[CognitiveRouter] Fast path matched: data domain.');
      return { decision: 'route_data_analyst', confidence: 0.95, explanation: 'Fast path: data analysis task detected.' };
    }
    if (normIntent === 'research' || normReq.includes('deep research') || normReq.includes('investigate')) {
      this.runner.telemetry.info('[CognitiveRouter] Fast path matched: research domain.');
      return { decision: 'route_deep_research', confidence: 0.95, explanation: 'Fast path: research task detected.' };
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
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // Log the LLM's thought/action
      console.log(`[CognitiveRouter] Iteration ${currentIteration} raw LLM output:\n${content.slice(0, 500)}`);

      let step: any;
      const extracted = extractJsonFromLLM(content);

      if (extracted) {
        if (extracted.thought && extracted.action) {
          step = extracted;
        } else if (extracted.name && extracted.arguments) {
          step = {
            thought: 'Analyzing request...',
            action: extracted
          };
        } else if (extracted.action) {
          step = {
            thought: extracted.thought || 'Analyzing request...',
            action: extracted.action
          };
        } else if (extracted.subsystem) {
          step = {
            thought: extracted.explanation || 'Routing request...',
            action: {
              name: 'route_to',
              arguments: extracted
            }
          };
        }
      }

      if (!step) {
        // Fallback: try substring extraction
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            const parsedObj = extractJsonFromLLM(content.substring(firstBrace, lastBrace + 1));
            if (parsedObj?.action) {
              step = { thought: parsedObj.thought || 'Analyzing request...', action: parsedObj.action };
            } else if (parsedObj?.name && parsedObj?.arguments) {
              step = { thought: 'Analyzing request...', action: parsedObj };
            }
          } catch (e) {
            console.warn('[CognitiveRouter] Substring JSON parse failed:', e);
          }
        }
      }

      if (!step) {
        this.runner.telemetry.warn('[CognitiveRouter] Failed to parse ReAct step JSON, attempting default fallback...');
        break;
      }

      const thought = step.thought || 'Analyzing request...';
      this.runner.telemetry.info(`[CognitiveRouter] Thought: ${thought}`);

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

        this.runner.telemetry.info(`[CognitiveRouter] Routing decision finalized: ${subsystem} (${Math.round(confidence * 100)}% confidence) - ${explanation}`);

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
        this.runner.telemetry.info(`[CognitiveRouter] Action: Evaluating confidence for ${subsystem}...`);
        const evalResult = await this.evaluateSubsystemConfidence(subsystem, userRequest, intent);
        observation = `Confidence evaluation for ${subsystem}: score = ${evalResult.confidence}, reasoning = ${evalResult.reasoning}`;
      } else if (actionName === 'inspect_context') {
        this.runner.telemetry.info(`[CognitiveRouter] Action: Inspecting conversation context...`);
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
    return await this.fallbackRoute(intent, userRequest);
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
- web_explorer: for web research, reading online docs, opening websites, visiting URLs, interactive web browsing, web forms, transactions, hotel/flight booking, form submission
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
   * Heuristic/intent fallback routing with AI single-turn classifier fallback.
   */
  private async fallbackRoute(intent: string, request: string): Promise<RouterResult> {
    const fallbackRoutingMap: Record<string, RoutingDecision> = {
      'research': 'route_web_explorer',
      'coding': 'route_coding',
      'build': 'route_coding',
      'fix': 'route_coding',
      'analyze': 'route_data_analyst',
      'automate': 'continue_brain',
    };

    if (fallbackRoutingMap[intent]) {
      return {
        decision: fallbackRoutingMap[intent],
        confidence: 0.7,
        explanation: `Fallback intent-based routing decision for intent: ${intent}`
      };
    }

    // AI single-turn classification fallback when intent is task or unknown
    try {
      const prompt = `Classify which specialist should handle this user request.
User Request: "${request.slice(0, 300)}"

Options:
- route_web_explorer (for web research, reading online docs, opening websites, visiting URLs, web forms, booking)
- route_coding (for writing code, editing files, fixing bugs, software project tasks)
- route_data_analyst (for analyzing CSV/Excel files, plotting, data calculations)
- continue_brain (for general questions, chat, non-web single tasks)

Respond ONLY with a JSON object: {"subsystem": "<one of the options above>"}`;

      const response = await this.runner.client.chat({
        messages: [{ role: 'user', content: prompt }],
        responseFormat: 'json',
        temperature: 0.1,
        maxTokens: 100,
        abortSignal: globalAbortManager.abortController.signal,
      }) as any;

      let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        content = content.substring(firstBrace, lastBrace + 1);
      }
      const data = JSON.parse(content);
      if (data.subsystem && ['route_web_explorer', 'route_coding', 'route_data_analyst', 'continue_brain'].includes(data.subsystem)) {
        return {
          decision: data.subsystem as RoutingDecision,
          confidence: 0.8,
          explanation: `AI fallback classification selected ${data.subsystem}`
        };
      }
    } catch (e) {
      console.warn('[CognitiveRouter] Fallback AI classification failed:', e);
    }

    return {
      decision: 'continue_brain',
      confidence: 0.5,
      explanation: `Default fallback routing decision for intent: ${intent}`
    };
  }
}
