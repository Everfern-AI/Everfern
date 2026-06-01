---
name: pdf
description: "Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, or extracting images. If the user mentions a .pdf file or asks to produce one, use this skill."
---

# PDF Processing in EverFern

## Overview

EverFern has direct filesystem access on Windows. Use Python (via `run_terminal_command`) to work with PDFs. Install libraries with `pip install pypdf pdfplumber reportlab`.

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader(r"C:\path\to\document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
print(text[:3000])
```

---

## Core Operations (pypdf)

### Extract Text

```python
from pypdf import PdfReader

reader = PdfReader(r"C:\path\to\document.pdf")
for i, page in enumerate(reader.pages):
    print(f"--- Page {i+1} ---")
    print(page.extract_text())
```

### Merge PDFs

```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in [r"C:\path\doc1.pdf", r"C:\path\doc2.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open(r"C:\path\merged.pdf", "wb") as output:
    writer.write(output)
```

### Split PDF

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader(r"C:\path\input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(rf"C:\path\page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

### Rotate Pages

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader(r"C:\path\input.pdf")
writer = PdfWriter()
page = reader.pages[0]
page.rotate(90)  # 90, 180, or 270 degrees clockwise
writer.add_page(page)
with open(r"C:\path\rotated.pdf", "wb") as output:
    writer.write(output)
```

### Extract Metadata

```python
from pypdf import PdfReader
reader = PdfReader(r"C:\path\document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
```

### Password Protection

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader(r"C:\path\input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

writer.encrypt("userpassword", "ownerpassword")
with open(r"C:\path\encrypted.pdf", "wb") as output:
    writer.write(output)
```

### Add Watermark

```python
from pypdf import PdfReader, PdfWriter

watermark = PdfReader(r"C:\path\watermark.pdf").pages[0]
reader = PdfReader(r"C:\path\document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open(r"C:\path\watermarked.pdf", "wb") as output:
    writer.write(output)
```

---

## Table Extraction (pdfplumber)

```python
import pdfplumber, pandas as pd

with pdfplumber.open(r"C:\path\document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

if all_tables:
    combined = pd.concat(all_tables, ignore_index=True)
    combined.to_excel(r"C:\path\extracted_tables.xlsx", index=False)
    print(combined)
```

---

## Create PDFs (reportlab)

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas(r"C:\path\hello.pdf", pagesize=letter)
width, height = letter
c.drawString(100, height - 100, "Hello World!")
c.save()
```

### Multi-page with Styles

```python
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import letter

doc = SimpleDocTemplate(r"C:\path\report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

story.append(Paragraph("Report Title", styles['Title']))
story.append(Spacer(1, 12))
story.append(Paragraph("Body text goes here.", styles['Normal']))

doc.build(story)
```

**IMPORTANT — Subscripts/Superscripts:** Never use Unicode subscript characters (₀₁₂₃) in ReportLab — use `<sub>2</sub>` and `<super>2</super>` XML tags inside `Paragraph` objects.

---

## OCR on Scanned PDFs (PaddleOCR)

Use **PaddleOCR** — it's more accurate than Tesseract, handles complex layouts, and installs easily with pip.

```bash
pip install paddlepaddle paddleocr pdf2image pillow
```

```python
# Use PaddleOCR for PDF OCR — no separate Tesseract install needed
# Models download automatically on first run (~15MB)
from paddleocr import PaddleOCR
from pdf2image import convert_from_path
import numpy as np

ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

images = convert_from_path("/path/to/scanned.pdf", dpi=300)
text = ""
for i, img in enumerate(images):
    # Convert PIL Image to numpy array
    img_array = np.array(img)
    result = ocr.ocr(img_array, cls=True)
    page_text = ""
    for line in result[0] if result and result[0] else []:
        page_text += line[1][0] + "\n"
    text += f"--- Page {i+1} ---\n{page_text}\n"
print(text)
```

---

## Quick Reference

| Task | Tool | Key Call |
|------|------|----------|
| Merge PDFs | pypdf | `writer.add_page(page)` |
| Split PDF | pypdf | One page per `PdfWriter` |
| Extract text | pdfplumber | `page.extract_text()` |
| Extract tables | pdfplumber | `page.extract_tables()` |
| Create PDF | reportlab | `canvas.Canvas(...)` |
| OCR scanned | PaddleOCR | Convert to image first |
| Watermark | pypdf | `page.merge_page(watermark)` |
| Encrypt | pypdf | `writer.encrypt(...)` |
