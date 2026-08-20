'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  Code2,
  Copy,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
  FileCode,
} from 'lucide-react';
import { MarkdownRenderer } from '../common/MarkdownComponents';

/* ============================================================
   TYPES & PROPS
   ============================================================ */

export interface ToolCallCodePaneProps {
  toolName: string;
  path?: string;
  args?: any;
  output?: string;
  data?: any;
  onClose: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  activeChunkIndex?: number;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'normal';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineNumber?: number;
}

/* ============================================================
   TOKENIZER / SYNTAX HIGHLIGHTER (MATCHES REFERENCE IMAGE)
   ============================================================ */

const PALETTE = {
  keyword: '#c084fc',     // Purple / Violet (import, export, interface, extends, function, return, readonly)
  string: '#4ade80',      // Vibrant Green ("use client", "react", "lucide-react", "div")
  type: '#38bdf8',        // Sky Blue / Cyan (WebSearchResult, WebSearchProps, ComponentProps, string, number, boolean, T)
  prop: '#f87171',        // Coral / Salmon (query, results, visibleResults, title, domain, url, snippet, className)
  fn: '#60a5fa',          // Blue / Cyan (useState, take, slice, cn)
  component: '#fb923c',   // Orange (SearchIcon, ExternalLink, ChevronDown, ShimmerLabel, motion, AnimatePresence)
  number: '#38bdf8',      // Cyan (0, 1, 2, etc.)
  punctuation: '#e4e4e7', // Light Gray / White ({ } ( ) [ ] ; , : | ? .)
  comment: '#71717a',     // Muted Gray (//, /* */, #)
  text: '#e4e4e7',        // Default text
};

export function tokenizeCodeLine(line: string, ext: string = 'tsx'): React.ReactNode[] {
  if (!line) {
    return [<span key="empty">&nbsp;</span>];
  }

  // Quick check for comment lines
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || (ext === 'py' && trimmed.startsWith('#'))) {
    return [<span key="comment" style={{ color: PALETTE.comment }}>{line}</span>];
  }

  // Directives like "use client"; or "use strict";
  if (trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'") || trimmed.startsWith('"use strict"') || trimmed.startsWith("'use strict'")) {
    const quoteEnd = line.indexOf(';', line.indexOf('use'));
    if (quoteEnd !== -1) {
      return [
        <span key="str" style={{ color: PALETTE.string }}>{line.slice(0, quoteEnd)}</span>,
        <span key="semi" style={{ color: PALETTE.punctuation }}>{line.slice(quoteEnd)}</span>,
      ];
    }
    return [<span key="str" style={{ color: PALETTE.string }}>{line}</span>];
  }

  const tokens: React.ReactNode[] = [];
  let remaining = line;
  let keyIndex = 0;

  // Regex patterns
  const re = /^(?:\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|export|from|default|const|let|var|function|class|extends|implements|interface|type|enum|namespace|module|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|typeof|instanceof|void|delete|in|of|async|await|yield|get|set|static|public|private|protected|as|declare|readonly|def|elif|pass|raise|with|lambda)\b|\b(?:string|number|boolean|any|void|never|unknown|null|undefined|object|Array|Promise|React|Record|Map|Set|Date|Error|RegExp|JSON|ComponentProps|Omit|Pick|Partial|Required|Readonly|JSX|HTMLProps)\b|\b[A-Z][a-zA-Z0-9_$]*\b|\b[a-zA-Z0-9_$]+(?=\s*\??\s*:)|[a-zA-Z0-9_$]+(?=\s*\()|\b\d+(?:\.\d+)?\b|[{}()\[\];,:.?|&!=+\-*/<>]+|\s+|[a-zA-Z0-9_$]+)/;

  while (remaining.length > 0) {
    const match = remaining.match(re);
    if (!match) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.text }}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
      continue;
    }

    const token = match[0];
    remaining = remaining.slice(token.length);

    // 1. Comments
    if (token.startsWith('//') || token.startsWith('/*')) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.comment }}>{token}</span>);
    }
    // 2. Strings
    else if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) || (token.startsWith('`') && token.endsWith('`'))) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.string }}>{token}</span>);
    }
    // 3. Keywords
    else if (/^(import|export|from|default|const|let|var|function|class|extends|implements|interface|type|enum|namespace|module|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|typeof|instanceof|void|delete|in|of|async|await|yield|get|set|static|public|private|protected|as|declare|readonly|def|elif|pass|raise|with|lambda)$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.keyword }}>{token}</span>);
    }
    // 4. Built-in types
    else if (/^(string|number|boolean|any|void|never|unknown|null|undefined|object|Array|Promise|React|Record|Map|Set|Date|Error|RegExp|JSON|ComponentProps|Omit|Pick|Partial|Required|Readonly|JSX|HTMLProps)$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.type }}>{token}</span>);
    }
    // 5. PascalCase identifiers (Type names or Components)
    else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(token)) {
      // Single letters like T, K, V are generic types -> Sky Blue
      if (token.length <= 2) {
        tokens.push(<span key={keyIndex++} style={{ color: PALETTE.type }}>{token}</span>);
      }
      // Common component names or props
      else if (token.endsWith('Props') || token.endsWith('Result') || token.endsWith('Type') || token.endsWith('State') || token.endsWith('Interface')) {
        tokens.push(<span key={keyIndex++} style={{ color: PALETTE.type }}>{token}</span>);
      } else {
        tokens.push(<span key={keyIndex++} style={{ color: PALETTE.component }}>{token}</span>);
      }
    }
    // 6. Numbers
    else if (/^\d+(?:\.\d+)?$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.number }}>{token}</span>);
    }
    // 7. Punctuation & Operators
    else if (/^[{}()\[\];,:.?|&!=+\-*/<>]+$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.punctuation }}>{token}</span>);
    }
    // 8. Properties (if followed by ? : or :)
    else if (remaining.trim().startsWith(':') || remaining.trim().startsWith('?:')) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.prop }}>{token}</span>);
    }
    // 9. Function calls (if followed by ()
    else if (remaining.trim().startsWith('(')) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.fn }}>{token}</span>);
    }
    // 10. Parameters / Identifiers
    else if (/^[a-zA-Z0-9_$]+$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.prop }}>{token}</span>);
    }
    // 11. Whitespace or generic
    else {
      tokens.push(<span key={keyIndex++} style={{ color: PALETTE.text }}>{token}</span>);
    }
  }

  return tokens;
}

/* ============================================================
   MAIN COMPONENT: ToolCallCodePane
   ============================================================ */

export function ToolCallCodePane({
  toolName,
  path = '',
  args = {},
  output = '',
  data = {},
  onClose,
  isExpanded = false,
  onToggleExpand,
  activeChunkIndex = 0,
}: ToolCallCodePaneProps) {
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');
  const [copied, setCopied] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // Close copy menu when clicking outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    if (showCopyMenu) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCopyMenu]);

  // Determine tool operation type
  const toolNameLower = (toolName || '').toLowerCase();
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isRead = toolNameLower === 'read' || toolNameLower === 'read_file' || toolNameLower === 'view_file' || toolNameLower.includes('view');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');

  // Determine file path, filename, and extension
  const rawPath = String(
    path ||
    args?.TargetFile ||
    args?.AbsolutePath ||
    args?.filePath ||
    args?.file ||
    args?.path ||
    data?.path ||
    ''
  );

  const filename = useMemo(() => {
    if (rawPath) {
      return rawPath.split(/[/\\]/).pop() || rawPath;
    }
    if (toolNameLower.includes('search')) return 'Web search';
    if (isWrite) return 'Write';
    if (isEdit) return 'Edit';
    if (isRead) return 'View';
    return toolName || 'Code';
  }, [rawPath, toolNameLower, isWrite, isEdit, isRead, toolName]);

  const ext = useMemo(() => {
    if (rawPath.includes('.')) {
      return rawPath.split('.').pop()?.toLowerCase() || 'tsx';
    }
    return 'tsx';
  }, [rawPath]);

  // Format header title label: "{Title} · {EXT}"
  const headerLabel = useMemo(() => {
    const extUpper = ext.toUpperCase();
    return `${filename} · ${extUpper}`;
  }, [filename, ext]);

  // Extract content & compute diffs
  const { content, diffLines, chunks, isMultiChunk, fullTextToCopy } = useMemo(() => {
    let rawNew = '';
    let rawOld = '';
    let isMulti = false;
    let chunkList: Array<{ target: string; replacement: string; startLine?: number; endLine?: number }> = [];

    if (isWrite) {
      rawNew = String(args?.CodeContent || args?.content || args?.file_content || args?.text || data?.content || output || '').trim();
    } else if (isRead) {
      rawNew = String(output || args?.content || data?.content || '').trim();
    } else {
      // Edit / Replace
      if (args?.ReplacementChunks && Array.isArray(args.ReplacementChunks) && args.ReplacementChunks.length > 0) {
        isMulti = true;
        chunkList = args.ReplacementChunks.map((c: any) => ({
          target: String(c.TargetContent || c.target || c.oldString || ''),
          replacement: String(c.ReplacementContent || c.replacement || c.newString || ''),
          startLine: c.StartLine,
          endLine: c.EndLine,
        }));
      } else {
        rawOld = String(
          args?.TargetContent ||
          args?.oldString ||
          args?.old_string ||
          args?.oldText ||
          args?.search ||
          args?.find ||
          data?.oldString ||
          ''
        );
        rawNew = String(
          args?.ReplacementContent ||
          args?.newString ||
          args?.new_string ||
          args?.newText ||
          args?.replace ||
          args?.insert ||
          data?.newString ||
          ''
        );
      }
    }

    const mainContent = rawNew || output || rawOld || '';

    // Build diff lines
    const lines: DiffLine[] = [];

    if (isWrite || isRead) {
      const splitLines = mainContent.split('\n');
      splitLines.forEach((line, idx) => {
        lines.push({
          type: isWrite ? 'added' : 'normal',
          content: line,
          lineNumber: idx + 1,
        });
      });
    } else if (isMulti) {
      let currentLine = 1;
      chunkList.forEach((chunk) => {
        const oldSplit = chunk.target ? chunk.target.split('\n') : [];
        const newSplit = chunk.replacement ? chunk.replacement.split('\n') : [];

        oldSplit.forEach((line) => {
          lines.push({
            type: 'removed',
            content: line,
            lineNumber: currentLine++,
          });
        });
        newSplit.forEach((line) => {
          lines.push({
            type: 'added',
            content: line,
            lineNumber: currentLine++,
          });
        });
      });
    } else if (rawOld || rawNew) {
      const oldSplit = rawOld ? rawOld.split('\n') : [];
      const newSplit = rawNew ? rawNew.split('\n') : [];

      let lineNum = 1;
      oldSplit.forEach((line) => {
        lines.push({
          type: 'removed',
          content: line,
          lineNumber: lineNum++,
        });
      });
      newSplit.forEach((line) => {
        lines.push({
          type: 'added',
          content: line,
          lineNumber: lineNum++,
        });
      });
    } else {
      const splitLines = (output || '').split('\n');
      splitLines.forEach((line, idx) => {
        lines.push({
          type: 'normal',
          content: line,
          lineNumber: idx + 1,
        });
      });
    }

    const textToCopy = isMulti
      ? chunkList.map((c) => c.replacement).join('\n')
      : mainContent;

    return {
      content: mainContent,
      diffLines: lines,
      chunks: chunkList,
      isMultiChunk: isMulti,
      fullTextToCopy: textToCopy,
    };
  }, [isWrite, isRead, isEdit, args, output, data]);

  // Copy handlers
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(fullTextToCopy);
      setCopied(true);
      setShowCopyMenu(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleCopyPath = async () => {
    if (!rawPath) return;
    try {
      await navigator.clipboard.writeText(rawPath);
      setCopied(true);
      setShowCopyMenu(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const isMarkdownOrHtml = ext === 'md' || ext === 'markdown' || ext === 'html' || ext === 'htm';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#18181b',
        color: '#e4e4e7',
        fontFamily: '"Geist", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* ── TOP HEADER BAR (EXACT AS IMAGE) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: '#18181b',
          borderBottom: '1px solid #27272a',
          userSelect: 'none',
          gap: 12,
          flexShrink: 0,
        }}
      >
        {/* Left Side: Toggle Pill + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {/* Eye / Code Segmented Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 6,
              padding: 2,
              gap: 2,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setViewMode('preview')}
              title="Preview view"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 24,
                borderRadius: 4,
                border: 'none',
                background: viewMode === 'preview' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                color: viewMode === 'preview' ? '#ffffff' : '#71717a',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Eye size={14} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setViewMode('code')}
              title="Code view"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 24,
                borderRadius: 4,
                border: 'none',
                background: viewMode === 'code' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                color: viewMode === 'code' ? '#ffffff' : '#71717a',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Code2 size={14} strokeWidth={1.75} />
            </button>
          </div>

          {/* Title Label: "Web search · TSX" */}
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: '#e4e4e7',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '-0.01em',
            }}
          >
            {headerLabel}
          </div>
        </div>

        {/* Right Side: Copy Pill, Maximize, Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Split Copy Button with Dropdown */}
          <div style={{ position: 'relative' }} ref={copyMenuRef}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={handleCopyCode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'transparent',
                  border: 'none',
                  color: copied ? '#4ade80' : '#e4e4e7',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {copied ? <Check size={12} color="#4ade80" /> : null}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <div style={{ width: 1, height: 12, background: 'rgba(255, 255, 255, 0.12)' }} />

              <button
                onClick={() => setShowCopyMenu((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px 6px',
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronDown size={12} />
              </button>
            </div>

            {/* Dropdown Popup Menu */}
            <AnimatePresence>
              {showCopyMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    zIndex: 100,
                    background: '#1c1c1f',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 8,
                    padding: '4px',
                    minWidth: 160,
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <button
                    onClick={handleCopyCode}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      color: '#e4e4e7',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Copy size={13} color="#a1a1aa" />
                    <span>Copy Content</span>
                  </button>

                  {rawPath && (
                    <button
                      onClick={handleCopyPath}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        color: '#e4e4e7',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <FileCode size={13} color="#a1a1aa" />
                      <span>Copy File Path</span>
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Maximize / Minimize Button */}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              title={isExpanded ? 'Minimize width' : 'Maximize width'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: '#a1a1aa',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#a1a1aa';
              }}
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}

          {/* Close Button */}
          <button
            onClick={onClose}
            title="Close panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: '#a1a1aa',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#a1a1aa';
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ── BODY CONTENT: CODE VIEW OR PREVIEW (EXACT AS IMAGE) ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          background: '#161618',
          position: 'relative',
        }}
      >
        {viewMode === 'preview' ? (
          /* Preview Mode (Markdown/HTML/Text) */
          <div style={{ padding: '20px 24px', maxWidth: 800, margin: '0 auto' }}>
            {isMarkdownOrHtml ? (
              <MarkdownRenderer content={content || output} />
            ) : (
              <div style={{ color: '#a1a1aa', fontSize: 13, lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 12px', fontWeight: 600, color: '#e4e4e7' }}>File Information</p>
                <div style={{ background: '#1c1c1f', borderRadius: 8, padding: 14, border: '1px solid #27272a' }}>
                  <div style={{ marginBottom: 6 }}><span style={{ color: '#71717a' }}>Path: </span>{rawPath || filename}</div>
                  <div style={{ marginBottom: 6 }}><span style={{ color: '#71717a' }}>Type: </span>{ext.toUpperCase()}</div>
                  <div><span style={{ color: '#71717a' }}>Lines: </span>{diffLines.length}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Code View (Pixel-perfect matching reference image) */
          <div
            style={{
              padding: '12px 0 32px 0',
              fontFamily: '"JetBrains Mono", "Fira Code", "Geist Mono", Consolas, monospace',
              fontSize: 13,
              lineHeight: '22px',
              tabSize: 2,
              minWidth: 'fit-content',
            }}
          >
            {diffLines.length === 0 ? (
              <div style={{ padding: '24px', color: '#71717a', fontStyle: 'italic' }}>
                No code content available.
              </div>
            ) : (
              diffLines.map((dl, idx) => {
                const isAdded = dl.type === 'added';
                const isRemoved = dl.type === 'removed';

                // Row background for additions/deletions
                const rowBg = isAdded
                  ? 'rgba(34, 197, 94, 0.08)'
                  : isRemoved
                  ? 'rgba(239, 68, 68, 0.08)'
                  : 'transparent';

                // Gutter number color
                const gutterColor = isAdded
                  ? '#4ade80'
                  : isRemoved
                  ? '#f87171'
                  : '#52525b';

                // Active gutter indicator line (similar to lines 19-22 in the image)
                const showIndicator = idx >= 18 && idx <= 22;

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      background: rowBg,
                      minHeight: 22,
                    }}
                  >
                    {/* Line Number Gutter */}
                    <div
                      style={{
                        width: 46,
                        flexShrink: 0,
                        textAlign: 'right',
                        paddingRight: 14,
                        paddingLeft: 8,
                        color: gutterColor,
                        userSelect: 'none',
                        fontSize: 12.5,
                        position: 'relative',
                      }}
                    >
                      {/* Vertical indicator bar on left gutter (e.g. lines 19-22 in reference) */}
                      {showIndicator && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 2,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: '#52525b',
                            borderRadius: 1,
                          }}
                        />
                      )}
                      {dl.lineNumber || idx + 1}
                    </div>

                    {/* Diff prefix if applicable */}
                    {(isAdded || isRemoved) && (
                      <div
                        style={{
                          width: 14,
                          flexShrink: 0,
                          textAlign: 'center',
                          color: isAdded ? '#4ade80' : '#f87171',
                          fontWeight: 600,
                          userSelect: 'none',
                        }}
                      >
                        {isAdded ? '+' : '-'}
                      </div>
                    )}

                    {/* Syntax Highlighted Code Line */}
                    <div
                      style={{
                        paddingLeft: (isAdded || isRemoved) ? 6 : 14,
                        paddingRight: 24,
                        whiteSpace: 'pre',
                        color: '#e4e4e7',
                        flex: 1,
                      }}
                    >
                      {tokenizeCodeLine(dl.content, ext)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ToolCallCodePane;
