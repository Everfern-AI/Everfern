"use client";

import React, { useRef, useEffect } from "react";
import { motion } from "framer-motion";

interface LocalExecutionPermissionCardProps {
  command: string;
  shellType: "Bash" | "PowerShell";
  reason: string;
  agentName: string;
  onDeny: () => void;
  onAlwaysAllow: () => void;
  onAllowOnce: () => void;
}

/**
 * LocalExecutionPermissionCard
 *
 * A self-contained React component that renders a permission card for local command execution.
 * Matches the reference design exactly with:
 * - White card with rounded corners and subtle border
 * - Terminal icon + header text
 * - Code block with shell label and syntax highlighting
 * - Three action buttons (Deny, Always allow, Allow once)
 * - Amber notice below with spinner
 * - Full keyboard navigation and ARIA labels
 */
export const LocalExecutionPermissionCard: React.FC<LocalExecutionPermissionCardProps> = ({
  command,
  shellType,
  reason,
  agentName,
  onDeny,
  onAlwaysAllow,
  onAllowOnce,
}) => {
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the deny button for accessibility
  useEffect(() => {
    denyButtonRef.current?.focus();
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLButtonElement).click();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="space-y-3"
    >
      {/* ── Main Card ── */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-4">
        {/* ── Header Row ── */}
        <div className="flex items-center gap-3 mb-3">
          {/* Terminal Icon */}
          <div className="text-lg font-semibold text-gray-700">⊡</div>
          {/* Header Text */}
          <h3 className="text-sm font-medium text-gray-800">
            Allow {agentName} to execute commands locally?
          </h3>
        </div>

        {/* ── Reason (optional) ── */}
        {reason && (
          <div className="mb-3 text-xs text-gray-600 italic">
            Reason: {reason}
          </div>
        )}

        {/* ── Code Block ── */}
        <div className="mt-3">
          {/* Shell Label */}
          <div className="text-xs font-bold text-gray-700 mb-1">
            {shellType}
          </div>
          {/* Code Block */}
          <div className="bg-[#f9fafb] rounded-lg border border-[#e5e7eb] p-3">
            <code className="font-mono text-sm text-[#6366f1] whitespace-pre-wrap">
              {command}
            </code>
          </div>
        </div>

        {/* ── Button Row ── */}
        <div className="mt-4 flex justify-end gap-2">
          {/* Deny Button */}
          <button
            ref={denyButtonRef}
            onClick={onDeny}
            onKeyDown={handleKeyDown}
            aria-label="Deny local execution"
            className="border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
          >
            Deny
          </button>

          {/* Always Allow Button */}
          <button
            onClick={onAlwaysAllow}
            onKeyDown={handleKeyDown}
            aria-label="Always allow local execution for this session"
            className="border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
          >
            Always allow
          </button>

          {/* Allow Once Button */}
          <button
            onClick={onAllowOnce}
            onKeyDown={handleKeyDown}
            aria-label="Allow local execution once"
            className="bg-[#1a1a1a] text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-[#2a2a2a] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-800"
          >
            Allow once
          </button>
        </div>
      </div>

      {/* ── Amber Notice with Spinner ── */}
      <div className="flex items-center gap-2 mt-3 text-amber-500 text-sm italic">
        {/* Dashed Spinner SVG */}
        <svg
          className="w-4 h-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeDasharray="4 4"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>{agentName} will continue working after your reply</span>
      </div>
    </motion.div>
  );
};

export default LocalExecutionPermissionCard;
