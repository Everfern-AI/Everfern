'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, AlertTriangle, CheckCircle, Link2, ExternalLink,
  Braces, ChevronDown, AlertCircle, ArrowUpRight, Play, Pause,
  BookOpen, Shield, Image
} from 'lucide-react';
import { FolderOpenIcon } from '@heroicons/react/24/outline';
import { MarkdownViewer } from './FileViewerModal';

/* ============================================================
   ANIMATIONS & STYLES
   ============================================================ */
const animationStyles = `
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// Inject animation styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = animationStyles;
  document.head.appendChild(style);
}

/* ============================================================
   TYPES
   ============================================================ */
export const ToolType = {
  WEB_SEARCH: 'web_search',
  FERN: 'fern',
  TERMINAL: 'terminal',
  SKILL: 'skill',
  FILE_SYSTEM: 'file_system',
  LOCAL_PERMISSION: 'local_permission',
  IMAGE_ANALYSIS: 'image_analysis',
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

  // Ink (terminal / code) - Updated to be friendlier and match app design
  inkBg: '#f8f7f5',
  inkSurface: '#faf9f7',
  inkBorder: '#e8e6d9',
  inkText: '#2d2d2a',
  inkMuted: '#a8a8a3',

  // Semantic
  green: '#22c55e',
  greenFaint: 'rgba(34,197,94,0.08)',
  red: '#ef4444',
  redFaint: 'rgba(239,68,68,0.07)',

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
  if (n.includes('web_search') || n.includes('remote_web_search') || n.includes('search')) return ToolType.WEB_SEARCH;
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return ToolType.FERN;
  if (n.includes('run_command') || n.includes('bash') || n.includes('run_terminal') || n.includes('execute')) return ToolType.TERMINAL;
  if (n.includes('read_file') || n.includes('write_to_file') || n.includes('replace_file_content') || n.includes('system_files') || n.includes('list_dir') || n.includes('grep_search')) return ToolType.FILE_SYSTEM;
  if (n === 'local_permission') return ToolType.LOCAL_PERMISSION;
  if (n === 'analyze_image' || n.includes('analyze_image')) return ToolType.IMAGE_ANALYSIS;
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
  if (n.includes('web_search') || n.includes('search')) return { Icon: Search, label: 'Web Search' };
  if (n.includes('fern') || n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
  if (n.includes('run_command') || n.includes('bash') || n.includes('terminal')) return { Icon: Terminal, label: 'Terminal' };
  if (n === 'local_permission') return { Icon: Shield, label: 'Permission' };
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
function PanelHeader({ agentName, toolName, onClose }: { agentName?: string; toolName?: string; onClose: () => void }) {
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
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: '-0.015em', fontFamily: T.sans }}>Fern</span>
                <span style={{ color: T.textMuted, fontSize: 12 }}>→</span>
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
  textOut:  'rgba(255,255,255,0.55)',
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

function PS1({ user = 'ubuntu', host = 'localhost', path = '~' }: { user?: string; host?: string; path?: string }) {
  return (
    <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13 }}>
      <span style={{ color: TERM.psUser }}>{user}</span>
      <span style={{ color: TERM.psAt }}>@</span>
      <span style={{ color: TERM.psHost }}>{host}</span>
      <span style={{ color: TERM.psSep }}>:</span>
      <span style={{ color: TERM.psPath }}>{path}</span>
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
}: {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
  shellType?: 'windows' | 'linux';
}) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const clean   = output?.replace(/\x1b\[[0-9;]*m/g, '') || '';
  const isWindows = shellType === 'windows';

  // Detect if command looks like a PowerShell command
  const looksLikePS = isWindows || /powershell\.exe/i.test(command) || /^pwsh/i.test(command);

  const showExit = exitCode !== undefined || duration !== undefined;

  // ── Windows/PowerShell Terminal Style ──
  if (looksLikePS) {
    const WIN = {
      bg:       '#0d1117',
      border:   'rgba(86,145,227,0.15)',
      divider:  'rgba(86,145,227,0.08)',
      textCmd:  'rgba(220,235,255,0.9)',
      textOut:  'rgba(220,235,255,0.55)',
      textErr:  '#ff7b72',
      textDim:  'rgba(220,235,255,0.2)',
      textMeta: 'rgba(220,235,255,0.3)',
      psPrefix: '#5691e3',
      psPath:   '#58a6ff',
      psChevron:'rgba(220,235,255,0.4)',
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: WIN.bg, overflow: 'hidden', fontFamily: monoStack }}>
        {/* Windows title bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'rgba(86,145,227,0.1)', borderBottom: `1px solid ${WIN.border}`, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#5691e3"><path d="M0 0h11v11H0zm13 0h11v11H13zm0 13h11v11H13zM0 13h11v11H0z"/></svg>
          <span style={{ fontSize: 11, color: WIN.textCmd, fontFamily: monoStack, fontWeight: 600 }}>Windows PowerShell</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 24px', display: 'flex', flexDirection: 'column' }}>
          {/* Prompt + command */}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10 }}>
            <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13 }}>
              <span style={{ color: WIN.psPrefix }}>PS </span>
              <span style={{ color: WIN.psPath }}>C:\&gt;</span>
              <span style={{ color: WIN.psChevron, margin: '0 8px 0 4px' }}>&gt;</span>
            </span>
            <code style={{ fontSize: 13, color: WIN.textCmd, lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
              {command}
            </code>
          </div>

          {/* Output */}
          {clean ? (
            <pre style={{ fontSize: 12.5, lineHeight: 1.75, color: isError ? WIN.textErr : WIN.textOut, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 8px', fontFamily: monoStack }}>
              {clean}
            </pre>
          ) : (
            <pre style={{ margin: '0 0 8px', fontSize: 12.5, color: WIN.textDim, fontStyle: 'italic', fontFamily: monoStack }}>
              (no output)
            </pre>
          )}

          {/* Exit / duration */}
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

          {/* Idle prompt with cursor */}
          {showExit ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
              <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontFamily: monoStack, fontSize: 13 }}>
                <span style={{ color: WIN.psPrefix }}>PS </span>
                <span style={{ color: WIN.psPath }}>C:\&gt;</span>
                <span style={{ color: WIN.psChevron, margin: '0 8px 0 4px' }}>&gt;</span>
              </span>
              <BlinkCursor />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14, color: WIN.textDim, fontSize: 16, fontFamily: monoStack, letterSpacing: '2px' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.2s' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.4s' }}>.</span>
              <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.6s' }}>.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Linux Terminal Style (original) ──
  const user = 'ubuntu';
  const host = 'localhost';
  const path = '~';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: TERM.bg, overflow: 'hidden', fontFamily: monoStack }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10 }}>
          <PS1 user={user} host={host} path={path} />
          <code style={{ fontSize: 13, color: TERM.textCmd, lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontFamily: monoStack }}>
            {command}
          </code>
        </div>
        {clean ? (
          <pre style={{ fontSize: 12.5, lineHeight: 1.75, color: isError ? TERM.textErr : TERM.textOut, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 8px', fontFamily: monoStack }}>
            {clean}
          </pre>
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
        {showExit ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14 }}>
            <PS1 user={user} host={host} path={path} />
            <BlinkCursor />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 14, color: TERM.textDim, fontSize: 16, fontFamily: monoStack, letterSpacing: '2px' }}>
            <span style={{ animation: 'pulse 1.5s infinite' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.2s' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.4s' }}>.</span>
            <span style={{ animation: 'pulse 1.5s infinite', animationDelay: '0.6s' }}>.</span>
          </div>
        )}
      </div>
    </div>
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
        padding: '18px 20px', background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: T.r12, cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)', position: 'relative', overflow: 'hidden',
      }}
      whileHover={{ borderColor: '#b8b8b4', y: -1, boxShadow: '0 4px 16px rgba(0,0,0,0.05)' }}
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
        fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 8px',
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

function GenericView({ toolName, args, output, result }: { toolName: string; args?: any; output?: string; result?: any }) {
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
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 280, overflowY: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
            }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
          </CollapsibleSection>
        )}

        {output && (
          <CollapsibleSection icon={Terminal} label="Output" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {/* Execution Status Indicator */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: result?.exitCode === 0 ? T.green : (result?.exitCode ? T.red : T.amber),
                  animation: !result ? 'pulse 2s infinite' : 'none'
                }} />
                <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans }}>
                  {!result ? 'Running...' : result.exitCode === 0 ? 'Success' : `Exit Code: ${result.exitCode}`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {result?.duration && (
                  <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {(result.duration / 1000).toFixed(2)}s
                  </span>
                )}
                <CopyBtn text={output} />
              </div>
            </div>
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.85,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 420, overflowY: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
              position: 'relative'
            }}>
              {/* Live Streaming Indicator */}
              {!result && (
                <div style={{
                  position: 'absolute', top: 12, right: 12,
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: T.amber, fontFamily: T.sans,
                  background: 'rgba(251, 191, 36, 0.1)', padding: '4px 8px',
                  borderRadius: 4, border: `1px solid rgba(251, 191, 36, 0.2)`
                }}>
                  <div style={{ width: 6, height: 6, background: T.amber, borderRadius: '50%', animation: 'pulse 1s infinite' }} />
                  LIVE
                </div>
              )}
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 60 }}>
                <code>{output}</code>
              </pre>
            </div>
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

export function extractFernData(tc: any, progressEvents: any[] = []) {
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
  return { command, output: tc.output || tc.result?.output || tc.result?.error || tc.error || '', exitCode: tc.data?.exitCode || tc.result?.data?.exitCode, duration: tc.duration || tc.result?.duration, shellType: isWindows ? 'windows' : 'linux' };
}

function extractFileSystemData(tc: any) {
  return { toolName: tc.toolName, path: tc.args?.path || tc.args?.TargetFile || tc.args?.SearchPath || tc.args?.DirectoryPath || '', args: tc.args || {}, output: tc.output || tc.result?.output || tc.result?.error || tc.error || '' };
}

function extractGenericData(tc: any) {
  return { toolName: tc.toolName, args: tc.args || {}, output: tc.output || tc.result?.output || tc.result?.error || tc.error || '', result: tc.result || tc.data || (tc.output ? { exitCode: 0 } : null) };
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
            <div style={{
              margin: 0, fontFamily: T.mono, fontSize: 12, lineHeight: 1.8,
              background: T.inkBg, color: T.inkText,
              padding: '18px 20px', borderRadius: T.r10,
              border: `1px solid ${T.inkBorder}`, maxHeight: 280, overflowY: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
            }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
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
   LOCAL PERMISSION VIEW
   ============================================================ */
function LocalPermissionView({
  command,
  reason,
  shellType,
  agentName,
  toolCallId,
}: {
  command: string;
  reason: string;
  shellType?: string;
  agentName?: string;
  toolCallId?: string;
}) {
  const [responded, setResponded] = useState(false);

  const sendResponse = (approved: boolean, alwaysAllow: boolean) => {
    const acpApi = (window as any).electronAPI?.acp;
    if (acpApi?.sendLocalExecutionResponse) {
      acpApi.sendLocalExecutionResponse({ approved, alwaysAllow, requestId: toolCallId });

      // Emit a chat event to show the permission decision in the chat
      if (acpApi?.onPermissionResponse) {
        acpApi.onPermissionResponse({
          requestId: toolCallId,
          approved,
          alwaysAllow,
          timestamp: new Date().toISOString()
        });
      }
    }
    setResponded(true);
  };

  const btnBase: React.CSSProperties = {
    padding: '8px 18px', borderRadius: T.r8, fontSize: 12, fontWeight: 600,
    fontFamily: T.sans, cursor: 'pointer', border: 'none', transition: 'all 0.12s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Local Execution Request
        </h3>
        {agentName && <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>Requested by Everfern</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Reason */}
        {reason && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '14px 18px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Reason
            </p>
            <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.6, fontFamily: T.sans }}>{reason}</p>
          </div>
        )}

        {/* Command */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
            Command {shellType && <span style={{ color: T.textPlaceholder }}>· {shellType}</span>}
          </p>
          <div style={{
            margin: 0, fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.7,
            background: T.inkBg, color: T.inkText,
            padding: '16px 18px', borderRadius: T.r10,
            border: `1px solid ${T.inkBorder}`, overflowX: 'auto',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.5)',
          }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <code>{command}</code>
            </pre>
          </div>
        </div>

        {/* Buttons */}
        {!responded && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: `1px solid ${T.borderSubtle}`, paddingTop: 20 }}>
            <button
              onClick={() => sendResponse(false, false)}
              style={{ ...btnBase, background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}` }}
              onMouseEnter={e => { e.currentTarget.style.background = T.border; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.surfaceRaised; }}
            >
              Deny
            </button>
            <button
              onClick={() => sendResponse(true, true)}
              style={{ ...btnBase, background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}` }}
              onMouseEnter={e => { e.currentTarget.style.background = T.border; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.surfaceRaised; }}
            >
              Always Allow
            </button>
            <button
              onClick={() => sendResponse(true, false)}
              style={{ ...btnBase, background: '#141412', color: '#fff' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2a2a28'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#141412'; }}
            >
              Allow Once
            </button>
          </div>
        )}

        {responded && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            padding: 12, background: T.greenFaint, border: `1px solid rgba(34,197,94,0.15)`,
            borderRadius: T.r10,
          }}>
            <CheckCircle size={14} color={T.green} strokeWidth={2} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.green, fontFamily: T.sans }}>Response sent</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   IMAGE ANALYSIS VIEW
   ============================================================ */
function ImageViewer({ dataUrl, fileName }: { dataUrl: string; fileName: string }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  return (
    <div style={{
      borderRadius: T.r10, overflow: 'hidden', background: T.surface,
      border: `1px solid ${T.borderSubtle}`,
    }}>
      <div style={{ position: 'relative', background: T.surfaceRaised, aspectRatio: '16/10', overflow: 'hidden' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              style={{ width: 16, height: 16, border: `2px solid ${T.border}`, borderTopColor: T.textMuted, borderRadius: '50%' }}
              animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
            />
          </div>
        )}
        {!err ? (
          <img
            src={dataUrl}
            alt={fileName}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setErr(true); }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: T.textMuted, gap: 6 }}>
            <CameraOff size={18} strokeWidth={1.5} />
            <span style={{ fontSize: 11, fontFamily: T.sans }}>Failed to load</span>
          </div>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.borderSubtle}` }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: T.text, fontFamily: T.mono }}>{fileName}</span>
      </div>
    </div>
  );
}

function ImageAnalysisView({
  question,
  output,
  imageCount,
  fileNames,
  images = [],
}: {
  question?: string;
  output?: string;
  imageCount?: number;
  fileNames?: string[];
  images?: { fileName: string; dataUrl: string }[];
}) {
  const [localImages, setLocalImages] = useState<{ fileName: string; dataUrl: string }[]>(images);

  useEffect(() => {
    if (images.length > 0) {
      setLocalImages(images);
      return;
    }
    if (!fileNames || fileNames.length === 0) return;

    let cancelled = false;
    (async () => {
      const api = (window as any).electronAPI?.screenshot;
      if (!api?.load) return;
      const results: { fileName: string; dataUrl: string }[] = [];
      for (const name of fileNames) {
        try {
          const result = await api.load(name);
          if (cancelled) return;
          if (result?.dataUrl) results.push({ fileName: name, dataUrl: result.dataUrl });
        } catch { /* skip */ }
      }
      if (!cancelled && results.length > 0) setLocalImages(results);
    })();
    return () => { cancelled = true; };
  }, [fileNames, images]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0 }}>
        <h3 style={{ fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 4px', letterSpacing: '-0.015em', fontFamily: T.sans }}>
          Image Analysis
        </h3>
        {imageCount !== undefined && (
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0, fontFamily: T.sans }}>
            {imageCount} image{imageCount !== 1 ? 's' : ''} analyzed
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Question */}
        {question && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r10, padding: '14px 18px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Question
            </p>
            <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.6, fontFamily: T.sans }}>{question}</p>
          </div>
        )}

        {/* Images */}
        {localImages.length > 0 && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 10px', fontFamily: T.sans }}>
              Images
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {localImages.map((img, i) => (
                <ImageViewer key={`${img.fileName}-${i}`} dataUrl={img.dataUrl} fileName={img.fileName} />
              ))}
            </div>
          </div>
        )}

        {/* Output */}
        {output && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px', fontFamily: T.sans }}>
              Analysis Result
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
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
   DATA EXTRACTION — local permission
   ============================================================ */
function extractLocalPermissionData(tc: any) {
  try {
    return {
      command: tc.args?.command || '',
      reason: tc.args?.reason || '',
      shellType: tc.args?.shellType || 'Bash',
      agentName: tc.agentName || '',
      toolCallId: tc.id,
    };
  } catch { return null; }
}

/* ============================================================
   DATA EXTRACTION — image analysis
   ============================================================ */
function extractImageAnalysisData(tc: any) {
  try {
    const images: { fileName: string; dataUrl: string }[] = [];
    const rawImages = tc.data?.images || tc.result?.data?.images || [];
    if (Array.isArray(rawImages)) {
      for (const img of rawImages) {
        if (img?.dataUrl && img?.fileName) images.push({ fileName: img.fileName, dataUrl: img.dataUrl });
      }
    }
    return {
      question: tc.args?.question || '',
      output: tc.output || tc.result?.output || '',
      imageCount: tc.data?.imageCount || tc.result?.data?.imageCount || images.length || tc.args?.images?.length || (tc.args?.imagePath ? 1 : 0),
      fileNames: tc.data?.fileNames || tc.result?.data?.fileNames || (tc.args?.images ? [...tc.args.images] : tc.args?.imagePath ? [tc.args.imagePath] : []),
      images,
    };
  } catch { return null; }
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

      let extracted: any;
      if (type === ToolType.WEB_SEARCH) {
        extracted = extractWebSearchData(toolCall);
      } else if (type === ToolType.FERN) {
        // Pass current progress snapshot for initial render
        const progress = subAgentProgress?.get(toolCall.id) || [];
        extracted = extractFernData(toolCall, progress);
      } else if (type === ToolType.TERMINAL) {
        extracted = extractTerminalData(toolCall);
      } else if (type === ToolType.SKILL) {
        extracted = extractSkillData(toolCall);
      } else if (type === ToolType.FILE_SYSTEM) {
        extracted = extractFileSystemData(toolCall);
      } else if (type === ToolType.LOCAL_PERMISSION) {
        extracted = extractLocalPermissionData(toolCall);
      } else if (type === ToolType.IMAGE_ANALYSIS) {
        extracted = extractImageAnalysisData(toolCall);
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

  // Lightweight secondary effect: ONLY updates screenshots for live FERN/computer_use sessions.
  // Runs when new progress events arrive but skips the loading spinner and full re-parse.
  useEffect(() => {
    if (!isOpen || !toolCall || toolType !== ToolType.FERN) return;
    const progress = subAgentProgress?.get(toolCall.id) || [];
    if (progress.length === 0) return;
    try {
      const extracted = extractFernData(toolCall, progress);
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

    if (toolType === ToolType.WEB_SEARCH) return <WebSearchView {...toolData} />;
    if (toolType === ToolType.FERN) return <NavisView {...toolData} toolName={toolCall?.toolName || 'Fern'} />;
    if (toolType === ToolType.TERMINAL) return <TerminalView {...toolData} />;
    if (toolType === ToolType.SKILL) return <SkillView {...toolData} />;
    if (toolType === ToolType.FILE_SYSTEM) return <FileSystemView {...toolData} />;
    if (toolType === ToolType.LOCAL_PERMISSION) return <LocalPermissionView {...toolData} />;
    if (toolType === ToolType.IMAGE_ANALYSIS) return <ImageAnalysisView {...toolData} />;
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
            animate={isDesktop ? { width: 460, opacity: 1 } : { x: 0 }}
            exit={isDesktop ? { width: 0, opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
          >
            {/* Inner wrapper prevents layout reflow during animation */}
            <div style={{
              width: isDesktop ? 460 : '100%', height: '100%',
              display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
            }}>
              {toolCall && <PanelHeader agentName={toolCall.agentName} toolName={toolCall.toolName} onClose={onClose} />}

              <motion.div
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.07, duration: 0.2 }}
              >
                {renderContent()}
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
