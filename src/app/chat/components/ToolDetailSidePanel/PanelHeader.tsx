'use client';

/**
 * Panel Header Component
 * Displays agent name, tool name, and close button
 */

import React from 'react';
import { PanelHeaderProps } from './types';
import { X, Terminal, Search, Globe, Cpu } from 'lucide-react';

const TOOL_ICON_MAP: Record<string, { icon: React.ReactNode; color: string }> = {};

function getToolMeta(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes('web_search') || name.includes('search')) {
    return { iconSrc: '/assets/tool-search.svg', bg: 'bg-emerald-50', border: 'border-emerald-100', color: 'text-emerald-600', label: 'Web Search' };
  }
  if (name.includes('navis') || name.includes('browser') || name.includes('computer_use')) {
    return { iconSrc: '/assets/tool-browser.svg', bg: 'bg-blue-50', border: 'border-blue-100', color: 'text-blue-600', label: 'Browser' };
  }
  if (name.includes('run_command') || name.includes('bash') || name.includes('terminal')) {
    return { iconSrc: '/assets/tool-terminal.svg', bg: 'bg-violet-50', border: 'border-violet-100', color: 'text-violet-600', label: 'Terminal' };
  }
  return { iconSrc: '/assets/tool-generic.svg', bg: 'bg-amber-50', border: 'border-amber-100', color: 'text-amber-600', label: 'Tool' };
}

export default function PanelHeader({ agentName, toolName, onClose }: PanelHeaderProps) {
  const { iconSrc, bg, border, color } = getToolMeta(toolName);

  return (
    <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
      {/* Left: icon + title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg ${bg} ${border} border flex items-center justify-center flex-shrink-0`}>
          <img src={iconSrc} className={`w-4 h-4 ${color}`} alt="Tool Icon" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {agentName && (
              <span className="text-sm font-semibold text-gray-800">{agentName}</span>
            )}
            <span className="text-sm text-gray-400">is using</span>
            <code className="text-xs font-mono font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
              {toolName}
            </code>
          </div>
        </div>
      </div>

      {/* Right: close button only */}
      <button
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
        onClick={onClose}
        aria-label="Close panel"
        title="Close (Esc)"
      >
        <X className="w-4 h-4" />
      </button>
    </header>
  );
}
