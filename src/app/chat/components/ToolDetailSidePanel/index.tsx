'use client';

/**
 * Tool Detail Side Panel - Main component
 * Displays detailed information about tool executions
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolDetailSidePanelProps, ToolType } from './types';
import { detectToolType, extractToolData } from './utils';
import PanelHeader from './PanelHeader';
import WebSearchResultsView from './WebSearchResultsView';
import NavisScreenshotView from './NavisScreenshotView';
import TerminalOutputView from './TerminalOutputView';
import GenericToolView from './GenericToolView';

/**
 * Tool data cache with TTL
 */
const toolDataCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached tool data if available and not expired
 */
function getCachedToolData(toolCallId: string): any | null {
  const cached = toolDataCache.get(toolCallId);
  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    toolDataCache.delete(toolCallId);
    return null;
  }

  return cached.data;
}

/**
 * Set tool data in cache
 */
function setCachedToolData(toolCallId: string, data: any): void {
  toolDataCache.set(toolCallId, {
    data,
    expiresAt: Date.now() + CACHE_TTL
  });
}

/**
 * Main Tool Detail Side Panel Component
 */
export default function ToolDetailSidePanel({
  isOpen,
  toolCall,
  onClose,
  conversationId
}: ToolDetailSidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [toolType, setToolType] = useState<ToolType>(ToolType.GENERIC);
  const [toolData, setToolData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect tool type and extract data
  useEffect(() => {
    if (!isOpen || !toolCall) {
      setToolData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedToolData(toolCall.id);
      if (cached) {
        setToolData(cached);
        setIsLoading(false);
        return;
      }

      // Detect tool type
      const type = detectToolType(toolCall.toolName);
      setToolType(type);

      // Extract tool-specific data
      const extracted = extractToolData(toolCall, type);

      if (extracted) {
        setToolData(extracted);
        setCachedToolData(toolCall.id, extracted);
      } else if (type !== ToolType.GENERIC) {
        // Fallback to generic view if extraction fails
        setToolType(ToolType.GENERIC);
        setToolData({
          toolName: toolCall.toolName,
          args: toolCall.args,
          output: toolCall.output || ''
        });
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Error processing tool data:', err);
      setError('Failed to load tool details');
      setIsLoading(false);
    }
  }, [isOpen, toolCall]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      panelRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen, onClose]);

  // Render content based on tool type
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin mb-4" />
          <p className="text-gray-600">Loading tool details...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4 bg-red-50 rounded-lg">
          <p className="text-red-600 text-center">{error}</p>
        </div>
      );
    }

    if (!toolData) {
      return (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <p className="text-gray-500">No data available</p>
        </div>
      );
    }

    switch (toolType) {
      case ToolType.WEB_SEARCH:
        return (
          <WebSearchResultsView
            query={toolData.query}
            results={toolData.results}
            totalResults={toolData.totalResults}
          />
        );

      case ToolType.NAVIS:
        return (
          <NavisScreenshotView
            screenshots={toolData.screenshots}
            toolName={toolCall?.toolName || 'NAVIS'}
          />
        );

      case ToolType.TERMINAL:
        return (
          <TerminalOutputView
            command={toolData.command}
            output={toolData.output}
            exitCode={toolData.exitCode}
            duration={toolData.duration}
          />
        );

      case ToolType.GENERIC:
      default:
        return (
          <GenericToolView
            toolName={toolData.toolName}
            args={toolData.args}
            output={toolData.output}
          />
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 lg:hidden z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            className="fixed right-0 top-0 bottom-0 w-full lg:w-96 bg-white shadow-lg lg:shadow-none lg:border-l lg:border-gray-200 flex flex-col z-50 lg:z-auto lg:relative lg:bottom-auto"
            role="complementary"
            aria-label="Tool execution details"
            aria-hidden={!isOpen}
            tabIndex={-1}
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {/* Header */}
            {toolCall && (
              <PanelHeader
                agentName={toolCall.agentName}
                toolName={toolCall.toolName}
                onClose={onClose}
              />
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.2 }}
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
