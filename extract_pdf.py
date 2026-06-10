import pdfplumber
import json
import re
import sys

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"C:\Users\srini\.everfern\attachments\1781113761900-5613082412_GPR statement_APR25 to MAR26.pdf"

with pdfplumber.open(pdf_path) as pdf:
    print(f"Total pages: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages):
        print(f"\n========== PAGE {i+1} ==========")
        text = page.extract_text()
        if text:
            # Print to a file with utf-8 to avoid console issues
            sys.stdout.write(text + "\n")
        else:
            sys.stdout.write("[No text]\n")
        sys.stdout.write("\n--- TABLES ---\n")
        tables = page.extract_tables()
        for j, t in enumerate(tables):
            sys.stdout.write(f"\nTable {j+1}:\n")
            for row in t:
                sys.stdout.write(str(row) + "\n")
        sys.stdout.flush()
