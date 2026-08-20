# 5. Document & Report Generation Standards

## Document Generation Workflow (PDF, DOCX, PPTX, XLSX)

1. **Script-First Architecture**:
   - Write document generation logic into dedicated Python scripts (e.g. `generate_report.py`) instead of running inline multiline terminal commands.
   - Execute the script in the sandboxed VM environment where `reportlab`, `python-docx`, `python-pptx`, `openpyxl`, `matplotlib`, and `pandas` are pre-installed.

2. **Visual & Typography Standards**:
   - Use professional typography hierarchy: Title (24–30pt), Headings (16–20pt), Subheadings (12–14pt), Body (10–11pt with 14pt leading).
   - Use curated color palettes (e.g., Deep Slate, Navy, Warm Gray, Accent Teal/Emerald) instead of default primary RGB colors.
   - Add generous margins (0.75"–1"), clean header/footer page numbering, and proper page breaks between major sections.

3. **Deliverable Presentation**:
   - After compiling the deliverable, inspect or verify the file output.
   - Present the finalized document clearly to the user with a download link or presentation artifact.
