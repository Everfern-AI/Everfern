/**
 * Unit Tests for State Serializer
 *
 * Tests serialization / deserialization of GraphStateType, circular-reference
 * handling, validation, and gzip compression.
 *
 * Requirements: 11.1, 11.3, 11.6
 */

import { describe, it, expect } from 'vitest';
import {
  serializeState,
  encodeStateToJson,
  serializeStateToJson,
  deserializeStateFromJson,
  deserializeStateFromJsonAsync,
  compressState,
  decompressState,
  isCompressed,
  StateDeserializationError,
  SERIALIZATION_VERSION,
  COMPRESSION_THRESHOLD_BYTES,
  type SerializedState,
} from './state-serializer';
import type { GraphStateType } from '../runner/state';

// ── Test Helpers ──────────────────────────────────────────────────────

/** Build a minimal valid GraphStateType for testing */
function makeMinimalState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    messages: [],
    currentIntent: 'unknown',
    intentConfidence: 0,
    decomposedTask: undefined as any,
    agiHints: '',
    taskPhase: 'brain',
    pendingToolCalls: [],
    toolCallRecords: [],
    toolCallHistory: [],
    userConfirmation: undefined as any,
    finalResponse: '',
    pauseGeneration: false,
    iterations: 0,
    activeAgent: '',
    validationResult: undefined as any,
    shouldContinueIteration: false,
    completionSignal: null,
    routingDecision: null,
    hitlApprovalResult: undefined as any,
    missionId: '',
    missionTimeline: null,
    missionSteps: [],
    currentStepId: '',
    webExplorerComplete: false,
    webExplorerSelfLoopCount: 0,
    navisInvoked: false,
    searchInvoked: false,
    codingComplete: false,
    dataAnalysisComplete: false,
    computerUseComplete: false,
    deepResearchComplete: false,
    deepResearchSelfLoopCount: 0,
    subagentSpawned: undefined as any,
    completedSteps: [],
    decompositionAttempts: 0,
    brainToolsInFlight: false,
    returningFromSpecialist: null,
    debateResult: undefined as any,
    ...overrides,
  } as unknown as GraphStateType;
}

/** Build a mock LangGraph-style message */
function makeMessage(
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  id = `msg-${Math.random()}`
) {
  return { id, role, content, timestamp: Date.now() };
}

// ── serializeState ────────────────────────────────────────────────────

describe('serializeState', () => {
  it('serializes a minimal state without throwing', () => {
    const state = makeMinimalState();
    const result = serializeState(state);
    expect(result).toBeDefined();
    expect(result.serializationVersion).toBe(SERIALIZATION_VERSION);
    expect(typeof result.timestamp).toBe('number');
  });

  it('copies messages array', () => {
    const state = makeMinimalState({
      messages: [makeMessage('user', 'hello')] as any,
    });
    const result = serializeState(state);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('hello');
  });

  it('defaults missing optional fields to safe values', () => {
    // State with many fields absent
    const state = { messages: [] } as unknown as GraphStateType;
    const result = serializeState(state);

    expect(result.currentIntent).toBe('unknown');
    expect(result.intentConfidence).toBe(0);
    expect(result.decomposedTask).toBeNull();
    expect(result.taskPhase).toBe('brain');
    expect(result.iterations).toBe(0);
    expect(result.missionId).toBe('');
    expect(result.missionTimeline).toBeNull();
    expect(result.missionSteps).toEqual([]);
  });

  it('preserves non-null fields', () => {
    const state = makeMinimalState({
      missionId: 'mission-abc',
      iterations: 42,
      currentIntent: 'coding',
      taskPhase: 'executing',
      navisInvoked: true,
    });
    const result = serializeState(state);
    expect(result.missionId).toBe('mission-abc');
    expect(result.iterations).toBe(42);
    expect(result.currentIntent).toBe('coding');
    expect(result.taskPhase).toBe('executing');
    expect(result.navisInvoked).toBe(true);
  });
});

// ── encodeStateToJson ─────────────────────────────────────────────────

describe('encodeStateToJson', () => {
  it('produces valid JSON', () => {
    const serialized = serializeState(makeMinimalState());
    const json = encodeStateToJson(serialized);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('handles circular references gracefully (Requirement 11.3)', () => {
    const serialized = serializeState(makeMinimalState());
    // Inject a circular reference into the plain object
    const withCircular = serialized as unknown as Record<string, unknown>;
    withCircular['self'] = withCircular;

    expect(() => encodeStateToJson(serialized)).not.toThrow();
    const json = encodeStateToJson(serialized);
    expect(json).toContain('[Circular]');
  });

  it('produces pretty-printed JSON (Requirement 11.6)', () => {
    const serialized = serializeState(makeMinimalState());
    const json = encodeStateToJson(serialized);
    // Pretty-printing produces newlines and spaces
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});

// ── serializeStateToJson ──────────────────────────────────────────────

describe('serializeStateToJson', () => {
  it('returns compressed: false for small states', async () => {
    const state = makeMinimalState();
    const result = await serializeStateToJson(state);
    expect(result.compressed).toBe(false);
    expect(typeof result.json).toBe('string');
  });

  it('returns compressed: true for large states', async () => {
    // Create a very large message to push past the threshold
    const largeContent = 'x'.repeat(COMPRESSION_THRESHOLD_BYTES);
    const state = makeMinimalState({
      messages: [makeMessage('user', largeContent)] as any,
    });
    const result = await serializeStateToJson(state);
    expect(result.compressed).toBe(true);
    // Compressed payload is base64-encoded gzip
    expect(isCompressed(result.json)).toBe(true);
  });
});

// ── deserializeStateFromJson ──────────────────────────────────────────

describe('deserializeStateFromJson', () => {
  it('round-trips a minimal state', () => {
    const state = makeMinimalState();
    const serialized = serializeState(state);
    const json = encodeStateToJson(serialized);
    const restored = deserializeStateFromJson(json);
    expect(restored.serializationVersion).toBe(SERIALIZATION_VERSION);
    expect(restored.currentIntent).toBe('unknown');
  });

  it('round-trips a state with messages', () => {
    const state = makeMinimalState({
      messages: [
        makeMessage('user', 'what is the weather?'),
        makeMessage('assistant', 'I can look that up'),
      ] as any,
    });
    const serialized = serializeState(state);
    const json = encodeStateToJson(serialized);
    const restored = deserializeStateFromJson(json);
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0].role).toBe('user');
    expect(restored.messages[1].role).toBe('assistant');
  });

  it('preserves numeric and boolean fields', () => {
    const state = makeMinimalState({
      iterations: 17,
      intentConfidence: 0.95,
      navisInvoked: true,
      codingComplete: false,
    });
    const json = encodeStateToJson(serializeState(state));
    const restored = deserializeStateFromJson(json);
    expect(restored.iterations).toBe(17);
    expect(restored.intentConfidence).toBe(0.95);
    expect(restored.navisInvoked).toBe(true);
    expect(restored.codingComplete).toBe(false);
  });

  it('throws StateDeserializationError for non-JSON input', () => {
    expect(() => deserializeStateFromJson('not json')).toThrowError(StateDeserializationError);
  });

  it('throws StateDeserializationError for array root', () => {
    expect(() => deserializeStateFromJson('[]')).toThrowError(StateDeserializationError);
  });

  it('throws StateDeserializationError when messages is not an array', () => {
    const json = JSON.stringify({ messages: 'bad', currentIntent: 'unknown', taskPhase: 'brain' });
    expect(() => deserializeStateFromJson(json)).toThrowError(StateDeserializationError);
  });

  it('throws StateDeserializationError for invalid intent (Requirement 11.4, 11.5)', () => {
    const state = makeMinimalState();
    const serialized = serializeState(state);
    (serialized as unknown as Record<string, unknown>)['currentIntent'] = 'invalid_intent';
    const json = encodeStateToJson(serialized);
    try {
      deserializeStateFromJson(json);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StateDeserializationError);
      const typedErr = err as StateDeserializationError;
      expect(typedErr.field).toBe('currentIntent');
      expect(typedErr.message).toContain('currentIntent');
    }
  });

  it('throws StateDeserializationError for invalid taskPhase', () => {
    const state = makeMinimalState();
    const serialized = serializeState(state);
    (serialized as unknown as Record<string, unknown>)['taskPhase'] = 'bad_phase';
    const json = encodeStateToJson(serialized);
    expect(() => deserializeStateFromJson(json)).toThrowError(StateDeserializationError);
  });

  it('throws StateDeserializationError for invalid message role', () => {
    const state = makeMinimalState({
      messages: [{ id: 'm1', role: 'INVALID', content: 'hi', timestamp: Date.now() }] as any,
    });
    const serialized = serializeState(state);
    // Forcibly set bad role bypassing serializeMessage normalisation
    serialized.messages[0].role = 'INVALID' as any;
    const json = encodeStateToJson(serialized);
    expect(() => deserializeStateFromJson(json)).toThrowError(StateDeserializationError);
  });

  it('throws StateDeserializationError when message content is missing', () => {
    const serialized = serializeState(makeMinimalState());
    serialized.messages = [{ id: 'm1', role: 'user', timestamp: Date.now() } as any];
    const json = encodeStateToJson(serialized);
    expect(() => deserializeStateFromJson(json)).toThrowError(StateDeserializationError);
  });
});

// ── deserializeStateFromJsonAsync ─────────────────────────────────────

describe('deserializeStateFromJsonAsync', () => {
  it('handles uncompressed JSON', async () => {
    const state = makeMinimalState({ iterations: 5 });
    const json = encodeStateToJson(serializeState(state));
    const restored = await deserializeStateFromJsonAsync(json);
    expect(restored.iterations).toBe(5);
  });

  it('handles gzip-compressed state transparently', async () => {
    const state = makeMinimalState({ missionId: 'mission-xyz', iterations: 99 });
    const json = encodeStateToJson(serializeState(state));
    const compressed = await compressState(json);
    const restored = await deserializeStateFromJsonAsync(compressed);
    expect(restored.missionId).toBe('mission-xyz');
    expect(restored.iterations).toBe(99);
  });
});

// ── compressState / decompressState ───────────────────────────────────

describe('compressState / decompressState', () => {
  it('round-trips JSON through gzip compression', async () => {
    const original = JSON.stringify({ hello: 'world', numbers: [1, 2, 3] });
    const compressed = await compressState(original);
    const decompressed = await decompressState(compressed);
    expect(decompressed).toBe(original);
  });

  it('compressed output is base64 encoded', async () => {
    const compressed = await compressState('{"test":true}');
    expect(() => Buffer.from(compressed, 'base64')).not.toThrow();
  });

  it('compressed output is smaller than very large JSON', async () => {
    const largeJson = JSON.stringify({ data: 'a'.repeat(50000) });
    const compressed = await compressState(largeJson);
    expect(compressed.length).toBeLessThan(largeJson.length);
  });

  it('round-trips a full serialized state', async () => {
    const state = makeMinimalState({
      missionId: 'test-mission',
      iterations: 7,
      currentIntent: 'task',
      messages: [makeMessage('user', 'do something'), makeMessage('assistant', 'doing it')] as any,
    });
    const json = encodeStateToJson(serializeState(state));
    const compressed = await compressState(json);
    const decompressed = await decompressState(compressed);
    expect(decompressed).toBe(json);
  });
});

// ── isCompressed ──────────────────────────────────────────────────────

describe('isCompressed', () => {
  it('returns false for a plain JSON string', () => {
    expect(isCompressed('{"hello":"world"}')).toBe(false);
  });

  it('returns true for a gzip-compressed base64 string', async () => {
    const compressed = await compressState('{"test":true}');
    expect(isCompressed(compressed)).toBe(true);
  });

  it('returns false for a non-JSON, non-gzip string', () => {
    expect(isCompressed('plain text')).toBe(false);
  });
});

// ── StateDeserializationError ─────────────────────────────────────────

describe('StateDeserializationError', () => {
  it('exposes field name and message', () => {
    const err = new StateDeserializationError('messages[0].role', 'Bad value');
    expect(err.field).toBe('messages[0].role');
    expect(err.message).toContain('messages[0].role');
    expect(err.message).toContain('Bad value');
    expect(err.name).toBe('StateDeserializationError');
  });
});

// ── Circular Reference (Requirement 11.3) ─────────────────────────────

describe('Circular reference handling (Requirement 11.3)', () => {
  it('does not throw on a state containing circular refs in toolCallRecords', async () => {
    const circular: Record<string, unknown> = { name: 'some_tool' };
    circular['self'] = circular;

    const state = makeMinimalState({
      toolCallRecords: [circular] as any,
    });

    const result = await serializeStateToJson(state);
    expect(typeof result.json).toBe('string');
    // Should still be parseable (circular sentinel replaces the cycle)
    expect(() => JSON.parse(result.json)).not.toThrow();
  });
});

// ── LangGraph message type normalisation ──────────────────────────────

describe('LangGraph HumanMessage / AIMessage normalisation', () => {
  it('normalises "human" role to "user"', () => {
    const msg = { id: 'm1', role: 'human', content: 'hello', timestamp: Date.now() };
    const state = { messages: [msg] } as unknown as GraphStateType;
    const result = serializeState(state);
    expect(result.messages[0].role).toBe('user');
  });

  it('normalises "ai" role to "assistant"', () => {
    const msg = { id: 'm1', role: 'ai', content: 'sure', timestamp: Date.now() };
    const state = { messages: [msg] } as unknown as GraphStateType;
    const result = serializeState(state);
    expect(result.messages[0].role).toBe('assistant');
  });

  it('synthesises a message id when absent', () => {
    const msg = { role: 'user', content: 'test', timestamp: Date.now() };
    const state = { messages: [msg] } as unknown as GraphStateType;
    const result = serializeState(state);
    expect(typeof result.messages[0].id).toBe('string');
    expect(result.messages[0].id.length).toBeGreaterThan(0);
  });
});
