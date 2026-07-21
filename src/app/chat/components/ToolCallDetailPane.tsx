'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Copy, Check, ChevronDown, Code2, Zap, AlertCircle,
  Clock, CheckCircle, AlertTriangle, ArrowRight, FileText, Loader2
} from 'lucide-react';

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

const T = {
  bg: 'var(--color-bg-subtle)',
  surface: 'var(--color-bg-surface)',
  surfaceRaised: 'var(--color-bg-subtle)',
  border: 'var(--color-border)',
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-tertiary)',
  green: '#22c55e',
  greenFaint: 'rgba(34,197,94,0.08)',
  red: '#ef4444',
  redFaint: 'rgba(239,68,68,0.07)',
  blue: '#3b82f6',
  blueFaint: 'rgba(59,130,246,0.08)',
  r8: 8,
  r12: 12,
  mono: '"Geist Mono", ui-monospace, monospace',
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
};

/* ============================================================
   COPY BUTTON
   ============================================================ */

function CopyButton({ text }: { text: string }) {
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

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: T.r8,
        border: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: 10,
        fontWeight: 600,
        color: copied ? T.green : T.textMuted,
        cursor: 'pointer',
        transition: 'all 0.2s',
        fontFamily: T.sans,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = T.surfaceRaised;
        e.currentTarget.style.borderColor = T.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = T.surface;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
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
        background: 'var(--color-bg-subtle)',
        border: `1px solid ${T.border}`,
        borderRadius: T.r8,
        fontFamily: T.mono,
        fontSize: 11,
        color: T.text,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      {isLarge && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
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

      {/* Content */}
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

      {/* Footer */}
      {isLarge && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 12px',
            borderTop: `1px solid ${T.border}`,
            background: T.surface,
          }}
        >
          <CopyButton text={jsonStr} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STATUS BADGE
   ============================================================ */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; icon: React.ComponentType<{ size?: number }>; text: string }> = {
    pending: { bg: T.surfaceRaised, color: T.textMuted, icon: Clock, text: 'Pending' },
    executing: { bg: T.blueFaint, color: T.blue, icon: Zap, text: 'Executing' },
    completed: { bg: T.greenFaint, color: T.green, icon: CheckCircle, text: 'Completed' },
    failed: { bg: T.redFaint, color: T.red, icon: AlertTriangle, text: 'Failed' },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: T.r8,
        background: c.bg,
        color: c.color,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: T.sans,
      }}
    >
      <Icon size={14} />
      {c.text}
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
              <CheckCircle size={10} color={T.green} />
              <span style={{ fontSize: 10, color: T.green, fontFamily: T.sans, fontWeight: 600 }}>Complete</span>
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
   TOOL CALL DETAIL PANE
   ============================================================ */

export function ToolCallDetailPane({
  toolCall,
  onClose,
}: {
  toolCall: ToolCallDetail;
  onClose: () => void;
}) {
  const isNavis = toolCall.toolName === 'navis' || toolCall.toolName?.toLowerCase().includes('navis');
  const defaultTab = isNavis ? 'findings' : 'input';
  const [activeTab, setActiveTab] = useState<'findings' | 'input' | 'output' | 'timeline'>(defaultTab as any);
  const duration = toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined;
  const toolNameLower = toolCall.toolName.toLowerCase();
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create_artifact') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');
  const isRead = toolNameLower.includes('read') || toolNameLower.includes('view_file');
  const isCodeOrFileViewer = isWrite || isEdit || isRead;

  const [findingsContent, setFindingsContent] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    if (!isNavis || !toolCall) return;

    const readFindings = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.projects) return;

        // 1. Get candidate paths from toolCall arguments
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

        // 2. Fetch projects list
        const projects = await api.projects.list() || [];
        const normalized = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

        // 3. Find matched project path
        let projectPath = '';
        for (const value of candidateValues) {
          const val = normalized(value);
          const matched = projects.find((p: any) => p?.path && val.startsWith(normalized(p.path)));
          if (matched?.path) {
            projectPath = matched.path;
            break;
          }
        }

        // If not matched in registered projects, try using candidate values directly if they are absolute paths
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

        // Fallback to global findings.md if tool-call-specific file was not found
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

    // Poll for live updates while executing
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

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: T.bg,
        borderRadius: T.r12,
        overflow: 'hidden',
        border: `1px solid ${T.border}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: T.r8,
              background: T.blueFaint,
              border: `1px solid ${T.blue}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.blue,
            }}
          >
            <Code2 size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans, marginBottom: 2 }}>
              {toolCall.toolName}
            </div>
            {toolCall.agent && (
              <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans }}>
                Agent: {toolCall.agent}
              </div>
            )}
          </div>
        </div>
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
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = T.surfaceRaised;
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

      {/* Meta Info */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${T.border}`,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {[
          { label: 'Status', value: <StatusBadge status={toolCall.status} /> },
          {
            label: 'Duration',
            value: (
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: T.mono }}>
                {duration ? `${(duration / 1000).toFixed(2)}s` : '—'}
              </div>
            ),
          },
          {
            label: 'Time',
            value: (
              <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                {new Date(toolCall.startTime).toLocaleTimeString()}
              </div>
            ),
          },
        ].map((item) => (
          <div key={item.label}>
            <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, marginBottom: 4, fontFamily: T.sans }}>
              {item.label}
            </div>
            {item.value}
          </div>
        ))}
      </div>

      {/* Tabs / Code Editor content */}
      {isCodeOrFileViewer ? (
        <div style={{ flex: 1, padding: '16px 20px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CodeEditorPreview toolCall={toolCall} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: `1px solid ${T.border}`,
              background: T.surface,
              padding: '0 24px',
              gap: 0,
            }}
          >
            {(isNavis ? ['findings', 'input', 'output', 'timeline'] : ['input', 'output', 'timeline']).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  padding: '14px 18px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: activeTab === tab ? T.text : T.textMuted,
                  background: activeTab === tab ? T.bg : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: activeTab === tab ? `2px solid ${T.green}` : 'none',
                  fontFamily: T.sans,
                  transition: 'all 0.2s',
                  textTransform: 'capitalize',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {tab === 'findings' && <FileText size={11} />}
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: activeTab === 'findings' ? 'hidden' : 'auto', padding: activeTab === 'findings' ? 0 : '22px 26px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
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
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                        Result
                      </div>
                      <JsonViewer data={toolCall.result} />
                    </div>
                  ) : toolCall.status === 'failed' && toolCall.error ? (
                    <div
                      style={{
                        background: T.redFaint,
                        border: `1px solid ${T.red}30`,
                        borderRadius: T.r8,
                        padding: '12px 14px',
                        display: 'flex',
                        gap: 10,
                      }}
                    >
                      <AlertCircle size={16} color={T.red} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.red, marginBottom: 4, fontFamily: T.sans }}>
                          Error
                        </div>
                        <code style={{ fontSize: 11, color: T.red, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
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
                        {/* Timeline dot */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              background:
                                event.status === 'completed'
                                  ? T.green
                                  : event.status === 'in-progress'
                                    ? T.blue
                                    : T.red,
                              border: `2px solid ${T.surface}`,
                              boxShadow: `0 0 0 2px ${event.status === 'completed' ? T.green : event.status === 'in-progress' ? T.blue : T.red}`,
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

                        {/* Event */}
                        <div style={{ flex: 1, paddingTop: 2 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2, fontFamily: T.sans }}>
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

function CodeEditorPreview({ toolCall }: { toolCall: ToolCallDetail }) {
  const args = toolCall.arguments || (toolCall as any).args || {};
  const filePathRaw = args.path || args.TargetFile || args.AbsolutePath || args.filePath || args.file || toolCall.result?.data?.path || 'unknown_file';
  const filePath = typeof filePathRaw === 'string' ? filePathRaw : String(filePathRaw);
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  
  const toolNameLower = toolCall.toolName.toLowerCase();
  const isWrite = (toolNameLower.includes('write') || toolNameLower.includes('create_artifact') || toolNameLower.includes('save')) && !toolNameLower.includes('todo_write');
  const isEdit = toolNameLower.includes('edit') || toolNameLower.includes('replace');
  const isRead = toolNameLower.includes('read') || toolNameLower.includes('view_file');

  interface CodeLine {
    text: string;
    type: 'added' | 'removed' | 'normal';
  }

  let codeLines: CodeLine[] = [];

  if (isWrite) {
    // Try all known content argument keys
    let content = args.content || args.text || args.CodeContent || args.html
      || args.code || args.data || args.body || args.fileContent
      || args.source || args.output || args.file_content || '';

    // If args have no content, try extracting from the tool call result
    if (!content && toolCall.result) {
      const r = toolCall.result;
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

    const lines = typeof content === 'string' ? content.split('\n') : [];
    codeLines = lines.map(line => ({ text: line, type: 'added' as const }));
  } else if (isRead) {
    let outputText = '';
    if (toolCall.result) {
      if (typeof toolCall.result === 'string') {
        outputText = toolCall.result;
      } else if (typeof toolCall.result.output === 'string') {
        outputText = toolCall.result.output;
      } else if (Array.isArray(toolCall.result.content)) {
        outputText = toolCall.result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      } else {
        outputText = JSON.stringify(toolCall.result);
      }
    } else if (toolCall.status === 'executing' || toolCall.status === 'pending') {
      outputText = 'Reading file contents...';
    } else if (toolCall.error) {
      outputText = `Error reading file: ${toolCall.error}`;
    }
    const lines = outputText.split('\n');
    codeLines = lines.map(line => ({ text: line, type: 'normal' as const }));
  } else {
    // Edit tool
    const findStr = args.find || args.TargetContent || '';
    const replaceStr = args.replace || args.ReplacementContent || args.insert || '';
    const chunks = args.ReplacementChunks || [];

    if (args.edits && Array.isArray(args.edits) && args.edits.length > 0) {
      args.edits.forEach((edit: any, idx: number) => {
        if (idx > 0) {
          codeLines.push({ text: '...', type: 'normal' });
        }
        const oldText = edit.oldText || '';
        const newText = edit.newText || '';
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
    } else if (chunks && Array.isArray(chunks) && chunks.length > 0) {
      chunks.forEach((chunk: any, idx: number) => {
        if (idx > 0) {
          codeLines.push({ text: '...', type: 'normal' });
        }
        const chunkTarget = chunk.TargetContent || '';
        const chunkRepl = chunk.ReplacementContent || '';
        
        if (chunkTarget) {
          chunkTarget.split('\n').forEach((line: string) => {
            codeLines.push({ text: line, type: 'removed' });
          });
        }
        if (chunkRepl) {
          chunkRepl.split('\n').forEach((line: string) => {
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
  }

  if (codeLines.length === 0) {
    if (toolCall.status === 'executing' || toolCall.status === 'pending') {
      codeLines = [{ text: '// Writing file...', type: 'normal' }];
    } else if (isWrite) {
      codeLines = [{ text: '// File was written but content was not captured in tool arguments', type: 'normal' }];
    } else {
      codeLines = [{ text: '// No changes specified or empty content', type: 'normal' }];
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0d1117',
        border: '1px solid #30363d',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      }}
    >
      {/* Editor Title Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#161b22',
          borderBottom: '1px solid #30363d',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
        </div>
        
        <div
          style={{
            background: '#0d1117',
            padding: '6px 16px',
            borderRadius: '6px 6px 0 0',
            border: '1px solid #30363d',
            borderBottom: 'none',
            fontSize: 12,
            fontFamily: T.mono,
            color: '#c9d1d9',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: -9,
            marginTop: -4,
          }}
        >
          <span style={{ color: '#4ade80' }}>⚡</span>
          <span>{fileName}</span>
        </div>

        <div style={{ fontSize: 10, color: '#8b949e', fontFamily: T.sans, textTransform: 'uppercase' }}>
          {isWrite ? 'WRITE' : isRead ? 'READ' : 'EDIT'}
        </div>
      </div>

      {/* Path Breadcrumb */}
      <div
        style={{
          padding: '6px 16px',
          background: '#090d13',
          borderBottom: '1px solid #21262d',
          fontSize: 11,
          fontFamily: T.mono,
          color: '#8b949e',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {filePath}
      </div>

      {/* Editor Content Area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 0',
          fontFamily: T.mono,
          fontSize: 12,
          lineHeight: '1.6',
          color: '#c9d1d9',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {(() => {
              const MAX_PREVIEW_LINES = 1000;
              const truncated = codeLines.length > MAX_PREVIEW_LINES;
              const linesToRender = truncated ? codeLines.slice(0, MAX_PREVIEW_LINES) : codeLines;

              const elements = linesToRender.map((line, idx) => {
                const isAdded = line.type === 'added';
                const isRemoved = line.type === 'removed';
                const rowBg = isAdded 
                  ? 'rgba(46, 160, 67, 0.15)' 
                  : isRemoved 
                    ? 'rgba(248, 81, 112, 0.15)' 
                    : 'transparent';
                
                const textColor = isAdded 
                  ? '#4ade80' 
                  : isRemoved 
                    ? '#f87171' 
                    : '#8b949e';

                const prefix = isAdded ? '+' : isRemoved ? '-' : ' ';

                return (
                  <tr 
                    key={idx} 
                    style={{ 
                      background: rowBg,
                      transition: 'background 0.1s',
                    }}
                  >
                    <td
                      style={{
                        width: 45,
                        textAlign: 'right',
                        paddingRight: 12,
                        color: '#484f58',
                        userSelect: 'none',
                        borderRight: '1px solid #21262d',
                        fontSize: 11,
                      }}
                    >
                      {idx + 1}
                    </td>
                    <td
                      style={{
                        width: 24,
                        textAlign: 'center',
                        color: textColor,
                        fontWeight: 'bold',
                        userSelect: 'none',
                        fontSize: 12,
                      }}
                    >
                      {prefix}
                    </td>
                    <td
                      style={{
                        paddingLeft: 8,
                        paddingRight: 16,
                        color: textColor,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {line.text}
                    </td>
                  </tr>
                );
              });

              if (truncated) {
                elements.push(
                  <tr key="trunc-msg" style={{ background: 'transparent' }}>
                    <td colSpan={3} style={{ padding: '8px 16px', color: '#8b949e', fontStyle: 'italic', fontSize: 11 }}>
                      ... [Remaining {codeLines.length - MAX_PREVIEW_LINES} lines truncated for performance]
                    </td>
                  </tr>
                );
              }

              return elements;
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
