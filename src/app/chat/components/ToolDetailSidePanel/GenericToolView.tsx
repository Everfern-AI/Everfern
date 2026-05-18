'use client';

/**
 * Generic Tool View Component
 * Fallback view for tools without specific rendering
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GenericToolViewProps } from './types';
import { Braces, Terminal, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Arguments section component
 */
function ArgumentsSection({ args }: { args: Record<string, unknown> }) {
  const [isOpen, setIsOpen] = useState(true);

  const argEntries = Object.entries(args);

  if (argEntries.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-150 bg-white">
      <button
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-gray-50/50 transition-all duration-200 text-left font-sans cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded-md bg-amber-50 border border-amber-100 text-amber-600">
            <Braces className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-800">Arguments</span>
            <span className="text-xs text-gray-400 font-medium ml-1.5 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
              {argEntries.length} field{argEntries.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-gray-50/45 border-t border-gray-100"
          >
            <div className="p-4">
              <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto bg-[#0b0f17] text-gray-300 p-4 rounded-xl border border-gray-800 max-h-[300px]">
                <code>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Output section component
 */
function OutputSection({ output }: { output: string }) {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!output) {
    return null;
  }

  return (
    <div className="border-b border-gray-150 bg-white">
      <button
        className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-gray-50/50 transition-all duration-200 text-left font-sans cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-600">
            <Terminal className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Console Output</span>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-all duration-200 cursor-pointer active:scale-95 flex items-center gap-1 text-xs font-semibold"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-gray-50/45 border-t border-gray-100"
          >
            <div className="p-4">
              <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto bg-[#070a0f] text-gray-300 p-4 rounded-xl border border-gray-800 max-h-[400px]">
                <code>{output}</code>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Generic Tool View Component
 */
export default function GenericToolView({
  toolName,
  args,
  output
}: GenericToolViewProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tool name header */}
      <div className="px-6 py-5 border-b border-gray-150 bg-white">
        <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{toolName}</h3>
        <p className="text-xs text-gray-500 font-medium">Generic tool execution diagnostics</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Arguments section */}
        <ArgumentsSection args={args} />

        {/* Output section */}
        <OutputSection output={output} />

        {/* Empty state */}
        {Object.keys(args).length === 0 && !output && (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="p-4 bg-gray-100 rounded-full text-gray-400 mb-4">
              <Braces className="w-8 h-8" />
            </div>
            <h4 className="text-sm font-semibold text-gray-950 mb-1">No Diagnostic Data</h4>
            <p className="text-xs text-gray-500 max-w-[280px]">
              This tool executed successfully without generating arguments or terminal outputs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
