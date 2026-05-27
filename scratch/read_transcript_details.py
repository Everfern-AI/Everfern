import json
import sys

# Set stdout to UTF-8
sys.stdout.reconfigure(encoding='utf-8')

path = r"C:\Users\srini\.gemini\antigravity\brain\3dc55d36-20cb-41af-a2b3-68d205f2cf01\.system_generated\logs\transcript.jsonl"

steps = []
with open(path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            steps.append(json.loads(line))
        except:
            pass

print(f"Total steps: {len(steps)}")
start_idx = 0
for idx, step in enumerate(steps):
    if "no maybe something is wrong with everfern cloud api" in str(step):
        start_idx = idx
        break

print(f"Found match at index: {start_idx}")

for i in range(start_idx, len(steps)):
    step = steps[i]
    source = step.get("source")
    step_type = step.get("type")
    content = step.get("content", "")
    
    print(f"\n=== STEP {i} ({source} - {step_type}) ===")
    if content:
        print("Content:", content[:1000])
    if "tool_calls" in step:
        for tc in step["tool_calls"]:
            print(f"Tool Call: {tc.get('name')}")
            print(f"Arguments: {json.dumps(tc.get('arguments'))[:500]}")
    for k, v in step.items():
        if k not in ["content", "tool_calls", "source", "type"]:
            print(f"{k}: {str(v)[:500]}")
