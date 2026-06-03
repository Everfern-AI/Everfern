/**
 * State Serialization Module for Long-Running Agentic Tasks
 *
 * Provides serialization of GraphStateType to JSON format with support for:
 * - Circular reference handling via a replacer function
 * - Deserialization with validation against the SerializedState interface
 * - Optional gzip compression for large states
 *
 * Requirements: 11.1, 11.3, 11.6
 */

import * as zlib from 'zlib';
import { promisify } from 'util';
import type { GraphStateType, IntentType, TaskPhase, DecomposedTask } from '../runner/state';
import type { MissionTimeline, MissionStep } from '../runner/mission-tracker';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Current schema version — increment when SerializedState structure changes */
export const SERIALIZATION_VERSION = '1.0.0';

/** Threshold (in bytes) above which gzip compression is applied automatically */
export const COMPRESSION_THRESHOLD_BYTES = 512 * 1024; // 512 KB

// ── Serialized sub-types ──────────────────────────────────────────────

export interface SerializedMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface SerializedToolCall {
  id?: string;
  type?: string;
  function?: {
    name: string;
    arguments: string;
  };
}

export interface SerializedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** May be a plain string or array of content parts */
  content: string | SerializedMessageContent[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: SerializedToolCall[];
  /** Unix timestamp (ms) — synthesised during serialization if absent */
  timestamp: number;
}

// ── Primary serialized state interface ───────────────────────────────

/**
 * Complete serialized representation of GraphStateType that can be stored in
 * the `state_json` column of the `checkpoints` table.
 *
 * Requirement 11.1: Serialize LangGraph_State to JSON format
 */
export interface SerializedState {
  // Core LangGraph messages
  messages: SerializedMessage[];

  // Intent and task routing
  currentIntent: IntentType;
  intentConfidence: number;
  decomposedTask: DecomposedTask | null;
  taskPhase: TaskPhase;
  pendingToolCalls: unknown[];
  toolCallRecords: unknown[];

  // Agent routing state
  activeAgent: string;
  completionSignal: unknown | null;
  routingDecision: unknown | null;

  // Specialized agent flags
  webExplorerComplete: boolean;
  navisInvoked: boolean;
  searchInvoked: boolean;
  codingComplete: boolean;

  // Mission tracking
  missionId: string;
  missionTimeline: MissionTimeline | null;
  missionSteps: MissionStep[];

  // Additional flags present in GraphStateType
  agiHints: string;
  pauseGeneration: boolean;
  iterations: number;
  validationResult: unknown | null;
  shouldContinueIteration: boolean;
  hitlApprovalResult: unknown | null;
  currentStepId: string;
  webExplorerSelfLoopCount: number;
  dataAnalysisComplete: boolean;
  computerUseComplete: boolean;
  deepResearchComplete: boolean;
  deepResearchSelfLoopCount: number;
  subagentSpawned: unknown;
  completedSteps: string[];
  decompositionAttempts: number;
  brainToolsInFlight: boolean;
  returningFromSpecialist: string | null;
  debateResult: unknown;
  toolCallHistory: unknown[];
  userConfirmation: unknown;
  finalResponse: string;

  /** Schema version for forward-compatibility checks */
  serializationVersion: string;
  /** Unix timestamp (ms) when this serialized state was created */
  timestamp: number;
}

// ── Validation error ──────────────────────────────────────────────────

/**
 * Thrown when deserialized data fails schema validation.
 *
 * Requirement 11.4: Validate state structure during deserialization
 * Requirement 11.5: Report deserialization errors with specific field information
 */
export class StateDeserializationError extends Error {
  /** Field path that failed validation, e.g. "messages[0].role" */
  public readonly field: string;

  constructor(field: string, reason: string) {
    super(`Deserialization error at "${field}": ${reason}`);
    this.name = 'StateDeserializationError';
    this.field = field;
  }
}

// ── Circular-reference handling ───────────────────────────────────────

/**
 * JSON replacer that silently drops circular-reference values and replaces
 * them with the sentinel string `"[Circular]"`.
 *
 * Requirement 11.3: Handle circular references in state objects during serialization
 */
function makeCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return function circularReplacer(_key: string, value: unknown): unknown {
    if (value !== null && typeof value === 'object') {
      if (seen.has(value as object)) {
        return '[Circular]';
      }
      seen.add(value as object);
    }
    return value;
  };
}

// ── Message helpers ───────────────────────────────────────────────────

/**
 * Normalise a single LangChain / LangGraph message to a plain SerializedMessage.
 * LangGraph uses class instances (HumanMessage, AIMessage, etc.) that carry
 * prototype methods — we strip those here.
 */
function serializeMessage(msg: unknown, index: number): SerializedMessage {
  const m = msg as Record<string, unknown>;

  // Determine role from LangGraph message type or explicit "role" field
  let role: SerializedMessage['role'] = 'user';
  const rawRole = (m['role'] ?? (typeof m['getType'] === 'function' ? m['getType']() : undefined)) as string | undefined;

  if (typeof rawRole === 'string') {
    const normalised = rawRole.toLowerCase();
    if (normalised === 'human') role = 'user';
    else if (normalised === 'ai' || normalised === 'assistant') role = 'assistant';
    else if (normalised === 'system') role = 'system';
    else if (normalised === 'tool' || normalised === 'function') role = 'tool';
  }

  const id = (m['id'] as string | undefined) ??
    (m['lc_kwargs'] as Record<string, unknown> | undefined)?.['id'] as string | undefined ??
    `msg-${Date.now()}-${index}`;

  const content = m['content'] as string | SerializedMessageContent[];

  return {
    id: String(id),
    role,
    content: content ?? '',
    name: m['name'] as string | undefined,
    tool_call_id: m['tool_call_id'] as string | undefined,
    tool_calls: m['tool_calls'] as SerializedToolCall[] | undefined,
    timestamp: (m['timestamp'] as number | undefined) ?? Date.now(),
  };
}

// ── Serializer ────────────────────────────────────────────────────────

/**
 * Serialize a GraphStateType to a plain SerializedState object (in-memory).
 *
 * This does NOT perform JSON encoding — call `serializeStateToJson` for the
 * final string representation that can be stored in the database.
 *
 * Requirement 11.1: Serialize LangGraph_State to JSON format
 */
export function serializeState(state: GraphStateType): SerializedState {
  const messages = Array.isArray(state.messages)
    ? state.messages.map((m, i) => serializeMessage(m, i))
    : [];

  return {
    messages,
    currentIntent: state.currentIntent ?? 'unknown',
    intentConfidence: state.intentConfidence ?? 0,
    decomposedTask: state.decomposedTask ?? null,
    taskPhase: state.taskPhase ?? 'brain',
    pendingToolCalls: state.pendingToolCalls ?? [],
    toolCallRecords: state.toolCallRecords ?? [],
    activeAgent: state.activeAgent ?? '',
    completionSignal: state.completionSignal ?? null,
    routingDecision: state.routingDecision ?? null,
    webExplorerComplete: state.webExplorerComplete ?? false,
    navisInvoked: state.navisInvoked ?? false,
    searchInvoked: state.searchInvoked ?? false,
    codingComplete: state.codingComplete ?? false,
    missionId: state.missionId ?? '',
    missionTimeline: state.missionTimeline ?? null,
    missionSteps: state.missionSteps ?? [],
    agiHints: state.agiHints ?? '',
    pauseGeneration: state.pauseGeneration ?? false,
    iterations: state.iterations ?? 0,
    validationResult: state.validationResult ?? null,
    shouldContinueIteration: state.shouldContinueIteration ?? false,
    hitlApprovalResult: state.hitlApprovalResult ?? null,
    currentStepId: state.currentStepId ?? '',
    webExplorerSelfLoopCount: state.webExplorerSelfLoopCount ?? 0,
    dataAnalysisComplete: state.dataAnalysisComplete ?? false,
    computerUseComplete: state.computerUseComplete ?? false,
    deepResearchComplete: state.deepResearchComplete ?? false,
    deepResearchSelfLoopCount: state.deepResearchSelfLoopCount ?? 0,
    subagentSpawned: state.subagentSpawned ?? null,
    completedSteps: state.completedSteps ?? [],
    decompositionAttempts: state.decompositionAttempts ?? 0,
    brainToolsInFlight: state.brainToolsInFlight ?? false,
    returningFromSpecialist: state.returningFromSpecialist ?? null,
    debateResult: state.debateResult ?? null,
    toolCallHistory: (state as unknown as Record<string, unknown>)['toolCallHistory'] as unknown[] ?? [],
    userConfirmation: (state as unknown as Record<string, unknown>)['userConfirmation'] ?? null,
    finalResponse: (state as unknown as Record<string, unknown>)['finalResponse'] as string ?? '',
    serializationVersion: SERIALIZATION_VERSION,
    timestamp: Date.now(),
  };
}

/**
 * Encode a SerializedState to a JSON string, handling circular references.
 *
 * Requirement 11.3: Handle circular references in state objects during serialization
 * Requirement 11.6: Format serialized state back into valid JSON
 */
export function encodeStateToJson(serialized: SerializedState): string {
  return JSON.stringify(serialized, makeCircularReplacer(), 2);
}

/**
 * Convenience wrapper: serialize a GraphStateType directly to a JSON string.
 *
 * Returns `{ json, compressed: false }` normally, or
 * `{ json, compressed: true }` when the state was large enough to compress.
 *
 * Requirement 11.1, 11.3, 11.6
 */
export async function serializeStateToJson(
  state: GraphStateType
): Promise<{ json: string; compressed: false } | { json: string; compressed: true }> {
  const serialized = serializeState(state);
  const json = encodeStateToJson(serialized);

  // Requirement 12.3 / task 2.1: Add compression for large states
  if (Buffer.byteLength(json, 'utf8') >= COMPRESSION_THRESHOLD_BYTES) {
    const compressed = await compressState(json);
    return { json: compressed, compressed: true };
  }

  return { json, compressed: false };
}

// ── Deserializer ──────────────────────────────────────────────────────

/**
 * Validate and parse a raw JSON string (or already-parsed object) into a
 * SerializedState.  Throws `StateDeserializationError` for structural issues.
 *
 * Requirement 11.4: Validate state structure against schema during deserialization
 * Requirement 11.5: Report deserialization errors with specific field information
 */
export function deserializeStateFromJson(json: string): SerializedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new StateDeserializationError('(root)', `Invalid JSON: ${(err as Error).message}`);
  }

  return validateAndCoerceState(parsed);
}

/**
 * Deserialize state, handling gzip-compressed input transparently.
 *
 * Requirements: 11.1, 11.4, 11.5
 */
export async function deserializeStateFromJsonAsync(
  jsonOrCompressed: string
): Promise<SerializedState> {
  let json = jsonOrCompressed;

  // Detect gzip-compressed base64 payload (starts with 'H4sI' — gzip magic bytes in base64)
  if (jsonOrCompressed.startsWith('H4sI') || !jsonOrCompressed.trimStart().startsWith('{')) {
    try {
      json = await decompressState(jsonOrCompressed);
    } catch {
      // Not gzip-compressed — fall through to normal parsing
      json = jsonOrCompressed;
    }
  }

  return deserializeStateFromJson(json);
}

// ── Validation ────────────────────────────────────────────────────────

const VALID_ROLES = new Set<string>(['user', 'assistant', 'system', 'tool']);
const VALID_TASK_PHASES = new Set<string>([
  'triage', 'planning', 'routing', 'specialized_agent',
  'validation', 'hitl', 'orchestrating', 'executing', 'evaluating', 'brain',
]);
const VALID_INTENTS = new Set<string>([
  'unknown', 'coding', 'research', 'task', 'question',
  'conversation', 'build', 'fix', 'analyze', 'automate',
]);

function validateAndCoerceState(raw: unknown): SerializedState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StateDeserializationError('(root)', 'Expected a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // ── messages ──────────────────────────────────────────────────────
  if (!Array.isArray(obj['messages'])) {
    throw new StateDeserializationError('messages', 'Expected an array');
  }
  const messages: SerializedMessage[] = (obj['messages'] as unknown[]).map(
    (m, i) => validateMessage(m, i)
  );

  // ── currentIntent ─────────────────────────────────────────────────
  const rawIntent = (obj['currentIntent'] ?? 'unknown') as string;
  if (!VALID_INTENTS.has(rawIntent)) {
    throw new StateDeserializationError(
      'currentIntent',
      `Unknown intent "${rawIntent}". Expected one of: ${[...VALID_INTENTS].join(', ')}`
    );
  }
  const currentIntent = rawIntent as IntentType;

  // ── taskPhase ─────────────────────────────────────────────────────
  const rawPhase = (obj['taskPhase'] ?? 'brain') as string;
  if (!VALID_TASK_PHASES.has(rawPhase)) {
    throw new StateDeserializationError(
      'taskPhase',
      `Unknown task phase "${rawPhase}". Expected one of: ${[...VALID_TASK_PHASES].join(', ')}`
    );
  }
  const taskPhase = rawPhase as TaskPhase;

  // ── iterations ────────────────────────────────────────────────────
  const iterations = typeof obj['iterations'] === 'number' ? obj['iterations'] : 0;

  // ── serializationVersion ──────────────────────────────────────────
  if (obj['serializationVersion'] !== undefined &&
      typeof obj['serializationVersion'] !== 'string') {
    throw new StateDeserializationError('serializationVersion', 'Expected a string');
  }

  // ── timestamp ─────────────────────────────────────────────────────
  if (obj['timestamp'] !== undefined && typeof obj['timestamp'] !== 'number') {
    throw new StateDeserializationError('timestamp', 'Expected a number (Unix ms)');
  }

  return {
    messages,
    currentIntent,
    intentConfidence: typeof obj['intentConfidence'] === 'number' ? obj['intentConfidence'] : 0,
    decomposedTask: (obj['decomposedTask'] as DecomposedTask | null) ?? null,
    taskPhase,
    pendingToolCalls: Array.isArray(obj['pendingToolCalls']) ? obj['pendingToolCalls'] : [],
    toolCallRecords: Array.isArray(obj['toolCallRecords']) ? obj['toolCallRecords'] : [],
    activeAgent: typeof obj['activeAgent'] === 'string' ? obj['activeAgent'] : '',
    completionSignal: obj['completionSignal'] ?? null,
    routingDecision: obj['routingDecision'] ?? null,
    webExplorerComplete: Boolean(obj['webExplorerComplete']),
    navisInvoked: Boolean(obj['navisInvoked']),
    searchInvoked: Boolean(obj['searchInvoked']),
    codingComplete: Boolean(obj['codingComplete']),
    missionId: typeof obj['missionId'] === 'string' ? obj['missionId'] : '',
    missionTimeline: (obj['missionTimeline'] as MissionTimeline | null) ?? null,
    missionSteps: Array.isArray(obj['missionSteps']) ? obj['missionSteps'] as MissionStep[] : [],
    agiHints: typeof obj['agiHints'] === 'string' ? obj['agiHints'] : '',
    pauseGeneration: Boolean(obj['pauseGeneration']),
    iterations,
    validationResult: obj['validationResult'] ?? null,
    shouldContinueIteration: Boolean(obj['shouldContinueIteration']),
    hitlApprovalResult: obj['hitlApprovalResult'] ?? null,
    currentStepId: typeof obj['currentStepId'] === 'string' ? obj['currentStepId'] : '',
    webExplorerSelfLoopCount:
      typeof obj['webExplorerSelfLoopCount'] === 'number' ? obj['webExplorerSelfLoopCount'] : 0,
    dataAnalysisComplete: Boolean(obj['dataAnalysisComplete']),
    computerUseComplete: Boolean(obj['computerUseComplete']),
    deepResearchComplete: Boolean(obj['deepResearchComplete']),
    deepResearchSelfLoopCount:
      typeof obj['deepResearchSelfLoopCount'] === 'number' ? obj['deepResearchSelfLoopCount'] : 0,
    subagentSpawned: obj['subagentSpawned'] ?? null,
    completedSteps: Array.isArray(obj['completedSteps']) ? obj['completedSteps'] as string[] : [],
    decompositionAttempts:
      typeof obj['decompositionAttempts'] === 'number' ? obj['decompositionAttempts'] : 0,
    brainToolsInFlight: Boolean(obj['brainToolsInFlight']),
    returningFromSpecialist:
      typeof obj['returningFromSpecialist'] === 'string' ? obj['returningFromSpecialist'] : null,
    debateResult: obj['debateResult'] ?? null,
    toolCallHistory: Array.isArray(obj['toolCallHistory']) ? obj['toolCallHistory'] : [],
    userConfirmation: obj['userConfirmation'] ?? null,
    finalResponse: typeof obj['finalResponse'] === 'string' ? obj['finalResponse'] : '',
    serializationVersion:
      typeof obj['serializationVersion'] === 'string'
        ? obj['serializationVersion']
        : SERIALIZATION_VERSION,
    timestamp: typeof obj['timestamp'] === 'number' ? obj['timestamp'] : Date.now(),
  };
}

function validateMessage(raw: unknown, index: number): SerializedMessage {
  const path = `messages[${index}]`;

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StateDeserializationError(path, 'Expected a message object');
  }

  const m = raw as Record<string, unknown>;

  // role
  const role = m['role'] as string | undefined;
  if (role === undefined || !VALID_ROLES.has(role)) {
    throw new StateDeserializationError(
      `${path}.role`,
      `Expected one of ${[...VALID_ROLES].join(', ')}, got "${role}"`
    );
  }

  // content — allow string or array
  if (m['content'] === undefined) {
    throw new StateDeserializationError(`${path}.content`, 'Missing required field "content"');
  }

  return {
    id: typeof m['id'] === 'string' ? m['id'] : `msg-${Date.now()}-${index}`,
    role: role as SerializedMessage['role'],
    content: m['content'] as string | SerializedMessageContent[],
    name: typeof m['name'] === 'string' ? m['name'] : undefined,
    tool_call_id: typeof m['tool_call_id'] === 'string' ? m['tool_call_id'] : undefined,
    tool_calls: Array.isArray(m['tool_calls'])
      ? (m['tool_calls'] as SerializedToolCall[])
      : undefined,
    timestamp: typeof m['timestamp'] === 'number' ? m['timestamp'] : Date.now(),
  };
}

// ── Compression helpers ───────────────────────────────────────────────

/**
 * Compress a JSON string with gzip and return a base64-encoded string.
 *
 * Task 2.1: Add compression using gzip for large states
 */
export async function compressState(json: string): Promise<string> {
  const buffer = Buffer.from(json, 'utf8');
  const compressed = await gzip(buffer);
  return compressed.toString('base64');
}

/**
 * Decompress a base64-encoded gzip-compressed state string back to JSON.
 *
 * Task 2.1: Add compression using gzip for large states
 */
export async function decompressState(compressed: string): Promise<string> {
  const buffer = Buffer.from(compressed, 'base64');
  const decompressed = await gunzip(buffer);
  return decompressed.toString('utf8');
}

/**
 * Check whether a stored state string is gzip-compressed.
 *
 * Compressed strings are base64-encoded gzip data; they start with 'H4sI'
 * (the base64 encoding of the gzip magic bytes 0x1f 0x8b 0x08).
 */
export function isCompressed(data: string): boolean {
  const trimmed = data.trimStart();
  // Compressed base64 gzip always starts with 'H4sI'
  return trimmed.startsWith('H4sI') && !trimmed.startsWith('{');
}
