import requests
import json

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

# 1x1 pixel base64 encoded PNG
dummy_img_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

data = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": "What is in this image?",
            "images": [dummy_img_base64]
        }
    ],
    "stream": False
}

try:
    print("Sending request directly to Ollama Cloud with image...")
    resp = requests.post(api_url, headers=headers, json=data, timeout=30)
    print("Status code:", resp.status_code)
    print("Response headers:", dict(resp.headers))
    print("Response text:", resp.text)
except Exception as e:
    print("Exception occurred:", e)
