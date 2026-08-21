'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  X,
  FileCode,
} from 'lucide-react';

import { useTheme } from '@/components/ThemeProvider';

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
  className?: string;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'normal';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineNumber?: number;
}

/* ============================================================
   TOKENIZER / SYNTAX HIGHLIGHTER (LIGHT & DARK PALETTES)
   ============================================================ */

export const DARK_PALETTE = {
  keyword: '#c084fc',     // Lilac / Purple
  module: '#f87171',      // Coral / Salmon
  prop: '#f87171',        // Coral / Salmon
  identifier: '#fdba74',  // Warm Peach / Orange
  component: '#fdba74',   // Warm Peach / Orange
  string: '#4ade80',      // Vibrant Emerald Green
  number: '#38bdf8',      // Bright Sky Blue / Cyan
  type: '#38bdf8',        // Sky Blue
  comment: '#71717a',     // Muted Slate / Grey
  punctuation: '#e4e4e7', // Light Gray / Off-white
  text: '#e4e4e7',        // Default text
};

export const LIGHT_PALETTE = {
  keyword: '#7c3aed',     // Deep Violet / Lilac
  module: '#dc2626',      // Crimson / Coral
  prop: '#dc2626',        // Crimson / Coral
  identifier: '#c2410c',  // Warm Amber / Peach
  component: '#c2410c',   // Warm Amber / Peach
  string: '#15803d',      // Rich Emerald Green
  number: '#0284c7',      // Bright Sky Blue
  type: '#0284c7',        // Sky Blue
  comment: '#71717a',     // Muted Slate / Grey
  punctuation: '#27272a', // Dark Charcoal
  text: '#18181b',        // Dark Charcoal
};

// Export PALETTE for backwards compatibility
export const PALETTE = DARK_PALETTE;

function useSafeTheme(): { theme: 'light' | 'dark' } {
  try {
    return useTheme();
  } catch {
    return { theme: 'dark' };
  }
}

export function tokenizeCodeLine(line: string, ext: string = 'py', isDark: boolean = true): React.ReactNode[] {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  if (!line) {
    return [<span key="empty">&nbsp;</span>];
  }

  const trimmed = line.trim();

  // Full line comment
  if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
    return [<span key="comment" style={{ color: palette.comment }}>{line}</span>];
  }

  const tokens: React.ReactNode[] = [];
  let remaining = line;
  let keyIndex = 0;

  // Check if we are in Python `from ... import ...` context
  const isFromImportLine = /^\s*from\s+[\w.]+\s+import\b/.test(line);
  let passedFrom = false;
  let passedImport = false;

  // Regex for token matching
  const tokenRegex = /^(?:#.*$|\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:from|import|def|class|return|if|elif|else|while|for|in|try|except|finally|with|as|lambda|pass|raise|async|await|yield|break|continue|global|nonlocal|assert|del|export|default|const|let|var|function|extends|implements|interface|type|enum|namespace|module|new|this|typeof|instanceof|void|delete|of|get|set|static|public|private|protected|declare|readonly)\b|\b(?:string|number|boolean|any|never|unknown|null|undefined|object|Array|Promise|React|Record|Map|Set|Date|Error|RegExp|JSON|ComponentProps|Omit|Pick|Partial|Required|Readonly|JSX|HTMLProps|int|float|str|bool|list|dict|tuple|set|bytes|None|True|False)\b|\b\d+(?:\.\d+)?\b|[a-zA-Z0-9_$]+(?=\s*=)|[a-zA-Z0-9_$]+(?=\s*\??\s*:)|[a-zA-Z0-9_$]+|[{}()\[\];,:.?|&!=+\-*/<>]+|\s+)/;

  while (remaining.length > 0) {
    const match = remaining.match(tokenRegex);
    if (!match) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.text }}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
      continue;
    }

    const token = match[0];
    remaining = remaining.slice(token.length);

    // Comments at end of line
    if (token.startsWith('#') || token.startsWith('//') || token.startsWith('/*')) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.comment }}>{token}</span>);
    }
    // Strings
    else if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) || (token.startsWith('`') && token.endsWith('`'))) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.string }}>{token}</span>);
    }
    // Keywords
    else if (/^(from|import|def|class|return|if|elif|else|while|for|in|try|except|finally|with|as|lambda|pass|raise|async|await|yield|break|continue|global|nonlocal|assert|del|export|default|const|let|var|function|extends|implements|interface|type|enum|namespace|module|new|this|typeof|instanceof|void|delete|of|get|set|static|public|private|protected|declare|readonly)$/.test(token)) {
      if (token === 'from') passedFrom = true;
      if (token === 'import') passedImport = true;
      tokens.push(<span key={keyIndex++} style={{ color: palette.keyword }}>{token}</span>);
    }
    // Module path segment in `from <module> import`
    else if (isFromImportLine && passedFrom && !passedImport && /^[a-zA-Z0-9_$]+$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.module }}>{token}</span>);
    }
    // Built-in types
    else if (/^(string|number|boolean|any|never|unknown|null|undefined|object|Array|Promise|React|Record|Map|Set|Date|Error|RegExp|JSON|ComponentProps|Omit|Pick|Partial|Required|Readonly|JSX|HTMLProps|int|float|str|bool|list|dict|tuple|set|bytes|None|True|False)$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.type }}>{token}</span>);
    }
    // Numbers
    else if (/^\d+(?:\.\d+)?$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.number }}>{token}</span>);
    }
    // Punctuation & Operators
    else if (/^[{}()\[\];,:.?|&!=+\-*/<>]+$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.punctuation }}>{token}</span>);
    }
    // Named arguments (e.g. parent=, fontSize=, leading=, textColor=) or object properties (key:)
    else if (remaining.trim().startsWith('=') && !remaining.trim().startsWith('==')) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.prop }}>{token}</span>);
    }
    else if (remaining.trim().startsWith(':') || remaining.trim().startsWith('?:')) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.prop }}>{token}</span>);
    }
    // Identifiers, Function calls, Classes, Imported items, Variables (e.g. letter, styles, title_style, ParagraphStyle)
    else if (/^[a-zA-Z0-9_$]+$/.test(token)) {
      tokens.push(<span key={keyIndex++} style={{ color: palette.identifier }}>{token}</span>);
    }
    // Whitespace / fallback
    else {
      tokens.push(<span key={keyIndex++} style={{ color: palette.text }}>{token}</span>);
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
  className = '',
}: ToolCallCodePaneProps) {
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

  // Clean and format filename and extension
  const { displayTitle, ext } = useMemo(() => {
    let rawFilename = '';
    let rawExt = 'py';

    if (rawPath) {
      const parts = rawPath.split(/[/\\]/);
      rawFilename = parts[parts.length - 1] || rawPath;
    } else if (toolNameLower.includes('search')) {
      rawFilename = 'Web search';
      rawExt = 'tsx';
    } else if (isWrite) {
      rawFilename = 'Write';
      rawExt = 'ts';
    } else if (isEdit) {
      rawFilename = 'Edit';
      rawExt = 'ts';
    } else if (isRead) {
      rawFilename = 'View';
      rawExt = 'ts';
    } else {
      rawFilename = toolName || 'Code';
      rawExt = 'py';
    }

    if (rawFilename.includes('.')) {
      const dotIndex = rawFilename.lastIndexOf('.');
      rawExt = rawFilename.slice(dotIndex + 1).toLowerCase();
      rawFilename = rawFilename.slice(0, dotIndex);
    }

    // Format display title (e.g. "build_pdf" -> "Build pdf")
    let formattedTitle = rawFilename;
    if (rawFilename.includes('_') || rawFilename.includes('-')) {
      formattedTitle = rawFilename
        .replace(/[_-]/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
    } else if (/^[a-z]+[A-Z]/.test(rawFilename)) {
      // CamelCase -> keep as is or preserve
      formattedTitle = rawFilename;
    } else if (rawFilename.length > 0) {
      formattedTitle = rawFilename.charAt(0).toUpperCase() + rawFilename.slice(1);
    }

    return {
      displayTitle: formattedTitle || 'Code',
      ext: rawExt || 'py',
    };
  }, [rawPath, toolNameLower, isWrite, isEdit, isRead, toolName]);

  // Format header title label: "{Title} · {EXT}" (e.g. "Build pdf · PY")
  const headerLabel = useMemo(() => {
    const extUpper = ext.toUpperCase();
    return `${displayTitle} · ${extUpper}`;
  }, [displayTitle, ext]);

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

  const { theme } = useSafeTheme();
  const isDark = theme === 'dark';

  // Dynamic theme colors
  const containerBg = isDark ? '#161618' : '#ffffff';
  const containerBorder = isDark ? '#27272a' : 'var(--color-border, #e5e5e0)';
  const containerShadow = isDark
    ? 'var(--glossy-inner), 0 12px 36px -4px rgba(0, 0, 0, 0.45)'
    : 'var(--glossy-inner), 0 10px 30px -4px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)';

  const headerBg = isDark ? '#161618' : 'var(--color-bg-subtle, #f7f6f1)';
  const headerBorder = isDark ? '#27272a' : 'var(--color-border, #e5e5e0)';
  const headerTitleColor = isDark ? '#f4f4f5' : '#18181b';
  const headerIconColor = isDark ? '#a1a1aa' : '#71717a';

  const pillBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const pillBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const pillTextColor = isDark ? '#e4e4e7' : '#18181b';
  const pillDividerColor = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)';

  const menuBg = isDark ? '#1c1c1f' : '#ffffff';
  const menuBorder = isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)';
  const menuShadow = isDark ? '0 10px 25px rgba(0, 0, 0, 0.5)' : '0 10px 25px rgba(0, 0, 0, 0.12)';
  const menuItemColor = isDark ? '#e4e4e7' : '#18181b';
  const menuItemHoverBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';

  const codeBg = isDark ? '#161618' : '#ffffff';
  const codeDefaultColor = isDark ? '#e4e4e7' : '#18181b';
  const gutterColorDefault = isDark ? '#52525b' : '#a1a1aa';
  const gutterIndicatorColor = isDark ? '#52525b' : '#cbd5e1';

  const addedBg = isDark ? 'rgba(34, 197, 94, 0.06)' : 'rgba(34, 197, 94, 0.10)';
  const removedBg = isDark ? 'rgba(239, 68, 68, 0.06)' : 'rgba(239, 68, 68, 0.10)';
  const addedColor = isDark ? '#4ade80' : '#15803d';
  const removedColor = isDark ? '#f87171' : '#dc2626';

  const handleCopyPath = async () => {
    if (!rawPath) return;
    try {
      await navigator.clipboard.writeText(rawPath);
      setCopied(true);
      setShowCopyMenu(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: containerBg,
        borderRadius: 16,
        border: `1px solid ${containerBorder}`,
        boxShadow: containerShadow,
        color: codeDefaultColor,
        fontFamily: '"Geist", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* ── TOP HEADER BAR (EXACT AS REFERENCE IMAGE) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          userSelect: 'none',
          gap: 12,
          flexShrink: 0,
        }}
      >
        {/* Left Side: Title Label (e.g. "Build pdf · PY") */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: headerTitleColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: '-0.01em',
          }}
        >
          {headerLabel}
        </div>

        {/* Right Side: Copy Button Pill + Maximize + Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Split Copy Button with Dropdown Chevron */}
          <div style={{ position: 'relative' }} ref={copyMenuRef}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: pillBg,
                border: `1px solid ${pillBorder}`,
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={handleCopyCode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  background: 'transparent',
                  border: 'none',
                  color: copied ? addedColor : pillTextColor,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {copied ? <Check size={12} color={addedColor} /> : null}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <div style={{ width: 1, height: 14, background: pillDividerColor }} />

              <button
                onClick={() => setShowCopyMenu((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 7px',
                  background: 'transparent',
                  border: 'none',
                  color: headerIconColor,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronDown size={13} />
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
                    background: menuBg,
                    border: menuBorder,
                    borderRadius: 8,
                    padding: '4px',
                    minWidth: 160,
                    boxShadow: menuShadow,
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
                      color: menuItemColor,
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = menuItemHoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Copy size={13} color={headerIconColor} />
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
                        color: menuItemColor,
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = menuItemHoverBg)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <FileCode size={13} color={headerIconColor} />
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
                color: headerIconColor,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
                e.currentTarget.style.color = isDark ? '#ffffff' : '#000000';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = headerIconColor;
              }}
            >
              {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
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
              color: headerIconColor,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';
              e.currentTarget.style.color = isDark ? '#ffffff' : '#000000';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = headerIconColor;
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── CODE CONTENT BODY (LIGHT & DARK THEMES) ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          background: codeBg,
          position: 'relative',
        }}
      >
        <div
          style={{
            padding: '14px 0 28px 0',
            fontFamily: '"JetBrains Mono", "Fira Code", "Geist Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            lineHeight: '22px',
            tabSize: 2,
            minWidth: 'fit-content',
          }}
        >
          {diffLines.length === 0 ? (
            <div style={{ padding: '24px', color: headerIconColor, fontStyle: 'italic' }}>
              No code content available.
            </div>
          ) : (
            diffLines.map((dl, idx) => {
              const isAdded = dl.type === 'added';
              const isRemoved = dl.type === 'removed';

              // Row background for additions/deletions in diff mode
              const rowBg = isAdded
                ? addedBg
                : isRemoved
                ? removedBg
                : 'transparent';

              // Gutter line number color
              const gutterColor = isAdded
                ? addedColor
                : isRemoved
                ? removedColor
                : gutterColorDefault;

              // Active indicator bar on the left gutter edge (visible like lines 11-13 in reference)
              const showIndicator = idx >= 10 && idx <= 13;

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
                    {/* Leftmost vertical indicator bar */}
                    {showIndicator && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 2,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: gutterIndicatorColor,
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
                        color: isAdded ? addedColor : removedColor,
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
                      color: codeDefaultColor,
                      flex: 1,
                    }}
                  >
                    {tokenizeCodeLine(dl.content, ext, isDark)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default ToolCallCodePane;
