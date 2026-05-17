'use client';

/**
 * NAVIS Screenshot View Component
 * Displays screenshots captured during browser automation
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { NavisScreenshotViewProps, Screenshot } from './types';
import { formatTimestamp } from './utils';

/**
 * Zoom icon component
 */
function ZoomIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 9L13 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Close icon component
 */
function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M15 5L5 15M5 5L15 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Screenshot card component
 */
function ScreenshotCard({
  screenshot,
  index,
  onZoom
}: {
  screenshot: Screenshot;
  index: number;
  onZoom: (screenshot: Screenshot) => void;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleZoomClick = () => {
    onZoom(screenshot);
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleZoomClick();
    }
  };

  return (
    <motion.div
      className="border border-gray-200 rounded-lg overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div className="relative bg-gray-100 aspect-video">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-3 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}

        {!hasError ? (
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt={`Screenshot ${index + 1}`}
            className="w-full h-full object-cover"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <p className="text-sm text-gray-500">Failed to load image</p>
          </div>
        )}

        <button
          className="absolute top-2 right-2 p-2 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          onClick={handleZoomClick}
          onKeyDown={handleZoomKeyDown}
          aria-label={`Zoom screenshot ${index + 1}`}
          title="Click to zoom"
        >
          <ZoomIcon />
        </button>
      </div>

      <div className="px-3 py-2 bg-white border-t border-gray-200 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-900">#{index + 1}</span>
        <span className="text-gray-500">{formatTimestamp(screenshot.timestamp)}</span>
      </div>
    </motion.div>
  );
}

/**
 * Zoom modal component
 */
function ZoomModal({
  screenshot,
  onClose
}: {
  screenshot: Screenshot;
  onClose: () => void;
}) {
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <motion.div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Zoomed screenshot"
    >
      <div className="relative max-w-4xl max-h-[90vh] w-full">
        <button
          className="absolute -top-10 right-0 p-2 text-white hover:bg-white/10 rounded transition-colors"
          onClick={onClose}
          aria-label="Close zoom"
        >
          <CloseIcon />
        </button>

        <img
          src={`data:image/png;base64,${screenshot.base64}`}
          alt="Zoomed screenshot"
          className="w-full h-full object-contain rounded-lg"
        />
      </div>
    </motion.div>
  );
}

/**
 * NAVIS Screenshot View Component
 */
export default function NavisScreenshotView({
  screenshots,
  toolName
}: NavisScreenshotViewProps) {
  const [zoomedScreenshot, setZoomedScreenshot] = useState<Screenshot | null>(
    null
  );

  if (screenshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <p className="text-sm font-medium text-gray-900 mb-1">No screenshots captured</p>
        <p className="text-xs text-gray-500">
          {toolName} did not capture any screenshots during execution
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 sticky top-0">
        <p className="text-sm font-medium text-gray-900">
          {screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {screenshots.map((screenshot, index) => (
          <ScreenshotCard
            key={`${screenshot.timestamp}-${index}`}
            screenshot={screenshot}
            index={index}
            onZoom={setZoomedScreenshot}
          />
        ))}
      </div>

      {zoomedScreenshot && (
        <ZoomModal
          screenshot={zoomedScreenshot}
          onClose={() => setZoomedScreenshot(null)}
        />
      )}
    </div>
  );
}
