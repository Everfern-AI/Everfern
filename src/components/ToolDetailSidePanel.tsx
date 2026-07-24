'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { diffLines } from 'diff';
import Ansi from 'ansi-to-react';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, AlertTriangle, CheckCircle, Link2, ExternalLink,
  Braces, ChevronDown, AlertCircle, ArrowUpRight, Play, Pause,
  BookOpen, PanelRightOpen, File as FileIcon, Folder, Plus, Image, Brain,
  FileText, Loader2
} from 'lucide-react';
import { FolderOpenIcon } from '@heroicons/react/24/outline';
import { MarkdownViewer } from './FileViewerModal';

/* ============================================================
   TYPES
   ============================================================ */
export const ToolType = {
  MCP_REGISTRY: 'mcp_registry',
  WEB_SEARCH: 'web_search',
  FERN: 'fern',
  MEMORY: 'memory',
  TERMINAL: 'terminal',
  SKILL: 'skill',
  FILE_SYSTEM: 'file_system',
  FILE_EDITOR: 'file_editor',
  TODO_WRITE: 'todo_write',
  IMAGE_ANALYSIS: 'image_analysis',
  LIVE_PREVIEW: 'live_preview',
  GENERIC: 'generic',
};

/* ============================================================
   TOKENS — single source of truth
   ============================================================ */
const T = {
  // Surfaces
  bg: 'var(--color-bg-base)',
  surface: 'var(--color-bg-surface)',
  surfaceRaised: 'var(--color-bg-subtle)',
  border: 'var(--color-border)',
  borderSubtle: 'var(--color-border-subtle)',

  // Text
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-tertiary)',
  textPlaceholder: 'var(--color-text-placeholder)',

  // Ink (terminal / code)
  inkBg: 'var(--color-bg-base)',
  inkSurface: 'var(--color-bg-surface)',
  inkBorder: 'var(--color-border)',
  inkText: 'var(--color-text-primary)',
  inkMuted: 'var(--color-text-tertiary)',

  // Semantic
  green: '#22c55e',
  greenFaint: 'rgba(34,197,94,0.08)',
  red: '#ef4444',
  redFaint: 'rgba(239,68,68,0.07)',
  amber: '#f59e0b',
  blue: '#3b82f6',
  blueFaint: 'rgba(59,130,246,0.08)',

  // Radius
  r4: 4, r6: 6, r8: 8, r10: 10, r12: 12, r14: 14, r16: 16,

  // Font stacks
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
};

const VS = {
  bg: 'var(--color-bg-base)',
  bg2: 'var(--color-bg-surface)',
  tab: 'var(--color-bg-subtle)',
  tabActive: 'var(--color-bg-surface)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  dim: 'var(--color-text-tertiary)',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#f59e0b',
  blue: '#6366f1',
};

const CLAY = {
  card: 'var(--color-bg-surface)',
  cardMuted: 'var(--color-bg-subtle)',
  hover: 'var(--color-bg-hover)',
  active: 'var(--color-bg-active)',
  shadow: '0 1px 2px rgba(0,0,0,0.15)',
  panelShadow: '0 12px 32px rgba(0,0,0,0.25)',
};

/* ============================================================
   UTILITIES
   ============================================================ */
export function detectToolType(toolName: string | undefined | null): string {
  if (!toolName) return ToolType.GENERIC;
  const n = toolName.toLowerCase();
  if (n === 'skill') return ToolType.SKILL;
  if (n === 'show_user_url' || n.includes('preview_live_url')) return ToolType.LIVE_PREVIEW;
  if (n === 'search_mcp_registry' || n.includes('mcp_registry')) return ToolType.MCP_REGISTRY;
  if (n.includes('web_search') || n.includes('remote_web_search') || n.includes('search')) return ToolType.WEB_SEARCH;
  if (n.includes('web_fetch') || n.includes('fetch_url')) return ToolType.WEB_SEARCH;
  if (n === 'fern' || n === 'recall_fact' || n === 'remember_fact' || n === 'update_profile' || n.includes('memory') || n.includes('consolidator') || n.includes('confirm_preference') || n.includes('recall') || n.includes('remember')) return ToolType.MEMORY;
  if (n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return ToolType.FERN;
  if (n.includes('run_command') || n.includes('bash') || n.includes('run_terminal') || n.includes('execute')) return ToolType.TERMINAL;
  if (n === 'todo_write') return ToolType.TODO_WRITE;
  if (n === 'analyze_image' || n.includes('analyze_image') || n === 'visual_classification_sheet') return ToolType.IMAGE_ANALYSIS;
  if (n === 'read' || n === 'read_file' || n === 'view_file' || n.includes('write') || n.includes('replace') || n.includes('edit')) return ToolType.FILE_EDITOR;
  if (n.includes('system_files') || n.includes('list_dir') || n.includes('grep_search')) return ToolType.FILE_SYSTEM;
  return ToolType.GENERIC;
}

export function formatTimestamp(ts: any): string {
  return new Date(ts).toLocaleString();
}
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
export function truncateText(t: string, max: number): string {
  return t.length <= max ? t : t.substring(0, max) + '…';
}
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

function getToolMeta(toolName: string | undefined | null) {
  const n = (toolName || "").toLowerCase();
  if (n === 'skill') return { Icon: BookOpen, label: 'Skill Tool' };
  if (n === 'show_user_url') return { Icon: Globe, label: 'Browser' };
  if (n.includes('preview_live_url')) return { Icon: Globe, label: 'Live Preview' };
  if (n === 'search_mcp_registry' || n.includes('mcp_registry')) return { Icon: Braces, label: 'MCP Registry' };
  if (n.includes('web_search') || n.includes('search')) return { Icon: Search, label: 'Web Search' };
  if (n.includes('web_fetch') || n.includes('fetch_url')) return { Icon: Globe, label: 'Web Fetch' };
  if (n === 'fern' || n === 'recall_fact' || n === 'remember_fact' || n === 'update_profile' || n.includes('fern') || n.includes('memory') || n.includes('consolidator') || n.includes('confirm_preference') || n.includes('recall') || n.includes('remember')) return { Icon: Brain, label: 'Memory' };
  if (n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
  if (n.includes('run_command') || n.includes('bash') || n.includes('terminal')) return { Icon: Terminal, label: 'Terminal' };
  if (n === 'todo_write') return { Icon: CheckCircle, label: 'Todo List' };
  if (n === 'visual_classification_sheet') return { Icon: Image, label: 'Visual Sheet' };
  if (n === 'analyze_image' || n.includes('analyze_image')) return { Icon: Image, label: 'Image Analysis' };
  if (n.includes('system_files')) return { Icon: FolderOpenIcon, label: 'File System', iconSize: 12 };
  return { Icon: Braces, label: 'Generic Tool' };
}

/* ============================================================
   MICRO: PULSE DOT
   ============================================================ */
function PulseDot({ color = T.green }: { color?: string }) {
  return (
    <motion.span
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
    />
  );
}

/* ============================================================
   COPY BUTTON
   ============================================================ */
function CopyBtn({ text, dark }: { text: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { }
  };
  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    border: `1px solid ${dark ? T.inkBorder : T.border}`,
    borderRadius: T.r8, padding: '5px 12px', cursor: 'pointer', background: 'transparent',
    fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
    color: copied ? T.green : (dark ? T.inkMuted : T.textMuted),
    fontFamily: T.sans, transition: 'color 0.15s, border-color 0.15s',
  };
  return (
    <button onClick={handle} style={base}>
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ============================================================
   PANEL HEADER
   ============================================================ */
function PanelHeader({
  agentName,
  toolName,
  onClose,
  showFilePane,
  onToggleFilePane,
}: {
  agentName?: string;
  toolName?: string;
  onClose: () => void;
  showFilePane?: boolean;
  onToggleFilePane?: () => void;
}) {
  const { Icon, label, iconSize = 16 } = getToolMeta(toolName);

  return (
    <header style={{
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      padding: '20px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0,
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: T.r10, flexShrink: 0,
          background: 'var(--color-bg-subtle)', border: '0.5px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <Icon size={iconSize} color={'var(--color-text-secondary)'} strokeWidth={1.75} />
        </div>

        {/* Text stack */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
            {agentName && (
              <>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: '-0.015em', fontFamily: T.sans }}>{agentName}</span>
                <span style={{ color: T.borderSubtle, fontSize: 12 }}>→</span>
              </>
            )}
            <code style={{
              fontSize: 11.5, fontFamily: T.mono, fontWeight: 700, color: 'var(--color-text-primary)',
              background: 'var(--color-bg-subtle)', border: '0.5px solid var(--color-border)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)',
              padding: '2px 8px', borderRadius: T.r6,
            }}>
              {toolName}
            </code>
          </div>
          <p style={{ fontSize: 10.5, color: T.textMuted, margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, fontFamily: T.sans }}>
            {label}
          </p>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <PulseDot />
        {onToggleFilePane && (
          <button
            onClick={onToggleFilePane}
            aria-label="Toggle files pane"
            title="Toggle files pane"
            style={{
              width: 32, height: 32, borderRadius: T.r8, border: showFilePane ? '1px solid rgba(20,20,18,0.22)' : '0.5px solid var(--color-border)',
              background: showFilePane ? 'var(--color-bg-hover)' : 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)',
              cursor: 'pointer', color: 'var(--color-text-secondary)', transition: 'all 0.1s ease',
            }}
          >
            <PanelRightOpen size={15} strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 32, height: 32, borderRadius: T.r8, border: '0.5px solid var(--color-border)',
            background: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)',
            cursor: 'pointer', color: 'var(--color-text-secondary)', transition: 'all 0.1s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
          onMouseDown={e => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  );
}

/* ============================================================
   SECTION LABEL (sticky)
   ============================================================ */
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      padding: '16px 24px 12px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 10,
      background: 'var(--color-bg-surface)',
      backdropFilter: 'blur(10px)',
      borderBottom: `1px solid ${T.borderSubtle}`,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: T.textMuted,
        letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.sans,
      }}>
        {children}
      </span>
      {right && (
        <span style={{
          fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-primary)',
          background: 'var(--color-bg-subtle)',
          border: '0.5px solid var(--color-border)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)',
          padding: '3px 12px', borderRadius: 100, fontFamily: T.mono,
        }}>
          {right}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   EMPTY STATE
   ============================================================ */
function EmptyState({
  icon: IconSvg, title, description, note,
}: {
  icon: React.ComponentType;
  title: string;
  description: string;
  note?: string;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '64px 40px', background: T.bg,
    }}>
      {/* Icon */}
      <motion.div
        style={{
          width: 72, height: 72, borderRadius: 18,
          background: T.surface, border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.textMuted, marginBottom: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.9)',
        }}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, type: 'spring', stiffness: 260, damping: 22 }}
      >
        <IconSvg />
      </motion.div>

      <motion.h3
        style={{ fontSize: 14, fontWeight: 600, color: T.text, margin: '0 0 8px', textAlign: 'center', letterSpacing: '-0.02em', fontFamily: T.sans }}
        initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.35 }}
      >
        {title}
      </motion.h3>
      <motion.p
        style={{ fontSize: 13, color: T.textMuted, margin: '0 0 28px', textAlign: 'center', maxWidth: 280, lineHeight: 1.65, fontFamily: T.sans }}
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.35 }}
      >
        {description}
      </motion.p>

      {note && (
        <motion.div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: T.r12, padding: '14px 18px', maxWidth: 320,
          }}
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26, duration: 0.35 }}
        >
          <Globe size={13} color={T.textMuted} style={{ marginTop: 2, flexShrink: 0 }} strokeWidth={1.75} />
          <span style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.65, fontFamily: T.sans }}>{note}</span>
        </motion.div>
      )}
    </div>
  );
}

/* ============================================================
   MINIMAL SVGs for empty states
   ============================================================ */
function IconCamera() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="2" y="9" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="16" cy="19" r="5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M11 9 L13.5 5 H18.5 L21 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="4" y1="4" x2="28" y2="28" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <line x1="21" y1="21" x2="29" y2="29" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="10" y1="14" x2="18" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.4} />
      <line x1="10" y1="17" x2="15" y2="17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.25} />
    </svg>
  );
}

/* ============================================================
   SCREENSHOT CARD
   ============================================================ */
function ScreenshotCard({ screenshot, index, onZoom }: { screenshot: any; index: number; onZoom: (s: any) => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  return (
    <motion.div
      onClick={() => onZoom(screenshot)}
      style={{
        borderRadius: T.r12, overflow: 'hidden', background: T.surface,
        border: `1px solid ${T.border}`, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 24 }}
      whileHover={{ borderColor: T.textMuted, y: -1, boxShadow: '0 6px 20px rgba(0,0,0,0.06)' }}
    >
      {/* Image */}
      <div style={{ position: 'relative', background: T.surfaceRaised, aspectRatio: '16/9', overflow: 'hidden' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              style={{ width: 18, height: 18, border: `2px solid ${T.border}`, borderTopColor: T.textMuted, borderRadius: '50%' }}
              animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
            />
          </div>
        )}
        {!err ? (
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt={`Capture ${index + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setErr(true); }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: T.textMuted, gap: 6 }}>
            <CameraOff size={20} strokeWidth={1.5} />
            <span style={{ fontSize: 11, fontFamily: T.sans }}>Failed to load</span>
          </div>
        )}

        {/* Expand overlay */}
        <motion.div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          whileHover={{ background: 'rgba(0,0,0,0.2)' }}
        >
          <div style={{
            padding: '7px', background: 'rgba(255,255,255,0.92)', borderRadius: T.r8,
            opacity: 0, transition: 'opacity 0.15s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          >
            <Maximize2 size={13} color={T.text} />
          </div>
        </motion.div>

        {/* Index badge */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.9)',
          background: 'rgba(14,14,12,0.6)', padding: '2px 7px', borderRadius: T.r4,
          letterSpacing: '0.08em', backdropFilter: 'blur(4px)', fontFamily: T.mono,
        }}>
          {String(index + 1).padStart(2, '0')}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${T.borderSubtle}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: T.text, fontFamily: T.sans }}>Frame {index + 1}</span>
        <span style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.mono }}>
          {formatTimestamp(screenshot.timestamp).split(',')[1]?.trim() || ''}
        </span>
      </div>
    </motion.div>
  );
}

/* ============================================================
   ZOOM MODAL
   ============================================================ */
const CursorOverlayOnImage = ({ coordinate, action }: { coordinate: any, action: string }) => {
  let x = 0;
  let y = 0;
  if (Array.isArray(coordinate)) {
    x = Number(coordinate[0]);
    y = Number(coordinate[1]);
  } else if (coordinate && typeof coordinate === 'object') {
    x = Number(coordinate.x);
    y = Number(coordinate.y);
  } else {
    return null;
  }
  if (isNaN(x) || isNaN(y)) return null;

  const maxVal = Math.max(x, y);
  const scaleWidth = maxVal <= 1000 ? 1000 : 1920;
  const scaleHeight = maxVal <= 1000 ? 1000 : 1080;

  const leftPercent = (x / scaleWidth) * 100;
  const topPercent = (y / scaleHeight) * 100;

  return (
    <motion.div
      style={{
        position: 'absolute',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      animate={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 28
      }}
    >
      {(action?.toLowerCase().includes('click') || action?.toLowerCase().includes('tap') || action?.toLowerCase().includes('drag')) && (
        <div
          style={{
            position: 'absolute',
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '2.5px solid rgba(59, 130, 246, 0.8)',
            animation: 'ripple-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5))',
        }}
      >
        <rect
          x="6"
          y="6"
          width="12"
          height="12"
          rx="3"
          ry="3"
          fill="rgba(255, 255, 255, 0.95)"
          stroke="rgba(0, 0, 0, 0.15)"
          strokeWidth="0.5"
        />
        <rect
          x="8"
          y="8"
          width="8"
          height="8"
          rx="2"
          ry="2"
          fill="none"
          stroke="rgba(0, 0, 0, 0.08)"
          strokeWidth="0.5"
        />
      </svg>

      <style>{`
        @keyframes ripple-ping {
          0% { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </motion.div>
  );
};

function ZoomModal({ screenshot, onClose }: { screenshot: any; onClose: () => void }) {
  return (
    <motion.div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(9,9,9,0.88)',
        backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100, padding: 24,
      }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ position: 'relative', maxWidth: '90vw', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: -44, right: 24,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: T.r8, width: 32, height: 32, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)',
            transition: 'background 0.15s',
            zIndex: 110,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <X size={14} />
        </button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <motion.img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt="Full screenshot"
            style={{
              width: '100%', maxHeight: '84vh', objectFit: 'contain',
              borderRadius: T.r12, border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
              display: 'block',
            }}
            initial={{ scale: 0.96, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          />
          {screenshot.action?.params?.coordinate && (
            <CursorOverlayOnImage
              coordinate={screenshot.action.params.coordinate}
              action={screenshot.action.type}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ============================================================
   NAVIS VIEW
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

function NavisView({
  screenshots = [],
  toolName,
  navisReport = '',
  toolCall,
}: {
  screenshots: any[];
  toolName: string;
  navisReport?: string;
  toolCall?: any;
}) {
  const [zoomed, setZoomed] = useState<any>(null);
  const safe = Array.isArray(screenshots) ? screenshots : [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true); // Autoplay by default
  const prevLengthRef = useRef(safe.length);
  const [activeTab, setActiveTab] = useState<'findings' | 'screenshots'>('findings');

  const [findingsContent, setFindingsContent] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    if (!toolCall) return;

    const readFindings = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.projects) return;

        const args = toolCall.args || toolCall.arguments || {};
        const candidateValues = [
          args.cwd,
          args.path,
          args.filePath,
          args.file,
          args.TargetFile,
          args.DirectoryPath,
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

        let content: string | null = null;
        const filename = toolCall?.id ? `findings_${toolCall.id}.md` : 'findings.md';
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
        if (content === null && toolCall?.id) {
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
        console.error('Error reading findings.md in NavisView:', err);
        if (isMounted) {
          setFindingsContent('Could not find findings.md for this task.');
        }
      }
    };

    readFindings();

    const isRunning = toolCall.status === 'executing' || toolCall.status === 'pending';
    let intervalId: any;
    if (isRunning) {
      intervalId = setInterval(readFindings, 1000);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [toolCall]);

  useEffect(() => {
    let interval: any;
    if (isPlaying && safe.length > 0) {
      interval = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= safe.length - 1) {
            // Stay at the end and wait for next frame
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, safe.length]);

  // Live update: automatically track the latest frame when new ones arrive
  useEffect(() => {
    if (safe.length > prevLengthRef.current) {
      setCurrentIndex(safe.length - 1);
    }
    prevLengthRef.current = safe.length;
  }, [safe.length]);

  useEffect(() => {
    if (currentIndex >= safe.length && safe.length > 0) {
      setCurrentIndex(safe.length - 1);
    }
  }, [safe.length, currentIndex]);

  const renderTabs = () => (
    <div style={{
      display: 'flex',
      gap: 4,
      padding: '4px',
      background: 'var(--color-bg-subtle)',
      borderRadius: T.r10,
      alignSelf: 'flex-start',
      marginBottom: 16,
      border: '0.5px solid rgba(0,0,0,0.08)',
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
    }}>
      <button
        onClick={() => setActiveTab('findings')}
        style={{
          padding: '6px 16px',
          borderRadius: T.r8,
          fontSize: 12,
          fontWeight: activeTab === 'findings' ? 600 : 500,
          color: activeTab === 'findings' ? T.text : T.textSecondary,
          background: activeTab === 'findings' ? T.surface : 'transparent',
          border: 'none',
          boxShadow: activeTab === 'findings' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        Findings
      </button>
      <button
        onClick={() => setActiveTab('screenshots')}
        style={{
          padding: '6px 16px',
          borderRadius: T.r8,
          fontSize: 12,
          fontWeight: activeTab === 'screenshots' ? 600 : 500,
          color: activeTab === 'screenshots' ? T.text : T.textSecondary,
          background: activeTab === 'screenshots' ? T.surface : 'transparent',
          border: 'none',
          boxShadow: activeTab === 'screenshots' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        Screenshots ({safe.length})
      </button>
    </div>
  );

  if (activeTab === 'findings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <SectionLabel>findings.md</SectionLabel>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          {renderTabs()}
          <div style={{
            background: T.surface,
            borderRadius: T.r12,
            border: `1px solid ${T.border}`,
            padding: 0,
            overflow: 'hidden',
            flex: 1,
          }}>
            <NavisReportViewer
              report={findingsContent}
              isRunning={toolCall?.status === 'executing' || toolCall?.status === 'pending'}
            />
          </div>
        </div>
      </div>
    );
  }

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <SectionLabel>Browser session</SectionLabel>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          {renderTabs()}
          <EmptyState
            icon={CameraOff}
            title="No captures yet"
            description={`${toolName} ran but didn't produce screenshots during this session.`}
            note="Frames appear here in real-time as the browser navigates."
          />
        </div>
      </div>
    );
  }

  const currentScreenshot = safe[currentIndex] || safe[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionLabel right={`${currentIndex + 1} / ${safe.length} frame${safe.length !== 1 ? 's' : ''}`}>Execution history</SectionLabel>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
        {renderTabs()}
        <div style={{
          background: T.surface,
          borderRadius: T.r12,
          border: `1px solid ${T.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          {/* Main Image */}
          <div
            style={{
              width: '100%',
              background: T.surfaceRaised,
              borderRadius: T.r8,
              border: `1px solid ${T.borderSubtle}`,
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 300
            }}
          >
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={`data:image/jpeg;base64,${currentScreenshot.base64}`}
                alt="Navis frame"
                style={{ width: '100%', height: 'auto', maxHeight: '60vh', objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
                onClick={() => setZoomed(currentScreenshot)}
              />
              {currentScreenshot.action?.params?.coordinate && (
                <CursorOverlayOnImage
                  coordinate={currentScreenshot.action.params.coordinate}
                  action={currentScreenshot.action.type}
                />
              )}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              background: 'rgba(0,0,0,0.6)', color: '#ffffff',
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
              zIndex: 10
            }}>
              Step {currentScreenshot.sequenceNumber ?? (currentIndex + 1)}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, right: 12,
              background: 'rgba(0,0,0,0.6)', color: '#ffffff',
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
              zIndex: 10
            }}>
              {formatTimestamp(currentScreenshot.timestamp).split(',')[1]?.trim() || ''}
            </div>
          </div>

          {/* Slider and Controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '6px 16px 6px 6px',
            background: "var(--color-bg-subtle)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.06), 0 2px 5px rgba(0,0,0,0.05)",
            border: "0.5px solid var(--color-border)",
            borderRadius: 100,
            marginTop: 4
          }}>
            <button
              onClick={() => {
                if (!isPlaying && currentIndex >= safe.length - 1) {
                  setCurrentIndex(0);
                }
                setIsPlaying(!isPlaying);
              }}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isPlaying ? 'var(--color-text-primary)' : 'var(--color-bg-surface)',
                color: isPlaying ? 'var(--color-text-inverse)' : 'var(--color-text-primary)',
                boxShadow: isPlaying
                  ? 'inset 0 1px 3px rgba(0,0,0,0.3)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.05)',
                border: isPlaying ? 'none' : '0.5px solid var(--color-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0,
                transition: 'all 0.15s ease'
              }}
            >
              {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>

            <input
              type="range"
              className="gallium-slider"
              min={0}
              max={safe.length - 1}
              value={currentIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentIndex(Number(e.target.value));
              }}
              style={{ flex: 1, cursor: 'pointer' }}
            />
            <style>{`
              .gallium-slider { -webkit-appearance: none; background: transparent; height: 24px; }
              .gallium-slider:focus { outline: none; }
              .gallium-slider::-webkit-slider-runnable-track {
                width: 100%; height: 6px; border-radius: 4px;
                background: rgba(0,0,0,0.06);
                box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
                border: 0.5px solid rgba(255,255,255,0.4);
              }
              .gallium-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                height: 20px; width: 20px; border-radius: 50%;
                background: var(--color-bg-subtle);
                box-shadow: inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.15);
                border: 0.5px solid rgba(0,0,0,0.15);
                margin-top: -7.5px;
                transition: transform 0.1s;
              }
              .gallium-slider::-webkit-slider-thumb:hover {
                transform: scale(1.05);
              }
              .gallium-slider::-webkit-slider-thumb:active {
                transform: scale(0.95);
                background: var(--color-bg-base);
              }
            `}</style>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {zoomed && <ZoomModal screenshot={zoomed} onClose={() => setZoomed(null)} />}
      </AnimatePresence>
    </div>
  );
}
/* ============================================================
   TERMINAL VIEW — drop-in replacement
   ============================================================ */

const TERM = {
  bg: '#0c0c0c',
  border: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.05)',

  textCmd: 'rgba(255,255,255,0.88)',
  textOut: 'rgba(238,242,247,0.86)',
  textErr: '#ff5f57',
  textDim: 'rgba(255,255,255,0.2)',
  textMeta: 'rgba(255,255,255,0.3)',

  psUser: '#5af78e',
  psAt: 'rgba(255,255,255,0.25)',
  psHost: '#57c7ff',
  psSep: 'rgba(255,255,255,0.2)',
  psPath: '#f3f99d',
  psDollar: 'rgba(255,255,255,0.4)',

  okBg: 'rgba(40,201,64,0.1)',
  okBorder: 'rgba(40,201,64,0.18)',
  okText: '#28c940',
  errBg: 'rgba(255,95,87,0.1)',
  errBorder: 'rgba(255,95,87,0.18)',
  errText: '#ff5f57',
};

const monoStack = '"Geist Mono","Berkeley Mono",ui-monospace,"SF Mono",Menlo,monospace';

const ansiControlRegex = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;

function normalizeTerminalOutput(output?: string) {
  return (output || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hasVisibleTerminalOutput(output?: string) {
  return normalizeTerminalOutput(output).replace(ansiControlRegex, '').trim().length > 0;
}

function TerminalChrome({
  title,
  tint,
  children,
}: {
  title: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0)), #090b10',
      overflow: 'hidden',
      fontFamily: monoStack,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        background: 'rgba(255,255,255,0.045)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <span style={{
          fontSize: 11,
          color: 'rgba(235,245,255,0.78)',
          fontFamily: monoStack,
          fontWeight: 650,
          letterSpacing: '0.01em',
        }}>{title}</span>
        <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: tint, boxShadow: `0 0 14px ${tint}` }} />
      </div>
      <style>{`
        .everfern-terminal-output code {
          background: transparent !important;
          color: inherit;
          font: inherit;
          white-space: inherit;
        }
        .everfern-terminal-output span {
          font-family: inherit;
        }
        .everfern-terminal-output ::selection {
          background: rgba(110, 168, 254, 0.35);
        }
      `}</style>
      {children}
    </div>
  );
}

function TerminalAnsiOutput({
  output,
  isError,
  palette,
}: {
  output: string;
  isError: boolean;
  palette: { textOut: string; textErr: string };
}) {
  return (
    <pre
      className="everfern-terminal-output"
      style={{
        fontSize: 12.5,
        lineHeight: 1.68,
        color: isError ? palette.textErr : palette.textOut,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: '0 0 8px',
        fontFamily: monoStack,
        tabSize: 2,
      }}
    >
      <Ansi>{normalizeTerminalOutput(output)}</Ansi>
    </pre>
  );
}

function translateWindowsPathToLinux(winPath: string): string {
  const clean = winPath.trim();
  const driveLetterMatch = clean.match(/^([A-Za-z]):[\\\/]/);
  if (driveLetterMatch) {
    const driveLetter = driveLetterMatch[1].toLowerCase();
    const pathWithoutDrive = clean.substring(3);
    return `/mnt/${driveLetter}/${pathWithoutDrive.replace(/\\/g, '/')}`;
  }
  return clean.replace(/\\/g, '/');
}

function PS1({ user = 'ubuntu', host = 'localhost', path = '~' }: { user?: string; host?: string; path?: string }) {
  return (
    <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13 }}>
      {path !== '~' ? (
        <span style={{ color: TERM.psPath }}>{path}</span>
      ) : (
        <>
          <span style={{ color: TERM.psUser }}>{user}</span>
          <span style={{ color: TERM.psAt }}>@</span>
          <span style={{ color: TERM.psHost }}>{host}</span>
          <span style={{ color: TERM.psSep }}>:</span>
          <span style={{ color: TERM.psPath }}>{path}</span>
        </>
      )}
      <span style={{ color: TERM.psDollar, margin: '0 8px 0 4px' }}>$</span>
    </span>
  );
}

function BlinkCursor() {
  return (
    <motion.span
      style={{
        display: 'inline-block', width: 7, height: 14,
        background: 'rgba(255,255,255,0.6)', borderRadius: 1,
        verticalAlign: 'text-bottom', marginLeft: 1,
      }}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ repeat: Infinity, duration: 1.1, times: [0, 0.45, 0.5, 0.95], ease: 'linear' }}
    />
  );
}

export function TerminalView({
  command,
  output,
  exitCode,
  duration,
  shellType,
  cwd,
  status,
}: {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
  shellType?: 'windows' | 'linux';
  cwd?: string;
  status?: string;
}) {
  const isError = exitCode !== undefined && exitCode !== 0;

  // Truncate output if it is too large to prevent React rendering lag
  const MAX_OUTPUT_LENGTH = 50000;
  const isOutputTruncated = output && output.length > MAX_OUTPUT_LENGTH;
  const displayOutput = isOutputTruncated
    ? output.substring(0, MAX_OUTPUT_LENGTH) + `\n\n... [Output truncated for performance. Total length: ${output.length} characters]`
    : output;

  const hasOutput = hasVisibleTerminalOutput(displayOutput);
  const looksLikePS = shellType === 'windows';

  const isFinished = status === 'done' || status === 'error' || exitCode !== undefined || duration !== undefined;
  const showExit = isFinished;

  // ── Windows/PowerShell Terminal Style ──
  if (looksLikePS) {
    const WIN = {
      bg: 'var(--color-text-primary)',
      tab: '#202020',
      tabText: 'var(--color-bg-subtle)',
      border: 'rgba(255,255,255,0.08)',
      divider: 'rgba(255,255,255,0.08)',
      textCmd: 'var(--color-bg-surface)',
      textOut: 'var(--color-bg-subtle)',
      textErr: '#ff8a8a',
      textDim: 'rgba(255,255,255,0.36)',
      textMeta: 'rgba(255,255,255,0.42)',
      accent: '#d19a3a',
    };
    const displayCwd = cwd || 'C:\\pathcantbefound';
    const tabTitle = displayCwd.length > 18 ? `${displayCwd.slice(0, 14)}...` : displayCwd;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: WIN.bg,
        color: WIN.textOut,
        fontFamily: monoStack,
      }}>
        <div style={{
          height: 42,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderBottom: `1px solid ${WIN.border}`,
          background: '#171717',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 30,
            maxWidth: 194,
            padding: '0 12px',
            borderRadius: 10,
            background: WIN.tab,
            color: WIN.tabText,
            overflow: 'hidden',
          }}>
            <Terminal size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: T.sans }}>
              {tabTitle}
            </span>
          </div>
          <button title="New tab" style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
            <Plus size={17} strokeWidth={1.6} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 26px', display: 'flex', flexDirection: 'column', background: WIN.bg }}>
          <div style={{ fontSize: 13, color: WIN.textOut, marginBottom: 22 }}>
            PowerShell 7.5.5
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: hasOutput ? 18 : 10 }}>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13, color: WIN.textCmd }}>
              PS {displayCwd}&gt;&nbsp;
            </span>
            <code style={{ fontSize: 13, color: WIN.accent, lineHeight: 1.55, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
              {command}
            </code>
          </div>
          {hasOutput ? (
            <TerminalAnsiOutput output={displayOutput} isError={isError} palette={WIN} />
          ) : (
            <pre style={{ margin: '0 0 8px', fontSize: 12.5, color: WIN.textDim, fontStyle: 'italic', fontFamily: monoStack }}>
              (no output)
            </pre>
          )}
          {showExit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingTop: 12, borderTop: `1px solid ${WIN.divider}` }}>
              {exitCode !== undefined && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontFamily: monoStack, letterSpacing: '0.03em', background: isError ? 'rgba(255,123,114,0.1)' : 'rgba(63,185,80,0.1)', border: `1px solid ${isError ? 'rgba(255,123,114,0.18)' : 'rgba(63,185,80,0.18)'}`, color: isError ? WIN.textErr : '#3fb950' }}>
                  {isError ? `exit ${exitCode}` : 'ok'}
                </span>
              )}
              {duration !== undefined && (
                <span style={{ fontSize: 11, color: WIN.textMeta, fontFamily: monoStack, marginLeft: 'auto' }}>
                  {formatDuration(duration)}
                </span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13, color: WIN.textCmd }}>
              PS {displayCwd}&gt;
            </span>
            <BlinkCursor />
          </div>
        </div>
      </div>
    );
  }

  // ── Linux Terminal Style (original) ──
  const user = 'ubuntu';
  const host = 'localhost';
  let path = cwd || '~';
  if (path !== '~') {
    path = translateWindowsPathToLinux(path);
  }

  return (
    <TerminalChrome title="Terminal" tint="#5af78e">
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10 }}>
          <PS1 user={user} host={host} path={path} />
          <code style={{ fontSize: 13, color: TERM.textCmd, lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
            {command}
          </code>
        </div>
        {hasOutput ? (
          <TerminalAnsiOutput output={displayOutput} isError={isError} palette={TERM} />
        ) : (
          <pre style={{ margin: '0 0 8px', fontSize: 12.5, color: TERM.textDim, fontStyle: 'italic', fontFamily: monoStack }}>
            (no output)
          </pre>
        )}
        {showExit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingTop: 12, borderTop: `1px solid ${TERM.divider}` }}>
            {exitCode !== undefined && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontFamily: monoStack, letterSpacing: '0.03em', background: isError ? TERM.errBg : TERM.okBg, border: `1px solid ${isError ? TERM.errBorder : TERM.okBorder}`, color: isError ? TERM.errText : TERM.okText }}>
                {isError ? `exit ${exitCode}` : 'ok'}
              </span>
            )}
            {duration !== undefined && (
              <span style={{ fontSize: 11, color: TERM.textDim, fontFamily: monoStack, marginLeft: 'auto' }}>
                {formatDuration(duration)}
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
          <PS1 user={user} host={host} path={path} />
          <BlinkCursor />
        </div>
      </div>
    </TerminalChrome>
  );
}
/* ============================================================
   SEARCH RESULT CARD
   ============================================================ */
function ResultCard({ title, url, snippet, description: initialDescription, domain, favicon: initialFavicon }: { title: string; url: string; snippet?: string; description?: string; domain: string; favicon?: string }) {
  const [description, setDescription] = useState(initialDescription);
  const [favicon, setFavicon] = useState(initialFavicon);
  const [displayTitle, setDisplayTitle] = useState(title || '');

  useEffect(() => {
    // If we're missing rich info, try to fetch it lazily
    const safeTitle = typeof title === 'string' ? title : '';
    const isTitleURLOrDomain = !safeTitle || safeTitle.startsWith('http') || (safeTitle.includes('.') && !safeTitle.includes(' '));
    if (!initialDescription || !initialFavicon || isTitleURLOrDomain) {
      const fetchMeta = async () => {
        try {
          const api = (window as any).electronAPI;
          if (!api?.system?.fetchMetadata) return;

          const meta = await api.system.fetchMetadata(url);
          if (meta) {
            if (!initialDescription && meta.description) setDescription(meta.description);
            if (!initialFavicon && meta.favicon) setFavicon(meta.favicon);
            if (meta.title) setDisplayTitle(meta.title);
          }
        } catch { /* ignore */ }
      };
      fetchMeta();
    }
  }, [url, initialDescription, initialFavicon, title]);

  const content = typeof (description || snippet) === 'string' ? (description || snippet) : JSON.stringify(description || snippet || '');
  const displayFavicon = favicon || getFaviconUrl(domain);
  const finalTitle = typeof displayTitle === 'string' ? (displayTitle.trim() || domain || url || 'Search Result') : 'Search Result';
  let displayDomain = domain || 'Unknown';
  if (displayDomain === 'Unknown' && typeof url === 'string') {
    try {
      displayDomain = new URL(url).hostname;
    } catch { /* ignore */ }
  }

  const safeUrl = typeof url === 'string' ? url : '';

  return (
    <motion.article
      onClick={() => window.open(safeUrl, '_blank', 'noopener,noreferrer')}
      role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && window.open(safeUrl, '_blank')}
      style={{
        padding: '18px 20px',
        background: T.surface,
        backgroundColor: T.surface,
        backgroundImage: 'none',
        border: `1px solid ${T.border}`, borderRadius: T.r12, cursor: 'pointer',
        color: T.text,
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)', position: 'relative', overflow: 'hidden',
        flexShrink: 0,
      }}
      whileHover={{ borderColor: '#b8b8b4', y: -1, background: T.surfaceRaised, backgroundColor: T.surfaceRaised, boxShadow: '0 4px 16px rgba(0,0,0,0.05)' }}
      transition={{ duration: 0.12 }}
    >
      {/* Domain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        {displayFavicon && (
          <img src={displayFavicon} alt="" width={13} height={13} style={{ borderRadius: 3, opacity: 0.7, flexShrink: 0 }}
            onError={e => e.currentTarget.style.display = 'none'} />
        )}
        <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: T.sans }}>
          {displayDomain}
        </span>
      </div>

      {/* Title */}
      <h3 style={{
        fontSize: 13.5, fontWeight: 600, color: T.text, margin: content ? '0 0 8px' : 0,
        lineHeight: 1.45, letterSpacing: '-0.015em', fontFamily: T.sans,
      }}>
        {finalTitle}
      </h3>

      {/* Snippet / Description */}
      {content && (
        <p style={{
          fontSize: 12.5, color: T.textSecondary, lineHeight: 1.7, margin: 0,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontFamily: T.sans,
        }}>
          {content}
        </p>
      )}
    </motion.article>
  );
}

/* ============================================================
   LIVE PREVIEW VIEW
   ============================================================ */
function extractLivePreviewData(tc: any) {
  const url = tc.args?.url || tc.data?.url || tc.output || '';
  return { url };
}

function LivePreviewView({ url }: { url: string }) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [iframeUrl, setIframeUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setIframeUrl(url);
  }, [url]);

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeUrl;
    }
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = currentUrl.trim();
    if (target && !/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    setIframeUrl(target);
    setCurrentUrl(target);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: T.bg }}>
      {/* Browser Address Bar / Header */}
      <div style={{
        padding: '8px 16px',
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0
      }}>
        {/* Nav Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            disabled
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textPlaceholder,
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            disabled
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textPlaceholder,
              cursor: 'not-allowed',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            onClick={handleReload}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: T.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
            className="hover:text-zinc-900 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>

        {/* Address Input */}
        <form onSubmit={handleNavigate} style={{ flex: 1, display: 'flex' }}>
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: T.r6,
            padding: '4px 12px',
            height: 28
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="3">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <input
              type="text"
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                color: T.text,
                fontFamily: T.sans,
                width: '100%'
              }}
            />
          </div>
        </form>

        {/* Open External */}
        <a
          href={iframeUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            color: T.textSecondary,
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none'
          }}
          className="hover:text-zinc-900 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Frame wrapper */}
      <div style={{ flex: 1, position: 'relative', background: 'var(--color-bg-surface)' }}>
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'var(--color-bg-surface)'
          }}
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      </div>
    </div>
  );
}

/* ============================================================
   WEB SEARCH VIEW
   ============================================================ */
function WebSearchView({ query, results = [], totalResults = 0 }: { query: string; results?: any[]; totalResults?: number }) {
  const safe = Array.isArray(results) ? results : [];
  const safeQuery = typeof query === 'string' ? query : JSON.stringify(query);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Query pill */}
      <div style={{ padding: '16px 24px', background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '12px 16px' }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
            Query
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 500, color: T.text, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5, fontFamily: T.sans }}>
            "{safeQuery}"
          </p>
        </div>
      </div>

      {safe.length === 0 ? (
        <EmptyState icon={IconSearch} title="No results" description="The search didn't return any matches for this query." />
      ) : (
        <>
          <SectionLabel right={`${totalResults}`}>Results</SectionLabel>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {safe.map((r, i) => <ResultCard key={`${r.url}-${i}`} {...r} />)}
          </div>
        </>
      )}
    </div>
  );
}

type McpRegistryConnector = {
  name: string;
  description?: string;
  status?: string;
  connectSnippet?: string;
};

function parseMcpRegistryConnectors(output: string): McpRegistryConnector[] {
  const text = String(output || '');
  const connectors: McpRegistryConnector[] = [];
  const sectionRegex = /^###\s+(.+?)\s*$([\s\S]*?)(?=^###\s+|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(text)) !== null) {
    const name = match[1]?.trim();
    const body = match[2] || '';
    if (!name) continue;
    const line = (label: string) => {
      const lineMatch = body.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*([^\\n]+)`, 'i'));
      return lineMatch?.[1]?.trim() || '';
    };
    const connect = body.match(/connect_mcp_server\([\s\S]*?\)/)?.[0] || line('To Connect');
    connectors.push({
      name,
      description: line('Description'),
      status: line('Status'),
      connectSnippet: connect.replace(/^Use\s+/i, '').trim(),
    });
  }
  return connectors;
}

function McpRegistryView({ keyword, connectors = [], totalResults = 0, output }: { keyword: string; connectors?: McpRegistryConnector[]; totalResults?: number; output?: string }) {
  const safe = Array.isArray(connectors) ? connectors : [];
  const copyText = output || safe.map(connector => `${connector.name}\n${connector.description || ''}\n${connector.connectSnippet || ''}`).join('\n\n');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '12px 16px' }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
            MCP Registry
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 500, color: T.text, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5, fontFamily: T.sans }}>
            {keyword ? `Searching connectors for "${keyword}"` : 'Searching available connectors'}
          </p>
        </div>
      </div>

      {safe.length === 0 ? (
        <EmptyState icon={IconSearch} title="No MCP connectors" description={output || "The registry didn't return a connector for this software."} />
      ) : (
        <>
          <SectionLabel right={`${totalResults || safe.length}`}>Connectors</SectionLabel>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {copyText && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><CopyBtn text={copyText} /></div>}
            {safe.map((connector, index) => (
              <div key={`${connector.name}-${index}`} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <p style={{ margin: 0, color: T.text, fontFamily: T.sans, fontSize: 13.5, fontWeight: 600 }}>
                    {connector.name}
                  </p>
                  {connector.status && (
                    <span style={{ color: T.green, border: '1px solid rgba(34,197,94,0.2)', borderRadius: 999, padding: '3px 8px', fontSize: 10.5, lineHeight: 1, fontFamily: T.sans }}>
                      {connector.status}
                    </span>
                  )}
                </div>
                {connector.description && <p style={{ margin: 0, color: T.textSecondary, fontFamily: T.sans, fontSize: 12.5, lineHeight: 1.5 }}>{connector.description}</p>}
                {connector.connectSnippet && (
                  <code style={{ display: 'block', marginTop: 10, color: T.text, background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.r8, padding: '9px 10px', fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {connector.connectSnippet}
                  </code>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   GENERIC TOOL VIEW
   ============================================================ */
function CollapsibleSection({
  icon: Icon, label, badge, defaultOpen = false, children,
}: {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: `1px solid ${T.borderSubtle}`, background: T.surface }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '16px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: T.r8, background: T.surfaceRaised,
            border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)',
          }}>
            <Icon size={13} color={T.textSecondary} strokeWidth={1.75} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.sans }}>{label}</span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: T.textMuted, background: T.surfaceRaised,
              border: `1px solid ${T.border}`, padding: '2px 8px', borderRadius: 20, fontFamily: T.mono,
            }}>
              {badge}
            </span>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.16 }}>
          <ChevronDown size={13} color={T.textMuted} strokeWidth={2} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', borderTop: `1px solid ${T.borderSubtle}`, background: T.bg }}
          >
            <div style={{ padding: '16px 24px 20px' }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MemoryView({ args, output, toolName }: { args?: any; output?: string; toolName?: string }) {
  // Try to parse JSON memories (from memory_consolidator)
  let memoriesList: any[] = [];
  let parsedJson: any = null;
  if (output) {
    try {
      const clean = output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed && Array.isArray(parsed.newMemories)) {
        memoriesList = parsed.newMemories;
        parsedJson = parsed;
      }
    } catch { /* Not JSON */ }
  }

  // Parse plain-text recall results (from recall_fact / memory_search)
  const plainBlocks: string[] = [];
  if (output && !parsedJson) {
    const noFoundPrefix = output.replace(/^Found matches:\s*/i, '').trim();
    const noMatch = output.trim().toLowerCase().startsWith('no ') || output.trim().toLowerCase().startsWith('no facts');
    if (!noMatch) {
      const parts = noFoundPrefix.split(/\n---\n|\n---\s*\n/);
      parts.forEach(p => { if (p.trim()) plainBlocks.push(p.trim()); });
    }
  }

  const hasArgs = args && Object.keys(args).length > 0;
  const query = args?.query || args?.fact || args?.content || args?.preference || args?.taskName || '';
  const tname = (toolName || '').toLowerCase();
  const opLabel = tname.includes('recall') ? 'Recall' : tname.includes('remember') || tname.includes('save') ? 'Save' : tname.includes('update') || tname.includes('profile') ? 'Update' : tname.includes('search') ? 'Search' : 'Consolidate';
  const opColor = opLabel === 'Recall' ? '#6366f1' : opLabel === 'Save' || opLabel === 'Consolidate' ? '#22c55e' : opLabel === 'Update' ? '#f59e0b' : '#3b82f6';
  const opBg = opLabel === 'Recall' ? 'rgba(99,102,241,0.1)' : opLabel === 'Save' || opLabel === 'Consolidate' ? 'rgba(34,197,94,0.1)' : opLabel === 'Update' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)';

  const noResults = output && !parsedJson && memoriesList.length === 0 && plainBlocks.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: VS.bg, color: VS.text }}>
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${VS.border}`, background: VS.bg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: opBg, border: `1px solid ${opColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Brain size={14} color={opColor} strokeWidth={2} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: VS.text, fontFamily: T.sans }}>Memory</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: opBg, color: opColor, fontFamily: T.sans, letterSpacing: '0.04em' }}>{opLabel}</span>
            </div>
            {query && <p style={{ fontSize: 11, color: VS.muted, margin: 0, fontFamily: T.mono, marginTop: 2 }}>"{String(query).slice(0, 60)}{String(query).length > 60 ? '…' : ''}"</p>}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 10, background: VS.bg }}>

        {/* Plain-text recall blocks (recall_fact / memory_search style) */}
        {plainBlocks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: VS.muted, textTransform: 'uppercase', margin: '4px 0 2px', fontFamily: T.sans, letterSpacing: '0.07em' }}>
              🔍 Matches Found ({plainBlocks.length})
            </p>
            {plainBlocks.map((block, i) => {
              // Detect which file/source it came from
              const srcMatch = block.match(/^\[(.*?)\]\s*\[(.*?)\]/);
              const src = srcMatch ? `${srcMatch[1]} › ${srcMatch[2]}` : '';
              const bodyText = srcMatch ? block.slice(srcMatch[0].length).trim() : block;
              // Pick color by source
              const isProfile = block.toLowerCase().includes('user profile');
              const cardColor = isProfile ? '#6366f1' : '#22c55e';
              const cardBg = isProfile ? 'rgba(99,102,241,0.07)' : 'rgba(34,197,94,0.07)';
              return (
                <div key={i} style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: CLAY.shadow }}>
                  {src && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: cardBg, color: cardColor, fontFamily: T.sans, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {src}
                      </span>
                    </div>
                  )}
                  <p style={{ margin: 0, color: VS.text, fontSize: 12.5, lineHeight: 1.6, fontFamily: T.sans, whiteSpace: 'pre-wrap' }}>
                    {bodyText.replace(/^\[[\w\s]+\]\s*\([\d\w\-T:.Z]+\)\s*/m, '').trim()}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* JSON structured memories (memory_consolidator style) */}
        {memoriesList.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: VS.muted, textTransform: 'uppercase', margin: '4px 0 2px', fontFamily: T.sans, letterSpacing: '0.07em' }}>
              💾 Processed Memories ({memoriesList.length})
            </p>
            {memoriesList.map((mem: any, index: number) => (
              <div key={index} style={{ background: CLAY.card, border: `1px solid ${VS.border}`, boxShadow: CLAY.shadow, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: mem.type === 'preference' ? 'rgba(99,102,241,0.1)' : mem.type === 'habit' ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)', color: mem.type === 'preference' ? '#6366f1' : mem.type === 'habit' ? '#f59e0b' : '#22c55e', textTransform: 'uppercase', fontFamily: T.sans }}>
                    {mem.type || 'fact'}
                  </span>
                  {mem.linkedFile && <span style={{ fontSize: 10.5, color: VS.muted, fontFamily: T.mono }}>📁 {mem.linkedFile}</span>}
                </div>
                <p style={{ margin: 0, color: VS.text, fontSize: 13, lineHeight: 1.5, fontFamily: T.sans }}>{mem.value || JSON.stringify(mem)}</p>
                {mem.category && <span style={{ fontSize: 10.5, color: VS.dim, fontFamily: T.sans }}>Category: {mem.category}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Query/args card */}
        {hasArgs && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 10, padding: '12px 14px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: VS.muted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>Parameters</p>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: T.mono, fontSize: 11.5, color: VS.text }}><code>{JSON.stringify(args, null, 2)}</code></pre>
          </div>
        )}

        {/* No results message */}
        {noResults && (
          <div style={{ background: CLAY.card, border: `1px solid ${VS.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: CLAY.shadow }}>
            <p style={{ fontSize: 12, color: VS.muted, margin: 0, fontStyle: 'italic', fontFamily: T.sans }}>{output}</p>
          </div>
        )}

        {!hasArgs && !output && (
          <p style={{ fontSize: 12.5, color: VS.muted, fontStyle: 'italic', textAlign: 'center', marginTop: 20, fontFamily: T.sans }}>
            No memories to display from this step.
          </p>
        )}
      </div>
    </div>
  );
}

function GenericView({ toolName, args, output }: { toolName: string; args?: any; output?: string }) {
  const argEntries = Object.entries(args || {});

  // Truncate output if it is too large to prevent React rendering lag
  const MAX_GENERIC_OUTPUT = 50000;
  const isOutputTruncated = output && output.length > MAX_GENERIC_OUTPUT;
  const displayOutput = isOutputTruncated
    ? output.substring(0, MAX_GENERIC_OUTPUT) + `\n\n... [Output truncated for performance. Total length: ${output.length} characters]`
    : output;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Subtitle bar */}
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          {toolName}
        </h3>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>Tool execution details</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: T.bg }}>
        {argEntries.length > 0 && (
          <CollapsibleSection icon={Braces} label="Arguments" badge={`${argEntries.length}`}>
            <pre style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 280, overflowY: 'auto',
            }}>
              <code>{JSON.stringify(args, null, 2)}</code>
            </pre>
          </CollapsibleSection>
        )}

        {output && (
          <CollapsibleSection icon={Terminal} label="Output" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <CopyBtn text={displayOutput || ''} />
            </div>
            <pre style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.85,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 360, overflowY: 'auto',
            }}>
              <code>{displayOutput}</code>
            </pre>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SKILL VIEW
   ============================================================ */
function SkillView({ skillName, name, path, content }: { skillName: string; name: string; path: string; content: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Subtitle bar */}
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: 0, letterSpacing: '-0.015em', fontFamily: T.sans }}>
            {name}
          </h3>
          <span style={{
            fontSize: 9.5, fontWeight: 700, color: T.green, background: T.greenFaint,
            border: `1px solid rgba(34,197,94,0.15)`, padding: '2px 8px', borderRadius: 20, fontFamily: T.sans
          }}>
            Skill Loaded
          </span>
        </div>
        {path && <p style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.mono, wordBreak: 'break-all', margin: 0 }}>{path}</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: T.bg, padding: '20px 24px 28px' }}>
        {content && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 10 }}>
              <CopyBtn text={content} />
            </div>
            <div style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: T.r10,
              overflow: 'hidden'
            }}>
              <MarkdownViewer content={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function extractSkillData(tc: any) {
  try {
    const skillName = tc.args?.name || tc.args?.skill || '';
    const skill = tc.data?.skill || null;
    return {
      skillName,
      name: skill?.name || skillName || 'Skill',
      path: skill?.path || '',
      content: skill?.content || tc.output || '',
    };
  } catch {
    return null;
  }
}

/* ============================================================
   DATA EXTRACTION
   ============================================================ */
export function extractWebSearchData(tc: any) {
  try {
    const query = tc.args?.query || '';
    const raw = tc.data?.results || tc.result?.data?.results || tc.result?.results;
    const results = Array.isArray(raw) ? raw : [];

    // Process results to include domain and ensure favicon fallback
    const processed = results.map(r => {
      let domain = r.domain || '';
      if (!domain && r.url) {
        try {
          domain = new URL(r.url).hostname;
        } catch { /* ignore */ }
      }
      return {
        ...r,
        domain,
        description: r.description || r.snippet || '',
      };
    });

    return { query, results: processed.slice(0, 50), totalResults: results.length };
  } catch { return null; }
}

function extractMcpRegistryData(tc: any) {
  try {
    const args = tc.args || tc.arguments || {};
    const data = tc.data || tc.result?.data || tc.result || {};
    const output = tc.output || tc.result?.output || tc.result?.error || tc.error || '';
    const keyword = String(args.keyword || args.query || data.keyword || data.query || '').trim();
    const rawConnectors = data.connectors || data.results || data.items;
    const connectors = Array.isArray(rawConnectors)
      ? rawConnectors.map((item: any) => ({
        name: String(item.name || item.id || item.title || 'Connector'),
        description: item.description ? String(item.description) : '',
        status: item.status ? String(item.status) : '',
        connectSnippet: item.command ? `connect_mcp_server({ name: "${item.name || item.id}", command: "${item.command}" })` : String(item.connectSnippet || item.connect || ''),
      }))
      : parseMcpRegistryConnectors(output);

    return {
      keyword,
      connectors,
      totalResults: connectors.length,
      output,
    };
  } catch { return null; }
}

export function extractNavisData(tc: any, progressEvents: any[] = []) {
  try {
    const screenshots: any[] = [];
    const screenshotPaths: string[] = [];
    const seen = new Set();
    const seenPaths = new Set<string>();

    const add = (b64: string, ts: any, seq: number, actionInfo?: any, filePath?: string) => {
      if (!b64 && !filePath) return;
      const clean = b64 ? (b64.startsWith('data:image') ? b64.substring(b64.indexOf(',') + 1) : b64) : '';
      // Deduplicate by base64 content if present, else by file path
      const key = clean || filePath || '';
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      screenshots.push({ base64: clean, screenshotPath: filePath, timestamp: ts, sequenceNumber: seq, action: actionInfo });
    };

    const addPath = (filePath: string) => {
      if (filePath && !seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        screenshotPaths.push(filePath);
      }
    };

    let lastAction: any = null;

    // 1. Process real-time progress events first (higher priority for live view)
    if (Array.isArray(progressEvents)) {
      progressEvents.forEach((e: any, i: number) => {
        if (e.type === 'action') {
          lastAction = e.action;
        } else if (e.type === 'screenshot') {
          const b64 = e.screenshot?.base64 || e.content || e.base64;
          const filePath = e.screenshotPath || e.screenshot?.screenshotPath;
          if (b64 || filePath) add(b64 || '', e.timestamp || Date.now(), i, lastAction, filePath);
          if (filePath) addPath(filePath);
        }
      });
    }

    // 2. Extract data source
    const dataSource = tc.data || tc.result?.data || tc.result || {};

    // 2. Process screenshot(s)
    let sData = dataSource.screenshot || dataSource.base64_image;

    // Handle Anthropic/OpenAI content block arrays
    if (Array.isArray(dataSource)) {
      for (const block of dataSource) {
        if (block.type === 'image_url' && block.image_url?.url) {
          sData = block.image_url.url;
          break;
        } else if (block.type === 'image' && block.source?.data) {
          sData = block.source.data;
          break;
        }
      }
    }

    if (Array.isArray(sData)) {
      sData.forEach((s: any, i: number) => {
        if (typeof s === 'string') add(s, Date.now(), i, lastAction);
        else if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i, s.action || lastAction, s.screenshotPath);
      });
    } else if (typeof sData === 'string') {
      add(sData, Date.now(), 0, lastAction);
    }

    // 3. Process historical screenshots
    if (Array.isArray(dataSource.screenshots)) {
      dataSource.screenshots.forEach((s: any, i: number) => {
        if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i, s.action || lastAction, s.screenshotPath);
        else if (typeof s === 'string') add(s, Date.now(), i, lastAction);
      });
    }

    if (typeof dataSource.base64Image === 'string') add(dataSource.base64Image, Date.now(), screenshots.length, lastAction);
    if (typeof dataSource.base64_image === 'string') add(dataSource.base64_image, Date.now(), screenshots.length, lastAction);

    // 4. Process persisted screenshotPaths (for reloading after page refresh)
    if (Array.isArray(dataSource.screenshotPaths)) {
      dataSource.screenshotPaths.forEach((p: string, i: number) => {
        if (!p) return;
        // Only add a placeholder if no existing screenshot entry covers this path
        const alreadyHave = screenshots.some(s => s.screenshotPath === p);
        if (!alreadyHave) {
          // Placeholder: no base64 yet — the async loader effect will fill it in
          add('', Date.now(), screenshots.length + i, lastAction, p);
        }
        addPath(p);
      });
    }

    // 5. Attach tool call action if no event action was found
    if (screenshots.length > 0) {
      const toolCallAction = tc.args?.coordinate || tc.args?.action ? {
        type: tc.args.action || tc.args.type || 'click',
        params: tc.args,
        description: tc.args.text || tc.args.query || ''
      } : null;

      if (toolCallAction) {
        screenshots.forEach((s) => {
          if (!s.action) {
            s.action = toolCallAction;
          }
        });
      }
    }

    // Ensure correct chronological order for video playback
    screenshots.sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
    const slicedScreenshots = screenshots.slice(-12);

    let navisReport = '';
    if (Array.isArray(progressEvents)) {
      for (let i = progressEvents.length - 1; i >= 0; i--) {
        const e = progressEvents[i];
        if (e.data?.navisReport) {
          navisReport = e.data.navisReport;
          break;
        }
      }
    }

    if (!navisReport) {
      const output = tc.output || tc.result?.output || '';
      const marker = '# Navis Execution Report';
      const idx = output.indexOf(marker);
      if (idx !== -1) {
        navisReport = output.substring(idx);
      }
    }

    return { screenshots: slicedScreenshots, screenshotPaths, url: tc.args?.url, action: tc.args?.action, navisReport };
  } catch { return null; }
}

function extractTerminalData(tc: any) {
  let command = tc.args?.command || tc.args?.CommandLine || '';
  if (typeof command !== 'string') command = JSON.stringify(command);
  const toolName = (tc.toolName || '').toLowerCase();
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};

  const requestedShell = String(args.shellType || data.shellType || data.shell || '').toLowerCase();
  const target = String(args.target || data.target || tc.result?.target || tc.result?.data?.target || '').toLowerCase();

  const normalizedCmd = command.trim().toLowerCase();
  const hasLinuxIndicators = normalizedCmd.includes('/mnt/') ||
    normalizedCmd.includes('/home/') ||
    normalizedCmd.includes('/tmp/') ||
    /\bsource\b/.test(normalizedCmd) ||
    /\bpython3\b/.test(normalizedCmd) ||
    /\b(apt-get|apt)\b/.test(normalizedCmd) ||
    target === 'vm';

  const isExplicitLinux = toolName.includes('linux') ||
    requestedShell.includes('bash') ||
    requestedShell.includes('sh') ||
    target === 'vm' ||
    hasLinuxIndicators;

  const isWindows = !isExplicitLinux && (
    toolName.includes('pwsh') ||
    toolName.includes('powershell') ||
    command.includes('powershell.exe') ||
    command.includes('pwsh') ||
    command.startsWith('powershell') ||
    requestedShell.includes('powershell') ||
    requestedShell.includes('pwsh') ||
    requestedShell === 'cmd'
  );

  return {
    command,
    output: tc.output || tc.result?.output || tc.result?.error || tc.error || '',
    exitCode: tc.data?.exitCode ?? tc.result?.data?.exitCode ?? tc.result?.exitCode,
    duration: tc.duration || tc.result?.duration,
    shellType: isWindows ? 'windows' : 'linux',
    cwd: tc.data?.cwd || tc.result?.data?.cwd || tc.args?.cwd || '',
    status: tc.status
  };
}

function extractFileSystemData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  return {
    toolName: tc.toolName,
    path: args.path || data.path || args.TargetFile || args.SearchPath || args.DirectoryPath || args.AbsolutePath || args.filePath || args.file || args.target_file || '',
    args,
    data,
    output: tc.output || tc.result?.output || tc.result?.error || tc.error || ''
  };
}

function extractGenericData(tc: any) {
  const args = tc.args || tc.arguments || {};
  return { toolName: tc.toolName, args, output: tc.output || tc.result?.output || tc.result?.error || tc.error || '' };
}

function extractTodoWriteData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const rawTasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(args.tasks) ? args.tasks : [];
  return {
    tasks: rawTasks.map((task: any) => ({
      description: String(task.description || task.content || task.title || ''),
      status: String(task.status || 'pending'),
    })).filter((task: any) => task.description),
    path: data.path || args.planPath || '',
    output: tc.output || tc.result?.output || '',
  };
}

function extractImageAnalysisData(tc: any) {
  const args = tc.args || tc.arguments || {};
  const data = tc.data || tc.result?.data || {};
  const rawImages = Array.isArray(data.images) ? data.images : [];
  const images = rawImages
    .filter((img: any) => img?.fileName && img?.dataUrl)
    .map((img: any) => ({ fileName: String(img.fileName), dataUrl: String(img.dataUrl) }));

  return {
    question: args.question || '',
    output: tc.output || tc.result?.output || '',
    imageCount: data.imageCount || images.length || (Array.isArray(args.images) ? args.images.length : args.imagePath ? 1 : undefined),
    images,
  };
}

function FileSystemView({ toolName, path, args, output }: { toolName: string; path: string; args: any; output: string }) {
  const argEntries = Object.entries(args || {});

  // Truncate output if it is too large to prevent React rendering lag
  const MAX_FS_OUTPUT = 50000;
  const isOutputTruncated = output && output.length > MAX_FS_OUTPUT;
  const displayOutput = isOutputTruncated
    ? output.substring(0, MAX_FS_OUTPUT) + `\n\n... [Output truncated for performance. Total length: ${output.length} characters]`
    : output;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          {toolName}
        </h3>
        {path && <p style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.mono, wordBreak: 'break-all', margin: 0 }}>{path}</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: T.bg }}>
        {argEntries.length > 0 && (
          <CollapsibleSection icon={Braces} label="Arguments" badge={`${argEntries.length}`}>
            <pre style={{ margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8, background: T.inkBg, color: T.inkText, padding: '18px 20px', borderRadius: T.r10, border: `1px solid ${T.inkBorder}`, maxHeight: 280, overflowY: 'auto' }}>
              <code>{JSON.stringify(args, null, 2)}</code>
            </pre>
          </CollapsibleSection>
        )}

        {output && (
          <div style={{ padding: '20px 24px 28px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 10 }}>
              <CopyBtn text={displayOutput} />
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, overflow: 'hidden' }}>
              <MarkdownViewer content={displayOutput} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   FILE EDITOR VIEW — IDE-styled code editor showing additions
   ============================================================ */
const EDITOR_COLORS = {
  bg: '#121214',
  gutterBg: '#18181b',
  gutterText: 'var(--color-text-secondary)',
  border: '#27272a',
  text: '#e2e8f0',
  keyword: '#e879f9', // pink/magenta
  string: '#34d399', // green
  number: '#60a5fa', // blue
  comment: '#a1a1aa', // grey
};

const detectLanguage = (ext: string): string => {
  const langMap: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css',
    json: 'json', sql: 'sql', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    txt: 'text'
  };
  return langMap[ext.toLowerCase()] || 'text';
};

const syntaxHighlightLine = (line: string, ext: string) => {
  const colors = EDITOR_COLORS;

  // Comment detection
  const commentMatch = line.match(/^(\s*)(#|\/\/|\/\*|<!--)(.*)/);
  if (commentMatch) {
    return <span style={{ color: colors.comment }}>{line}</span>;
  }

  // Regex patterns
  const stringPattern = /(['"`])(.*?)\1/g;
  const keywordPattern = /\b(if|else|for|while|function|def|class|return|const|let|var|import|export|from|async|await|try|catch|throw|new|this|true|false|null|undefined|and|or|not|in|is|lambda|def|self|super|pass|break|continue|interface|type|public|private|protected)\b/g;
  const numberPattern = /\b(\d+\.?\d*)\b/g;

  const stringMatches = Array.from(line.matchAll(stringPattern));
  const keywordMatches = Array.from(line.matchAll(keywordPattern));
  const numberMatches = Array.from(line.matchAll(numberPattern));

  const allMatches = [
    ...stringMatches.map(m => ({ type: 'string', index: m.index!, value: m[0] })),
    ...keywordMatches.map(m => ({ type: 'keyword', index: m.index!, value: m[0] })),
    ...numberMatches.map(m => ({ type: 'number', index: m.index!, value: m[0] })),
  ].sort((a, b) => a.index - b.index);

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  allMatches.forEach((match, idx) => {
    if (match.index < lastIndex) return;

    if (match.index > lastIndex) {
      elements.push(<span key={`txt-${idx}`} style={{ color: colors.text }}>{line.slice(lastIndex, match.index)}</span>);
    }
    const color = colors[match.type as keyof typeof colors] || colors.text;
    elements.push(<span key={`tok-${idx}`} style={{ color }}>{match.value}</span>);
    lastIndex = match.index + match.value.length;
  });

  if (lastIndex < line.length) {
    elements.push(<span key="tail" style={{ color: colors.text }}>{line.slice(lastIndex)}</span>);
  }

  return <>{elements.length > 0 ? elements : <span style={{ color: colors.text }}>{line}</span>}</>;
};

interface LineProps {
  type: 'add' | 'del' | 'normal';
  content: string;
  lineNumber?: string | number;
  ext: string;
}

const CodeLine = ({ type, content, lineNumber, ext }: LineProps) => {
  let lineBg = 'transparent';
  let textColor = EDITOR_COLORS.text;
  let indicator = ' ';
  let indicatorColor = EDITOR_COLORS.gutterText;

  if (type === 'add') {
    lineBg = 'rgba(34, 197, 94, 0.08)'; // subtle green bg
    textColor = '#4ade80'; // green text
    indicator = '+';
    indicatorColor = '#4ade80';
  } else if (type === 'del') {
    lineBg = 'rgba(239, 68, 68, 0.08)'; // subtle red bg
    textColor = '#f87171'; // red text
    indicator = '-';
    indicatorColor = '#f87171';
  }

  return (
    <div style={{
      display: 'flex',
      backgroundColor: lineBg,
      fontFamily: T.mono,
      fontSize: 12,
      lineHeight: '20px',
      minWidth: 'fit-content',
    }}>
      {/* Line Gutter */}
      <div style={{
        width: 48,
        flexShrink: 0,
        backgroundColor: EDITOR_COLORS.gutterBg,
        color: EDITOR_COLORS.gutterText,
        textAlign: 'right',
        paddingRight: 8,
        userSelect: 'none',
        borderRight: `1px solid ${EDITOR_COLORS.border}`,
      }}>
        {lineNumber}
      </div>

      {/* Indicator (+ or -) */}
      <div style={{
        width: 20,
        flexShrink: 0,
        textAlign: 'center',
        color: indicatorColor,
        fontWeight: 'bold',
        userSelect: 'none',
      }}>
        {indicator}
      </div>

      {/* Code Text */}
      <pre style={{
        margin: 0,
        paddingLeft: 4,
        paddingRight: 16,
        whiteSpace: 'pre',
        color: textColor,
        overflow: 'visible',
      }}>
        {type === 'normal' ? syntaxHighlightLine(content, ext) : content}
      </pre>
    </div>
  );
};

function parseFileEditItems(args: any, defaultPath: string = ''): Array<{
  filePath: string;
  fileName: string;
  codeLines: Array<{ text: string; type: 'added' | 'removed' | 'normal' }>;
  addedCount: number;
  removedCount: number;
}> {
  if (!args) return [];
  const rawList = args.files || args.items || args.targets || (Array.isArray(args.edits) && args.edits[0]?.path ? args.edits : null);

  const items = Array.isArray(rawList) && rawList.length > 0 ? rawList : [args];

  return items.map((item: any) => {
    const filePathRaw = item?.path || item?.filePath || item?.TargetFile || item?.file || item?.targetFile || defaultPath || 'unknown_file';
    const filePath = typeof filePathRaw === 'string' ? filePathRaw : String(filePathRaw);
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    let codeLines: Array<{ text: string; type: 'added' | 'removed' | 'normal' }> = [];

    const findStr = item?.find || item?.TargetContent || item?.oldString || item?.old_string || item?.search || item?.oldText || '';
    const replaceStr = item?.replace || item?.ReplacementContent || item?.newString || item?.new_string || item?.insert || item?.newText || '';
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
    } else if (findStr || replaceStr) {
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
    } else if (item?.content || item?.CodeContent || item?.text || item?.body) {
      let content = item?.content || item?.CodeContent || item?.text || item?.body || '';
      const lines = typeof content === 'string' ? content.split('\n') : [];
      codeLines = lines.map(line => ({ text: line, type: 'added' as const }));
    }

    if (codeLines.length === 0) {
      codeLines = [{ text: '// File edit operation', type: 'normal' }];
    }

    let addedCount = 0;
    let removedCount = 0;
    codeLines.forEach(l => {
      if (l.type === 'added') addedCount++;
      if (l.type === 'removed') removedCount++;
    });

    return { filePath, fileName, codeLines, addedCount, removedCount };
  });
}

function SidePanelMultiFileDiffView({ args, output }: { args: any; output?: string }) {
  const parsedFiles = useMemo(() => parseFileEditItems(args), [args]);
  const [activeFileIndex, setActiveFileIndex] = useState<number | null>(parsedFiles.length > 1 ? null : 0);

  const filesToDisplay = activeFileIndex !== null && parsedFiles[activeFileIndex]
    ? [parsedFiles[activeFileIndex]]
    : parsedFiles;

  if (parsedFiles.length === 0) {
    return (
      <div style={{ padding: 16, background: T.bg, color: T.text, fontFamily: T.mono, fontSize: 12 }}>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{output || 'No diff available'}</pre>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: T.bg }}>
      {/* Title Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: T.surface,
          borderBottom: `1px solid ${T.border}`,
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
          <span style={{ fontSize: 12, color: T.text, marginLeft: 8, fontFamily: T.mono, fontWeight: 600 }}>
            {parsedFiles.length > 1 ? `${parsedFiles.length} Files Edited` : parsedFiles[0]?.fileName}
          </span>
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.sans, textTransform: 'uppercase', fontWeight: 600 }}>
          MULTI-FILE EDIT ({parsedFiles.length})
        </div>
      </div>

      {/* Tabs Filter Bar */}
      {parsedFiles.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            background: T.surface,
            borderBottom: `1px solid ${T.border}`,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          <button
            onClick={() => setActiveFileIndex(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 6,
              background: activeFileIndex === null ? T.surfaceRaised : 'transparent',
              border: activeFileIndex === null ? `1px solid ${T.border}` : `1px solid ${T.borderSubtle}`,
              color: activeFileIndex === null ? T.text : T.textMuted,
              fontSize: 11,
              fontFamily: T.mono,
              fontWeight: activeFileIndex === null ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            All Files ({parsedFiles.length})
          </button>
          {parsedFiles.map((f, idx) => {
            const isActive = activeFileIndex === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveFileIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: isActive ? T.surfaceRaised : 'transparent',
                  border: isActive ? `1px solid ${T.border}` : `1px solid ${T.borderSubtle}`,
                  color: isActive ? T.text : T.textMuted,
                  fontSize: 11,
                  fontFamily: T.mono,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: isActive ? T.green : T.textMuted }}>⚡</span>
                <span>{f.fileName}</span>
                {(f.addedCount > 0 || f.removedCount > 0) && (
                  <span style={{ display: 'flex', gap: 3, fontSize: 10 }}>
                    {f.addedCount > 0 && <span style={{ color: T.green }}>+{f.addedCount}</span>}
                    {f.removedCount > 0 && <span style={{ color: T.red }}>-{f.removedCount}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Diff Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', fontFamily: T.mono, fontSize: 12, color: T.text }}>
        {filesToDisplay.map((file, fileIdx) => (
          <div
            key={fileIdx}
            style={{
              marginBottom: filesToDisplay.length > 1 && fileIdx < filesToDisplay.length - 1 ? 16 : 0,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              overflow: 'hidden',
              background: T.surface,
            }}
          >
            {/* File Section Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 14px',
                background: T.surfaceRaised,
                borderBottom: `1px solid ${T.borderSubtle}`,
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <span style={{ color: T.green }}>⚡</span>
                <span style={{ fontWeight: 600, color: T.text, fontSize: 12 }}>{file.fileName}</span>
                <span style={{ color: T.textMuted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.filePath}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                {file.addedCount > 0 && (
                  <span style={{ color: T.green, background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.25)', padding: '2px 6px', borderRadius: 4 }}>
                    +{file.addedCount}
                  </span>
                )}
                {file.removedCount > 0 && (
                  <span style={{ color: T.red, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.25)', padding: '2px 6px', borderRadius: 4 }}>
                    -{file.removedCount}
                  </span>
                )}
              </div>
            </div>

            {/* Code Line Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', lineHeight: '1.6' }}>
                <tbody>
                  {file.codeLines.map((line, idx) => {
                    const isAdded = line.type === 'added';
                    const isRemoved = line.type === 'removed';
                    const rowBg = isAdded 
                      ? 'rgba(34, 197, 94, 0.12)' 
                      : isRemoved 
                        ? 'rgba(239, 68, 68, 0.12)' 
                        : 'transparent';
                    
                    const textColor = isAdded 
                      ? T.green 
                      : isRemoved 
                        ? T.red 
                        : T.textSecondary;

                    const prefix = isAdded ? '+' : isRemoved ? '-' : ' ';

                    return (
                      <tr key={idx} style={{ background: rowBg }}>
                        <td
                          style={{
                            width: 40,
                            textAlign: 'right',
                            paddingRight: 10,
                            color: T.textMuted,
                            userSelect: 'none',
                            borderRight: `1px solid ${T.borderSubtle}`,
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
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileEditorView({ toolName, path, args, output, data }: { toolName: string; path: string; args: any; output: string; data?: any }) {
  const name = (toolName || '').toLowerCase();
  const rawFileList = args?.files || args?.items || data?.files || data?.items;

  if (name === 'multi_file_edit' || name === 'multi_replace_file_content' || (Array.isArray(rawFileList) && rawFileList.length > 0)) {
    return <SidePanelMultiFileDiffView args={args || data || {}} output={output} />;
  }

  const ext = path.split(/[/\\]/).pop()?.split('.').pop() || 'text';
  const { isWrite, isMulti, chunks, oldContent, newContent, isRead, hasRenderableContent } = useMemo(() => {
    const name = (toolName || '').toLowerCase();

    let oldContent = '';
    let newContent = '';
    let isWrite = false;
    let isMulti = false;
    let chunks: any[] = [];
    let isRead = false;

    if (name.includes('write')) {
      isWrite = true;
      newContent = args?.CodeContent || args?.code || args?.content || args?.text || data?.content || '';
    } else if (name === 'read' || name === 'read_file' || name === 'view_file') {
      isRead = true;
      newContent = output || '';
    } else {
      if (args?.ReplacementChunks && Array.isArray(args.ReplacementChunks)) {
        isMulti = true;
        chunks = args.ReplacementChunks.map((chunk: any) => ({
          target: chunk.TargetContent || chunk.target || '',
          replacement: chunk.ReplacementContent || chunk.replacement || '',
          startLine: chunk.StartLine,
          endLine: chunk.EndLine,
        }));
      } else {
        oldContent =
          args?.TargetContent ||
          args?.target ||
          args?.oldString ||
          args?.old_string ||
          args?.oldText ||
          args?.old_text ||
          args?.search ||
          args?.find ||
          args?.from ||
          args?.original ||
          args?.before ||
          data?.oldString ||
          data?.old_string ||
          '';
        newContent =
          args?.ReplacementContent ||
          args?.replacement ||
          args?.newString ||
          args?.new_string ||
          args?.newText ||
          args?.new_text ||
          args?.replace ||
          args?.with ||
          args?.to ||
          args?.updated ||
          args?.after ||
          data?.newString ||
          data?.new_string ||
          '';
      }
    }

    return {
      isWrite,
      isMulti,
      chunks,
      oldContent,
      newContent,
      isRead,
      hasRenderableContent: isMulti ? chunks.length > 0 : Boolean(oldContent || newContent),
    };
  }, [toolName, args, output, data]);

  // Helper to render diff lines for a target and replacement
  const renderDiffLines = (oldText: string, newText: string, startLine = 1) => {
    const MAX_LINES_TO_RENDER = 1000;

    if (isWrite || isRead) {
      const lines = newText.split('\n');
      const truncated = lines.length > MAX_LINES_TO_RENDER;
      const linesToRender = truncated ? lines.slice(0, MAX_LINES_TO_RENDER) : lines;

      const elements = linesToRender.map((line, idx) => (
        <CodeLine
          key={idx}
          type={isRead ? 'normal' : 'add'}
          content={line}
          lineNumber={startLine + idx}
          ext={ext}
        />
      ));

      if (truncated) {
        elements.push(
          <div key="trunc-msg" style={{ padding: '8px 16px', color: '#71717a', fontStyle: 'italic', fontFamily: T.mono, fontSize: 12 }}>
            ... [Remaining {lines.length - MAX_LINES_TO_RENDER} lines truncated for performance]
          </div>
        );
      }
      return elements;
    }

    // Compute diff
    const changes = diffLines(oldText, newText);
    const lineElements: React.ReactNode[] = [];
    let oldLine = startLine;
    let newLine = startLine;
    let linesCount = 0;
    let wasTruncated = false;

    for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
      if (linesCount >= MAX_LINES_TO_RENDER) {
        wasTruncated = true;
        break;
      }
      const change = changes[changeIdx];
      // Split the text while keeping trailing spaces/newlines
      const lines = change.value.replace(/\n$/, '').split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        if (linesCount >= MAX_LINES_TO_RENDER) {
          wasTruncated = true;
          break;
        }
        linesCount++;
        const line = lines[lineIdx];
        const key = `${changeIdx}-${lineIdx}`;
        if (change.added) {
          lineElements.push(
            <CodeLine
              key={key}
              type="add"
              content={line}
              lineNumber={newLine++}
              ext={ext}
            />
          );
        } else if (change.removed) {
          lineElements.push(
            <CodeLine
              key={key}
              type="del"
              content={line}
              lineNumber={oldLine++}
              ext={ext}
            />
          );
        } else {
          lineElements.push(
            <CodeLine
              key={key}
              type="normal"
              content={line}
              lineNumber={newLine++}
              ext={ext}
            />
          );
          oldLine++;
        }
      }
    }

    if (wasTruncated) {
      lineElements.push(
        <div key="trunc-msg" style={{ padding: '8px 16px', color: '#71717a', fontStyle: 'italic', fontFamily: T.mono, fontSize: 12 }}>
          ... [Remaining lines truncated for performance]
        </div>
      );
    }

    return lineElements;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Title bar */}
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: 0, letterSpacing: '-0.015em', fontFamily: T.sans }}>
            {toolName}
          </h3>
          <span style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: isWrite ? T.green : isRead ? T.blue : T.textSecondary,
            background: isWrite ? T.greenFaint : isRead ? T.blueFaint : T.surfaceRaised,
            border: `1px solid ${isWrite ? 'rgba(34,197,94,0.15)' : isRead ? 'rgba(59,130,246,0.15)' : T.border}`,
            padding: '2px 8px',
            borderRadius: 20,
            fontFamily: T.sans
          }}>
            {isWrite ? 'Write Operation' : isRead ? 'Read Operation' : 'Edit Operation'}
          </span>
        </div>
        {path && <p style={{ fontSize: 11.5, color: T.textSecondary, fontFamily: T.mono, wordBreak: 'break-all', margin: 0 }}>{path}</p>}
      </div>

      {/* Editor Body */}
      <div style={{ flex: 1, overflowY: 'auto', background: EDITOR_COLORS.bg, padding: 16 }}>
        <div style={{
          border: `1px solid ${EDITOR_COLORS.border}`,
          borderRadius: T.r8,
          overflow: 'hidden',
          backgroundColor: EDITOR_COLORS.bg,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Editor Header / Tab bar */}
          <div style={{
            height: 36,
            backgroundColor: EDITOR_COLORS.gutterBg,
            borderBottom: `1px solid ${EDITOR_COLORS.border}`,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 16,
            justifyContent: 'space-between',
            userSelect: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Colored Dots */}
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ef4444' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#fbbf24' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#22c55e' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: T.mono, marginLeft: 12 }}>
                {path.split(/[/\\]/).pop() || 'Untitled'}
              </span>
            </div>
            {/* Copy button */}
            <div style={{ display: 'flex', gap: 8 }}>
              <CopyBtn text={isWrite ? newContent : isMulti ? chunks.map(c => c.replacement).join('\n') : newContent} dark />
            </div>
          </div>

          {/* Editor Code Area */}
          <div style={{
            overflowX: 'auto',
            paddingTop: 8,
            paddingBottom: 8,
            backgroundColor: EDITOR_COLORS.bg,
          }}>
            {!hasRenderableContent ? (
              <div style={{ padding: 16 }}>
                <div style={{
                  border: `1px solid ${EDITOR_COLORS.border}`,
                  borderRadius: T.r8,
                  padding: 14,
                  background: '#18181b',
                  color: 'var(--color-border)',
                  fontFamily: T.mono,
                  fontSize: 12,
                  lineHeight: 1.7,
                }}>
                  <div style={{ color: 'var(--color-text-tertiary)', marginBottom: 10, fontFamily: T.sans, fontSize: 12 }}>
                    This edit completed, but no before/after diff was included in the tool arguments.
                  </div>
                  {output && (
                    <pre style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{output}</pre>
                  )}
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text-tertiary)' }}>
                    {JSON.stringify(args || {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : isMulti ? (
              chunks.map((chunk, idx) => (
                <div key={idx} style={{ marginBottom: idx < chunks.length - 1 ? 16 : 0 }}>
                  <div style={{
                    backgroundColor: '#18181b',
                    color: 'var(--color-text-tertiary)',
                    padding: '4px 16px',
                    fontSize: 10,
                    fontWeight: 'bold',
                    fontFamily: T.mono,
                    borderTop: idx > 0 ? `1px dashed ${EDITOR_COLORS.border}` : 'none',
                    borderBottom: `1px solid ${EDITOR_COLORS.border}`,
                  }}>
                    @@ Chunk {idx + 1} (Line {chunk.startLine || '?'} to {chunk.endLine || '?'}) @@
                  </div>
                  {renderDiffLines(chunk.target, chunk.replacement, chunk.startLine || 1)}
                </div>
              ))
            ) : (
              renderDiffLines(oldContent, newContent, 1)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TodoWriteView({ tasks, path, output }: { tasks: Array<{ description: string; status: string }>; path?: string; output?: string }) {
  const statusColor = (status: string) => status === 'completed' ? T.green : status === 'in_progress' ? T.blue : T.textMuted;
  const statusMark = (status: string) => status === 'completed' ? '✓' : status === 'in_progress' ? '•' : '○';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Todo Write
        </h3>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>
          {tasks.length} tracked tasks
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: T.bg, padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {path && <code style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.mono, wordBreak: 'break-all', marginBottom: 4 }}>{path}</code>}
        {tasks.map((task, index) => (
          <div key={`${task.description}-${index}`} style={{ display: 'flex', gap: 10, padding: '11px 12px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10 }}>
            <span style={{ color: statusColor(task.status), fontWeight: 700, width: 18 }}>{statusMark(task.status)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, color: T.text, lineHeight: 1.45 }}>{task.description}</p>
              <p style={{ margin: '4px 0 0', fontSize: 10.5, color: statusColor(task.status), textTransform: 'uppercase', fontWeight: 700 }}>{task.status.replace(/_/g, ' ')}</p>
            </div>
          </div>
        ))}
        {output && <p style={{ margin: 0, color: T.textMuted, fontSize: 12 }}>{output}</p>}
      </div>
    </div>
  );
}

function ImageAnalysisView({
  question,
  output,
  imageCount,
  images = [],
}: {
  question?: string;
  output?: string;
  imageCount?: number;
  images?: { fileName: string; dataUrl: string }[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Image Analysis
        </h3>
        {imageCount !== undefined && (
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>
            {imageCount} image{imageCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: T.bg, padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {question && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: T.text }}>{question}</p>
          </div>
        )}
        {images.map((img, index) => (
          <div key={`${img.fileName}-${index}`} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.textSecondary, fontFamily: T.mono }}>
              {img.fileName}
            </div>
            <img src={img.dataUrl} alt={img.fileName} style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>
        ))}
        {output && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, overflow: 'hidden' }}>
            <MarkdownViewer content={output} />
          </div>
        )}
      </div>
    </div>
  );
}

type FilePaneItem = {
  path: string;
  name: string;
  kind: 'folder' | 'file';
  depth: number;
};

function basenameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function extensionColor(name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['ts', 'tsx'].includes(ext)) return '#7dd3fc';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return '#facc15';
  if (['json'].includes(ext)) return '#f59e0b';
  if (['md', 'mdx'].includes(ext)) return '#4ade80';
  if (['css', 'scss', 'sass'].includes(ext)) return '#60a5fa';
  return '#8a8a8a';
}

function getFileIconifyVisual(name: string) {
  const lower = name.toLowerCase();
  const ext = lower.startsWith('.') && !lower.slice(1).includes('.')
    ? lower.slice(1)
    : lower.split('.').pop() || '';

  const exact: Record<string, string> = {
    'package.json': 'npm',
    'package-lock.json': 'npm',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'tsconfig.json': 'tsconfig',
    'jsconfig.json': 'jsconfig',
    'next.config.ts': 'next',
    'next.config.js': 'next',
    'next.config.mjs': 'next',
    'vite.config.ts': 'vite',
    'vite.config.js': 'vite',
    'tailwind.config.ts': 'tailwind',
    'tailwind.config.js': 'tailwind',
    'eslint.config.js': 'eslint',
    'eslint.config.mjs': 'eslint',
    '.eslintrc': 'eslint',
    '.eslintrc.js': 'eslint',
    '.prettierrc': 'prettier',
    '.gitignore': 'git',
    '.gitmodules': 'git',
    '.npmrc': 'npm',
    'readme.md': 'readme',
    'license': 'license',
    'license.txt': 'license',
  };

  const byExt: Record<string, string> = {
    env: 'dotenv',
    gitignore: 'git',
    log: 'log',
    ts: 'typescript',
    tsx: 'reactts',
    js: 'javascript',
    jsx: 'reactjs',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'sass',
    sass: 'sass',
    html: 'html',
    md: 'markdown',
    mdx: 'mdx',
    py: 'python',
    ps1: 'powershell',
    bat: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'database',
    svg: 'svg',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    webp: 'image',
    bmp: 'image',
    pdf: 'pdf',
    lock: 'lock',
    npmrc: 'npm',
  };

  const icon = lower === '.env' || lower.startsWith('.env.')
    ? 'dotenv'
    : exact[lower] || byExt[ext] || 'default-file';

  return {
    iconUrl: `https://api.iconify.design/vscode-icons:file-type-${icon}.svg`,
    color: extensionColor(name),
  };
}

function buildFilePaneItems(files: string[], filter: string): FilePaneItem[] {
  const q = filter.trim().toLowerCase();
  const folderSet = new Set<string>();
  const filteredFiles = files
    .filter(file => !q || file.toLowerCase().includes(q))
    .slice(0, 400);

  for (const file of filteredFiles) {
    const parts = file.replace(/\\/g, '/').split('/');
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
  }

  const folders = Array.from(folderSet)
    .map(path => ({
      path,
      name: basenameFromPath(path),
      kind: 'folder' as const,
      depth: Math.max(0, path.split('/').length - 1),
    }));

  const fileItems = filteredFiles.map(path => ({
    path,
    name: basenameFromPath(path),
    kind: 'file' as const,
    depth: Math.max(0, path.replace(/\\/g, '/').split('/').length - 1),
  }));

  return [...folders, ...fileItems].sort((a, b) => {
    const aParent = a.path.split('/').slice(0, -1).join('/');
    const bParent = b.path.split('/').slice(0, -1).join('/');
    if (aParent !== bParent) return aParent.localeCompare(bParent);
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function FileNavigatorPane({
  projectPath,
  files,
  loaded,
  selectedPath,
  onSelectFile,
}: {
  projectPath: string;
  files: string[];
  loaded: boolean;
  selectedPath?: string;
  onSelectFile: (filePath: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const items = useMemo(() => buildFilePaneItems(files, filter), [files, filter]);

  return (
    <aside style={{
      width: 290,
      flexShrink: 0,
      borderLeft: '1px solid #252525',
      background: '#151515',
      color: 'var(--color-bg-subtle)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      fontFamily: T.sans,
    }}>
      <div style={{ padding: 12, borderBottom: '1px solid #252525', flexShrink: 0 }}>
        <div style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderRadius: 10,
          background: '#202020',
          border: '1px solid #303030',
          color: 'var(--color-text-tertiary)',
          padding: '0 10px',
        }}>
          <Search size={15} strokeWidth={1.8} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter files..."
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-bg-subtle)',
              fontSize: 13,
              fontFamily: T.sans,
            }}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: '8px 6px 16px', flex: 1 }}>
        {!loaded ? (
          <div style={{ padding: 16, color: '#777', fontSize: 12 }}>Loading files...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 16, color: '#777', fontSize: 12 }}>No files found.</div>
        ) : items.map(item => {
          const active = item.kind === 'file' && selectedPath === item.path;
          const visual = item.kind === 'file' ? getFileIconifyVisual(item.name) : null;
          return (
            <button
              key={`${item.kind}:${item.path}`}
              type="button"
              disabled={item.kind === 'folder'}
              onClick={() => item.kind === 'file' && onSelectFile(item.path)}
              title={item.kind === 'file' ? `${projectPath}\\${item.path}` : item.path}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 32,
                border: 'none',
                borderRadius: 7,
                background: active ? '#242424' : 'transparent',
                color: item.kind === 'folder' ? 'var(--color-bg-subtle)' : '#e7e7e7',
                cursor: item.kind === 'file' ? 'pointer' : 'default',
                textAlign: 'left',
                padding: `0 8px 0 ${8 + Math.min(item.depth, 4) * 14}px`,
                fontSize: 13,
                fontWeight: item.kind === 'folder' ? 650 : 450,
                opacity: item.kind === 'folder' ? 0.95 : 1,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.045)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {item.kind === 'folder' ? (
                <Folder size={15} strokeWidth={1.8} color="#a3a3a3" style={{ flexShrink: 0 }} />
              ) : (
                <img
                  src={visual?.iconUrl}
                  alt=""
                  style={{ width: 16, height: 16, flexShrink: 0 }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function FilePreviewOverlay({
  filePath,
  content,
  onClose,
}: {
  filePath: string;
  content: string | null;
  onClose: () => void;
}) {
  const ext = filePath.split('.').pop() || 'text';
  const lines = (content || '').split('\n');
  const MAX_PREVIEW_LINES = 1000;
  const truncated = lines.length > MAX_PREVIEW_LINES;
  const linesToRender = truncated ? lines.slice(0, MAX_PREVIEW_LINES) : lines;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 4,
      background: '#151515',
      color: 'var(--color-bg-subtle)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      <div style={{
        height: 48,
        borderBottom: '1px solid #252525',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <FileIcon size={15} color={extensionColor(filePath)} />
          <span style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {basenameFromPath(filePath)}
          </span>
        </div>
        <button type="button" onClick={onClose} title="Close preview" style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid #303030', background: '#202020', color: '#d4d4d4', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', fontFamily: T.mono, fontSize: 12.5, lineHeight: '20px', padding: '12px 0' }}>
        {content == null ? (
          <div style={{ padding: 18, color: '#7c7c7c' }}>Unable to preview this file.</div>
        ) : (
          <>
            {linesToRender.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', minWidth: 'fit-content' }}>
                <span style={{ width: 52, flexShrink: 0, textAlign: 'right', paddingRight: 12, color: 'var(--color-text-tertiary)', userSelect: 'none' }}>{idx + 1}</span>
                <pre style={{ margin: 0, paddingRight: 18, color: 'var(--color-border)', whiteSpace: 'pre' }}>{syntaxHighlightLine(line, ext)}</pre>
              </div>
            ))}
            {truncated && (
              <div style={{ padding: '8px 16px 8px 64px', color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontFamily: T.mono, fontSize: 12 }}>
                ... [Remaining {lines.length - MAX_PREVIEW_LINES} lines truncated for performance]
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   MAIN PANEL
   ============================================================ */
const cache = new Map();

interface ToolDetailSidePanelProps {
  isOpen: boolean;
  toolCall: any;
  onClose: () => void;
  conversationId: string;
  subAgentProgress?: Map<string, any[]>;
  subAgentProgressVersion?: number;
}

export default function ToolDetailSidePanel({ isOpen, toolCall, onClose, conversationId, subAgentProgress, subAgentProgressVersion }: ToolDetailSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [toolType, setToolType] = useState(ToolType.GENERIC);
  const [toolData, setToolData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showFilePane, setShowFilePane] = useState(false);
  const [filePaneProjectPath, setFilePaneProjectPath] = useState('');
  const [filePaneFiles, setFilePaneFiles] = useState<string[]>([]);
  const [filePaneLoaded, setFilePaneLoaded] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Primary effect: runs when the panel opens or the selected tool call changes.
  // Uses stable primitives as deps (id + output) instead of the toolCall object reference,
  // which changes on every parent re-render causing an infinite loop.
  useEffect(() => {
    if (!isOpen || !toolCall) { setToolData(null); setError(null); return; }

    setIsLoading(true);
    setError(null);
    try {
      const type = detectToolType(toolCall.toolName);
      setToolType(type);
      setSelectedFilePath('');
      setSelectedFileContent(null);
      setFilePaneProjectPath('');
      setFilePaneFiles([]);
      setFilePaneLoaded(false);

      let extracted: any;
      if (type === ToolType.MCP_REGISTRY) {
        extracted = extractMcpRegistryData(toolCall);
      } else if (type === ToolType.WEB_SEARCH) {
        extracted = extractWebSearchData(toolCall);
      } else if (type === ToolType.LIVE_PREVIEW) {
        extracted = extractLivePreviewData(toolCall);
      } else if (type === ToolType.FERN) {
        // Pass current progress snapshot for initial render
        const progress = subAgentProgress?.get(toolCall.id) || [];
        extracted = extractNavisData(toolCall, progress);
      } else if (type === ToolType.TERMINAL) {
        extracted = extractTerminalData(toolCall);
      } else if (type === ToolType.SKILL) {
        extracted = extractSkillData(toolCall);
      } else if (type === ToolType.TODO_WRITE) {
        extracted = extractTodoWriteData(toolCall);
      } else if (type === ToolType.IMAGE_ANALYSIS) {
        extracted = extractImageAnalysisData(toolCall);
      } else if (type === ToolType.FILE_SYSTEM || type === ToolType.FILE_EDITOR) {
        extracted = extractFileSystemData(toolCall);
      } else {
        extracted = extractGenericData(toolCall);
      }

      if (!extracted && type !== ToolType.GENERIC) {
        setToolType(ToolType.GENERIC);
        extracted = extractGenericData(toolCall);
      }

      if (extracted) (extracted as any).toolCallId = toolCall.id;
      setToolData(extracted);
    } catch { setError('Failed to load details'); }
    setIsLoading(false);
    // toolCall?.id changes when a different tool call is selected.
    // toolCall?.output changes when an in-progress tool call finishes.
    // Using primitives instead of the toolCall object avoids infinite loops from reference churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, toolCall?.id, toolCall?.output]);

  useEffect(() => {
    if (!isOpen || !showFilePane || filePaneLoaded) return;
    let cancelled = false;

    const inferBasePath = async () => {
      const api = (window as any).electronAPI;
      const args = toolCall?.args || toolCall?.arguments || {};
      const candidateValues = [
        args.cwd,
        args.path,
        args.filePath,
        args.file,
        args.TargetFile,
        args.DirectoryPath,
        toolData?.cwd,
        toolData?.path,
      ].filter((v: any) => typeof v === 'string' && v.trim()) as string[];

      let projects: any[] = [];
      try {
        projects = await api?.projects?.list?.() || [];
      } catch { projects = []; }

      const normalized = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      for (const value of candidateValues) {
        const val = normalized(value);
        const matched = projects.find(p => p?.path && val.startsWith(normalized(p.path)));
        if (matched?.path) return matched.path;
      }

      if (projects[0]?.path) return projects[0].path;

      const first = candidateValues[0];
      if (!first) return '';
      if (/[\\/]/.test(first)) {
        const parts = first.split(/[\\/]/).filter(Boolean);
        if (/\.[^\\/]+$/.test(first)) parts.pop();
        return first.match(/^[A-Za-z]:[\\/]/)
          ? `${first.slice(0, 3)}${parts.slice(1).join('\\')}`
          : parts.join('\\');
      }
      return '';
    };

    (async () => {
      const api = (window as any).electronAPI;
      const projectPath = await inferBasePath();
      if (!projectPath || cancelled) {
        if (!cancelled) setFilePaneLoaded(true);
        return;
      }
      try {
        const res = await api?.projects?.listFiles?.(projectPath);
        if (!cancelled) {
          setFilePaneProjectPath(projectPath);
          setFilePaneFiles(Array.isArray(res?.files) ? res.files : []);
          setFilePaneLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setFilePaneProjectPath(projectPath);
          setFilePaneFiles([]);
          setFilePaneLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, showFilePane, filePaneLoaded, toolCall, toolData]);

  const handleSelectFileFromPane = async (filePath: string) => {
    setSelectedFilePath(filePath);
    setSelectedFileContent(null);
    try {
      const content = await (window as any).electronAPI?.projects?.readFile?.(filePaneProjectPath, filePath);
      setSelectedFileContent(content);
    } catch {
      setSelectedFileContent(null);
    }
  };

  // Lightweight secondary effect: ONLY updates screenshots for live FERN/computer_use sessions.
  // Runs when new progress events arrive but skips the loading spinner and full re-parse.
  useEffect(() => {
    if (!isOpen || !toolCall || toolType !== ToolType.FERN) return;
    const progress = subAgentProgress?.get(toolCall.id) || [];
    if (progress.length === 0) return;
    try {
      const extracted = extractNavisData(toolCall, progress);
      if (extracted) {
        (extracted as any).toolCallId = toolCall.id;
        setToolData(extracted);
      }
    } catch { /* silently ignore mid-stream parse errors */ }
    // subAgentProgressVersion is a cheap counter that increments on each new event batch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAgentProgressVersion, toolCall?.id, isOpen, toolType]);

  // Async disk-path screenshot loader: fires when toolData contains screenshots that have a
  // screenshotPath but no base64 (i.e., the session was restored from saved history after
  // a page refresh). Loads each image via IPC and patches toolData in place.
  useEffect(() => {
    if (!isOpen || !toolData || toolType !== ToolType.FERN) return;
    const screenshots: any[] = toolData.screenshots || [];
    const needLoad = screenshots.filter((s: any) => s.screenshotPath && !s.base64);
    if (needLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      const api = (window as any).electronAPI?.screenshot;
      if (!api?.load) return;

      const updated = [...screenshots];
      let changed = false;

      await Promise.all(
        needLoad.map(async (s: any) => {
          try {
            const result = await api.load(s.screenshotPath);
            if (cancelled) return;
            if (result?.dataUrl) {
              const idx = updated.findIndex((u: any) => u.screenshotPath === s.screenshotPath);
              if (idx !== -1) {
                const clean = result.dataUrl.indexOf(',') !== -1
                  ? result.dataUrl.substring(result.dataUrl.indexOf(',') + 1)
                  : result.base64;
                updated[idx] = { ...updated[idx], base64: clean };
                changed = true;
              }
            }
          } catch { /* skip failed files */ }
        })
      );

      if (!cancelled && changed) {
        setToolData((prev: any) => prev ? { ...prev, screenshots: updated } : prev);
      }
    })();

    return () => { cancelled = true; };
    // Only fire when the set of path-only screenshots changes (toolData ref change on restore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolData?.toolCallId, isOpen, toolType]);

  // Poll for live terminal output if the command is still running
  useEffect(() => {
    if (!isOpen || !toolCall || toolCall.status === 'done' || toolType !== ToolType.TERMINAL) return;

    let mounted = true;
    const pollId = toolCall.args?.id || toolCall.id;

    const poll = async () => {
      try {
        if (!mounted || !window.electronAPI?.terminal?.getStatus) return;
        const res = await window.electronAPI.terminal.getStatus(pollId);
        if (mounted && res && res.success) {
          setToolData((prev: any) => ({
            ...prev,
            output: res.output || prev?.output || '',
            exitCode: res.exitCode
          }));
        }
      } catch (err) {
        // ignore polling errors
      }
    };

    poll(); // Initial fetch
    const interval = setInterval(poll, 1000); // Poll every second

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOpen, toolCall, toolType]);

  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc as any);
    return () => document.removeEventListener('keydown', esc as any);
  }, [isOpen, onClose]);

  const renderContent = () => {
    if (isLoading) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <motion.div
          style={{ width: 26, height: 26, border: `2px solid ${T.border}`, borderTopColor: T.textSecondary, borderRadius: '50%' }}
          animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
        />
        <span style={{ fontSize: 12.5, color: T.textMuted, fontFamily: T.sans }}>Loading…</span>
      </div>
    );

    if (error) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: T.r12, background: T.redFaint, border: `1px solid rgba(239,68,68,0.18)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <AlertCircle size={18} color={T.red} strokeWidth={1.75} />
        </div>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 6px', fontFamily: T.sans }}>{error}</p>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>Try reopening the panel.</p>
      </div>
    );

    if (!toolData) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 13, color: T.textMuted, fontFamily: T.sans }}>No data available</p>
      </div>
    );

    if (toolType === ToolType.LIVE_PREVIEW) return <LivePreviewView {...toolData} />;
    if (toolType === ToolType.MCP_REGISTRY) return <McpRegistryView {...toolData} />;
    if (toolType === ToolType.WEB_SEARCH) return <WebSearchView {...toolData} />;
    if (toolType === ToolType.FERN) return <NavisView {...toolData} toolName={toolCall?.toolName || 'Fern'} toolCall={toolCall} />;
    if (toolType === ToolType.MEMORY) return <MemoryView {...toolData} toolName={toolCall?.toolName || ''} />;
    if (toolType === ToolType.TERMINAL) return <TerminalView {...toolData} />;
    if (toolType === ToolType.SKILL) return <SkillView {...toolData} />;
    if (toolType === ToolType.TODO_WRITE) return <TodoWriteView {...toolData} />;
    if (toolType === ToolType.IMAGE_ANALYSIS) return <ImageAnalysisView {...toolData} />;
    if (toolType === ToolType.FILE_SYSTEM) return <FileSystemView {...toolData} />;
    if (toolType === ToolType.FILE_EDITOR) return <FileEditorView {...toolData} />;
    return <GenericView {...toolData} />;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (mobile only) */}
          <motion.div
            style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,9,0.45)', zIndex: 40 }}
            className="lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="complementary"
            aria-label="Tool execution details"
            style={isDesktop ? {
              position: 'relative', height: '100%',
              background: T.bg, borderLeft: `1px solid ${T.border}`,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden', outline: 'none', flexShrink: 0,
            } : {
              position: 'fixed', right: 0, top: 0, bottom: 0,
              width: 'min(100%, 520px)',
              background: T.bg, borderLeft: `1px solid ${T.border}`,
              display: 'flex', flexDirection: 'column',
              zIndex: 50, overflow: 'hidden', outline: 'none',
            }}
            initial={isDesktop ? { width: 0, opacity: 0 } : { x: '100%' }}
            animate={isDesktop ? { width: showFilePane ? 750 : 460, opacity: 1 } : { x: 0 }}
            exit={isDesktop ? { width: 0, opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
          >
            {/* Inner wrapper prevents layout reflow during animation */}
            <div style={{
              width: isDesktop ? (showFilePane ? 750 : 460) : '100%', height: '100%',
              display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
            }}>
              {toolCall && (
                <PanelHeader
                  agentName={toolCall.agentName}
                  toolName={toolCall.toolName}
                  onClose={onClose}
                  showFilePane={showFilePane}
                  onToggleFilePane={() => setShowFilePane(v => !v)}
                />
              )}

              <motion.div
                style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.07, duration: 0.2 }}
              >
                <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {renderContent()}
                  {selectedFilePath && (
                    <FilePreviewOverlay
                      filePath={selectedFilePath}
                      content={selectedFileContent}
                      onClose={() => {
                        setSelectedFilePath('');
                        setSelectedFileContent(null);
                      }}
                    />
                  )}
                </div>
                {showFilePane && (
                  <FileNavigatorPane
                    projectPath={filePaneProjectPath}
                    files={filePaneFiles}
                    loaded={filePaneLoaded}
                    selectedPath={selectedFilePath}
                    onSelectFile={handleSelectFileFromPane}
                  />
                )}
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
