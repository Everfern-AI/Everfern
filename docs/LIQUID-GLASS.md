# Liquid Glass vs glassmorphism

Why the Warmwind-style plan card and AI cursor look clean and Swiss while most of our floating UI looks foggy, what we changed, and what is still left on the old material.

## TL;DR

Most of EverFern uses **glassmorphism**: a heavy blur plus a tinted fill plus a 1px border. Each piece is fine, but together they make every panel a grey-teal fog that dims what's behind it and draws a box around itself.

**Liquid Glass** (the Apple and Warmwind look) uses less of all three and adds two things glassmorphism doesn't have:

- **refraction:** the backdrop bends at the edges, as it does through a real lens;
- **specular light:** bright highlights on the rim and a sheen across the top.

The result reads as a *clear, thick object* floating above the content, not a smoked-glass window.

## What makes it different

| | Glassmorphism (our old panels) | Liquid Glass |
|---|---|---|
| **Backdrop** | Heavy uniform blur (28–30px). Everything behind turns to mush. | Light blur (3–14px). The backdrop is still recognisable through the glass. |
| **Edges** | Nothing happens at the edge, so it reads as a flat sheet. | **Lensing.** The backdrop is pulled inward near the rim and the middle stays undistorted. This is what makes it look thick. |
| **Fill** | A tinted wash, often teal or grey (`#203e4b32`, `#2439414a`). It adds colour that isn't in the scene. | Almost none (`rgba(255,255,255,.04)`). Colour comes from what's behind it. |
| **Colour** | `saturate(1.1–1.2)`, so it looks washed out. | `saturate(1.8) brightness(1.05)`. Colours behind the glass get *richer*, like a real lens. |
| **Outline** | A uniform 1px `#ffffff26` border, like a box drawn around content. | No border, rim or hairline. The edge is soft light pooled inside the top and bottom of the glass, plus the shadow under it. (We tried a 1px gradient rim; over bright wallpaper it read as a white outline.) |
| **Depth** | A single drop shadow. | Layered: soft inset light at the top, a faint bottom bounce, an inner glow, and a soft *wide* outer shadow. It floats instead of sitting. |
| **Highlights** | None. | A broad radial **sheen** across the upper part. |
| **Type on it** | Mid-grey text that often fails contrast. | High-contrast near-white (or near-black on light glass), slightly heavier weight, tight tracking on titles. |
| **Palette** | Teal, slate, blue, plus a tint per component. | Monochrome, with **one** accent (status: green for live, amber for paused). |

### Why it feels "Swiss"

- **One material.** Every floating surface (cards, pill, cursor) is the same glass, so nothing competes.
- **Grid and rhythm.** The plan is two cards with the same 26px radius and 16px gutters, and steps on a single vertical rail.
- **Hierarchy from type, not boxes.** A small caps status line, a bold step title, a muted detail, then chips. No dividers.
- **Restraint.** Glass is reserved for chrome that floats *over* the desktop. Content inside it (steps, text) sits on the glass and never gets its own glass layer. Glass on glass destroys legibility.

## How ours works

The files are in `src/app/workers/`:

- **`liquid-glass.tsx`: `LiquidGlassDefs`.** It renders one hidden SVG `<filter id="ef-lg">`. Two `feImage` gradients build a displacement map: red shifts pixels horizontally and green shifts them vertically, 50% grey means no shift, and the outer 16% on each side ramps to full. `feDisplacementMap` (scale `0.06`, `primitiveUnits="objectBoundingBox"`) bends the backdrop at the edges only. Because the map is in the element's own box, the same filter fits a 23px cursor orb and a 360px card. It's mounted once inside the `.wk` root.
- **`liquid-glass.css`: the `.lg-glass` material.**
  - `backdrop-filter: url(#ef-lg) blur(var(--lg-blur)) saturate(1.8) brightness(1.05)`. The plain blur version is declared first, so a browser that rejects `url()` in `backdrop-filter` still gets glass.
  - Layered `box-shadow` provides the soft top light, the bottom bounce, the inner glow and the outer float. There is no 1px ring.
  - `::before` is unused; `::after` is the sheen.
  - Each surface can override `--lg-tint` and `--lg-blur`: the cursor orb is the clearest, the plan cards are slightly frostier for legibility.
- **Where the glass goes is set by the Warmwind references, not by "everything that floats".** Their AI text sits plain on the wallpaper; only a few pieces of chrome are glass:
  - *dark glass pills:* History (`.wk-history`), the collapsed chat (`.wk-chat-peek`), suggested answers (`.wk-q-opt`) and the answer field (`.wk-q-input`);
  - *light glass:* the "Still open" card (`.wk-open`), app login rows and Continue (`.wk-lg-row`, `.wk-lg-continue`), and the side window labels (`.wk-thumb-bar`).

  These are styled from `liquid-glass.css` alone, without the `.lg-glass` class, because some already use `::before`/`::after` (the chat pill's stacked cards). Their edge is soft inset light, never a ring.
- **Users of `.lg-glass`:**
  - the AI cursor orb (`.wk-ai-orb`), whose centre is the exact click point and which presses in and springs back on each click;
  - its status pill (`.wk-ai-bubble`);
  - the plan's "Set a task schedule" card, the schedule menu, and the task card (`.wk-lp-*`).
- **Accessibility fallbacks** (in the same file):
  - `prefers-reduced-transparency`: solid surface, no lens or blur;
  - `prefers-contrast: more`: solid surface plus a real border;
  - `prefers-reduced-motion`: no press bounce or ripple.

### Using it on a new surface

```tsx
<div className="my-card lg-glass">…</div>
```

```css
.my-card.lg-glass { --lg-tint: rgba(255,255,255,.06); --lg-blur: 12px; border-radius: 24px; }
```

Rules:

- Use it only on things that float over the desktop or a wallpaper.
- Never put glass inside glass.
- Give the element a `border-radius`; the rim and sheen inherit it.
- Don't add a `border` or a 1px inset ring; it reads as a white outline. Let the inset light and the shadow make the edge.

## Audit: what is still glassmorphism

Found by grepping `backdrop-filter: blur` in `src/app`. These still use the old blur-plus-tint-plus-border recipe and should move to `.lg-glass` (or become solid, if they aren't floating chrome).

### High priority: floating chrome over the desktop

| Surface | Where | Problem |
|---|---|---|
| `.wk-task-surface`, `.wk-task-schedule(-menu)` | `materials.css` | 28px blur, teal tint `#2439414a`, 1px border |
| `.wk-report`, `.wk-login-card`, `.wk-ready-card` | `materials.css` | 30px blur, tint `#203e4b32`, 1px border |
| `.wk-pl` (old docked plan stack) | `worker-reference.css` | Frosted with a border. The docked thumbnail should match the new open card. |
| `.wk-thumb-card` | `materials.css` | Tinted `#233d472b` with a border (its label bar is already glass) |
| `.wk-win .wk-win-bar` | `worker-reference.css` | Window title bars are frosted strips |
| `.wk-chat .wk-msg-user`, `.wk-msg-ai`, `.wk-msg-tool` | `workers.css` | Every chat bubble blurs. In the references the AI text sits on nothing, so these should lose their frost rather than gain glass. |
| `.wk-plan-card`, `.wk-flow.wk-glass`, `.wk-center-steps` | `workers.css` | The "Workflow created" card and centre steps are tinted frost |
| `.wk-hist`, `.wk-created-btn`, `.wk-completed-*`, `.wk-run-stop` | `workers.css` | Buttons and chips with their own blur. These should be solid or plain text on the surface they sit on. |
| `.wk-sheet` | `worker-reference.css` | `#23384380` tint with a border |

### Medium: global and other pages

| Surface | Where | Note |
|---|---|---|
| `.liquid-glass` | `globals.css` | Named "liquid glass" but it's glassmorphism: a tinted `color-mix` fill, a 1px border, and no refraction. Used by `chat/components/TodoPanel.tsx`. Point it at the same recipe, or swap it for `.lg-glass`. |
| `.user-msg-glass` | `globals.css` | Chat-page user bubble, frosted |
| `.dashboard-toast` | `globals.css` | Toast, frosted with a tint |
| `.wk-r-card`, `.wk-r-table`, `.wk-stat-card` | `workers.css` | Report content. These should be **solid** (content, not chrome); blur here only costs legibility. |

### Fine as they are

These are scrims, where a plain blur is correct: they dim and separate, they don't float.

- `.wk-modal-scrim`
- `.wk-full-scrim`
- `.wk-lg-backdrop`
- `.wk-logins-overlay`
- `.wk-remove-overlay`
- `.ef-confirm-backdrop`
- `.wk-vm-boot`

### Already replaced

- **The old AI cursor** (a teal arrow, a teal ping and a separate verb label) is now one glass orb plus a glass pill.
- **The chrome the references show as glass:** History, the collapsed chat, the answer choices and answer field (dark glass), and the "Still open" card, login rows, Continue and window labels (light glass).
- **The auto-docking plan stack** is now the open Warmwind-style plan: a schedule card plus a task card with an "Edit task" button, a timeline and app chips.

## Migration order

Only surfaces the references show as glass get the material; the rest become solid or plain.

1. **The chat bubbles.** They cover the largest area and are the most visible "fog". Drop the AI bubble's frost so its text sits on the wallpaper, as in the references.
2. **The report, login and ready cards, and the task surface.** Swap the tint and border for `.lg-glass`, raising `--lg-blur` to about 16px if text sits on busy footage.
3. **Window title bars and the docked plan thumbnail.**
4. **`globals.css` `.liquid-glass`.** Re-point it to the `.lg-glass` recipe so the chat page's TodoPanel matches the workers page.
5. **Report content cards.** Make them solid.

## Known limits

- `backdrop-filter: url(#…)` refraction works in Chromium, which includes Electron. Safari and Firefox ignore the `url()` declaration and use the plain-blur fallback, which is still clean but has no lensing.
- The lens samples only what's *inside* the element's box, so the edge bend is subtle (scale `0.06`) by design. Raising it past about 0.1 starts smearing text behind the glass.
- Each `.lg-glass` element is a separate backdrop pass. Keep them to a handful on screen; don't put them on list rows.
