#!/usr/bin/env python3
import sys
import os
import argparse
from datetime import datetime
import xml.etree.ElementTree as ET

# Namespaces
W_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
RELS_URI = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_URI = 'http://schemas.openxmlformats.org/package/2006/content-types'

ET.register_namespace('w', W_URI)
ET.register_namespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')

def ensure_comments_xml(comments_path):
    if not os.path.exists(comments_path):
        os.makedirs(os.path.dirname(comments_path), exist_ok=True)
        root = ET.Element(f'{{{W_URI}}}comments')
        tree = ET.ElementTree(root)
        tree.write(comments_path, encoding='utf-8', xml_declaration=True)

def ensure_relationships(rels_path):
    if not os.path.exists(rels_path):
        return
    tree = ET.parse(rels_path)
    root = tree.getroot()
    
    # Check if comments relationship already exists
    has_comments = False
    max_rid = 0
    for child in root:
        target = child.attrib.get('Target', '')
        rid = child.attrib.get('Id', '')
        if 'comments.xml' in target:
            has_comments = True
        if rid.startswith('rId'):
            try:
                max_rid = max(max_rid, int(rid[3:]))
            except ValueError:
                pass
                
    if not has_comments:
        new_rid = f"rId{max_rid + 1}"
        new_rel = ET.Element('Relationship', {
            'Id': new_rid,
            'Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
            'Target': 'comments.xml'
        })
        root.append(new_rel)
        tree.write(rels_path, encoding='utf-8', xml_declaration=True)

def ensure_content_types(ct_path):
    if not os.path.exists(ct_path):
        return
    tree = ET.parse(ct_path)
    root = tree.getroot()
    
    # Check if comments override exists
    has_comments_ct = False
    for child in root:
        part_name = child.attrib.get('PartName', '')
        if part_name == '/word/comments.xml':
            has_comments_ct = True
            
    if not has_comments_ct:
        new_override = ET.Element(f'{{{CT_URI}}}Override', {
            'PartName': '/word/comments.xml',
            'ContentType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
        })
        root.append(new_override)
        tree.write(ct_path, encoding='utf-8', xml_declaration=True)

def main():
    parser = argparse.ArgumentParser(description="Add or reply to comments in unpacked DOCX workspace.")
    parser.add_argument("unpacked_dir", help="Path to unpacked docx folder")
    parser.add_argument("comment_id", help="ID of the comment to create/reply")
    parser.add_argument("text", help="Comment text (pre-escaped XML)")
    parser.add_argument("--parent", help="Parent comment ID (for replies)", default=None)
    parser.add_argument("--author", help="Author of the comment", default="Claude")
    args = parser.parse_args()
    
    comments_path = os.path.join(args.unpacked_dir, "word", "comments.xml")
    rels_path = os.path.join(args.unpacked_dir, "word", "_rels", "document.xml.rels")
    ct_path = os.path.join(args.unpacked_dir, "[Content_Types].xml")
    
    # Ensure boilerplate structures exist
    ensure_comments_xml(comments_path)
    ensure_relationships(rels_path)
    ensure_content_types(ct_path)
    
    # Parse and modify comments.xml
    tree = ET.parse(comments_path)
    root = tree.getroot()
    
    # Check if comment ID already exists
    existing_comment = None
    for comment in root.findall(f'{{{W_URI}}}comment'):
        if comment.attrib.get(f'{{{W_URI}}}id') == args.comment_id:
            existing_comment = comment
            break
            
    date_str = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    
    # Wrap text in a paragraph element structure
    # Since text is pre-escaped, wrap it in tags and parse it
    p_xml = f'<w:p xmlns:w="{W_URI}"><w:r><w:t xml:space="preserve">{args.text}</w:t></w:r></w:p>'
    p_element = ET.fromstring(p_xml)
    
    # Clean namespaces from child elements of p_element to avoid prefix clutter
    for child in p_element.iter():
        if child.tag.startswith(f'{{{W_URI}}}'):
            # Already has correct namespace
            pass
            
    if existing_comment is not None:
        # Update text of existing comment
        # Remove old paragraphs
        for p in list(existing_comment.findall(f'{{{W_URI}}}p')):
            existing_comment.remove(p)
        existing_comment.append(p_element)
        existing_comment.attrib[f'{{{W_URI}}}author'] = args.author
        existing_comment.attrib[f'{{{W_URI}}}date'] = date_str
    else:
        # Create new comment element
        attribs = {
            f'{{{W_URI}}}id': args.comment_id,
            f'{{{W_URI}}}author': args.author,
            f'{{{W_URI}}}date': date_str
        }
        if args.parent is not None:
            # Modern Word parent relationship: parentId attribute on comment
            attribs[f'{{{W_URI}}}parentId'] = args.parent
            
        new_comment = ET.Element(f'{{{W_URI}}}comment', attribs)
        new_comment.append(p_element)
        root.append(new_comment)
        
    # Write back
    tree.write(comments_path, encoding='utf-8', xml_declaration=True)
    print(f"Comment {args.comment_id} written successfully.")

if __name__ == "__main__":
    main()
