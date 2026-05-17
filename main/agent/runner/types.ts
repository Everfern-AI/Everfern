/**
 * EverFern Desktop — Agent Types
 *
 * Defines the interfaces for the agentic runtime:
 * tools, state machine nodes, and tool results.
 */

import type { ChatMessage, ChatResponse } from '../../lib/ai-client';

// ── Tool System ──────────────────────────────────────────────────────

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  items?: any;
  properties?: any;
  enum?: string[];
}

export interface AgentTool {
  /** Unique name used in tool_calls (snake_case) */
  name: string;
  /** Human-readable description for the AI */
  description: string;
  /**
   * JSON Schema for the parameters object.
   * The AI fills these in; the runner validates and calls execute().
   */
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
  /** Execute the tool and return a result. Tools can optionally stream internal progress via onUpdate or emit structured events. */
  execute(
    args: Record<string, unknown>,
    onUpdate?: (msg: string) => void,
    emitEvent?: (event: any) => void,
    toolCallId?: string
  ): Promise<ToolResult>;
}

export interface ToolResult {
  /** Whether the tool ran successfully */
  success: boolean;
  /** Stringified output to show the AI */
  output: string;
  /** Optional structured data (for frontend rendering) */
  data?: unknown;
  /** Optional image to attach to the tool result for multimodal models */
  base64Image?: string;
  /** Error message if success === false */
  error?: string;
}

// ── Agent State ──────────────────────────────────────────────────────

export type AgentNodeType = 'plan' | 'tool_call' | 'respond' | 'error';

export interface ToolCallRecord {
  id?: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  timestamp: string;
  /** Optional duration in milliseconds for performance tracking */
  durationMs?: number;
}

export interface AgentState {
  /** Full conversation history (including system prompt) */
  messages: ChatMessage[];
  /** The original user input that triggered this agent run */
  userInput: string;
  /** Tool calls executed during this run */
  toolCalls: ToolCallRecord[];
  /** Plans/todos created during this run */
  plans: PlanRecord[];
  /** Current node in the state machine */
  currentNode: AgentNodeType;
  /** Final response to return to the user (set in 'respond' node) */
  finalResponse: string | null;
  /** If true, stop the agent loop */
  done: boolean;
  /** Iteration counter to prevent runaway loops */
  iterations: number;
}

export interface PlanRecord {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done';
}

// ── Runner Config ────────────────────────────────────────────────────

export interface AgentRunnerConfig {
  /** Maximum tool-call iterations before forcing a response */
  maxIterations: number;
  /** Whether to allow terminal tool */
  enableTerminal: boolean;
  /** Optional separate model to use for vision/computer tasks */
  visionModel?: string;
  /** Local ShowUI Gradio server URL (e.g. http://127.0.0.1:7860) */
  showuiUrl?: string;
  /** Ollama base URL — activates mai-ui:2b grounding for Ollama users */
  ollamaBaseUrl?: string;
  /** Callback to check if permissions are granted for sensitive tools */
  checkPermission?: () => boolean;
  /** Callback to trigger a permission request UI (e.g. show modal) */
  requestPermission?: () => Promise<boolean>;
  /** Decoupled VLM configuration */
  vlm?: {
    engine: 'local' | 'online';
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
  /** Callback to check if execution should be aborted (user clicked stop) */
  shouldAbort?: () => boolean;
  /** Whether to suppress internal console logging */
  silent?: boolean;
}
