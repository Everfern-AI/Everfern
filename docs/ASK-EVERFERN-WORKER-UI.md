# Ask EverFern in the worker UI

Plan for turning the "Ask EverFern" page into part of the worker app, so EverFern
feels like one product: you chat in one place, and a worker picks up anything that
needs doing. The model is Codex inside ChatGPT: chat is the front door, the agent
is a task you hand off from the same thread and watch from there.

Status: plan only. Nothing here is built yet.

Note: this plan covers the UI. Behind it the chat and the workers are now two separate
agents (prompt, database, memory); see `AGENT-SPLIT.md`. The hand-off in this plan still
works: the Ask thread starts a worker run, it does not share state with it.

Assumption: "dots" in the request is read as "the agent you hand off to", which
here is the EverFern worker. If it meant a specific ChatGPT visual, only the
"Task card" section below changes.

## Where things stand

| | Workers (`/workers`) | Ask EverFern (`/chat`) |
|---|---|---|
| Entry | App lands here (`src/app/page.tsx` pushes `/workers`) | Two buttons in `workers/page.tsx` (lines 995 and 1289) call `router.push("/chat")` |
| Page | `workers/page.tsx`, 2,210 lines | `chat/page.tsx`, 9,531 lines, about 170 `useState` |
| Shell | Wallpaper, notch, glass bottom bar, sheets | Its own `Sidebar`, header, theme variables, `SettingsPage` (6.8k lines) |
| Way back | Notch logo | Sidebar "Workers" item does `window.location.href = "/workers"` (full reload) |
| Agent call | `acp.stream` with `operatorMode: true` and `systemPromptAppend` (`lib/worker-engine.ts`) | `acp.stream` with `operatorMode: pursueGoalMode` |
| Thread UI | `Chat`, `PlanPanel`, `AskCard`, `Reasoning`, `RunReportCard`, `ReplyMarkdown` | `MarkdownRenderer`, `ToolCallRow`, `ReasoningPane`, about 50 components |
| History | Per worker, `saveWorkerChat` in `lib/workers.ts` | `electronAPI.history.save / list / load` |

Two things follow from this:

1. Both pages already talk to the same agent in the main process. This is a
   renderer job; the main process needs little or no change.
2. The two pages share almost no UI code. Clicking "Ask EverFern" is a jump to a
   different-looking app, and coming back reloads the window.

## What we are building

One shell, three places:

```
 notch:   [Apps] | everfern | [Ask]

 Ask            the chat thread, centred on the wallpaper (new)
 Workers        the grid of workers (today's Home)
 A worker       its desktop, windows and chat (today's desktop mode)

 bottom bar:  worker avatars | composer pill | settings, notifications
```

- **Ask is a mode of the workers page, not a route.** `Mode` gains `"ask"`. The
  notch, wallpaper, bottom bar and sheets stay mounted, so switching is instant
  and a running worker is never torn down.
- **The composer is the same pill** already in the bottom bar. In Ask it sends to
  the thread; inside a worker it sends to that worker, as now.
- **The thread reuses the worker chat pieces**: `ReplyMarkdown`, `Reasoning`,
  `AskCard`, `DotSpinner`, and the glass styles in `liquid-glass.css`.

### How a message is routed

`planJob` in `lib/worker-engine.ts` already sorts a message into `chat`, `do` or
`workflow`. Ask uses the same split:

| Kind | In Ask |
|---|---|
| `chat` | Streamed reply in the thread. No worker involved. |
| `do` | A task card appears in the thread and a worker starts on it. |
| `workflow` | A task card with the steps and two choices: run now, or save to a worker and schedule. |

### Task card (the Codex part)

When a message becomes a task, the thread shows one card for it:

- worker avatar and name, the task title, a live status line (the same short
  label the cursor pill shows, from `toolLabel`)
- step progress from the existing plan state (`runPlan`), as "2 of 4"
- Pause, and "Open" which switches to that worker's desktop with the run on screen
- when finished, the card becomes the existing `RunReportCard`

The run itself is an ordinary `runWorker` call, so reload survival
(`liveRuns` / `attachRun`, `live-run.ts`) works for task cards with no new code
beyond re-linking the card to its `conversationId`.

### Which worker takes the task

Recommended: a built-in default worker named "EverFern" that always exists, so
Ask can do things with no setup. A chip in the composer shows who will take the
task and lets you pick another worker. This matches Codex, where there is always
a default environment and you can switch.

## Build order

Each phase ships on its own and leaves the app working.

### Phase 0: pull the thread out of `workers/page.tsx` (small, no visible change)

Move into `src/app/workers/thread/`: `Chat`, `PlanPanel`, `AskCard`, `Reasoning`,
`DotSpinner`, `RunReportCard`, `ModelFailure`, the `Msg` type and `chatSessions`.
Extract the composer pill into its own component with `onSend`, `placeholder`,
`busy`, `onStop` props. The 26 worker tests must still pass.

### Phase 1: Ask as a mode (medium)

- `Mode` gets `"ask"`; both "Ask EverFern" buttons set the mode instead of
  `router.push("/chat")`.
- New `AskView`: a centred glass column (about 720px) with the thread, an empty
  state with a few starter prompts, and a History sheet.
- New `askStream` in `worker-engine.ts`: `acp.stream` with `operatorMode: false`,
  a conversation id of `ask-<id>`, and the existing `listen` helper for text,
  reasoning and errors.
- Save and list conversations through `electronAPI.history`, so chats made in the
  old page still show up. Needs checking: whether old saved messages render
  cleanly through `ReplyMarkdown`.
- Stop, retry and edit-last-message.

Done when: a plain question can be asked, answered, found again in History, and
you can switch to a worker and back without a reload.

### Phase 2: hand-off to workers (medium)

- Default "EverFern" worker, created on first use.
- Route `do` and `workflow` through `planJob`; add the task card and the worker
  chip in the composer.
- "Open" on a card switches to the worker's desktop; the worker's own chat gets
  the same task, so both views agree.
- On reload, re-link cards to live runs through `liveRuns`.

Done when: "book me a table for two on Friday" in Ask starts a worker, shows
progress in the thread, and ends in a report card.

### Phase 3: bring over what people use from the old chat (medium to large)

| Feature in `/chat` | Plan |
|---|---|
| File and folder attachments | Port. Needed for everyday questions. |
| Model and reasoning picker | Reuse `workers/ModelSettings.tsx`. |
| Artifacts and file viewer | Port as a worker-style window or sheet. |
| Context token ring, rate-limit and cloud banners | Port the logic, restyle. |
| Human-approval forms, user questions | Already covered by `AskCard`; map the old events onto it. |
| Projects | Decide: likely becomes the worker's folder. |
| Scheduled tasks | Drop. Workers have schedules. |
| Subagent panel, debate mode, analytics, voice overlay, site preview | Leave in classic chat until someone asks for them. |

### Phase 4: retire `/chat` (small)

Keep the old page reachable as "Classic chat" from Settings through phases 1 to 3.
Once phase 3 is done: redirect `/chat` to `/workers` in Ask mode, remove the
"Workers" item from `Sidebar.tsx`, then delete `chat/page.tsx` and whatever only
it imports. This removes roughly 16k lines.

## Why not restyle the existing chat page

`chat/page.tsx` is 9.5k lines with about 170 pieces of state and its own sidebar,
settings and theme. Reskinning it would keep two shells, keep the route change,
and still not give task cards. Building Ask on the worker pieces is less code and
ends with one UI to maintain.

## Risks

- **Feature gaps during the switch.** Mitigated by keeping Classic chat until
  phase 3 is done.
- **`workers/page.tsx` grows further.** Phase 0 exists to stop that; `AskView`
  must live in its own file with its own state hook.
- **Old history format.** Tool calls and attachments saved by the old page may
  not render in the new thread. Check in phase 1 with real saved chats; fall back
  to showing text only.
- **Two chats for one task** (the Ask card and the worker's own chat). Both must
  read from the same run; do not copy messages between them.

## Decisions needed

1. Default worker: a built-in "EverFern" worker (recommended), or ask which
   worker every time?
2. Start screen: stay on Workers, or open on Ask like ChatGPT does?
3. Projects: fold into worker folders, or keep as a separate concept?
4. Is anything in the "leave in classic chat" row something you use daily?
