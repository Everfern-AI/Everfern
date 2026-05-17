'use client';

/**
 * Terminal Output View Component
 * Displays command-line output with terminal styling
 */

import React, { useState } from 'react';
import { TerminalOutputViewProps } from './types';
import { formatDuration } from './utils';

/**
 * Copy icon component
 */
function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 2H2v12h8V8h4V2H6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Check icon component
 */
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M13 4L6 11L3 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    // This is a simplified version - a full implementation would handle all ANSI codes
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    return text.replace(ansiRegex, '');
  };

  const cleanOutput = parseAnsiColors(output);

  return (
    <div className="flex flex-col h-full">
      {/* Command section */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 sticky top-0">
        <div className="flex items-start gap-2 font-mono text-sm">
          <span className="text-gray-500 flex-shrink-0">$</span>
          <code className="text-gray-900 break-all">{command}</code>
        </div>
      </div>

      {/* Metadata section */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white space-y-2">
        {exitCode !== undefined && (
          <div className={`flex items-center justify-between text-sm ${isError ? 'text-red-600' : 'text-green-600'}`}>
            <span className="text-gray-600">Exit Code:</span>
            <span className="font-mono font-medium">{exitCode}</span>
          </div>
        )}

        {duration !== undefined && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Duration:</span>
            <span className="font-mono">{formatDuration(duration)}</span>
          </div>
        )}
      </div>

      {/* Output section */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between sticky top-0">
          <span className="text-sm font-medium text-gray-900">Output</span>
          <button
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            onClick={handleCopy}
            aria-label="Copy output"
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>

        <pre className={`flex-1 px-4 py-3 font-mono text-xs overflow-auto ${isError ? 'bg-red-50 text-red-900' : 'bg-gray-900 text-gray-100'}`}>
          <code>{cleanOutput || '(no output)'}</code>
        </pre>
      </div>

      {/* Status indicator */}
      {exitCode !== undefined && (
        <div className={`px-4 py-3 border-t flex items-center gap-2 text-sm ${isError ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <span className={`w-2 h-2 rounded-full ${isError ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className={isError ? 'text-red-700' : 'text-green-700'}>
            {isError ? 'Command failed' : 'Command succeeded'}
          </span>
        </div>
      )}
    </div>
  );
}
