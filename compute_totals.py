import re

with open(r"C:\Users\srini\Downloads\Everfern\statement_extract.txt", "r", encoding="utf-8") as f:
    text = f.read()

# Parse all transaction lines. A row looks like:
# 1 03 Apr 2025 ... -8,295.00 2,41,682.85
# Pattern: amount token followed by a balance token
# We capture: a number that is either prefixed by + or - and has commas, followed by another comma-formatted number
amount_pat = re.compile(r"([+-]?[\d]{1,3}(?:,\d{2,3})*\.\d{2})\s+([\d]{1,3}(?:,\d{2,3})*\.\d{2})")

total_credit = 0.0
total_debit = 0.0
count_credit = 0
count_debit = 0
tx_count = 0
last_balance = None
opening_balance = None

# Find "--- PAGE 1 ---" line and pull opening from it
# Opening isn't explicit; the first row has debit/credit + balance. We can compute opening = balance - amount when first row is debit, balance + amount when first row is credit.
# But that's only if the first transaction applies. Let's just collect per-row and infer opening from first row.

# For each amount-pair, classify
rows = []
for m in amount_pat.finditer(text):
    amt_str, bal_str = m.group(1), m.group(2)
    if amt_str.startswith('+'):
        amt = float(amt_str.replace('+','').replace(',',''))
        kind = 'CR'
    elif amt_str.startswith('-'):
        amt = float(amt_str.replace('-','').replace(',',''))
        kind = 'DR'
    else:
        continue
    bal = float(bal_str.replace(',',''))
    rows.append((kind, amt, bal))

if rows:
    first_kind, first_amt, first_bal = rows[0]
    if first_kind == 'CR':
        opening = first_bal - first_amt
    else:
        opening = first_bal + first_amt
    last_balance = rows[-1][2]

for k, a, b in rows:
    if k == 'CR':
        total_credit += a
        count_credit += 1
    else:
        total_debit += a
        count_debit += 1

tx_count = len(rows)

# Categorize by description keywords
def classify(desc):
    d = desc.lower()
    if 't s s p d c l' in d or 'tsspdcl' in d or 'electricity' in d or 't s s p' in d:
        return 'Electricity (TSSPDCL)'
    if 'fd maturity' in d or 'fd booked' in d:
        return 'Fixed Deposit (FD)'
    if 'int.pd' in d or 'interest' in d:
        return 'Bank Interest'
    if 'cash withdrawal' in d:
        return 'Cash Withdrawal'
    if 'mb:watchman' in d or 'mb:tirupathi' in d or 'paybckamt' in d or 'paybackamt' in d or 'giri' in d and 'cash' in d:
        return 'Staff / Vendor Payback'
    if 'mb:greenparkrsdy' in d or 'devfund' in d or 'greenparkrsdy' in d or 'gprcash' in d or 'giri' in d or 'paybackamt' in d:
        return 'Maintenance Operations / Vendor Payments'
    if 'hathway' in d:
        return 'Cable / Internet (Hathway)'
    if 'jai mathadi' in d or 'ply' in d:
        return 'Vendor / Ply'
    if 'jagat' in d or 'ragh' in d or 'suman' in d:
        return 'Misc Vendor'
    if 'neft' in d or 'imps' in d or 'upi' in d or 'mb:' in d:
        return 'Member Maintenance / Corpus Contributions'
    return 'Other'

# Re-parse with descriptions to get category breakdown
lines = text.split('\n')
# Each transaction is in a block. We can find date+description+amount using a more detailed pattern per row
# Simpler: split on the row-numbered blocks. Each page lists rows starting with a number+date.
desc_pat = re.compile(r"(\d{1,3})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+([+-]?[\d]{1,3}(?:,\d{2,3})*\.\d{2})\s+([\d]{1,3}(?:,\d{2,3})*\.\d{2})")

# Use a robust approach: for each line containing a date+time and a + or - amount at end, capture the line
cat_credit = {}
cat_debit = {}
for line in lines:
    m = re.search(r"([+-]?[\d]{1,3}(?:,\d{2,3})*\.\d{2})\s+([\d]{1,3}(?:,\d{2,3})*\.\d{2})\s*$", line.strip())
    if m:
        amt_str, bal_str = m.group(1), m.group(2)
        # Determine if this is a row (look for date or txn marker before)
        if re.search(r"\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M", line):
            amt = float(amt_str.lstrip('+-').replace(',',''))
            cat = classify(line)
            if amt_str.startswith('+'):
                cat_credit[cat] = cat_credit.get(cat, 0.0) + amt
            else:
                cat_debit[cat] = cat_debit.get(cat, 0.0) + amt

print(f"TX_COUNT: {tx_count}")
print(f"OPENING_BALANCE_INFERRED: {opening:,.2f}")
print(f"CLOSING_BALANCE: {last_balance:,.2f}")
print(f"TOTAL_CREDIT: {total_credit:,.2f}  count={count_credit}")
print(f"TOTAL_DEBIT:  {total_debit:,.2f}  count={count_debit}")
print(f"NET_DELTA:    {total_credit - total_debit:,.2f}")
print(f"VERIFIED_NET (closing-opening): {last_balance - opening:,.2f}")
print()
print("CREDIT CATEGORIES:")
for k,v in sorted(cat_credit.items(), key=lambda x:-x[1]):
    print(f"  {k:55s}  {v:>14,.2f}")
print()
print("DEBIT CATEGORIES:")
for k,v in sorted(cat_debit.items(), key=lambda x:-x[1]):
    print(f"  {k:55s}  {v:>14,.2f}")
