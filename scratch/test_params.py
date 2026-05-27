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

# Test 1: With options temperature 0.0
data_temp = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {"role": "user", "content": "hello"}
    ],
    "options": {
        "temperature": 0.0
    },
    "stream": False
}

print("Testing with temperature 0.0...")
resp = requests.post(api_url, headers=headers, json=data_temp)
print("Status Code:", resp.status_code)
print("Response:", resp.text)

# Test 2: With a base64 image
data_img = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": "What is this?",
            "images": ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="]
        }
    ],
    "stream": False
}

print("\nTesting with base64 image...")
resp = requests.post(api_url, headers=headers, json=data_img)
print("Status Code:", resp.status_code)
print("Response:", resp.text)
