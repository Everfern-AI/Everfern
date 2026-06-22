#!/usr/bin/env python3
import sys
import os
import zipfile
import xml.etree.ElementTree as ET

def main():
    if len(sys.argv) < 2:
        print("Usage: python validate.py <doc.docx>", file=sys.stderr)
        sys.exit(1)
        
    docx_file = sys.argv[1]
    if not os.path.exists(docx_file):
        print(f"Error: file not found {docx_file}", file=sys.stderr)
        sys.exit(1)
        
    try:
        with zipfile.ZipFile(docx_file, 'r') as zip_ref:
            # Check all XML files in the ZIP archive
            for file_name in zip_ref.namelist():
                if file_name.endswith('.xml') or file_name.endswith('.xml.rels'):
                    try:
                        with zip_ref.open(file_name) as f:
                            ET.fromstring(f.read())
                    except ET.ParseError as pe:
                        print(f"XML Validation Error in '{file_name}': {pe}", file=sys.stderr)
                        sys.exit(1)
                    except Exception as e:
                        print(f"Error reading '{file_name}': {e}", file=sys.stderr)
                        sys.exit(1)
    except zipfile.BadZipFile:
        print("Error: Invalid ZIP archive (not a valid docx file)", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error validating document: {e}", file=sys.stderr)
        sys.exit(1)
        
    print("Validation successful: Document is valid.")
    sys.exit(0)

if __name__ == "__main__":
    main()
