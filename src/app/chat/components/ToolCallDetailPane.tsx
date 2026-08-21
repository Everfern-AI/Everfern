'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Copy, Check, ChevronDown, ChevronRight, Code2, Zap, AlertCircle,
  Clock, CheckCircle, AlertTriangle, ArrowRight, FileText, Loader2,
  Eye, Code, Table, FileSpreadsheet, ExternalLink,
  List, Terminal, FileCode, Sparkles
} from 'lucide-react';
import { PlanArtifact } from './PlanArtifact';
import ToolCallCodePane from '@/components/tools/ToolCallCodePane';

/* ============================================================
   TYPES & CONSTANTS
   ============================================================ */

export interface ToolCallDetail {
  id: string;
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  agent?: string;
  duration?: number;
  navisReport?: string;
}

// Muted minimal theme
const T = {
  bg: 'var(--color-bg-subtle)',
  surface: 'var(--color-bg-surface)',
  surfaceRaised: 'var(--color-bg-subtle)',
  border: 'var(--color-border)',
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-tertiary)',
  accent: '#44403c',
  accentFaint: 'rgba(68, 64, 60, 0.06)',
  accentHover: 'rgba(68, 64, 60, 0.1)',
  success: '#22c55e',
  successFaint: 'rgba(34, 197, 94, 0.08)',
  warning: '#f59e0b',
  warningFaint: 'rgba(245, 158, 11, 0.08)',
  error: '#ef4444',
  errorFaint: 'rgba(239, 68, 68, 0.08)',
  r8: 8,
  r12: 12,
  r16: 16,
  mono: '"Geist Mono", ui-monospace, monospace',
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
};

/* ============================================================
   UTILITY COMPONENTS
   ============================================================ */

function CopyButton({ text, size = 'sm' }: { text: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const sizes = {
    sm: { padding: '4px 8px', fontSize: 10, iconSize: 10 },
    md: { padding: '6px 12px', fontSize: 11, iconSize: 12 },
  };

  const s = sizes[size];

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: s.padding,
        borderRadius: T.r8,
        border: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: s.fontSize,
        fontWeight: 500,
        color: copied ? T.success : T.textMuted,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: T.sans,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = T.accentFaint;
        e.currentTarget.style.borderColor = T.textMuted;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = T.surface;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      {copied ? <Check size={s.iconSize} /> : <Copy size={s.iconSize} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
);
}

/* ============================================================
   SIMPLIFIED CODE VIEW - Inline style for write/edit/read tools
   ============================================================ */
/* ============================================================
   FILE OPERATION VIEW - Custom pane for write/edit/read tools
   Exactly like the image: traffic lights, diff view, clean header
   ============================================================ */
function FileOperationView({ toolCall, onClose }: { toolCall: ToolCallDetail; onClose: () => void }) {
  const args = toolCall.arguments || (toolCall as any).args || {};
  const toolNameLower = toolCall.toolName.toLowerCase();
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create_artifact') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');
  const isRead = toolNameLower.includes('read') || toolNameLower.includes('view_file');

  const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || args.filePath || '');
  const filename = rawPath.split(/[/\\]/).pop() || 'file';
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Determine content based on tool type
  const newContent = String(
    args.FileContent || args.content || args.Content || args.newString || args.replace || args.ReplacementContent || ''
  ).trim();

  const oldContent = String(
    args.oldString || args.find || args.TargetContent || ''
  ).trim();

  const resultContent = String(
    args.output || toolCall.result?.output || toolCall.result?.data?.output || ''
  ).trim();

  const content = newContent || resultContent;
  const hasDiff = isEdit && oldContent;

  // Build diff lines
  type DiffLine = { prefix: string; text: string; color: string };
  let diffLines: DiffLine[] = [];

  if (isWrite) {
    diffLines = content.split('\n').map(l => ({ prefix: '+', text: l, color: '#3fb950' }));
  } else if (isRead) {
    diffLines = content.split('\n').map(l => ({ prefix: '', text: l, color: '#c9d1d9' }));
  } else if (hasDiff) {
    // Simple diff: show old lines as - and new lines as +
    const oldLines = oldContent.split('\n');
    const newLines = content.split('\n');
    // For now, just show all old as removed and all new as added
    oldLines.forEach(l => diffLines.push({ prefix: '-', text: l, color: '#f85149' }));
    newLines.forEach(l => diffLines.push({ prefix: '+', text: l, color: '#3fb950' }));
  } else {
    diffLines = content.split('\n').map(l => ({ prefix: '', text: l, color: '#c9d1d9' }));
  }

  const actionLabel = isWrite ? 'write' : isEdit ? 'edit' : 'view';
  const badgeLabel = isWrite ? 'Write Operation' : isEdit ? 'Edit Operation' : 'Read Operation';
  const badgeColor = isWrite ? '#3fb950' : isEdit ? '#f85149' : '#58a6ff';

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#141414' }}>
      {/* ── Top Chrome Bar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #2a2a2a',
        background: '#1a1a1a',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {/* Code brackets icon */}
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          {/* Agent name + action pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#e5e5e5', fontWeight: 500 }}>Fern</span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>→</span>
            <span style={{
              fontSize: 12,
              color: '#e5e5e5',
              background: 'rgba(255,255,255,0.08)',
              padding: '3px 10px',
              borderRadius: 6,
              fontWeight: 500,
              textTransform: 'lowercase',
            }}>
              {actionLabel}
            </span>
          </div>
        </div>
        {/* Status dot + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: badgeColor }} />
          <button
            onClick={handleCopy}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #3a3a3a',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #3a3a3a',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Metadata Row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderBottom: '1px solid #2a2a2a',
      }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#e5e5e5', textTransform: 'lowercase' }}>
          {actionLabel}
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: badgeColor,
          background: `${badgeColor}15`,
          padding: '3px 10px',
          borderRadius: 20,
          border: `1px solid ${badgeColor}30`,
        }}>
          {badgeLabel}
        </span>
        <span style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.4)',
          fontFamily: '"JetBrains Mono", monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {rawPath}
        </span>
      </div>

      {/* ── Scrollable Content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 16px 24px' }}>
        {/* Code Card */}
        <div style={{
          background: '#0d0d0d',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          {/* Card Header with traffic lights */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: '#141414',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Traffic lights */}
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
              </div>
              <span style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)',
                fontFamily: T.sans,
                marginLeft: 4,
              }}>
                {filename}
              </span>
            </div>
            <button
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid #3a3a3a',
                background: 'transparent',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12,
              }}
            >
              <Copy size={14} />
              Copy
            </button>
          </div>

          {/* Code content with diff prefixes */}
          <div style={{
            padding: '12px 0',
            fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace',
            fontSize: 13,
            lineHeight: 1.7,
            overflow: 'auto',
          }}>
            {diffLines.map((dl, i) => (
              <div key={i} style={{ display: 'flex', minHeight: 23 }}>
                <span style={{
                  width: 36,
                  padding: '0 8px 0 14px',
                  textAlign: 'right',
                  color: dl.color,
                  userSelect: 'none',
                  flexShrink: 0,
                  fontWeight: 500,
                }}>
                  {dl.prefix}
                </span>
                <span
                  style={{
                    padding: '0 12px',
                    color: '#c9d1d9',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    flex: 1,
                  }}
                  dangerouslySetInnerHTML={{ __html: highlightLine(dl.text, ext) }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Multi-Language Syntax Highlighter ─────────────────────────────── */
function highlightLine(line: string, ext: string): string {
  let h = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!h.trim()) return h;

  if (ext === 'py') return highlightPython(h);
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return highlightJS(h);
  if (['css', 'scss'].includes(ext)) return highlightCSS(h);
  if (['html', 'htm'].includes(ext)) return highlightHTML(h);
  if (ext === 'json') return highlightJSON(h);
  if (['sh', 'bash', 'zsh'].includes(ext)) return highlightShell(h);
  
  // Generic fallback
  return highlightGeneric(h);
}

function highlightPython(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(#.*)$/gm, '<span style="color: #5c6370">$1</span>');
  // Strings
  h = h.replace(/(""".*""")|('''.*''')|("[^"]*")|('[^']*')/g, '<span style="color: #98c379">$1</span>');
  // Keywords
  const kw = /\b(import|from|as|def|class|return|if|elif|else|for|while|try|except|finally|with|yield|lambda|raise|assert|del|global|nonlocal|pass|continue|break|and|or|not|in|is|None|True|False)\b/g;
  h = h.replace(kw, '<span style="color: #c678dd">$1</span>');
  // Builtins
  const bi = /\b(print|len|range|enumerate|zip|map|filter|sorted|open|str|int|float|list|dict|set|tuple|type|isinstance|hasattr|getattr|super|self|cls)\b/g;
  h = h.replace(bi, '<span style="color: #61afef">$1</span>');
  // Numbers
  h = h.replace(/\b\d+\.?\d*\b/g, '<span style="color: #d19a66">$&</span>');
  // Functions
  h = h.replace(/\b(\w+)(?=\()/g, '<span style="color: #61afef">$1</span>');
  return h;
}

function highlightJS(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(\/\/.*$)/gm, '<span style="color: #5c6370">$1</span>');
  h = h.replace(/(\/\*[\s\S]*?\*\/)/gm, '<span style="color: #5c6370">$1</span>');
  // Strings
  const str = /(`[^`]*`)|("[^"]*")|('[^']*')/g;
  h = h.replace(str, '<span style="color: #98c379">$1</span>');
  // Template literals interpolation
  h = h.replace(/(\\\$\{[^}]*\})/g, '<span style="color: #e06c75">$1</span>');
  // Keywords
  const kw = /\b(import|export|from|default|const|let|var|function|class|extends|implements|interface|type|enum|namespace|module|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|typeof|instanceof|void|delete|in|of|async|await|yield|get|set|static|public|private|protected|as|declare|readonly)\b/g;
  h = h.replace(kw, '<span style="color: #c678dd">$1</span>');
  // Types
  const types = /\b(string|number|boolean|any|void|null|undefined|object|Array|Promise|React|Record|Map|Set|Date|Error|RegExp|JSON|console|window|document|Math)\b/g;
  h = h.replace(types, '<span style="color: #e5c07b">$1</span>');
  // JSX tags
  if (h.includes('<')) {
    h = h.replace(/&lt;(\/?)(\w+)/g, '&lt;$1<span style="color: #e06c75">$2</span>');
    h = h.replace(/(\w+)=/g, '<span style="color: #d19a66">$1</span>=');
  }
  // Properties
  h = h.replace(/(\w+)(?=:)/g, '<span style="color: #e06c75">$1</span>');
  // Numbers
  h = h.replace(/\b\d+\.?\d*\b/g, '<span style="color: #d19a66">$&</span>');
  // Functions
  h = h.replace(/\b(\w+)(?=\()/g, '<span style="color: #61afef">$1</span>');
  return h;
}

function highlightCSS(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(\/\*[\s\S]*?\*\/)/gm, '<span style="color: #5c6370">$1</span>');
  h = h.replace(/(\/\/.*$)/gm, '<span style="color: #5c6370">$1</span>');
  // Selectors
  h = h.replace(/^(\s*[.#]\w+)/, '<span style="color: #e06c75">$1</span>');
  h = h.replace(/@\w+/g, '<span style="color: #c678dd">$&</span>');
  // Properties
  const prop = /([\w-]+)(?=\s*:)/g;
  h = h.replace(prop, '<span style="color: #e06c75">$1</span>');
  // Values (colors, px, rem, etc)
  h = h.replace(/(#[0-9a-fA-F]{3,8})/g, '<span style="color: #98c379">$1</span>');
  h = h.replace(/(\d+(px|rem|em|%|vh|vw|s|ms|deg|fr|pt|cm|mm|in))/g, '<span style="color: #d19a66">$1</span>');
  // Strings
  h = h.replace(/("[^"]*")|('[^']*')/g, '<span style="color: #98c379">$1</span>');
  return h;
}

function highlightHTML(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/gm, '<span style="color: #5c6370">$1</span>');
  // Tags
  h = h.replace(/&lt;(\/?)(\w+)/g, '&lt;$1<span style="color: #e06c75">$2</span>');
  h = h.replace(/(\/?)\s*&gt;/g, '$1<span style="color: #e06c75">&gt;</span>');
  // Attributes
  h = h.replace(/\b(\w+)(?==)/g, '<span style="color: #d19a66">$1</span>');
  // Strings
  h = h.replace(/("[^"]*")|('[^']*')/g, '<span style="color: #98c379">$1</span>');
  return h;
}

function highlightJSON(line: string): string {
  let h = line;
  // Keys
  h = h.replace(/("[^"]*")(?=\s*:)/g, '<span style="color: #e06c75">$1</span>');
  // Strings
  h = h.replace(/("[^"]*")/g, '<span style="color: #98c379">$1</span>');
  // Numbers
  h = h.replace(/\b\d+\.?\d*\b/g, '<span style="color: #d19a66">$&</span>');
  // Booleans/null
  const kw = /\b(true|false|null)\b/g;
  h = h.replace(kw, '<span style="color: #c678dd">$1</span>');
  return h;
}

function highlightShell(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(#.*)$/gm, '<span style="color: #5c6370">$1</span>');
  // Variables
  h = h.replace(/(\$\w+)/g, '<span style="color: #e06c75">$1</span>');
  // Builtins
  const builtins = /\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|awk|sed|cut|sort|uniq|head|tail|find|chmod|chown|sudo|apt|yum|brew|curl|wget|git|docker|python|python3|node|npm|npx|yarn|pip|pip3)\b/g;
  h = h.replace(builtins, '<span style="color: #61afef">$1</span>');
  // Strings
  h = h.replace(/("[^"]*")|('[^']*')/g, '<span style="color: #98c379">$1</span>');
  return h;
}

function highlightGeneric(line: string): string {
  let h = line;
  // Comments
  h = h.replace(/(\/\/.*$)/gm, '<span style="color: #5c6370">$1</span>');
  h = h.replace(/(#.*)$/gm, '<span style="color: #5c6370">$1</span>');
  // Strings
  h = h.replace(/("[^"]*")|('[^']*')/g, '<span style="color: #98c379">$1</span>');
  // Numbers
  h = h.replace(/\b\d+\.?\d*\b/g, '<span style="color: #d19a66">$&</span>');
  return h;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: T.textMuted,
    executing: T.warning,
    completed: T.success,
    failed: T.error,
  };

  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status] || T.textMuted,
        flexShrink: 0,
      }}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; icon: React.ComponentType<{ size?: number }>; text: string }> = {
    pending: { bg: T.accentFaint, color: T.textMuted, icon: Clock, text: 'Pending' },
    executing: { bg: T.warningFaint, color: T.warning, icon: Zap, text: 'Executing' },
    completed: { bg: T.successFaint, color: T.success, icon: CheckCircle, text: 'Completed' },
    failed: { bg: T.errorFaint, color: T.error, icon: AlertTriangle, text: 'Failed' },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 20,
        background: c.bg,
        color: c.color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: T.sans,
      }}
    >
      <Icon size={12} />
      {c.text}
    </div>
  );
}

/* ============================================================
   PLAN PREVIEW CARD - Shows in chat before full detail pane
   ============================================================ */

export function PlanPreviewCard({
  title,
  description,
  stepCount,
  completedCount = 0,
  onClick,
  onApprove,
  className,
}: {
  title: string;
  description?: string;
  stepCount: number;
  completedCount?: number;
  onClick?: () => void;
  onApprove?: () => void;
  className?: string;
}) {
  const progress = stepCount > 0 ? (completedCount / stepCount) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      onClick={onClick}
      className={className}
      style={{
        width: '100%',
        maxWidth: 480,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.r12,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: T.r8,
            background: T.accentFaint,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <List size={18} color={T.textSecondary} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: T.text,
              fontFamily: T.sans,
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 11,
              color: T.textMuted,
              fontFamily: T.sans,
            }}
          >
            {completedCount} of {stepCount} steps completed
          </div>
        </div>
        <ChevronRight size={16} color={T.textMuted} />
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: T.accentFaint }}>
        <motion.div
          style={{ height: '100%', background: T.accent }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Description */}
      {description && (
        <div style={{ padding: '12px 16px' }}>
          <p
            style={{
              fontSize: 12,
              color: T.textSecondary,
              fontFamily: T.sans,
              lineHeight: 1.5,
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description}
          </p>
        </div>
      )}

      {/* Actions */}
      {onApprove && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 16px',
            borderTop: `1px solid ${T.border}`,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: T.r8,
              border: 'none',
              background: T.accent,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: T.sans,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#292524';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = T.accent;
            }}
          >
            <Check size={14} />
            Approve & Execute
          </button>
        </div>
      )}
    </motion.div>
  );
}

/* ============================================================
   JSON VIEWER
   ============================================================ */

function JsonViewer({ data, maxHeight = 300 }: { data: any; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const jsonStrRaw = typeof data === 'string'
    ? data
    : data === undefined
      ? 'undefined'
      : JSON.stringify(data, null, 2) || '{}';
  const MAX_JSON_LENGTH = 30000;
  const isTruncated = jsonStrRaw.length > MAX_JSON_LENGTH;
  const jsonStr = isTruncated
    ? jsonStrRaw.substring(0, MAX_JSON_LENGTH) + `\n\n... [JSON truncated for performance. Total size: ${jsonStrRaw.length} bytes]`
    : jsonStrRaw;
  const isLarge = jsonStr.length > 500;

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.r8,
        fontFamily: T.mono,
        fontSize: 11,
        color: T.text,
        overflow: 'hidden',
      }}
    >
      {isLarge && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.bg,
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: T.textMuted }}>
            JSON ({jsonStr.length} bytes)
          </span>
          <ChevronDown
            size={14}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </div>
      )}

      <div
        style={{
          padding: '10px 12px',
          maxHeight: expanded || !isLarge ? 'none' : maxHeight,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {jsonStr}
      </div>

      {isLarge && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 12px',
            borderTop: `1px solid ${T.border}`,
            background: T.bg,
          }}
        >
          <CopyButton text={jsonStr} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   NAVIS REPORT VIEWER
   ============================================================ */

function NavisReportViewer({ report, isRunning }: { report: string; isRunning: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [displayedReport, setDisplayedReport] = useState(report);
  const [readerTheme, setReaderTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    setDisplayedReport(report);
    if (isRunning) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }, [report, isRunning]);

  const themeColors = readerTheme === 'light' ? {
    bg: '#fcfbfa',
    text: '#2d312e',
    textMuted: '#686c69',
    border: '#e7e5e0',
    codeBg: '#f5f3ee',
    headerColor: '#1d211e',
    accent: '#d97706',
    accentFaint: '#fef3c7',
  } : {
    bg: '#141413',
    text: '#e2e2dc',
    textMuted: '#8b8b83',
    border: '#2c2b29',
    codeBg: '#1e1e1c',
    headerColor: '#f5f5f0',
    accent: '#f59e0b',
    accentFaint: 'rgba(245, 158, 11, 0.1)',
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = '';

    const flushCode = (key: number) => {
      elements.push(
        <div key={`code-${key}`} style={{
          background: themeColors.codeBg,
          border: `1px solid ${themeColors.border}`,
          borderRadius: T.r8,
          padding: '12px 16px',
          marginBottom: 10,
          fontFamily: T.mono,
          fontSize: 11.5,
          lineHeight: 1.7,
          color: themeColors.text,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {codeLang && <div style={{ color: themeColors.textMuted, fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{codeLang}</div>}
          {codeLines.join('\n')}
        </div>
      );
      codeLines = [];
      codeLang = '';
    };

    lines.forEach((line, idx) => {
      if (line.startsWith('```')) {
        if (inCodeBlock) { flushCode(idx); inCodeBlock = false; }
        else { inCodeBlock = true; codeLang = line.slice(3).trim(); }
        return;
      }
      if (inCodeBlock) { codeLines.push(line); return; }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={idx} style={{ fontSize: 16, fontWeight: 700, color: themeColors.headerColor, margin: '16px 0 12px', fontFamily: T.sans, borderBottom: `1px solid ${themeColors.border}`, paddingBottom: 8 }}>{line.slice(2)}</h1>);
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={idx} style={{ fontSize: 14, fontWeight: 700, color: themeColors.accent, margin: '20px 0 10px', fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ opacity: 0.5 }}>##</span>{line.slice(3)}</h2>);
        return;
      }
      if (line.startsWith('### ')) {
        elements.push(<h3 key={idx} style={{ fontSize: 12.5, fontWeight: 600, color: themeColors.accent, margin: '14px 0 8px', fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.85 }}><span style={{ color: themeColors.border }}>◆</span>{line.slice(4)}</h3>);
        return;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const content = line.slice(2);
        const parts = content.split(/\*\*(.+?)\*\*/);
        const rendered = parts.map((part, pi) =>
          pi % 2 === 1
            ? <span key={pi} style={{ color: themeColors.text, fontWeight: 600 }}>{part}</span>
            : <span key={pi} style={{ color: themeColors.textMuted }}>{part}</span>
        );
        elements.push(
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12, lineHeight: 1.65, fontFamily: T.sans }}>
            <span style={{ color: themeColors.accent, flexShrink: 0, marginTop: 1 }}>•</span>
            <span>{rendered}</span>
          </div>
        );
        return;
      }
      if (line.includes('**')) {
        const parts = line.split(/\*\*(.+?)\*\*/);
        const rendered = parts.map((part, pi) =>
          pi % 2 === 1
            ? <span key={pi} style={{ color: themeColors.text, fontWeight: 600 }}>{part}</span>
            : <span key={pi} style={{ color: themeColors.textMuted }}>{part}</span>
        );
        elements.push(<div key={idx} style={{ fontSize: 12, lineHeight: 1.65, marginBottom: 6, fontFamily: T.sans }}>{rendered}</div>);
        return;
      }
      if (line.trim() === '') { elements.push(<div key={idx} style={{ height: 8 }} />); return; }
      elements.push(<div key={idx} style={{ fontSize: 12, color: themeColors.textMuted, lineHeight: 1.65, fontFamily: T.sans, marginBottom: 4 }}>{line}</div>);
    });

    if (inCodeBlock && codeLines.length > 0) flushCode(lines.length);
    return elements;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: themeColors.bg, color: themeColors.text, transition: 'all 0.2s ease' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderBottom: `1px solid ${themeColors.border}`,
        background: themeColors.bg, flexShrink: 0,
      }}>
        <FileText size={12} color={themeColors.accent} />
        <span style={{ fontSize: 11, color: themeColors.textMuted, fontFamily: T.sans, flex: 1, fontWeight: 600, letterSpacing: '0.02em' }}>
          findings.md
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex',
            background: themeColors.codeBg,
            borderRadius: 6,
            padding: 2,
            border: `1px solid ${themeColors.border}`,
          }}>
            <button
              onClick={() => setReaderTheme('light')}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 650,
                border: 'none',
                cursor: 'pointer',
                background: readerTheme === 'light' ? themeColors.bg : 'transparent',
                color: readerTheme === 'light' ? themeColors.accent : themeColors.textMuted,
                transition: 'all 0.15s ease',
              }}
            >
              Light
            </button>
            <button
              onClick={() => setReaderTheme('dark')}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 650,
                border: 'none',
                cursor: 'pointer',
                background: readerTheme === 'dark' ? themeColors.bg : 'transparent',
                color: readerTheme === 'dark' ? themeColors.accent : themeColors.textMuted,
                transition: 'all 0.15s ease',
              }}
            >
              Dark
            </button>
          </div>

          {isRunning ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: themeColors.accentFaint, border: `1px solid ${themeColors.accent}40`, borderRadius: 20, padding: '2px 8px' }}>
              <Loader2 size={10} color={themeColors.accent} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 10, color: themeColors.accent, fontFamily: T.sans, fontWeight: 600 }}>Writing...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.08)', border: `1px solid rgba(34,197,94,0.3)`, borderRadius: 20, padding: '2px 8px' }}>
              <CheckCircle size={10} color={T.success} />
              <span style={{ fontSize: 10, color: T.success, fontFamily: T.sans, fontWeight: 600 }}>Complete</span>
            </div>
          )}
        </div>
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 28px',
        scrollBehavior: 'smooth',
        fontFamily: 'Georgia, serif',
        lineHeight: 1.8,
      }}>
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        `}</style>
        {displayedReport ? (
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            {renderMarkdown(displayedReport)}
          </div>
        ) : (
          <div style={{ color: themeColors.textMuted, fontSize: 12, textAlign: 'center', paddingTop: 40, fontFamily: T.sans }}>
            Waiting for findings...
          </div>
        )}
        {isRunning && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: themeColors.accent, borderRadius: 1, verticalAlign: 'middle', animation: 'blink 1s step-end infinite', marginLeft: 2 }} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ============================================================
   SIMPLIFIED TERMINAL VIEW - Inline style like Image 2
   ============================================================ */
function SimplifiedTerminalView({ toolCall }: { toolCall: ToolCallDetail }) {
  const args = toolCall.arguments || (toolCall as any).args || {};
  const command = args.command || args.cmd || args.Command || args.script || '';
  const output = toolCall.result?.output || toolCall.result?.data?.output || toolCall.result || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: T.mono }}>
      {/* Command Header with bash label */}
      <div>
        <div style={{ 
          fontSize: 12, 
          color: 'var(--color-text-secondary)', 
          marginBottom: 8,
          fontFamily: T.sans,
          fontWeight: 500
        }}>
          bash
        </div>
        <div style={{ 
          background: '#0d0d0d', 
          borderRadius: 8,
          padding: '14px 16px',
          fontSize: 13, 
          color: '#e5e5e5',
          overflowX: 'auto',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <span style={{ color: '#4ade80' }}>❯</span> {command}
        </div>
      </div>

      {/* Output block */}
      {output && (
        <div>
          <div style={{ 
            fontSize: 12, 
            color: 'var(--color-text-secondary)', 
            marginBottom: 8,
            fontFamily: T.sans,
            fontWeight: 500
          }}>
            Output
          </div>
          <div style={{ 
            background: '#0d0d0d', 
            borderRadius: 8,
            padding: '14px 16px',
            fontSize: 13, 
            color: '#a3a3a3',
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-word',
            maxHeight: 400,
            overflow: 'auto',
            border: '1px solid rgba(255,255,255,0.06)',
            lineHeight: 1.6
          }}>
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TOOL CALL DETAIL PANE - COMPLETELY REDESIGNED
   ============================================================ */

export function ToolCallDetailPane({
  toolCall,
  onClose,
}: {
  toolCall: ToolCallDetail;
  onClose: () => void;
}) {
  const isNavis = toolCall.toolName === 'navis' || toolCall.toolName?.toLowerCase().includes('navis');
  const isPlan = toolCall.toolName === 'execution_plan' || toolCall.toolName === 'create_plan';
  const defaultTab = isNavis ? 'findings' : isPlan ? 'plan' : 'input';
  const [activeTab, setActiveTab] = useState<'findings' | 'input' | 'output' | 'timeline'>(defaultTab as any);
  const duration = toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined;
  const toolNameLower = toolCall.toolName.toLowerCase();
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create_artifact') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');
  const isRead = toolNameLower.includes('read') || toolNameLower.includes('view_file');
  const isTerminal = toolNameLower.includes('command') || toolNameLower.includes('bash') || toolNameLower.includes('terminal') || toolNameLower.includes('exec') || toolNameLower.includes('shell') || toolNameLower.includes('cmd') || toolNameLower.includes('run');
  const isCodeOrFileViewer = isWrite || isEdit || isRead;

  const [findingsContent, setFindingsContent] = useState<string>('');

  // Parse plan content if this is a plan tool
  const planData = React.useMemo(() => {
    if (!isPlan || !toolCall.result?.data) return null;
    const content = toolCall.result.data.content || '';
    const title = content.match(/^# Execution Plan:\s*(.+)$/m)?.[1] || 'Execution Plan';
    const steps: { id: string; title: string; description?: string; status?: string }[] = [];
    const lines = content.split('\n');
    let inSteps = false;
    lines.forEach((line: string) => {
      if (line.startsWith('## Steps')) { inSteps = true; return; }
      if (inSteps && line.startsWith('### ')) {
        const clean = line.replace('###', '').replace(/\*\*/g, '').replace(/`[^`]*`/g, '').trim();
        const [title, ...descParts] = clean.split('—');
        steps.push({
          id: `step_${steps.length + 1}`,
          title: title.trim(),
          description: descParts.join('—').trim() || undefined,
          status: 'pending',
        });
      }
    });
    return { title, steps, content };
  }, [isPlan, toolCall.result]);

  useEffect(() => {
    let isMounted = true;
    if (!isNavis || !toolCall) return;

    const readFindings = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.projects) return;

        const args = toolCall.arguments || (toolCall as any).args || {};
        const result = toolCall.result || {};
        const resultData = result.data || {};
        const candidateValues = [
          args.Cwd,
          args.cwd,
          args.path,
          args.filePath,
          args.file,
          args.TargetFile,
          args.DirectoryPath,
          resultData.path,
          resultData.cwd,
        ].filter((v: any) => typeof v === 'string' && v.trim()) as string[];

        const projects = await api.projects.list() || [];
        const normalized = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

        let projectPath = '';
        for (const value of candidateValues) {
          const val = normalized(value);
          const matched = projects.find((p: any) => p?.path && val.startsWith(normalized(p.path)));
          if (matched?.path) {
            projectPath = matched.path;
            break;
          }
        }

        if (!projectPath) {
          for (const value of candidateValues) {
            if (/^[a-zA-Z]:[\\/]/i.test(value) || value.startsWith('/')) {
              const normalizedVal = value.replace(/\\/g, '/');
              const lastSlash = normalizedVal.lastIndexOf('/');
              const filename = normalizedVal.slice(lastSlash + 1);
              if (filename.includes('.')) {
                projectPath = normalizedVal.slice(0, lastSlash);
              } else {
                projectPath = normalizedVal;
              }
              break;
            }
          }
        }

        if (!projectPath && projects[0]?.path) {
          projectPath = projects[0].path;
        }

        let content: string | null = null;
        const filename = isNavis && toolCall.id ? `findings_${toolCall.id}.md` : 'findings.md';
        try {
          const everfernPath = await api.projects.getEverfernPath();
          if (everfernPath) {
            content = await api.projects.readFile(everfernPath, filename);
          }
        } catch (e) {
          console.error(`Failed to read ${filename} from everfern path:`, e);
        }

        if (content === null && projectPath) {
          content = await api.projects.readFile(projectPath, filename);
        }

        if (content === null && isNavis && toolCall.id) {
          try {
            const everfernPath = await api.projects.getEverfernPath();
            if (everfernPath) {
              content = await api.projects.readFile(everfernPath, 'findings.md');
            }
          } catch (e) {}
          if (content === null && projectPath) {
            try {
              content = await api.projects.readFile(projectPath, 'findings.md');
            } catch (e) {}
          }
        }

        if (isMounted) {
          if (content !== null) {
            setFindingsContent(content);
          } else {
            setFindingsContent('Could not find findings.md for this task.');
          }
        }
      } catch (err) {
        console.error('Error reading findings.md in ToolCallDetailPane:', err);
        if (isMounted) {
          setFindingsContent('Could not find findings.md for this task.');
        }
      }
    };

    readFindings();

    const isRunning = toolCall.status === 'executing' || toolCall.status === 'pending';
    let intervalId: any;
    if (isRunning) {
      intervalId = setInterval(readFindings, 250);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isNavis, toolCall]);

  const getToolIcon = () => {
    if (isPlan) return <List size={18} />;
    if (isTerminal) return <Terminal size={18} />;
    if (isCodeOrFileViewer) return <FileCode size={18} />;
    if (isNavis) return <Sparkles size={18} />;
    return <Code2 size={18} />;
  };

  const getToolLabel = () => {
    if (isPlan) return 'Execution Plan';
    if (isTerminal) return 'Terminal Command';
    if (isWrite) return 'File Write';
    if (isEdit) return 'File Edit';
    if (isRead) return 'File Read';
    if (isNavis) return 'AI Research';
    // Format tool name: remove underscores, capitalize words
    return toolCall.toolName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const hasError = toolCall.status === 'failed' || 
    (toolCall.status as string) === 'error' || 
    toolCall.result?.success === false || 
    toolCall.result?.isError === true || 
    !!toolCall.error || 
    (typeof toolCall.result?.output === 'string' && toolCall.result?.output.trim().startsWith('Error:'));

  // If this is a file/code operation (write/edit/read) and succeeded, render the pixel-perfect ToolCallCodePane
  if (isCodeOrFileViewer && !hasError) {
    return (
      <ToolCallCodePane
        toolName={toolCall.toolName}
        path={toolCall.arguments?.TargetFile || toolCall.arguments?.AbsolutePath || toolCall.arguments?.filePath || toolCall.arguments?.path}
        args={toolCall.arguments || (toolCall as any).args}
        output={toolCall.result?.output || toolCall.result?.data?.output || ''}
        data={toolCall.result?.data || toolCall.result}
        onClose={onClose}
      />
    );
  }

  // Determine if we should use simple styling (no glossy effects)
  const useSimpleStyle = isTerminal;

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      className={useSimpleStyle ? "" : "glossy"}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: useSimpleStyle ? '#141414' : T.bg,
        borderRadius: T.r16,
        overflow: 'hidden',
        border: `1px solid ${useSimpleStyle ? '#2a2a2a' : T.border}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: useSimpleStyle ? '12px 16px' : '16px 20px',
          borderBottom: `1px solid ${useSimpleStyle ? '#2a2a2a' : T.border}`,
          background: useSimpleStyle ? '#1a1a1a' : T.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {isTerminal || isWrite || isEdit || isRead ? (
          /* Simplified header for terminal/write/view/edit tools */
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <Terminal size={16} color={T.textMuted} />
            <span style={{ fontSize: 13, color: T.textMuted, fontFamily: T.sans }}>
              {isTerminal ? 'bash' : isWrite ? 'write' : isEdit ? 'edit' : 'view'}
            </span>
          </div>
        ) : (
          /* Full header for other tools */
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: T.r12,
                background: T.accentFaint,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.textSecondary,
                flexShrink: 0,
              }}
            >
              {getToolIcon()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, fontFamily: T.sans, marginBottom: 2 }}>
                {getToolLabel()}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={toolCall.status} />
                {duration && (
                  <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                    {(duration / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        <button
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            borderRadius: T.r8,
            border: `1px solid ${T.border}`,
            background: T.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: T.textMuted,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = T.accentFaint;
            e.currentTarget.style.color = T.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = T.surface;
            e.currentTarget.style.color = T.textMuted;
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Plan Content - Special view for execution plans */}
      {isPlan && planData ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 20px' }}>
          <PlanArtifact
            title={planData.title}
            steps={planData.steps.map((step) => ({
              id: step.id,
              title: step.title,
              description: step.description && step.description.trim() !== step.title.trim() ? step.description : undefined,
              status: step.status as 'pending' | 'in_progress' | 'completed',
            }))}
            defaultExpanded={true}
            variant="panel"
          />
        </div>
      ) : isCodeOrFileViewer ? (
        <FileOperationView toolCall={toolCall} onClose={onClose} />
      ) : isTerminal ? (
        <div style={{ flex: 1, padding: '20px', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#141414' }}>
          <SimplifiedTerminalView toolCall={toolCall} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: `1px solid ${T.border}`,
              background: T.surface,
              padding: '0 20px',
              gap: 0,
            }}
          >
            {(isNavis ? ['findings', 'input', 'output', 'timeline'] : ['input', 'output', 'timeline']).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  padding: '12px 16px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: activeTab === tab ? T.text : T.textMuted,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: activeTab === tab ? `2px solid ${T.accent}` : '2px solid transparent',
                  fontFamily: T.sans,
                  transition: 'all 0.15s ease',
                  textTransform: 'capitalize',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {tab === 'findings' && <FileText size={12} />}
                {tab === 'input' && <Code size={12} />}
                {tab === 'output' && <ArrowRight size={12} />}
                {tab === 'timeline' && <Clock size={12} />}
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: activeTab === 'findings' ? 'hidden' : 'auto', padding: activeTab === 'findings' ? 0 : '20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <AnimatePresence mode="wait">
              {activeTab === 'findings' && (
                <motion.div key="findings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, minHeight: 0, height: '100%' }}>
                  <NavisReportViewer
                    report={findingsContent}
                    isRunning={toolCall.status === 'executing' || toolCall.status === 'pending'}
                  />
                </motion.div>
              )}

              {activeTab === 'input' && (
                <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                      Arguments
                    </div>
                    <JsonViewer data={toolCall.arguments} />
                  </div>
                </motion.div>
              )}

              {activeTab === 'output' && (
                <motion.div key="output" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {toolCall.status === 'completed' && toolCall.result ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                        Result
                      </div>
                      <JsonViewer data={toolCall.result} />
                    </div>
                  ) : toolCall.status === 'failed' && toolCall.error ? (
                    <div
                      style={{
                        background: T.errorFaint,
                        border: `1px solid ${T.error}30`,
                        borderRadius: T.r8,
                        padding: '12px 14px',
                        display: 'flex',
                        gap: 10,
                      }}
                    >
                      <AlertCircle size={16} color={T.error} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.error, marginBottom: 4, fontFamily: T.sans }}>
                          Error
                        </div>
                        <code style={{ fontSize: 11, color: T.error, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
                          {toolCall.error}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '40px 20px',
                        color: T.textMuted,
                        textAlign: 'center',
                      }}
                    >
                      <Zap size={28} opacity={0.3} style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 12, fontFamily: T.sans }}>No output yet</div>
                      <div style={{ fontSize: 11, fontFamily: T.sans, opacity: 0.7 }}>
                        Tool is still executing or has no output
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'timeline' && (
                <motion.div key="timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { label: 'Tool Called', time: toolCall.startTime, status: 'completed' },
                      {
                        label: 'Executing',
                        time: toolCall.startTime + (duration || 0) / 2,
                        status: toolCall.status === 'executing' ? 'in-progress' : 'completed',
                      },
                      {
                        label: toolCall.status === 'failed' ? 'Failed' : 'Completed',
                        time: toolCall.endTime || toolCall.startTime,
                        status: toolCall.status,
                      },
                    ].map((event, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background:
                                event.status === 'completed'
                                  ? T.success
                                  : event.status === 'in-progress'
                                    ? T.warning
                                    : T.error,
                              border: `2px solid ${T.surface}`,
                              boxShadow: `0 0 0 1.5px ${event.status === 'completed' ? T.success : event.status === 'in-progress' ? T.warning : T.error}`,
                            }}
                          />
                          {idx < 2 && (
                            <div
                              style={{
                                width: 2,
                                height: 24,
                                background: T.border,
                              }}
                            />
                          )}
                        </div>
                        <div style={{ flex: 1, paddingTop: 2 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: T.text, marginBottom: 2, fontFamily: T.sans }}>
                            {event.label}
                          </div>
                          <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                            {new Date(event.time).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}

/* ============================================================
   CODE EDITOR PREVIEW FOR WRITE/EDIT TOOLS
   ============================================================ */

interface CodeLine {
  text: string;
  type: 'added' | 'removed' | 'normal';
}

interface ParsedFileDiff {
  filePath: string;
  fileName: string;
  codeLines: CodeLine[];
  addedCount: number;
  removedCount: number;
  rawContent?: string;
}

function FileMarkdownViewer({ content }: { content: string }) {
  const lines = (content || '').split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  const formatInline = (text: string) => {
    let f = text;
    f = f.replace(/`(.*?)`/g, '<code style="background-color: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #38bdf8;">$1</code>');
    f = f.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #f0f6fc;">$1</strong>');
    f = f.replace(/__(.*?)__/g, '<strong style="color: #f0f6fc;">$1</strong>');
    f = f.replace(/\*(.*?)\*/g, '<em style="color: #c9d1d9;">$1</em>');
    f = f.replace(/_(.*?)_/g, '<em style="color: #c9d1d9;">$1</em>');
    return f;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        const code = codeBlockContent.join('\n');
        codeBlockContent = [];
        elements.push(
          <pre key={`code-${i}`} style={{
            backgroundColor: '#0d1117',
            color: '#c9d1d9',
            padding: '12px 16px',
            borderRadius: 6,
            overflowX: 'auto',
            fontSize: 11,
            fontFamily: T.mono,
            margin: '8px 0',
            border: '1px solid #30363d',
          }}>
            <code>{code}</code>
          </pre>
        );
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 18, fontWeight: 700, margin: '16px 0 8px', borderBottom: '1px solid #30363d', paddingBottom: 4, color: '#f0f6fc' }}>{line.substring(2)}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 15, fontWeight: 600, margin: '14px 0 6px', borderBottom: '1px solid #21262d', paddingBottom: 4, color: '#f0f6fc' }}>{line.substring(3)}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 4px', color: '#58a6ff' }}>{line.substring(4)}</h3>);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
      const headers = line.split('|').map(h => h.trim()).filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length > 0) rows.push(cells);
        i++;
      }
      i--;
      elements.push(
        <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#161b22' }}>
                {headers.map((h, j) => (
                  <th key={j} style={{ padding: '6px 10px', border: '1px solid #30363d', textAlign: 'left', color: '#8b949e', fontWeight: 600 }} dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? '#0d1117' : '#161b22' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '6px 10px', border: '1px solid #21262d', color: '#c9d1d9' }} dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const content = line.trim().substring(2);
      elements.push(
        <li key={`li-${i}`} style={{ marginLeft: 16, margin: '4px 0', fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: formatInline(content) }}
        />
      );
      continue;
    }

    if (line.trim() === '---') {
      elements.push(<hr key={`hr-${i}`} style={{ border: 'none', borderTop: '1px solid #30363d', margin: '14px 0' }} />);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<div key={`spacer-${i}`} style={{ height: 6 }} />);
      continue;
    }

    elements.push(
      <p key={`p-${i}`} style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0', color: '#c9d1d9' }}
        dangerouslySetInnerHTML={{ __html: formatInline(line) }}
      />
    );
  }

  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', height: '100%', fontFamily: T.sans }}>
      {elements}
    </div>
  );
}

function FileSpreadsheetViewer({ content, fileName }: { content: string; fileName: string }) {
  const [filterQuery, setFilterQuery] = useState('');
  let rows: string[][] = [];

  if (content) {
    rows = content.split('\n')
      .map(row => {
        const cells: string[] = [];
        let insideQuote = false;
        let currentCell = '';
        const delimiter = (content.includes('\t') && !content.includes(',')) ? '\t' : ',';
        for (let i = 0; i < row.length; i++) {
          const char = row[i];
          if (char === '"') insideQuote = !insideQuote;
          else if (char === delimiter && !insideQuote) {
            cells.push(currentCell.replace(/^"|"$/g, '').trim());
            currentCell = '';
          } else {
            currentCell += char;
          }
        }
        cells.push(currentCell.replace(/^"|"$/g, '').trim());
        return cells;
      })
      .filter(row => row.length > 0 && row.some(c => c.trim().length > 0));
  }

  const maxCols = Math.max(rows[0]?.length || 6, 6);
  const columnHeaders = Array.from({ length: maxCols }, (_, i) => String.fromCharCode(65 + i));

  const filteredRows = filterQuery.trim()
    ? rows.filter(row => row.some(c => c.toLowerCase().includes(filterQuery.toLowerCase())))
    : rows;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', fontFamily: T.mono, fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 700, fontStyle: 'italic', fontSize: 12 }}>
          <span>fx</span>
        </div>
        <input
          type="text"
          placeholder="Filter table rows..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          style={{
            flex: 1,
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: '#f0f6fc',
            outline: 'none',
            fontFamily: T.mono,
          }}
        />
        <span style={{ fontSize: 10, color: '#8b949e', whiteSpace: 'nowrap' }}>
          {filteredRows.length} rows × {maxCols} cols
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#8b949e', fontStyle: 'italic' }}>
            No spreadsheet rows found or file is empty.
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <th style={{ width: 42, padding: '6px 8px', border: '1px solid #30363d', color: '#8b949e', textAlign: 'center', background: '#161b22' }}>#</th>
                {columnHeaders.map((col, idx) => (
                  <th key={idx} style={{ padding: '6px 12px', border: '1px solid #30363d', color: '#8b949e', textAlign: 'left', fontWeight: 600, minWidth: 120 }}>
                    {rows[0] && rows[0][idx] ? rows[0][idx] : col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ background: rowIdx % 2 === 0 ? '#0d1117' : '#161b22', transition: 'background 0.1s' }}>
                  <td style={{ padding: '5px 8px', border: '1px solid #21262d', color: '#484f58', textAlign: 'center', userSelect: 'none' }}>
                    {rowIdx + 1}
                  </td>
                  {columnHeaders.map((_, colIdx) => (
                    <td key={colIdx} style={{ padding: '5px 12px', border: '1px solid #21262d', color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                      {row[colIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilePdfViewer({ filePath, fileName }: { filePath: string; fileName: string }) {
  const handleOpenExternal = () => {
    try {
      if ((window as any).electronAPI?.projects?.openFolder) {
        (window as any).electronAPI.projects.openFolder(filePath);
      }
    } catch (e) {
      console.error('Failed to open PDF externally:', e);
    }
  };

  const fileUrl = filePath ? (filePath.startsWith('http') || filePath.startsWith('file://') ? filePath : `file:///${filePath.replace(/\\/g, '/')}`) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={14} color="#f87171" />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#f0f6fc', fontFamily: T.mono }}>{fileName}</span>
        </div>
        <button
          onClick={handleOpenExternal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: '#c9d1d9',
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#f0f6fc'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#c9d1d9'; }}
        >
          <ExternalLink size={12} />
          <span>Open in Default Viewer</span>
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {fileUrl ? (
          <iframe
            src={fileUrl}
            title={fileName}
            style={{ width: '100%', height: '100%', border: 'none', background: '#21262d' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', gap: 12, padding: 24, textAlign: 'center' }}>
            <FileText size={36} color="#f87171" />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f6fc' }}>{fileName}</div>
            <div style={{ fontSize: 11, maxWidth: 360 }}>PDF file is ready. Click below to view with your system PDF reader.</div>
            <button
              onClick={handleOpenExternal}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                background: '#238636',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <ExternalLink size={14} />
              Open Document
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function parseSingleFileDiff(
  item: any,
  defaultPath: string,
  isWrite: boolean,
  isRead: boolean,
  toolCallResult?: any
): ParsedFileDiff {
  const filePathRaw = item?.path || item?.filePath || item?.TargetFile || item?.file || item?.targetFile || defaultPath || 'unknown_file';
  const filePath = typeof filePathRaw === 'string' ? filePathRaw : String(filePathRaw);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  let codeLines: CodeLine[] = [];
  let rawContent = '';

  if (isWrite && !item?.edits && !item?.oldString && !item?.find && !item?.TargetContent) {
    let content = item?.content || item?.text || item?.CodeContent || item?.html
      || item?.code || item?.data || item?.body || item?.fileContent
      || item?.source || item?.output || item?.file_content || '';

    if (!content && toolCallResult) {
      const r = toolCallResult;
      if (typeof r === 'string' && r.length > 0 && !r.startsWith('{')) {
        content = r;
      } else if (r?.data?.content) {
        content = r.data.content;
      } else if (r?.output && typeof r.output === 'string' && !r.output.startsWith('{')) {
        content = r.output;
      } else if (Array.isArray(r?.content)) {
        content = r.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }
    }

    rawContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const lines = typeof content === 'string' ? content.split('\n') : [];
    codeLines = lines.map(line => ({ text: line, type: 'added' as const }));
  } else if (isRead) {
    let outputText = '';
    if (toolCallResult) {
      if (typeof toolCallResult === 'string') {
        outputText = toolCallResult;
      } else if (typeof toolCallResult.output === 'string') {
        outputText = toolCallResult.output;
      } else if (Array.isArray(toolCallResult.content)) {
        outputText = toolCallResult.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      } else {
        outputText = JSON.stringify(toolCallResult);
      }
    } else {
      outputText = 'Reading file contents...';
    }
    rawContent = outputText;
    const lines = outputText.split('\n');
    codeLines = lines.map(line => ({ text: line, type: 'normal' as const }));
  } else {
    const findStr = item?.find || item?.TargetContent || item?.oldString || item?.old_string || item?.search || '';
    const replaceStr = item?.replace || item?.ReplacementContent || item?.newString || item?.new_string || item?.insert || '';
    const chunks = item?.ReplacementChunks || item?.chunks || item?.edits || item?.replacements || [];

    if (chunks && Array.isArray(chunks) && chunks.length > 0) {
      chunks.forEach((chunk: any, idx: number) => {
        if (idx > 0) {
          codeLines.push({ text: '...', type: 'normal' });
        }
        const oldText = chunk.oldString || chunk.oldText || chunk.TargetContent || chunk.old_string || chunk.find || '';
        const newText = chunk.newString || chunk.newText || chunk.ReplacementContent || chunk.new_string || chunk.replace || '';
        if (oldText) {
          oldText.split('\n').forEach((line: string) => {
            codeLines.push({ text: line, type: 'removed' });
          });
        }
        if (newText) {
          newText.split('\n').forEach((line: string) => {
            codeLines.push({ text: line, type: 'added' });
          });
        }
      });
    } else {
      if (findStr) {
        findStr.split('\n').forEach((line: string) => {
          codeLines.push({ text: line, type: 'removed' });
        });
      }
      if (replaceStr) {
        replaceStr.split('\n').forEach((line: string) => {
          codeLines.push({ text: line, type: 'added' });
        });
      }
    }
    rawContent = replaceStr || findStr || '';
  }

  if (codeLines.length === 0) {
    codeLines = [{ text: '// No changes specified or empty content', type: 'normal' }];
  }

  let addedCount = 0;
  let removedCount = 0;
  codeLines.forEach(l => {
    if (l.type === 'added') addedCount++;
    if (l.type === 'removed') removedCount++;
  });

  return { filePath, fileName, codeLines, addedCount, removedCount, rawContent };
}

function CodeEditorPreview({ toolCall }: { toolCall: ToolCallDetail }) {
  const args = toolCall.arguments || (toolCall as any).args || {};
  const toolNameLower = toolCall.toolName.toLowerCase();
  
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create_artifact') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');
  const isRead = toolNameLower.includes('read') || toolNameLower.includes('view_file');

  const files = args.files || args.FileEdits || args.edits || (args.path || args.filePath || args.TargetFile ? [args] : []);
  const parsedFiles: ParsedFileDiff[] = files.map((f: any) => parseSingleFileDiff(f, args.path || args.filePath || args.TargetFile, isWrite, isRead, toolCall.result));

  if (parsedFiles.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.textMuted, fontFamily: T.sans }}>
        No file content to display
      </div>
    );
  }

  // Simple syntax highlighter matching One Dark theme
  const highlightSyntax = (code: string, fileName: string): string => {
    let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Keywords (purple)
    const keywords = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|interface|type|extends|implements|async|await|try|catch|throw|new|this|typeof|instanceof|default|as|yield|void|delete|in|of)\b/g;
    h = h.replace(keywords, '<span style="color: #c678dd">$1</span>');
    
    // Types (yellow/orange)
    const types = /\b(string|number|boolean|any|void|null|undefined|object|Array|Promise|React|ComponentProps|ReactNode|JSX|Element|boolean|Record|Map|Set|Date|Error|RegExp)\b/g;
    h = h.replace(types, '<span style="color: #e5c07b">$1</span>');
    
    // Strings (green)
    h = h.replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, '<span style="color: #98c379">$1</span>');
    
    // Comments (gray)
    h = h.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, '<span style="color: #5c6370">$1</span>');
    
    // Functions (blue)
    h = h.replace(/(\w+)(?=\()/g, '<span style="color: #61afef">$1</span>');
    
    // Numbers (orange)
    h = h.replace(/\b\d+\.?\d*\b/g, '<span style="color: #d19a66">$1</span>');
    
    // Properties (red)
    h = h.replace(/(\w+)(?=:)/g, '<span style="color: #e06c75">$1</span>');
    
    return h;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      {parsedFiles.map((file, idx) => {
        const fileExt = file.fileName.split('.').pop()?.toUpperCase() || '';
        
        return (
          <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* File type label */}
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.02em', textTransform: 'lowercase' }}>
              {fileExt.toLowerCase()}
            </div>
            
            {/* Clean code card - One Dark style */}
            <div style={{ 
              background: '#141414', 
              borderRadius: 10,
              padding: '14px 0',
              overflow: 'auto',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              {file.codeLines.map((line, lineIdx) => (
                <div
                  key={lineIdx}
                  style={{
                    display: 'flex',
                    fontSize: 13,
                    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace',
                    lineHeight: 1.6,
                  }}
                >
                  {/* Line number */}
                  <span style={{ 
                    width: 50, 
                    padding: '0 12px', 
                    textAlign: 'right', 
                    color: '#4a4a4a', 
                    userSelect: 'none', 
                    flexShrink: 0,
                    fontSize: 12
                  }}>
                    {lineIdx + 1}
                  </span>
                  {/* Code with syntax highlighting */}
                  <span 
                    style={{ 
                      padding: '0 12px', 
                      color: '#abb2bf', 
                      whiteSpace: 'pre-wrap', 
                      wordBreak: 'break-word',
                      flex: 1
                    }}
                    dangerouslySetInnerHTML={{ __html: highlightSyntax(line.text, file.fileName) }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TerminalViewPreview({ toolCall }: { toolCall: ToolCallDetail }) {
  const args = toolCall.arguments || (toolCall as any).args || {};
  const command = args.command || args.cmd || args.Command || args.script || '';
  const output = toolCall.result?.output || toolCall.result?.data?.output || toolCall.result || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Command block */}
      <div style={{ 
        background: '#1a1a1a', 
        borderRadius: 8,
        padding: '12px 16px',
        fontFamily: T.mono, 
        fontSize: 13, 
        color: '#e5e5e5',
        overflowX: 'auto' 
      }}>
        <span style={{ color: '#22c55e' }}>$</span> {command}
      </div>

      {/* Output block */}
      {output && (
        <div style={{ 
          background: '#1a1a1a', 
          borderRadius: 8,
          padding: '12px 16px',
          fontFamily: T.mono, 
          fontSize: 13, 
          color: '#a3a3a3',
          whiteSpace: 'pre-wrap', 
          wordBreak: 'break-word',
          maxHeight: 300,
          overflow: 'auto'
        }}>
          {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
        </div>
      )}
    </div>
  );
}
