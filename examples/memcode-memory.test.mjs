import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOptInMemoryExample } from './memcode-memory.mjs';

test('disabled and unsupported project scopes make no network connection', async () => {
  const open = () => { throw new Error('must not connect'); };
  assert.equal((await runOptInMemoryExample({ enabled: false, scope: 'personal', query: 'hello', open })).status, 'disabled');
  assert.equal((await runOptInMemoryExample({ enabled: true, scope: 'project', query: 'hello', open })).status, 'unsupported_scope');
});

test('recalls without writing unless the exact note is approved', async () => {
  const calls = [];
  const open = async () => ({
    search: async (query) => { calls.push(['search', query]); return { content: [{ type: 'text', text: 'memory' }] }; },
    save: async (text) => { calls.push(['save', text]); return { content: [{ type: 'text', text: 'job' }] }; },
    close: async () => { calls.push(['close']); },
  });
  const result = await runOptInMemoryExample({ enabled: true, scope: 'personal', query: '  topic  ', proposedNote: 'exact note', confirmWrite: async () => false, open });
  assert.equal(result.status, 'ok');
  assert.equal(result.ingest, null);
  assert.deepEqual(calls, [['search', 'topic'], ['close']]);
});

test('an approved note is written once; remote failures safely return unavailable', async () => {
  const writes = [];
  const open = async () => ({ search: async () => ({ content: [] }), save: async (text) => { writes.push(text); return { content: [] }; }, close: async () => {} });
  const approved = await runOptInMemoryExample({ enabled: true, scope: 'personal', query: 'topic', proposedNote: 'exact note', confirmWrite: async (text) => text === 'exact note', open });
  assert.equal(approved.status, 'ok');
  assert.deepEqual(writes, ['exact note']);
  const unavailable = await runOptInMemoryExample({ enabled: true, scope: 'personal', query: 'topic', open: async () => { throw new Error('offline'); } });
  assert.equal(unavailable.status, 'unavailable');
});
