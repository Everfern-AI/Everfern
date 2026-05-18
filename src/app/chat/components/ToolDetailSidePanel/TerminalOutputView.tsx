'use client';

/**
 * Terminal Output View Component
 * Displays command-line output with terminal styling
 */

import React, { useState } from 'react';
import { TerminalOutputViewProps } from './types';
import { formatDuration } from './utils';
import { Terminal, Copy, Check, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

/**
 * Terminal Output View Component
 */
export default function TerminalOutputView({
  command,
  output,
  exitCode,
  duration
}: TerminalOutputViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const isError = exitCode !== undefined && exitCode !== 0;

  // Parse ANSI color codes (basic implementation)
  const parseAnsiColors = (text: string) => {
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    return text.replace(ansiRegex, '');
  };

  const cleanOutput = parseAnsiColors(output);

  return (
    <div className="flex flex-col h-full bg-[#080b11] overflow-hidden">
      {/* Premium console header */}
      <div className="px-6 py-4 bg-[#0d131f] border-b border-[#1b263b] flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-md bg-[#161f30] text-blue-400 flex items-center justify-center">
            <Terminal className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-sans">
            Terminal Console
          </span>
        </div>
        <button
          className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md transition-all duration-200 cursor-pointer active:scale-95 flex items-center gap-2 text-xs font-medium"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy output'}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-[10px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Command prompt block */}
      <div className="px-6 py-5 bg-[#0b101a] border-b border-[#1b263b]">
        <div className="flex items-start gap-3 font-mono text-sm leading-relaxed">
          <span className="text-emerald-500 font-bold select-none">$</span>
          <code className="text-gray-200 break-all select-all font-semibold tracking-tight selection:bg-blue-500/30">
            {command}
          </code>
        </div>
      </div>

      {/* Metadata panel */}
      {(exitCode !== undefined || duration !== undefined) && (
        <div className="px-6 py-2.5 bg-[#0c121e] border-b border-[#162032] flex items-center justify-between gap-4 text-xs font-mono text-gray-400 select-none">
          {exitCode !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">STATUS:</span>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                isError 
                  ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              }`}>
                {isError ? (
                  <>
                    <AlertTriangle className="w-3 h-3" />
                    <span>ERR ({exitCode})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    <span>SUCCESS</span>
                  </>
                )}
              </div>
            </div>
          )}

          {duration !== undefined && (
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-3.5 h-3.5 text-gray-500" />
              <span>{formatDuration(duration)}</span>
            </div>
          )}
        </div>
      )}

      {/* Output block */}
      <div className="flex-1 overflow-y-auto flex flex-col bg-[#070a0f]">
        <pre className={`flex-1 px-6 py-6 font-mono text-xs leading-6 overflow-auto tracking-normal selection:bg-blue-500/30 ${
          isError ? 'text-red-300' : 'text-gray-300'
        }`}>
          <code>{cleanOutput || <span className="text-gray-500 font-sans italic">(no console output)</span>}</code>
        </pre>
      </div>

      {/* Status banner */}
      {exitCode !== undefined && (
        <div className={`px-6 py-3 border-t border-[#1b263b] flex items-center gap-3 text-xs select-none ${
          isError ? 'bg-red-950/20 text-red-400' : 'bg-emerald-950/20 text-emerald-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isError ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="font-semibold tracking-wide uppercase text-[10px]">
            {isError ? 'Process terminated with errors' : 'Process completed successfully'}
          </span>
        </div>
      )}
    </div>
  );
}
