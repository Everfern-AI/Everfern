'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

interface InterruptedResponseBannerProps {
  onEditPrompt?: () => void;
  onTryAgain?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function InterruptedResponseBanner({
  onEditPrompt,
  onTryAgain,
  className = '',
  style = {},
}: InterruptedResponseBannerProps) {
  const [isHoveredEdit, setIsHoveredEdit] = useState(false);
  const [isHoveredRetry, setIsHoveredRetry] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`interrupted-response-banner ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '10px 14px',
        marginTop: 14,
        marginBottom: 6,
        borderRadius: 12,
        backgroundColor: 'var(--interrupted-banner-bg, rgba(255, 255, 255, 0.04))',
        border: '1px solid var(--interrupted-banner-border, rgba(255, 255, 255, 0.08))',
        boxShadow: 'var(--interrupted-banner-shadow, 0 1px 2px rgba(0, 0, 0, 0.04))',
        fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
        boxSizing: 'border-box',
        gap: 16,
        ...style,
      }}
    >
      {/* Left side: Icon + Interrupted Text */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: 1,
        }}
      >
        <InformationCircleIcon
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            color: 'var(--interrupted-icon-color, var(--color-text-secondary, #9ca3af))',
            strokeWidth: 1.75,
          }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 450,
            color: 'var(--interrupted-text-color, var(--color-text-primary, #e5e7eb))',
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Fern’s response was interrupted.
        </span>
      </div>

      {/* Right side: Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {onEditPrompt && (
          <button
            type="button"
            onClick={onEditPrompt}
            onMouseEnter={() => setIsHoveredEdit(true)}
            onMouseLeave={() => setIsHoveredEdit(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              border: '1px solid var(--interrupted-btn-border, rgba(255, 255, 255, 0.06))',
              backgroundColor: isHoveredEdit
                ? 'var(--interrupted-btn-hover-bg, rgba(255, 255, 255, 0.14))'
                : 'var(--interrupted-btn-bg, rgba(255, 255, 255, 0.08))',
              color: 'var(--interrupted-btn-text, var(--color-text-primary, #f3f4f6))',
              transition: 'background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
              outline: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Edit prompt
          </button>
        )}

        {onTryAgain && (
          <button
            type="button"
            onClick={onTryAgain}
            onMouseEnter={() => setIsHoveredRetry(true)}
            onMouseLeave={() => setIsHoveredRetry(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              border: '1px solid var(--interrupted-btn-border, rgba(255, 255, 255, 0.06))',
              backgroundColor: isHoveredRetry
                ? 'var(--interrupted-btn-hover-bg, rgba(255, 255, 255, 0.14))'
                : 'var(--interrupted-btn-bg, rgba(255, 255, 255, 0.08))',
              color: 'var(--interrupted-btn-text, var(--color-text-primary, #f3f4f6))',
              transition: 'background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
              outline: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Try again
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default InterruptedResponseBanner;
