import requests
import json
import base64

api_url = "http://127.0.0.1:5328/api/chat/completions"
token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNhMGI4MDkzLTIzYmEtNGIxMC1iOTA5LTgxMzYyZTRiNmY1YSIsImVtYWlsIjoicHJlZXRoYW0ucmFuZ3VAZ21haWwuY29tIiwicGxhbiI6ImZyZWUiLCJpYXQiOjE3Nzk1MTUwNDgsImV4cCI6MTc4MDExOTg0OH0.YIQL0TbnH28lAjARTyenx0IyHpSxj5zujo09VBpkDDk"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# 100x100 red square PNG in base64
valid_png_100x100_base64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAAB3RJTUUH"
    "6AMKDA8oZlgoaAAAAbNJREFUeNrt271OAkEUBuDvD8gKxEpjLCyksbCwxsaewkJjLCyxMLGwkMZCewpL"
    "LCyksbCw0FhYY2FhYWGB7yws9BvW2NhYY2NjYWGBhYXF2NhYWGBhYWGBhYWFxcbCwgILC4uxsbGwwMLC"
    "YmxsLCywsLAYGxsLCywsi7GxsU7aA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3Q"
    "HmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9uAk7fP6fTefP+zZ2uLp1e3w4dXt8PHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV"
    "7fDh1e3w4dXt8OHV7fDh1e3w4dXt8OHV7fDh1e3g36vbwUdt8NHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt"
    "8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt"
    "8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8dXt8PHV7fDx1e3w8eztgfaA+2B9kB7oD3Q"
    "HmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kB7oD3QHmgPtAfaA+2B9kDbK/4B"
    "/P4Q1Wup7bMAAAAASUVORK5CYII="
)
dummy_img = f"data:image/png;base64,{valid_png_100x100_base64}"

data = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this image?"},
                {"type": "image_url", "image_url": {"url": dummy_img}}
            ]
        }
    ],
    "stream": False
}

try:
    print("Sending request to EverFern API proxy...")
    resp = requests.post(api_url, headers=headers, json=data, timeout=30)
    print("Status code:", resp.status_code)
    print("Response headers:", dict(resp.headers))
    print("Response text:", resp.text)
except Exception as e:
    print("Exception occurred:", e)
