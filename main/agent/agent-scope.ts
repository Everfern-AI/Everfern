import { AsyncLocalStorage } from 'async_hooks';
import * as os from 'os';
import * as path from 'path';

/**
 * EverFern runs two agents in one process: the chat assistant ("Ask EverFern") and the
 * workers. They share the runner code but nothing they store: each has its own base
 * prompt, database and memory files. The scope says which one the current call belongs to.
 */
export type AgentScope = 'chat' | 'worker';

const store = new AsyncLocalStorage<AgentScope>();

/** Worker runs are the conversations whose id starts with "worker-"; everything else is chat. */
export function scopeOf(conversationId: unknown): AgentScope {
  return typeof conversationId === 'string' && conversationId.startsWith('worker-') ? 'worker' : 'chat';
}

/** The scope of the run this code is executing in. Outside any run it is the chat. */
export function currentScope(): AgentScope {
  return store.getStore() ?? 'chat';
}

export function runInScope<T>(scope: AgentScope, fn: () => T): T {
  return store.run(scope, fn);
}

const root = () => path.join(os.homedir(), '.everfern');

/** Where each agent keeps its data. The chat keeps the paths it always had. */
export function scopePaths(scope: AgentScope = currentScope()) {
  const dir = scope === 'worker' ? path.join(root(), 'workers') : root();
  return {
    database: path.join(root(), 'sql', scope === 'worker' ? 'workers.sqlite' : 'memory.sqlite'),
    memoryFile: path.join(dir, 'MEMORY.md'),
    learningFile: path.join(dir, 'learning.json'),
    /** USER_PROFILE.md and PROJECT_STATE.md, fed into every prompt of this agent. */
    memoryDir: path.join(dir, 'memory'),
    basePrompt: scope === 'worker' ? 'WORKER_PROMPT.md' : 'SYSTEM_PROMPT.md',
  };
}
