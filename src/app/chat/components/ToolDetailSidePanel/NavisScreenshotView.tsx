'use client';

/**
 * NAVIS Screenshot View Component
 * Displays screenshots captured during browser automation
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NavisScreenshotViewProps, Screenshot } from './types';
import { formatTimestamp } from './utils';
import { CameraOff, Maximize2, X, Globe } from 'lucide-react';

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

  return (
    <motion.div
      className="rounded-xl overflow-hidden bg-white border border-gray-200 hover:border-blue-200 transition-all duration-200 group cursor-pointer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 200, damping: 20 }}
      onClick={() => onZoom(screenshot)}
    >
      {/* Image area */}
      <div className="relative bg-gray-100 aspect-video overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!hasError ? (
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt={`Screenshot ${index + 1}`}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-400 ease-out"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 text-gray-400 gap-1.5">
            <CameraOff className="w-6 h-6 opacity-50" />
            <p className="text-[11px] font-medium">Failed to load</p>
          </div>
        )}

        {/* Zoom overlay on hover */}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <div className="p-2 bg-white/95 rounded-full">
            <Maximize2 className="w-3.5 h-3.5 text-gray-700" />
          </div>
        </div>

        {/* Step badge */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/55 backdrop-blur-sm rounded text-[10px] font-bold text-white tracking-wide">
          #{index + 1}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 flex items-center justify-between bg-white border-t border-gray-100">
        <span className="text-xs font-medium text-gray-600">Capture {index + 1}</span>
        <span className="text-[10px] text-gray-400 font-mono">
          {formatTimestamp(screenshot.timestamp).split(',')[1]?.trim() || formatTimestamp(screenshot.timestamp)}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * Zoom modal component
 */
function ZoomModal({ screenshot, onClose }: { screenshot: Screenshot; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 bg-black/85 backdrop-blur-lg flex items-center justify-center z-[100] p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative max-w-5xl w-full flex flex-col items-center gap-3">
        <button
          className="absolute -top-10 right-0 p-2 text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-all cursor-pointer"
          onClick={onClose}
        >
          <X className="w-4.5 h-4.5" />
        </button>

        <motion.div
          className="rounded-2xl overflow-hidden border border-white/10 w-full"
          initial={{ scale: 0.94, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.94, y: 12 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        >
          <img
            src={`data:image/png;base64,${screenshot.base64}`}
            alt="Zoomed screenshot"
            className="w-full max-h-[78vh] object-contain"
          />
        </motion.div>
      </div>
    </motion.div>
  );
}

/**
 * NAVIS Screenshot View Component
 */
export default function NavisScreenshotView({ screenshots = [], toolName }: NavisScreenshotViewProps) {
  const [zoomedScreenshot, setZoomedScreenshot] = useState<Screenshot | null>(null);
  const safeScreenshots = Array.isArray(screenshots) ? screenshots : [];

  if (safeScreenshots.length === 0) {
    return (
      <div className="flex flex-col h-full bg-gray-50/30">
        {/* Info banner at top */}
        <div className="px-4 py-3 border-b border-gray-150 bg-white">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
            Browser Session
          </p>
        </div>

        {/* Empty state — top-aligned, not vertically centered */}
        <div className="flex-1 flex flex-col justify-between py-6 min-h-0">
          <div className="px-6 pt-12 pb-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200/80 flex items-center justify-center mb-4 shadow-sm">
              <CameraOff className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1.5">No screenshots captured</h3>
            <p className="text-xs text-gray-500 leading-relaxed max-w-[240px]">
              {toolName} ran successfully but didn't generate any screen captures during this session.
            </p>
          </div>

          {/* Hint strip at bottom */}
          <div className="mx-4 rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 flex items-start gap-3 shadow-sm/50">
            <Globe className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Screenshots appear here in real-time as the browser agent navigates pages and completes actions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky subheader */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
          Execution History
        </p>
        <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full">
          {safeScreenshots.length} capture{safeScreenshots.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Screenshot grid */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {safeScreenshots.map((screenshot, index) => (
          <ScreenshotCard
            key={`${screenshot.timestamp}-${index}`}
            screenshot={screenshot}
            index={index}
            onZoom={setZoomedScreenshot}
          />
        ))}
      </div>

      <AnimatePresence>
        {zoomedScreenshot && (
          <ZoomModal
            screenshot={zoomedScreenshot}
            onClose={() => setZoomedScreenshot(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
