import requests
import sys

# Ensure UTF-8 output for windows console
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

proxy_url = "https://api.everfern.app/api/chat/completions"
token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNhMGI4MDkzLTIzYmEtNGIxMC1iOTA5LTgxMzYyZTRiNmY1YSIsImVtYWlsIjoicHJlZXRoYW0ucmFuZ3VAZ21haWwuY29tIiwicGxhbiI6ImZyZWUiLCJpYXQiOjE3Nzk1MTUwNDgsImV4cCI6MTc4MDExOTg0OH0.YIQL0TbnH28lAjARTyenx0IyHpSxj5zujo09VBpkDDk"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Test 1: Text-only request
text_data = {
    "model": "minimax-m2.7",
    "messages": [
        {"role": "user", "content": "hi"}
    ],
    "stream": False
}

print("Testing text completion...")
try:
    resp = requests.post(proxy_url, headers=headers, json=text_data)
    print("Text Completion Status:", resp.status_code)
    print("Text Completion Response:", resp.text)
except Exception as e:
    print("Text Completion Error:", e)

# Test 2: Vision request
vision_data = {
    "model": "minimax-m2.7",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is this?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}}
            ]
        }
    ],
    "stream": False
}

print("\nTesting vision completion...")
try:
    resp = requests.post(proxy_url, headers=headers, json=vision_data)
    print("Vision Completion Status:", resp.status_code)
    print("Vision Completion Response:", resp.text)
except Exception as e:
    print("Vision Completion Error:", e)
