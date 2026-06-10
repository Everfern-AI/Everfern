from pypdf import PdfReader

pdf_path = r"C:\Users\srini\Downloads\5613082412_GPR statement_APR25 to MAR26.pdf"
out_path = r"C:\Users\srini\Downloads\Everfern\statement_extract.txt"

reader = PdfReader(pdf_path)
print("PAGES:", len(reader.pages))
meta = reader.metadata
print("META:", dict(meta) if meta else None)

text = ""
for i, page in enumerate(reader.pages):
    text += f"--- PAGE {i+1} ---\n"
    t = page.extract_text() or ""
    text += t + "\n"

with open(out_path, "w", encoding="utf-8") as f:
    f.write(text)

print("EXTRACTED_CHARS:", len(text))
print("--- BEGIN ---")
print(text)
print("--- END ---")
