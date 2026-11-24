# Workers audit

Date: 2026-11-10. Scope: everything a worker touches in `apps/desktop`: the renderer store and page, the run engine, prompts, scheduling, the main-process IPC handlers, the worker tools, the tool policy, the local VM, the cloud VM path and the browser driver.

This audit was written read-only. The fixes that followed are listed under **Fix status** below; the findings themselves are left as written.

Each finding has a confidence mark:

- **Confirmed**: read in the code, the failure follows directly.
- **Likely**: read in the code, but the failure depends on runtime behaviour that was not reproduced.

Severity: **P0** breaks a promise the product makes (safety, data), **P1** is a bug users will hit, **P2** is a weakness or a trap for later work.

## Fix status (2026-11-10)

Fixed means changed in code and covered by a type check; tests are named where they exist. Nothing is committed yet.

| # | Status | What changed |
|---|--------|--------------|
| 1 | Fixed | Every worker command runs as the worker's own Linux user, in a home that only that user can read (mode 700), via `worker-sandbox.ts` (`runAsWorker`, `spawnAsWorker`). File transfer is piped through `cat` as that user, so a symlink only reaches what the worker may read. The terminal (`worker-pty.ts`) and the file watcher use the same path. Live-tested earlier in this session. |
| 2 | Fixed | Worker commands use `runInWorkerVM` / `spawnInWorkerVM`, which never fall back to the host. `workers:vm-status` now reports `isWorkerVMAvailable`. |
| 3 | Fixed | Runs are tracked per conversation (`abort-manager`: `runInConversation`, `stopConversation`). `stopWorker(workerId)` stops only that worker's run (`worker-engine.ts`, `activeRuns`). Test: `worker-audit-fixes.test.ts`. |
| 4 | Fixed | `workers.json` is `{ version, workers }`, written to a temp file and renamed, after copying the old file to `.bak`. A file that does not parse is kept as `.corrupt-<time>` and the backup is restored; with no usable backup the read fails and the UI shows the error instead of an empty list. Not unit-tested (it lives in an Electron handler). |
| 5 | Fixed | `workers:list` shows a "running" worker with no live run as "paused". The scheduler and Run ignore a "running" status that has no run behind it. |
| 6 | Fixed | Every schedule button comes from one list (`SCHEDULE_OPTIONS`); "Tomorrow at 9:00" is in it. Test: each button makes a valid schedule. |
| 7 | Partly fixed | Schedules now fire on any screen while EverFern is open, are no longer blocked by sheets, dialogs, or another worker's busy chat, and due workers are queued (most overdue first) instead of dropped. Missed runs are combined and the chat says so. **Still renderer-based:** nothing runs while the app is closed. Moving the scheduler into the main process is the remaining work. |
| 8 | Fixed | Events count only with an exact conversation id match; sub-agent progress is now tagged with its run in `stream-handlers.ts` and filtered. Test: `worker-audit-fixes.test.ts`. |
| 9 | Fixed | `memory_save`, `remember_fact` and `update_profile` are no longer allowed for workers (reads stay). `web_fetch` refuses localhost, private, link-local, and `.local` addresses for worker runs. **Gap:** a public URL that redirects to a private address is not caught yet; that check belongs in `webfetch.ts`. Test: `worker-tool-policy.test.ts`. |
| 10 | Fixed | `open_app`, `switch_app` and `close_app` only accept the worker's own apps, fail when the desktop is not connected, and say "asked the desktop to…" instead of claiming success. `list_apps` returns the real apps and marks the open ones. `close_app` really closes the window. |
| 11 | Mostly fixed | Delete stops the worker's runs and closes its terminal, file watcher, and windows. It clears its browser partition, workspace, temporary files, chat history, and saved cloud-browser logins, and reports anything it could not remove. **Not done:** the EverFern Cloud VM assigned to a cloud worker is not released; it needs a cloud API call. |
| 12 | Fixed | Each worker's chat is saved to `userData/worker-chats/<id>.json` (newest messages, up to 4 MB) and loaded when the worker is opened. The last 20 runs (task, report, ok, scheduled) are stored on the worker and the last 5 go into the run prompt. |
| 13 | Fixed | Scheduled runs use `worker-<id>-auto-<time>` and cannot call `ask_user` / `ask_user_question`; they are told to finish and list what they need in the report. Test: `worker-tool-policy.test.ts`. |
| 14 | Fixed | `workers:save` keeps only known fields, each with a size limit. `workers:webview-register` checks that the webContents is a webview hosted by the calling window and uses that worker's partition. `workers:vm-exec` still takes a command, but it now runs as the worker's own user in its workspace (finding 1), so it no longer reaches the host. |
| 15 | Fixed | The download save path is set synchronously inside `will-download`; the temp file is removed on failure. Large cloud uploads still go as one request. |
| 16 | Fixed | The `computer_use` reroute is removed; the tool is simply blocked for workers. |
| 17 | Fixed | `useWorkers` updates state first and calls the store outside React updaters; failures show an error banner. Delete waits for the main process before removing the worker from the list. |
| 18 | Fixed | A schedule stores `{ kind, hour, minute, timeZone }`; the label is display only. Hourly runs stay on their scheduled hour. Test: rename a label, hourly drift, missed-run count. |
| 19 | Fixed | `firstJsonObject` finds the first balanced object that parses (braces in strings and prose handled); prose with no plan is shown as a chat reply. Test: `worker-audit-fixes.test.ts`. |
| 20 | Fixed | File listings and file reads say how much more exists, and command output says when it was cut. |
| 21 | Partly fixed | Cookies and logins are never written or read in plain text; without the OS keychain, logins are not kept. **Not done:** the cloud session token still lives in `localStorage`. |
| 22 | Fixed | Tier now sets the reasoning effort sent to the model (lite = low, balanced = medium, pro = high). This also fixed a wider bug: `call_model.ts` never passed `reasoningEffort` on, so the chat effort picker had no effect either. |
| 23 | Partly fixed | "Warmwind" is gone from code and prompts. New tests: `worker-audit-fixes.test.ts` (schedules, plan parsing, per-worker stop, event filtering, run history) and new cases in `worker-tool-policy.test.ts`. **Not done:** splitting `page.tsx` / `Desktop.tsx`, removing the duplicate definitions, and the word-list app detection. |

Known test failures unrelated to these fixes: `reference-ui.test.tsx` (expects document-style AI messages) and `thumbnail-preview.test.tsx` (expects the old unopened-terminal thumbnail) check UI that was changed earlier and need updating.

## Summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | The "sandbox" is a `cd`, not a boundary; the local VM can reach the host's files | P0 |
| 2 | On Linux the "VM" is the host itself | P0 |
| 3 | Stop and abort are global: stopping one worker stops every running chat | P0 |
| 4 | A corrupt `workers.json` is read as "no workers" and then overwritten | P0 |
| 5 | A worker left "running" after a crash blocks every schedule forever | P1 |
| 6 | "Run later" always fails ("Tomorrow at 9:00" is not a supported label) | P1 |
| 7 | Schedules only fire while the Workers screen is open and idle | P1 |
| 8 | Stream events without a conversation id leak between workers and the main chat | P1 |
| 9 | Workers can write to the memory shared with the main assistant | P1 |
| 10 | App tools report success for things they did not do | P1 |
| 11 | Deleting a worker leaves its files, cookies, terminals and cloud VM behind | P1 |
| 12 | Chat history lives only in React state | P1 |
| 13 | Unattended runs can wait on `ask_user` forever | P1 |
| 14 | Renderer-supplied input reaches shell and stores with thin checks | P1 |
| 15 | Downloads set their save path too late | P1 (likely) |
| 16 | `computer_use` is rerouted to `navis` with the wrong argument shape | P2 |
| 17 | Store writes happen inside React state updaters and ignore failures | P2 |
| 18 | Schedule model is a label string | P2 |
| 19 | Plan parsing is fragile | P2 |
| 20 | Silent truncation in file listing and command output | P2 |
| 21 | Auth token in `localStorage`; cookies stored in plain text without `safeStorage` | P2 |
| 22 | Tier only changes one sentence of the prompt | P2 |
| 23 | Structure: two 1,300 to 1,900 line components, duplicated definitions, thin tests | P2 |

## P0

### 1. The "sandbox" is a `cd`, not a boundary (Confirmed)

`worker_bash` tells the model "Commands are strictly sandboxed to your worker workspace; host access is disabled" ([worker-tools.ts:199](../main/agent/tools/worker-tools.ts)). The implementation is:

```ts
const sandboxedCommand = `mkdir -p "${ws}" && cd "${ws}" && ${rawCmd}`;   // worker-tools.ts:225
```

Nothing stops `cd ..`, an absolute path, or a symlink. Consequences:

- All local workers share one VM, one user (root, set in `alpine-vm.ts:145`) and one `$HOME`. Any worker can read and change every other worker's workspace at `~/everfern-workers/<other-id>`.
- On Windows the VM is WSL, which mounts the host drives at `/mnt/c`. The code depends on this for file transfer (`translateWindowsPathToLinux`), so it cannot simply be turned off. A worker command can read and write the user's Windows files.
- On macOS the container is started with `-v /Users:/host/Users` ([linux-vm-executor.ts:775](../main/agent/tools/linux-vm-executor.ts)): every user's home directory is mounted read-write.
- `worker_read_file` / `worker_write_file` / `worker_list_files` only reject paths containing the text `..` (lines 267, 317, 364). That also rejects valid names like `notes..txt`, and does not stop a symlink inside the workspace that points outside it.

A worker reads untrusted web pages all day. A prompt injection that reaches `worker_bash` has the user's files.

Fix: run each worker as its own unprivileged user with its workspace as home (or one container per worker), mount only a dedicated transfer folder instead of `/Users` or `/mnt/c` (WSL: `[automount] enabled=false` plus an explicit mount), resolve paths with `realpath` and check the result is under the workspace, and change the tool descriptions to say what is actually enforced.

### 2. On Linux the "VM" is the host (Confirmed)

`runInLinuxVM` runs the command natively when `process.platform === 'linux'` ([linux-vm-executor.ts:454, 615, 694](../main/agent/tools/linux-vm-executor.ts)); `copyIntoWorkspace` uses `fsp.copyFile` straight into the host's home. A worker on Linux has the full rights of the desktop user. In addition, when the VM is down on any platform, commands whose first word looks read-only fall back to the host (line 95), so `cat`, `ls`, `find` and similar read host files.

Fix: use the same container path on Linux as on macOS, and remove the host fallback for worker runs (fail with a clear "computer is not ready" instead).

### 3. Stop and abort are global (Confirmed)

- `acp:stop` takes no arguments and calls `globalAbortManager.setAborted()` ([stream-handlers.ts:61](../main/ipc/agent/stream-handlers.ts)). `stopWorker()` calls it with no conversation id ([worker-engine.ts:322](../src/lib/worker-engine.ts)).
- Every new run calls `globalAbortManager.reset()` ([runner.ts:739](../main/agent/runner/runner.ts)).

So pausing a worker also stops a main-chat answer that is streaming, and starting any new chat or worker run clears a stop that another run has not yet acted on (the stopped run keeps going). The UI then shows a worker as paused while its agent still works.

Related: the AI `client` in `stream-handlers.ts` is shared at module level and `client.setModel()` is called per request (line ~175), so two concurrent runs with different models can change each other's model mid-run. (Each stream does get its own `AgentRunner`, so the worker tool guard itself is not shared between runs.)

Fix: one `AbortController` per conversation id in a map, `acp:stop(conversationId)`, and a client instance per run.

### 4. A corrupt `workers.json` wipes all workers (Confirmed)

```ts
function readAll(): any[] {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf-8')); } catch { return []; }   // worker-handlers.ts:26
}
... fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2), 'utf-8');                  // :31
```

The write is not atomic (a crash or power loss mid-write leaves half a file). The next read fails, returns `[]`, and the next `workers:save` writes a list with one worker over the old file. Every other worker, with its job, apps and schedule, is gone. `workers:save` is also read-modify-write with no lock, and stores whatever object the renderer sends (no schema check, no size limit, no version field for later migrations).

Fix: write to `workers.json.tmp` then rename (the cookie store in the same file already does this at line 64); on a parse error move the file to `workers.json.corrupt-<time>` and surface an error instead of returning `[]`; validate the shape on save; add a `version`.

## P1

### 5. A worker left "running" blocks every schedule (Confirmed)

`status: "running"` is saved to disk ([page.tsx:470, 497](../src/app/workers/page.tsx)). If the app closes or crashes mid-run it is never reset: `useWorkers` only converts `running` to `paused` in the one-time `localStorage` migration ([workers.ts:77](../src/lib/workers.ts)), not on the normal load. After restart the worker shows as running with no agent behind it, and the scheduler skips every tick while any worker is `running` ([page.tsx:627](../src/app/workers/page.tsx)), so no scheduled worker runs until the user notices and pauses it by hand.

Fix: on load, set any `running` worker to `paused` (or `idle`). Better: keep run state in memory in the main process and do not persist it.

### 6. "Run later" always fails (Confirmed)

The post-creation "Run later" button calls `schedule("Tomorrow at 9:00")` ([page.tsx:861](../src/app/workers/page.tsx)). `makeWorkerSchedule` only knows `"Every hour"`, `"Tomorrow at 8:00"` and `"Every weekday at 9:00"` and throws "Choose a supported schedule." for anything else ([worker-schedule.ts:11-17](../src/lib/worker-schedule.ts)). The user gets that error in the chat and no schedule.

Fix: one exported list of schedule options used by both the buttons and the parser (see finding 18).

### 7. Schedules need the Workers screen open and idle (Confirmed)

The scheduler is a 15 second `setInterval` inside the Workers page component ([page.tsx:623-642](../src/app/workers/page.tsx)). It does not run when the user is on another screen or the app is closed, and it skips while a sheet, prompt, draft or dialog is open, while a chat is busy, or while any worker runs. Only one worker runs at a time, so a long run delays all others. The app does say "Keep EverFern open on the Workers screen", but this is far from what "Every weekday at 9:00" suggests.

Also in the schedule code:

- "Every hour" is "one hour after the last run started" (`now + 3_600_000`), so it drifts by the run's length each time.
- `timeZone` is stored but never read; times are whatever the machine's local zone is when computed.
- Missed runs are merged into one (intended), but nothing tells the user a run was missed.

Fix: move the scheduler to the main process (it already owns the store), let it open the Workers window when a run is due, queue due workers instead of dropping the tick, and compute hourly runs from the scheduled time rather than the actual one.

### 8. Stream events leak between runs (Confirmed)

```ts
const mine = (d: any) => !d?.conversationId || d.conversationId === conversationId;   // worker-engine.ts:267
```

An event with no `conversationId` counts as this worker's. `onSubAgentProgress` (line 284) is not filtered at all. With the main chat or another worker streaming at the same time, their tool calls and sub-agent progress show up in this worker's activity feed, and can drive its "current app" display.

Fix: require an exact id match, and make the main process stamp every event (including sub-agent progress) with the conversation id.

### 9. Workers can write shared memory (Confirmed)

`WORKER_SAFE_TOOLS` includes `memory_save`, `remember_fact` and `update_profile` ([worker-tool-policy.ts:54-58](../main/agent/runner/worker-tool-policy.ts)). A worker's input is web pages. Text on a page that persuades the worker to "remember" something lands in the memory the main assistant trusts in every later chat. This is the path by which a web page gets a lasting foothold outside the worker.

`spawn_agent`, `spawn_swarm` and `skill` are also allowed. Sub-runners copy the parent's conversation id ([subagent-spawn.ts:348](../main/agent/runner/subagent-spawn.ts)), so the guard does apply to them; that part is sound. `web_fetch` and `web_search` run from the host, not from the worker's VM, so a worker can reach addresses on the user's local network.

Fix: give workers read-only memory (or a per-worker memory scope), and block private address ranges in `web_fetch` for worker runs.

### 10. App tools report success for things they did not do (Confirmed)

In [worker-tools.ts](../main/agent/tools/worker-tools.ts):

- `open_app` and `switch_app` (lines 50, 101) return success without checking the app is one the worker has, or that a window opened.
- `close_app` (line 169) returns success and does nothing.
- `list_apps` (line 145) returns a fixed list, not the worker's installed apps.

The model plans on false information ("Canva is open") and then fails later in a confusing way, or reports work as done.

Fix: resolve against the worker's `apps`, wait for the window to register in `webview-registry` before answering, and return a clear error otherwise.

### 11. Deleting a worker leaves everything behind (Confirmed)

`workers:delete` only filters the JSON list ([worker-handlers.ts:162](../main/ipc/system/worker-handlers.ts)), and unlike `save` it does not validate the id. Left behind: the workspace in the VM, the browser partition `persist:worker-<id>` with its logins, saved cloud cookies, open terminals, the file watcher, the cloud VM assignment, and the scratch folder `os.tmpdir()/everfern-worker-files/<id>`. The dialog says "Its job, schedule and chat history are removed", which is true but users will assume logins and files go too.

Fix: one `deleteWorker(id)` in main that stops the run, kills terminals and watchers, clears the session partition, removes the workspace and scratch folder, releases the cloud VM, then removes the record.

### 12. Chat history lives only in React state (Confirmed)

`const [chats, setChats] = useState<Record<string, Msg[]>>({})` ([page.tsx:185](../src/app/workers/page.tsx)). Leaving the Workers screen or restarting the app loses every worker's conversation and run log. Each run also uses a fresh conversation id (`worker-<id>-run-<time>`, [worker-engine.ts:264](../src/lib/worker-engine.ts)), chosen to stop new jobs resuming old ones, so the agent has no memory of earlier runs either. A scheduled worker cannot answer "what did you do yesterday?", and the user has no record of unattended runs.

Fix: persist a per-worker run log (start, end, result, summary, error) in main, and feed the last few summaries into the run brief.

### 13. Unattended runs can wait forever (Confirmed)

`ask_user` and `ask_user_question` are allowed in all worker runs ([worker-tool-policy.ts:52-53](../main/agent/runner/worker-tool-policy.ts)), including scheduled ones. With nobody there the run stays `running`, which (finding 5, 7) also stops every other scheduled worker.

Fix: mark scheduled runs as unattended; give questions a timeout that ends the run with "needs your answer" and a notification.

### 14. Renderer input is trusted too much (Confirmed)

- `workers:vm-exec` runs any command string from the renderer in the VM ([worker-handlers.ts:175](../main/ipc/system/worker-handlers.ts)). Combined with finding 1, any script that runs in the renderer can reach host files.
- `workers:webview-register` accepts any `wcId` for any partition (line 69); it does not check the webContents actually belongs to that partition, so one window can be registered as another worker's.
- `workers:save` stores any object.

Fix: validate on the main side (owner of the wcId, command allow-list or remove the raw exec channel, schema for saved workers).

### 15. Downloads set their save path too late (Likely)

In `routeDownloadsToWorkspace`, `item.setSavePath(tmp)` runs inside `hostScratch(workerId).then(...)` ([worker-tools.ts:~700](../main/agent/tools/worker-tools.ts)). Electron only honours `setSavePath` synchronously inside `will-download`; set later, the default save dialog appears instead (or the call throws, which the `try` swallows). The first download of each worker, before the scratch folder exists, is the most exposed. Also `copyIntoWorkspace` for cloud workers reads the whole file into memory and sends it as base64 in one request, which will fail on large downloads.

Fix: compute the scratch path synchronously (`path.join(os.tmpdir(), ...)`, `mkdirSync`), and stream large files.

## P2

### 16. `computer_use` is rerouted with the wrong arguments (Confirmed)

`guardWorkerTools` passes a `computer_use` call straight to `navis.execute(...args)` ([worker-tool-policy.ts:108-115](../main/agent/runner/worker-tool-policy.ts)). The two tools take different arguments, so the call fails or does something unintended. It is also dead in practice: `computer_use` is not in `WORKER_SAFE_TOOLS`, so `_buildToolDefinitions` never offers it to a worker. Remove the branch.

### 17. Store writes inside state updaters (Confirmed)

`useWorkers.save` and `remove` call the IPC inside the `setWorkers` updater ([workers.ts:94-110](../src/lib/workers.ts)). React may run updaters twice (it does in StrictMode), so saves and deletes fire twice. The returned promise is ignored: if the save fails the UI still shows the change. Since every save rewrites the whole file (finding 4), two quick saves can also interleave.

### 18. The schedule model is a label (Confirmed)

A schedule is identified by its display string, and `advanceWorkerSchedule` re-parses that string ([worker-schedule.ts:22](../src/lib/worker-schedule.ts)). Renaming a label, translating the UI, or adding an option breaks saved schedules (they throw on the next advance). This is the root cause of finding 6. Store `{ kind, hour, minute, days, timeZone }` and derive the label.

### 19. Plan parsing is fragile (Confirmed)

`planJob` takes the text from the first `{` to the last `}` ([worker-engine.ts:135](../src/lib/worker-engine.ts)). A reply with a brace in prose before the JSON, or two JSON objects, fails to parse. Use the provider's JSON mode or a tolerant extractor, and validate the shape.

### 20. Silent truncation (Confirmed)

`worker_list_files` returns at most 100 entries and `workspaceList` 300; VM output is cut at 50,000 characters. None of these tell the model that more exists, so it can conclude "the file is not there". Add an explicit "N more not shown" line (the browser snapshot already does this).

### 21. Secrets at rest (Confirmed)

- The cloud session token is read from `localStorage` ([cloud-vms.ts:18-21](../src/lib/cloud-vms.ts)), readable by any script in the renderer.
- Saved browser cookies fall back to plain text when `safeStorage` is unavailable ([worker-handlers.ts:60](../main/ipc/system/worker-handlers.ts)), with no warning. These are live login sessions.

What is sound here: the cloud API URL is restricted to `everfern.app` hosts in `webview-registry.ts:88`, and the token is kept in memory only on the main side.

### 22. Tier changes one sentence (Confirmed)

`Worker.tier` (lite / balanced / pro) only selects an "Effort:" line in the prompt ([worker-prompts.ts:144-150](../src/lib/worker-prompts.ts)). It does not change the model, the reasoning effort passed to the stream, or any step limit. If tiers are sold as different capability, the run does not reflect it.

### 23. Structure and tests

- [page.tsx](../src/app/workers/page.tsx) (1,917 lines) holds the scheduler, run orchestration, cloud boot, chat state and most of the UI. `Desktop.tsx` is 1,336 lines. The run logic cannot be tested without rendering the page, which is why findings 5 to 7 went unnoticed.
- Which apps a job needs is decided by a hard-coded word list (`amazon`, `canva`, `moss`, `linkedin`) in `withJobApps`.
- Duplicates: two `ActionName` definitions (`navis/core/types.ts`, `navis/actions.ts`), two orchestrators (`navis/orchestrator.ts`, `navis/agent/extension-orchestrator.ts`), several `safeId` helpers.
- Naming: comments and prompts still say "Warmwind" in places.
- Tests for the core paths are 6 to 68 lines each. There is no test for: path escape from a workspace, the tool guard, store corruption, stop affecting only one run, or each schedule button producing a valid schedule. Four navis suites need the Playwright browser installed and currently fail without it.

## Suggested order of work

1. **Data safety, small changes:** atomic store write and corrupt-file handling (4), reset `running` on load (5), fix the "Run later" label (6). Each is a few lines.
2. **Stop and events per conversation** (3, 8).
3. **Real isolation** (1, 2, 14): per-worker user or container, no host mounts, no host fallback, path checks with `realpath`. This is the largest piece and the one that matters most before workers run unattended on untrusted sites.
4. **Memory scope and unattended behaviour** (9, 13), then honest app tools (10) and full delete (11).
5. **Move the scheduler and run log into main** (7, 12, 18), and split `page.tsx` so the run logic can be tested (23).
