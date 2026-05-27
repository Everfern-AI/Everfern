import requests
import zlib
import struct
import base64
import sys

# Ensure UTF-8 output for windows console
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def make_red_png():
    width = 100
    height = 100
    raw_data = b""
    for y in range(height):
        raw_data += b"\x00" # filter type 0
        for x in range(width):
            raw_data += b"\xff\x00\x00"
            
    png = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png += struct.pack(">I", 13) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    
    idat = zlib.compress(raw_data)
    png += struct.pack(">I", len(idat)) + b"IDAT" + idat + struct.pack(">I", zlib.crc32(b"IDAT" + idat))
    
    png += struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    return base64.b64encode(png).decode("ascii")

api_url = "https://ollama.com/api/chat"
api_key = "054c24b5b45d4fa291c1a8f977439a06.PbPWmEkepSnHbP3WqXJhZJBr"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

img_b64 = make_red_png()

# Test with qwen3-vl:235b-instruct
data1 = {
    "model": "qwen3-vl:235b-instruct",
    "messages": [
        {
            "role": "user",
            "content": "What color is this image?",
            "images": [img_b64]
        }
    ],
    "stream": False
}

print("Testing qwen3-vl:235b-instruct with 100x100 PNG...")
try:
    resp = requests.post(api_url, headers=headers, json=data1)
    print("Status Code:", resp.status_code)
    print("Response:", resp.text)
except Exception as e:
    print("Error:", e)

# Test with qwen3-vl:235b-instruct-cloud
data2 = {
    "model": "qwen3-vl:235b-instruct-cloud",
    "messages": [
        {
            "role": "user",
            "content": "What color is this image?",
            "images": [img_b64]
        }
    ],
    "stream": False
}

print("\nTesting qwen3-vl:235b-instruct-cloud with 100x100 PNG...")
try:
    resp = requests.post(api_url, headers=headers, json=data2)
    print("Status Code:", resp.status_code)
    print("Response:", resp.text)
except Exception as e:
    print("Error:", e)
