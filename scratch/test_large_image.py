import requests
import zlib
import struct
import base64
import os
import random
import sys

# Ensure UTF-8 output for windows console
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def make_large_noise_png():
    width = 1920
    height = 1080
    # Generate random bytes for noise
    raw_data = b""
    for y in range(height):
        raw_data += b"\x00" # filter type 0
        # Use random segments to make it large and uncompressible
        raw_data += bytes(random.getrandbits(8) for _ in range(width * 3))
            
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

print("Generating large noise PNG...")
img_b64 = make_large_noise_png()
print(f"Generated base64 string of length: {len(img_b64)} characters (~{len(img_b64) * 3 // 4 / (1024*1024):.2f} MB)")

data = {
    "model": "qwen3-vl:235b-instruct",
    "messages": [
        {
            "role": "user",
            "content": "Describe this image.",
            "images": [img_b64]
        }
    ],
    "stream": False
}

print("\nSending to Ollama Cloud...")
try:
    resp = requests.post(api_url, headers=headers, json=data)
    print("Status Code:", resp.status_code)
    print("Response headers:", dict(resp.headers))
    print("Response text:", resp.text[:1000])
except Exception as e:
    print("Exception occurred:", type(e).__name__, str(e))
