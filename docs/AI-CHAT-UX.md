# The worker chat: UX and how the AI's messages are formatted

How the worker chat should look and read, what is wrong with it today, and what to fix, in order. The goal is that a run reads like a short, calm conversation with a capable colleague, not a log.

Related docs:

- `LIQUID-GLASS.md`: the material.
- `WORKER-VISUAL-REFERENCE.md`: the Warmwind references.
- `src/lib/worker-prompts.ts`, Law 8: the rules the model is given for its replies.

## What is on screen

The chat (`Chat` in `src/app/workers/page.tsx`) is a column of messages sitting straight on the wallpaper, with the window thumbnails on its left and the plan panel on its right.

| Kind | What it is | Surface |
|---|---|---|
| `user` | What the person typed | Dark bubble, right-aligned |
| `ai` | The model's reply, Markdown via `ReplyMarkdown.tsx` | No surface: text on the wallpaper |
| `tool` | One action the worker took | A small pill |
| `reason` / `thinking` | "Reasoning carefully...", shimmer while live | Plain text, centred while live |
| `flow` | "Workflow created": the steps of the job | Dark glass card |
| `report` | The end-of-run report, with Run again and Schedule | Text on the wallpaper; tables and cards on glass |
| `ask` | A question with suggested answers | Glass answer pills and an answer field |
| `open` | "Still open: ..." | Light glass card |

## Problems found (11 Nov flight run)

1. **White outlines everywhere.** The cards, the Run again and Schedule pills, the table, the window thumbnail, the plan chips and the schedule icon all had a 1px white border or rim. Over a bright wallpaper the outline was the loudest thing on screen, and it made the glass read as a flat grey sheet with a box around it. *Fixed.*
2. **The chat ran under the window thumbnail.** The thumbnails take about 240px on the left. The chat was centred only against the plan panel, so on a normal window the "Workflow created" card and its step numbers slid under the Browser thumbnail. *Fixed.* The chat now centres between the thumbnails and the plan, and never gets wider than that space.
3. **Ragged left edge in "Workflow created".** The check icon, the step numbers and the Run now button each sat at a different x. *Fixed.* They now share one edge, 24px in.
4. **Two step lists that disagree.** The chat card says 4 steps ("In Browser, navigate to Google Flights...") while the plan panel says 3 differently worded steps, for the same job. The person can't tell which is real. *Fixed.* The run's own agent was replacing the workflow's steps with its own `create_plan` list. Now the plan panel always shows the workflow's steps, and the agent's list only moves the ticks along them.
5. **Wrong app chip.** A Google Flights step shows an "X" chip. Chips must come from the apps the step actually used, not from the worker's app list. *Fixed.* The old match looked for the app id as a substring, so "x" in "extract" or "execute" counted as the X app. Matching is now by whole word, and names of two letters or fewer must also match in case.
6. **Planner steps are long and procedural.** "Set departure to Hyderabad (HYD), destination to Rotterdam (RTM), and select one-way travel for one passenger." A step should be a short outcome that fits on one or two lines; the details belong in the step's muted second line. *Fixed* in the planner prompt: a 4 to 10 word title, then a colon and the details on the same line.
7. **Poor table data.** In the results table, the column "Airways" holds "→ AMS". Header and value don't match, and an arrow is a symbol, not data. *Fixed* in Law 8 (see the table rules below).

## Principles

- **The person reads outcomes, not process.** Actions already show as tool pills and in the plan. The text says what happened and what is needed, nothing else.
- **One surface per message, at most.** A reply is text on the wallpaper. Only things that are *objects* get glass: a workflow, a table, a result card, a question. Never put glass inside glass.
- **No outlines.** Edges come from light inside the glass and the shadow under it (`LIQUID-GLASS.md`). A 1px border is allowed only under `prefers-contrast: more`.
- **One left edge.** Icons, numbers, text and buttons inside a card line up on a shared edge. The card's own padding is the only indent.
- **Quiet until it matters.** No messages while working except a one-line start, a blocker, and the report.

## How the AI should format its messages

These match Law 8 in `worker-prompts.ts`; changes here should be made there too.

### By moment

| Moment | Length | Shape |
|---|---|---|
| Start of a run | 1 sentence | "Searching Google Flights for one-way HYD to RTM on 15 Nov." |
| Progress | Nothing | The tool pills and plan show it |
| Blocked or needs approval | 1 to 3 lines | The exact question, then the draft or choice. Suggested answers as `ask` options, never as prose lists |
| Short answer to a question | 1 or 2 sentences | No heading, card or list |
| End-of-run report | Title, one result card, optional numbers or table, up to 5 bullets | See below |

### The report

~~~
# Cheapest HYD to RTM flights        <- 3 to 6 words, says the outcome

```card
### Result
The cheapest one-way on 15 Nov is **₹38,420** with KLM via AMS, 14h 5m.
```

| Airline | Stops | Duration | Price |   <- only when rows are compared
|---|---|---|---|
| KLM | 1 (AMS) | 14h 5m | ₹38,420 |

- Searched Google Flights for 15 Nov, one adult, economy.
- 6 options found; the table shows the 4 cheapest.
- Prices change quickly, so book soon if one works.
~~~

Rules for the report:

- **Title says the outcome**, not the task: "Cheapest HYD to RTM flights", not "Flight search results".
- **The result card holds the one number that matters**, in bold so it renders large.
- **Tables:** 3 to 5 columns, each header a noun, and each cell matches its header. Units go in the cell ("14h 5m", "₹38,420"), not the header. No symbols as data (no "→", no checkmarks). Sort by what the person asked for (price, date). At most 8 rows, then say how many more there are.
- **Bullets:** one fact each, past tense, with numbers. What was done, what is waiting on the person, what failed and why.
- **Never:** emojis, tool names, step IDs, "Certainly", reasoning, or a recap of every click.

### Plan steps (the planner)

- 3 to 6 steps. Each step is a short **outcome in the imperative**, 4 to 10 words: "Search one-way flights on Google Flights".
- Details go after a colon on the same line: "Search one-way flights on Google Flights: HYD to RTM, 15 Nov, 1 adult". The app shows the part after the colon as the muted second line (`parseStepParts`).
- Never a line break inside a step: the saved workflow is one step per line, so `parseSteps` would read it as two steps.
- One list. The chat's "Workflow created" card and the plan panel must show the **same** steps in the same words (problem 4).
- When a run starts, the agent is told to use the workflow's steps word for word as its plan (Law 5 and `runTask`). If it still writes its own list, the app keeps the workflow's steps on screen and maps the agent's progress onto them (`planStepDone` in `step-apps.ts`).
- App chips list only the apps the step uses (problem 5). The apps the agent really drove come first. Then come the apps the step names as whole words; "Google Sheets" in a step never also counts as "Sheets". Only then are guesses from the step's verb used (`stepApps`).

## Layout and spacing

One 4px grid. Inside the chat:

| Token | Value | Used for |
|---|---|---|
| Message gap | 12px | Between messages in the column |
| Card padding | 14px vertical, 16px to the content edge | Workflow card, tables, result cards |
| Row padding | 7px vertical | Step rows; the highlight of the current step fills the row |
| Icon to text | 12px | Check, step number or dot to its text |
| Button gap | 8px | Between pills in a row |
| Section gap | 12px | Steps to buttons, table to footer |

Column width:

- normal: 480px;
- with a plan: 642px;
- with a wide table: up to 900px.

In every case the column is capped to the space between the thumbnails (240px) and the plan (392px), minus 40px.

Type:

| Text | Style |
|---|---|
| Reply body | 15px/1.6 |
| Card titles | 14px, 600 weight |
| Step text | 13.5px/1.45 |
| Timestamps | 11px, tabular figures, 68% white |
| Report title | 20px |

Nothing smaller than 11px.

## Materials in the chat

| Surface | Material |
|---|---|
| Workflow card, tables, buttons on the wallpaper | Dark glass: `rgba(12,20,26,.3)` with a white top gradient, 14 to 18px blur, `saturate(1.7)`, the `#ef-lg` lens, soft inset light at the top, and a wide soft shadow |
| Run now, Edit task | Solid white pill. The single primary action per card |
| Window thumbnails | The screenshot is the edge; a shadow lifts it. No border |
| Reply text | Nothing behind it; a soft text shadow keeps it legible on bright wallpaper |

The fallbacks are in `liquid-glass.css`:

- reduced transparency: solid `#1d272c`;
- more contrast: a 1px white ring.

## To do, in order

1. **Start line.** Show the model's one-sentence start message under the user's message while the run is live, so the first thing the person sees is confirmation in words, not only pills.
2. **Long reports.** Fold bullets past the fifth behind "Show more".

## Done in this pass

- `liquid-glass.css`:
  - removed the white rim and the hairline from `.lg-glass`, the glass pills, the plan chips and the schedule icon;
  - the workflow card, the Run again and Schedule pills, the chat buttons and the reply tables are now borderless dark glass;
  - the thumbnails have no border.
- Spacing:
  - the workflow card shares one 24px left edge;
  - the plan panel has a little more room between the header, the Edit task button, the steps and the chips;
  - the chat column clears the thumbnails and the plan.

## Done in the second pass

- **One step list.** At the start of a run, the plan panel shows the workflow's steps. An agent `create_plan` no longer replaces them; it only paces the ticks (`page.tsx` `run`; `planStepDone`). Pause and Continue use the same list.
- **Chips.** `appsInStep` and `stepApps` moved to `src/app/workers/step-apps.ts`:
  - whole-word, Unicode-aware matching;
  - short names must match in case;
  - a longer app name hides a shorter name inside it.
  - Tests are in `__tests__/step-apps.test.ts`.
- **Planner.** The new step style (title, a colon, then details) has good and bad examples in `plannerPrompt`.
- **Law 5.** Use the job's workflow steps as the plan, word for word.
- **Law 8.** Table rules:
  - 3 to 5 columns with noun headers;
  - cells that match their header;
  - units in the cell;
  - no symbols as data;
  - sorted;
  - at most 8 rows, then a count of the rest.
