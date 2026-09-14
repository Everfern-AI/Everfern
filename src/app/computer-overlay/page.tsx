'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

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

function GradientOverlayBar({ task, active, exiting }: { task: string; active: boolean; exiting?: boolean }) {
  const isVisible = active && !exiting;
  return (
    <>
      {/* Top gradient fade — like Navis */}
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 80,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 100%)',
        pointerEvents: 'none',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
        zIndex: 100,
      }} />

      {/* Bottom gradient + task banner */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        height: 100,
        background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
        pointerEvents: 'none',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
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
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.96)',
          transition: 'opacity 0.35s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {/* Pulsing Fern dot */}
          <div style={{
            width: 7, height: 7,
            borderRadius: '50%',
            background: '#6366f1',
            flexShrink: 0,
            animation: isVisible ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
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
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayExiting, setOverlayExiting] = useState(false);
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

    // NR-LEAK-08: capture handler refs so off() removes only our listeners
    const onCursorMove = (data: any) => {
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
    };

    const onCursorClick = (data: any) => {
      const sw = screenSizeRef.current.w;
      const sh = screenSizeRef.current.h;
      const xPct = (data.x / sw) * 100;
      const yPct = (data.y / sh) * 100;
      const id = ++rippleIdRef.current;
      setRipples(prev => [...prev, { id, xPct, yPct, type: data.clickType || 'left_click' }]);
    };

    const onOverlayState = (data: OverlayState) => {
      if (data.screenWidth && data.screenHeight) {
        screenSizeRef.current = { w: data.screenWidth, h: data.screenHeight };
      }

      if (data.active && !overlay.active) {
        // Entrance animation
        setOverlayExiting(false);
        setOverlayVisible(true);
        setOverlay(data);
      } else if (!data.active && overlay.active) {
        // Exit animation
        setOverlayExiting(true);
        setTimeout(() => {
          setOverlayVisible(false);
          setOverlayExiting(false);
        }, 400);
        setCursor(prev => ({ ...prev, visible: false }));
      } else {
        setOverlay(data);
      }
    };

    api.on('computer-use:cursor-move', onCursorMove);
    api.on('computer-use:cursor-click', onCursorClick);
    api.on('computer-use:overlay-state', onOverlayState);

    return () => {
      api.off('computer-use:cursor-move', onCursorMove);
      api.off('computer-use:cursor-click', onCursorClick);
      api.off('computer-use:overlay-state', onOverlayState);
    };
  }, []);

  const showOverlay = overlay.active || overlayVisible || overlayExiting;

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

      {/* Full-screen container with entrance/exit animation */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'transparent',
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: showOverlay ? 1 : 0,
        transform: showOverlay ? 'scale(1)' : 'scale(1.02)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
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
        <GradientOverlayBar task={overlay.task || ''} active={overlay.active} exiting={overlayExiting} />
      </div>
    </>
  );
}
