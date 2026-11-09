# EverFern interface audit — 7 November 2026

## Reference lock and method

Primary target: the user's desktop references and the latest highlighted task panel. Preserve the landscape, light outer frame, Satoshi, colorful app icons, centered dock/composer and requested compact desktop density. Apply apple-design's material hierarchy, immediate press feedback, interruptible springs, spatial consistency, reduced motion/transparency and legibility rules.

Research: [Dimension](https://www.dimension.dev) via Refero style f2951292-dcf2-48db-af42-4bb3b783eb6e supplies translucent panels and restrained elevation; [Desktop.fm](https://desktop.fm) style 5b70f172-2ba2-4f26-9956-251d4cfc0329 supplies compact OS control grouping; [ChatGPT](https://chatgpt.com) style 667cf5b9-5940-4db5-a972-fb6bd51d5783 supplies quiet hierarchy. [Apple Games details](https://refero.design/screens/cd4a71f5-c654-41f5-a977-8d45fa74d356) and [Shopify app listings](https://refero.design/screens/2d555db9-b495-4bdd-85ab-1af52e0d7e0e) inform the marketplace's separate chrome, readable details and consistent rows. Do not adopt these references' fonts, accent meanings, or unrelated marketing layouts.

Decision ledger: one 28–36px blur on large floating panels; 16–20px on small chrome; translucent inset cards without another blur/shadow; one soft elevation shadow; 4px spacing rhythm; 13–14px body, 12px metadata, 20–24px section headings; regular/medium Satoshi with weight 600 for hierarchy; no ornamental thick white top border. Native code/terminal remains monospace.

## Scope and evidence

Source review covers all seven routes: welcome, authentication, setup, workers, chat, narrative overlay, and computer-control overlay. Within workers: Home/creation, desktop, task panel, chat/completion, dock/thumbnails, Settings tabs, marketplace catalog/search/custom app/detail/reviews, template sheet, confirmations, loading/error states. Source review and isolated rendered component checks are distinct from signed-in production/VM validation; runtime evidence and limitations are recorded below.

## Findings and remediation

| Priority | Surface | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | App previews | Shared VM iframe duplicated one foreground screen under every app name. | Replaced with real worker/app-scoped captures; Browserbase page capture, VPS container screenshot, Alpine DevTools capture. Decorative browser header and hidden host webviews removed. |
| P1 | Spacing | Unlayered reset overrode Tailwind padding, margins and white heading colors. | Defaults moved into base layer; completion/product rendering verified. |
| P1 | Task panel | Heavy dark slab and bright full-width button overpower workflow; panel can collide with central content. | Implemented tinted 28px glass, restrained edge/elevation, quieter Edit task control and compact responsive positioning. |
| P1 | Thumbnail depth | Parent drop-shadow plus child shadow creates a black halo and dark scroll-region edges. | Implemented: parent filter removed, single low-opacity card shadow, gentler 16° tilt and interruptible non-bouncy hover spring. |
| P1 | Dialog keyboard access | Sheets identify as dialogs but lack consistent focus containment/restore and modal semantics. | Implemented shared focus containment/restore and modal semantics for marketplace, templates and Settings. |
| P1 | Scheduling | `schedule()` currently changes status and writes a chat confirmation; it does not persist an execution schedule or register a scheduler. | Removed the false scheduled-success confirmation and status mutation; now explains that automatic scheduling is unavailable. Backend scheduling remains required. |
| P1 | Account name | Name edit does not mark form dirty or persist alongside preferences. | Implemented dirty state and local profile save, including camelCase session fields; preserves the current session and reports storage failures. Server profile sync remains separate. |
| P2 | Marketplace catalog | Category, long blurb, Installed chip and chevron compete in narrow cards; nested surfaces are heavy. | Implemented aligned 44px icons, readable metadata, compact installed check and one sheet material with quiet inset groups. |
| P2 | Marketplace detail/reviews | Independent heavy blur/shadows per card, weak field labels, local reviews presented as customer-wide data. | Implemented shared detail material/type scale, labeled fields and rating state, device-local review copy, storage error state and corrupt-storage validation. |
| P2 | Empty/custom flow | Empty search does not offer a direct custom-app action. | Implemented empty-search custom-app action, labeled URL field and storage failure feedback. |
| P2 | Motion | Mixed long entrance timelines and hover delays; raised shadows animate heavily. | Implemented short non-bouncy springs for sheets/thumbnails, shorter content stagger, immediate search focus and transform/opacity motion separate from materials. |
| P2 | Accessibility | Reduced motion exists in places; reduced transparency and increased contrast are not systematic. | Implemented shared MotionConfig, global reduced-motion CSS, worker/onboarding reduced-transparency and contrast fallbacks, visible keyboard focus. |
| P2 | Legacy chat/overlays | Large separate UI with inline styles and independent dialogs; computer overlay must preserve coordinate mapping. | Audit source; apply shared focus/accessibility foundations without redesigning tool/agent behavior or pointer coordinates. Authenticated/runtime-only states require separate live validation. |
| P2 | Compact density | Global 90% scale is intentional but lowers the apparent size of small metadata and targets. | Keep user-requested density; use readable marketplace text and larger invisible/control hit areas; do not shrink mobile controls. |

## Validation ledger

- Real screenshot pipeline: four separate browser/desktop test fixtures captured through the production capture helper and rendered through the actual thumbnail component; no shared iframe or fake header. Provider/app/worker routing, blank-page initialization, URL preservation, cancellation and VM argument encoding have regression checks.
- Rendered checks passed: actual task-panel component material; removal of parent thumbnail filter; marketplace catalog → app details → local review → back/search → custom app → empty results; focus loop; 1500×980 and 600×850 layouts; reduced motion/transparency and contrast. Screenshots: `scratch/apple-task-materials.png`, `apple-market-catalog.png`, `apple-market-detail.png`, `apple-market-empty.png`, `apple-market-compact.png`. The task harness uses plain fixture cards solely to inspect shadows, not as product previews.
- Preview regression suite: 2 files, 7 tests passed. Changed TS/TSX files transpile without syntax diagnostics; global Tailwind CSS compiled and changed tracked files passed whitespace checks.
- No claim of signed-in account, paid-provider, real VPS, or Alpine runtime validation without evidence from those environments.


## Route-by-route audit and remaining work

| Route | Review | Remaining work / validation limits |
| --- | --- | --- |
| Welcome `/` | Shared shell, typography, outer frame, cards and motion. | HTTP 200 in route smoke check, but captured before visible content; no visual pass claimed. |
| Authentication `/auth` | Sign-in/loading/guest states, glass cards and motion; shared motion/accessibility foundations applied. | HTTP 200; sign-in text rendered without page errors. OAuth and authenticated account states require a real session. |
| Setup `/setup` | Provider/vision/local VM/voice/configuration inputs, progress and completion. | Multiple inline outline resets and provider cards still need a dedicated keyboard/contrast pass. Completion Lottie loops indefinitely and needs pause/reduced-motion handling outside CSS. Live route navigation timed out. |
| Workers `/workers` | Desktop/dock/composer/preview/task/completion, all marketplace states, Settings, templates, confirmations and VM connecting state. | Marketplace/material checks ran against real components in an isolated browser harness. Native app/VM operations, full worker execution and each Settings integration require their runtime. Live route navigation timed out. |
| Chat `/chat` | Legacy tool/model panels, forms, dialogs and composer. | Inline focus resets, independent modal semantics and a native project-delete confirmation remain inconsistent. Shared motion is applied; broader legacy redesign intentionally not folded into marketplace changes. Live route navigation timed out. |
| Narrative overlay `/overlay` | Shared narrative/glass presentation and motion. | Actual streamed content/native overlay appearance requires the sidecar; live route navigation timed out. |
| Computer overlay `/computer-overlay` | Pointer/control presentation and normalized coordinate mapping. | Coordinate behavior preserved. Multi-monitor/native input requires desktop runtime verification; live route navigation timed out. |

Route smoke evidence: `scratch/apple-route-audit.json`. Five development-server navigations exceeded 60 seconds; these are **unverified**, not passes. No browser page errors were observed before timeouts. Development-server timings are not release-performance measurements.

The audit is complete as a source/surface inventory with targeted rendered remediation. Remaining integration and accessibility work is listed explicitly; it is not a claim that every authenticated/native state has passed a full end-to-end audit.


## Follow-up fixes and verification

The user asked to fix the remaining findings. This section supersedes the remaining-work statuses above.

- **Routes/dev startup:** all seven routes now return HTTP 200 with no page errors in the browser smoke run. The five previously timed-out routes were loaded successfully. Warm requests in the server log took approximately 0.8–1.9 seconds. The first cold compile on this memory-constrained host still exceeded one minute; this is not a packaged-app performance measurement. Removed Google font compilation fetches, bundled Satoshi as the root sans font, kept system monospace for code, moved dev caches to `.next` apart from packaged `out`, and selected Turbopack for desktop dev scripts. Stopped the old Next parent/child pair to resolve its restart/port conflict.
- **Missing worker Home:** the existing Home component was never mounted, causing an empty worker overview. Restored the real worker list inside the shared centered/scrolling shell, including creation and deletion controls. The UI regression test now exercises it.
- **Scheduling:** schedules now persist on the actual worker and trigger the existing worker runner with its selected VM. Claim the occurrence before execution; serialize scheduled runs; skip paused/busy workers; coalesce missed occurrences; consume one-time schedules; support removing a schedule. The UI explicitly says to keep EverFern open on the Workers screen and uses this computer’s timezone. This is desktop scheduling, **not an always-on cloud scheduler**. The older generic local-agent scheduler was deliberately not wired to VM workers.
- **Dialogs/focus:** added modal semantics, Tab containment, Escape and opener restoration to feedback, task scheduling, rollback, extensions directory, customization, file viewer, legacy Settings, setup cloud sign-in, VM desktop/paywall, app removal and worker deletion. Inline assistant overlays use the same dialog surface. Shared focus handling respects nested dialogs and captures the opener before autoFocus. Replaced native project-delete, VM-delete and worker-move confirmations with app confirmations that retain error feedback; VM deletion/moves reject running workers.
- **Focus/contrast/transparency:** global visible focus survives legacy inline outline resets. Shared dialog/onboarding glass has reduced-transparency and increased-contrast fallbacks. Setup/chat inputs with descriptive placeholders now also have accessible names. Default theme font uses local Satoshi.
- **Setup animation:** replaced the indefinitely looping completion Lottie with a static heart, removing its pause/reduced-motion problem and animation dependency from setup.
- **Completion accuracy:** removed hard-coded Amazon (.de)/Canva/LinkedIn invoice successes, fixed 13-minute duration and fabricated euro totals. Completion displays the actual agent report, measured duration, and “Not reported” cost; it no longer presents requested steps as verified accomplishments.
- **Other route fixes:** welcome config failures recover rather than leave a blank screen; plain-browser Chat skips desktop-only database/model checks; narrative overlay width/height stay inside the viewport and its malformed table closing tag is corrected. Native pointer coordinate mapping is preserved.

Validation:

- `worker-schedule.test.ts`: 4 passed (weekend boundaries, future occurrence, missed-run coalescing, one-time removal, unsupported labels).
- `dialog-focus.test.tsx`: 3 passed (nested Escape, focus loop/return, autoFocus opener restoration).
- `reference-ui.test.tsx`: 1 passed (Home → worker → sidebar/folder → conversation → marketplace → Settings). Its opening wait and minimized-app interaction were corrected to match the real asynchronous UI.
- `worker-scheduling.test.tsx`: 2 passed (persist occurrence before running the selected worker/VM; paused worker never executes).
- Live browser: Home → worker → Apps catalog → Chrome detail → back → Settings → Escape passed with no page errors. Screenshot evidence: `scratch/audit-home-restored.png`, `audit-market-live.png`, `audit-settings-live.png`. Welcome heading/content was also verified after hydration in `audit-welcome-ready.png`.
- Seven-route browser smoke evidence: `scratch/apple-route-audit.json`. Overlay idle states intentionally have little/no visible content. Screenshot capture now preserves the caret to avoid introducing a pre-hydration style mutation during QA.
- Changed components pass TS/TSX syntax transpilation and tracked files pass whitespace checks. Windows test fork startup initially timed out under low free memory; serial thread-pool reruns passed.

Remaining environment limits: actual OAuth/profile server sync, paid provider sessions, VPS/Alpine/native sidecar operations, multi-monitor input and unattended execution while the desktop is closed require those environments. The UI and scheduling changes do not claim those integration tests have passed.
