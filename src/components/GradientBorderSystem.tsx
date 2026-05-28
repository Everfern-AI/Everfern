"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * GradientBorderSystem Component
 *
 * Provides macOS Spotlight-style gradient border effects with:
 * - Smooth gradient animation (blue → purple → pink)
 * - Shimmer effect with continuous smooth movement (2-3 second cycle)
 * - Status-based color transitions (idle, executing, success, error)
 * - Soft glow effect (8-12px blur radius) around border
 * - Hardware acceleration with transform3d and will-change
 */

export interface GradientBorderProps {
  isActive: boolean;
  status: 'idle' | 'executing' | 'success' | 'error';
  borderRadius?: number; // Default: 12px
  borderWidth?: number; // Default: 2.5px
  animationSpeed?: number; // Default: 2.5s cycle
  glowIntensity?: number; // Default: 1.0
  children?: React.ReactNode;
  className?: string;
}

export interface GradientBorderState {
  colors: string[];
  animationPhase: number; // 0-1 for smooth shimmer position
  shimmerPosition: number; // Percentage along border
  glowOpacity: number;
}

// Reference colors from macOS Spotlight aesthetic
const SPOTLIGHT_COLORS = {
  blue: '#3B82F6',
  purple: '#9333EA',
  pink: '#EC4899',
  success: '#22c55e',
  error: '#ef4444',
};

/**
 * Get gradient colors based on status
 */
const getGradientColors = (status: GradientBorderProps['status']): string[] => {
  switch (status) {
    case 'success':
      return [SPOTLIGHT_COLORS.success, SPOTLIGHT_COLORS.blue, SPOTLIGHT_COLORS.success];
    case 'error':
      return [SPOTLIGHT_COLORS.error, SPOTLIGHT_COLORS.pink, SPOTLIGHT_COLORS.error];
    case 'executing':
    case 'idle':
    default:
      return [SPOTLIGHT_COLORS.blue, SPOTLIGHT_COLORS.purple, SPOTLIGHT_COLORS.pink, SPOTLIGHT_COLORS.blue];
  }
};

/**
 * Calculate gradient color stops for smooth transitions
 */
const calculateGradientStops = (colors: string[], shimmerPosition: number): string => {
  const stops = colors.map((color, index) => {
    const basePosition = (index / (colors.length - 1)) * 100;
    // Add shimmer offset for smooth movement
    const position = (basePosition + shimmerPosition) % 100;
    return `${color} ${position}%`;
  });
  return stops.join(', ');
};

export const GradientBorderSystem: React.FC<GradientBorderProps> = ({
  isActive,
  status,
  borderRadius = 12,
  borderWidth = 2.5,
  animationSpeed = 2.5,
  glowIntensity = 1.0,
  children,
  className = '',
}) => {
  const [state, setState] = useState<GradientBorderState>({
    colors: getGradientColors(status),
    animationPhase: 0,
    shimmerPosition: 0,
    glowOpacity: isActive ? 1 : 0,
  });

  // Update colors when status changes
  useEffect(() => {
    setState(prev => ({
      ...prev,
      colors: getGradientColors(status),
    }));
  }, [status]);

  // Update glow opacity when active state changes
  useEffect(() => {
    setState(prev => ({
      ...prev,
      glowOpacity: isActive ? 1 : 0,
    }));
  }, [isActive]);

  // Shimmer animation loop
  useEffect(() => {
    if (!isActive) return;

    let animationFrameId: number;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      // Calculate shimmer position (0-100) based on animation speed
      const progress = (elapsed / (animationSpeed * 1000)) % 1;
      const shimmerPosition = progress * 100;

      setState(prev => ({
        ...prev,
        animationPhase: progress,
        shimmerPosition,
      }));

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isActive, animationSpeed]);

  // Calculate glow blur radius based on intensity
  const glowBlurRadius = 8 + (glowIntensity * 4); // 8-12px range

  // Build gradient background
  const gradientBackground = `linear-gradient(90deg, ${calculateGradientStops(state.colors, state.shimmerPosition)})`;

  // Build box shadow for glow effect
  const glowShadow = isActive
    ? `0 0 ${glowBlurRadius}px ${glowBlurRadius / 2}px ${state.colors[0]}${Math.round(state.glowOpacity * 0.3 * 255).toString(16).padStart(2, '0')}`
    : 'none';

  return (
    <motion.div
      data-testid="gradient-border"
      className={`relative ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        borderRadius: `${borderRadius}px`,
        padding: `${borderWidth}px`,
        background: isActive ? gradientBackground : 'transparent',
        boxShadow: glowShadow,
        transition: 'box-shadow 0.3s ease, opacity 0.3s ease',
        // Hardware acceleration
        transform: 'translate3d(0, 0, 0)',
        willChange: isActive ? 'background, box-shadow' : 'auto',
      }}
    >
      {/* Inner content container */}
      <div
        style={{
          borderRadius: `${Math.max(0, borderRadius - borderWidth)}px`,
          background: '#ffffff',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </motion.div>
  );
};

/**
 * Hook for managing gradient border state
 */
export const useGradientBorderState = (
  initialStatus: GradientBorderProps['status'] = 'idle'
): [GradientBorderState, (status: GradientBorderProps['status']) => void] => {
  const [status, setStatus] = useState(initialStatus);
  const [state, setState] = useState<GradientBorderState>({
    colors: getGradientColors(status),
    animationPhase: 0,
    shimmerPosition: 0,
    glowOpacity: 0,
  });

  useEffect(() => {
    setState(prev => ({
      ...prev,
      colors: getGradientColors(status),
    }));
  }, [status]);

  return [state, setStatus];
};

export default GradientBorderSystem;
