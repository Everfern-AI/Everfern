---
name: pptx
description: "Use this skill any time a .pptx file (PowerPoint presentation) is involved — as input, output, or both. This includes creating slide decks, reading or extracting text from a .pptx file, editing or modifying existing presentations, or combining slides. If a .pptx file needs to be opened, created, or touched, use this skill."
---

# PPTX Skill for EverFern

## ⚠️ Design-First Workflow (MANDATORY)

**You MUST follow this exact sequence. Do not generate content first and style it after. Plan the visual system first.**

### Phase 1 — Plan the Visual System (before writing any slide content)

Choose and lock these **before** filling in slide text:

1. **Typography** — Pick fonts from PptxGenJS-compatible list (Aptos, Calibri, Georgia, etc.). Use 1 heading + 1 body font. For custom fonts, write a Node.js script and run it in the Linux VM.

2. **Color palette** (4-6 hex values: primary, secondary, accent, background, text, muted).

3. **Visual metaphor / design direction** — One sentence describing the artistic treatment.

4. **Slide master archetype** — Choose one that fits (startup/tech, luxury, data/analytics, playful/creative, executive/board, climate/science, anime/gaming, or invent your own).

**Only then proceed to Phase 2.**

### Phase 2 — Generate slide content within the locked visual system

Now that fonts, colors, metaphor, and archetype are locked:

- Use `pptx_generator` with `designMode: "adaptive"`
- Pass the chosen `visualDirection`, `brand`, and `slides` with unique `intent` values
- Every slide gets a `visualIdea` that respects the locked visual metaphor
- Dense detail goes in `speakerNotes`, concise text on slides

### Phase 3 — If the built-in tool can't achieve the design

Write a standalone Node.js PptxGenJS script and run it in the Linux VM. The script owns the full visual system.

## Design Philosophy

**Freedom over templates.** The tool has many intent types (`hero`, `sectionBreak`, `bigNumber`, `timeline`, `map`, `diagram`, `quote`, `comparison`, `storyboard`, `gallery`, `dataCallout`, `splitNarrative`, `closing`) — use **whatever combination fits the story**, not a preset arc. A 3-slide deck might be `quote → dataCallout → closing`. A technical deep-dive might use `diagram` for every slide with different layouts. You are the designer; the intents are your palette, not your cage.

**Design first, content second.** Lock the visual system before writing any slide text. But the visual system should serve the CONTENT, not the other way around. If the content demands an all-`diagram` deck, do it. If it demands six `splitNarrative` slides in a row because you're telling a linear story, that's fine. Rules like "no two consecutive same intents" are training wheels — override them when the story calls for it.

**The content IS the design.** A slide that has nothing to say cannot be saved by styling. Let the substance drive the visual choices. If a slide needs a wall of data, use `dataCallout`. If it needs to show a process, use `timeline` or `diagram`. If it needs to persuade, use `comparison`. Don't pad slides with empty intents.

**Available intent types:** hero, sectionBreak, bigNumber, timeline, map, diagram, quote, comparison, storyboard, gallery, dataCallout, splitNarrative, closing.

## Adaptive Deck Standard

When using the built-in `pptx_generator` tool, always use `designMode: "adaptive"`. Do not hand-build new decks with `python-pptx` unless the user specifically asks for low-level Python generation.

Every deck should include:

* `deckGoal`: what it should accomplish.
* `audience`: who will see it.
* `visualDirection`: a custom art direction.
* `slides` with varied `intent` values that serve the story.
* `visualIdea` and `speakerNotes` for most slides.
* `brand` with `colors` and `font` when needed.

## Expert Presentation Design Guidelines

### 1. Typography & Readability
- Hierarchy: Title 32–40pt, Section Header 24–28pt, Body 14–18pt, Captions 14pt.
- Minimum 10pt absolute. Title at least 1.75× body size.
- 1 heading + 1 body font per deck.

### 2. Design Rules
- Lock visual system before drafting content. No per-slide design decisions.
- Color rules: Primary for titles/accents, secondary for support, accent for CTAs, muted for secondary text.
- Whitespace: 0.5" margin minimum. Don't overcrowd.
- Alignment: consistent baselines across slides of the same intent.

### 3. Storytelling
- Vary layouts. Don't repeat intent types unless the story demands it.
- Search the web for data before designing.
- Concise on-slide text, dense detail in `speakerNotes`.
- Edit in place — refine instead of rebuilding.

## Quick Reference

| Task | Guide |
|------|-------|
| Read/analyze content | Python `python-pptx` |
| Create from scratch | `pptx_generator` adaptive mode backed by PptxGenJS |
| Low-level inspection/editing | Python `python-pptx` |

---

## Reading Content

**Requirement:** `pip install python-pptx`

```python
from pptx import Presentation

# Open presentation
prs = Presentation(r"C:\path\to\presentation.pptx")
print(f"Total Slides: {len(prs.slides)}")

# Extract text
for i, slide in enumerate(prs.slides, 1):
    print(f"\n--- Slide {i} ---")
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        for paragraph in shape.text_frame.paragraphs:
            print(paragraph.text)
```

---

## Creating from Scratch

Use `pptx_generator` for new decks because it is backed by PptxGenJS, produces adaptive editorial layouts, and keeps the PPTX editable. Use `python-pptx` only when you need low-level inspection, small edits, or compatibility work on an existing file.

### Basic Presentation

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN

prs = Presentation()

# Available Master Slide Layouts (0-8 by default):
# 0: Title Slide
# 1: Title and Content
# 2: Section Header
# 3: Two Content
# 4: Comparison
# 5: Title Only
# 6: Blank
# 7: Content with Caption
# 8: Picture with Caption

# Title Slide
title_slide_layout = prs.slide_layouts[0]
slide = prs.slides.add_slide(title_slide_layout)
title = slide.shapes.title
subtitle = slide.placeholders[1]

title.text = "Hello, EverFern!"
subtitle.text = "Agentic Desktop Assistant"

# Standard Slide
bullet_slide_layout = prs.slide_layouts[1]
slide = prs.slides.add_slide(bullet_slide_layout)
shapes = slide.shapes
title_shape = shapes.title
body_shape = shapes.placeholders[1]

title_shape.text = "Features"

tf = body_shape.text_frame
tf.text = "Core workflow"

p = tf.add_paragraph()
p.text = "Mandatory Planning"
p.level = 1

p = tf.add_paragraph()
p.text = "Human-in-the-loop review"
p.level = 2

# Add Picture
# (assuming you have a local image)
img_path = r"C:\path\to\image.jpg"
# blank_slide_layout = prs.slide_layouts[6]
# slide = prs.slides.add_slide(blank_slide_layout)
# left = top = Inches(1)
# height = Inches(5.5)
# pic = slide.shapes.add_picture(img_path, left, top, height=height)

prs.save(r"C:\path\to\output.pptx")
```

---

## Best Practices

* **Always use absolute Windows paths** (e.g., `C:\Users\Username\file.pptx`).
* **Use Raw Strings**: Path formatting in Python should use `r"C:\..."` or escaped slashes to prevent `\n` or `\t` bugs.
* **Avoid Complex Shapes Elements**: `python-pptx` handles basic objects (text generation, static templates). For heavy data-driven visualizations, use Matplotlib/Seaborn and embed them as images.
