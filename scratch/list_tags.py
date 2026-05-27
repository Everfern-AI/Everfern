import requests
import json
import sys

# Ensure UTF-8 output for windows console
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

tags_url = "https://ollama.com/api/tags"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}"
}

try:
    resp = requests.get(tags_url, headers=headers)
    if resp.status_code == 200:
        models = resp.json().get('models', [])
        names = [m['name'] for m in models]
        print("Available models:")
        for name in sorted(names):
            print(f"- {name}")
    else:
        print("Response:", resp.text)
except Exception as e:
    print("Error:", e)
