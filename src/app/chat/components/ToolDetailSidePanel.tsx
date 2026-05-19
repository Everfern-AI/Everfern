'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, AlertTriangle, CheckCircle, Link2, ExternalLink,
  Braces, ChevronDown, AlertCircle, ArrowUpRight
} from 'lucide-react';

/* ============================================================
   TYPES
   ============================================================ */
export const ToolType = {
  WEB_SEARCH: 'web_search',
  NAVIS: 'navis',
  TERMINAL: 'terminal',
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
  const n = (toolName || "").toLowerCase();
  if (n.includes('web_search') || n.includes('remote_web_search') || n.includes('search')) return ToolType.WEB_SEARCH;
  if (n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return ToolType.NAVIS;
  if (n.includes('run_command') || n.includes('bash') || n.includes('run_terminal') || n.includes('execute')) return ToolType.TERMINAL;
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
  if (n.includes('web_search') || n.includes('search')) return { Icon: Search, label: 'Web Search' };
  if (n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
  if (n.includes('run_command') || n.includes('bash') || n.includes('terminal')) return { Icon: Terminal, label: 'Terminal' };
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
  const { Icon, label } = getToolMeta(toolName);

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
          background: T.surfaceRaised, border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.04)',
        }}>
          <Icon size={16} color={T.textSecondary} strokeWidth={1.75} />
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
              fontSize: 11.5, fontFamily: T.mono, fontWeight: 600, color: T.text,
              background: T.surfaceRaised, border: `1px solid ${T.border}`,
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
            width: 30, height: 30, borderRadius: T.r8, border: `1px solid ${T.border}`,
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: T.textMuted, transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = T.surfaceRaised; e.currentTarget.style.color = T.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = T.textMuted; }}
        >
          <X size={13} strokeWidth={2} />
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
          fontSize: 10.5, fontWeight: 600, color: T.textSecondary,
          background: T.surfaceRaised, border: `1px solid ${T.border}`,
          padding: '3px 10px', borderRadius: 20, fontFamily: T.mono,
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
      <div style={{ position: 'relative', maxWidth: '90vw', width: '100%' }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: -44, right: 0,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: T.r8, width: 32, height: 32, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <X size={14} />
        </button>
        <motion.img
          src={`data:image/png;base64,${screenshot.base64}`}
          alt="Full screenshot"
          style={{
            width: '100%', maxHeight: '84vh', objectFit: 'contain',
            borderRadius: T.r12, border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
          }}
          initial={{ scale: 0.96, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 16 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        />
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

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SectionLabel>Browser session</SectionLabel>
        <EmptyState
          icon={IconCamera}
          title="No captures yet"
          description={`${toolName} ran but didn't produce screenshots during this session.`}
          note="Frames appear here in real-time as the browser navigates."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionLabel right={`${safe.length} frame${safe.length !== 1 ? 's' : ''}`}>Execution history</SectionLabel>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {safe.map((s, i) => <ScreenshotCard key={`${s.timestamp}-${i}`} screenshot={s} index={i} onZoom={setZoomed} />)}
      </div>
      <AnimatePresence>
        {zoomed && <ZoomModal screenshot={zoomed} onClose={() => setZoomed(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   TERMINAL VIEW
   ============================================================ */
function TerminalView({ command, output, exitCode, duration }: { command: string; output: string; exitCode?: number; duration?: number }) {
  const isError = exitCode !== undefined && exitCode !== 0;
  const clean = output?.replace(/\x1b\[[0-9;]*m/g, '') || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.inkBg, overflow: 'hidden' }}>
      {/* Bar */}
      <div style={{
        padding: '14px 24px',
        background: T.inkSurface,
        borderBottom: `1px solid ${T.inkBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Traffic lights */}
          <div style={{ display: 'flex', gap: 5 }}>
            {['#ff5f57', '#febc2e', '#28c840'].map(c => (
              <div key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c, opacity: 0.85 }} />
            ))}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.inkMuted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.sans }}>
            Terminal
          </span>
        </div>
        <CopyBtn text={output} dark />
      </div>

      {/* Command */}
      <div style={{ padding: '18px 24px 14px', background: T.inkSurface, borderBottom: `1px solid ${T.inkBorder}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10, fontFamily: T.mono }}>
          <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13, userSelect: 'none', flexShrink: 0 }}>$</span>
          <code style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 1.7, wordBreak: 'break-all', fontWeight: 500 }}>{command}</code>
        </div>
      </div>

      {/* Status bar */}
      {(exitCode !== undefined || duration !== undefined) && (
        <div style={{
          padding: '10px 24px',
          background: T.inkBg,
          borderBottom: `1px solid ${T.inkBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          {exitCode !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, fontFamily: T.sans,
                background: isError ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.09)',
                border: `1px solid ${isError ? 'rgba(239,68,68,0.22)' : 'rgba(74,222,128,0.18)'}`,
                color: isError ? '#f87171' : '#4ade80',
              }}>
                {isError ? <AlertTriangle size={10} /> : <CheckCircle size={10} />}
                {isError ? `exit ${exitCode}` : 'ok'}
              </div>
            </div>
          )}
          {duration !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.inkMuted, fontSize: 11, fontFamily: T.mono }}>
              <Clock size={11} />
              {formatDuration(duration)}
            </div>
          )}
        </div>
      )}

      {/* Output */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <pre style={{
          margin: 0, padding: '24px',
          fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.9,
          color: isError ? '#fca5a5' : T.inkText,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <code>{clean || <span style={{ color: T.inkMuted, fontStyle: 'italic' }}>(no output)</span>}</code>
        </pre>
      </div>

      {/* Footer */}
      {exitCode !== undefined && (
        <div style={{
          padding: '10px 24px', flexShrink: 0,
          borderTop: `1px solid ${T.inkBorder}`,
          background: isError ? 'rgba(239,68,68,0.05)' : 'rgba(74,222,128,0.04)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <motion.div
            style={{ width: 6, height: 6, borderRadius: '50%', background: isError ? T.red : T.green }}
            animate={isError ? { opacity: [1, 0.3, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.8 }}
          />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: T.sans, color: isError ? '#f87171' : '#4ade80',
          }}>
            {isError ? 'exited with errors' : 'completed'}
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SEARCH RESULT CARD
   ============================================================ */
function ResultCard({ title, url, snippet, description: initialDescription, domain, favicon: initialFavicon }: { title: string; url: string; snippet?: string; description?: string; domain: string; favicon?: string }) {
  const [description, setDescription] = useState(initialDescription);
  const [favicon, setFavicon] = useState(initialFavicon);

  useEffect(() => {
    // If we're missing rich info, try to fetch it lazily
    if (!initialDescription || !initialFavicon) {
      const fetchMeta = async () => {
        try {
          const api = (window as any).electronAPI;
          if (!api?.system?.fetchMetadata) return;
          
          const meta = await api.system.fetchMetadata(url);
          if (meta) {
            if (!initialDescription && meta.description) setDescription(meta.description);
            if (!initialFavicon && meta.favicon) setFavicon(meta.favicon);
          }
        } catch { /* ignore */ }
      };
      fetchMeta();
    }
  }, [url, initialDescription, initialFavicon]);

  const content = description || snippet || '';
  const displayFavicon = favicon || getFaviconUrl(domain);
  
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
          {domain}
        </span>
      </div>

      {/* Title */}
      <h3 style={{
        fontSize: 13.5, fontWeight: 600, color: T.text, margin: '0 0 8px',
        lineHeight: 1.45, letterSpacing: '-0.015em', fontFamily: T.sans,
      }}>
        {title}
      </h3>

      {/* Snippet / Description */}
      {content && (
        <p style={{
          fontSize: 12.5, color: T.textSecondary, lineHeight: 1.7, margin: '0 0 14px',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          fontFamily: T.sans,
        }}>
          {content}
        </p>
      )}

      {/* URL row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: `1px solid ${T.borderSubtle}`, paddingTop: 12,
      }}>
        <span style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.mono, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Link2 size={10} color={T.textPlaceholder} strokeWidth={2} />
          {truncateText(url, 44)}
        </span>
        <ArrowUpRight size={12} color={T.textMuted} strokeWidth={1.75} />
      </div>
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
   DATA EXTRACTION
   ============================================================ */
export function extractWebSearchData(tc: any) {
  try {
    const query = tc.args?.query || '';
    const raw = tc.data?.results;
    const results = Array.isArray(raw) ? raw : [];
    
    // Process results to include domain and ensure favicon fallback
    const processed = results.map(r => {
      let domain = r.domain || '';
      if (!domain && r.url) {
        try {
          domain = new URL(r.url).hostname;
        } catch { /* ignore */ }
      }
      return { ...r, domain };
    });

    return { query, results: processed.slice(0, 50), totalResults: results.length };
  } catch { return null; }
}

export function extractNavisData(tc: any, progressEvents: any[] = []) {
  try {
    const screenshots: any[] = [];
    const seen = new Set();
    const add = (b64: string, ts: any, seq: number) => {
      if (!b64) return;
      const clean = b64.startsWith('data:image') ? b64.substring(b64.indexOf(',') + 1) : b64;
      if (!seen.has(clean)) {
        seen.add(clean);
        screenshots.push({ base64: clean, timestamp: ts, sequenceNumber: seq });
      }
    };

    // 1. Process real-time progress events first (higher priority for live view)
    if (Array.isArray(progressEvents)) {
      progressEvents.forEach((e: any, i: number) => {
        if (e.type === 'screenshot') {
          const b64 = e.screenshot?.base64 || e.content;
          if (b64) add(b64, e.timestamp || Date.now(), i);
        }
      });
    }

    // 2. Process tc.data.screenshot (mapped in chat/page.tsx)
    const sData = tc.data?.screenshot;
    if (Array.isArray(sData)) {
      sData.forEach((s: any, i: number) => {
        if (typeof s === 'string') add(s, Date.now(), i);
        else if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i);
      });
    } else if (typeof sData === 'string') {
      add(sData, Date.now(), 0);
    }

    // 3. Process historical screenshots
    if (Array.isArray(tc.data?.screenshots)) {
      tc.data.screenshots.forEach((s: any, i: number) => {
        if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i);
        else if (typeof s === 'string') add(s, Date.now(), i);
      });
    }
    
    if (typeof tc.data?.base64Image === 'string') add(tc.data.base64Image, Date.now(), screenshots.length);
    
    // Sort by timestamp/sequence to ensure correct order before reversing
    return { screenshots: screenshots.reverse(), url: tc.args?.url, action: tc.args?.action };
  } catch { return null; }
}

function extractTerminalData(tc: any) {
  return { command: tc.args?.command || tc.args?.CommandLine || '', output: tc.output || '', exitCode: tc.data?.exitCode, duration: tc.duration };
}

function extractGenericData(tc: any) {
  return { toolName: tc.toolName, args: tc.args || {}, output: tc.output || '' };
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
}

export default function ToolDetailSidePanel({ isOpen, toolCall, onClose, conversationId, subAgentProgress }: ToolDetailSidePanelProps) {
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

  useEffect(() => {
    if (!isOpen || !toolCall) { setToolData(null); setError(null); return; }
    
    // For live Navis sessions, we don't want to show loading spinner every time a screenshot comes in
    // if we already have some data.
    if (!toolData || toolData.toolCallId !== toolCall.id) {
        setIsLoading(true); 
    }
    
    setError(null);
    try {
      const type = detectToolType(toolCall.toolName);
      setToolType(type);
      
      let extracted: any;
      if (type === ToolType.WEB_SEARCH) {
        extracted = extractWebSearchData(toolCall);
      } else if (type === ToolType.NAVIS) {
        const progress = subAgentProgress?.get(toolCall.id) || [];
        extracted = extractNavisData(toolCall, progress);
      } else if (type === ToolType.TERMINAL) {
        extracted = extractTerminalData(toolCall);
      } else {
        extracted = extractGenericData(toolCall);
      }
      
      if (!extracted && type !== ToolType.GENERIC) { 
        setToolType(ToolType.GENERIC); 
        extracted = extractGenericData(toolCall); 
      }
      
      // Store ID to help with re-loading logic
      if (extracted) extracted.toolCallId = toolCall.id;
      
      setToolData(extracted);
    } catch { setError('Failed to load details'); }
    setIsLoading(false);
  }, [isOpen, toolCall, subAgentProgress]);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
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
    if (toolType === ToolType.NAVIS) return <NavisView {...toolData} toolName={toolCall?.toolName || 'Navis'} />;
    if (toolType === ToolType.TERMINAL) return <TerminalView {...toolData} />;
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
