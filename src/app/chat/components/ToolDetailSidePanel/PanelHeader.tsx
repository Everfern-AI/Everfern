'use client';

/**
 * Panel Header Component
 * Displays agent name, tool name, and close button
 */

import React from 'react';
import { PanelHeaderProps } from './types';

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
 * Panel Header Component
 */
export default function PanelHeader({
  agentName,
  toolName,
  onClose
}: PanelHeaderProps) {
  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 break-words" id="panel-title">
              {agentName && (
                <>
                  <span className="text-blue-600">{agentName}</span>
                  <span className="text-gray-500 mx-1">is using</span>
                </>
              )}
              <span className="text-gray-900">{toolName}</span>
            </h2>
          </div>

          <button
            className="flex-shrink-0 p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            onClick={onClose}
            aria-label="Close panel"
            aria-controls="tool-detail-panel"
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
