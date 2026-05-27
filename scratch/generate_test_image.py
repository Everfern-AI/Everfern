import requests
import json
import base64

# Create a valid 200x200 red square PNG using pure python
# (To avoid importing PIL which might not be installed, we can construct a minimal valid PNG or just write a small binary structure. Or we can generate a small BMP, or we can use PIL if installed, let's try to import PIL or use a known valid base64 PNG of reasonable size).
# Let's use a standard base64 string of a 100x100 PNG.
# Here is a 100x100 red square PNG base64:
valid_png_100x100_base64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAAB3RJTUUH"
    "6AMKDA8oZlgoaAAAAbNJREFUeNrt271OAkEUBuDvD8gKxEpjLCyksbCwxsaewkJjLCyxMLGwkMZCewpL"
    "LCyksbCw0FhYY2FhYWGB7yws9BvW2NhYY2NjYWGBhYXF2NhYWGBhYWGBhYWFxcbCwgILC4uxsbGwwMLC"
    "YmxsLCywsLAYGxsLCywsi7GxsU7aA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3Q"
    "HmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9uAk7fP6fTefP+zZ2uLp1e3w4dXt8PHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3g36vbwUdXt8NHV7fDx1e3w8dXt8PHV7fDx1e3w8dX"
    "t8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dX"
    "t8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8eztgfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7"
    "oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kDbK/4B/P4Q1Wup7bMAAAAA"
    "SUVORK5CYII="
)

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": "What is in this image?",
            "images": [valid_png_100x100_base64]
        }
    ],
    "stream": False
}

try:
    print("Sending 100x100 image directly to Ollama Cloud...")
    resp = requests.post(api_url, headers=headers, json=data, timeout=30)
    print("Status code:", resp.status_code)
    print("Response text:", resp.text)
except Exception as e:
    print("Exception occurred:", e)
