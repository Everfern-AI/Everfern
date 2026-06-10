'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { diffLines } from 'diff';
import Ansi from 'ansi-to-react';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, AlertTriangle, CheckCircle, Link2, ExternalLink,
  Braces, ChevronDown, AlertCircle, ArrowUpRight, Play, Pause,
  BookOpen, PanelRightOpen, File as FileIcon, Folder, Plus, Image
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
  bg: '#fafafa',
  surface: '#fff',
  surfaceRaised: '#f5f5f4',
  border: '#e8e8e6',
  borderSubtle: '#f0f0ee',

  // Text
  text: '#141412',
  textSecondary: '#6b6b67',
  textMuted: '#a8a8a3',
  textPlaceholder: '#c8c8c3',

  // Ink (terminal / code)
  inkBg: '#0d0d0b',
  inkSurface: '#161614',
  inkBorder: 'rgba(255,255,255,0.07)',
  inkText: 'rgba(255,255,255,0.82)',
  inkMuted: 'rgba(255,255,255,0.35)',

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
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", "Berkeley Mono", ui-monospace, "SF Mono", Menlo, monospace',
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
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return ToolType.FERN;
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
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
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
          background: '#ececea', border: '0.5px solid rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <Icon size={iconSize} color={'#333'} strokeWidth={1.75} />
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
              fontSize: 11.5, fontFamily: T.mono, fontWeight: 700, color: '#111',
              background: '#ececea', border: '0.5px solid rgba(0,0,0,0.1)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
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
              width: 32, height: 32, borderRadius: T.r8, border: showFilePane ? '1px solid rgba(20,20,18,0.22)' : '0.5px solid rgba(0,0,0,0.1)',
              background: showFilePane ? '#deded9' : '#ececea', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
              cursor: 'pointer', color: '#333', transition: 'all 0.1s ease',
            }}
          >
            <PanelRightOpen size={15} strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 32, height: 32, borderRadius: T.r8, border: '0.5px solid rgba(0,0,0,0.1)',
            background: '#ececea', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
            cursor: 'pointer', color: '#333', transition: 'all 0.1s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.color = '#000';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.color = '#333';
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
      background: 'rgba(250,250,250,0.94)',
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
          fontSize: 10.5, fontWeight: 700, color: '#111',
          background: '#ececea',
          border: '0.5px solid rgba(0,0,0,0.1)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.05)',
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
function NavisView({ screenshots = [], toolName }: { screenshots: any[]; toolName: string }) {
  const [zoomed, setZoomed] = useState<any>(null);
  const safe = Array.isArray(screenshots) ? screenshots : [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true); // Autoplay by default
  const prevLengthRef = useRef(safe.length);

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

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SectionLabel>Browser session</SectionLabel>
        <EmptyState
          icon={CameraOff}
          title="No captures yet"
          description={`${toolName} ran but didn't produce screenshots during this session.`}
          note="Frames appear here in real-time as the browser navigates."
        />
      </div>
    );
  }

  const currentScreenshot = safe[currentIndex] || safe[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionLabel right={`${currentIndex + 1} / ${safe.length} frame${safe.length !== 1 ? 's' : ''}`}>Execution history</SectionLabel>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
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
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
              zIndex: 10
            }}>
              Step {currentScreenshot.sequenceNumber ?? (currentIndex + 1)}
            </div>
            <div style={{
              position: 'absolute', bottom: 12, right: 12,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
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
            background: "#ececea",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06), inset 1px 0 rgba(255,255,255,0.50), inset -1px 0 rgba(0,0,0,0.04), 0 2px 5px rgba(0,0,0,0.05)",
            border: "0.5px solid rgba(0,0,0,0.10)",
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
                background: isPlaying ? '#111' : '#f9f9f9',
                color: isPlaying ? '#fff' : '#111',
                boxShadow: isPlaying
                  ? 'inset 0 1px 3px rgba(0,0,0,0.3)'
                  : 'inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(0,0,0,0.05)',
                border: isPlaying ? 'none' : '0.5px solid rgba(0,0,0,0.1)',
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
                background: #fafafa;
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
                background: #f0f0f0;
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
  bg:       '#0c0c0c',
  border:   'rgba(255,255,255,0.08)',
  divider:  'rgba(255,255,255,0.05)',

  textCmd:  'rgba(255,255,255,0.88)',
  textOut:  'rgba(238,242,247,0.86)',
  textErr:  '#ff5f57',
  textDim:  'rgba(255,255,255,0.2)',
  textMeta: 'rgba(255,255,255,0.3)',

  psUser:   '#5af78e',
  psAt:     'rgba(255,255,255,0.25)',
  psHost:   '#57c7ff',
  psSep:    'rgba(255,255,255,0.2)',
  psPath:   '#f3f99d',
  psDollar: 'rgba(255,255,255,0.4)',

  okBg:     'rgba(40,201,64,0.1)',
  okBorder: 'rgba(40,201,64,0.18)',
  okText:   '#28c940',
  errBg:    'rgba(255,95,87,0.1)',
  errBorder:'rgba(255,95,87,0.18)',
  errText:  '#ff5f57',
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
}: {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
  shellType?: 'windows' | 'linux';
  cwd?: string;
}) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const hasOutput = hasVisibleTerminalOutput(output);
  const looksLikePS = shellType === 'windows' || /powershell\.exe/i.test(command) || /^pwsh/i.test(command);

  const showExit = exitCode !== undefined || duration !== undefined;

  // ── Windows/PowerShell Terminal Style ──
  if (looksLikePS) {
    const WIN = {
      bg: '#111111',
      tab: '#202020',
      tabText: '#f4f4f5',
      border: 'rgba(255,255,255,0.08)',
      divider: 'rgba(255,255,255,0.08)',
      textCmd: '#ffffff',
      textOut: '#f5f5f5',
      textErr: '#ff8a8a',
      textDim: 'rgba(255,255,255,0.36)',
      textMeta: 'rgba(255,255,255,0.42)',
      accent: '#d19a3a',
    };
    const displayCwd = cwd || 'C:\\Users\\user\\Downloads\\EverFern\\everfern-desktop\\apps\\desktop';
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
            <TerminalAnsiOutput output={output} isError={isError} palette={WIN} />
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
          <TerminalAnsiOutput output={output} isError={isError} palette={TERM} />
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
    const isTitleURLOrDomain = !title || title.startsWith('http') || (title.includes('.') && !title.includes(' '));
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

  const content = description || snippet || '';
  const displayFavicon = favicon || getFaviconUrl(domain);
  const finalTitle = displayTitle?.trim() || domain || url || 'Search Result';
  let displayDomain = domain || 'Unknown';
  if (displayDomain === 'Unknown' && url) {
    try {
      displayDomain = new URL(url).hostname;
    } catch { /* ignore */ }
  }

  return (
    <motion.article
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      role="button" tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && window.open(url, '_blank')}
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
      <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
        <iframe
          ref={iframeRef}
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#fff'
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Query pill */}
      <div style={{ padding: '16px 24px', background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '12px 16px' }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: T.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px', fontFamily: T.sans }}>
            Query
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 500, color: T.text, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5, fontFamily: T.sans }}>
            "{query}"
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

function GenericView({ toolName, args, output }: { toolName: string; args?: any; output?: string }) {
  const argEntries = Object.entries(args || {});

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
              <CopyBtn text={output} />
            </div>
            <pre style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.85,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 360, overflowY: 'auto',
            }}>
              <code>{output}</code>
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
    return { screenshots: slicedScreenshots, screenshotPaths, url: tc.args?.url, action: tc.args?.action };
  } catch { return null; }
}

function extractTerminalData(tc: any) {
  const command = tc.args?.command || tc.args?.CommandLine || '';
  const toolName = (tc.toolName || '').toLowerCase();
  const isWindows = toolName.includes('pwsh') || toolName.includes('powershell') || command.includes('powershell.exe') || command.includes('pwsh') || command.startsWith('powershell');
  return {
    command,
    output: tc.output || tc.result?.output || tc.result?.error || tc.error || '',
    exitCode: tc.data?.exitCode || tc.result?.data?.exitCode,
    duration: tc.duration || tc.result?.duration,
    shellType: isWindows ? 'windows' : 'linux',
    cwd: tc.data?.cwd || tc.result?.data?.cwd || tc.args?.cwd || ''
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
              <CopyBtn text={output} />
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, overflow: 'hidden' }}>
              <MarkdownViewer content={output} />
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
  gutterText: '#52525b',
  border: '#27272a',
  text: '#e4e4e7',
  keyword: '#e879f9', // pink/magenta
  string: '#34d399', // green
  number: '#60a5fa', // blue
  comment: '#71717a', // grey
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

function FileEditorView({ toolName, path, args, output, data }: { toolName: string; path: string; args: any; output: string; data?: any }) {
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
    if (isWrite || isRead) {
      const lines = newText.split('\n');
      return lines.map((line, idx) => (
        <CodeLine
          key={idx}
          type={isRead ? 'normal' : 'add'}
          content={line}
          lineNumber={startLine + idx}
          ext={ext}
        />
      ));
    }

    // Compute diff
    const changes = diffLines(oldText, newText);
    const lineElements: React.ReactNode[] = [];
    let oldLine = startLine;
    let newLine = startLine;

    changes.forEach((change, changeIdx) => {
      // Split the text while keeping trailing spaces/newlines
      const lines = change.value.replace(/\n$/, '').split('\n');
      lines.forEach((line, lineIdx) => {
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
      });
    });

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
              <span style={{ fontSize: 11, color: '#a1a1aa', fontFamily: T.mono, marginLeft: 12 }}>
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
                  color: '#d4d4d8',
                  fontFamily: T.mono,
                  fontSize: 12,
                  lineHeight: 1.7,
                }}>
                  <div style={{ color: '#a1a1aa', marginBottom: 10, fontFamily: T.sans, fontSize: 12 }}>
                    This edit completed, but no before/after diff was included in the tool arguments.
                  </div>
                  {output && (
                    <pre style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{output}</pre>
                  )}
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#a1a1aa' }}>
                    {JSON.stringify(args || {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : isMulti ? (
              chunks.map((chunk, idx) => (
                <div key={idx} style={{ marginBottom: idx < chunks.length - 1 ? 16 : 0 }}>
                  <div style={{
                    backgroundColor: '#18181b',
                    color: '#a1a1aa',
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
      color: '#f4f4f5',
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
          color: '#9ca3af',
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
              color: '#f4f4f5',
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
                color: item.kind === 'folder' ? '#f4f4f5' : '#e7e7e7',
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
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 4,
      background: '#151515',
      color: '#f4f4f5',
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
        ) : lines.map((line, idx) => (
          <div key={idx} style={{ display: 'flex', minWidth: 'fit-content' }}>
            <span style={{ width: 52, flexShrink: 0, textAlign: 'right', paddingRight: 12, color: '#6b7280', userSelect: 'none' }}>{idx + 1}</span>
            <pre style={{ margin: 0, paddingRight: 18, color: '#e5e7eb', whiteSpace: 'pre' }}>{syntaxHighlightLine(line, ext)}</pre>
          </div>
        ))}
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
    if (toolType === ToolType.FERN) return <NavisView {...toolData} toolName={toolCall?.toolName || 'Fern'} />;
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
