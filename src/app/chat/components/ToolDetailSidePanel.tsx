'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Terminal, Search, Globe, CameraOff, Maximize2, Copy, Check,
  Clock, AlertTriangle, CheckCircle, Link2, ExternalLink, Info,
  Braces, ChevronDown, ChevronRight, Loader2, AlertCircle
} from 'lucide-react';

/* ============================================================
   TYPES
   ============================================================ */
export const ToolType = { WEB_SEARCH: 'web_search', NAVIS: 'navis', TERMINAL: 'terminal', GENERIC: 'generic' };

/* ============================================================
   UTILITIES
   ============================================================ */
export function detectToolType(toolName: string): string {
  const n = toolName.toLowerCase();
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

function getToolMeta(toolName: string) {
  const n = toolName.toLowerCase();
  if (n.includes('web_search') || n.includes('search')) return { Icon: Search, label: 'Web Search' };
  if (n.includes('navis') || n.includes('browser') || n.includes('computer_use')) return { Icon: Globe, label: 'Browser' };
  if (n.includes('run_command') || n.includes('bash') || n.includes('terminal')) return { Icon: Terminal, label: 'Terminal' };
  return { Icon: Braces, label: 'Tool' };
}

/* ============================================================
   ANIMATED SVG BACKGROUND GRID (monochrome decoration)
   ============================================================ */
function GridDeco() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.035, pointerEvents: 'none' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
}

/* ============================================================
   ANIMATED CAMERA SVG (empty navis state)
   ============================================================ */
function AnimatedCameraOff() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <motion.rect
        x="4" y="16" width="48" height="34" rx="5"
        stroke="currentColor" strokeWidth="1.5" fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      <motion.circle
        cx="28" cy="33" r="9"
        stroke="currentColor" strokeWidth="1.5" fill="none"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.6, type: 'spring', stiffness: 200 }}
      />
      <motion.path
        d="M18 16 L22 8 H34 L38 16"
        stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
      />
      <motion.line
        x1="8" y1="8" x2="48" y2="48"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.5 }}
        transition={{ delay: 0.9, duration: 0.5, ease: 'easeOut' }}
      />
      <motion.circle
        cx="28" cy="33" r="2"
        fill="currentColor"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.4 }}
        transition={{ delay: 1.1, duration: 0.3, type: 'spring' }}
      />
    </svg>
  );
}

/* ============================================================
   ANIMATED SEARCH SVG (empty search state)
   ============================================================ */
function AnimatedSearchEmpty() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <motion.circle
        cx="22" cy="22" r="15"
        stroke="currentColor" strokeWidth="1.5" fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
      <motion.line
        x1="33" y1="33" x2="46" y2="46"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.7, duration: 0.4 }}
      />
      <motion.line
        x1="14" y1="22" x2="30" y2="22"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity={0.4}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        style={{ originX: '14px' }}
        transition={{ delay: 1, duration: 0.4 }}
      />
      <motion.line
        x1="14" y1="26" x2="24" y2="26"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity={0.25}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        style={{ originX: '14px' }}
        transition={{ delay: 1.1, duration: 0.35 }}
      />
    </svg>
  );
}

/* ============================================================
   PANEL HEADER  (redesigned — monochrome, spacious)
   ============================================================ */
interface PanelHeaderProps {
  agentName?: string;
  toolName: string;
  onClose: () => void;
}

function PanelHeader({ agentName, toolName, onClose }: PanelHeaderProps) {
  const { Icon, label } = getToolMeta(toolName);
  return (
    <header style={{
      background: '#fff',
      borderBottom: '1px solid #f0f0f0',
      padding: '24px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 18,
      flexShrink: 0,
    }}>
      {/* Left: icon + meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        {/* Icon ring */}
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: '#f8f8f8', border: '1px solid #e0e0e0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={18} color="#444" strokeWidth={1.75} />
        </div>

        {/* Text */}
        <div style={{ minWidth: 0 }}>
          {/* Breadcrumb row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {agentName && (
              <>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#111', letterSpacing: '-0.01em' }}>
                  {agentName}
                </span>
                <span style={{ fontSize: 12, color: '#ccc', userSelect: 'none' }}>·</span>
              </>
            )}
            <span style={{ fontSize: 12, color: '#888' }}>using</span>
            <code style={{
              fontSize: 11.5, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontWeight: 600, color: '#111',
              background: '#f4f4f5', border: '1px solid #e4e4e7',
              padding: '3px 9px', borderRadius: 6,
            }}>
              {toolName}
            </code>
          </div>
          {/* Type badge */}
          <p style={{ fontSize: 10.5, color: '#aaa', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
            {label}
          </p>
        </div>
      </div>

      {/* Right: dot status + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <motion.div
          style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }}
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
          title="Live"
        />
        <button
          onClick={onClose}
          aria-label="Close panel"
          style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid #e4e4e7',
            background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#888', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f4f4f5'; e.currentTarget.style.color = '#111'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}

/* ============================================================
   SECTION LABEL
   ============================================================ */
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      padding: '24px 32px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(8px)',
      borderBottom: '1px solid #f3f4f6',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {children}
      </span>
      {right && (
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#4b5563',
          background: '#f3f4f6', border: '1px solid #e5e7eb',
          padding: '4px 12px', borderRadius: 20,
        }}>
          {right}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   EMPTY STATE (full-area, animated)
   ============================================================ */
interface EmptyStateProps {
  icon: React.ComponentType;
  title: string;
  description: string;
  note?: string;
}

function EmptyState({ icon: IconSvg, title, description, note }: EmptyStateProps) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '80px 48px',
      position: 'relative', overflow: 'hidden',
      background: '#fafafa',
    }}>
      <GridDeco />

      {/* Glow disc */}
      <motion.div
        style={{
          position: 'absolute', width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,0,0,0.035) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
      />

      {/* Icon container */}
      <motion.div
        style={{
          width: 96, height: 96, borderRadius: 24,
          background: '#fff', border: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#a1a1aa', marginBottom: 32, position: 'relative',
          boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
        }}
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, type: 'spring', stiffness: 200 }}
      >
        <IconSvg />
      </motion.div>

      {/* Text */}
      <motion.h3
        style={{ fontSize: 16, fontWeight: 600, color: '#18181b', margin: '0 0 12px', textAlign: 'center', letterSpacing: '-0.02em' }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        {title}
      </motion.h3>
      <motion.p
        style={{ fontSize: 13.5, color: '#71717a', margin: '0 0 32px', textAlign: 'center', maxWidth: 320, lineHeight: 1.7 }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.4 }}
      >
        {description}
      </motion.p>

      {note && (
        <motion.div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            background: '#fff', border: '1px solid #e5e7eb',
            borderRadius: 14, padding: '16px 20px', maxWidth: 360,
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.4 }}
        >
          <Globe size={15} color="#a1a1aa" style={{ marginTop: 2, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#71717a', lineHeight: 1.65 }}>{note}</span>
        </motion.div>
      )}
    </div>
  );
}

/* ============================================================
   SCREENSHOT CARD
   ============================================================ */
interface ScreenshotCardProps {
  screenshot: any;
  index: number;
  onZoom: (s: any) => void;
}

function ScreenshotCard({ screenshot, index, onZoom }: ScreenshotCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <motion.div
      onClick={() => onZoom(screenshot)}
      style={{
        borderRadius: 16, overflow: 'hidden', background: '#fff',
        border: '1px solid #e5e7eb', cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.01)',
      }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: 'spring', stiffness: 220, damping: 22 }}
      whileHover={{ borderColor: '#a1a1aa', y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.04)' }}
    >
      <div style={{ position: 'relative', background: '#f3f4f6', aspectRatio: '16/9', overflow: 'hidden' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              style={{ width: 22, height: 22, border: '2px solid #e5e7eb', borderTopColor: '#71717a', borderRadius: '50%' }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
            />
          </div>
        )}
        {!error ? (
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt={`Capture ${index + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#a1a1aa', gap: 8 }}>
            <CameraOff size={24} />
            <span style={{ fontSize: 12 }}>Failed to load</span>
          </div>
        )}
        {/* Hover overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.18)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0)'}
        >
          <div style={{ padding: '8px', background: 'rgba(255,255,255,0.95)', borderRadius: 10, opacity: 0, transition: 'opacity 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          >
            <Maximize2 size={14} color="#111" />
          </div>
        </div>
        <div style={{
          position: 'absolute', top: 12, left: 12,
          fontSize: 10, fontWeight: 700, color: '#fff',
          background: 'rgba(24,24,27,0.75)', padding: '3px 8px', borderRadius: 6, letterSpacing: '0.06em',
          backdropFilter: 'blur(4px)',
        }}>#{index + 1}</div>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#27272a' }}>Capture {index + 1}</span>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontFamily: 'ui-monospace, monospace' }}>
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
        position: 'fixed', inset: 0, background: 'rgba(9,9,11,0.92)',
        backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100, padding: 28,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ position: 'relative', maxWidth: '90vw', width: '100%' }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: -48, right: 0,
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 10, width: 36, height: 36, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        >
          <X size={16} />
        </button>
        <motion.img
          src={`data:image/png;base64,${screenshot.base64}`}
          alt="Zoomed"
          style={{ width: '100%', maxHeight: '82vh', objectFit: 'contain', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}
          initial={{ scale: 0.94, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.94, y: 20 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        />
      </div>
    </motion.div>
  );
}

/* ============================================================
   NAVIS VIEW
   ============================================================ */
function NavisScreenshotView({ screenshots = [], toolName }: { screenshots: any[]; toolName: string }) {
  const [zoomed, setZoomed] = useState<any>(null);
  const safe = Array.isArray(screenshots) ? screenshots : [];

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SectionLabel>Browser Session</SectionLabel>
        <EmptyState
          icon={AnimatedCameraOff}
          title="No screenshots captured"
          description={`${toolName} ran successfully but didn't generate any screen captures during this session.`}
          note="Screenshots appear here in real-time as the browser agent navigates pages and completes actions."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionLabel right={`${safe.length} capture${safe.length !== 1 ? 's' : ''}`}>
        Execution History
      </SectionLabel>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {safe.map((s, i) => (
          <ScreenshotCard key={`${s.timestamp}-${i}`} screenshot={s} index={i} onZoom={setZoomed} />
        ))}
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
interface TerminalOutputViewProps {
  command: string;
  output: string;
  exitCode?: number;
  duration?: number;
}

function TerminalOutputView({ command, output, exitCode, duration }: TerminalOutputViewProps) {
  const [copied, setCopied] = useState(false);
  const isError = exitCode !== undefined && exitCode !== 0;
  const clean = output?.replace(/\x1b\[[0-9;]*m/g, '') || '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#090b10', overflow: 'hidden' }}>
      {/* Terminal header */}
      <div style={{
        padding: '20px 32px', background: '#0c0e14',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Terminal
          </span>
        </div>
        <button onClick={handleCopy} style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'transparent',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
          padding: '6px 14px', cursor: 'pointer', color: copied ? '#4ade80' : 'rgba(255,255,255,0.45)',
          fontSize: 11.5, fontWeight: 600, transition: 'all 0.15s',
        }}>
          {copied ? <><Check size={13} /><span>Copied</span></> : <><Copy size={13} /><span>Copy Logs</span></>}
        </button>
      </div>

      {/* Command row */}
      <div style={{ padding: '20px 32px', background: '#0c0e14', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' }}>
          <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13.5, userSelect: 'none', marginTop: 2 }}>$</span>
          <code style={{ color: '#f3f4f6', fontSize: 13.5, lineHeight: 1.7, wordBreak: 'break-all', fontWeight: 500 }}>{command}</code>
        </div>
      </div>

      {/* Status bar */}
      {(exitCode !== undefined || duration !== undefined) && (
        <div style={{
          padding: '14px 32px', background: '#0a0d12',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {exitCode !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>Status</span>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
                background: isError ? 'rgba(239,68,68,0.12)' : 'rgba(74,222,128,0.1)',
                border: `1px solid ${isError ? 'rgba(239,68,68,0.25)' : 'rgba(74,222,128,0.2)'}`,
                color: isError ? '#f87171' : '#4ade80',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {isError ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
                {isError ? `ERR (${exitCode})` : 'OK'}
              </span>
            </div>
          )}
          {duration !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.35)', fontSize: 11.5 }}>
              <Clock size={13} />
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatDuration(duration)}</span>
            </div>
          )}
        </div>
      )}

      {/* Output */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <pre style={{
          margin: 0, padding: '32px 32px',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 13, lineHeight: 1.9,
          color: isError ? '#fca5a5' : 'rgba(255,255,255,0.8)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <code>{clean || <span style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', fontFamily: 'inherit' }}>(no output)</span>}</code>
        </pre>
      </div>

      {/* Footer status */}
      {exitCode !== undefined && (
        <div style={{
          padding: '14px 32px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          background: isError ? 'rgba(239,68,68,0.06)' : 'rgba(74,222,128,0.05)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <motion.div
            style={{ width: 7, height: 7, borderRadius: '50%', background: isError ? '#ef4444' : '#22c55e' }}
            animate={isError ? { opacity: [1, 0.3, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.8 }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: isError ? '#f87171' : '#4ade80', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {isError ? 'Process exited with errors' : 'Process completed'}
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SEARCH RESULT CARD
   ============================================================ */
interface SearchResultCardProps {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  favicon?: string;
}

function SearchResultCard({ title, url, snippet, domain, favicon }: SearchResultCardProps) {
  return (
    <motion.article
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && window.open(url, '_blank')}
      style={{
        padding: '24px 28px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, cursor: 'pointer', position: 'relative', overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.01)'
      }}
      whileHover={{ borderColor: '#a1a1aa', y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.03)' }}
      transition={{ duration: 0.15 }}
    >
      {/* Domain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {favicon && <img src={favicon} alt="" style={{ width: 16, height: 16, borderRadius: 4, opacity: 0.8 }} onError={e => e.currentTarget.style.display = 'none'} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{domain}</span>
      </div>

      {/* Title */}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#18181b', margin: '0 0 10px', lineHeight: 1.5, letterSpacing: '-0.01em' }}>
        {title}
      </h3>

      {/* Snippet */}
      <p style={{ fontSize: 13, color: '#52525b', lineHeight: 1.75, margin: '0 0 16px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {snippet}
      </p>

      {/* URL row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontFamily: 'ui-monospace, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link2 size={12} color="#cbcbcb" />
          {truncateText(url, 46)}
        </span>
        <ExternalLink size={13} color="#a1a1aa" />
      </div>
    </motion.article>
  );
}

/* ============================================================
   WEB SEARCH VIEW
   ============================================================ */
interface WebSearchResultsViewProps {
  query: string;
  results?: any[];
  totalResults?: number;
}

function WebSearchResultsView({ query, results = [], totalResults = 0 }: WebSearchResultsViewProps) {
  const safe = Array.isArray(results) ? results : [];

  if (safe.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '24px 32px 0', background: '#fff', flexShrink: 0 }}>
          <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 24px' }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Query</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#18181b', margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5 }}>"{query}"</p>
          </div>
        </div>
        <EmptyState
          icon={AnimatedSearchEmpty}
          title="No results found"
          description="The search did not return any matches for this query."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Query box */}
      <div style={{ padding: '24px 32px 0', background: '#fff', flexShrink: 0 }}>
        <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 24px', marginBottom: 8 }}>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Query</p>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#18181b', margin: 0, letterSpacing: '-0.01em', lineHeight: 1.5 }}>"{query}"</p>
        </div>
      </div>

      <SectionLabel right={`${totalResults} results`}>Search Results</SectionLabel>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {safe.map((r, i) => (
          <SearchResultCard key={`${r.url}-${i}`} {...r} favicon={r.favicon || getFaviconUrl(r.domain)} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   GENERIC TOOL VIEW
   ============================================================ */
interface CollapsibleSectionProps {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ icon: Icon, label, badge, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #f3f4f6', background: '#fff' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f4f4f5', border: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={15} color="#52525b" strokeWidth={1.75} />
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#18181b' }}>{label}</span>
          {badge && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#71717a', background: '#f4f4f5', border: '1px solid #e4e4e7', padding: '3px 10px', borderRadius: 20, fontFamily: 'ui-monospace, monospace' }}>
              {badge}
            </span>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18 }}>
          <ChevronDown size={15} color="#a1a1aa" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden', borderTop: '1px solid #f3f4f6', background: '#fafafa' }}
          >
            <div style={{ padding: '20px 32px 28px' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface GenericToolViewProps {
  toolName: string;
  args?: any;
  output?: string;
}

function GenericToolView({ toolName, args, output }: GenericToolViewProps) {
  const [copied, setCopied] = useState(false);
  const argEntries = Object.entries(args || {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '26px 32px', borderBottom: '1px solid #f3f4f6', background: '#fff', flexShrink: 0 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#18181b', margin: '0 0 6px', letterSpacing: '-0.02em' }}>{toolName}</h3>
        <p style={{ fontSize: 12.5, color: '#71717a', margin: 0 }}>Tool execution diagnostics</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: '#fafafa' }}>
        {argEntries.length > 0 && (
          <CollapsibleSection icon={Braces} label="Arguments" badge={`${argEntries.length} field${argEntries.length !== 1 ? 's' : ''}`}>
            <pre style={{
              margin: 0, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 12, lineHeight: 1.8, overflowX: 'auto',
              background: '#090b10', color: 'rgba(255,255,255,0.8)',
              padding: '22px 24px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)',
              maxHeight: 300,
            }}>
              <code>{JSON.stringify(args, null, 2)}</code>
            </pre>
          </CollapsibleSection>
        )}

        {output && (
          <CollapsibleSection icon={Terminal} label="Output" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={async () => { try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { } }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #e4e4e7', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 11.5, color: copied ? '#22c55e' : '#71717a', fontWeight: 600, transition: 'all 0.15s' }}>
                {copied ? <><Check size={12} /><span>Copied</span></> : <><Copy size={12} /><span>Copy Logs</span></>}
              </button>
            </div>
            <pre style={{
              margin: 0, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 12, lineHeight: 1.85, overflowX: 'auto',
              background: '#090b10', color: 'rgba(255,255,255,0.8)',
              padding: '22px 24px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)',
              maxHeight: 400,
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
   DATA EXTRACTION HELPERS
   ============================================================ */
function extractWebSearchData(toolCall: any) {
  try {
    const query = toolCall.args?.query || '';
    const raw = toolCall.data?.results;
    const results = Array.isArray(raw) ? raw : [];
    return { query, results: results.slice(0, 50), totalResults: results.length };
  } catch { return null; }
}

function extractNavisData(toolCall: any) {
  try {
    const screenshots: any[] = [];
    const seen = new Set();
    const add = (b64: string, ts: any, seq: number) => {
      if (!b64) return;
      let clean = b64.startsWith('data:image') ? b64.substring(b64.indexOf(',') + 1) : b64;
      if (!seen.has(clean)) { seen.add(clean); screenshots.push({ base64: clean, timestamp: ts, sequenceNumber: seq }); }
    };
    if (Array.isArray(toolCall.data?.screenshots)) {
      toolCall.data.screenshots.forEach((s: any, i: number) => {
        if (s?.base64) add(s.base64, s.timestamp || Date.now(), s.sequenceNumber ?? i);
        else if (typeof s === 'string') add(s, Date.now(), i);
      });
    }
    if (toolCall.data?.screenshot) {
      const s = toolCall.data.screenshot;
      if (typeof s === 'string') add(s, Date.now(), screenshots.length);
      else if (Array.isArray(s)) s.forEach(img => typeof img === 'string' && add(img, Date.now(), screenshots.length));
    }
    if (typeof toolCall.data?.base64Image === 'string') add(toolCall.data.base64Image, Date.now(), screenshots.length);
    return { screenshots, url: toolCall.args?.url, action: toolCall.args?.action };
  } catch { return null; }
}

function extractTerminalData(toolCall: any) {
  return {
    command: toolCall.args?.command || toolCall.args?.CommandLine || '',
    output: toolCall.output || '',
    exitCode: toolCall.data?.exitCode,
    duration: toolCall.duration,
  };
}

function extractGenericData(toolCall: any) {
  return { toolName: toolCall.toolName, args: toolCall.args || {}, output: toolCall.output || '' };
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
}

export default function ToolDetailSidePanel({ isOpen, toolCall, onClose, conversationId }: ToolDetailSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [toolType, setToolType] = useState(ToolType.GENERIC);
  const [toolData, setToolData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isOpen || !toolCall) { setToolData(null); setError(null); return; }
    setIsLoading(true); setError(null);
    try {
      const cached = cache.get(toolCall.id);
      if (cached) { setToolData(cached.data); setToolType(cached.type); setIsLoading(false); return; }
      const type = detectToolType(toolCall.toolName);
      setToolType(type);
      let extracted;
      if (type === ToolType.WEB_SEARCH) extracted = extractWebSearchData(toolCall);
      else if (type === ToolType.NAVIS) extracted = extractNavisData(toolCall);
      else if (type === ToolType.TERMINAL) extracted = extractTerminalData(toolCall);
      else extracted = extractGenericData(toolCall);
      if (!extracted && type !== ToolType.GENERIC) { setToolType(ToolType.GENERIC); extracted = extractGenericData(toolCall); }
      setToolData(extracted);
      cache.set(toolCall.id, { data: extracted, type });
    } catch { setError('Failed to load tool details'); }
    setIsLoading(false);
  }, [isOpen, toolCall]);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc as any);
    return () => document.removeEventListener('keydown', esc as any);
  }, [isOpen, onClose]);

  const renderContent = () => {
    if (isLoading) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <motion.div style={{ width: 32, height: 32, border: '2px solid #e5e7eb', borderTopColor: '#52525b', borderRadius: '50%' }}
          animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }} />
        <span style={{ fontSize: 13.5, color: '#a1a1aa', fontWeight: 500 }}>Loading details…</span>
      </div>
    );

    if (error) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 36, textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fef2f2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <AlertCircle size={22} color="#ef4444" />
        </div>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#18181b', margin: '0 0 8px' }}>{error}</p>
        <p style={{ fontSize: 12.5, color: '#a1a1aa', margin: 0 }}>Please try reopening the panel.</p>
      </div>
    );

    if (!toolData) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 13.5, color: '#a1a1aa' }}>No data available</p>
      </div>
    );

    if (toolType === ToolType.WEB_SEARCH) return <WebSearchResultsView {...toolData} />;
    if (toolType === ToolType.NAVIS) return <NavisScreenshotView {...toolData} toolName={toolCall?.toolName || 'NAVIS'} />;
    if (toolType === ToolType.TERMINAL) return <TerminalOutputView {...toolData} />;
    return <GenericToolView {...toolData} />;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (mobile/tablet only) */}
          <motion.div
            style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,11,0.5)', zIndex: 40 }}
            className="lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel Container */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="complementary"
            aria-label="Tool execution details"
            style={isDesktop ? {
              position: 'relative',
              height: '100%',
              background: '#fff',
              borderLeft: '1px solid #ebebeb',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              outline: 'none',
              flexShrink: 0,
            } : {
              position: 'fixed', right: 0, top: 0, bottom: 0,
              width: 'min(100%, 560px)',
              background: '#fff',
              borderLeft: '1px solid #ebebeb',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 50,
              overflow: 'hidden',
              outline: 'none',
            }}
            initial={isDesktop ? { width: 0, opacity: 0 } : { x: '100%' }}
            animate={isDesktop ? { width: 480, opacity: 1 } : { x: 0 }}
            exit={isDesktop ? { width: 0, opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            {/* Fixed-width child container prevents layout reflows during sliding animation */}
            <div style={{
              width: isDesktop ? 480 : '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {toolCall && (
                <PanelHeader agentName={toolCall.agentName} toolName={toolCall.toolName} onClose={onClose} />
              )}

              <motion.div
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.06, duration: 0.2 }}
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
