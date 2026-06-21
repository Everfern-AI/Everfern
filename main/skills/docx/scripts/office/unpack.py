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

def get_prefixed_tag(tag):
    if tag.startswith('{'):
        uri, local = tag[1:].split('}', 1)
        prefix = NS_MAP.get(uri)
        if prefix:
            return f"{prefix}:{local}"
    return tag

def get_prefixed_attr(attr_key):
    if attr_key.startswith('{'):
        uri, local = attr_key[1:].split('}', 1)
        if uri == 'http://www.w3.org/XML/1998/namespace':
            return f"xml:{local}"
        prefix = NS_MAP.get(uri)
        if prefix:
            return f"{prefix}:{local}"
    return attr_key

def pretty_print_element(elem, level=0, indent="  "):
    tag = get_prefixed_tag(elem.tag)
    local_tag = tag.split(':')[-1]
    
    is_text_element = local_tag in ['t', 'delText', 'instrText', 'delInstrText']
    
    attrs = ""
    # Sort attributes for deterministic output
    for k in sorted(elem.attrib.keys()):
        v = elem.attrib[k]
        v_esc = v.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')
        prefixed_k = get_prefixed_attr(k)
        attrs += f' {prefixed_k}="{v_esc}"'
        
    space = indent * level
    
    children = list(elem)
    if not children:
        if elem.text:
            text = elem.text
            # Replace smart quotes with XML entities
            text_esc = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            text_esc = (text_esc
                        .replace('‘', '&#x2018;')
                        .replace('’', '&#x2019;')
                        .replace('“', '&#x201C;')
                        .replace('”', '&#x201D;'))
            if is_text_element:
                return f"<{tag}{attrs}>{text_esc}</{tag}>"
            else:
                return f"\n{space}<{tag}{attrs}>{text_esc}</{tag}>"
        else:
            return f"\n{space}<{tag}{attrs}/>"
            
    child_strs = []
    for child in children:
        child_strs.append(pretty_print_element(child, level + 1, indent))
        
    content = "".join(child_strs)
    if is_text_element:
        return f"<{tag}{attrs}>{content}</{tag}>"
        
    return f"\n{space}<{tag}{attrs}>{content}\n{space}</{tag}>"

def can_merge_runs(r1, r2):
    rPr1, rPr2 = None, None
    t1, t2 = None, None
    
    for child in r1:
        local_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if local_tag == 'rPr':
            rPr1 = child
        elif local_tag in ['t', 'delText', 'instrText', 'delInstrText']:
            t1 = child
        else:
            return False
            
    for child in r2:
        local_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if local_tag == 'rPr':
            rPr2 = child
        elif local_tag in ['t', 'delText', 'instrText', 'delInstrText']:
            t2 = child
        else:
            return False
            
    if t1 is None or t2 is None:
        return False
        
    if t1.tag != t2.tag:
        return False
        
    if not equal_elements(rPr1, rPr2):
        return False
        
    return True

def equal_elements(e1, e2):
    if e1 is None and e2 is None:
        return True
    if e1 is None or e2 is None:
        return False
    if e1.tag != e2.tag:
        return False
    if e1.attrib != e2.attrib:
        return False
    if len(e1) != len(e2):
        return False
    for c1, c2 in zip(e1, e2):
        if not equal_elements(c1, c2):
            return False
    return True

def merge_runs(r1, r2):
    t1, t2 = None, None
    for child in r1:
        local_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if local_tag in ['t', 'delText', 'instrText', 'delInstrText']:
            t1 = child
    for child in r2:
        local_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if local_tag in ['t', 'delText', 'instrText', 'delInstrText']:
            t2 = child
            
    if t1 is not None and t2 is not None:
        text1 = t1.text or ""
        text2 = t2.text or ""
        t1.text = text1 + text2
        if t1.text.startswith(" ") or t1.text.endswith(" "):
            t1.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

def merge_runs_in_tree(root):
    for parent in root.iter():
        children = list(parent)
        if not children:
            continue
        i = 0
        while i < len(children) - 1:
            child1 = children[i]
            child2 = children[i+1]
            tag1 = child1.tag.split('}')[-1] if '}' in child1.tag else child1.tag
            tag2 = child2.tag.split('}')[-1] if '}' in child2.tag else child2.tag
            
            if tag1 == 'r' and tag2 == 'r':
                if can_merge_runs(child1, child2):
                    merge_runs(child1, child2)
                    parent.remove(child2)
                    children.pop(i+1)
                    continue
            i += 1

def main():
    parser = argparse.ArgumentParser(description="Unpack and pretty-print docx files.")
    parser.add_argument("docx_file", help="Path to input docx file")
    parser.add_argument("output_dir", help="Path to output directory")
    parser.add_argument("--merge-runs", default="true", help="Merge adjacent runs with identical formatting (true/false)")
    args = parser.parse_args()
    
    do_merge = args.merge_runs.lower() == 'true'
    
    if not os.path.exists(args.docx_file):
        print(f"Error: file not found {args.docx_file}", file=sys.stderr)
        sys.exit(1)
        
    os.makedirs(args.output_dir, exist_ok=True)
    
    with zipfile.ZipFile(args.docx_file, 'r') as zip_ref:
        zip_ref.extractall(args.output_dir)
        
    # Process all XML files in the unpacked directory
    for root_dir, _, files in os.walk(args.output_dir):
        for file in files:
            if file.endswith('.xml') or file.endswith('.xml.rels'):
                file_path = os.path.join(root_dir, file)
                try:
                    # Parse XML
                    tree = ET.parse(file_path)
                    root = tree.getroot()
                    
                    if do_merge:
                        merge_runs_in_tree(root)
                        
                    # Pretty print
                    pretty_xml = pretty_print_element(root).lstrip()
                    
                    # Prepend XML declaration
                    output_content = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + pretty_xml
                    
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(output_content)
                except Exception as e:
                    print(f"Warning: Failed to pretty-print/merge {file_path}: {e}", file=sys.stderr)

    print("Unpacked and formatted successfully.")

if __name__ == "__main__":
    main()
