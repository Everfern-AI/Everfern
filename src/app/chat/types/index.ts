import React from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolCallDisplay {
    id: string;
    toolName: string;
    agentName?: string;
    icon?: React.ReactNode;
    label?: string;
    color?: string;
    status: 'running' | 'done' | 'error';
    output?: string;
    durationMs?: number;
    data?: any;
    base64Image?: string;
    args?: Record<string, unknown>;
    displayName?: string;
    description?: string;
    phase?: "triage" | "planning" | "execution" | "validation" | "completion";
    thought?: string;
    currentNode?: string;
}

export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    thought?: string;
    reasoning_content?: string;   // Raw chain-of-thought from model (e.g. DeepSeek-R1 style)
    thinkingDuration?: number; // Duration in milliseconds
    timestamp: Date;
    toolCalls?: ToolCallDisplay[];
    attachments?: FileAttachment[];
    stopped?: boolean; // True if the agent was stopped by the user
    generatedTitle?: string;
    planSteps?: Array<{ id: string; title?: string; description: string; tool?: string }> | null;
    planTitle?: string | null;
    missionTimeline?: any;
}

export interface FileAttachment {
    id: string;
    path?: string;
    name: string;
    size: number;
    mimeType: string;
    base64?: string;
    content?: string;
}

export interface FolderContext {
    id: string;
    path: string;
    name: string;
}

export interface ModelOption {
    id: string;
    name: string;
    provider: string;
    providerType: string;
    logo: any;
}

// Sub-agent progress streaming types
export type SubAgentProgressEventType =
  | 'step'       // New step started
  | 'reasoning'  // Agent reasoning/thinking
  | 'action'     // Action execution
  | 'screenshot' // Screenshot captured
  | 'complete'   // Sub-agent completed
  | 'abort';     // Sub-agent aborted

export interface SubAgentProgressEvent {
  type: SubAgentProgressEventType;
  toolCallId: string;
  timestamp: string;
  stepNumber?: number;
  totalSteps?: number;
  content?: string;
  action?: {
    type: string;
    params: Record<string, unknown>;
    description: string;
  };
  screenshot?: {
    base64: string;
    width: number;
    height: number;
  };
  metadata?: {
    model?: string;
    provider?: string;
    [key: string]: unknown;
  };
}

export interface SubAgentProgressBatch {
  toolCallId: string;
  events: SubAgentProgressEvent[];
  timestamp: string;
}

export interface LiveToolCall {
  index: number;
  toolName: string;
  partialArguments: string;
  isStreaming: boolean;
}

export type {
    ToolCallDisplay as ToolCallDisplayType,
    Message as MessageType,
    FileAttachment as FileAttachmentType,
    FolderContext as FolderContextType,
    ModelOption as ModelOptionType,
    LiveToolCall as LiveToolCallType
};
