---
name: file-reading
description: "Use this skill when a user asks you to read, open, or work with an uploaded or local file whose content is NOT yet in your context. This skill tells you which tool and approach to use for each file type (pdf, docx, xlsx, csv, json, images, archives). Triggers: any mention of a file path, an attachment in the chat, a user asking about a file you haven't read yet. Do NOT use this skill if the file content is already visible in your context."
---

# Reading Files in EverFern

## How Files Work in EverFern

In EverFern Desktop, the user can:
1. **Type a file path directly** — e.g., `C:\Users\user\Downloads\report.pdf`
2. **Drag & drop a file** — the path is surfaced to you in the message
3. **Share a folder as context** — the folder contents are listed in the message

You have **direct filesystem access** via `run_terminal_command` (PowerShell on Windows). There are no sandboxes or upload paths like `/mnt/user-data/uploads/` — use the actual Windows path the user provides.

## General Protocol

1. **Look at the extension** — that's your dispatch key.
2. **Check the file size first** before reading large files:
   ```powershell
   (Get-Item "C:\path\to\file.pdf").Length
   ```
3. **Read just enough** to answer the user's question.
4. **If a dedicated skill exists**, read it — it covers editing, creating, and advanced operations.

## Dispatch Table

| Extension | First Move | Dedicated Skill |
|-----------|-----------|----------------|
| `.pdf` | See PDF section below | `skills/pdf/SKILL.md` |
| `.docx` | `pandoc` to markdown | `skills/docx/SKILL.md` |
| `.xlsx`, `.xlsm` | `openpyxl` sheet names + head | `skills/xlsx/SKILL.md` |
| `.pptx` | `python-pptx` slide count | `skills/pptx/SKILL.md` |
| `.csv`, `.tsv` | `pandas` with `nrows` | — (below) |
| `.json`, `.jsonl` | Content preview | — (below) |
| `.jpg`, `.png`, `.gif` | Already visible as image attachment | — (below) |
| `.zip`, `.tar` | List contents, don't auto-extract | — (below) |
| `.txt`, `.md`, `.log` | Check size, then read | — (below) |
| Unknown | `file` equivalent: check extension, then decide | — |

---

## PDF

**Never** open a PDF as raw text — it prints binary garbage.

```powershell
# Get page count and check if text is extractable
python -c "from pypdf import PdfReader; r = PdfReader(r'C:\path\to\file.pdf'); print(f'{len(r.pages)} pages'); print(r.pages[0].extract_text()[:2000])"
```

For anything beyond a quick peek, read `skills/pdf/SKILL.md`.

---

## DOCX

```powershell
pandoc "C:\path\to\memo.docx" -t markdown
```

For editing, creating, or tracked changes, read `skills/docx/SKILL.md`.

---

## XLSX

```python
from openpyxl import load_workbook
wb = load_workbook(r"C:\path\to\data.xlsx", read_only=True)
print("Sheets:", wb.sheetnames)
ws = wb.active
for row in ws.iter_rows(max_row=5, values_only=True):
    print(row)
```

For creating, editing, formulas, or formatting, read `skills/xlsx/SKILL.md`.

---

## PPTX

```python
from pptx import Presentation
p = Presentation(r"C:\path\to\deck.pptx")
print(f"{len(p.slides)} slides")
for i, slide in enumerate(p.slides, 1):
    texts = [s.text for s in slide.shapes if s.has_text_frame]
    print(f"Slide {i}:", " | ".join(t for t in texts if t))
```

For creating or editing, read `skills/pptx/SKILL.md`.

---

## CSV / TSV

```python
import pandas as pd
df = pd.read_csv(r"C:\path\to\data.csv", nrows=5)
print(df)
print(df.dtypes)
```

---

## JSON / JSONL

```python
import json
with open(r"C:\path\to\data.json", "r") as f:
    data = json.load(f)
print(type(data), len(data) if isinstance(data, list) else list(data.keys())[:10])
```

---

## Plain Text / Code / Logs

```powershell
# Check size
(Get-Item "C:\path\to\file.log").Length

# Under ~20KB: read all
Get-Content "C:\path\to\file.log"

# Over 20KB: read ends
Get-Content "C:\path\to\file.log" | Select-Object -First 100
Get-Content "C:\path\to\file.log" | Select-Object -Last 100
```

---

## Archives (ZIP)

```powershell
# List contents — never auto-extract
Expand-Archive -WhatIf "C:\path\to\bundle.zip" -DestinationPath "."
# Or with .NET:
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::OpenRead("C:\path\to\bundle.zip").Entries | Select-Object FullName, Length
```
