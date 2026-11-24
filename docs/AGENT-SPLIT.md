# Two agents: Ask EverFern and the workers

EverFern runs two agents in one main process. They share the runner code and the
model settings, and nothing they store.

| | Ask EverFern (chat) | Worker |
|---|---|---|
| Conversation ids | anything else | start with `worker-` |
| Base prompt | `main/agent/prompts/SYSTEM_PROMPT.md` | `main/agent/prompts/WORKER_PROMPT.md` |
| On top of the base | Fern persona and tone, `SOUL.md`, `agents.md`, project context, integration status, skills table | the worker's operating laws (`runBrief` in `src/lib/worker-prompts.ts`) |
| Database | `~/.everfern/sql/memory.sqlite` | `~/.everfern/sql/workers.sqlite` |
| What the database holds | conversations, messages, checkpoints, memory chunks, semantic cache, usage events | the same tables, for worker runs only |
| Reflection memory | `~/.everfern/MEMORY.md` | `~/.everfern/workers/MEMORY.md` |
| Learning store | `~/.everfern/learning.json` | `~/.everfern/workers/learning.json` |
| Profile memory fed into prompts | `~/.everfern/memory/` | `~/.everfern/workers/memory/` |
| Tools | everything except the worker-only tools | `WORKER_SAFE_TOOLS` in `runner/worker-tool-policy.ts` |

## How it works

`main/agent/agent-scope.ts` holds the whole rule:

- `scopeOf(conversationId)` says which agent a conversation belongs to.
- `runInScope(scope, fn)` runs a stream as that agent. `acp:stream` in
  `main/ipc/agent/stream-handlers.ts` wraps every run in it.
- `currentScope()` and `scopePaths()` are what the rest of the code asks. Outside a
  run (history, projects, analytics, settings) the scope is the chat.

Code that stores or loads something asks the scope instead of hard-coding a path:

- `main/lib/db.ts` keeps one open database per scope. `getDb()` and `dbOps` pick
  the database of the run they are called from.
- `main/store/memory-manager.ts` writes reflection and learning to the scope's files.
- `main/agent/runner/system-prompt.ts`, `nodes/brain.ts` and `graph.ts` load the
  scope's base prompt.
- `nodes/brain.ts`, `services/agent-runtime.ts` and `triage.ts` add the chat
  personality and sub-agent routing only for the chat.

To add something an agent stores, add its path to `scopePaths()` and read it from
there.

## What this changes for users

- A worker run no longer shows up in the chat's history or uses its checkpoints.
- What a worker reads on the web can no longer end up in the memory the chat trusts.
- A worker no longer sees the chat's memory or user profile. Workers start with an
  empty memory of their own.
- Worker model usage is recorded in the workers' database, so the chat's Analytics
  page counts chat usage only.

## Not done

- Worker rows written before the split are still in `memory.sqlite`. Nothing reads
  them for worker runs any more; they were left in place, not moved or deleted.
- Model, provider and API key settings are still shared (`~/.everfern/config.json`).
- The scope travels with the async call chain. Code that runs from a bare event
  callback outside a run falls back to the chat.
- Verified by typecheck and `main/agent/__tests__/agent-scope.test.ts`. Not yet
  watched in a real worker run.
