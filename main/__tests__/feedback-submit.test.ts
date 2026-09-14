// @vitest-environment node
/**
 * MP-SEC-11 — feedback:submit handler + FeedbackStore.
 *
 * The preload bridges 'feedback:submit' but until now no main-side
 * ipcMain.handle existed, so the renderer always fell back to alert().
 * These tests pin the new handler's contract:
 *  - happy path persists a validated entry to ~/.everfern/feedback.json
 *  - validation rejects empty feedbackType, oversized fields, and
 *    non-JSON-serializable / oversized contextData with { success: false }
 *  - secrets are redacted before disk: an "sk-…" key in reason or in
 *    context message content must never appear in the persisted file
 *  - the store caps entries (oldest dropped) and writes atomically
 *
 * HERMETIC HOME (pattern from secret-redaction.test.ts): every os.homedir()
 * call resolves to a throwaway fixture so ~/.everfern is never touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { registerFeedbackHandlers } from '../ipc/feedback-handlers';
import { FeedbackStore, sanitizeFeedbackPayload, FEEDBACK_LIMITS } from '../store/feedback';

const handleMock = vi.mocked(ipcMain.handle) as unknown as ReturnType<typeof vi.fn>;

function getHandler(channel: string): (...args: any[]) => any {
  const call = handleMock.mock.calls.find((c: any[]) => c[0] === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as (...args: any[]) => any;
}

const fixtureHome = vi.hoisted(() => ({ home: null as string | null }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const raw = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'everfern-feedback-'));
  fixtureHome.home = fsMod.realpathSync(raw);
  return { ...actual, homedir: () => fixtureHome.home as string };
});

const feedbackFile = () => path.join(fixtureHome.home!, '.everfern', 'feedback.json');

let submitFeedback: (...args: any[]) => any;

beforeEach(() => {
  handleMock.mockClear();
  // Fresh feedback.json per test — the feedbackStore singleton persists to
  // the same fixture path across cases.
  if (fs.existsSync(feedbackFile())) {
    fs.rmSync(feedbackFile());
  }
  registerFeedbackHandlers();
  submitFeedback = getHandler('feedback:submit');
});

afterEach(() => {
  handleMock.mockClear();
});

afterAll(() => {
  if (fixtureHome.home) fs.rmSync(fixtureHome.home, { recursive: true, force: true });
});

describe('feedback:submit happy path', () => {
  it('persists a validated entry and returns { success: true }', async () => {
    const res = await submitFeedback(
      null,
      'down',
      'Inaccurate information',
      'cited a paper that does not exist',
      [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'wrong answer' }]
    );

    expect(res).toEqual({ success: true });
    const onDisk = JSON.parse(fs.readFileSync(feedbackFile(), 'utf-8'));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatchObject({
      feedbackType: 'down',
      reason: 'Inaccurate information',
      customReason: 'cited a paper that does not exist',
    });
    expect(onDisk[0].id).toMatch(/^feedback-/);
    expect(typeof onDisk[0].createdAt).toBe('string');
    // Atomic write: no temp file left behind.
    expect(fs.existsSync(`${feedbackFile()}.tmp`)).toBe(false);
  });

  it('treats null/undefined contextData as empty context', async () => {
    const res = await submitFeedback(null, 'up', 'Very helpful', '', null);
    expect(res).toEqual({ success: true });
    const onDisk = JSON.parse(fs.readFileSync(feedbackFile(), 'utf-8'));
    expect(onDisk[0].contextData).toBeNull();
  });
});

describe('feedback:submit validation', () => {
  it('rejects a non-string / empty feedbackType', async () => {
    expect((await submitFeedback(null, '', 'r', '', [])).success).toBe(false);
    expect((await submitFeedback(null, 42 as any, 'r', '', [])).success).toBe(false);
    expect((await submitFeedback(null, null as any, 'r', '', [])).success).toBe(false);
  });

  it('rejects an oversized feedbackType / reason / customReason', async () => {
    expect((await submitFeedback(null, 'x'.repeat(65), 'r', '', [])).success).toBe(false);
    expect((await submitFeedback(null, 'up', 'r'.repeat(FEEDBACK_LIMITS.reasonMax + 1), '', [])).success).toBe(false);
    expect((await submitFeedback(null, 'up', 'r', 'c'.repeat(FEEDBACK_LIMITS.customReasonMax + 1), [])).success).toBe(false);
  });

  it('rejects a non-string reason / customReason', async () => {
    expect((await submitFeedback(null, 'up', { bad: true } as any, '', [])).success).toBe(false);
    expect((await submitFeedback(null, 'up', 'r', undefined as any, [])).success).toBe(false);
  });

  it('rejects non-JSON-serializable contextData (circular reference)', async () => {
    const circular: any = { self: null };
    circular.self = circular;
    const res = await submitFeedback(null, 'up', 'r', '', circular);
    expect(res).toEqual({ success: false, error: 'contextData must be JSON-serializable' });
  });

  it('rejects contextData beyond the serialized cap', async () => {
    const huge = [{ role: 'user', content: 'x'.repeat(FEEDBACK_LIMITS.contextDataMax + 100) }];
    const res = await submitFeedback(null, 'up', 'r', '', huge);
    expect(res.success).toBe(false);
    expect(res.error).toContain('contextData exceeds');
  });

  it('rejects without persisting anything', async () => {
    await submitFeedback(null, '', 'r', '', []);
    if (fs.existsSync(feedbackFile())) {
      expect(JSON.parse(fs.readFileSync(feedbackFile(), 'utf-8'))).toHaveLength(0);
    }
  });
});

describe('feedback:submit redaction', () => {
  it('scrubs an sk-… secret from reason and customReason before disk', async () => {
    await submitFeedback(
      null,
      'down',
      'leaked my key sk-proj-AbCdEf1234567890 in the reply',
      'also here ghp_AbCdEf1234567890AbCdEf1234567890',
      []
    );

    const raw = fs.readFileSync(feedbackFile(), 'utf-8');
    expect(raw).not.toContain('sk-proj-AbCdEf1234567890');
    expect(raw).not.toContain('ghp_AbCdEf1234567890');
    expect(raw).toContain('[REDACTED]');
  });

  it('scrubs secrets inside contextData message strings and secret-named fields', async () => {
    await submitFeedback(null, 'down', 'r', '', [
      { role: 'assistant', content: 'my key is sk-nested-ZZZZ99991111 sure' },
      { role: 'system', apiKey: 'sk-name-keyed-4242' },
    ]);

    const raw = fs.readFileSync(feedbackFile(), 'utf-8');
    expect(raw).not.toContain('sk-nested-ZZZZ99991111');
    expect(raw).not.toContain('sk-name-keyed-4242');
    expect(raw).toContain('[REDACTED]');
  });

  it('leaves ordinary feedback text untouched', async () => {
    const res = sanitizeFeedbackPayload('up', 'Fast response', 'great job', [{ role: 'user', content: 'hi' }]);
    expect('entry' in res && res.entry.reason).toBe('Fast response');
    expect('entry' in res && (res.entry.contextData as any[])[0].content).toBe('hi');
  });
});

describe('FeedbackStore cap', () => {
  it('keeps only the newest maxEntries entries (oldest dropped)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-store-'));
    try {
      const store = new FeedbackStore(path.join(tmpDir, 'feedback.json'), 3);
      for (let i = 0; i < 5; i++) {
        store.addEntry({ feedbackType: 'up', reason: `entry-${i}`, customReason: '', contextData: [] });
      }
      const entries = store.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.reason)).toEqual(['entry-2', 'entry-3', 'entry-4']);
      // Cap + atomic write: no temp file left behind.
      expect(fs.existsSync(path.join(tmpDir, 'feedback.json.tmp'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
