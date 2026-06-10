import pdfplumber
import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"C:\Users\srini\.everfern\attachments\1781113761900-5613082412_GPR statement_APR25 to MAR26.pdf"

month_map = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
}

def parse_date(s):
    parts = s.split()
    day = int(parts[0])
    month = month_map[parts[1]]
    year = int(parts[2])
    return f"{year:04d}-{month:02d}-{day:02d}"

def parse_amount(s):
    return float(s.replace(',', '').replace('+', ''))

transactions = []

with pdfplumber.open(pdf_path) as pdf:
    for page_idx, page in enumerate(pdf.pages):
        text = page.extract_text()
        if not text:
            continue
        lines = text.split('\n')

        i = 0
        # Find header row
        while i < len(lines):
            if '# TRANSACTION DATE' in lines[i]:
                i += 1
                break
            i += 1

        # Now parse the data lines, joining wrapped lines
        current = None
        buffer_parts = []
        # Footer text patterns to strip
        footer_re = re.compile(r'\s*Statement generated on.*$|\s*Page \d+ of \d+.*$|\s*GREEN PARK PLOT.*$|\s*Account Statement.*$', re.IGNORECASE)

        def finalize(buf_list, curr):
            if not curr:
                return None
            # Join, then strip footer text
            full = ' '.join(buf_list)
            # Strip everything after balance (time, page footer etc.)
            # The balance looks like: ...<ref> [+-]X,XXX.XX X,XXX.XX
            m = re.search(r'^(.*?)\s+([A-Z][A-Z0-9-]+)\s+([+-]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*(.*)$', full)
            if not m:
                return None
            description = m.group(1).strip()
            ref = m.group(2)
            amount = m.group(3)
            balance = m.group(4)
            tail = m.group(5).strip()  # time etc

            # Remove leading serial + dates from description
            description = re.sub(r'^\d+\s+\d{1,2}\s+\w{3}\s+\d{4}\s+\d{1,2}\s+\w{3}\s+\d{4}\s+', '', description)
            return {
                'serial': curr['serial'],
                'txn_date': curr['txn_date'],
                'value_date': curr['value_date'],
                'iso_date': parse_date(curr['txn_date']),
                'description': description,
                'ref': ref,
                'amount_str': amount,
                'amount': parse_amount(amount),
                'is_debit': amount.startswith('-'),
                'balance_str': balance,
                'balance': parse_amount(balance),
                'time_or_note': tail,
            }

        while i < len(lines):
            stripped = lines[i].strip()
            i += 1
            if not stripped:
                continue
            # Skip "Statement generated" footer that sometimes appears before the table
            if 'Statement generated' in stripped:
                continue
            # Check if line starts a new transaction
            m = re.match(r'^(\d+)\s+(\d{1,2}\s+\w{3}\s+\d{4})\s+(\d{1,2}\s+\w{3}\s+\d{4})', stripped)
            if m:
                # Save previous
                t = finalize(buffer_parts, current)
                if t:
                    transactions.append(t)
                current = {
                    'serial': m.group(1),
                    'txn_date': m.group(2),
                    'value_date': m.group(3)
                }
                buffer_parts = [stripped]
            elif current is not None:
                # Continuation line - only add if it has actual content
                # Skip pure footer lines
                if 'Statement generated' in stripped:
                    continue
                if re.match(r'^Page \d+ of \d+', stripped):
                    continue
                buffer_parts.append(stripped)
        # Save last
        t = finalize(buffer_parts, current)
        if t:
            transactions.append(t)

# Save JSON
with open(r'C:\Users\srini\Downloads\Everfern\transactions.json', 'w', encoding='utf-8') as f:
    json.dump(transactions, f, indent=2, ensure_ascii=False)

print(f"Total transactions parsed: {len(transactions)}")
debits = [t for t in transactions if t['is_debit']]
credits = [t for t in transactions if not t['is_debit']]
print(f"Debits: {len(debits)}, Credits: {len(credits)}")
print(f"Total debit amount: {sum(t['amount'] for t in debits):,.2f}")
print(f"Total credit amount: {sum(t['amount'] for t in credits):,.2f}")
print(f"Opening balance (from first txn): {transactions[0]['balance']:,.2f} (no opening - read from PDF text)")
print(f"Closing balance (from last txn): {transactions[-1]['balance']:,.2f}")
print()
print("=== First 3 debits ===")
for t in debits[:3]:
    print(f"  {t['iso_date']} | {t['description'][:50]:50s} | {t['amount']:>12,.2f} | bal={t['balance']:>14,.2f}")
print()
print("=== First 3 credits ===")
for t in credits[:3]:
    print(f"  {t['iso_date']} | {t['description'][:50]:50s} | {t['amount']:>12,.2f} | bal={t['balance']:>14,.2f}")
print()
print("=== Last 3 transactions ===")
for t in transactions[-3:]:
    print(f"  {t['iso_date']} | {t['description'][:60]:60s} | {t['amount']:>12,.2f} | bal={t['balance']:>14,.2f}")
