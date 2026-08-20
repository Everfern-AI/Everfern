---
name: pdf
description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
license: Proprietary. LICENSE.txt has complete terms
---

# PDF Processing Guide

## Overview

This guide covers essential PDF processing operations using Python libraries and command-line tools. For advanced features, JavaScript libraries, and detailed examples, see REFERENCE.md. If you need to fill out a PDF form, read FORMS.md and follow its instructions.

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python Libraries

### pypdf - Basic Operations

#### Merge PDFs
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### Split PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### Extract Metadata
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### Rotate Pages
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - Text and Table Extraction

#### Extract Text with Layout
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### Extract Tables
```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

#### Advanced Table Extraction
```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # Check if table is not empty
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine all tables
if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab - Create PDFs

#### Basic PDF Creation
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### Production-Grade Self-Contained Report Template
```python
import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY

def build_pdf_report(output_pdf_path: str):
    # Ensure parent directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_pdf_path)), exist_ok=True)
    
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    
    # Page background & border styling callback
    def draw_background(canvas, doc):
        canvas.saveState()
        # Cream background fill
        canvas.setFillColor(colors.HexColor('#FCFBF7'))
        canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], stroke=0, fill=1)
        # Top accent header line
        canvas.setFillColor(colors.HexColor('#2D5A27'))
        canvas.rect(54, doc.pagesize[1] - 40, doc.pagesize[0] - 108, 3, stroke=0, fill=1)
        # Footer page number
        canvas.setFont('Helvetica', 9)
        canvas.setFillColor(colors.HexColor('#718096'))
        canvas.drawRightString(doc.pagesize[0] - 54, 35, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    styles = getSampleStyleSheet()
    
    # Custom Typography Hierarchy
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=colors.HexColor('#1A202C'),
        alignment=TA_LEFT,
        spaceAfter=8
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#4A5568'),
        spaceAfter=20
    )
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=19,
        textColor=colors.HexColor('#2D5A27'),
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=15,
        textColor=colors.HexColor('#2D3748'),
        alignment=TA_LEFT,
        spaceAfter=8
    )
    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=15,
        bulletIndent=5,
        spaceAfter=4
    )

    story = []
    
    # Header & Meta
    story.append(Paragraph("Global Warming: Causes, Effects & Solutions", title_style))
    story.append(Paragraph("A Comprehensive Synthesis & Policy Brief", subtitle_style))
    story.append(Spacer(1, 10))

    # Executive Summary Card (Table)
    summary_text = Paragraph(
        "<b>Executive Summary:</b> Human-induced climate change is causing widespread disruptions to ecological and human systems. Rapid decarbonization, reforestation, and renewable energy adoption remain the primary levers for limiting warming to 1.5°C.",
        body_style
    )
    summary_table = Table([[summary_text]], colWidths=[504])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F0F4EF')),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E0')),
        ('PADDING', (0, 0), (-1, -1), 12),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 15))

    # Section 1
    story.append(Paragraph("1. Primary Drivers & Causes", h1_style))
    story.append(Paragraph("Atmospheric greenhouse gas concentrations have reached record highs primarily driven by:", body_style))
    story.append(Paragraph("• <b>Fossil Fuel Combustion:</b> Power generation, industrial manufacturing, and transport.", bullet_style))
    story.append(Paragraph("• <b>Deforestation:</b> Loss of carbon sinks through land clearing for agriculture.", bullet_style))
    story.append(Paragraph("• <b>Industrial Agriculture:</b> Methane and nitrous oxide emissions from livestock and fertilizers.", bullet_style))
    story.append(Spacer(1, 10))

    # Section 2: Data Comparison Table
    story.append(Paragraph("2. Emission Impact Matrix", h1_style))
    table_data = [
        [Paragraph("<b>Sector</b>", body_style), Paragraph("<b>Global Share (%)</b>", body_style), Paragraph("<b>Primary Gas</b>", body_style)],
        [Paragraph("Energy & Electricity", body_style), Paragraph("34%", body_style), Paragraph("CO<sub>2</sub>", body_style)],
        [Paragraph("Industry", body_style), Paragraph("24%", body_style), Paragraph("CO<sub>2</sub> / HFCs", body_style)],
        [Paragraph("Agriculture & Forestry", body_style), Paragraph("22%", body_style), Paragraph("CH<sub>4</sub> / N<sub>2</sub>O", body_style)],
        [Paragraph("Transport", body_style), Paragraph("15%", body_style), Paragraph("CO<sub>2</sub>", body_style)],
    ]
    data_table = Table(table_data, colWidths=[200, 150, 154])
    data_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E2E8F0')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E0')),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(data_table)
    story.append(Spacer(1, 15))

    # Section 3
    story.append(Paragraph("3. Actionable Solutions & Pathways", h1_style))
    story.append(Paragraph("Key strategies identified across IPCC and international frameworks:", body_style))
    story.append(Paragraph("1. <b>Clean Electrification:</b> Scaling solar, wind, and battery storage.", bullet_style))
    story.append(Paragraph("2. <b>Energy Efficiency:</b> Upgrading industrial systems, insulation, and smart grids.", bullet_style))
    story.append(Paragraph("3. <b>Nature-Based Carbon Removal:</b> Reforestation and soil conservation.", bullet_style))

    # Build Document
    doc.build(story, onFirstPage=draw_background, onLaterPages=draw_background)
    print(f"[Success] PDF generated at: {output_pdf_path}")

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else "output_report.pdf"
    build_pdf_report(target)
```

#### Subscripts and Superscripts

**IMPORTANT**: Never use Unicode subscript/superscript characters (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts do not include these glyphs, causing them to render as solid black boxes.

Instead, use ReportLab's XML markup tags in Paragraph objects:
```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), manually adjust font the size and position rather than using Unicode subscripts/superscripts.

#### Font and Network Guidelines
> [!IMPORTANT]
> - **Pre-installed Library**: `reportlab` is pre-installed inside the Python virtual environment (`~/.everfern/venv`). You do not need to install it manually.
> - **No Variable Fonts**: ReportLab does **NOT** support variable fonts (e.g. variable weight/optical size versions, which are the default downloads on Google Fonts). Loading them will throw `TTFError` or hang/crash the Python process. Always explicitly download and use the **static `.ttf`** files (typically located in a `static/` subdirectory inside the downloaded font zip).
> - **Network Request Timeouts**: When downloading custom fonts or online assets inside Python scripts, always specify a timeout (e.g. `timeout=10` seconds) in `urllib.request.urlopen`, `urllib.request.urlretrieve`, or `requests.get`. Un-timeouted socket connections will block indefinitely if the environment lacks internet access, causing the terminal tool execution to hang.



## Command-Line Tools

### pdftotext (poppler-utils)
```bash
# Extract text
pdftotext input.pdf output.txt

# Extract text preserving layout
pdftotext -layout input.pdf output.txt

# Extract specific pages
pdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5
```

### qpdf
```bash
# Merge PDFs
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Split pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf --pages . 6-10 -- pages6-10.pdf

# Rotate pages
qpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees

# Remove password
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk (if available)
```bash
# Merge
pdftk file1.pdf file2.pdf cat output merged.pdf

# Split
pdftk input.pdf burst

# Rotate
pdftk input.pdf rotate 1east output rotated.pdf
```

## Common Tasks

### Extract Text from Scanned PDFs
```python
# Requires: pip install pytesseract pdf2image
import pytesseract
from pdf2image import convert_from_path

# Convert PDF to images
images = convert_from_path('scanned.pdf')

# OCR each page
text = ""
for i, image in enumerate(images):
    text += f"Page {i+1}:\n"
    text += pytesseract.image_to_string(image)
    text += "\n\n"

print(text)
```

### EverFern OCR: When a PDF Is Attached

EverFern automatically extracts text from an **attached PDF** before it reaches the model. Depending on the user's **PDF OCR** setting (`Settings → Linux VM → PDF OCR`), the prompt will contain one of:

- **PaddleOCR / PaddleOCR-VL:** a block like
  ```
  [Extracted text via PaddleOCR:]
  <recognized text>
  ```
- **Vision Send:** the prompt includes each PDF page as an **image**.

**Rules:**
1. If a PDF's extracted text was already provided in the prompt, use it directly — do **not** re-OCR the same file. If it looks truncated, mention it rather than silently guessing. (Page screenshots under Vision Send are capped at 30 pages.)
2. If a PDF has **no** extracted text (or you need a fresh scan / the OCR errored), run OCR yourself:
   - **Text-layer PDFs:** prefer `pdftotext` or `pdfplumber` (`page.extract_text()`) — fast and exact.
   - **Scanned/image-only PDFs:** use PaddleOCR via the EverFern OCR venv.
3. PaddleOCR environment: the app installs PaddleOCR + OpenVINO into `~/.everfern/ocr-venv`. It runs on the **Windows host**, not the Linux VM. To invoke it:
   ```bash
   # Windows host (via execute_pwsh with local=true):
   & "$HOME\.everfern\ocr-venv\Scripts\python.exe" -c "from paddleocr import PaddleOCR; o=PaddleOCR(use_doc_orientation_classify=False,use_doc_unwarping=False,use_textline_orientation=True,lang='en'); print(o.predict('file.pdf') and [r['rec_texts'] for r in o.predict('file.pdf')] if hasattr(o,'predict') else [x[1][0] for x in (o.ocr('file.pdf',cls=True) or [[]])[0]])"
   ```
   The simplest reliable path is a small script:
   ```python
   from pathlib import Path
   import fitz, numpy as np
   from paddleocr import PaddleOCR
   ocr = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True, lang='en')
   doc = fitz.open("document.pdf")
   out = []
   for page in doc:
       pix = page.get_pixmap(dpi=150)
       img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
       if pix.n == 4:
           img = img[:, :, :3]
       for r in ocr.predict(img):
           out.extend(r.get("rec_texts", []))
   print("\n".join(out))
   ```
   Save it and run with the OCR venv:
   ```bash
   # Windows:  "$HOME\.everfern\ocr-venv\Scripts\python.exe" ocr.py
   # VM fallback (Linux ~/.everfern/venv): python3 ocr.py  # with pytesseract/convert_from_path
   ```
4. If neither PaddleOCR nor pytesseract is available, tell the user the OCR engine isn't installed (Settings → Linux VM → PDF OCR → Install OCR Dependencies) rather than producing empty output.

### Add Watermark
```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### Extract Images
```bash
# Using pdfimages (poppler-utils)
pdfimages -j input.pdf output_prefix

# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.
```

### Password Protection
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Quick Reference

| Task | Best Tool | Command/Code |
|------|-----------|--------------|
| Merge PDFs | pypdf | `writer.add_page(page)` |
| Split PDFs | pypdf | One page per file |
| Extract text | pdfplumber | `page.extract_text()` |
| Extract tables | pdfplumber | `page.extract_tables()` |
| Create PDFs | reportlab | Canvas or Platypus |
| Command line merge | qpdf | `qpdf --empty --pages ...` |
| OCR scanned PDFs | EverFern auto-OCR / pytesseract | Prefer attached extracted text; else PaddleOCR or pytesseract |
| Fill PDF forms | pdf-lib or pypdf (see FORMS.md) | See FORMS.md |

## Next Steps

- For advanced pypdfium2 usage, see REFERENCE.md
- For JavaScript libraries (pdf-lib), see REFERENCE.md
- If you need to fill out a PDF form, follow the instructions in FORMS.md
- For troubleshooting guides, see REFERENCE.md
