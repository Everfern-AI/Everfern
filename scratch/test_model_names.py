import requests
import sys

# Ensure UTF-8 output for windows console
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
    "model": "qwen3-vl:235b-instruct",
    "messages": [
        {
            "role": "user",
            "content": "What is this?",
            "images": ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="]
        }
    ],
    "stream": False
}

print("Testing with model: qwen3-vl:235b-instruct...")
try:
    resp = requests.post(api_url, headers=headers, json=data)
    print("Status Code:", resp.status_code)
    print("Response:", resp.text)
except Exception as e:
    print("Error:", e)
