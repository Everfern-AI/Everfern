/**
 * AG-SAF-03 — pi-tools write/edit rollback classification safety tests.
 *
 * The write path must classify a target as "existing" via fs.stat, never
 * via readability. Concretely:
 *  - A path that EXISTS but is UNREADABLE (e.g. a directory sits at the
 *    path, so readFile throws EISDIR) must NEVER produce a create-record
 *    (a wrong create-record unlinks a pre-existing file on rollback).
 *  - A genuinely absent path produces a create-record (which itself
 *    re-stats and refuses if a race made the file appear meanwhile).
 *  - An existing readable path produces a modify-record, not a create.
 *
 * Mocking note: pi-tools pulls the RollbackManager singleton via
 * getRollbackManager() from '../persistence/rollback-manager' at call time,
 * so vi.mock-ing that module factory is sufficient to observe every
 * trackFile* call. The pi-coding-agent module is injected through
 * __setPiCodingAgentModule (existing test seam).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Module-global RollbackManager mock ────────────────────────────────────
// pi-tools has module-global state (the rollbackManager singleton via
// getRollbackManager), so mock the persistence module itself.

const trackFileCreation = vi.fn(async () => null);
const trackFileModification = vi.fn(async () => null);

vi.mock('../../persistence/rollback-manager', () => ({
  getRollbackManager: () => ({
    initialize: vi.fn(async () => undefined),
    isFileExcluded: vi.fn(() => false),
    trackFileCreation,
    trackFileModification,
  }),
  // batch-write imports getRollbackManager from the same module; it shares
  // the same mocks above.
}));

import {
  getPiCodingTools,
  __setPiCodingAgentModule,
  resetPiCodingToolsCache,
  runWithAgentContext,
} from '../pi-tools';

// ── Fake pi-coding-agent module ───────────────────────────────────────────

const mockWriteExecutor = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Write success' }],
  isError: false,
}));

const mockEditExecutor = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Edit success' }],
  isError: false,
}));

const fakeModule = {
  readToolDefinition: { name: 'read', description: 'Read files', parameters: { type: 'object', properties: {} } },
  readTool: { execute: vi.fn() },
  writeToolDefinition: { name: 'write', description: 'Write files', parameters: { type: 'object', properties: {} } },
  writeTool: { execute: mockWriteExecutor },
  editToolDefinition: { name: 'edit', description: 'Edit files', parameters: { type: 'object', properties: {} } },
  editTool: { execute: mockEditExecutor },
  findToolDefinition: { name: 'find', description: 'Find', parameters: { type: 'object', properties: {} } },
  findTool: { execute: vi.fn() },
  grepToolDefinition: { name: 'grep', description: 'Grep', parameters: { type: 'object', properties: {} } },
  grepTool: { execute: vi.fn() },
  lsToolDefinition: { name: 'ls', description: 'Ls', parameters: { type: 'object', properties: {} } },
  lsTool: { execute: vi.fn() },
  bashToolDefinition: { name: 'bash', description: 'Bash', parameters: { type: 'object', properties: {} } },
  bashTool: { execute: vi.fn() },
};

// ── Helpers ───────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `pi-tools-safety-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  fsSync.rmSync(dir, { recursive: true, force: true });
}

/** Run fn inside an agent context so withRollbackTracking engages. */
async function withContext<T>(fn: () => Promise<T>): Promise<T> {
  return runWithAgentContext('saf03-task', 1, fn);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AG-SAF-03: pi-tools write classification', () => {
  let writeTool: any;
  let tempDir: string;

  beforeAll(async () => {
    __setPiCodingAgentModule(fakeModule);
    resetPiCodingToolsCache();
    const tools = await getPiCodingTools();
    writeTool = tools.find((t) => t.name === 'write');
  });

  afterAll(() => {
    __setPiCodingAgentModule(null as any);
  });

  beforeEach(() => {
    trackFileCreation.mockClear();
    trackFileModification.mockClear();
    mockWriteExecutor.mockClear();
    mockWriteExecutor.mockResolvedValue({
      content: [{ type: 'text', text: 'Write success' }],
      isError: false,
    });
  });

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('existing-but-unreadable target (directory at path): NEVER create-track', async () => {
    // A DIRECTORY at filePath: stat succeeds (exists), readFile fails
    // (EISDIR) — the "unreadable existing" proxy.
    const dirPath = path.join(tempDir, 'i-am-a-directory');
    fsSync.mkdirSync(dirPath);

    await withContext(() =>
      writeTool.execute({ path: dirPath, content: 'hello' })
    );

    expect(mockWriteExecutor).toHaveBeenCalled(); // write itself proceeded
    expect(trackFileCreation).not.toHaveBeenCalled(); // NEVER a create-record
    expect(trackFileModification).not.toHaveBeenCalled(); // unreadable → skip tracking entirely
  });

  it('existing readable target: modify-track, never create-track', async () => {
    const filePath = path.join(tempDir, 'exists.txt');
    fsSync.writeFileSync(filePath, 'old content');

    await withContext(() =>
      writeTool.execute({ path: filePath, content: 'new content' })
    );

    expect(trackFileModification).toHaveBeenCalledTimes(1);
    expect(trackFileModification.mock.calls[0][0]).toBe(path.resolve(filePath));
    expect(trackFileModification.mock.calls[0][1]).toBe('old content');
    expect(trackFileCreation).not.toHaveBeenCalled();
  });

  it('nonexistent target: create-track (before the write executes)', async () => {
    const filePath = path.join(tempDir, 'brand-new.txt');

    // The create-record must be attempted while the file is still absent —
    // assert ordering: trackFileCreation fires BEFORE the write executor.
    const order: string[] = [];
    trackFileCreation.mockImplementationOnce(async () => {
      order.push('track');
      // file must NOT exist yet at record time (it is genuinely new)
      expect(fsSync.existsSync(filePath)).toBe(false);
      return null;
    });
    mockWriteExecutor.mockImplementationOnce(async () => {
      order.push('write');
      return { content: [{ type: 'text', text: 'Write success' }], isError: false };
    });

    await withContext(() =>
      writeTool.execute({ path: filePath, content: 'created!' })
    );

    expect(trackFileCreation).toHaveBeenCalledTimes(1);
    expect(trackFileCreation.mock.calls[0][0]).toBe(path.resolve(filePath));
    expect(order[0]).toBe('track'); // create recorded BEFORE the write
    expect(order[1]).toBe('write');
  });

  it('no agent context → no tracking calls at all', async () => {
    const filePath = path.join(tempDir, 'no-context.txt');

    await writeTool.execute({ path: filePath, content: 'hello' });

    expect(trackFileCreation).not.toHaveBeenCalled();
    expect(trackFileModification).not.toHaveBeenCalled();
  });
});

describe('AG-SAF-03: race protection via trackFileCreation re-stat', () => {
  // The race window is closed by the RollbackManager itself (its own suite
  // covers refusal for existing paths, ENOTDIR, etc.). Here we verify the
  // pi-tools side of the contract: when the manager refuses (returns null),
  // the write still proceeds and NO modification record is fabricated.
  let writeTool: any;
  let tempDir: string;

  beforeAll(async () => {
    __setPiCodingAgentModule(fakeModule);
    resetPiCodingToolsCache();
    const tools = await getPiCodingTools();
    writeTool = tools.find((t) => t.name === 'write');
  });

  afterAll(() => {
    __setPiCodingAgentModule(null as any);
  });

  beforeEach(() => {
    trackFileCreation.mockClear();
    trackFileModification.mockClear();
    mockWriteExecutor.mockClear();
    mockWriteExecutor.mockResolvedValue({
      content: [{ type: 'text', text: 'Write success' }],
      isError: false,
    });
  });

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  it('manager refusal (create-record refused) does not break the write nor mis-track', async () => {
    const filePath = path.join(tempDir, 'refused-create.txt');
    // simulate the manager refusing the create-record (pre-existing path)
    trackFileCreation.mockResolvedValueOnce(null);

    const result = await withContext(() =>
      writeTool.execute({ path: filePath, content: 'written anyway' })
    );

    expect(trackFileCreation).toHaveBeenCalledTimes(1);
    expect(trackFileModification).not.toHaveBeenCalled();
    expect(result.success).toBe(true); // fail-open for the write itself
  });
});
