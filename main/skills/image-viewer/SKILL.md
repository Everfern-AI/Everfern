---
name: image-viewer
description: "Use this skill whenever the user wants to view, analyze, classify, or organize images. This includes: viewing image files, reading image metadata (dimensions, format, EXIF), classifying images by content (e.g. 'is this anime?', 'find photos of dogs'), running OCR on images, organizing images into folders based on content, batch processing many images. Also use when the user mentions image files, screenshots, photos, or asks about organizing media files."
---

# Image Analysis & Organization in EverFern

## 🚨 CRITICAL: WHEN TO USE VISION VS WHEN TO SKIP IT

### Use file extension (NO vision needed) — format/organize-by-type queries
If the user asks to organize or filter **by file format/type**, file extension is
sufficient. Do NOT waste time/cost on vision.

| User says | Do this |
|-----------|---------|
| "organize all SVG files" | Filter by `.svg` extension → move to SVG folder |
| "find all JPEGs" | Filter by `.jpg`/`.jpeg` extension |
| "separate PNGs from JPGs" | Filter by extension, zero vision calls |
| "find huge images" | Use Pillow for dimensions, no vision |

### Use vision (MUST use analyze_image) — content-based queries
If the user asks to classify **what's IN the image**, you MUST use vision.
**NEVER guess content from file names, file size, or metadata.**

**Wrong** (filename guessing — banned):
> File is called "anime.jpg" → classify as anime ✗

**Correct** (must use this):
> Call `analyze_image` with question "Is this image anime/manga, photograph,
> illustration, or screenshot?" → vision model actually sees the pixels ✓

| User says | Must use vision? |
|-----------|-----------------|
| "organize by file type" | NO — use extension |
| "organize by content" (anime vs photos, etc.) | YES — analyze_image |
| "find screenshots" | YES — analyze_image |
| "find photos of people" | YES — analyze_image |
| "separate memes from real photos" | YES — analyze_image |
| "what images are in this folder?" | NO — just list files |
| "is this a receipt?" | YES — analyze_image |

---

## Available Methods

| Method | Best For | Details |
|--------|----------|---------|
| `visual_classification_sheet` tool | **Large folder classification (primary for 20+ images)** | Creates numbered contact-sheet PNGs and a manifest so vision can classify many images quickly by visible ID. |
| `analyze_image` tool (`images` array) | **Small batch classification** | Sends 1–20 images per call to the vision model. The model actually SEES each image. |
| `analyze_image` tool (`imagePath`) | Single image analysis | Describe, OCR, classify one image |
| Python `Pillow` in WSL | Metadata, resize, convert | File dimensions, format, EXIF |
| Python `PaddleOCR` in WSL | OCR fallback | When vision model can't read text |
| Python `transformers` + CLIP | Offline batch (no API cost) | Heavy install (~2GB), use only if no vision model |

For **batch organization with 20+ images**, use `visual_classification_sheet` first.
For smaller batches, use `analyze_image` with the `images` parameter.
Only fall back to Python CLIP if there is no vision-capable model available.

Anime-specific rule: if the user asks to move "anime pictures" into an `anime`
folder, classify the pixels as anime/manga/anime-style art with vision. Do not
trust filenames, folders, extensions, dimensions, EXIF, or metadata as evidence.
Move only high-confidence anime/manga/anime-style images; leave uncertain files
for review instead of guessing.

---

## Decision Tree: What kind of organization?

```
User says "organize these images"
           │
           ▼
    ┌──────┴──────┐
    │              │
 By FILE TYPE    By CONTENT
 (SVG, JPG,      (anime, photos,
  PNG, etc.)      people, memes)
    │              │
    ▼              ▼
 Filter ext     analyze_image
 → no vision    → vision needed
```

## Workflow: "Organize my pictures into folders by type" (NO vision)

### Step 1: List files by extension
```python
from pathlib import Path
import shutil

src = Path("/path/to/images")
for ext, folder in [(".svg", "SVGs"), (".jpg", "JPEGs"), (".png", "PNGs")]:
    dest = src / folder
    dest.mkdir(exist_ok=True)
    for f in src.glob(f"*{ext}"):
        shutil.move(str(f), str(dest / f.name))
print("Done — organized by file type")
```

### Step 2: Done — no HITL needed (no content inspection)

---

## Workflow: "Organize my pictures into folders by content" (vision REQUIRED)

### Step 1: List image files
Use `system_files` tool to list all image files in the source directory.

### Step 2: Signal HITL
This modifies the user's filesystem — emit `needs_hitl` in your completion signal
with a clear `hitlRationale` explaining what you'll classify and move.

### Step 3: Classify via vision
For 20+ images, create visual contact sheets:

```json
{
  "tool": "visual_classification_sheet",
  "args": {
    "directory": "/path/to/images",
    "recursive": false,
    "imagesPerSheet": 20,
    "question": "Classify each numbered tile as anime/manga, photograph, illustration, screenshot, meme, or uncertain. Return JSON rows keyed by id."
  }
}
```

The tool writes sheet PNGs plus a `manifest.json` mapping each visible ID to the
original file path. Use the ID-keyed vision results with the manifest before moving.

For fewer than 20 images, call `analyze_image` with image paths in the `images` array:

```json
{
  "tool": "analyze_image",
  "args": {
    "images": [
      "/mnt/c/Users/name/Downloads/img1.jpg",
      "/mnt/c/Users/name/Downloads/img2.png",
      ...
    ],
    "question": "Classify each image by filename. For each image, tell me: is it anime/manga, a photograph, an illustration, a screenshot, or a meme? List results per filename."
  }
}
```

**Vision models can handle 10–20 direct images per call** (use `detail: "low"` for batch).
The model will see every image and classify each one individually.

**For 20–100 images**: Prefer one or more `visual_classification_sheet` sheets.

**For 100+ images**: You may spawn generic subagents to classify separate sheet batches
concurrently. Each subagent must return only JSON rows with `file`, `category`,
`confidence`, and `reason`.

For very small sets, direct `analyze_image` is still fine.

### Step 4: Parse results and move files
The vision model returns classifications per filename. Parse the response and use
`system_files` move/rename to organize into folders.

Example Python mover script:
```python
from pathlib import Path
import shutil, json, sys

data = json.loads(sys.argv[1])  # [{"file": "x.jpg", "category": "anime"}, ...]
base_dir = Path(sys.argv[2])

for item in data:
    src = base_dir / item["file"]
    category = item["category"]
    dest = base_dir / category
    dest.mkdir(exist_ok=True)
    shutil.move(str(src), str(dest / item["file"]))
    print(f"Moved {item['file']} → {category}/")
```

---

## Workflow: Large-scale (100+ images) — Subagent

For very large batches, spawn generic subagents to handle visual sheet batches:

1. List all image files
2. Signal HITL
3. Call `visual_classification_sheet` to create sheets and a manifest.
4. Spawn subagents with:
   ```
   I have {N} image files in {folder}. Your task:
   1. Analyze assigned visual classification sheet paths with vision
   2. Compile results into a JSON array: [{"id": 123, "category": "anime", "confidence": 0.92, "reason": "anime-style face and line art"}, ...]
   3. Output ONLY the JSON array, nothing else
   ```
5. Map IDs through the manifest, then move files with the Python mover script above

---

## Workflow: Read text from images (OCR)

For extracting text from images (screenshots with text, scanned documents, memes):

```json
{
  "tool": "analyze_image",
  "args": {
    "imagePath": "/path/to/image.png",
    "question": "Read and extract all text visible in this image. Return only the text content."
  }
}
```

For scanned documents/PDF pages, the vision model can read text directly.
If the vision model struggles (handwriting, unusual fonts), fall back to PaddleOCR.

---

## Workflow: Analyze PDF contents

When the user asks about PDF contents (e.g. "what's in this PDF?", "summarize this PDF"):

1. **For text PDFs** — Use the PDF skill (`pypdf`) to extract text
2. **For scanned/image PDFs** — Convert pages to images, then use `analyze_image`:
   ```bash
   # In WSL: convert PDF pages to images
   source ~/.everfern/venv/bin/activate
   pip install pdf2image pillow
   python3 -c "
   from pdf2image import convert_from_path
   images = convert_from_path('/path/to/document.pdf', dpi=200)
   for i, img in enumerate(images):
       img.save(f'/tmp/page_{i+1}.png', 'PNG')
       print(f'/tmp/page_{i+1}.png')
   "
   ```
3. Then call `analyze_image` with all page images

---

## Common Classification Questions

| Task | Question to ask vision model |
|------|------------------------------|
| Anime vs photos | "Classify each image: is it anime/manga, photograph, illustration, or screenshot?" |
| Document types | "Is this a receipt, invoice, handwritten note, ID card, or screenshot?" |
| Photo subjects | "What is the main subject: person, animal, landscape, food, or object?" |
| NSFW check | "Does this image contain adult/NSFW content? Answer yes or no with confidence." |
| Meme detection | "Is this a meme, screenshot, or original image?" |
| Text extraction | "Extract all visible text from this image. Return only the text." |

---

## Metadata-only (no vision needed)

Use Python `Pillow` for quick metadata without vision:

```python
from PIL import Image
import os, json

path = "/path/to/image.jpg"
img = Image.open(path)
info = {
    "file": os.path.basename(path),
    "format": img.format,
    "dimensions": f"{img.size[0]}x{img.size[1]}",
    "mode": img.mode,
    "size_kb": round(os.path.getsize(path) / 1024, 1),
}
print(json.dumps(info, indent=2))
```

---

## Supported Formats

PNG, JPEG/JPG, GIF, BMP, WEBP, TIFF, SVG

---

## Best Practices

- **Format questions → file extension, no vision. Content questions → analyze_image, never filename guessing.**
- For 20+ images, make visual classification sheets first for speed
- Batch up to 20 direct images per `analyze_image` call for small sets
- For 100+ images, use sheet batches plus subagents
- Always signal HITL before moving/renaming user files
- Metadata (dimensions, format) doesn't need vision — use Pillow
- OCR on clean text images works well via vision model directly
- For scanned PDFs, convert to images first, then use vision
