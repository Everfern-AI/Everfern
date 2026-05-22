'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';

/* ─── Types ───────────────────────────────────────────────────────── */

interface CursorState {
  // Raw physical coords from robotjs
  rawX: number;
  rawY: number;
  // Physical screen dimensions (from main process)
  screenW: number;
  screenH: number;
  actionType: string;
  description: string;
  visible: boolean;
}

interface ClickRipple {
  id: number;
  // percentage positions so they scale with the overlay
  xPct: number;
  yPct: number;
  type: string;
}

interface OverlayState {
  active: boolean;
  task?: string;
  screenWidth?: number;
  screenHeight?: number;
}

/* ─── Navis-style cursor SVG ──────────────────────────────────────── */

function FernCursor({ actionType }: { actionType: string }) {
  const isClick = actionType === 'click' || actionType === 'left_click'
    || actionType === 'right_click' || actionType === 'double_click'
    || actionType === 'triple_click' || actionType === 'middle_click';
  const isType = actionType === 'type';
  const isDrag = actionType === 'drag';
  const isScroll = actionType === 'scroll';

  const glowColor =
    isClick ? '#22d3ee' :
    isScroll ? '#a78bfa' :
    isDrag ? '#f59e0b' :
    isType ? '#10b981' :
    '#6366f1';

  const baseStyle: React.CSSProperties = {
    filter: `drop-shadow(0 0 6px ${glowColor}) drop-shadow(0 0 14px ${glowColor}66)`,
  };

  if (isType) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={baseStyle}>
        <path d="M9 4H15M12 4V20M9 20H15" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 4H15M12 4V20M9 20H15" stroke={glowColor} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      </svg>
    );
  }

  if (isClick || actionType === 'hover') {
    return (
      <svg width="28" height="34" viewBox="0 0 28 34" fill="none" style={baseStyle}>
        <path d="M12 15V6C12 4.34315 10.6569 3 9 3C7.34315 3 6 4.34315 6 6V16.5C6 16.5 4.5 15 3.5 15C2.11929 15 1 16.1193 1 17.5C1 18.5 2.5 20.5 4 23C5.5 25.5 7.5 28 10.5 28H15.5C18.5376 28 21 25.5376 21 22.5V14.5C21 12.567 19.433 11 17.5 11C16.5335 11 15.6585 11.3915 15 12.0247C14.7368 10.3168 13.2647 9 11.5 9V15L12 15Z"
          fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="1.2" />
        <path d="M12 15V6C12 4.34315 10.6569 3 9 3C7.34315 3 6 4.34315 6 6V16.5C6 16.5 4.5 15 3.5 15C2.11929 15 1 16.1193 1 17.5C1 18.5 2.5 20.5 4 23C5.5 25.5 7.5 28 10.5 28H15.5C18.5376 28 21 25.5376 21 22.5V14.5C21 12.567 19.433 11 17.5 11C16.5335 11 15.6585 11.3915 15 12.0247C14.7368 10.3168 13.2647 9 11.5 9V15L12 15Z"
          fill={glowColor} opacity="0.25" />
      </svg>
    );
  }

  // Premium macOS-style cursor with Navis-style gradient shimmer
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }}>
      <defs>
        <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1">
            <animate attributeName="stop-color" values="#6366f1;#a855f7;#6366f1" dur="2s" repeatCount="indefinite" />
          </stop>
          <stop offset="50%" stopColor="#ec4899">
            <animate attributeName="stop-color" values="#ec4899;#3b82f6;#ec4899" dur="2s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#8b5cf6">
            <animate attributeName="stop-color" values="#8b5cf6;#14b8a6;#8b5cf6" dur="2s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
      </defs>
      {/* Outer gradient stroke */}
      <path 
        d="M7 4.5L7 25.5L12 20L16.5 29.5L20.5 27.5L16 18.5L23.5 18.5L7 4.5Z" 
        fill="black" 
        stroke="url(#shimmer)" 
        strokeWidth="1.5" 
        strokeLinejoin="round" 
      />
      {/* Inner subtle white highlight to give it a 3D feel */}
      <path 
        d="M8.5 7L8.5 22L12.5 18L16.5 26.5L18.5 25.5L14.5 17L20 17L8.5 7Z" 
        fill="black"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="0.5"
      />
    </svg>
  );
}

/* ─── Click ripple ────────────────────────────────────────────────── */

function ClickRipple({ xPct, yPct, type, onDone }: {
  xPct: number; yPct: number; type: string; onDone: () => void;
}) {
  const color =
    type === 'right_click' ? '#ef4444' :
    type === 'double_click' ? '#f59e0b' :
    '#22d3ee';

  useEffect(() => {
    const t = setTimeout(onDone, 700);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{
      position: 'absolute',
      left: `${xPct}%`,
      top: `${yPct}%`,
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 9998,
    }}>
      <div style={{
        width: 44, height: 44,
        borderRadius: '50%',
        border: `2.5px solid ${color}`,
        animation: 'ripple-expand 0.6s ease-out forwards',
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />
      <div style={{
        width: 10, height: 10,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 10px ${color}`,
        animation: 'ripple-dot 0.5s ease-out forwards',
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />
    </div>
  );
}

/* ─── Gradient overlay bar (like Navis) ──────────────────────────── */

function GradientOverlayBar({ task, active }: { task: string; active: boolean }) {
  return (
    <>
      {/* Top gradient fade — like Navis */}
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 80,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 100%)',
        pointerEvents: 'none',
        opacity: active ? 1 : 0,
        transition: 'opacity 0.4s ease',
        zIndex: 100,
      }} />

      {/* Bottom gradient + task banner */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        height: 100,
        background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
        pointerEvents: 'none',
        opacity: active ? 1 : 0,
        transition: 'opacity 0.4s ease',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 28,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 20px',
          borderRadius: 100,
          background: 'rgba(10, 10, 14, 0.82)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(99, 102, 241, 0.28)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
          color: '#a5b4fc',
          fontSize: 12.5,
          fontFamily: "'Inter', -apple-system, sans-serif",
          fontWeight: 500,
          letterSpacing: '0.015em',
          maxWidth: '70vw',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          opacity: active ? 1 : 0,
          transform: active ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
        }}>
          {/* Pulsing Fern dot */}
          <div style={{
            width: 7, height: 7,
            borderRadius: '50%',
            background: '#6366f1',
            flexShrink: 0,
            animation: active ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
          }} />
          <span style={{ color: 'rgba(255,255,255,0.38)', marginRight: 2, flexShrink: 0 }}>Fern</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task}</span>
        </div>
      </div>
    </>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────── */

export default function ComputerOverlayPage() {
  const [cursor, setCursor] = useState<CursorState>({
    rawX: -200, rawY: -200,
    screenW: 1920, screenH: 1080,
    actionType: 'move', description: '', visible: false,
  });
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const [overlay, setOverlay] = useState<OverlayState>({ active: false, task: '' });
  const rippleIdRef = useRef(0);
  const clickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Physical screen size from main process (robotjs coords are in physical pixels)
  const screenSizeRef = useRef({ w: 1920, h: 1080 });

  const removeRipple = useCallback((id: number) => {
    setRipples(prev => prev.filter(r => r.id !== id));
  }, []);

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.className = '';

    const api = (window as any).electronAPI;
    if (!api) return;

    api.on('computer-use:cursor-move', (data: any) => {
      // Update known screen dimensions if provided
      if (data.screenWidth && data.screenHeight) {
        screenSizeRef.current = { w: data.screenWidth, h: data.screenHeight };
      }
      // Normalize 'mouse_move' → 'move' defensively
      const rawType = data.actionType || 'move';
      const actionType = rawType === 'mouse_move' ? 'move' : rawType;

      setCursor(prev => ({
        ...prev,
        rawX: data.x,
        rawY: data.y,
        screenW: screenSizeRef.current.w,
        screenH: screenSizeRef.current.h,
        actionType,
        description: data.description || '',
        visible: true,
      }));

      // For click/drag actions: auto-reset cursor back to arrow after 350ms
      const isClick = ['left_click', 'right_click', 'double_click', 'triple_click', 'middle_click', 'drag'].includes(actionType);
      if (isClick) {
        if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current);
        clickResetTimerRef.current = setTimeout(() => {
          setCursor(prev => ({ ...prev, actionType: 'move' }));
        }, 350);
      }
    });

    api.on('computer-use:cursor-click', (data: any) => {
      const sw = screenSizeRef.current.w;
      const sh = screenSizeRef.current.h;
      const xPct = (data.x / sw) * 100;
      const yPct = (data.y / sh) * 100;
      const id = ++rippleIdRef.current;
      setRipples(prev => [...prev, { id, xPct, yPct, type: data.clickType || 'left_click' }]);
    });

    api.on('computer-use:overlay-state', (data: OverlayState) => {
      if (data.screenWidth && data.screenHeight) {
        screenSizeRef.current = { w: data.screenWidth, h: data.screenHeight };
      }
      setOverlay(data);
      if (!data.active) {
        setCursor(prev => ({ ...prev, visible: false }));
      }
    });

    return () => {
      api.off('computer-use:cursor-move');
      api.off('computer-use:cursor-click');
      api.off('computer-use:overlay-state');
    };
  }, []);

  // Convert raw physical coords to percentage for CSS positioning
  // This is the SAME technique Navis uses in CursorOverlayOnImage
  const xPct = (cursor.rawX / cursor.screenW) * 100;
  const yPct = (cursor.rawY / cursor.screenH) * 100;

  const isClickAction = cursor.actionType === 'click' || cursor.actionType === 'left_click'
    || cursor.actionType === 'right_click' || cursor.actionType === 'double_click'
    || cursor.actionType === 'triple_click';

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          overflow: hidden;
          background: transparent !important;
          width: 100vw;
          height: 100vh;
        }
        #__next { background: transparent !important; }

        @keyframes ripple-expand {
          0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; }
        }
        @keyframes ripple-dot {
          0%   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.75); }
        }
      `}</style>

      {/* Full-screen container */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'transparent',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}>
        {/* ── Cursor — removed per user request to use the OS cursor everywhere ── */}

        {/* ── Click ripples — also percentage-positioned ── */}
        {ripples.map(r => (
          <ClickRipple
            key={r.id}
            xPct={r.xPct}
            yPct={r.yPct}
            type={r.type}
            onDone={() => removeRipple(r.id)}
          />
        ))}

        {/* ── Gradient overlay + task banner (like Navis) ── */}
        <GradientOverlayBar task={overlay.task || ''} active={overlay.active} />
      </div>
    </>
  );
}
