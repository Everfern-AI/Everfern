---
name: frontend-design
description: Use for any frontend, app UI, UI/UX, visual design, styling, layout, component, page, dashboard, landing page, website, HTML/CSS/JS, React, Next.js, Tailwind, animation, responsive design, polish, redesign, beautify, or improve-the-interface request. Produces clean, production-grade frontend design and working UI code; avoids generic AI slop, default purple gradients, bland card stacks, weak spacing, and template-looking layouts.
---

# Frontend Design

Use this skill whenever the task touches frontend appearance or interaction: building UI, editing app screens, improving UX, styling components, creating web artifacts, React/Next.js work, HTML/CSS/JS pages, dashboards, landing pages, forms, charts, motion, responsiveness, or visual polish.

The goal is clean, intentional, production-grade UI that looks designed for the product, not generated from a generic template.

## Operating Rules

1. Read the existing app first. Match its framework, component patterns, spacing scale, state management, naming, and design system unless the user asks for a new direction.
2. Make the actual usable interface, not a marketing explanation of features. Avoid visible instructional copy unless the product genuinely needs it.
3. Prefer conservative, durable UI for tools, SaaS, settings, dashboards, admin, CRM, and operational apps: dense enough to scan, restrained, predictable, and efficient.
4. For expressive sites, portfolios, games, and editorial pages, choose a clear visual direction tied to the subject. Distinctive is good; random decoration is not.
5. Check responsive behavior. Text must fit inside buttons, cards, sidebars, tables, and compact controls at mobile and desktop sizes.
6. Verify the result when possible with the browser/dev server/screenshot flow available in the environment.

## Anti-Slop Defaults

Do not default to:

- Purple, indigo, violet, or blue-purple gradients.
- Beige/cream/tan monochrome pages, dark slate dashboards, or one-note color themes.
- Giant rounded cards stacked on a gradient background.
- Repeated feature cards, fake glassmorphism, glow blobs, gradient orbs, bokeh blobs, or decorative noise with no purpose.
- Generic hero sections for apps or tools when the user asked for a usable product surface.
- Overused font choices as the whole personality: Inter, Roboto, Arial, system fonts, Space Grotesk.
- Placeholder-heavy copy, fake metrics, empty charts, lorem ipsum, or nonfunctional controls.

Purple is allowed only when it is already part of the product brand or clearly appropriate. If no brand exists, choose a grounded palette from the domain: neutral base, one accent, one semantic/status range, and enough contrast.

## Visual Quality Checklist

Before editing, decide:

- Audience: consumer, internal operator, developer, executive, creator, buyer, player.
- Density: compact workflow UI, medium content UI, or immersive visual page.
- Tone: quiet professional, editorial, technical, playful, premium, utilitarian, cinematic, etc.
- Primary job: what should the user do in the first 5 seconds?

Then implement:

- Strong hierarchy: clear page title, section rhythm, readable labels, useful empty/loading/error states.
- Real layout: grids, split panes, sidebars, tables, drawers, tabs, filters, timelines, charts, or canvases as the product needs.
- Good spacing: use consistent increments; avoid both cramped clutter and wasteful hero-scale whitespace in app surfaces.
- Mature color: neutral surfaces, subtle borders, restrained shadows, accessible contrast, semantic states.
- Typography with intent: use the existing font stack in apps; for standalone pages, pick a distinctive but readable pairing.
- Controls that feel native to the task: icon buttons for tools, segmented controls for modes, toggles for binary settings, sliders/inputs for numbers, menus for option sets, tabs for views.
- No card nesting. Use cards for repeated items, modals, and framed tools; use full-width sections or unframed layouts for page structure.

## React, Next.js, And JavaScript

When working in React, Next.js, or modern JavaScript:

- Use the project’s existing component library and styling approach first.
- Use `framer-motion` for meaningful page transitions, panel reveals, drag/reorder, modal presence, list enter/exit, and high-value micro-interactions when it is already installed or acceptable for the project.
- Keep motion purposeful and fast: 120-240ms for small interactions, 250-450ms for page/panel transitions.
- Respect `prefers-reduced-motion`; disable or simplify nonessential motion.
- Do not animate layout in ways that make text jump, tables shift, or controls feel unstable.
- Use CSS transitions for simple hover/focus states; use Framer Motion when sequencing, presence, gestures, or shared layout matter.
- Components should be complete: keyboard/focus states, loading, empty, error, disabled, active, and responsive states where relevant.

## HTML/CSS Artifacts

For standalone HTML/CSS/JS artifacts:

- Use semantic HTML and CSS variables.
- Use Tailwind only if the project/request already favors it or speed matters; otherwise write clean CSS.
- Use real assets or generated/coded visuals when the design depends on imagery. Avoid purely atmospheric stock-like backgrounds.
- Keep scripts small and deterministic. Do not use Python to generate HTML.

## Data And Charts

- Choose the chart type based on the data, not visual novelty.
- Avoid rainbow palettes, 3D charts, truncated axes without clear reason, default library colors, and cluttered legends.
- Use subtle grids, clear labels, visible units, and tooltips that match the UI.
- For reports and dashboards, do not default to purple chart palettes. Build a palette from the product/domain colors and preserve accessibility.

## Final Pass

Before finishing:

- Scan CSS/classes/colors for accidental one-note palettes or default purple gradients.
- Check that text does not overflow or overlap.
- Confirm interactive controls have visible hover/focus/active states.
- Confirm the first screen is the actual useful UI unless the user explicitly requested a landing page.
- Run the project’s formatter/tests/build or a focused smoke check when available.
