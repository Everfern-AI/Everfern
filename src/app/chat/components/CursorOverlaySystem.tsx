"use client";

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * CursorOverlaySystem Component
 *
 * Renders custom cursor visualization for NAVIS mouse interactions with exact visual matching:
 * - White/light colored arrow/pointer with subtle shadow
 * - Size: 24-28px for visibility on any background
 * - Click animation: Subtle ripple effect
 * - Drag indicator: Trail line showing drag path
 * - Smooth position transitions using requestAnimationFrame (60fps)
 * - Glow: Soft shadow/glow for visibility on dark backgrounds
 */

export interface CursorOverlayProps {
  coordinate: [number, number];
  action: 'move' | 'click' | 'drag' | 'scroll';
  isVisible: boolean;
  screenDimensions: { width: number; height: number };
  cursorStyle?: 'arrow' | 'pointer' | 'hand'; // Default: 'arrow'
  className?: string;
}

export interface CursorOverlayState {
  position: { x: number; y: number };
  animationState: 'idle' | 'clicking' | 'dragging';
  trailPoints: Array<{ x: number; y: number; timestamp: number }>;
  clickRipple: {
    isActive: boolean;
    scale: number;
    opacity: number;
  };
}

/**
 * Custom Cursor SVG Component
 * macOS Spotlight-style rounded square cursor matching reference image
 */
const CursorArrow: React.FC<{ size: number; style?: string }> = ({ size, style = 'arrow' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5))',
      }}
    >
      {/* macOS Spotlight-style rounded square cursor */}
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
      {/* Inner rounded square for depth */}
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
  );
};

/**
 * Click Ripple Effect Component
 */
const ClickRipple: React.FC<{ isActive: boolean; scale: number; opacity: number }> = ({
  isActive,
  scale,
  opacity,
}) => {
  if (!isActive) return null;

  return (
    <motion.div
      initial={{ scale: 1, opacity: 1 }}
      animate={{ scale, opacity }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        border: '2px solid rgba(255, 255, 255, 0.8)',
        pointerEvents: 'none',
      }}
    />
  );
};

/**
 * Mouse Trail Component
 */
const MouseTrail: React.FC<{ points: Array<{ x: number; y: number; timestamp: number }> }> = ({
  points,
}) => {
  if (points.length < 2) return null;

  // Create SVG path from trail points
  const pathData = points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    return `${path} L ${point.x} ${point.y}`;
  }, '');

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <path
        d={pathData}
        stroke="rgba(167, 139, 250, 0.8)"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.8)) drop-shadow(0 0 16px rgba(139, 92, 246, 0.5))',
        }}
      />
    </svg>
  );
};

/**
 * Scroll Indicator Component
 */
const ScrollIndicator: React.FC<{ direction: 'up' | 'down' }> = ({ direction }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: [0, 1, 0], y: direction === 'down' ? [0, 10, 20] : [0, -10, -20] }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
        {direction === 'down' ? (
          <path d="M8 12L4 8H12L8 12Z" />
        ) : (
          <path d="M8 4L12 8H4L8 4Z" />
        )}
      </svg>
    </motion.div>
  );
};

export const CursorOverlaySystem: React.FC<CursorOverlayProps> = ({
  coordinate,
  action,
  isVisible,
  screenDimensions,
  cursorStyle = 'arrow',
  className = '',
}) => {
  const [state, setState] = useState<CursorOverlayState>({
    position: { x: coordinate[0], y: coordinate[1] },
    animationState: 'idle',
    trailPoints: [],
    clickRipple: {
      isActive: false,
      scale: 1,
      opacity: 1,
    },
  });

  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastUpdateRef = useRef<number>(Date.now());

  // Smooth position transitions using requestAnimationFrame (60fps)
  useEffect(() => {
    if (!isVisible) return;

    const targetX = coordinate[0];
    const targetY = coordinate[1];

    const animate = () => {
      const now = Date.now();
      const deltaTime = now - lastUpdateRef.current;
      lastUpdateRef.current = now;

      setState((prev) => {
        const dx = targetX - prev.position.x;
        const dy = targetY - prev.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Smooth interpolation
        const speed = 0.2; // Adjust for smoothness
        const newX = prev.position.x + dx * speed;
        const newY = prev.position.y + dy * speed;

        // Update trail points for all movements
        let newTrailPoints = [...prev.trailPoints];
        newTrailPoints.push({ x: newX, y: newY, timestamp: now });
        // Keep only recent trail points (last 500ms) for a smooth fading trail
        newTrailPoints = newTrailPoints.filter((point) => now - point.timestamp < 500);

        return {
          ...prev,
          position: { x: newX, y: newY },
          trailPoints: newTrailPoints,
        };
      });

      // Continue animation if not at target
      if (Math.abs(targetX - state.position.x) > 0.5 || Math.abs(targetY - state.position.y) > 0.5) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [coordinate, isVisible, action]);

  // Handle click animation
  useEffect(() => {
    if (action === 'click') {
      setState((prev) => ({
        ...prev,
        animationState: 'clicking',
        clickRipple: {
          isActive: true,
          scale: 1,
          opacity: 1,
        },
      }));

      // Animate ripple: scale 1.0 → 1.3 → 0 with fade
      const startTime = Date.now();
      const duration = 400; // ms

      const animateRipple = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Scale: 1.0 → 1.3 → 0
        const scale = progress < 0.5 ? 1 + progress * 0.6 : 1.3 - (progress - 0.5) * 2.6;
        // Opacity: 1 → 0
        const opacity = 1 - progress;

        setState((prev) => ({
          ...prev,
          clickRipple: {
            isActive: progress < 1,
            scale,
            opacity,
          },
        }));

        if (progress < 1) {
          requestAnimationFrame(animateRipple);
        } else {
          setState((prev) => ({
            ...prev,
            animationState: 'idle',
          }));
        }
      };

      requestAnimationFrame(animateRipple);
    }
  }, [action]);

  // Handle drag animation state
  useEffect(() => {
    if (action === 'drag') {
      setState((prev) => ({
        ...prev,
        animationState: 'dragging',
      }));
    } else if (state.animationState === 'dragging') {
      setState((prev) => ({
        ...prev,
        animationState: 'idle',
        trailPoints: [],
      }));
    }
  }, [action]);

  if (!isVisible) return null;

  return (
    <div
      data-testid="cursor-overlay"
      className={`fixed top-0 left-0 pointer-events-none z-50 ${className}`}
      style={{
        width: `${screenDimensions.width}px`,
        height: `${screenDimensions.height}px`,
      }}
    >
      {/* Mouse trail */}
      <MouseTrail points={state.trailPoints} />

      {/* Cursor */}
      <motion.div
        data-testid="cursor-position"
        animate={{
          x: state.position.x,
          y: state.position.y,
        }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 30,
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 2,
        }}
      >
        <CursorArrow size={26} style={cursorStyle} />

        {/* Click ripple */}
        <ClickRipple
          isActive={state.clickRipple.isActive}
          scale={state.clickRipple.scale}
          opacity={state.clickRipple.opacity}
        />

        {/* Scroll indicator */}
        {action === 'scroll' && <ScrollIndicator direction="down" />}
      </motion.div>
    </div>
  );
};

/**
 * Hook for managing cursor overlay state
 */
export const useCursorOverlayState = (
  initialCoordinate: [number, number] = [0, 0]
): [
  CursorOverlayState,
  (coordinate: [number, number], action: CursorOverlayProps['action']) => void
] => {
  const [state, setState] = useState<CursorOverlayState>({
    position: { x: initialCoordinate[0], y: initialCoordinate[1] },
    animationState: 'idle',
    trailPoints: [],
    clickRipple: {
      isActive: false,
      scale: 1,
      opacity: 1,
    },
  });

  const updateCursor = (coordinate: [number, number], action: CursorOverlayProps['action']) => {
    setState((prev) => ({
      ...prev,
      position: { x: coordinate[0], y: coordinate[1] },
      animationState: action === 'click' ? 'clicking' : action === 'drag' ? 'dragging' : 'idle',
    }));
  };

  return [state, updateCursor];
};

export default CursorOverlaySystem;
