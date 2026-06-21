#!/usr/bin/env python3
import sys
import os
import zipfile
import argparse
import xml.etree.ElementTree as ET

NS_MAP = {
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
    'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
    'urn:schemas-microsoft-com:vml': 'v',
    'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
    'urn:schemas-microsoft-com:office:word': 'w10',
    'http://schemas.microsoft.com/office/word/2006/wordml': 'wne',
    'http://schemas.openxmlformats.org/markup-compatibility/2006': 've',
    'urn:schemas-microsoft-com:office:office': 'o',
    'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
    'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
    'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
    'http://schemas.openxmlformats.org/package/2006/content-types': 'ct'
}

for prefix, uri in NS_MAP.items():
    ET.register_namespace(uri, prefix)

# Also register standard xml namespace for xml:space
ET.register_namespace('http://www.w3.org/XML/1998/namespace', 'xml')

def auto_repair_element(elem, next_durable_id):
    # 1. Fix durableId
    for k in list(elem.attrib.keys()):
        if k.endswith('durableId') or 'durableId' in k:
            val = elem.attrib[k]
            try:
                if val.lower().startswith('0x'):
                    int_val = int(val, 16)
                else:
                    int_val = int(val)
                if int_val >= 0x7FFFFFFF or int_val < 0:
                    elem.attrib[k] = str(next_durable_id[0])
                    next_durable_id[0] += 1
            except ValueError:
                pass
                
    # 2. Fix xml:space="preserve"
    local_tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
    if local_tag in ['t', 'delText', 'instrText', 'delInstrText']:
        text = elem.text or ""
        if text.startswith(' ') or text.endswith(' ') or '\t' in text or '\n' in text:
            elem.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            
    for child in elem:
        auto_repair_element(child, next_durable_id)

def main():
    parser = argparse.ArgumentParser(description="Pack unpacked directory back to docx file.")
    parser.add_argument("unpacked_dir", help="Path to input unpacked directory")
    parser.add_argument("output_docx", help="Path to output docx file")
    parser.add_argument("--original", help="Path to original docx file (optional)")
    parser.add_argument("--validate", default="true", help="Validate XML structures before packing (true/false)")
    args = parser.parse_args()
    
    do_validate = args.validate.lower() == 'true'
    
    if not os.path.exists(args.unpacked_dir):
        print(f"Error: unpacked directory not found {args.unpacked_dir}", file=sys.stderr)
        sys.exit(1)
        
    next_durable_id = [1000000000]
    
    # Process and repair XML files
    for root_dir, _, files in os.walk(args.unpacked_dir):
        for file in files:
            if file.endswith('.xml') or file.endswith('.xml.rels'):
                file_path = os.path.join(root_dir, file)
                try:
                    # Validate parsing
                    tree = ET.parse(file_path)
                    root = tree.getroot()
                    
                    # Auto repair
                    auto_repair_element(root, next_durable_id)
                    
                    # Write condensed XML back
                    # xml_declaration=True and default encoding='utf-8'
                    with open(file_path, 'wb') as f:
                        tree.write(f, encoding='utf-8', xml_declaration=True)
                except Exception as e:
                    if do_validate:
                        print(f"Validation error in {file_path}: {e}", file=sys.stderr)
                        sys.exit(1)
                    else:
                        print(f"Warning: XML issue in {file_path} (skipped validation): {e}", file=sys.stderr)

    # Pack into zip
    with zipfile.ZipFile(args.output_docx, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for root_dir, _, files in os.walk(args.unpacked_dir):
            for file in files:
                file_path = os.path.join(root_dir, file)
                # Store relative to unpacked directory root
                arcname = os.path.relpath(file_path, args.unpacked_dir)
                zip_ref.write(file_path, arcname)
                
    print("Repacked successfully.")

if __name__ == "__main__":
    main()
