// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { currentScope, runInScope, scopeOf, scopePaths } from '../agent-scope';
import { closeDb, dbOps, getDb } from '../../lib/db';

describe('agent scope', () => {
  afterAll(() => closeDb());

  it('treats worker- conversations as the worker agent and everything else as the chat', () => {
    expect(scopeOf('worker-abc-run-1')).toBe('worker');
    expect(scopeOf('worker-abc-auto-1')).toBe('worker');
    expect(scopeOf('chat-1')).toBe('chat');
    expect(scopeOf('my-worker-notes')).toBe('chat');
    expect(scopeOf(undefined)).toBe('chat');
  });

  it('is the chat outside a run and keeps the scope across awaits and timers', async () => {
    expect(currentScope()).toBe('chat');
    await runInScope('worker', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentScope()).toBe('worker');
    });
    expect(currentScope()).toBe('chat');
  });

  it('gives each agent its own prompt, database and memory files', () => {
    const chat = scopePaths('chat'), worker = scopePaths('worker');
    expect(chat.basePrompt).toBe('SYSTEM_PROMPT.md');
    expect(worker.basePrompt).toBe('WORKER_PROMPT.md');
    for (const key of ['database', 'memoryFile', 'learningFile', 'memoryDir'] as const) {
      expect(worker[key]).not.toBe(chat[key]);
    }
    expect(chat.database.endsWith('memory.sqlite')).toBe(true);
    expect(worker.database.endsWith('workers.sqlite')).toBe(true);
  });

  it('keeps a worker run out of the chat database', async () => {
    const chatDb = await getDb();
    const workerDb = await runInScope('worker', () => getDb());
    expect(workerDb).not.toBe(chatDb);

    const insert = (id: string) => dbOps.run(
      `INSERT INTO conversations (id, title, provider, model, created_at, updated_at) VALUES (?, 't', 'p', 'm', 'now', 'now')`, [id]);
    const ids = async () => (await dbOps.all('SELECT id FROM conversations')).map((r) => r.id);

    await runInScope('worker', () => insert('worker-w1-run-1'));
    await insert('chat-1');

    expect(await ids()).toEqual(['chat-1']);
    expect(await runInScope('worker', ids)).toEqual(['worker-w1-run-1']);
  }, 60_000);
});
