#!/usr/bin/env python3
import sys
import os
import zipfile
import tempfile
import shutil
import xml.etree.ElementTree as ET

W_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
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
ET.register_namespace('http://www.w3.org/XML/1998/namespace', 'xml')

def accept_changes_in_tree(root):
    ins_tag = f'{{{W_URI}}}ins'
    del_tag = f'{{{W_URI}}}del'
    move_to_tag = f'{{{W_URI}}}moveTo'
    move_from_tag = f'{{{W_URI}}}moveFrom'
    
    def process_element(elem):
        # Process children first (bottom-up)
        for child in list(elem):
            process_element(child)
            
        new_children = []
        for child in elem:
            if child.tag == ins_tag or child.tag == move_to_tag:
                # Promote children of w:ins / w:moveTo to be direct children of parent
                new_children.extend(list(child))
            elif child.tag == del_tag or child.tag == move_from_tag:
                # Omit w:del / w:moveFrom entirely
                pass
            else:
                new_children.append(child)
                
        elem[:] = new_children

    process_element(root)

def main():
    if len(sys.argv) < 3:
        print("Usage: python accept_changes.py <input.docx> <output.docx>", file=sys.stderr)
        sys.exit(1)
        
    input_docx = sys.argv[1]
    output_docx = sys.argv[2]
    
    if not os.path.exists(input_docx):
        print(f"Error: input file not found {input_docx}", file=sys.stderr)
        sys.exit(1)
        
    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    
    try:
        # Extract zip
        with zipfile.ZipFile(input_docx, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
            
        # Process XML files
        for root_dir, _, files in os.walk(temp_dir):
            for file in files:
                if file.endswith('.xml'):
                    file_path = os.path.join(root_dir, file)
                    try:
                        tree = ET.parse(file_path)
                        root = tree.getroot()
                        
                        # Process tracked changes
                        accept_changes_in_tree(root)
                        
                        # Write back
                        with open(file_path, 'wb') as f:
                            tree.write(f, encoding='utf-8', xml_declaration=True)
                    except ET.ParseError:
                        # Skip files that are not valid xml or parse error
                        pass
                        
        # Pack back into zip
        with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for root_dir, _, files in os.walk(temp_dir):
                for file in files:
                    file_path = os.path.join(root_dir, file)
                    arcname = os.path.relpath(file_path, temp_dir)
                    zip_ref.write(file_path, arcname)
                    
        print(f"Accepted all tracked changes: saved clean document to {output_docx}")
    finally:
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    main()
