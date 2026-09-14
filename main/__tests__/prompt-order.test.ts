/**
 * HP-04 static-first / volatile-last prompt ordering tests.
 *
 * Verifies:
 *  1. assembleSystemPrompt produces a stable prompt (base + memory + soul-once +
 *     agents-once) with ZERO volatile markers, and a '# VOLATILE CONTEXT' block
 *     carrying the findings tail (<=2000 chars) + DWSP git-status (<=40 lines).
 *  2. readFindingsTail / buildDwspBlock caps (2000 chars / 40 lines, '... and N more')
 *     and failure modes (non-repo -> '', missing file -> '').
 *  3. runAgentStep emits [system(stable), ...history, system(volatile)] and the
 *     nudge path preserves that order; the returned delta stays [assistantMsg].
 *  4. No state pollution: volatile content never leaks into state.messages.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

// Deterministic HOME so findings.md / memory reads never touch the real user home.
const fixtureHome = vi.hoisted(() => ({ home: '' }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-hp04-home-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home };
});

vi.mock('../lib/prompt-sync', () => ({
  loadPrompt: vi.fn(() => 'BASE SYSTEM PROMPT'),
}));

// Deterministic personality for both brain.ts and agent-runtime.ts.
vi.mock('../agent/personality-manager', () => ({
  loadSoul: vi.fn(() => 'FAKE SOUL CONTENT'),
  loadAgents: vi.fn(() => 'FAKE AGENTS CONTENT'),
}));

vi.mock('../agent/persistence/checkpoint-engine', () => ({
  getCheckpointEngine: vi.fn(() => ({
    createCheckpoint: vi.fn().mockResolvedValue({
      id: 'ck-1', taskId: 'task-1', stepNumber: 1, timestamp: Date.now(),
      stateJson: '{}', stateHash: 'hash', deltaOnly: false,
      previousCheckpointId: null, compressed: false,
    }),
    getLatestCheckpoint: vi.fn(),
  })),
}));

vi.mock('../agent/persistence/session-manager', () => ({
  getSessionPersistenceManager: vi.fn(),
  initializeSessionPersistenceManager: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agent/tools/computer-use', () => ({
  captureScreen: vi.fn().mockResolvedValue(null),
}));

vi.mock('../agent/runner/cognitive-router', () => ({
  CognitiveRouter: class {
    route = vi.fn().mockResolvedValue({ decision: 'complete_task', explanation: 'test routing' });
  },
}));

vi.mock('../agent/runner/task-plan-helper', () => ({
  syncTaskPlan: vi.fn().mockResolvedValue(undefined),
}));

// Keep brain's dependency mockable while still exposing the REAL runtime
// implementation for direct runAgentStep ordering tests (via importActual).
vi.mock('../agent/runner/services/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/runner/services/agent-runtime')>();
  return {
    ...actual,
    runAgentStep: vi.fn().mockResolvedValue({
      messages: [{ role: 'assistant', content: 'Test response' }],
      iterations: 1,
      pendingToolCalls: [],
    }),
  };
});

import {
  assembleSystemPrompt,
  readFindingsTail,
  buildDwspBlock,
  createBrainNode,
  VOLATILE_CONTEXT_HEADER,
  MEMORY_MARKER,
  SOUL_MARKER,
  AGENTS_MARKER,
  FINDINGS_MARKER,
  DWSP_MARKER,
  FINDINGS_TAIL_MAX_CHARS,
  DWSP_GIT_STATUS_MAX_LINES,
} from '../agent/runner/nodes/brain';
import type { AgentRunner } from '../agent/runner/runner';
import type { GraphStateType } from '../agent/runner/state';
import { runAgentStep } from '../agent/runner/services/agent-runtime';

// ── Helpers ──────────────────────────────────────────────────────────────────

const VOLATILE_MARKERS = [VOLATILE_CONTEXT_HEADER, FINDINGS_MARKER, DWSP_MARKER];

function makeTmpDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@t.test', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name tester', { cwd: dir, stdio: 'ignore' });
}

function createTestState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    currentIntent: 'unknown',
    intentConfidence: 0,
    decomposedTask: null,
    agiHints: '',
    taskPhase: 'brain',
    pendingToolCalls: [],
    toolCallRecords: [],
    toolCallHistory: [],
    userConfirmation: null,
    finalResponse: '',
    pauseGeneration: false,
    iterations: 0,
    activeAgent: 'brain',
    validationResult: null,
    shouldContinueIteration: false,
    completionSignal: null,
    routingDecision: null,
    hitlApprovalResult: null,
    missionId: 'test-mission',
    missionTimeline: null,
    missionSteps: [],
    currentStepId: 'step-1',
    webExplorerComplete: false,
    webExplorerSelfLoopCount: 0,
    navisInvoked: false,
    searchInvoked: false,
    codingComplete: false,
    dataAnalysisComplete: false,
    computerUseComplete: false,
    deepResearchComplete: false,
    deepResearchSelfLoopCount: 0,
    subagentSpawned: null,
    completedSteps: [],
    decompositionAttempts: 0,
    brainToolsInFlight: false,
    returningFromSpecialist: null,
    debateResult: null,
    ...overrides,
  } as GraphStateType;
}

function createMockRunner(overrides: Record<string, unknown> = {}): AgentRunner {
  return {
    client: {
      chat: vi.fn().mockResolvedValue({ content: 'ok', toolCalls: [] }),
      provider: 'test',
      model: 'test-model',
      isLocal: () => false,
    },
    config: {},
    telemetry: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      transition: vi.fn(),
      metrics: vi.fn(),
    },
    currentAgentSessionKey: null,
    workspaceDir: undefined,
    shouldCaptureScreenshot: () => false,
    tools: [],
    releaseClient: vi.fn(),
    getClient: vi.fn(),
    ...(overrides as object),
  } as unknown as AgentRunner;
}

async function getRealRunAgentStep() {
  const actual = await vi.importActual<typeof import('../agent/runner/services/agent-runtime')>(
    '../agent/runner/services/agent-runtime'
  );
  return actual.runAgentStep;
}

function gitStatusEntries(volatileContent: string): string[] {
  const start = volatileContent.indexOf('### Active Git Modifications');
  const end = volatileContent.indexOf('### Active File Dependency Graph');
  const body = volatileContent.slice(
    start,
    end === -1 ? undefined : end
  );
  return body.split('\n').filter((l: string) => l.startsWith('- `'));
}

// ── assembleSystemPrompt (pure) ─────────────────────────────────────────────

describe('assembleSystemPrompt', () => {
  it('composes stable = base + memory + soul + agents in order', () => {
    const { stable, volatile } = assembleSystemPrompt(
      'BASE',
      { memory: `\n\n${MEMORY_MARKER}\nMEM`, soul: 'SOUL', agents: 'AGENTS' },
      undefined
    );

    expect(stable).toContain('BASE');
    expect(stable).toContain(MEMORY_MARKER);
    expect(stable).toContain('MEM');
    expect(stable).toContain('# PERSONALITY & BEHAVIOR CORE (SOUL.md)');
    expect(stable).toContain('SOUL');
    expect(stable).toContain('# SUB-AGENTS & ROUTING RULES (AGENTS.md)');
    expect(stable).toContain('AGENTS');

    const order = [
      stable.indexOf('BASE'),
      stable.indexOf(MEMORY_MARKER),
      stable.indexOf(SOUL_MARKER),
      stable.indexOf(AGENTS_MARKER),
    ];
    expect(order.every(i => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(volatile).toBe('');
    expect(stable).not.toContain(VOLATILE_CONTEXT_HEADER);
  });

  it('keeps volatile markers out of the stable prompt', () => {
    const { stable, volatile } = assembleSystemPrompt(
      'BASE',
      { soul: 'S', agents: 'A' },
      { findingsTail: 'f', dwspBlock: '## DYNAMIC WORKSPACE PROJECTION (DWSP)' }
    );
    for (const marker of VOLATILE_MARKERS) {
      expect(stable).not.toContain(marker);
      expect(volatile).toContain(marker);
    }
  });

  it('injects each static section at most once (includes() marker guards)', () => {
    const once = assembleSystemPrompt(
      `BASE already has ${SOUL_MARKER} and ${AGENTS_MARKER} and ${MEMORY_MARKER}`,
      { memory: `\n\n${MEMORY_MARKER}\nMEM`, soul: 'SOUL', agents: 'AGENTS' },
      undefined
    );
    expect(once.stable.split(SOUL_MARKER).length - 1).toBe(1);
    expect(once.stable.split(AGENTS_MARKER).length - 1).toBe(1);
    expect(once.stable.split(MEMORY_MARKER).length - 1).toBe(1);

    // Re-entrant assembly never stacks duplicates.
    const first = assembleSystemPrompt('BASE', { soul: 'S' }, undefined);
    const second = assembleSystemPrompt(first.stable, { soul: 'S' }, undefined);
    expect(second.stable).toBe(first.stable);
  });

  it('caps the findings tail at 2000 chars inside the volatile block', () => {
    const bigFindings = Array.from({ length: 120 }, (_, i) => `finding-${i}: ${'x'.repeat(25)}`).join('\n');
    expect(bigFindings.length).toBeGreaterThan(FINDINGS_TAIL_MAX_CHARS);

    const dwspBlock = '## DYNAMIC WORKSPACE PROJECTION (DWSP)\n\n### Active Git Modifications\n- `a.ts` [Status: M]';
    const { volatile } = assembleSystemPrompt('BASE', {}, { findingsTail: bigFindings, dwspBlock });

    const start = volatile.indexOf('needed:\n') + 'needed:\n'.length;
    const end = volatile.indexOf('\n## DYNAMIC WORKSPACE PROJECTION (DWSP)');
    const payload = volatile.slice(start, end).trimEnd();

    expect(payload.length).toBeLessThanOrEqual(FINDINGS_TAIL_MAX_CHARS);
    expect(bigFindings.endsWith(payload)).toBe(true);
  });

  it('caps the DWSP block at 40 lines with a "... and N more" summary', () => {
    const dwspEntries = Array.from({ length: 60 }, (_, i) => `line-${i}`).join('\n');
    const dwspBlock = `## DYNAMIC WORKSPACE PROJECTION (DWSP)\n\n### Active Git Modifications\n${dwspEntries}`;
    const { volatile } = assembleSystemPrompt('BASE', {}, { dwspBlock });

    const dwspSection = volatile.slice(volatile.indexOf(DWSP_MARKER));
    expect(dwspSection.split('\n').length).toBeLessThanOrEqual(DWSP_GIT_STATUS_MAX_LINES);
    expect(dwspSection).toContain('... and 24 more');
    expect(dwspSection).toContain('line-0');
    expect(dwspSection).not.toContain('line-59');
  });

  it('emits no volatile block when no volatile input is provided', () => {
    const { stable, volatile: v } = assembleSystemPrompt('BASE', { soul: 'S' }, {});
    expect(v).toBe('');
    expect(stable).toBe('BASE\n\n# PERSONALITY & BEHAVIOR CORE (SOUL.md)\nS\n');
  });
});

// ── readFindingsTail ─────────────────────────────────────────────────────────

describe('readFindingsTail', () => {
  it('returns "" when the findings file is missing (empty fixture home)', () => {
    expect(readFindingsTail()).toBe('');
  });

  it('returns the tail capped at 2000 chars, snapped to a line boundary', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-findings-')));
    const lines = Array.from({ length: 100 }, (_, i) => `finding line ${i}: ${'y'.repeat(30)}`);
    const filePath = path.join(dir, 'findings.md');
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const tail = readFindingsTail(FINDINGS_TAIL_MAX_CHARS, filePath);
    const original = lines.join('\n');

    expect(tail.length).toBeLessThanOrEqual(FINDINGS_TAIL_MAX_CHARS);
    expect(original.endsWith(tail)).toBe(true);
    const tailStart = original.length - tail.length;
    expect(original[tailStart - 1]).toBe('\n');
  });

  it('returns full content when under the cap', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-findings-small-')));
    const filePath = path.join(dir, 'findings.md');
    fs.writeFileSync(filePath, 'short finding\n');
    expect(readFindingsTail(FINDINGS_TAIL_MAX_CHARS, filePath)).toBe('short finding');
  });
});

// ── buildDwspBlock ───────────────────────────────────────────────────────────

describe('buildDwspBlock', () => {
  it('returns "" for a missing or empty dir argument', async () => {
    expect(await buildDwspBlock('')).toBe('');
    expect(await buildDwspBlock(undefined)).toBe('');
    expect(await buildDwspBlock(path.join(makeTmpDir('hp04-missing-'), 'nope'))).toBe('');
  });

  it('returns "" for a non-repo directory', async () => {
    const plainDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-nonrepo-')));
    expect(await buildDwspBlock(plainDir)).toBe('');
  });

  it('caps git status at 40 lines with a "... and N more" summary for large repos', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-repo-big-')));
    initGitRepo(repo);
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(repo, `f${i}.txt`), 'change');
    }

    const block = await buildDwspBlock(repo);
    expect(block).toContain(DWSP_MARKER);
    expect(block).toContain('### Active Git Modifications');
    expect(block).toContain('- `f0.txt` [Status: ??]');
    expect(block.split('\n').length).toBeLessThanOrEqual(DWSP_GIT_STATUS_MAX_LINES);
    expect(block).toContain('... and 14 more');
  }, 15000);

  it('reports a clean workspace in a single line', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-repo-clean-')));
    initGitRepo(repo);
    const block = await buildDwspBlock(repo);
    expect(block).toContain(DWSP_MARKER);
    expect(block).toContain('Workspace is clean');
  }, 15000);
});

// ── runAgentStep ordering ────────────────────────────────────────────────────

describe('runAgentStep volatile ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeState(messages: unknown[]): GraphStateType {
    return createTestState({ messages: messages as GraphStateType['messages'] });
  }

  it('emits [system(stable), ...history, system(volatile)] and returns only [assistantMsg]', async () => {
    const realRunAgentStep = await getRealRunAgentStep();
    const runner = createMockRunner();
    const { stable, volatile: volatileBlock } = assembleSystemPrompt(
      'STABLE BASE PROMPT',
      { soul: 'FAKE SOUL CONTENT', agents: 'FAKE AGENTS CONTENT' },
      {
        findingsTail: 'f1\nf2',
        dwspBlock: '## DYNAMIC WORKSPACE PROJECTION (DWSP)\n\n### Active Git Modifications\n- `a.ts` [Status: M]',
      }
    );

    const state = makeState([{ role: 'user', content: 'hello' }]);
    const stateSnapshot = JSON.stringify(state.messages);

    const result = await realRunAgentStep(state, {
      runner,
      toolDefs: [],
      nodeName: 'brain',
      systemPromptOverride: stable,
      volatileSystemPrompt: volatileBlock,
    });

    const sent = (runner.client as any).chat.mock.calls[0][0].messages;
    expect(sent.length).toBe(3);

    // 1) Stable head: exact stable prompt, zero volatile markers.
    expect(sent[0].role).toBe('system');
    expect(sent[0].content).toBe(stable);
    for (const marker of VOLATILE_MARKERS) {
      expect(sent[0].content).not.toContain(marker);
    }

    // 2) History in the middle, untouched.
    expect(sent[1].role).toBe('user');
    expect(sent[1].content).toBe('hello');

    // 3) Volatile tail LAST.
    expect(sent[2].role).toBe('system');
    expect(sent[2].content).toBe(volatileBlock);
    expect(sent[2].content).toContain(VOLATILE_CONTEXT_HEADER);

    // Delta stays [assistantMsg]; state.messages untouched.
    expect(result.messages).toHaveLength(1);
    expect((result.messages as any[])[0].role).toBe('assistant');
    expect(JSON.stringify(state.messages)).toBe(stateSnapshot);
    expect(state.messages).toHaveLength(1);
  });

  it('keeps the volatile message last when the canned-refusal nudge fires', async () => {
    const realRunAgentStep = await getRealRunAgentStep();
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: 'I cannot browse the web or access external websites.', toolCalls: [] })
      .mockResolvedValueOnce({ content: 'Understood, searching now.', toolCalls: [] });
    const runner = createMockRunner();
    (runner.client as any).chat = chat;

    const { stable, volatile: volatileBlock } = assembleSystemPrompt(
      'STABLE BASE PROMPT',
      { soul: 'FAKE SOUL CONTENT' },
      { findingsTail: 'f1' }
    );

    await realRunAgentStep(makeState([{ role: 'user', content: 'browse example.com' }]), {
      runner,
      toolDefs: [],
      nodeName: 'brain',
      systemPromptOverride: stable,
      volatileSystemPrompt: volatileBlock,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    const nudgeMessages = chat.mock.calls[1][0].messages;
    expect(nudgeMessages[0].role).toBe('system');
    expect(nudgeMessages[0].content).toBe(stable);

    const volatileMsg = nudgeMessages[nudgeMessages.length - 2];
    const nudge = nudgeMessages[nudgeMessages.length - 1];
    expect(volatileMsg.role).toBe('system');
    expect(volatileMsg.content).toContain(VOLATILE_CONTEXT_HEADER);
    expect(nudge.role).toBe('system');
    expect(nudge.content).toContain('SYSTEM OVERRIDE');
  });

  it('builds a default volatile block (findings + DWSP) when volatileSystemPrompt is omitted', async () => {
    const realRunAgentStep = await getRealRunAgentStep();
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-runtime-repo-')));
    initGitRepo(repo);
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');

    const runner = createMockRunner({ workspaceDir: repo });

    await realRunAgentStep(makeState([{ role: 'user', content: 'go' }]), {
      runner,
      toolDefs: [],
      nodeName: 'coding_specialist',
      systemPromptOverride: 'SPECIALIST BASE PROMPT',
    });

    const sent = (runner.client as any).chat.mock.calls[0][0].messages;
    const volatileMsg = sent[sent.length - 1];
    expect(volatileMsg.role).toBe('system');
    expect(volatileMsg.content).toContain(VOLATILE_CONTEXT_HEADER);
    expect(volatileMsg.content).toContain(DWSP_MARKER);
    expect(volatileMsg.content).toContain('- `dirty.txt` [Status: ??]');
    expect(sent[0].content).not.toContain(DWSP_MARKER);
  }, 15000);

  it('emits no trailing volatile system message when nothing volatile exists', async () => {
    const realRunAgentStep = await getRealRunAgentStep();
    const runner = createMockRunner();

    await realRunAgentStep(makeState([{ role: 'user', content: 'hello' }]), {
      runner,
      toolDefs: [],
      nodeName: 'brain',
      systemPromptOverride: 'PLAIN STABLE PROMPT',
    });

    const sent = (runner.client as any).chat.mock.calls[0][0].messages;
    expect(sent.length).toBe(2);
    expect(sent[0].role).toBe('system');
    expect(sent[0].content).toContain('PLAIN STABLE PROMPT');
    expect(sent[sent.length - 1].role).toBe('user');
  });

  it('caps the legacy DWSP git-status section at 40 lines', async () => {
    const realRunAgentStep = await getRealRunAgentStep();
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-legacy-repo-')));
    initGitRepo(repo);
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(repo, `g${i}.txt`), 'x');
    }

    const runner = createMockRunner({ workspaceDir: repo });

    await realRunAgentStep(makeState([{ role: 'user', content: 'go' }]), {
      runner,
      toolDefs: [],
      nodeName: 'coding_specialist',
      systemPromptOverride: 'SPECIALIST BASE PROMPT',
    });

    const sent = (runner.client as any).chat.mock.calls[0][0].messages;
    const volatileMsg = sent[sent.length - 1];
    expect(volatileMsg.role).toBe('system');
    expect(volatileMsg.content).toContain(VOLATILE_CONTEXT_HEADER);
    expect(volatileMsg.content).toContain('... and 11 more');

    const gitBody = volatileMsg.content.slice(
      volatileMsg.content.indexOf('### Active Git Modifications'),
      volatileMsg.content.indexOf('### Active File Dependency Graph')
    );
    const statusLines = gitBody.split('\n').filter((l: string) => l.startsWith('- `'));
    expect(statusLines.length).toBeLessThanOrEqual(40);
  }, 15000);
});

// ── createBrainNode threading ────────────────────────────────────────────────

describe('createBrainNode volatile threading', () => {
  it('passes a marker-free stable override plus the volatile block to runAgentStep', async () => {
    const memoryDir = path.join(fixtureHome.home, '.everfern', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'USER_PROFILE.md'), 'User prefers concise replies.\n');
    fs.writeFileSync(path.join(fixtureHome.home, '.everfern', 'findings.md'), 'session finding\n');

    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hp04-brain-repo-')));
    initGitRepo(repo);
    fs.writeFileSync(path.join(repo, 'wip.txt'), 'x');

    const runner = createMockRunner({
      workspaceDir: repo,
      client: {
        chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ reason: 'task_complete', explanation: 'done' }) }),
        provider: 'test',
        model: 'm',
        isLocal: () => false,
      },
    });

    const node = createBrainNode(runner, undefined, undefined, [], undefined, undefined);
    await node(createTestState());

    expect(runAgentStep).toHaveBeenCalledTimes(1);
    const options = vi.mocked(runAgentStep).mock.calls[0][1];

    const stable = options.systemPromptOverride ?? '';
    expect(stable).toContain('BASE SYSTEM PROMPT');
    expect(stable).toContain(MEMORY_MARKER);
    expect(stable).toContain('USER_PROFILE.md');
    expect(stable).toContain(SOUL_MARKER);
    expect(stable).toContain('FAKE SOUL CONTENT');
    expect(stable).toContain(AGENTS_MARKER);
    expect(stable).toContain('FAKE AGENTS CONTENT');

    // Zero volatile markers in the stable prompt.
    expect(stable).not.toContain(VOLATILE_CONTEXT_HEADER);
    expect(stable).not.toContain(FINDINGS_MARKER);
    expect(stable).not.toContain(DWSP_MARKER);

    const volatileBlock = options.volatileSystemPrompt ?? '';
    expect(volatileBlock).toContain(VOLATILE_CONTEXT_HEADER);
    expect(volatileBlock).toContain(FINDINGS_MARKER);
    expect(volatileBlock).toContain('session finding');
    expect(volatileBlock).toContain(DWSP_MARKER);
    expect(volatileBlock).toContain('- `wip.txt` [Status: ??]');
  });
});
