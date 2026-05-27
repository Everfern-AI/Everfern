import requests
import json
import base64

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

screenshot_path = r"C:\Users\srini\.everfern\screenshots\20260524-111645-zoom.png"
with open(screenshot_path, "rb") as f:
    img_data = f.read()
    img_base64 = base64.b64encode(img_data).decode("utf-8")

data = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": "Analyze this screenshot of the screen.",
            "images": [img_base64]
        }
    ],
    "stream": False
}

try:
    print("Sending real screenshot directly to Ollama Cloud...")
    resp = requests.post(api_url, headers=headers, json=data, timeout=60)
    print("Status code:", resp.status_code)
    print("Response headers:", dict(resp.headers))
    print("Response text:", resp.text)
except Exception as e:
    print("Exception occurred:", e)
