"""
Compute analytics and produce a self-contained HTML report.
Reads transactions.json and produces gpr_statement_report.html with:
- Embedded JSON data
- Chart.js charts (CDN)
- Modern Inter font
- Dark/light theme support
- Tables, summaries, insights
"""
import json
import re
import html
from datetime import datetime
from collections import defaultdict

sys_out = None
try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

with open(r'C:\Users\srini\Downloads\Everfern\transactions.json', 'r', encoding='utf-8') as f:
    txns = json.load(f)

# Sort by date
txns.sort(key=lambda t: t['iso_date'])

# --- Aggregate monthly ---
def ym(d):
    return d[:7]  # YYYY-MM

monthly = defaultdict(lambda: {'credit': 0.0, 'debit': 0.0, 'count': 0, 'credit_count': 0, 'debit_count': 0})
for t in txns:
    m = ym(t['iso_date'])
    if t['is_debit']:
        monthly[m]['debit'] += t['amount']  # amount is negative
        monthly[m]['debit_count'] += 1
    else:
        monthly[m]['credit'] += t['amount']
        monthly[m]['credit_count'] += 1
    monthly[m]['count'] += 1

months_sorted = sorted(monthly.keys())
monthly_data = []
for m in months_sorted:
    d = monthly[m]
    d['month'] = m
    d['net'] = d['credit'] + d['debit']
    monthly_data.append(d)

# --- Categorize transactions ---
# Debit categories
DEBIT_CATEGORIES = [
    ('Electricity', r'TSSPDCL|Electricity|POWER|electric|BESCOM|TNEB'),
    ('Salary / Wages', r'Salary|Sal\s|Wages|Watchman|Gardener|Driver|Housekeeping|Maid|Caretaker|Security'),
    ('Maintenance / Repairs', r'Maintenance|Repair|Plumb|Electric|Plumber|Civil|Paint|Cleaning|AMC|Service|PestControl'),
    ('Water / Tankers', r'Water|Tanker|Borewell|Overhead tank'),
    ('Utilities / Internet', r'BSNL|Airtel|Jio|VI\s|Vodafone|Tata\sSky|Dish\sTV|Internet|Broadband|WiFi|Recharge|Gas|Cylinder|LPG|PNG'),
    ('Bank Charges / Tax', r'Charges|Fee|GST|TDS|TAX|Service\sCharge|Commission'),
    ('Society / Admin', r'Society|Office|Stationery|Printing|admin'),
    ('Development Fund', r'dev\s?fund|devfund|Development|Construction|Capital|Elevator|Sump'),
    ('Corpus / Sinking Fund', r'corpus|Sinking|Reserve\sFund'),
    ('Vendor / Contractor', r'Contractor|Vendor|Supplier|Payment\sto|Work'),
    ('Other', r'.*'),
]

def categorize_debit(desc):
    for cat, pat in DEBIT_CATEGORIES:
        if re.search(pat, desc, re.IGNORECASE):
            return cat
    return 'Other'

debit_cats = defaultdict(float)
debit_cat_counts = defaultdict(int)
debit_cat_txns = defaultdict(list)
for t in txns:
    if t['is_debit']:
        c = categorize_debit(t['description'])
        debit_cats[c] += t['amount']  # negative
        debit_cat_counts[c] += 1
        debit_cat_txns[c].append(t)

# --- Credit categories ---
# Common patterns: UPI, NEFT, IMPS, Recd
# We'll bucket by:
# - UPI credits (maintenance, corpus, dev)
# - NEFT credits
# - IMPS credits
# - Interest credits
# - Internal transfers (MB:), if any
def categorize_credit(t):
    desc = t['description']
    ref = t['ref']
    if 'Int.Pd' in desc or 'Interest' in desc.lower():
        return 'Interest'
    if 'MB:' in desc or 'INWD' in ref:
        return 'Internal Transfer'
    if 'UPI' in ref or 'UPI' in desc[:5]:
        return 'UPI Receipts'
    if 'NEFT' in ref or 'NEFT' in desc[:5]:
        return 'NEFT Receipts'
    if 'IMPS' in ref or 'IMPS' in desc[:5]:
        return 'IMPS Receipts'
    return 'Other Credits'

credit_cats = defaultdict(float)
credit_cat_counts = defaultdict(int)
for t in txns:
    if not t['is_debit']:
        c = categorize_credit(t)
        credit_cats[c] += t['amount']
        credit_cat_counts[c] += 1

# --- Top transactions ---
top_debits = sorted([t for t in txns if t['is_debit']], key=lambda x: x['amount'])[:10]  # most negative
top_credits = sorted([t for t in txns if not t['is_debit']], key=lambda x: -x['amount'])[:10]

# --- Daily balance series (running balance) ---
balance_series = []
for t in txns:
    balance_series.append({
        'date': t['iso_date'],
        'balance': t['balance']
    })

# Dedup by date — keep last balance of the day
daily_balance = {}
for b in balance_series:
    daily_balance[b['date']] = b['balance']
daily_balance_list = [{'date': d, 'balance': v} for d, v in sorted(daily_balance.items())]

# --- Day-of-week / Day-of-month insights ---
from collections import Counter
dow_counts = Counter()
for t in txns:
    d = datetime.strptime(t['iso_date'], '%Y-%m-%d')
    dow_counts[d.strftime('%A')] += 1

dom_credits = defaultdict(float)
dom_debits = defaultdict(float)
for t in txns:
    d = datetime.strptime(t['iso_date'], '%Y-%m-%d')
    if t['is_debit']:
        dom_debits[d.day] += t['amount']
    else:
        dom_credits[d.day] += t['amount']

# --- Period stats ---
period_start = txns[0]['iso_date']
period_end = txns[-1]['iso_date']
total_credit = sum(t['amount'] for t in txns if not t['is_debit'])
total_debit = abs(sum(t['amount'] for t in txns if t['is_debit']))
opening_balance = txns[0]['balance'] - (txns[0]['amount'] if not txns[0]['is_debit'] else txns[0]['amount'])
# opening = closing - sum(amount) where debits are negative
net_change = total_credit - total_debit
closing_balance = txns[-1]['balance']

# Recompute opening more carefully
# First transaction's balance - first transaction's amount
opening_balance = txns[0]['balance'] - txns[0]['amount']
# Note: amount is signed. If first txn is credit (+), then opening = balance - credit
# If first is debit (-), then opening = balance - (-debit) = balance + debit

# --- Counterparty frequency (credits) ---
counterparty_freq = Counter()
counterparty_amount = defaultdict(float)
for t in txns:
    if not t['is_debit']:
        # Extract the first name/UPI handle from description
        desc = t['description']
        # Common patterns: "UPI/NAME/...", "Recd:IMPS/.../NAME/...", "NEFT ... NAME ..."
        m = re.search(r'(?:UPI/|Recd:[A-Z]+/\d+/|NEFT\s+[A-Z0-9]+\s+)([^/]+?)(?:/|$)', desc)
        if m:
            name = m.group(1).strip().split('/')[0]
        else:
            name = desc.split('/')[0].strip()[:30]
        if name and len(name) > 1:
            counterparty_freq[name] += 1
            counterparty_amount[name] += t['amount']

top_payees = counterparty_freq.most_common(15)
top_payee_objs = [{'name': n, 'count': c, 'amount': counterparty_amount[n]} for n, c in top_payees]

# === Build the HTML ===
# Use Chart.js (CDN), Inter font, modern dark theme

def inr(x):
    """Format as Indian currency: 1,23,456.78"""
    s = f"{abs(x):,.2f}"
    # Convert from 1,234,567.89 to 12,34,567.89
    parts = s.split('.')
    intp = parts[0]
    decp = parts[1]
    # Indian grouping: last 3 digits, then groups of 2
    if ',' in intp:
        # It's already grouped with Western format
        intp = intp.replace(',', '')
    rev = intp[::-1]
    groups = [rev[:3]]
    rev = rev[3:]
    while rev:
        groups.append(rev[:2])
        rev = rev[2:]
    intp = ','.join(groups)[::-1]
    sign = '-' if x < 0 else ''
    return f"₹{sign}{intp}.{decp}"

# Verify inr
assert inr(1234567.89) == '₹12,34,567.89'
assert inr(-8295.00) == '₹-8,295.00'

# Prepare data for JS injection
chart_data = {
    'monthly': monthly_data,
    'debit_cats': dict(debit_cats),
    'credit_cats': dict(credit_cats),
    'daily_balance': daily_balance_list,
    'top_debits': [{'date': t['iso_date'], 'description': t['description'], 'amount': t['amount'], 'ref': t['ref'], 'balance': t['balance']} for t in top_debits],
    'top_credits': [{'date': t['iso_date'], 'description': t['description'], 'amount': t['amount'], 'ref': t['ref'], 'balance': t['balance']} for t in top_credits],
    'top_payees': top_payee_objs,
    'dow_counts': dict(dow_counts),
    'dom_credits': dict(dom_credits),
    'dom_debits': dict(dom_debits),
    'period': {
        'start': period_start,
        'end': period_end,
        'total_credit': total_credit,
        'total_debit': total_debit,
        'net_change': net_change,
        'opening_balance': opening_balance,
        'closing_balance': closing_balance,
        'total_txns': len(txns),
        'credit_count': sum(1 for t in txns if not t['is_debit']),
        'debit_count': sum(1 for t in txns if t['is_debit']),
    }
}

# Account info (from PDF page 1)
account_info = {
    'account_number': '5613082412',
    'account_type': 'SAVINGS',
    'branch': 'Hyderabad Botanical Garden Road',
    'ifsc': 'KKBK0008398',
    'micr': '500485058',
    'entity_name': 'Green Park Plot Owners Welfare Association',
    'crn': 'XXXXXX390',
    'address': 'P No 1 To 4, 11 To 14 Golden Tulip Estate, Kondapur, Serilingampally, Hyderabad - 500084',
    'period': '01 Apr 2025 - 31 Mar 2026',
    'generated_on': '09 Jun 2026, 04:21 PM',
}

# --- Build HTML ---
# Calculate some additional stats for KPIs
avg_monthly_credit = total_credit / len(monthly_data) if monthly_data else 0
avg_monthly_debit = total_debit / len(monthly_data) if monthly_data else 0
busiest_month = max(monthly_data, key=lambda m: m['count']) if monthly_data else None
highest_balance_date = max(daily_balance_list, key=lambda x: x['balance'])
lowest_balance_date = min(daily_balance_list, key=lambda x: x['balance'])

# Peak credit/debit month
peak_credit_month = max(monthly_data, key=lambda m: m['credit'])
peak_debit_month = max(monthly_data, key=lambda m: m['debit'])

# Find first credit and debit dates
first_credit = next((t for t in txns if not t['is_debit']), None)
first_debit = next((t for t in txns if t['is_debit']), None)

print(f"Opening balance: {inr(opening_balance)}")
print(f"Closing balance: {inr(closing_balance)}")
print(f"Total credit: {inr(total_credit)}")
print(f"Total debit: {inr(total_debit)}")
print(f"Net change: {inr(net_change)}")
print(f"Period: {period_start} to {period_end}")
print(f"Months: {len(monthly_data)}")
print(f"Peak credit month: {peak_credit_month['month']} - {inr(peak_credit_month['credit'])}")
print(f"Peak debit month: {peak_debit_month['month']} - {inr(peak_debit_month['debit'])}")
print(f"Highest balance: {inr(highest_balance_date['balance'])} on {highest_balance_date['date']}")
print(f"Lowest balance: {inr(lowest_balance_date['balance'])} on {lowest_balance_date['date']}")
print(f"Busiest month: {busiest_month['month']} - {busiest_month['count']} txns")

# Save analytics
with open(r'C:\Users\srini\Downloads\Everfern\analytics.json', 'w', encoding='utf-8') as f:
    json.dump({
        'chart_data': chart_data,
        'account_info': account_info,
    }, f, indent=2, ensure_ascii=False)

print("\nAnalytics saved to analytics.json")
