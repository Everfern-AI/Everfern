#!/usr/bin/env python3
import sys
import subprocess
import shutil
import os

def main():
    # Pass all arguments directly to soffice
    args = sys.argv[1:]
    
    # Try to find soffice
    soffice_path = shutil.which("soffice")
    if not soffice_path:
        soffice_path = shutil.which("libreoffice")
        
    if not soffice_path:
        # Check common paths
        for path in ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"]:
            if os.path.exists(path):
                soffice_path = path
                break

    if not soffice_path:
        print("Error: LibreOffice (soffice) not found. Please install it on the system.", file=sys.stderr)
        sys.exit(1)

    cmd = [soffice_path] + args
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        print(f"LibreOffice failed with code {result.returncode}", file=sys.stderr)
        print(result.stdout.decode(errors='replace'), file=sys.stderr)
        print(result.stderr.decode(errors='replace'), file=sys.stderr)
        sys.exit(result.returncode)
    else:
        print("Conversion successful.")

if __name__ == "__main__":
    main()
