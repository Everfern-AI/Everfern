import requests
import os
import json

def verify_everfern_auth():
    token_path = os.path.expanduser("~/.everfern/keys/everfern.key")
    if not os.path.exists(token_path):
        print(f"Error: Token not found at {token_path}")
        return

    with open(token_path, "r") as f:
        token = f.read().strip()

    api_url = "https://api.everfern.app/api/chat/completions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "fern-1",
        "messages": [{"role": "user", "content": "Hello, are you there?"}],
        "max_tokens": 10
    }

    print(f"Testing Everfern Cloud API with token from {token_path}...")
    try:
        resp = requests.post(api_url, headers=headers, json=data)
        if resp.status_code == 200:
            print("✅ Success! API returned 200 OK.")
            print("Response:", resp.json().get("choices", [{}])[0].get("message", {}).get("content", ""))
        else:
            print(f"❌ Failed. API returned {resp.status_code}.")
            print("Error details:", resp.text)
    except Exception as e:
        print(f"❌ Error during request: {e}")

if __name__ == "__main__":
    verify_everfern_auth()
