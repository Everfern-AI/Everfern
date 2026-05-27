import json

path = r"C:\Users\srini\.gemini\antigravity\brain\3dc55d36-20cb-41af-a2b3-68d205f2cf01\.system_generated\logs\transcript.jsonl"

with open(path, "r", encoding="utf-8") as f:
    for line in f:
        try:
            step = json.loads(line)
            source = step.get("source")
            step_type = step.get("type")
            content = step.get("content", "")
            
            # Print user messages
            if step_type == "USER_INPUT":
                print(f"--- USER INPUT ---")
                print(content[:500])
            elif source == "MODEL" and step_type == "PLANNER_RESPONSE":
                print(f"--- PLANNER RESPONSE ---")
                print(content[:500])
            elif "tool_calls" in step:
                for tc in step["tool_calls"]:
                    if "ollama" in str(tc).lower() or "proxy" in str(tc).lower():
                        print(f"--- TOOL CALL ({tc.get('name')}) ---")
                        print(str(tc.get("arguments"))[:300])
        except Exception as e:
            pass
