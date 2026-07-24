---
name: pptx
description: "Use this skill any time a .pptx file (PowerPoint presentation) is involved — creating slide decks, reading or extracting text from a .pptx file, editing or modifying existing presentations, or combining slides."
---

# PPTX Presentation Generation & Editing (Claude & Kimi Style Pipeline)

You build presentations by **writing and executing code programmatically** (Node.js with `pptxgenjs` or Python with `python-pptx`), following Claude & Kimi's high-craft aesthetic code-execution pipeline.

---

## 🚀 The Code-Execution Pipeline

### 1. Building a New Deck
- **Write a Node.js script using `pptxgenjs`** (or a Python script using `python-pptx`).
- Run the script via `run_command` (`node generate_deck.js` or `python generate_deck.py`) to generate a native `.pptx` file.
- The script controls layout, typography, visual hierarchy, color palettes, container cards, category pill badges, and speaker notes.

### 2. Editing an Existing Deck or Working from a Template
- **Unzip & XML Surgery or `python-pptx`**:
  - Unzip `.pptx` (which is a ZIP archive of XML files under the hood), modify raw `ppt/slides/slideN.xml` or relationship files, and rezip back to `.pptx`.
  - Or use Python (`python-pptx`) to read existing slides, modify text frames, update shapes, or adjust slide layouts.

### 3. Reading / Extracting Content
- Use `python-pptx` to extract slide text, titles, bullet structures, and speaker notes.

---

## 🎨 High-Aesthetic Design System (Claude & Kimi Style)

### Phase 1: Lock the Visual System (BEFORE writing slide content)
Select and lock these design tokens for the entire presentation:

#### 1. Color Palettes (Curated 5-Color Systems)
- **Claude Editorial (Warm Craft)**:
  - Background: `FAF8F5` | Surface Cards: `FFFFFF` / `F2ECE1`
  - Text: `1E1E1E` | Muted: `6B7280` | Accent: `D96B43` (Terracotta) / `2C3E35` (Deep Sage)
- **Kimi Cyber Studio (Neon Dark)**:
  - Background: `0D0F19` | Surface Cards: `131B2E` / `1E293B`
  - Text: `F8FAFC` | Muted: `94A3B8` | Accent: `00F5A0` (Neon Mint) / `7B2CBF` (Electric Violet)
- **Nordic Minimal (Clean Slate)**:
  - Background: `F4F4F6` | Surface Cards: `FFFFFF` / `E4E4E7`
  - Text: `0F172A` | Muted: `64748B` | Accent: `38BDF8` (Ice Blue) / `6366F1` (Indigo)
- **Executive Strategy (Sleek Modern)**:
  - Background: `F8FAFC` | Surface Cards: `FFFFFF` / `E2E8F0`
  - Text: `0F172A` | Muted: `475569` | Accent: `2563EB` (Royal Blue) / `0D9488` (Teal)

#### 2. Typography Rules
- **Font Pairs**: 1 Heading Font + 1 Body Font (`Georgia` + `Calibri` for Editorial, `Aptos` + `Aptos` for Cyber/Modern, `Impact` + `Calibri` for Bold/Pop).
- **Scale**: Title 32–40pt bold, Section Headers 22–26pt, Body 14–18pt, Captions/Badges 10–12pt.
- **Hierarchy**: Main title must be at least 1.75× body font size.

#### 3. Layout Best Practices
- **Card-Based Containers**: Use container rectangles (`ROUNDED_RECTANGLE`) with subtle borders or background fill to group content (3-column feature grids, 2x2 cards, metric callout boxes).
- **Category Pill Badges**: Place pill tags (e.g. `ROUNDED_RECTANGLE` with height ~0.35") above main headings for category tags or metadata.
- **Hero Stats**: Use 42–60pt bold numbers for metrics with small uppercase labels below.
- **Whitespace & Speaker Notes**: Keep margins at 0.5" minimum. Put dense supporting explanations into slide **speaker notes** (`slide.addNotes(...)`), keeping slide text concise and scannable.

---

## 💻 Sample Node.js `pptxgenjs` Blueprint Script

```javascript
const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();

pptx.layout = 'LAYOUT_16x9';

// 1. Locked Palette & Tokens (Claude Editorial)
const COLORS = {
  bg: 'FAF8F5',
  card: 'FFFFFF',
  cardAlt: 'F2ECE1',
  text: '1E1E1E',
  muted: '6B7280',
  accent: 'D96B43',
  accentDark: '2C3E35'
};

// 2. Slide 1: Hero Deck Title
const slide1 = pptx.addSlide();
slide1.background = { color: COLORS.bg };

// Category Pill Badge
slide1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.8, y: 1.2, w: 1.8, h: 0.35,
  fill: { color: COLORS.cardAlt },
  line: { color: COLORS.cardAlt }
});
slide1.addText('PRODUCT ROADMAP', {
  x: 0.8, y: 1.2, w: 1.8, h: 0.35,
  fontSize: 10, bold: true, color: COLORS.accent, align: 'center', fontFace: 'Georgia'
});

// Title & Subtitle
slide1.addText('Next-Gen AI Platform Strategy', {
  x: 0.8, y: 1.8, w: 10.0, h: 1.2,
  fontSize: 38, bold: true, color: COLORS.text, fontFace: 'Georgia'
});
slide1.addText('Delivering aesthetic, code-driven user experiences at scale', {
  x: 0.8, y: 3.1, w: 9.0, h: 0.8,
  fontSize: 16, color: COLORS.muted, fontFace: 'Calibri'
});

// 3 Metric Cards Grid
const metrics = [
  { val: '10x', label: 'Faster Generation' },
  { val: '99.9%', label: 'Uptime SLA' },
  { val: '4.9★', label: 'User Rating' }
];

metrics.forEach((m, idx) => {
  const xPos = 0.8 + (idx * 3.8);
  // Card Container
  slide1.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: xPos, y: 4.5, w: 3.5, h: 2.0,
    fill: { color: COLORS.card },
    line: { color: 'E5E7EB', width: 1 }
  });
  // Metric Value
  slide1.addText(m.val, {
    x: xPos + 0.3, y: 4.8, w: 2.9, h: 0.8,
    fontSize: 40, bold: true, color: COLORS.accent, fontFace: 'Georgia'
  });
  // Label
  slide1.addText(m.label, {
    x: xPos + 0.3, y: 5.7, w: 2.9, h: 0.5,
    fontSize: 14, color: COLORS.text, bold: true, fontFace: 'Calibri'
  });
});

slide1.addNotes('This deck presents the core product roadmap and design principles for the upcoming quarter.');

// 3. Write Presentation
pptx.writeFile({ fileName: 'presentation.pptx' }).then(() => {
  console.log('Presentation generated successfully!');
});
```
