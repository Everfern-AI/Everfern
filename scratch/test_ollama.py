import requests
import sys

# Set output encoding to utf-8
sys.stdout.reconfigure(encoding='utf-8')

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {"role": "user", "content": "Hello, are you there?"}
    ],
    "stream": True
}

try:
    print("Sending streaming request to:", api_url)
    resp = requests.post(api_url, headers=headers, json=data, stream=True)
    print("Status code:", resp.status_code)
    print("Response chunks:")
    for chunk in resp.iter_lines():
        if chunk:
            print("CHUNK:", chunk.decode("utf-8"))
except Exception as e:
    print("Exception occurred:", e)
