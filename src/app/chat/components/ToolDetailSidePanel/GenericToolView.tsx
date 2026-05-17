'use client';

/**
 * Generic Tool View Component
 * Fallback view for tools without specific rendering
 */

import React, { useState } from 'react';
import { GenericToolViewProps } from './types';

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
 * Collapse/Expand icon component
 */
function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease'
      }}
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    <div className="border-b border-gray-200">
      <button
        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <ChevronIcon isOpen={isOpen} />
        <span className="text-sm font-medium text-gray-900">Arguments</span>
        <span className="text-xs text-gray-500">({argEntries.length})</span>
      </button>

      {isOpen && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <pre className="font-mono text-xs overflow-auto bg-white p-3 rounded border border-gray-200 text-gray-900">
            <code>{JSON.stringify(args, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Output section component
 */
function OutputSection({ output }: { output: string }) {
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

  if (!output) {
    return null;
  }

  return (
    <div className="border-b border-gray-200">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-200 bg-gray-50">
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

      <div className="px-4 py-3">
        {output.length > 500 ? (
          <details className="cursor-pointer">
            <summary className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Show output ({output.length} characters)
            </summary>
            <pre className="mt-3 font-mono text-xs overflow-auto bg-gray-50 p-3 rounded border border-gray-200 text-gray-900">
              <code>{output}</code>
            </pre>
          </details>
        ) : (
          <pre className="font-mono text-xs overflow-auto bg-gray-50 p-3 rounded border border-gray-200 text-gray-900">
            <code>{output}</code>
          </pre>
        )}
      </div>
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
    <div className="flex flex-col h-full">
      {/* Tool name header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 sticky top-0">
        <h3 className="text-sm font-semibold text-gray-900">{toolName}</h3>
        <p className="text-xs text-gray-500 mt-1">Tool execution details</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Arguments section */}
        <ArgumentsSection args={args} />

        {/* Output section */}
        <OutputSection output={output} />

        {/* Empty state */}
        {Object.keys(args).length === 0 && !output && (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <p className="text-sm text-gray-500">No data available for this tool execution</p>
          </div>
        )}
      </div>
    </div>
  );
}
